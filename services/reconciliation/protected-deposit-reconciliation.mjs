// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { requireDepositSnapshotClient } from "../bridge-validator/protected-deposit-snapshot.mjs";
import { depositOperationPolicyDigest } from "../bridge-validator/deposit-operation-state.mjs";
import { deploymentManifestDigest } from "../solana-observer/deployment-integrity.mjs";
import { DEPOSIT_RECONCILIATION_PROTOCOL, validateReconciliationBinding, readDepositReconciliation } from "./deposit-reconciliation.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const check = (v, code = "ReconciliationProgressRejected") => { if (!v) throw new Error(code); };
const digest = v => createHash("sha256").update(canonicalJson(v)).digest("hex");
const bytesDigest = v => createHash("sha256").update(v).digest("hex");
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
function uint(v) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v) && BigInt(v) <= 0xffff_ffff_ffff_ffffn); return BigInt(v); }
function incident(v) {
  fields(v, ["reason", "evidenceDigest", "affectedOperations", "affectedReserveAtomic"]);
  check(typeof v.reason === "string" && /^[A-Z_]{1,80}$/u.test(v.reason) && HASH.test(v.evidenceDigest));
  check(Array.isArray(v.affectedOperations) && v.affectedOperations.length <= 64 && v.affectedOperations.every(id => HASH.test(id)) && new Set(v.affectedOperations).size === v.affectedOperations.length);
  check(typeof v.affectedReserveAtomic === "string" && /^(0|[1-9][0-9]{0,38})$/u.test(v.affectedReserveAtomic) && BigInt(v.affectedReserveAtomic) < (1n << 128n));
}
// A lower authenticated journal revision is not an ordinary stale RPC bank.
// Retained protected progress supplies the monotonic comparison after restart.
export function requireReconciliationJournalRevision(current, retained) {
  if (uint(current) < uint(retained)) {
    const error = new Error("ReconciliationConfirmedContradiction");
    error.incident = { reason: "AUTHENTICATED_JOURNAL_ROLLBACK", evidenceDigest: digest({ current, retained }),
      affectedOperations: [], affectedReserveAtomic: "0" };
    throw error;
  }
}
export function initialReconciliationProgress(policy, manifest) {
  const { policy: p, manifest: m } = validateReconciliationBinding(policy, manifest);
  return Buffer.from(JSON.stringify({ protocol: DEPOSIT_RECONCILIATION_PROTOCOL, policyDigest: depositOperationPolicyDigest(p), manifestDigest: deploymentManifestDigest(m),
    nativeGenesis: p.nativeGenesis, solanaGenesis: p.solanaGenesis, journalRevision: "0", native: null,
    solanaSlot: p.minimumSolanaSlot, solanaSnapshotDigest: null, observedAt: 0, nativeAdvanceAt: 0, solanaAdvanceAt: 0, evidenceDigest: null, incident: null }));
}
export function decodeReconciliationProgress(bytes, policy, manifest, now = Date.now()) {
  const { policy: p, manifest: m } = validateReconciliationBinding(policy, manifest);
  check(bytes instanceof Uint8Array && bytes.length <= 32000);
  const text = Buffer.from(bytes).toString("utf8"), v = JSON.parse(text); check(JSON.stringify(v) === text);
  fields(v, ["protocol", "policyDigest", "manifestDigest", "nativeGenesis", "solanaGenesis", "journalRevision", "native", "solanaSlot", "solanaSnapshotDigest",
    "observedAt", "nativeAdvanceAt", "solanaAdvanceAt", "evidenceDigest", "incident"]);
  check(v.protocol === DEPOSIT_RECONCILIATION_PROTOCOL && v.policyDigest === depositOperationPolicyDigest(p) && v.manifestDigest === deploymentManifestDigest(m) &&
    v.nativeGenesis === p.nativeGenesis && v.solanaGenesis === p.solanaGenesis);
  uint(v.journalRevision); check(uint(v.solanaSlot) >= uint(p.minimumSolanaSlot));
  check(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(v.observedAt) && v.observedAt >= 0 && v.observedAt <= now);
  for (const name of ["nativeAdvanceAt", "solanaAdvanceAt"]) check(Number.isSafeInteger(v[name]) && v[name] >= 0 && v[name] <= v.observedAt);
  if (v.native === null) check(v.journalRevision === "0" && v.observedAt === 0 && v.evidenceDigest === null && v.solanaSnapshotDigest === null);
  else {
    fields(v.native, ["height", "tipHash", "chainworkHex"]);
    check(Number.isInteger(v.native.height) && v.native.height > 0 && v.native.height <= 4096 && HASH.test(v.native.tipHash) && HASH.test(v.native.chainworkHex) && BigInt("0x" + v.native.chainworkHex) > 0n);
    check(uint(v.journalRevision) > 0n && v.observedAt > 0 && v.nativeAdvanceAt > 0 && v.solanaAdvanceAt > 0 && HASH.test(v.evidenceDigest) && HASH.test(v.solanaSnapshotDigest));
  }
  if (v.incident !== null) incident(v.incident);
  return v;
}

