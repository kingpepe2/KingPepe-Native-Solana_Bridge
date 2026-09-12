// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// LOCALNET-only protected service composition. No private share/key, production
// enablement, approval queue, replacement Native inputs or economic repair.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { attachTaprootWitnesses } from "../../native/node/native-taproot-transaction.mjs";
import { requireSweepJobClient } from "../../native/frost/coordinator/sweep-job-ipc.mjs";
import { requireNativeSweepClient } from "../relayer/native-sweep-ipc.mjs";
import { requireSolanaDepositClient } from "../relayer/solana-deposit-ipc.mjs";
import { requireDepositAttesterClient } from "../attesters/protected-client.mjs";
import { requireDepositFeePayerClient } from "./deposit-fee-payer-ipc.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { requireDepositOperationJournal } from "./protected-deposit-journal.mjs";
import { recoverNativeReserveCredit } from "./native-reserve-credit.mjs";
import { readDepositReconciliation } from "../reconciliation/deposit-reconciliation.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot } from "../solana-observer/deployment-integrity.mjs";
import { SolanaLocalRpcClient } from "./solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimObserver } from "../solana-observer/solana-deposit-claim-observer.mjs";
import { validateSolanaDepositDelivery, deliveryUint, MAX_SOLANA_REBUILDS } from "../relayer/solana-deposit-delivery.mjs";
import { MAX_DEPOSIT_OPERATIONS, validateDepositOperationPlan } from "./deposit-operation-state.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { validateDepositControllerPolicy, depositControllerPolicyDigest, decodeDepositControllerState,
  newDepositControllerRecord, controllerAttestationRequest } from "./deposit-controller-state.mjs";
