// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Accepted-basis monitoring is not a minting authority or economic repair tool.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { LocalNativeEvidenceVerifier, REGTEST_GENESIS, requireVerifiedRegtestChain, requireVerifiedRegtestReserve, verifiedReserveChain } from "./native-raw-evidence.mjs";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";

export const NATIVE_INTEGRITY_PROTOCOL = "KINGPEPE_NATIVE_INTEGRITY_V1";
const HASH = /^[0-9a-f]{64}$/u, MAX_BASES = 128;
const requireValue = (v, code = "NativeProgressRejected") => { if (!v) throw new Error(code); };
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hash = value => { requireValue(typeof value === "string" && HASH.test(value)); return value; };
const uint = value => { requireValue(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn); return BigInt(value); };
const height = value => { requireValue(Number.isInteger(value) && value >= 1 && value <= 4096); return value; };
const fields = (v, names) => requireValue(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
function policy(input) {
  const p = structuredClone(input); fields(p, ["environment", "nativeGenesis", "solanaDeployment", "keyEpoch", "minimumConfirmations", "maximumStallMs"]);
  requireValue(p.environment === "localnet" && p.nativeGenesis === REGTEST_GENESIS); hash(p.solanaDeployment);
  requireValue(Number.isInteger(p.keyEpoch) && p.keyEpoch > 0 && p.keyEpoch <= 0xffff_ffff);
  height(p.minimumConfirmations);
  requireValue(Number.isInteger(p.maximumStallMs) && p.maximumStallMs >= 1000 && p.maximumStallMs <= 300000);
  return Object.freeze(Object.fromEntries(["environment", "nativeGenesis", "solanaDeployment", "keyEpoch", "minimumConfirmations", "maximumStallMs"].map(k => [k, p[k]])));
}
function block(b) { fields(b, ["txid", "vout", "height", "blockHash"]); hash(b.txid); hash(b.blockHash); height(b.height);
  requireValue(Number.isInteger(b.vout) && b.vout >= 0 && b.vout <= 0xffff_ffff); }
function basis(b) {
  fields(b, ["operationId", "genesis", "chainworkHex", "deposit", "sweep", "amountAtomic", "reserveScriptHex"]);
  hash(b.operationId); requireValue(b.genesis === REGTEST_GENESIS); hash(b.chainworkHex); block(b.deposit); block(b.sweep);
  requireValue(b.sweep.height >= b.deposit.height && uint(b.amountAtomic) > 0n && /^5120[0-9a-f]{64}$/u.test(b.reserveScriptHex));
}
function chain(c) {
  requireValue(c && c.genesis === REGTEST_GENESIS); height(c.tipHeight); hash(c.tipHash); hash(c.chainworkHex);
  requireValue(BigInt("0x" + c.chainworkHex) > 0n && Array.isArray(c.headerHashes) && c.headerHashes.length === c.tipHeight + 1);
  c.headerHashes.forEach(hash); requireValue(c.headerHashes[0] === REGTEST_GENESIS && c.headerHashes[c.tipHeight] === c.tipHash);
  requireValue(Number.isSafeInteger(c.observedAt) && c.observedAt > 0);
}
function progress(value, expectedPolicy) {
  const v = structuredClone(value);
  fields(v, ["protocol", "policyDigest", "genesis", "tipHeight", "tipHash", "chainworkHex", "lastObservationMs", "lastAdvanceMs", "bases", "incident"]);
  requireValue(v.protocol === NATIVE_INTEGRITY_PROTOCOL && v.policyDigest === digest(policy(expectedPolicy)) && v.genesis === REGTEST_GENESIS);
  height(v.tipHeight); hash(v.tipHash); hash(v.chainworkHex);
  requireValue(Number.isSafeInteger(v.lastObservationMs) && v.lastObservationMs > 0 && Number.isSafeInteger(v.lastAdvanceMs) && v.lastAdvanceMs > 0 && v.lastAdvanceMs <= v.lastObservationMs);
  requireValue(Array.isArray(v.bases) && v.bases.length <= MAX_BASES);
  v.bases.forEach(basis);
  for (const index of [b => b.operationId, b => b.deposit.txid + ":" + b.deposit.vout, b => b.sweep.txid + ":" + b.sweep.vout]) requireValue(new Set(v.bases.map(index)).size === v.bases.length);
  if (v.incident !== null) {
    fields(v.incident, ["code", "previousTip", "observedTip", "affected", "affectedReserveAtomic", "evidenceDigest"]);
    requireValue(v.incident.code === "NATIVE_DEEP_REORG"); hash(v.incident.previousTip); hash(v.incident.observedTip); hash(v.incident.evidenceDigest);
    requireValue(Array.isArray(v.incident.affected) && v.incident.affected.length > 0 && v.incident.affected.length <= v.bases.length);
    requireValue(new Set(v.incident.affected).size === v.incident.affected.length);
    let affected = 0n;
    for (const id of v.incident.affected) { const b = v.bases.find(b => b.operationId === id); requireValue(b); affected += uint(b.amountAtomic); }
    requireValue(v.incident.affectedReserveAtomic === affected.toString());
  }
  return v;
}

export function initialNativeProgress(expectedPolicy, verifiedChain) {
  requireVerifiedRegtestChain(verifiedChain); chain(verifiedChain); const p = policy(expectedPolicy);
  return { protocol: NATIVE_INTEGRITY_PROTOCOL, policyDigest: digest(p), genesis: REGTEST_GENESIS,
    tipHeight: verifiedChain.tipHeight, tipHash: verifiedChain.tipHash, chainworkHex: verifiedChain.chainworkHex,
    lastObservationMs: verifiedChain.observedAt, lastAdvanceMs: verifiedChain.observedAt, bases: [], incident: null };
}

// Pure comparison for tests and source review. This function by itself issues
// no capability: the protected service additionally requires branded results
// from the independent Rust header verifier before persisting any observation.
export function compareNativeProgress(stored, observed, expectedPolicy, now = Date.now()) {
  const p = policy(expectedPolicy), old = progress(stored, p); chain(observed);
  requireValue(Number.isSafeInteger(now) && now >= old.lastObservationMs && now >= observed.observedAt, "NativeProgressClockRollback");
  if (old.incident !== null) return { state: "HARD_STOP_INTEGRITY", progress: old, incident: old.incident };
  if (observed.observedAt < old.lastObservationMs || now - observed.observedAt > p.maximumStallMs) return { state: "WAITING_FOR_DEPENDENCY", reason: "STALE_NATIVE_OBSERVATION", progress: old };
  const oldWork = BigInt("0x" + old.chainworkHex), newWork = BigInt("0x" + observed.chainworkHex);
  if (newWork < oldWork || (newWork === oldWork && observed.tipHash !== old.tipHash)) return { state: "WAITING_FOR_DEPENDENCY", reason: "NATIVE_CHAIN_CHOICE_UNRESOLVED", progress: old };
  const affected = old.bases.filter(b => observed.headerHashes[b.deposit.height] !== b.deposit.blockHash || observed.headerHashes[b.sweep.height] !== b.sweep.blockHash);
  if (affected.length) {
    const incident = { code: "NATIVE_DEEP_REORG", previousTip: old.tipHash, observedTip: observed.tipHash,
      affected: affected.map(b => b.operationId).sort(), affectedReserveAtomic: affected.reduce((n, b) => n + uint(b.amountAtomic), 0n).toString(),
      evidenceDigest: digest({ oldWork: old.chainworkHex, newWork: observed.chainworkHex, prior: old.tipHash, observed: observed.tipHash, affected }) };
    return { state: "HARD_STOP_INTEGRITY", incident, progress: { ...old, incident } };
  }
  const lastAdvanceMs = newWork > oldWork ? observed.observedAt : old.lastAdvanceMs;
  if (now - lastAdvanceMs > p.maximumStallMs) return { state: "WAITING_FOR_DEPENDENCY", reason: "NATIVE_CHAIN_NOT_ADVANCING", progress: old };
  return { state: "OBSERVED_MATCH", progress: { ...old, tipHeight: observed.tipHeight, tipHash: observed.tipHash,
    chainworkHex: observed.chainworkHex, lastObservationMs: observed.observedAt, lastAdvanceMs } };
}

export function retainVerifiedReserveBasis(stored, receipt, operationId, expectedPolicy) {
  requireVerifiedRegtestReserve(receipt); hash(operationId); const old = progress(stored, expectedPolicy);
  requireValue(old.incident === null, "NativeProgressStopped");
  const current = compareNativeProgress(old, verifiedReserveChain(receipt), expectedPolicy);
  if (current.incident) return current.progress;
  requireValue(current.state === "OBSERVED_MATCH", "NativeReserveBasisStale");
  const b = { operationId, ...receipt.reserveBasis }; basis(b);
  requireValue(receipt.tipHeight - b.sweep.height + 1 >= policy(expectedPolicy).minimumConfirmations &&
    receipt.tipHeight - b.deposit.height + 1 >= policy(expectedPolicy).minimumConfirmations, "NativeReserveBasisFinalityInsufficient");
  const existing = old.bases.find(v => v.operationId === operationId);
  if (existing) { requireValue(JSON.stringify(existing) === JSON.stringify({ ...b, chainworkHex: existing.chainworkHex }), "NativeReserveBasisConflict"); return current.progress; }
  requireValue(old.bases.length < MAX_BASES, "NativeProgressCapacity");
  requireValue(!old.bases.some(v => (v.deposit.txid === b.deposit.txid && v.deposit.vout === b.deposit.vout) ||
    (v.sweep.txid === b.sweep.txid && v.sweep.vout === b.sweep.vout)), "NativeReserveBasisConflict");
  return { ...current.progress, bases: [...old.bases, b] };
}

export class ProtectedNativeIntegrityMonitor {
  #policy; #verifier; #guard; #store; #lease; #closed = false; #busy = false; #stopped = false;
  static async open({ expectedPolicy, verifier, integrity, store }) {
    const self = new ProtectedNativeIntegrityMonitor(); self.#policy = policy(expectedPolicy);
    requireValue(verifier instanceof LocalNativeEvidenceVerifier, "NativeIndependentVerifierRequired");
    requireIntegrityGuard(integrity, "NATIVE_OBSERVER"); assertWindowsProtectedStore(store, "NATIVE_OBSERVER", "chain-progress");
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    requireValue(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    self.#verifier = verifier; self.#guard = integrity; self.#store = store;
    try { self.#lease = await store.acquireLifetimeLease(); self.#read(); return self; }
    catch (error) { try { if (error.message === "NativeProgressRejected" || error.message === "ProtectedStateRollbackDetected")
      await integrity.report(digest(self.#policy), "NATIVE_PROGRESS_INTEGRITY", digest({ reason: error.message })); }
    finally { await self.close(); } throw new Error("NativeProtectedProgressUnavailable"); }
  }
  static initialPayload(expectedPolicy, verifiedChain) { return Buffer.from(JSON.stringify(initialNativeProgress(expectedPolicy, verifiedChain))); }
  #read() {
    requireValue(!this.#closed && this.#lease, "NativeProtectedProgressUnavailable"); this.#lease.assertHeld();
    const r = this.#store.read();
    try { return { value: progress(JSON.parse(r.payload.toString("utf8")), this.#policy), revision: r.revision }; }
    catch { throw new Error("NativeProgressRejected"); } finally { r.payload.fill(0); }
  }
  #write(value, revision) {
    const bytes = Buffer.from(JSON.stringify(progress(value, this.#policy)));
    try { this.#lease.assertHeld(); this.#store.write(bytes, revision); } finally { bytes.fill(0); }
  }
  async retainReserve({ operationId, verifyReserveInput }) {
    requireValue(!this.#busy && !this.#stopped && !this.#closed, "NativeProtectedProgressUnavailable"); this.#busy = true;
    try {
      const status = await this.#guard.status(operationId); requireValue(status.state === "RUNNING", "NativeProgressStopped");
      const input = structuredClone(verifyReserveInput);
      requireValue(input.minimumConfirmations === this.#policy.minimumConfirmations, "NativeReserveBasisFinalityInsufficient");
      const receipt = await this.#verifier.verifyReserve(input);
      const old = this.#read(), next = retainVerifiedReserveBasis(old.value, receipt, operationId, this.#policy);
      if (next.incident) {
        this.#stopped = true;
        try { this.#write(next, old.revision); }
        finally { await this.#guard.report(digest(this.#policy), "NATIVE_DEEP_REORG", next.incident.evidenceDigest); }
        throw new Error("NativeProgressStopped");
      }
      requireValue((await this.#guard.status(operationId)).state === "RUNNING", "NativeProgressStopped");
      this.#write(next, old.revision); return Object.freeze({ state: "ACCEPTED_BASIS_RETAINED", operationId, evidenceDigest: receipt.digestHex });
    } catch (error) {
      if (["NativeReserveBasisConflict", "NativeProgressRejected", "ProtectedStateRollbackDetected"].includes(error.message)) {
        this.#stopped = true; await this.#guard.report(digest(this.#policy), "NATIVE_PROGRESS_INTEGRITY", digest({ reason: error.message }));
      }
      throw new Error("NativeReserveBasisNotRetained");
    } finally { this.#busy = false; }
  }
  async poll() {
    requireValue(!this.#busy && !this.#closed, "NativeProtectedProgressUnavailable"); this.#busy = true;
    let ticket;
    try {
      const old = this.#read();
      if (old.value.incident) {
        this.#stopped = true;
        await this.#guard.report(digest(this.#policy), "NATIVE_DEEP_REORG", old.value.incident.evidenceDigest);
        return Object.freeze({ state: "HARD_STOP_INTEGRITY", affectedReserveAtomic: old.value.incident.affectedReserveAtomic });
      }
      ticket = await this.#guard.beginSourceCheck(digest(this.#policy));
      const observed = await this.#verifier.observeChain(); requireVerifiedRegtestChain(observed);
      const next = compareNativeProgress(old.value, observed, this.#policy);
      if (next.incident) {
        this.#stopped = true;
        // Persist evidence before acknowledgement. If this write fails, the
        // independently protected global authority must still receive the stop.
        try { this.#write(next.progress, old.revision); }
        finally { await this.#guard.report(digest(this.#policy), "NATIVE_DEEP_REORG", next.incident.evidenceDigest); }
        return Object.freeze({ state: "HARD_STOP_INTEGRITY", affectedReserveAtomic: next.incident.affectedReserveAtomic });
      }
      if (next.state === "OBSERVED_MATCH") this.#write(next.progress, old.revision);
      const global = await this.#guard.finishSourceCheck(ticket, { state: next.state, evidenceDigest: digest(next.progress) }); ticket = undefined;
      if (global.state === "HARD_STOP_INTEGRITY") this.#stopped = true;
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : next.state, reason: next.reason });
    } catch (error) {
      const code = error.message === "RAW_NATIVE_WRONG_GENESIS" ? "NATIVE_GENESIS_CHANGED" :
        ["NativeProgressRejected", "NativeProgressClockRollback", "ProtectedStateRollbackDetected"].includes(error.message) ? "NATIVE_PROGRESS_INTEGRITY" : undefined;
      if (code) { this.#stopped = true; await this.#guard.report(digest(this.#policy), code, digest({ reason: error.message })); }
      else if (ticket) {
        try { await this.#guard.finishSourceCheck(ticket, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: digest(this.#policy) }); } catch { /* Authorization remains suspended; no fabricated contradiction. */ }
      }
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "WAITING_FOR_DEPENDENCY", reason: "NATIVE_OBSERVATION_UNAVAILABLE" });
    } finally { this.#busy = false; }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    requireValue(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 30000);
    while (!signal.aborted && !this.#closed) { await onStatus(await this.poll());
      try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("NativeMonitorInterrupted"); } }
  }
}
