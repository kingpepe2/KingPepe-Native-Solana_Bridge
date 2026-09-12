// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Exact retained signed transaction transport, never a signing authority.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { NativeRpcClient, normalizeEndpoint } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier, requireVerifiedRegtestChain } from "../../native/node/native-raw-evidence.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { validateDepositOperationPolicy, depositOperationPolicyDigest, decodeDepositOperationState,
  DEPOSIT_OPERATION_PROTOCOL, MAX_DEPOSIT_OPERATIONS } from "../bridge-validator/deposit-operation-state.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";

export const NATIVE_OUTBOX_PROTOCOL = "KINGPEPE_PROTECTED_NATIVE_SWEEP_OUTBOX_V1";
const INSTANCES = new WeakSet(), MAX_SENDS = 32;
const check = (v, code = "NativeSweepOutboxRejected") => { if (!v) throw new Error(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
function operation(record) {
  return { plan: record.plan, signedTransactionHex: record.signedTransactionHex, broadcastAttempted: record.sendAttempts > 0 || record.observed,
    broadcastAccepted: record.observed, finalizedCredit: null, mintReceipt: null };
}
export function initialNativeSweepOutbox(policy) {
  return Buffer.from(JSON.stringify({ protocol: NATIVE_OUTBOX_PROTOCOL, policyDigest: depositOperationPolicyDigest(policy), lastTimeMs: 0, records: [] }));
}
export function decodeNativeSweepOutbox(bytes, policy, now = Date.now()) {
  check(bytes instanceof Uint8Array && bytes.length <= 900000);
  const text = Buffer.from(bytes).toString("utf8"), value = JSON.parse(text); check(JSON.stringify(value) === text);
  fields(value, ["protocol", "policyDigest", "lastTimeMs", "records"]);
  check(value.protocol === NATIVE_OUTBOX_PROTOCOL && value.policyDigest === depositOperationPolicyDigest(policy));
  check(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(value.lastTimeMs) && value.lastTimeMs >= 0 && value.lastTimeMs <= now);
  check(Array.isArray(value.records) && value.records.length <= MAX_DEPOSIT_OPERATIONS);
  for (const r of value.records) {
    fields(r, ["plan", "signedTransactionHex", "sendAttempts", "lastSendAt", "retryAfter", "observed"]);
    check(typeof r.signedTransactionHex === "string" && typeof r.observed === "boolean" && Number.isInteger(r.sendAttempts) && r.sendAttempts >= 0 && r.sendAttempts <= MAX_SENDS);
    check(Number.isSafeInteger(r.lastSendAt) && r.lastSendAt >= 0 && r.lastSendAt <= value.lastTimeMs);
    check(Number.isSafeInteger(r.retryAfter) && r.retryAfter >= r.lastSendAt && r.retryAfter <= r.lastSendAt + 30000);
    check(r.sendAttempts === 0 ? r.lastSendAt === 0 && r.retryAfter === 0 : r.lastSendAt > 0);
  }
  // Reuse the one economic plan/signature/allocation implementation. This
  // verifies every BIP340 witness and rejects cross-operation input reuse.
  decodeDepositOperationState(Buffer.from(JSON.stringify({ protocol: DEPOSIT_OPERATION_PROTOCOL,
    policyDigest: value.policyDigest, operations: value.records.map(operation) })), policy);
  return value;
}
export function validateNativeSweepDelivery(input, policy) {
  const value = structuredClone(input); fields(value, ["plan", "signedTransactionHex"]);
  check(Buffer.byteLength(JSON.stringify(value)) <= 200000, "NativeSweepDeliverySizeRejected");
  const state = JSON.parse(initialNativeSweepOutbox(policy));
  state.records.push({ ...value, sendAttempts: 0, lastSendAt: 0, retryAfter: 0, observed: false });
  decodeNativeSweepOutbox(Buffer.from(JSON.stringify(state)), policy); return value;
}

export class ProtectedNativeSweepOutbox {
  #store; #guard; #policy; #rpc; #verifier; #lease; #revision; #pending; #cursor = 0; #busy = false; #running = false; #closed = false; #stopped = false;
  static async open({ store, integrity, policy, rpc, nativeVerifier }) {
    assertWindowsProtectedStore(store, "RELAYER", "native-sweep-outbox"); requireIntegrityGuard(integrity, "RELAYER");
    check(rpc instanceof NativeRpcClient && nativeVerifier instanceof LocalNativeEvidenceVerifier);
    normalizeEndpoint(rpc.endpointForReport(), { localOnly: true });
    const self = new ProtectedNativeSweepOutbox(); self.#policy = validateDepositOperationPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    self.#store = store; self.#guard = integrity; self.#rpc = rpc; self.#verifier = nativeVerifier;
    try { self.#lease = await store.acquireLease(); self.#read(); INSTANCES.add(self); return self; }
    catch (error) { try { await self.#report(error); } finally { await self.close(); } throw new Error("NativeSweepOutboxUnavailable"); }
  }
  assertBinding(policy, integrity) {
    check(!this.#closed && !this.#stopped && integrity === this.#guard && depositOperationPolicyDigest(policy) === depositOperationPolicyDigest(this.#policy));
    this.#lease.assertHeld();
  }
  #read() {
    check(!this.#closed && !this.#stopped); this.#lease.assertHeld(); const read = this.#store.read();
    try {
      const state = decodeNativeSweepOutbox(read.payload, this.#policy);
      if (this.#revision !== undefined && read.revision !== this.#revision) check(this.#pending &&
        BigInt(read.revision) === BigInt(this.#revision) + 1n && hash(read.payload) === this.#pending);
      this.#revision = read.revision; this.#pending = undefined; return { state, revision: read.revision };
    } catch { const error = new Error("NativeOutboxAuthenticatedStateInvalid"); error.evidenceDigest = hash(read.payload); throw error; }
    finally { read.payload.fill(0); }
  }
  #write(state, revision) {
    const now = Date.now(); check(now >= state.lastTimeMs, "NativeOutboxAuthenticatedStateInvalid");
    state.lastTimeMs = now; const bytes = Buffer.from(JSON.stringify(state));
    try { decodeNativeSweepOutbox(bytes, this.#policy); this.#lease.assertHeld(); this.#pending = hash(bytes);
      this.#revision = this.#store.write(bytes, revision).revision; this.#pending = undefined;
    } finally { bytes.fill(0); }
  }
  async #report(error) {
    if (!["ProtectedStateRollbackDetected", "ProtectedProcessLeaseLost", "NativeOutboxAuthenticatedStateInvalid", "NativeOutboxBroadcastConflict"].includes(error?.message)) return;
    this.#stopped = true;
    await this.#guard.report(depositOperationPolicyDigest(this.#policy), "CONFLICTING_BROADCAST", error.evidenceDigest ?? hash(error.message));
  }
  async #exclusive(action) {
    this.assertBinding(this.#policy, this.#guard); check(!this.#busy, "NativeSweepOutboxBusy"); this.#busy = true;
    try { return await action(); }
    catch (error) {
      try { if (this.#pending) this.#read(); } catch (readError) { await this.#report(readError); throw readError; }
      await this.#report(error); throw error;
    } finally { this.#busy = false; }
  }
  #record(state, operationId) {
    check(typeof operationId === "string" && /^[0-9a-f]{64}$/u.test(operationId));
    return state.records.find(r => r.plan.operationId === operationId);
  }
  async enqueue(input) {
    const value = validateNativeSweepDelivery(input, this.#policy);
    return this.#exclusive(async () => {
      await this.#guard.assertRunning(value.plan.operationId, "BROADCAST_SWEEP");
      const { state, revision } = this.#read(), found = this.#record(state, value.plan.operationId);
      if (found) check(found.signedTransactionHex === value.signedTransactionHex && canonicalJson(found.plan) === canonicalJson(value.plan), "NativeSweepDeliveryChanged");
      else { check(state.records.length < MAX_DEPOSIT_OPERATIONS);
        state.records.push({ ...value, sendAttempts: 0, lastSendAt: 0, retryAfter: 0, observed: false }); this.#write(state, revision); }
      return Object.freeze({ state: "ACCEPTED", operationId: value.plan.operationId, txid: parseNativeTransactionHex(value.signedTransactionHex).txidHex });
    });
  }
  async status(operationId) {
    return this.#exclusive(() => {
      const found = this.#record(this.#read().state, operationId); check(found, "NativeSweepDeliveryMissing");
      return Object.freeze({ state: found.observed ? "BROADCAST_OBSERVED" : found.sendAttempts >= MAX_SENDS ? "QUEUED_BY_LIMIT" : "WAITING_FOR_DEPENDENCY",
        operationId, txid: parseNativeTransactionHex(found.signedTransactionHex).txidHex });
    }); // Read-only status remains available after a GLOBAL stop, not corrupt local state.
  }
  async #known(record) {
    let raw;
    try { raw = await this.#rpc.getRawTransaction(parseNativeTransactionHex(record.signedTransactionHex).txidHex, false); }
    catch (error) {
      // An exact Native -5 means not found by this configured node, NOT proof
      // of non-broadcast. A retry also verifies the still-unspent exact inputs.
      if (error?.message === "NativeRpcRejected:getrawtransaction:-5") return false;
      throw error;
    }
    check(raw === record.signedTransactionHex, "NativeOutboxBroadcastConflict"); return true;
  }
  async #sameBroadcastChain(tipHash) {
    const observed = await this.#rpc.getSourceSnapshot({ expectedNetwork: "regtest", expectedGenesisHash: this.#policy.nativeGenesis });
    check(observed.network === "regtest" && observed.genesisHash === this.#policy.nativeGenesis, "NativeOutboxBroadcastConflict");
    check(observed.state === "READY" && observed.headers === observed.bestHeight && observed.bestHash === tipHash, "NativeSweepBroadcastSourceStale");
  }
  async runOne() {
    check(!this.#running && !this.#closed, "NativeSweepOutboxBusy"); this.#running = true;
    try {
      const record = await this.#exclusive(() => {
        const { records } = this.#read().state;
        // Exhausted delivery still needs outcome observation, but must not
        // starve another operation. This cursor is scheduling, not authority.
        for (let offset = 0; offset < records.length; offset++) {
          const index = (this.#cursor + offset) % records.length, value = records[index];
          if (!value.observed && value.retryAfter <= Date.now()) {
            this.#cursor = (index + 1) % records.length; return structuredClone(value);
          }
        }
        return null;
      });
      if (!record) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY" });
      const chain = await this.#verifier.observeChain(); requireVerifiedRegtestChain(chain);
      check(chain.genesis === this.#policy.nativeGenesis, "NativeOutboxBroadcastConflict");
      await this.#sameBroadcastChain(chain.tipHash);
      let known = await this.#known(record);
      if (!known) {
        if (record.sendAttempts >= MAX_SENDS) return Object.freeze({ state: "QUEUED_BY_LIMIT" });
        const p = record.plan, fee = p.inputs.reduce((n, i) => n + BigInt(i.amountAtomic), 0n) - BigInt(p.depositIntent.amountAtomic);
        // Same independent full raw-evidence verifier used by the signers.
        // A mempool spend/recovery race or missing UTXO must WAIT, not reroute.
        const verified = await this.#verifier.verifySweepSigning({ inputs: p.inputs, minimumConfirmations: p.acceptedCheckpoint.minimumConfirmations,
          unsignedTransactionHex: p.unsignedTransactionHex, reserveAmountAtomic: p.depositIntent.amountAtomic, feeAtomic: fee.toString(),
          reserveScriptHex: p.depositPolicy.canonicalReserveScriptPubKeyHex, intent: p.signingIntents[0],
          tapscriptSpends: [p.depositPolicy.sweep, ...p.inputs.slice(1).map(() => undefined)], acceptedCheckpoint: p.acceptedCheckpoint });
        await this.#exclusive(async () => {
          await this.#guard.assertRunning(p.operationId, "BROADCAST_SWEEP");
          const { state, revision } = this.#read(), current = this.#record(state, p.operationId);
          check(!current.observed && current.sendAttempts === record.sendAttempts);
          current.sendAttempts++; current.lastSendAt = Date.now(); current.retryAfter = current.lastSendAt + Math.min(30000, 1000 * 2 ** current.sendAttempts);
          this.#write(state, revision); // BEFORE the network sees signed bytes.
        });
        await this.#guard.assertRunning(p.operationId, "BROADCAST_SWEEP");
        await this.#sameBroadcastChain(verified.currentTipHash);
        await this.#guard.assertRunning(p.operationId, "BROADCAST_SWEEP");
        this.assertBinding(this.#policy, this.#guard);
        try { const txid = await this.#rpc.sendRawTransaction(record.signedTransactionHex);
          check(txid === parseNativeTransactionHex(record.signedTransactionHex).txidHex, "NativeOutboxBroadcastConflict");
        } catch (error) {
          if (error?.message === "NativeOutboxBroadcastConflict") throw error;
          // Lost acknowledgement is retained uncertainty. Query exact bytes.
        }
        known = await this.#known(record);
      }
      if (!known) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY" });
      await this.#exclusive(() => { const { state, revision } = this.#read(), current = this.#record(state, record.plan.operationId);
        current.observed = true; this.#write(state, revision); });
      return await this.status(record.plan.operationId);
    } catch (error) {
      await this.#report(error);
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "WAITING_FOR_DEPENDENCY", reason: "NATIVE_SWEEP_DELIVERY_UNAVAILABLE" });
    } finally { this.#running = false; }
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 30000);
    while (!signal.aborted && !this.#closed) { await onStatus(await this.runOne());
      try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("NativeSweepOutboxInterrupted"); } }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
export function requireNativeSweepOutbox(outbox, policy, integrity) {
  check(INSTANCES.has(outbox)); outbox.assertBinding(policy, integrity);
}
