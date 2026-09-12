// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Signed canonical receipt/claim transport ONLY. The operation journal and
// finalized execution observer, not this outbox, settle a user's mint credit.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { LocalDeploymentRpc } from "../solana-observer/deployment-integrity.mjs";
import { SolanaLocalRpcClient } from "../bridge-validator/solana-deposit-claim-submitter.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { validateSolanaDeliveryPolicy, solanaDeliveryPolicyDigest, validateSolanaDepositDelivery, solanaDeliveryId,
  decodeSolanaDepositOutbox, newSolanaDeliveryRecord, validateSolanaDeliveryStatus, verifySolanaDeliveryAccounts,
  deliveryUint, MAX_SOLANA_DELIVERIES, MAX_SOLANA_SENDS } from "./solana-deposit-delivery.mjs";

const INSTANCES = new WeakSet();
const check = (v, code = "SolanaDepositOutboxUnavailable") => { if (!v) throw new Error(code); };
const hash = b => createHash("sha256").update(b).digest("hex");
const maximum = (...v) => v.map(deliveryUint).reduce((a, b) => a > b ? a : b, 0n).toString();
export class ProtectedSolanaDepositOutbox {
  #store; #guard; #policy; #rpc; #chain; #lease; #revision; #pending; #cursor = 0; #busy = false; #running = false; #closed = false; #stopped = false;
  static async open({ store, integrity, policy, endpoint }) {
    assertWindowsProtectedStore(store, "RELAYER", "solana-deposit-outbox"); requireIntegrityGuard(integrity, "RELAYER");
    const self = new ProtectedSolanaDepositOutbox(); self.#policy = validateSolanaDeliveryPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy.operationPolicy;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    // Construct both concrete transports from ONE strict local endpoint.
    // No externally supplied transport callback can return proofVerified=true.
    self.#chain = new LocalDeploymentRpc({ endpoint }); self.#rpc = new SolanaLocalRpcClient({ endpoint });
    self.#store = store; self.#guard = integrity;
    try { self.#lease = await store.acquireLifetimeLease(); self.#read(); INSTANCES.add(self); return self; }
    catch (error) { try { await self.#report(error); } finally { await self.close(); } throw new Error("SolanaDepositOutboxUnavailable"); }
  }
  assertBinding(policy, integrity) {
    check(!this.#closed && !this.#stopped && this.#guard === integrity && solanaDeliveryPolicyDigest(policy) === solanaDeliveryPolicyDigest(this.#policy));
    this.#lease.assertHeld();
  }
  #read() {
    check(!this.#closed && !this.#stopped); this.#lease.assertHeld(); const r = this.#store.read();
    try {
      const state = decodeSolanaDepositOutbox(r.payload, this.#policy);
      if (this.#revision !== undefined && r.revision !== this.#revision) check(this.#pending &&
        BigInt(r.revision) === BigInt(this.#revision) + 1n && hash(r.payload) === this.#pending);
      this.#revision = r.revision; this.#pending = undefined; return { state, revision: r.revision };
    } catch { const error = new Error("SolanaOutboxAuthenticatedStateInvalid"); error.evidenceDigest = hash(r.payload); throw error; }
    finally { r.payload.fill(0); }
  }
  #write(state, revision) {
    const now = Date.now(); check(now >= state.lastTimeMs, "SolanaOutboxAuthenticatedStateInvalid"); state.lastTimeMs = now;
    const bytes = Buffer.from(JSON.stringify(state));
    try { decodeSolanaDepositOutbox(bytes, this.#policy); this.#lease.assertHeld(); this.#pending = hash(bytes);
      this.#revision = this.#store.write(bytes, revision).revision; this.#pending = undefined;
    } finally { bytes.fill(0); }
  }
  async #report(error) {
    const code = error?.integrityCode ?? error?.message;
    if (!["ProtectedStateRollbackDetected", "ProtectedLifetimeLeaseLost", "SolanaOutboxAuthenticatedStateInvalid",
      "SolanaDeliveryAccountConflict", "SolanaOutboxFinalizedConflict", "SOLANA_GENESIS_CHANGED", "SOLANA_DEPLOYMENT_CHANGED", "FINALIZED_SOLANA_CONFLICT"].includes(code)) return;
    this.#stopped = true;
    await this.#guard.report(solanaDeliveryPolicyDigest(this.#policy), "CONFLICTING_BROADCAST", error.evidenceDigest ?? hash(code));
  }
  async #exclusive(action) {
    this.assertBinding(this.#policy, this.#guard); check(!this.#busy, "SolanaDepositOutboxBusy"); this.#busy = true;
    try { return await action(); }
    catch (error) {
      try { if (this.#pending) this.#read(); } catch (readError) { await this.#report(readError); throw readError; }
      await this.#report(error); throw error;
    } finally { this.#busy = false; }
  }
  #find(state, id) {
    check(typeof id === "string" && /^[0-9a-f]{64}$/u.test(id));
    return state.records.find(r => solanaDeliveryId(r.delivery, this.#policy) === id);
  }
  async enqueue(input) {
    const value = validateSolanaDepositDelivery(input, this.#policy).delivery, id = solanaDeliveryId(value, this.#policy);
    await this.#guard.assertRunning(value.operationId, "SUBMIT_CLAIM");
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), found = this.#find(state, id);
      if (found) check(canonicalJson(found.delivery) === canonicalJson(value), "SolanaDeliveryChanged");
      else {
        check(state.records.length < MAX_SOLANA_DELIVERIES, "SolanaDeliveryCapacity");
        state.records.push(newSolanaDeliveryRecord(value, this.#policy));
        // The decoder requires retained, observed old outcomes before replacement.
        this.#write(state, revision);
      }
      return Object.freeze({ state: "ACCEPTED", deliveryId: id, operationId: value.operationId, kind: value.kind });
    });
  }
  async status(id) {
    return this.#exclusive(() => {
      const found = this.#find(this.#read().state, id); check(found, "SolanaDeliveryMissing");
      return Object.freeze({ state: found.outcome === "UNRESOLVED" ?
        (found.sendAttempts >= MAX_SOLANA_SENDS ? "QUEUED_BY_LIMIT" : "WAITING_FOR_DEPENDENCY") : found.outcome,
        deliveryId: id, operationId: found.delivery.operationId, kind: found.delivery.kind,
        signature: validateSolanaDepositDelivery(found.delivery, this.#policy).signature, observedSlot: found.observedSlot });
    }); // Read-only while GLOBAL stop is retained, never while local state is corrupt.
  }
  async #observe(record) {
    const v = validateSolanaDepositDelivery(record.delivery, this.#policy);
    const status = validateSolanaDeliveryStatus(await this.#rpc.getSignatureStatus(v.signature));
    const finalizedHeight = (await this.#rpc.getBlockHeight()).toString();
    const minimumSlot = maximum(v.delivery.minimumSlot, record.observedSlot, status?.finalized ? status.slot : "0");
    const snapshot = await this.#chain.snapshotWithAdditionalAccounts(this.#policy.manifest, [v.receiptAddress, v.claimAddress], minimumSlot);
    const observed = verifySolanaDeliveryAccounts(v.delivery, this.#policy, snapshot);
    check(deliveryUint(observed.slot) >= deliveryUint(record.observedSlot) &&
      deliveryUint(finalizedHeight) >= deliveryUint(record.finalizedHeight), "SolanaDeliveryObservationStale");
    return { ...observed, status, finalizedHeight, expectedAccount: v.delivery.kind === "RECEIPT" ? observed.receiptExists : observed.claimExists };
  }
  async #outcome(id, observed, outcome) {
    return this.#exclusive(() => {
      const { state, revision } = this.#read(), record = this.#find(state, id); check(record, "SolanaDeliveryMissing");
      check(record.outcome === "UNRESOLVED" || record.outcome === outcome, "SolanaOutboxAuthenticatedStateInvalid");
      record.outcome = outcome; record.observedSlot = maximum(record.observedSlot, observed.slot);
      record.finalizedHeight = maximum(record.finalizedHeight, observed.finalizedHeight);
      this.#write(state, revision);
    });
  }
  async runOne() {
    check(!this.#running && !this.#closed, "SolanaDepositOutboxBusy"); this.#running = true;
    try {
      const record = await this.#exclusive(() => {
        const { records } = this.#read().state;
        for (let offset = 0; offset < records.length; offset++) {
          const index = (this.#cursor + offset) % records.length, r = records[index];
          if (r.outcome === "UNRESOLVED" && r.retryAfter <= Date.now()) { this.#cursor = (index + 1) % records.length; return structuredClone(r); }
        }
        return null;
      });
      if (!record) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY" });
      const d = record.delivery, id = solanaDeliveryId(d, this.#policy), parsed = validateSolanaDepositDelivery(d, this.#policy);
      const observed = await this.#observe(record);
      if (observed.expectedAccount) {
        await this.#outcome(id, observed, "FINALIZED_ACCOUNT"); return await this.status(id);
      }
      if (observed.status?.finalized) {
        check(!observed.status.successful, "SolanaOutboxFinalizedConflict");
        await this.#outcome(id, observed, "FINALIZED_FAILED"); return await this.status(id);
      }
      if (observed.status !== null) return Object.freeze({ state: "WAITING_FOR_FINALITY", deliveryId: id });
      if (deliveryUint(observed.finalizedHeight) > deliveryUint(d.lastValidBlockHeight)) {
        await this.#outcome(id, observed, "EXPIRED_UNSEEN"); return await this.status(id);
      }
      if (d.kind === "CLAIM" && !observed.receiptExists) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY", deliveryId: id });
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now < parsed.message.validFrom || now > parsed.message.validUntil) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY", deliveryId: id });
      if (record.sendAttempts >= MAX_SOLANA_SENDS) return Object.freeze({ state: "QUEUED_BY_LIMIT", deliveryId: id });
      await this.#guard.assertRunning(d.operationId, "SUBMIT_CLAIM");
      await this.#exclusive(() => {
        const { state, revision } = this.#read(), current = this.#find(state, id);
        check(current.outcome === "UNRESOLVED" && current.sendAttempts === record.sendAttempts);
        current.sendAttempts++; current.lastSendAt = Date.now(); current.retryAfter = current.lastSendAt + Math.min(30000, 1000 * 2 ** current.sendAttempts);
        this.#write(state, revision); // BEFORE any signed packet reaches the RPC.
      });
      // Re-observe after durable preparation. Lost responses/restarts can only
      // resend these exact bytes, never change the blockhash without outcome review.
      const fresh = await this.#observe(record);
      if (fresh.expectedAccount) { await this.#outcome(id, fresh, "FINALIZED_ACCOUNT"); return await this.status(id); }
      if (fresh.status !== null || deliveryUint(fresh.finalizedHeight) > deliveryUint(d.lastValidBlockHeight))
        return Object.freeze({ state: "WAITING_FOR_DEPENDENCY", deliveryId: id });
      await this.#guard.assertRunning(d.operationId, "SUBMIT_CLAIM"); this.assertBinding(this.#policy, this.#guard);
      const finalTime = BigInt(Math.floor(Date.now() / 1000));
      if (finalTime < parsed.message.validFrom || finalTime > parsed.message.validUntil)
        return Object.freeze({ state: "WAITING_FOR_DEPENDENCY", deliveryId: id });
      const signature = await this.#rpc.sendTransaction(d.preparedTransactionBase64, { encoding: "base64", maxRetries: 0, skipPreflight: false });
      check(signature === parsed.signature, "SolanaOutboxFinalizedConflict");
      // An acknowledgement is not finality or a credit-settlement receipt.
      return Object.freeze({ state: "WAITING_FOR_FINALITY", deliveryId: id });
    } catch (error) {
      await this.#report(error);
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "WAITING_FOR_DEPENDENCY", reason: "SOLANA_DEPOSIT_DELIVERY_UNAVAILABLE" });
    } finally { this.#running = false; }
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 30000);
    while (!signal.aborted && !this.#closed) { await onStatus(await this.runOne());
      try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("SolanaDepositOutboxInterrupted"); } }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
export function requireSolanaDepositOutbox(outbox, policy, integrity) { check(INSTANCES.has(outbox)); outbox.assertBinding(policy, integrity); }
