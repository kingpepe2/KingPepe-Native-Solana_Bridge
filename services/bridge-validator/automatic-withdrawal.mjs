// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit localnet/regtest implementation. No mainnet activation or signing bypass.
import { AuthenticatedLocalDepositLedger } from "./local-deposit-ledger.mjs";
import { FinalizedWithdrawalReader, requireFinalizedWithdrawal } from "../solana-observer/finalized-withdrawal.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot } from "../solana-observer/deployment-integrity.mjs";
import { NativeRpcClient, normalizeEndpoint } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { createWithdrawalPlan, validateWithdrawalPlan, withdrawalSigningIntents, validateSignedWithdrawal } from "../../native/reserve/withdrawal-plan.mjs";
import { attachKeyPathTaprootWitnesses, parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { NativeFrostCoordinator } from "../../native/frost/index.mjs";
import { canonicalJson, canonicalUintDecimal, sha256Canonical } from "../../native/frost/policy/native-signing-policy.mjs";
const check = (v, code) => { if (!v) throw new Error(code); };

// Called independently by A and B. The coordinator's receipt is not enough:
// both configured chain readers re-observe the withdrawal and exact UTXOs.
export async function verifyWithdrawalSigning({ plan, intent, reader, nativeVerifier }) {
  check(reader instanceof FinalizedWithdrawalReader && nativeVerifier instanceof LocalNativeEvidenceVerifier, "WithdrawalVerifiersRequired");
  const p = validateWithdrawalPlan(plan), fresh = await reader.read(p.solanaSignature, p.encodedMessageHex);
  requireFinalizedWithdrawal(fresh);
  check(fresh.evidenceDigest === p.withdrawalEvidenceDigest, "WithdrawalEvidenceChanged");
  const expected = withdrawalSigningIntents(p)[intent.signingInputIndex];
  check(expected && canonicalJson(intent) === canonicalJson(expected), "WithdrawalSigningIntentChanged");
  const native = await nativeVerifier.verifyInputs({ inputs: p.inputs, minimumConfirmations: p.minimumConfirmations, acceptedCheckpoint: p.acceptedCheckpoint });
  const digestHex = sha256Canonical({ withdrawal: fresh.evidenceDigest, native: native.digestHex });
  check(digestHex === intent.proofFingerprint, "WithdrawalProofChanged");
  return Object.freeze({ digestHex, currentTipHash: native.currentTipHash });
}

export function compareWithdrawalAccounting(journal, observed) {
  const amount = value => { check(typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/u.test(value) && BigInt(value) <= (1n << 128n) - 1n, "WithdrawalAccountingAmountRejected"); return BigInt(value); };
  const n = key => amount(journal[key]);
  const reserve = n("canonicalReserveAtomic"), issued = n("bridgeIssuedOutstandingAtomic"), pending = n("pendingMintAtomic"), unpaid = n("pendingWithdrawalAtomic");
  const supply = BigInt(canonicalUintDecimal(observed.supply, "supply")), manager = amount(observed.managerIssued);
  const burnCounter = amount(observed.recordedBurns);
  // New finalized user requests may not have reached this worker yet. That is
  // incomplete observation, not free reserve and not a fabricated deficit.
  if (burnCounter > n("burnedRecordedAtomic")) return { state: "WAITING_FOR_DEPENDENCY", reason: "UNOBSERVED_WITHDRAWALS" };
  if (amount(observed.reserve) !== reserve || reserve !== issued + pending + unpaid || manager !== issued ||
      supply > manager || burnCounter !== n("burnedRecordedAtomic")) return { state: "PAUSED", reason: "ACCOUNTING_CONTRADICTION" };
  return { state: "MATCH", reserveAtomic: reserve.toString(), supplyAtomic: supply.toString(), pendingWithdrawalAtomic: unpaid.toString(),
    directBurnDifferenceAtomic: (manager - supply).toString(), finalizedPayoutAtomic: n("finalizedPayoutAtomic").toString() };
}

export class AutomaticSolanaToNativeWithdrawal {
  #ledger; #reader; #verifier; #rpc; #solana; #manifest; #createCoordinator; #reserve; #minimum; #maxFee; #maxAmount; #busy = false;
  constructor({ environment, ledger, reader, nativeVerifier, nativeRpc, solanaRpc, manifest, createCoordinator, reserveScriptHex, minimumConfirmations, maxFeeAtomic, maxAmountAtomic }) {
    check(environment === "localnet" && ledger instanceof AuthenticatedLocalDepositLedger && reader instanceof FinalizedWithdrawalReader &&
      nativeVerifier instanceof LocalNativeEvidenceVerifier && nativeRpc instanceof NativeRpcClient && solanaRpc instanceof LocalDeploymentRpc && typeof createCoordinator === "function", "LocalWithdrawalRuntimeRequired");
    this.#manifest = validateDeploymentManifest(manifest);
    normalizeEndpoint(nativeRpc.endpointForReport(), { localOnly: true });
    check(/^5120[0-9a-f]{64}$/u.test(reserveScriptHex) && Number.isInteger(minimumConfirmations) && minimumConfirmations >= 1 && minimumConfirmations <= 1000, "WithdrawalPolicyRejected");
    this.#maxFee = BigInt(canonicalUintDecimal(maxFeeAtomic, "max fee")); this.#maxAmount = BigInt(canonicalUintDecimal(maxAmountAtomic, "max amount"));
    this.#ledger = ledger; this.#reader = reader; this.#verifier = nativeVerifier; this.#rpc = nativeRpc; this.#solana = solanaRpc;
    this.#createCoordinator = createCoordinator; this.#reserve = reserveScriptHex; this.#minimum = minimumConfirmations;
  }
  #active() { check(this.#ledger.status().state !== "HARD_STOP", "WithdrawalBridgePaused"); }
  assertLedger(ledger) { check(ledger === this.#ledger, "WithdrawalServiceLedgerMismatch"); }
  async observe() {
    this.#active();
    try {
      const receipts = await this.#reader.discover(this.#ledger.knownWithdrawalIds());
      for (const receipt of receipts) { this.#active(); this.#ledger.enqueueConfirmedWithdrawal(receipt); }
      return { state: "OBSERVED", added: receipts.length };
    } catch (error) {
      if (["SOLANA_DEPLOYMENT_CHANGED", "SOLANA_GENESIS_CHANGED", "FINALIZED_SOLANA_CONFLICT"].includes(error?.integrityCode) && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("WITHDRAWAL_DEPLOYMENT_CHANGED");
      throw error;
    }
  }
  async enqueue(signature) {
    const observation = await this.#reader.read(signature); this.#active();
    this.#ledger.enqueueConfirmedWithdrawal(observation);
    return { state: "FINALIZED_ON_SOLANA", operationId: observation.operationId };
  }
  async #known(raw) {
    const txid = parseNativeTransactionHex(raw).txidHex;
    try {
      const value = await this.#rpc.getRawTransaction(txid, false);
      if (value !== raw) { this.#ledger.hardStop("CONFLICTING_NATIVE_PAYOUT"); throw new Error("WithdrawalBroadcastConflict"); }
      return true;
    } catch (error) { if (error?.message === "NativeRpcRejected:getrawtransaction:-5") return false; throw error; }
  }
  async reconcile() {
    const inputs = this.#ledger.accountedReserveInputs();
    const before = await this.#verifier.observeChain();
    const affected = this.#ledger.acceptedNativeBases().filter(b => b.blocks.some(block => before.headerHashes[block.height] !== block.blockHash));
    if (affected.length) {
      if (affected.some(b => BigInt("0x" + before.chainworkHex) <= BigInt("0x" + b.chainworkHex))) return { state: "WAITING_FOR_DEPENDENCY", reason: "NATIVE_CHAIN_CHOICE_UNRESOLVED" };
      if (this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("ACCEPTED_NATIVE_OPERATION_REORG");
      // Original accepted facts remain in the journal. No automatic repair,
      // new credit, remint or second payout after an accepted-chain conflict.
      return { state: "PAUSED", reason: "ACCEPTED_NATIVE_OPERATION_REORG", affectedOperations: affected.map(b => b.operationId) };
    }
    if (inputs.length) {
      try { await this.#verifier.verifyInputs({ inputs, minimumConfirmations: this.#minimum }); }
      catch (error) {
        if (error?.message !== "RAW_NATIVE_INPUT_NOT_AVAILABLE") throw error;
        // A recorded in-flight payout legitimately spends locked inputs. It
        // remains an unpaid liability until verified finality, not a deficit.
        const pending = this.#ledger.pendingSignedWithdrawals();
        let contradiction = false;
        for (const input of inputs) {
          const utxo = await this.#rpc.getUtxoObservation({ txid: input.txid, vout: input.vout, decimals: 8, includeMempool: false });
          if (utxo.unspent) continue;
          let explained = false;
          for (const r of pending) if (r.plan.inputs.some(i => i.txid === input.txid && i.vout === input.vout) && await this.#known(r.signedTransactionHex)) explained = true;
          if (!explained) contradiction = true;
        }
        check((await this.#verifier.observeChain()).tipHash === before.tipHash, "WithdrawalReconciliationSourceChanged");
        if (contradiction && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("UNEXPLAINED_CANONICAL_RESERVE_SPEND");
        return { state: contradiction ? "PAUSED" : "WAITING_FOR_DEPENDENCY", reason: contradiction ? "UNEXPLAINED_CANONICAL_RESERVE_SPEND" : "NATIVE_SETTLEMENT_PENDING" };
      }
    }
    let snapshot;
    try { snapshot = verifyDeploymentSnapshot(this.#manifest, await this.#solana.snapshot(this.#manifest)); }
    catch (error) {
      if (["SOLANA_DEPLOYMENT_CHANGED", "SOLANA_GENESIS_CHANGED", "FINALIZED_SOLANA_CONFLICT"].includes(error?.integrityCode) && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("WITHDRAWAL_DEPLOYMENT_CHANGED");
      throw error;
    }
    const after = await this.#verifier.observeChain();
    check(before.tipHash === after.tipHash, "WithdrawalReconciliationSourceChanged");
    const report = compareWithdrawalAccounting(this.#ledger.bridgeSnapshot(), { reserve: inputs.reduce((n, i) => n + BigInt(i.amountAtomic), 0n).toString(),
      supply: snapshot.mintSupplyAtomic, managerIssued: snapshot.managerMintedAtomic, recordedBurns: snapshot.burnedUnpaidAtomic });
    if (report.state === "PAUSED" && this.#ledger.status().state !== "HARD_STOP") this.#ledger.hardStop("WITHDRAWAL_ACCOUNTING_CONTRADICTION");
    return report;
  }
  async run(signature) {
    check(!this.#busy, "WithdrawalWorkerBusy"); this.#busy = true;
    try {
      const observation = await this.#reader.read(signature); requireFinalizedWithdrawal(observation);
      const id = observation.operationId;
      let record = this.#ledger.withdrawal(id);
      if (record?.state === "COMPLETED") return { state: "COMPLETED", operationId: id, txid: record.payment.txid, replay: true };
      this.#active();
      this.#ledger.enqueueConfirmedWithdrawal(observation); // Retain the liability even when no input is presently available.
      if (!record) {
        check(BigInt(observation.grossAtomic) <= this.#maxAmount && BigInt(observation.feeAtomic) <= this.#maxFee, "WithdrawalQueuedByLimit");
        const inputs = []; let total = 0n;
        for (const input of this.#ledger.availableReserveInputs()) {
          if (input.scriptPubKeyHex !== this.#reserve) continue;
          inputs.push(input); total += BigInt(input.amountAtomic);
          if (total >= BigInt(observation.grossAtomic)) break;
          if (inputs.length === 8) break;
        }
        check(inputs.length > 0 && total >= BigInt(observation.grossAtomic), "WithdrawalReserveUnavailable");
        const evidence = await this.#verifier.verifyInputs({ inputs, minimumConfirmations: this.#minimum });
        this.#active();
        const plan = createWithdrawalPlan({ encodedMessageHex: observation.encodedMessageHex, solanaSignature: signature, withdrawalEvidenceDigest: observation.evidenceDigest,
          inputs, reserveScriptHex: this.#reserve, acceptedCheckpoint: evidence.acceptedCheckpoint, minimumConfirmations: this.#minimum });
        record = this.#ledger.reserveWithdrawal(plan, observation); // Persist input locks before nonce creation.
      }
      check(record.plan.solanaSignature === signature && record.plan.encodedMessageHex === observation.encodedMessageHex && record.plan.withdrawalEvidenceDigest === observation.evidenceDigest, "WithdrawalOperationChanged");
      if (record.state === "FINALIZED_ON_SOLANA") {
        const intents = withdrawalSigningIntents(record.plan);
        const coordinator = await this.#createCoordinator({ plan: record.plan, intents, verify: intent => {
          this.#active(); return verifyWithdrawalSigning({ plan: record.plan, intent, reader: this.#reader, nativeVerifier: this.#verifier });
        } });
        check(coordinator instanceof NativeFrostCoordinator, "WithdrawalFrostCoordinatorRequired");
        const signatures = [];
        for (const intent of intents) {
          this.#active(); const result = await coordinator.signAutomaticallyWithNativeEvidence(intent);
          check(result.state === "SIGNED" && result.messageHex === intent.taprootSighashHex, "WithdrawalFrostIncomplete"); signatures.push(result.signatureHex);
        }
        const signed = attachKeyPathTaprootWitnesses({ unsignedNativeTransactionHex: record.plan.unsignedTransactionHex, signatures });
        validateSignedWithdrawal(record.plan, signed.rawSignedTransactionHex); this.#active();
        this.#ledger.recordWithdrawalSigned(id, signed.rawSignedTransactionHex); record = this.#ledger.withdrawal(id);
      }
      if (["SIGNED", "BROADCAST"].includes(record.state)) {
        let known = await this.#known(record.signedTransactionHex);
        if (!known) {
          // Refresh deployment/withdrawal + exact live UTXOs before any retry.
          const evidence = await verifyWithdrawalSigning({ plan: record.plan, intent: withdrawalSigningIntents(record.plan)[0], reader: this.#reader, nativeVerifier: this.#verifier });
          this.#active(); this.#ledger.recordWithdrawalBroadcast(id); // BEFORE sending, including attempts whose response is lost.
          const source = await this.#rpc.getSourceSnapshot({ expectedNetwork: "regtest", expectedGenesisHash: record.plan.acceptedCheckpoint.genesis });
          check(source.state === "READY" && source.bestHash === evidence.currentTipHash, "WithdrawalBroadcastSourceChanged");
          this.#active();
          const txid = await this.#rpc.sendRawTransaction(record.signedTransactionHex);
          if (txid !== parseNativeTransactionHex(record.signedTransactionHex).txidHex) { this.#ledger.hardStop("CONFLICTING_NATIVE_PAYOUT"); throw new Error("WithdrawalBroadcastConflict"); }
          known = await this.#known(record.signedTransactionHex);
        }
        if (!known) return { state: "WAITING_FOR_DEPENDENCY", operationId: id };
        const native = await this.#rpc.getRawTransaction(parseNativeTransactionHex(record.signedTransactionHex).txidHex, true);
        if (!Number.isSafeInteger(native.confirmations) || native.confirmations < this.#minimum) return { state: "BROADCAST", operationId: id, txid: parseNativeTransactionHex(record.signedTransactionHex).txidHex };
        const receipt = await this.#verifier.verifyFinalizedPayout({ inputs: record.plan.inputs, unsignedTransactionHex: record.plan.unsignedTransactionHex,
          signedTransactionHex: record.signedTransactionHex, minimumConfirmations: this.#minimum, reserveScriptHex: this.#reserve });
        this.#active(); this.#ledger.recordWithdrawalPaid(id, receipt);
      }
      const accounting = await this.reconcile();
      if (accounting.state !== "MATCH") return { state: accounting.state, operationId: id, accounting };
      this.#active(); this.#ledger.completeWithdrawal(id, sha256Canonical(accounting));
      return { state: "COMPLETED", operationId: id, txid: this.#ledger.withdrawal(id).payment.txid, accounting };
    } catch (error) {
      if (["SOLANA_DEPLOYMENT_CHANGED", "SOLANA_GENESIS_CHANGED", "FINALIZED_SOLANA_CONFLICT"].includes(error?.integrityCode)) this.#ledger.hardStop("WITHDRAWAL_DEPLOYMENT_CHANGED");
      if (["RAW_NATIVE_ACCEPTANCE_CHECKPOINT_REJECTED", "RAW_NATIVE_ACCEPTANCE_DIGEST_CHANGED"].includes(error?.message)) this.#ledger.hardStop("WITHDRAWAL_ACCEPTED_CHAIN_CHANGED");
      throw error;
    } finally { this.#busy = false; }
  }
}
