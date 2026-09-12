// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { WindowsProtectedStore, assertWindowsProtectedStore } from "../../../shared/windows/protected-store.mjs";
import { WindowsProtectedFrostStateStore } from "./windows-protected-state-store.mjs";
import { assertFrostStateEnvelope } from "./file-state-store.mjs";
import { canonicalJson } from "../policy/native-signing-policy.mjs";

const PROTOCOL = "KINGPEPE_PROTECTED_SIGNER_FENCE_V1";
const FIELDS = ["protocol", "signerRole", "signerInstanceId", "deploymentId", "environment", "nativeGenesis", "keyEpoch", "persistentFenceEpoch",
  "stateRevision", "nonceHighWaterMark", "stateDigest", "pending"];
const HASH = /^[0-9a-f]{64}$/u;
function requireValue(value) { if (!value) throw new Error("ProtectedSignerFenceRejected"); }
function uint(value) {
  requireValue(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value));
  const parsed = BigInt(value); requireValue(parsed <= 0xffff_ffff_ffff_ffffn); return parsed;
}
function next(value) { requireValue(uint(value) < 0xffff_ffff_ffff_ffffn); return (uint(value) + 1n).toString(); }
function digest(state) { return createHash("sha256").update(canonicalJson(state)).digest("hex"); }
function snapshot(base, state) {
  assertFrostStateEnvelope(state, base.context.role);
  return { stateRevision: base.revisionOf(state), stateDigest: digest(state), nonceHighWaterMark: state.nonceReservationCounter };
}
function same(snapshot, record) { return snapshot.stateRevision === record.stateRevision && snapshot.stateDigest === record.stateDigest && snapshot.nonceHighWaterMark === record.nonceHighWaterMark; }
function checkBinding(base, fence) {
  requireValue(base instanceof WindowsProtectedFrostStateStore);
  assertWindowsProtectedStore(fence, base.context.role, "signer-fence");
  requireValue(base.context.environment === "localnet");
  for (const key of ["role", "serviceSid", "environment", "nativeGenesis", "solanaDeployment", "instanceId", "keyEpoch"]) requireValue(base.context[key] === fence.context[key]);
}
function initial(base, state) {
  return { protocol: PROTOCOL, signerRole: base.context.role, signerInstanceId: base.context.instanceId,
    deploymentId: base.context.solanaDeployment, environment: base.context.environment, nativeGenesis: base.context.nativeGenesis,
    keyEpoch: base.context.keyEpoch, persistentFenceEpoch: "0", ...snapshot(base, state), pending: null };
}
function readFence(store) {
  const result = store.read(); let record;
  try { record = JSON.parse(result.payload.toString("utf8")); } catch { throw new Error("ProtectedSignerFenceRejected"); }
  finally { result.payload.fill(0); }
  requireValue(record && Object.keys(record).sort().join() === [...FIELDS].sort().join() && record.protocol === PROTOCOL);
  uint(record.persistentFenceEpoch); requireValue(uint(record.stateRevision) > 0n); uint(record.nonceHighWaterMark);
  requireValue(typeof record.stateDigest === "string" && HASH.test(record.stateDigest));
  const c = store.context;
  requireValue(record.signerRole === c.role && record.signerInstanceId === c.instanceId && record.deploymentId === c.solanaDeployment &&
    record.environment === c.environment && record.nativeGenesis === c.nativeGenesis && record.keyEpoch === c.keyEpoch);
  if (record.pending !== null) {
    const p = record.pending;
    requireValue(p && Object.keys(p).sort().join() === "nonceHighWaterMark,stateDigest,stateRevision");
    requireValue(p.stateRevision === next(record.stateRevision) && HASH.test(p.stateDigest) && uint(p.nonceHighWaterMark) >= uint(record.nonceHighWaterMark));
  }
  return { record, revision: result.revision };
}
function writeFence(store, record, revision) {
  const bytes = Buffer.from(JSON.stringify(record));
  try { return store.write(bytes, revision).revision; } finally { bytes.fill(0); }
}

