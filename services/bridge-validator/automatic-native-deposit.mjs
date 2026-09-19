// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Thin REGTEST -> explicitly configured Solana test-network composition.
// It does not create wallets, keys, blocks or deployments. No private FROST
// share enters this worker or the relayer; the configured A+B clients sign.
import { AuthenticatedLocalDepositLedger } from "./local-deposit-ledger.mjs";
import { NativeDepositObserver, validateNativeDepositRequest } from "./native-deposit-observer.mjs";
import { validateDepositOperationPolicy } from "./deposit-operation-state.mjs";
import { nativeReserveCreditEvidenceInput, createVerifiedNativeReserveCredit, createRawNativeCreditAttestationVerifier } from "./native-reserve-credit.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { NativeFrostCoordinator } from "../../native/frost/index.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { attachTaprootWitnesses, parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot } from "../solana-observer/deployment-integrity.mjs";
import { SolanaDepositClaimObserver } from "../solana-observer/solana-deposit-claim-observer.mjs";
import { SolanaLocalRpcClient } from "./solana-deposit-claim-submitter.mjs";
import { LocalnetSolanaDepositClaimBridge } from "./localnet-solana-deposit-claim-bridge.mjs";
import { base58Encode, base58Decode, findProgramAddress, DEPOSIT_CLAIM_PDA_SEED_PREFIX } from "./solana-deposit-claim-transaction-plan.mjs";
import { ProjectAttester, combineProjectAttestations } from "../attesters/attestation-service.mjs";
import { validateSolanaDeliveryPolicy, validateSolanaDepositDelivery, validateSolanaDeliveryStatus, verifySolanaDeliveryAccounts } from "../relayer/solana-deposit-delivery.mjs";
import { compareDepositAccounting } from "../reconciliation/deposit-reconciliation.mjs";

const check = (v, code = "LocalDepositServiceRejected") => { if (!v) throw new Error(code); };
const keyHex = value => Buffer.from(base58Decode(value)).toString("hex");
const tapscripts = p => [p.depositPolicy.sweep, ...p.inputs.slice(1).map(() => undefined)];
export async function verifyServiceDepositSigning({ plan, policy, nativeVerifier, intent }) {
  check(nativeVerifier instanceof LocalNativeEvidenceVerifier);
  check(canonicalJson(plan.signingIntents[intent.signingInputIndex]) === canonicalJson(intent), "DepositServiceSigningChanged");
  return nativeVerifier.verifySweepSigning({ inputs: plan.inputs, minimumConfirmations: policy.minimumConfirmations,
    acceptedCheckpoint: plan.acceptedCheckpoint, unsignedTransactionHex: plan.unsignedTransactionHex,
    reserveAmountAtomic: plan.depositIntent.amountAtomic, feeAtomic: intent.feeAtomic,
    reserveScriptHex: plan.depositPolicy.canonicalReserveScriptPubKeyHex, intent, tapscriptSpends: tapscripts(plan) });
}