const INSTANCES = new WeakSet(), HASH = /^[0-9a-f]{64}$/u;
const check = (v, code = "DepositControllerUnavailable") => { if (!v) throw new Error(code); };
const digest = b => createHash("sha256").update(b).digest("hex"), same = (a, b) => canonicalJson(a) === canonicalJson(b);
const result = (operationId, state, reason) => Object.freeze({ operationId, state, reason });
export class ProtectedDepositController {
  #store; #guard; #policy; #journal; #native; #jobs; #nativeOutbox; #attesters; #payer; #solanaOutbox;
  #chain; #rpc; #observer; #lease; #revision; #pending; #closed = false; #stopped = false; #busy = false; #notify;
  static async open({ store, integrity, policy, journal, nativeVerifier, jobs, nativeOutbox, attesters, feePayer, solanaOutbox, endpoint, onTransition = async () => {} }) {
    const p = validateDepositControllerPolicy(policy), op = p.deliveryPolicy.operationPolicy;
    assertWindowsProtectedStore(store, "BRIDGE_VALIDATOR", "deposit-controller"); requireIntegrityGuard(integrity, "BRIDGE_VALIDATOR");
    requireDepositOperationJournal(journal, op, integrity); requireSweepJobClient(jobs, op); requireNativeSweepClient(nativeOutbox, op);
    requireSolanaDepositClient(solanaOutbox, p.deliveryPolicy); requireDepositFeePayerClient(feePayer, p.deliveryPolicy);
    check(Array.isArray(attesters) && attesters.length === 2);
    attesters.forEach((v, i) => requireDepositAttesterClient(v, p.deliveryPolicy, ["ATTESTER_A", "ATTESTER_B"][i]));
    check(nativeVerifier instanceof LocalNativeEvidenceVerifier && typeof onTransition === "function");
    const domain = { environment: op.environment, nativeGenesis: op.nativeGenesis, solanaDeployment: op.solanaDeployment, keyEpoch: op.keyEpoch };
    integrity.assertDeployment(domain); check(Object.entries(domain).every(([k, v]) => store.context[k] === v));
    const self = new ProtectedDepositController();
    self.#store = store; self.#guard = integrity; self.#policy = p; self.#journal = journal; self.#native = nativeVerifier;
    self.#jobs = jobs; self.#nativeOutbox = nativeOutbox; self.#attesters = [...attesters]; self.#payer = feePayer; self.#solanaOutbox = solanaOutbox; self.#notify = onTransition;
    // These concrete transports all address the same strict LOCAL endpoint.
    self.#chain = new LocalDeploymentRpc({ endpoint }); self.#rpc = new SolanaLocalRpcClient({ endpoint });
    self.#observer = new SolanaDepositClaimObserver({ endpoint, config: { environment: "localnet", cluster: "localnet",
      managerProgramIdHex: op.managerProgramId, transceiverProgramIdHex: op.transceiverProgramId, mintHex: op.mint, nativeDecimals: 8 } });
    try { self.#lease = await store.acquireLifetimeLease(); self.#read(); INSTANCES.add(self); return self; }
    catch (error) { try { await self.#report(error); } finally { await self.close(); } throw new Error("DepositControllerUnavailable"); }
  }
  assertBinding(policy, integrity) {
    check(!this.#closed && !this.#stopped && integrity === this.#guard && depositControllerPolicyDigest(policy) === depositControllerPolicyDigest(this.#policy));
    this.#lease.assertHeld();
  }
  #read() {
    check(!this.#closed && !this.#stopped); this.#lease.assertHeld(); const r = this.#store.read();
    try {
      const state = decodeDepositControllerState(r.payload, this.#policy);
      if (this.#revision !== undefined && r.revision !== this.#revision) check(this.#pending &&
        BigInt(r.revision) === BigInt(this.#revision) + 1n && digest(r.payload) === this.#pending);
      this.#revision = r.revision; this.#pending = undefined; return { state, revision: r.revision };
    } catch { const e = new Error("DepositControllerAuthenticatedStateInvalid"); e.evidenceDigest = digest(r.payload); throw e; }
    finally { r.payload.fill(0); }
  }
  #write(state, revision) {
    state.lastTimeMs = Date.now(); const b = Buffer.from(JSON.stringify(state));
    try { decodeDepositControllerState(b, this.#policy); this.#lease.assertHeld(); this.#pending = digest(b);
      this.#revision = this.#store.write(b, revision).revision; this.#pending = undefined; }
    finally { b.fill(0); }
  }
  async #report(error) {
    const confirmed = ["ProtectedStateRollbackDetected", "ProtectedLifetimeLeaseLost", "DepositControllerAuthenticatedStateInvalid",
      "DepositControllerJournalConflict", "DepositControllerCreditChanged", "DepositControllerMintMissing"].includes(error?.message) ||
      !!error?.incident || !!error?.integrityCode;
    if (!confirmed) return; this.#stopped = true;
    await this.#guard.report(depositControllerPolicyDigest(this.#policy), "IMPOSSIBLE_OPERATION_STATE",
      error.evidenceDigest ?? error.incident?.evidenceDigest ?? digest(String(error.integrityCode ?? error.message)));
  }
  async #exclusive(fn) {
    this.assertBinding(this.#policy, this.#guard); check(!this.#busy, "DepositControllerBusy"); this.#busy = true;
    try { return await fn(); } catch (error) {
      try { if (this.#pending) this.#read(); } catch (e) { await this.#report(e); throw e; }
      await this.#report(error); throw error;
    } finally { this.#busy = false; }
  }
  #record(state, id) { check(typeof id === "string" && HASH.test(id)); const r = state.records.find(x => x.plan.operationId === id); check(r, "DepositControllerOperationMissing"); return r; }
  #mutate(id, change) { const { state, revision } = this.#read(), r = this.#record(state, id); change(r); this.#write(state, revision); return structuredClone(r); }
  async #transition(id, stage) { await this.#notify(Object.freeze({ operationId: id, stage })); }
  async submit(input) {
    const plan = validateDepositOperationPlan(input, this.#policy.deliveryPolicy.operationPolicy);
    return this.#exclusive(async () => {
      const { state, revision } = this.#read(), old = state.records.find(x => x.plan.operationId === plan.operationId);
      if (old) check(same(old.plan, plan), "DepositControllerPlanChanged");
      else { check(state.records.length < MAX_DEPOSIT_OPERATIONS, "DepositControllerCapacity"); state.records.push(newDepositControllerRecord(plan, this.#policy)); this.#write(state, revision);
        await this.#transition(plan.operationId, "DEPOSIT_OBSERVED"); }
      return result(plan.operationId, "OBSERVED", "DURABLE_INTENT_ONLY_NOT_CHAIN_AUTHORIZATION");
    });
  }
  async inspect(id) { return this.#exclusive(async () => ({ record: structuredClone(this.#record(this.#read().state, id)), integrity: await this.#guard.status(id) })); }
  async advance(id) { return this.#exclusive(() => this.#advance(id)); }
  async #advance(id) {
    let r = this.#record(this.#read().state, id), book;
    const dp = this.#policy.deliveryPolicy, op = dp.operationPolicy;
    const snapshot = await this.#journal.snapshot(); book = snapshot.operations.find(x => x.plan.operationId === id);
    if (book) check(same(book.plan, r.plan), "DepositControllerJournalConflict");
    // Recover already-created liabilities before asking for NEW economic
    // authorization. No signing/broadcast occurs in this branch, even if stopped.
    if (book?.broadcastAttempted && !book.broadcastAccepted) {
      // Resolve an ACK lost between the durable relayer and economic journal.
      // Status is read-only and remains usable during temporary source pause.
      const status = await this.#nativeOutbox.status({ plan: book.plan, signedTransactionHex: book.signedTransactionHex });
      if (status?.state === "BROADCAST_OBSERVED") {
        await this.#journal.recordBroadcastAccepted(id, status.txid);
        await this.#transition(id, "NATIVE_BROADCAST_ACCEPTED"); book = await this.#journal.inspect(id);
      }
    }
    if (book?.broadcastAccepted && book.finalizedCredit === null) {
      if (r.creditWindow === null) {
        const from = BigInt(Math.floor(Date.now() / 1000));
        r = this.#mutate(id, x => { x.creditWindow = { validFrom: String(from), validUntil: String(from + BigInt(this.#policy.creditValiditySeconds)) }; });
      }
      await recoverNativeReserveCredit({ journal: this.#journal, integrity: this.#guard, policy: op, nativeVerifier: this.#native,
        operationId: id, validityWindow: r.creditWindow });
      await this.#transition(id, "NATIVE_FINALIZED_CREDIT_RETAINED"); book = await this.#journal.inspect(id);
    }
    if (book?.finalizedCredit !== null && book?.finalizedCredit !== undefined) {
      if (r.credit === null) r = this.#mutate(id, x => { x.credit = structuredClone(book.finalizedCredit); });
      else check(same(r.credit, book.finalizedCredit), "DepositControllerCreditChanged");
    }
    const global = await this.#guard.status(id);
    if (global.state === "HARD_STOP_INTEGRITY") return result(id, "HARD_STOP", "HARD_STOP_INTEGRITY");
    if (r.completed !== null) { check(book?.mintReceipt !== null && book?.mintReceipt !== undefined, "DepositControllerMintMissing");
      return result(id, "COMPLETED", "ALL_REQUIRED_CHECKS_PASSED"); }
    // A finalized claim can be caught up while source admission is temporarily
    // paused; observing/retaining an existing mint is not NEW mint authorization.
    if (book?.finalizedCredit && book.mintReceipt === null) {
      for (const packet of r.packets.filter(x => x.intent.kind === "CLAIM" && x.delivery !== null)) {
        const status = await this.#solanaOutbox.status(packet.delivery);
        if (status.state === "FINALIZED_ACCOUNT") {
          const v = validateSolanaDepositDelivery(packet.delivery, dp);
          const observed = await this.#observer.observeProtectedFinalizedDepositClaim({ solanaSignature: v.signature,
            operationIdHex: v.message.operationIdHex, messageDigestHex: v.message.messageDigestHex,
            depositClaimAccountBase58: v.claimAddress, mintAccountBase58: dp.manifest.mint.id }, op.solanaGenesis);
          await this.#journal.retainFinalizedMint(id, observed); await this.#transition(id, "MINT_FINALIZED_RETAINED"); book = await this.#journal.inspect(id); break;
        }
      }
    }
    if (book?.mintReceipt) {
      await this.#transition(id, "RECONCILIATION_PENDING"); const s = await this.#journal.snapshot();
      const match = await readDepositReconciliation({ policy: op, manifest: dp.manifest, operations: s.operations, nativeVerifier: this.#native,
        solanaRpc: this.#chain, minimumSlot: book.mintReceipt.rootSlot });
      if (match.state !== "OBSERVED_MATCH" || (await this.#journal.snapshot()).revision !== s.revision)
        return result(id, "WAITING_FOR_DEPENDENCY", "RECONCILIATION_SNAPSHOT_CHANGED");
      await this.#guard.assertRunning(id, "AUTHORIZE_CLAIM");
      this.#mutate(id, x => { x.completed = { journalRevision: s.revision, solanaSlot: match.solanaSlot, evidenceDigest: match.evidenceDigest }; });
      await this.#transition(id, "COMPLETED"); return result(id, "COMPLETED", "ALL_REQUIRED_CHECKS_PASSED");
    }
    if (global.state !== "RUNNING") return result(id, "WAITING_FOR_DEPENDENCY", "SOURCE_ADMISSION_SUSPENDED");
    if (!book) {
      // Revalidate even if the previous process died after recording its read.
      const v = await this.#native.verifyInputs({ inputs: r.plan.inputs, minimumConfirmations: op.minimumConfirmations, acceptedCheckpoint: r.plan.acceptedCheckpoint });
      check(v.digestHex === r.plan.acceptedCheckpoint.evidenceDigestHex, "DepositControllerValidationChanged");
      r = this.#mutate(id, x => { x.nativeValidationDigest = v.digestHex; });
      await this.#transition(id, "NATIVE_VALIDATED");
      await this.#journal.reservePlan(r.plan); await this.#transition(id, "SWEEP_PREPARED");
      return result(id, "VERIFIED_READY", "PLAN_RESERVED");
    }
    if (book.signedTransactionHex === null) {
      const signatures = [];
      for (const intent of r.plan.signingIntents) {
        await this.#guard.assertRunning(id, "AUTHORIZE_SWEEP"); await this.#jobs.enqueue(intent);
        const status = await this.#jobs.status(intent);
        if (status.state !== "SIGNED") return result(id, status.state, "FROST_PENDING");
        signatures.push(status.result.signatureHex);
      }
      const signed = attachTaprootWitnesses({ unsignedNativeTransactionHex: r.plan.unsignedTransactionHex, signatures,
        spentOutputs: r.plan.inputs.map(x => ({ amountAtomic: x.amountAtomic, scriptPubKeyHex: x.scriptPubKeyHex })),
        tapscriptSpends: [r.plan.depositPolicy.sweep, ...r.plan.inputs.slice(1).map(() => undefined)] }).rawSignedTransactionHex;
      await this.#journal.retainSigned(id, signed); await this.#transition(id, "AGGREGATE_SIGNATURE_RETAINED");
      return result(id, "SIGNING", "SIGNED_SWEEP_RETAINED");
    }
    if (!book.broadcastAttempted) { await this.#journal.prepareBroadcast(id); await this.#transition(id, "NATIVE_BROADCAST_ATTEMPTED"); }
    if (book.finalizedCredit === null) {
      const delivery = { plan: book.plan, signedTransactionHex: book.signedTransactionHex };
      await this.#guard.assertRunning(id, "AUTHORIZE_SWEEP"); await this.#nativeOutbox.enqueue(delivery);
      await this.#transition(id, "NATIVE_OUTBOX_ACCEPTED"); const status = await this.#nativeOutbox.status(delivery);
      if (status.state === "BROADCAST_OBSERVED") { await this.#journal.recordBroadcastAccepted(id, status.txid); await this.#transition(id, "NATIVE_BROADCAST_ACCEPTED"); }
      return result(id, "WAITING_FOR_FINALITY", "SWEEP_OUTCOME_PENDING");
    }
    if (r.attestations.length < 2) {
      const i = r.attestations.length; await this.#guard.assertRunning(id, "AUTHORIZE_CREDIT");
      const a = await this.#attesters[i].attest(controllerAttestationRequest(r));
      r = this.#mutate(id, x => { x.attestations.push(a); }); await this.#transition(id, i === 0 ? "ATTESTATION_A_READY" : "ATTESTATION_B_READY");
      return result(id, "VERIFIED_READY", "ATTESTATION_RETAINED");
    }
    return this.#deliver(id, r);
  }
  async #prepare(id, r, kind, previous, minimumSlot = this.#policy.deliveryPolicy.operationPolicy.minimumSolanaSlot) {
    const dp = this.#policy.deliveryPolicy;
    check(r.packets.filter(x => x.intent.kind === kind).length < MAX_SOLANA_REBUILDS, "DepositControllerDeliveryLimit");
    const m = decodeCanonicalBridgeMessage(Buffer.from(r.credit.encodedMessageHex, "hex")), now = BigInt(Math.floor(Date.now() / 1000));
    check(now >= m.validFrom && now <= m.validUntil, "DepositControllerCreditWindowExpired");
    if (previous && deliveryUint(previous.intent.minimumSlot) > deliveryUint(minimumSlot)) minimumSlot = previous.intent.minimumSlot;
    const bank = verifyDeploymentSnapshot(dp.manifest, await this.#chain.snapshot(dp.manifest, minimumSlot));
    check(deliveryUint(bank.slot) >= deliveryUint(minimumSlot), "DepositControllerDeploymentStale");
    const block = await this.#rpc.getLatestBlockhash();
    if (previous) check(block.blockhash !== previous.intent.recentBlockhash && deliveryUint(block.lastValidBlockHeight) > deliveryUint(previous.intent.lastValidBlockHeight) &&
      deliveryUint(bank.slot) >= deliveryUint(previous.intent.minimumSlot), "DepositControllerNewBlockhashNotReady");
    await this.#guard.assertRunning(id, "AUTHORIZE_CLAIM");
    this.#mutate(id, x => { x.packets.push({ intent: { operationId: id, kind, encodedMessageHex: x.credit.encodedMessageHex, attestations: structuredClone(x.attestations),
      recentBlockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight, minimumSlot: bank.slot }, delivery: null, unsignedExpiredAtHeight: null }); });
    await this.#transition(id, kind + "_INTENT_PREPARED"); return result(id, "VERIFIED_READY", kind + "_INTENT_RETAINED");
  }
  async #deliver(id, r) {
    const current = r.packets.at(-1); if (!current) return this.#prepare(id, r, "RECEIPT");
    if (current.unsignedExpiredAtHeight !== null) return this.#prepare(id, r, current.intent.kind, current);
    if (current.delivery === null) {
      // No packet reached the relayer without our prior protected write. A lost
      // fee-payer response cannot broadcast; nevertheless wait for finalized
      // expiry before retaining an unsigned abandonment and rebuilding.
      const height = await this.#rpc.getBlockHeight();
      if (height > deliveryUint(current.intent.lastValidBlockHeight)) {
        const verified = verifyDeploymentSnapshot(this.#policy.deliveryPolicy.manifest, await this.#chain.snapshot(this.#policy.deliveryPolicy.manifest));
        check(deliveryUint(verified.slot) >= deliveryUint(current.intent.minimumSlot), "DepositControllerDeploymentStale");
        this.#mutate(id, x => { x.packets.at(-1).unsignedExpiredAtHeight = height.toString(); });
        return result(id, "WAITING_FOR_DEPENDENCY", "UNBROADCAST_UNSIGNED_BLOCKHASH_EXPIRED");
      }
      await this.#guard.assertRunning(id, "AUTHORIZE_CLAIM"); const delivery = await this.#payer.prepare(current.intent);
      this.#mutate(id, x => { x.packets.at(-1).delivery = delivery; }); await this.#transition(id, current.intent.kind + "_PACKET_RETAINED");
      return result(id, "VERIFIED_READY", "SIGNED_SOLANA_PACKET_RETAINED");
    }
    await this.#guard.assertRunning(id, "AUTHORIZE_CLAIM"); await this.#solanaOutbox.enqueue(current.delivery);
    await this.#transition(id, current.intent.kind + "_OUTBOX_ACCEPTED"); const status = await this.#solanaOutbox.status(current.delivery);
    if (status.state === "FINALIZED_ACCOUNT") {
      await this.#transition(id, current.intent.kind + "_ACCOUNT_FINALIZED");
      if (current.intent.kind === "RECEIPT") return this.#prepare(id, r, "CLAIM", undefined, status.observedSlot);
      return result(id, "WAITING_SETTLEMENT", "MINT_OBSERVATION_REQUIRED");
    }
    if (["EXPIRED_UNSEEN", "FINALIZED_FAILED"].includes(status.state)) return this.#prepare(id, r, current.intent.kind, current, status.observedSlot);
    return result(id, status.state, "SOLANA_DELIVERY_PENDING");
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal && typeof signal.aborted === "boolean" && Number.isInteger(intervalMs) && intervalMs >= 250 && intervalMs <= 30000 && typeof onStatus === "function");
    while (!signal.aborted && !this.#closed && !this.#stopped) {
      const ids = await this.#exclusive(() => this.#read().state.records.map(r => r.plan.operationId));
      for (const id of ids) {
        if (signal.aborted || this.#closed || this.#stopped) break;
        try { await onStatus(await this.advance(id)); }
        catch { await onStatus(result(id, this.#stopped ? "HARD_STOP" : "WAITING_FOR_DEPENDENCY", this.#stopped ? "INTEGRITY_INCIDENT" : "DEPENDENCY_UNAVAILABLE")); }
      }
      try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("DepositControllerInterrupted"); }
    }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
export function requireProtectedDepositController(value, policy, integrity) { check(INSTANCES.has(value)); value.assertBinding(policy, integrity); }