export class ProtectedDepositReconciliationMonitor {
  #policy; #manifest; #client; #native; #solana; #guard; #store; #lease; #revision; #pending; #closed = false; #busy = false; #stopped = false; #id;
  static async open({ policy, manifest, journalClient, nativeVerifier, solanaRpc, integrity, store }) {
    const self = new ProtectedDepositReconciliationMonitor(), binding = validateReconciliationBinding(policy, manifest);
    self.#policy = binding.policy; self.#manifest = binding.manifest;
    requireDepositSnapshotClient(journalClient, self.#policy); requireIntegrityGuard(integrity, "RECONCILIATION");
    assertWindowsProtectedStore(store, "RECONCILIATION", "reconciliation-progress");
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    self.#client = journalClient; self.#native = nativeVerifier; self.#solana = solanaRpc; self.#guard = integrity; self.#store = store;
    self.#id = digest([depositOperationPolicyDigest(policy), deploymentManifestDigest(manifest)]);
    try { self.#lease = await store.acquireLifetimeLease(); self.#read(); return self; }
    catch (error) { try { await self.#reportStorage(error); } finally { await self.close(); } throw new Error("ReconciliationMonitorUnavailable"); }
  }
  #read() {
    check(!this.#closed); this.#lease.assertHeld(); const r = this.#store.read();
    try {
      const value = decodeReconciliationProgress(r.payload, this.#policy, this.#manifest);
      if (this.#revision !== undefined && r.revision !== this.#revision) check(this.#pending && BigInt(r.revision) === BigInt(this.#revision) + 1n && bytesDigest(r.payload) === this.#pending);
      this.#revision = r.revision; this.#pending = undefined;
      if (value.incident) this.#stopped = true;
      return { value, revision: r.revision };
    } catch { const error = new Error("ReconciliationAuthenticatedProgressInvalid"); error.evidenceDigest = bytesDigest(r.payload); throw error; }
    finally { r.payload.fill(0); }
  }
  #write(value, revision) {
    const bytes = Buffer.from(JSON.stringify(value));
    try { decodeReconciliationProgress(bytes, this.#policy, this.#manifest); this.#lease.assertHeld();
      this.#pending = bytesDigest(bytes); this.#revision = this.#store.write(bytes, revision).revision; this.#pending = undefined;
    } finally { bytes.fill(0); }
  }
  async #reportStorage(error) {
    if (!["ProtectedStateRollbackDetected", "ReconciliationAuthenticatedProgressInvalid", "ProtectedLifetimeLeaseLost", "DepositSnapshotRollbackDetected"].includes(error?.message)) return;
    this.#stopped = true;
    await this.#guard.report(this.#id, "JOURNAL_INTEGRITY_FAILURE", error.evidenceDigest ?? digest(error.message));
  }
  async poll() {
    check(!this.#busy && !this.#closed, "ReconciliationMonitorUnavailable"); this.#busy = true;
    let ticket, journal;
    try {
      const old = this.#read();
      if (old.value.incident) {
        await this.#guard.report(this.#id, "RECONCILIATION_CONTRADICTION", old.value.incident.evidenceDigest);
        return Object.freeze({ state: "HARD_STOP_INTEGRITY", reason: old.value.incident.reason });
      }
      // A potentially multi-page authenticated journal read happens before the
      // one-use health challenge. It is checked again after the actual chains.
      journal = await this.#client.read(); requireReconciliationJournalRevision(journal.revision, old.value.journalRevision);
      ticket = await this.#guard.beginSourceCheck(this.#id);
      const result = await readDepositReconciliation({ policy: this.#policy, manifest: this.#manifest, operations: journal.operations,
        nativeVerifier: this.#native, solanaRpc: this.#solana, minimumSlot: old.value.solanaSlot });
      await this.#client.assertCurrent(journal);
      if (result.state !== "OBSERVED_MATCH") {
        await this.#guard.finishSourceCheck(ticket, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: this.#id }); ticket = undefined; return result;
      }
      const now = Date.now(), work = BigInt("0x" + result.nativeChainworkHex), before = old.value.native;
      check(!before || work > BigInt("0x" + before.chainworkHex) || (work === BigInt("0x" + before.chainworkHex) && result.nativeTipHash === before.tipHash), "ReconciliationNativeSnapshotStale");
      check(uint(result.solanaSlot) >= uint(old.value.solanaSlot), "ReconciliationSolanaSnapshotStale");
      if (old.value.solanaSnapshotDigest !== null && result.solanaSlot === old.value.solanaSlot && result.solanaSnapshotDigest !== old.value.solanaSnapshotDigest) {
        const error = new Error("ReconciliationConfirmedContradiction");
        error.incident = { reason: "CONFLICTING_FINALIZED_SOLANA_SNAPSHOT", evidenceDigest: digest([old.value.solanaSnapshotDigest, result.solanaSnapshotDigest]), affectedOperations: [], affectedReserveAtomic: "0" }; throw error;
      }
      const nativeAdvanceAt = !before || work > BigInt("0x" + before.chainworkHex) ? now : old.value.nativeAdvanceAt;
      const solanaAdvanceAt = old.value.solanaSnapshotDigest === null || uint(result.solanaSlot) > uint(old.value.solanaSlot) ? now : old.value.solanaAdvanceAt;
      check(now >= old.value.observedAt && now - nativeAdvanceAt <= this.#manifest.maximumStallMs && now - solanaAdvanceAt <= this.#manifest.maximumStallMs, "ReconciliationSourceStale");
      this.#write({ ...old.value, journalRevision: journal.revision, native: { height: result.nativeHeight, tipHash: result.nativeTipHash, chainworkHex: result.nativeChainworkHex },
        solanaSlot: result.solanaSlot, solanaSnapshotDigest: result.solanaSnapshotDigest, observedAt: now, nativeAdvanceAt, solanaAdvanceAt, evidenceDigest: result.evidenceDigest }, old.revision);
      const global = await this.#guard.finishSourceCheck(ticket, { state: "OBSERVED_MATCH", evidenceDigest: result.evidenceDigest }); ticket = undefined;
      if (global.state === "HARD_STOP_INTEGRITY") this.#stopped = true;
      return Object.freeze({ ...result, state: this.#stopped ? "HARD_STOP_INTEGRITY" : result.state });
    } catch (error) {
      if (["SOLANA_GENESIS_CHANGED", "SOLANA_DEPLOYMENT_CHANGED", "FINALIZED_SOLANA_CONFLICT"].includes(error?.integrityCode) || error.message === "RAW_NATIVE_WRONG_GENESIS") {
        error.incident = { reason: error.integrityCode ?? "NATIVE_GENESIS_CHANGED", evidenceDigest: error.evidenceDigest ?? digest(error.message), affectedOperations: [], affectedReserveAtomic: "0" };
        error.message = "ReconciliationConfirmedContradiction";
      }
      if (error.message === "ReconciliationConfirmedContradiction") {
        // A valid concurrent journal update can explain a changed chain total.
        // Establish the same revision before persisting a financial incident.
        try { check(journal); await this.#client.assertCurrent(journal); }
        catch {
          if (ticket) { try { await this.#guard.finishSourceCheck(ticket, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: this.#id }); } catch { /* No new permission. */ } }
          return Object.freeze({ state: "WAITING_FOR_DEPENDENCY", reason: "RECONCILIATION_JOURNAL_CHANGED_OR_UNAVAILABLE" });
        }
        incident(error.incident); this.#stopped = true;
        try { const old = this.#read(); this.#write({ ...old.value, incident: error.incident }, old.revision); }
        finally { await this.#guard.report(this.#id, "RECONCILIATION_CONTRADICTION", error.incident.evidenceDigest); }
        return Object.freeze({ state: "HARD_STOP_INTEGRITY", reason: error.incident.reason });
      }
      try { if (this.#pending) this.#read(); } catch (readError) { await this.#reportStorage(readError); throw readError; }
      await this.#reportStorage(error);
      if (ticket) { try { await this.#guard.finishSourceCheck(ticket, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: this.#id }); } catch { /* No stale health acknowledgement is granted. */ } }
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "WAITING_FOR_DEPENDENCY", reason: "RECONCILIATION_OBSERVATION_UNAVAILABLE" });
    } finally { this.#busy = false; }
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 30000);
    while (!signal.aborted && !this.#closed) { await onStatus(await this.poll());
      try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("ReconciliationMonitorInterrupted"); } }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