export class AutomaticNativeToSolanaDeposit {
  #ledger; #native; #rpc; #solana; #manifest; #policy; #observer; #coordinator; #attesters; #claim; #claimObserver; #claimRpc; #deliveryPolicy; #busy = false; #observationCursor = 0;
  constructor({ environment, ledger, policy, manifest, nativeVerifier, nativeRpc, solanaRpc, solanaEndpoint, createCoordinator, attesters, feePayerSigner }) {
    check(["localnet", "devnet"].includes(environment) && ledger instanceof AuthenticatedLocalDepositLedger && nativeVerifier instanceof LocalNativeEvidenceVerifier &&
      nativeRpc instanceof NativeRpcClient && solanaRpc instanceof LocalDeploymentRpc && typeof createCoordinator === "function");
    ledger.assertEconomicLimitsReady();
    const p = validateDepositOperationPolicy(policy), m = validateDeploymentManifest(manifest);
    check(environment === p.environment && environment === m.environment && ledger.environment === environment &&
      p.nativeGenesis === m.nativeGenesisHex && p.solanaGenesis === m.solanaGenesis && p.solanaDeployment === m.solanaDeploymentHex &&
      p.managerProgramId === keyHex(m.manager.id) && p.transceiverProgramId === keyHex(m.transceiver.id) &&
      p.mint === keyHex(m.mint.id) && p.policyEpoch === m.config.policyEpoch && p.keyEpoch === m.config.keyEpoch &&
      p.protocolId === m.config.protocolId && p.nativeNetwork === m.config.nativeNetwork && m.mint.decimals === 8 &&
      !m.config.depositsPaused && m.config.transceiverActive);
    check(Array.isArray(attesters) && attesters.length === 2);
    attesters.forEach((a, i) => check(a instanceof ProjectAttester && a.role === ["ATTESTER_A", "ATTESTER_B"][i] &&
      base58Encode(a.publicKey) === m.config.attesters[i]));
    this.#ledger = ledger; this.#policy = p; this.#manifest = m; this.#native = nativeVerifier; this.#rpc = nativeRpc; this.#solana = solanaRpc;
    this.#coordinator = createCoordinator; this.#attesters = [...attesters];
    this.#observer = new NativeDepositObserver({ nativeRpc, nativeVerifier, policy: p });
    const rpc = new SolanaLocalRpcClient({ endpoint: solanaEndpoint, environment, expectedGenesis: p.solanaGenesis });
    this.#claimRpc = rpc;
    this.#deliveryPolicy = validateSolanaDeliveryPolicy({ operationPolicy: p, manifest: m, feePayerPublicKey: feePayerSigner.publicKeyBase58 });
    this.#claimObserver = new SolanaDepositClaimObserver({ endpoint: solanaEndpoint, config: { environment, cluster: environment, solanaGenesis: p.solanaGenesis,
      managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint, nativeDecimals: 8 } });
    this.#claim = new LocalnetSolanaDepositClaimBridge({ config: { environment, cluster: environment, solanaGenesis: p.solanaGenesis, solanaDeploymentHex: p.solanaDeployment,
      managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
      tokenProgramIdHex: keyHex(m.mint.tokenProgram), feePayerHex: feePayerSigner.publicKeyHex,
      feePayerBase58: feePayerSigner.publicKeyBase58, policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch, acceptedObservationTrust: ["RPC_OBSERVATION"],
      finalityPollAttempts: 1, finalityPollDelayMs: 0, maxRetries: 0 }, feePayerSigner,
      // Check pause and the approved deployment immediately before every send,
      // including the second (claim) transaction after receipt finality.
      rpcClient: { getLatestBlockhash: () => rpc.getLatestBlockhash(), getBlockHeight: () => rpc.getBlockHeight(),
        getSignatureStatus: signature => rpc.getSignatureStatus(signature), sendTransaction: async (...args) => {
          await this.#deployment(); this.#active(); return rpc.sendTransaction(...args);
        } }, claimObserver: this.#claimObserver, journal: ledger.solanaServiceJournal("CLAIM"), receiptJournal: ledger.solanaServiceJournal("RECEIPT"),
      expiredPacketCheck: (kind, prepared) => this.#expiredPacket(kind, prepared) });
  }
  async #expiredPacket(kind, prepared) {
    const height = await this.#claimRpc.getBlockHeight();
    if (height <= BigInt(prepared.lastValidBlockHeight)) return null;
    const record = this.#ledger.serviceDeposits({ registeredOnly: true }).map(r => this.#ledger.serviceDeposit(r.operationId))
      .find(r => r.operation.finalizedCredit?.encodedMessageHex === prepared.encodedMessageHex);
    check(record, "DepositDeliveryOperationMissing");
    const v = validateSolanaDepositDelivery({ operationId: record.operation.plan.operationId, kind,
      encodedMessageHex: prepared.encodedMessageHex, attestations: record.attestations, preparedTransactionBase64: prepared.preparedTransactionBase64,
      recentBlockhash: prepared.recentBlockhash, lastValidBlockHeight: String(prepared.lastValidBlockHeight), minimumSlot: this.#policy.minimumSolanaSlot }, this.#deliveryPolicy);
    if (validateSolanaDeliveryStatus(await this.#claimRpc.getSignatureStatus(v.signature)) !== null) return null;
    const observed = verifySolanaDeliveryAccounts(v.delivery, this.#deliveryPolicy,
      await this.#solana.snapshotWithAdditionalAccounts(this.#manifest, [v.receiptAddress, v.claimAddress]));
    if (kind === "RECEIPT" && observed.receiptExists) {
      // A verified finalized receipt is sufficient for this intermediate
      // stage even if its historical transaction response is unavailable.
      this.#ledger.solanaServiceJournal("RECEIPT").recordCompleted(prepared.operationIdHex, { state: "COMPLETED",
        reason: "SOLANA_RECEIPT_ACCOUNT_FINALIZED", operationIdHex: prepared.operationIdHex });
      return null;
    }
    if (observed.claimExists) return null;
    if (validateSolanaDeliveryStatus(await this.#claimRpc.getSignatureStatus(v.signature)) !== null) return null;
    // The finalized chain has passed expiry, both account outcomes are absent,
    // and a history lookup brackets that bank. Rebuild the SAME operation only.
    this.#active(); return { signature: v.signature, finalizedHeight: height.toString(), slot: observed.slot.toString() };
  }
  assertLedger(ledger) { check(ledger === this.#ledger, "DepositServiceLedgerMismatch"); }
  publicPolicy() { return structuredClone(this.#policy); }
  async assertSolanaDestination(tokenAccount) {
    this.#active();
    const snapshot = await this.#solana.snapshotWithAdditionalAccounts(this.#manifest, [tokenAccount]);
    check(Array.isArray(snapshot.accounts) && snapshot.accounts.length > 1, "UserTokenAccountUnavailable");
    await this.#deployment({ ...snapshot, accounts: snapshot.accounts.slice(0, -1) });
    const account = snapshot.accounts.at(-1);
    check(account && account.owner === this.#manifest.mint.tokenProgram && account.executable === false &&
      Array.isArray(account.data) && account.data.length === 2 && account.data[1] === "base64" &&
      typeof account.data[0] === "string" && account.data[0].length === 220, "UserTokenAccountRejected");
    const bytes = Buffer.from(account.data[0], "base64");
    check(bytes.length === 165 && bytes.toString("base64") === account.data[0] &&
      bytes.subarray(0, 32).toString("hex") === this.#policy.mint && bytes[108] === 1, "UserTokenAccountRejected");
    this.#active();
  }
  async reconcile() {
    if (this.#ledger.serviceAccountingPending()) return { state: "WAITING_FOR_DEPENDENCY", reason: "DEPOSIT_ACCOUNTING_CATCHUP_REQUIRED" };
    const inputs = this.#ledger.accountedReserveInputs(), before = await this.#native.observeChain();
    const affected = this.#ledger.acceptedNativeBases().filter(b => b.blocks.some(block => before.headerHashes[block.height] !== block.blockHash));
    if (affected.length) {
      if (affected.some(b => BigInt("0x" + before.chainworkHex) <= BigInt("0x" + b.chainworkHex)))
        return { state: "WAITING_FOR_DEPENDENCY", reason: "NATIVE_CHAIN_CHOICE_UNRESOLVED" };
      if (this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("ACCEPTED_NATIVE_OPERATION_REORG");
      return { state: "PAUSED", reason: "ACCEPTED_NATIVE_OPERATION_REORG", affectedOperations: affected.map(b => b.operationId) };
    }
    for (let offset = 0; offset < inputs.length; offset += 14) {
      const batch = inputs.slice(offset, offset + 14);
      try { await this.#native.verifyInputs({ inputs: batch, minimumConfirmations: this.#policy.minimumConfirmations }); }
      catch (error) {
        if (error?.message !== "RAW_NATIVE_INPUT_NOT_AVAILABLE") throw error;
        let contradiction = false;
        for (const input of batch) {
          const utxo = await this.#rpc.getUtxoObservation({ txid: input.txid, vout: input.vout, decimals: 8, includeMempool: false });
          if (!utxo.unspent) contradiction = true;
        }
        check((await this.#native.observeChain()).tipHash === before.tipHash, "DepositReconciliationSourceChanged");
        if (contradiction && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("UNEXPLAINED_CANONICAL_RESERVE_SPEND");
        return { state: contradiction ? "PAUSED" : "WAITING_FOR_DEPENDENCY", reason: contradiction ? "UNEXPLAINED_CANONICAL_RESERVE_SPEND" : "NATIVE_RESERVE_UNAVAILABLE" };
      }
    }
    const observed = await this.#deployment(), after = await this.#native.observeChain();
    check(before.tipHash === after.tipHash && before.chainworkHex === after.chainworkHex, "DepositReconciliationSourceChanged");
    const journal = this.#ledger.snapshot(), reserve = inputs.reduce((n, i) => n + BigInt(i.amountAtomic), 0n);
    const issued = BigInt(journal.mintedSupply), pending = BigInt(journal.authorizedUnmintedCredits), manager = BigInt(observed.managerMintedAtomic);
    // A backed claim can land between catch-up and this bank read. Wait for
    // its exact receipt; never repair counters or authorize another mint here.
    if (manager > issued && manager <= issued + pending && reserve === BigInt(journal.canonicalReserve) &&
        reserve === issued + pending && BigInt(observed.mintSupplyAtomic) <= manager)
      return { state: "WAITING_FOR_DEPENDENCY", reason: "UNOBSERVED_DEPOSIT_MINT" };
    try {
      return { state: "MATCH", ...compareDepositAccounting(journal, { ...observed, canonicalReserve: reserve.toString() }) };
    } catch (error) {
      if (!error?.incident) throw error;
      if (this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("DEPOSIT_ACCOUNTING_CONTRADICTION");
      return { state: "PAUSED", reason: "ACCOUNTING_CONTRADICTION" };
    }
  }

  #active() { check(this.#ledger.status().state === "OPEN_LOCAL_ACCOUNTING_ONLY", "DepositServicePaused"); }
  async #deployment(snapshot) {
    try { return verifyDeploymentSnapshot(this.#manifest, snapshot ?? await this.#solana.snapshot(this.#manifest)); }
    catch (error) { if (error?.integrityCode && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("DEPOSIT_DEPLOYMENT_CHANGED"); throw error; }
  }
  async submit(request) {
    this.#active();
    const r = await this.#observer.verifyNotification(validateNativeDepositRequest(request, this.#policy));
    this.#active();
    this.#ledger.watchServiceDeposit(r, this.#policy);
    return { operationId: r.operationId, state: "OBSERVED", reason: "MATCHING_OUTPUT_AWAITS_VERIFIED_FINALITY" };
  }
  async observe({ limit = 16 } = {}) {
    this.#active(); const operations = [];
    check(Number.isInteger(limit) && limit > 0 && limit <= 100);
    const requests = this.#ledger.serviceDepositRequests();
    const selected = Array.from({ length: Math.min(limit, requests.length) }, (_, i) => requests[(this.#observationCursor + i) % requests.length]);
    this.#observationCursor = requests.length ? (this.#observationCursor + selected.length) % requests.length : 0;
    for (const request of selected) {
      try {
        const plan = await this.#observer.observe(request); this.#active();
        this.#ledger.registerServiceDeposit(plan, this.#policy);
        this.#ledger.updateServiceDeposit(plan.operationId, "VALIDATED", plan.acceptedCheckpoint.evidenceDigestHex);
        operations.push({ operationId: plan.operationId, state: "VALIDATED" });
      } catch { operations.push({ operationId: request.operationId, state: "WAITING_FOR_DEPENDENCY" }); }
    }
    return operations;
  }
  async #known(raw) {
    const txid = parseNativeTransactionHex(raw).txidHex;
    try { const observed = await this.#rpc.getRawTransaction(txid, false);
      if (observed !== raw) { this.#ledger.hardStop("CONFLICTING_NATIVE_SWEEP"); throw new Error("DepositServiceBroadcastConflict"); } return true;
    } catch (error) { if (error.message === "NativeRpcRejected:getrawtransaction:-5") return false; throw error; }
  }
  async catchUp() {
    const results = [];
    for (const r of this.#ledger.serviceDeposits({ pendingOnly: true, registeredOnly: true })) {
      try { results.push(await this.run(r.operationId, { readOnly: true })); }
      catch { results.push({ operationId: r.operationId, state: "WAITING_FOR_DEPENDENCY" }); }
    }
    return results;
  }
  async #retainMint(id, credit, signature) {
    const p = this.#policy, m = decodeCanonicalBridgeMessage(credit.encodedMessageHex);
    const observed = await this.#claimObserver.observeProtectedFinalizedDepositClaim({ solanaSignature: signature,
      operationIdHex: m.operationIdHex, messageDigestHex: m.messageDigestHex, mintAccountBase58: this.#manifest.mint.id,
      depositClaimAccountBase58: findProgramAddress([Buffer.from(DEPOSIT_CLAIM_PDA_SEED_PREFIX), Buffer.from(m.operationIdHex, "hex")], base58Decode(this.#manifest.manager.id)).base58 }, p.solanaGenesis);
    this.#ledger.updateServiceDeposit(id, "MINTED", { signature, slot: observed.slot, rootSlot: observed.rootSlot, genesis: observed.genesis,
      operationId: m.operationIdHex, messageDigest: m.messageDigestHex, amountAtomic: m.amountAtomic.toString(), recipientHex: m.destinationHex, mint: p.mint });
    this.#ledger.recordMint({ ...credit, mintedAmountAtomic: m.amountAtomic.toString() });
    this.#ledger.settleEconomicOperation("MINT", id);
  }
  async run(id, { readOnly = false } = {}) {
    check(typeof readOnly === "boolean");
    check(!this.#busy, "DepositServiceBusy"); this.#busy = true;
    try {
      let r = this.#ledger.serviceDeposit(id); check(r, "DepositServiceOperationMissing");
      const plan = r.operation.plan, p = this.#policy, read = () => this.#ledger.serviceDeposit(id);
      const save = (action, value) => { this.#ledger.updateServiceDeposit(id, action, value); r = read(); };
      const result = state => ({ operationId: id, state, txid: parseNativeTransactionHex(plan.unsignedTransactionHex).txidHex });
      if (r.completed !== null) return { ...result("COMPLETED"), replay: true };
      if (!readOnly) this.#active(); await this.#deployment();
      if (r.operation.mintReceipt !== null) {
        this.#ledger.recordMint({ ...r.operation.finalizedCredit, mintedAmountAtomic: plan.depositIntent.amountAtomic });
        this.#ledger.settleEconomicOperation("MINT", id); return result("MINTED");
      }
      if (r.operation.finalizedCredit !== null) {
        const credit = r.operation.finalizedCredit, m = decodeCanonicalBridgeMessage(credit.encodedMessageHex);
        const entry = this.#ledger.solanaServiceJournal("CLAIM").get(m.operationIdHex);
        if (entry) {
          const signature = base58Encode(Buffer.from(entry.prepared.preparedTransactionBase64, "base64").subarray(1, 65));
          const status = await this.#claimRpc.getSignatureStatus(signature);
          if (status?.confirmationStatus === "finalized" && status.err === null) {
            await this.#retainMint(id, credit, signature); return result("MINTED");
          }
        }
      }
      if (readOnly && (!r.operation.broadcastAttempted || !await this.#known(r.operation.signedTransactionHex))) return result("WAITING_FOR_DEPENDENCY");
      if (!r.validated) {
        const evidence = await this.#native.verifyInputs({ inputs: plan.inputs, minimumConfirmations: p.minimumConfirmations, acceptedCheckpoint: plan.acceptedCheckpoint });
        this.#active(); save("VALIDATED", evidence.digestHex);
      }
      if (r.operation.signedTransactionHex === null) {
        const verify = async intent => { this.#active(); await this.#deployment(); return verifyServiceDepositSigning({ plan, policy: p, nativeVerifier: this.#native, intent }); };
        const coordinator = await this.#coordinator({ plan, intents: plan.signingIntents, verify });
        check(coordinator instanceof NativeFrostCoordinator, "DepositServiceFrostRequired");
        coordinator.useLocalOperationJournal(this.#ledger);
        const signatures = [];
        for (const intent of plan.signingIntents) { this.#active(); const signed = await coordinator.signAutomaticallyWithNativeEvidence(intent);
          check(signed.state === "SIGNED" && signed.messageHex === intent.taprootSighashHex, "DepositServiceFrostIncomplete"); signatures.push(signed.signatureHex); }
        const signed = attachTaprootWitnesses({ unsignedNativeTransactionHex: plan.unsignedTransactionHex, signatures,
          spentOutputs: plan.inputs.map(i => ({ amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex })), tapscriptSpends: tapscripts(plan) });
        this.#active(); save("SIGNED", signed.rawSignedTransactionHex); // Validates the aggregate before any broadcast.
      }
      if (!r.operation.broadcastAccepted || (!readOnly && !await this.#known(r.operation.signedTransactionHex))) {
        const raw = r.operation.signedTransactionHex;
        if (!await this.#known(raw)) {
          if (readOnly) return result("WAITING_FOR_DEPENDENCY");
          const current = await verifyServiceDepositSigning({ plan, policy: p, nativeVerifier: this.#native, intent: plan.signingIntents[0] });
          const source = await this.#rpc.getSourceSnapshot({ expectedNetwork: "regtest", expectedGenesisHash: p.nativeGenesis });
          check(source.state === "READY" && source.bestHash === current.currentTipHash, "DepositServiceNativeSourceChanged");
          this.#active(); save("BROADCAST", true);
          const sent = await this.#rpc.sendRawTransaction(raw);
          if (sent !== parseNativeTransactionHex(raw).txidHex) { this.#ledger.hardStop("CONFLICTING_NATIVE_SWEEP"); throw new Error("DepositServiceBroadcastConflict"); }
        } else if (!r.operation.broadcastAttempted) save("BROADCAST", true);
        if (!await this.#known(raw)) return result("WAITING_FOR_DEPENDENCY");
        if (!readOnly) this.#active(); save("ACCEPTED", true);
      }
      const tx = await this.#rpc.getRawTransaction(parseNativeTransactionHex(plan.unsignedTransactionHex).txidHex, true);
      if (!Number.isSafeInteger(tx.confirmations) || tx.confirmations < p.minimumConfirmations) return result("WAITING_FOR_FINALITY");
      const retained = r.operation.finalizedCredit;
      const receipt = await this.#native.verifyReserve(nativeReserveCreditEvidenceInput(plan, p, retained?.acceptedCheckpoint));
      const message = retained && decodeCanonicalBridgeMessage(retained.encodedMessageHex), now = BigInt(Math.floor(Date.now() / 1000));
      const credit = createVerifiedNativeReserveCredit({ plan, policy: p, receipt, validityWindow: {
        validFrom: String(message ? message.validFrom : now), validUntil: String(message ? message.validUntil : now + 86400n) } });
      if (retained) check(credit.encodedMessageHex === retained.encodedMessageHex && credit.reserveAllocationIdHex === retained.reserveAllocationIdHex, "DepositServiceCreditChanged");
      else { if (!readOnly) this.#active(); save("CREDIT", credit); }
      const persisted = r.operation.finalizedCredit, m = decodeCanonicalBridgeMessage(persisted.encodedMessageHex);
      // Catch up after any interrupted credit/reserve append BEFORE processing
      // another direction or reconciling. The signed operation was retained first.
      this.#ledger.recordValidatedDeposit(persisted);
      if (!this.#ledger.hasCanonicalDepositReserve(m.operationIdHex)) this.#ledger.recordCanonicalReserve(receipt, m.operationIdHex);
      if (readOnly) return result("SWEPT"); // Recover liabilities without creating attestations or sending packets.
      if (now > m.validUntil) {
        // Expiry is NOT permission to extend attestations/change the canonical
        // operation ID. Preserve the backing/liability for explicit review.
        this.#ledger.pause("DEPOSIT_CREDIT_EXPIRED"); return result("PAUSED");
      }
      // Persist the allowance before releasing attestations capable of minting.
      this.#ledger.authorizeEconomicOperation("MINT", id);
      for (let i = r.attestations.length; i < 2; i++) {
        const verified = await createRawNativeCreditAttestationVerifier({ policy: p, nativeVerifier: this.#native })({ encodedMessageHex: persisted.encodedMessageHex,
          rawEvidence: { plan, acceptedCheckpoint: persisted.acceptedCheckpoint } });
        this.#active(); save("ATTESTED", this.#attesters[i].signDepositCredit({ ...verified, encodedMessageHex: persisted.encodedMessageHex }));
      }
      const combinedAttestation = combineProjectAttestations({ attestations: r.attestations, encodedMessageHex: persisted.encodedMessageHex,
        authorizedAttesterPublicKeys: this.#attesters.map(a => a.publicKeyHex) });
      this.#active(); await this.#deployment();
      const claim = await this.#claim.submitDepositClaim({ encodedMessageHex: persisted.encodedMessageHex, attestations: r.attestations, combinedAttestation });
      if (claim.state !== "COMPLETED") {
        if (["REJECTED", "HARD_STOP"].includes(claim.state)) this.#ledger.hardStop("DEPOSIT_CLAIM_REJECTED");
        return result(claim.state);
      }
      await this.#retainMint(id, persisted, claim.solanaSignature); return result("MINTED");
    } catch (error) {
      if ((error?.integrityCode || error?.message === "DepositServiceCreditChanged") && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("DEPOSIT_INTEGRITY_CONTRADICTION");
      throw error;
    } finally { this.#busy = false; }
  }
}