export class WindowsFencedFrostStateStore {
  #base; #fence; #lease; #epoch; #closed = false; #loaded = new WeakMap();
  constructor(base, fence) { checkBinding(base, fence); this.#base = base; this.#fence = fence; }
  static async createLocal({ base, fenceOptions, policy }) {
    requireValue(base instanceof WindowsProtectedFrostStateStore); base.assertPolicy(policy);
    // Initial enrollment is explicit and must precede DKG/signing material.
    const state = base.load(); requireValue(state.activeEpoch === undefined && Object.keys(state.dkg).length === 0 && uint(state.nonceReservationCounter) === 0n);
    const bytes = Buffer.from(JSON.stringify(initial(base, state))); let fence;
    try { fence = WindowsProtectedStore.create(fenceOptions, bytes); } finally { bytes.fill(0); }
    return WindowsFencedFrostStateStore.openLocal({ base, fence, policy });
  }
  static async openLocal({ base, fence, policy }) {
    base.assertPolicy(policy); const store = new WindowsFencedFrostStateStore(base, fence);
    try { await store.#activate(); return store; }
    catch (error) {
      // Preserve only confirmed, fixed integrity classifications for the
      // service startup reporter. Lease contention, missing protection and
      // arbitrary helper errors remain unavailable, not proven rollback.
      const code = ["ProtectedStateRollbackDetected", "ProtectedSignerFenceRejected", "ProtectedFrostStateInvalid"]
        .includes(error?.message) ? error.message : "ProtectedSignerFenceActivationRejected";
      try { await store.close(); } finally { throw new Error(code); }
    }
  }
  assertPolicy(policy) { this.#base.assertPolicy(policy); }
  assertLifetime() { requireValue(!this.#closed && this.#lease !== undefined); this.#lease.assertHeld(); }
  async #activate() {
    this.#lease = await this.#fence.acquireLifetimeLease();
    let { record, revision } = readFence(this.#fence);
    const state = this.#base.load(), actual = snapshot(this.#base, state);
    if (record.pending !== null) {
      // Only exact before/after images of one prepared write are recoverable.
      if (same(actual, record.pending)) Object.assign(record, record.pending);
      else requireValue(same(actual, record));
      record.pending = null; revision = writeFence(this.#fence, record, revision);
    }
    requireValue(same(actual, record));
    record.persistentFenceEpoch = next(record.persistentFenceEpoch);
    writeFence(this.#fence, record, revision); this.#epoch = record.persistentFenceEpoch;
    this.assertLifetime();
  }
  #current() {
    this.assertLifetime(); const value = readFence(this.#fence);
    requireValue(value.record.persistentFenceEpoch === this.#epoch && value.record.pending === null); return value;
  }
  load() {
    try {
      const { record } = this.#current(), state = this.#base.load(), actual = snapshot(this.#base, state);
      requireValue(same(actual, record)); this.#loaded.set(state, actual); return state;
    } catch { this.#closed = true; throw new Error("ProtectedSignerStateIntegrityRejected"); }
  }
  save(state) {
    try {
      const { record, revision } = this.#current(), expected = this.#loaded.get(state);
      requireValue(expected && same(expected, record)); assertFrostStateEnvelope(state, this.#base.context.role);
      const pending = { stateRevision: next(expected.stateRevision), stateDigest: digest(state), nonceHighWaterMark: state.nonceReservationCounter };
      requireValue(uint(pending.nonceHighWaterMark) >= uint(record.nonceHighWaterMark));
      this.#loaded.delete(state);
      record.pending = pending;
      const preparedRevision = writeFence(this.#fence, record, revision);
      this.assertLifetime(); this.#base.save(state);
      requireValue(same(snapshot(this.#base, state), pending));
      Object.assign(record, pending); record.pending = null;
      this.assertLifetime(); writeFence(this.#fence, record, preparedRevision);
      this.#loaded.set(state, pending);
    } catch { this.#closed = true; throw new Error("ProtectedSignerStateIntegrityRejected"); }
  }
  publicFence() {
    const { record } = this.#current();
    return Object.freeze({ signerRole: record.signerRole, signerInstanceId: record.signerInstanceId,
      deploymentId: record.deploymentId, environment: record.environment, persistentFenceEpoch: record.persistentFenceEpoch,
      stateRevision: record.stateRevision, nonceHighWaterMark: record.nonceHighWaterMark });
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#base.close(); this.#fence.close(); }
}
