// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// A persistent operation/accounting boundary, not a replacement for independent
// Native verification, two attesters, signer policy, or the global authority.
import { createHash } from "node:crypto";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { requireVerifiedRegtestReserve, verifiedReserveChain } from "../../native/node/native-raw-evidence.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { requireProtectedClaimObservation } from "../solana-observer/solana-deposit-claim-observer.mjs";
import { validateDepositOperationPolicy, validateDepositOperationPlan, depositOperationPolicyDigest,
  decodeDepositOperationState, depositOperationAccounting, MAX_DEPOSIT_OPERATIONS } from "./deposit-operation-state.mjs";

const JOURNALS = new WeakSet(), HASH = /^[0-9a-f]{64}$/u;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const check = (v, code = "DepositJournalUnavailable") => { if (!v) throw new Error(code); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
export class ProtectedDepositOperationJournal {
  #store; #guard; #policy; #lease; #revision; #pendingWrite; #busy = false; #closed = false; #stopped = false;
  static async open({ store, integrity, policy }) {
    assertWindowsProtectedStore(store, "BRIDGE_VALIDATOR", "deposit-operations");
    requireIntegrityGuard(integrity, "BRIDGE_VALIDATOR");
    const self = new ProtectedDepositOperationJournal(); self.#policy = validateDepositOperationPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    self.#store = store; self.#guard = integrity;
    try { self.#lease = await store.acquireLifetimeLease(); self.#read(); JOURNALS.add(self); return self; }
    catch (error) { try { await self.#report(error); } finally { await self.close(); } throw new Error("DepositJournalUnavailable"); }
  }
  assertBinding(policy, integrity) {
    check(!this.#closed && !this.#stopped && this.#guard === integrity && depositOperationPolicyDigest(policy) === depositOperationPolicyDigest(this.#policy));
    this.#lease.assertHeld();
  }
  #read() {
    check(!this.#closed && !this.#stopped); this.#lease.assertHeld();
    const read = this.#store.read();
    try {
      const state = decodeDepositOperationState(read.payload, this.#policy);
      if (this.#revision !== undefined && read.revision !== this.#revision) check(this.#pendingWrite &&
        BigInt(read.revision) === BigInt(this.#revision) + 1n && digest(read.payload) === this.#pendingWrite);
      this.#revision = read.revision; this.#pendingWrite = undefined;
      return { state, revision: read.revision };
    } catch { const error = new Error("DepositJournalAuthenticatedStateInvalid"); error.evidenceDigest = digest(read.payload); throw error; }
    finally { read.payload.fill(0); }
  }
  #write(state, revision) {
    const bytes = Buffer.from(JSON.stringify(state));
    try {
      decodeDepositOperationState(bytes, this.#policy); this.#lease.assertHeld(); this.#pendingWrite = digest(bytes);
      this.#revision = this.#store.write(bytes, revision).revision; this.#pendingWrite = undefined;
    } finally { bytes.fill(0); }
  }
  async #report(error) {
    if (!["ProtectedStateRollbackDetected", "DepositJournalAuthenticatedStateInvalid", "ProtectedLifetimeLeaseLost"].includes(error?.message)) return;
    this.#stopped = true;
    await this.#guard.report(depositOperationPolicyDigest(this.#policy), "IMPOSSIBLE_OPERATION_STATE", error.evidenceDigest ?? digest(error.message));
  }
  async #exclusive(action) {
    this.assertBinding(this.#policy, this.#guard); check(!this.#busy, "DepositJournalBusy"); this.#busy = true;
    try { return await action(); }
    catch (error) {
      // Resolve our uncertain protected CAS first. A committed signed transaction
      // or credit is never overwritten, forgotten, or relabeled as unsigned.
      try { if (this.#pendingWrite) this.#read(); } catch (readError) { await this.#report(readError); throw readError; }
      await this.#report(error); throw error;
    } finally { this.#busy = false; }
  }
  #record(state, operationId) {
    check(typeof operationId === "string" && HASH.test(operationId), "DepositOperationIdRejected");
    const found = state.operations.find(op => op.plan.operationId === operationId); check(found, "DepositOperationMissing"); return found;
  }
  async inspect(operationId) {
    return this.#exclusive(() => structuredClone(this.#record(this.#read().state, operationId)));
  }
  async snapshot() {
    return this.#exclusive(() => { const { state, revision } = this.#read();
      return Object.freeze({ revision, policyDigest: state.policyDigest, operations: structuredClone(state.operations), accounting: depositOperationAccounting(state, this.#policy) }); });
  }
  async reservePlan(input) {
    const plan = validateDepositOperationPlan(input, this.#policy);
    // Reconciliation must read this journal to establish source health. Never
    // hold its mutation lock while awaiting that dependent authorization.
    // The validated plan is immutable; the current image and all reservations
    // are checked synchronously inside the protected CAS after fresh admission.
    await this.#guard.assertRunning(plan.operationId, "AUTHORIZE_SWEEP");
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), existing = state.operations.find(op => op.plan.operationId === plan.operationId);
      if (existing) { check(same(existing.plan, plan), "DepositOperationPlanChanged"); return structuredClone(existing); }
      check(state.operations.length < MAX_DEPOSIT_OPERATIONS, "DepositOperationCapacity");
      const record = { plan, signedTransactionHex: null, broadcastAttempted: false, broadcastAccepted: false, finalizedCredit: null, mintReceipt: null };
      state.operations.push(record); // Full decoder checks EVERY cross-operation input reservation before the atomic write.
      this.#write(state, revision); return structuredClone(record);
    });
  }
  async retainSigned(operationId, signedTransactionHex) {
    // Retaining already-created risk/evidence remains safe after a global stop.
    // This result is not permission to broadcast; admission is checked separately.
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), record = this.#record(state, operationId);
      if (record.signedTransactionHex !== null) { check(record.signedTransactionHex === signedTransactionHex, "DepositSignedTransactionChanged"); return; }
      record.signedTransactionHex = signedTransactionHex; this.#write(state, revision);
    });
  }
  async prepareBroadcast(operationId) {
    await this.#guard.assertRunning(operationId, "AUTHORIZE_SWEEP");
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), record = this.#record(state, operationId);
      check(record.signedTransactionHex !== null, "DepositSignatureNotRetained");
      check(record.finalizedCredit === null, "DepositSweepAlreadyFinalized");
      if (!record.broadcastAttempted) { record.broadcastAttempted = true; this.#write(state, revision); }
      // Relayer must still check previous outcome, its own current admission,
      // and rebroadcast ONLY these exact retained bytes. No replacement inputs.
      return record.signedTransactionHex;
    });
  }
  async recordBroadcastAccepted(operationId, txid) {
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), record = this.#record(state, operationId);
      check(record.broadcastAttempted && txid === parseNativeTransactionHex(record.plan.unsignedTransactionHex).txidHex, "DepositBroadcastIdentityChanged");
      if (!record.broadcastAccepted) { record.broadcastAccepted = true; this.#write(state, revision); }
    });
  }
  async retainFinalizedCredit(operationId, { receipt, encodedMessageHex, reserveAllocationIdHex }) {
    requireVerifiedRegtestReserve(receipt);
    const chain = verifiedReserveChain(receipt), fact = structuredClone({ acceptedCheckpoint: receipt.acceptedCheckpoint,
      reserveBasis: receipt.reserveBasis, encodedMessageHex, reserveAllocationIdHex });
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), record = this.#record(state, operationId);
      check(record.broadcastAttempted && record.signedTransactionHex !== null, "DepositBroadcastNotRetained");
      const before = record.finalizedCredit;
      if (before !== null) {
        check(BigInt("0x" + chain.chainworkHex) >= BigInt("0x" + before.reserveBasis.chainworkHex), "DepositFinalityObservationStale");
        // Current work can advance without changing the previously accepted
        // prefix/credit. Never create a different claim merely because it did.
        check(same(before, { ...fact, reserveBasis: { ...fact.reserveBasis, chainworkHex: before.reserveBasis.chainworkHex } }), "DepositFinalizedCreditChanged"); return;
      }
      record.finalizedCredit = fact;
      // Finalized reserve + exact owed credit are ONE CAS, before either
      // attester/claim action. A stop may retain this obligation, not authorize it.
      this.#write(state, revision);
    });
  }
  async retainFinalizedMint(operationId, observation) {
    requireProtectedClaimObservation(observation);
    const receipt = { signature: observation.transaction.signature, slot: observation.slot, rootSlot: observation.rootSlot,
      genesis: observation.genesis, operationId: observation.depositClaim.operationIdHex, messageDigest: observation.depositClaim.messageDigestHex,
      amountAtomic: observation.depositClaim.mintedAmountAtomic, recipientHex: observation.depositClaim.solanaRecipientHex, mint: observation.mint.addressHex };
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), record = this.#record(state, operationId);
      check(observation.programs.managerProgramIdHex === this.#policy.managerProgramId && observation.programs.transceiverProgramIdHex === this.#policy.transceiverProgramId,
        "DepositMintProgramChanged");
      check(record.finalizedCredit !== null, "DepositCreditNotRetained");
      if (record.mintReceipt !== null) {
        check(uintSlot(receipt.rootSlot) >= uintSlot(record.mintReceipt.rootSlot), "DepositMintObservationStale");
        check(same(record.mintReceipt, { ...receipt, rootSlot: record.mintReceipt.rootSlot }), "DepositMintOutcomeChanged"); return;
      }
      const lastSlot = state.operations.reduce((maximum, op) => op.mintReceipt && uintSlot(op.mintReceipt.rootSlot) > maximum ? uintSlot(op.mintReceipt.rootSlot) : maximum, 0n);
      check(uintSlot(receipt.rootSlot) >= lastSlot, "DepositMintObservationStale");
      record.mintReceipt = receipt; this.#write(state, revision);
    });
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
function uintSlot(v) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v) && BigInt(v) <= 0xffff_ffff_ffff_ffffn); return BigInt(v); }
export function requireDepositOperationJournal(journal, policy, integrity) {
  check(JOURNALS.has(journal), "ProtectedDepositJournalRequired"); journal.assertBinding(policy, integrity);
}
