// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { WindowsProtectedStore, assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { INTEGRITY_PROTOCOL, INTEGRITY_ROLES, mayPerform, mayReport } from "../../shared/service-integrity-policy.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const GUARDS = new WeakSet();
function requireValue(value, code = "IntegrityStateRejected") { if (!value) throw new Error(code); }
function uint(value) { requireValue(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn); return BigInt(value); }
function increment(value) { requireValue(uint(value) < 0xffff_ffff_ffff_ffffn); return (uint(value) + 1n).toString(); }
function fields(value, keys) { requireValue(value && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join()); }

// One explicit, exclusively leased authority. This is localnet enrollment only;
// it does not install services, authorize production or create missing state.
export class ProtectedIntegrityAuthority {
  #store; #lease; #generation; #closed = false; #stopped = false;
  constructor(store) { assertWindowsProtectedStore(store, "SUPERVISOR", "global-integrity"); requireValue(store.context.environment === "localnet"); this.#store = store; }
  static async createLocal(options, initialState = "PAUSED_POLICY") {
    options = structuredClone(options); // One immutable enrollment input snapshot.
    requireValue(options?.context?.environment === "localnet" && options.context.role === "SUPERVISOR" && options.context.purpose === "global-integrity", "IntegrityLocalEnrollmentRequired");
    requireValue(["RUNNING", "PAUSED_POLICY"].includes(initialState));
    const bytes = Buffer.from(JSON.stringify({ protocol: INTEGRITY_PROTOCOL, state: initialState, generation: "0", lastTimeMs: Date.now(), incidents: [] }));
    let store; try { store = WindowsProtectedStore.create(options, bytes); } finally { bytes.fill(0); }
    return ProtectedIntegrityAuthority.openLocal(store);
  }
  static async openLocal(store) {
    const authority = new ProtectedIntegrityAuthority(store);
    try {
      authority.#lease = await store.acquireLifetimeLease();
      const { state, revision } = authority.#read(); state.generation = increment(state.generation);
      authority.#write(state, revision); authority.#generation = state.generation; return authority;
    } catch { await authority.close(); throw new Error("IntegrityAuthorityUnavailable"); }
  }
  #read() {
    requireValue(!this.#closed && this.#lease, "IntegrityAuthorityUnavailable"); this.#lease.assertHeld();
    const result = this.#store.read(); let state;
    try { state = JSON.parse(result.payload.toString("utf8")); } catch { throw new Error("IntegrityStateRejected"); }
    finally { result.payload.fill(0); }
    fields(state, ["protocol", "state", "generation", "lastTimeMs", "incidents"]);
    requireValue(state.protocol === INTEGRITY_PROTOCOL && ["RUNNING", "PAUSED_POLICY", "HARD_STOP_INTEGRITY"].includes(state.state));
    uint(state.generation); if (this.#generation !== undefined) requireValue(state.generation === this.#generation);
    requireValue(Number.isSafeInteger(state.lastTimeMs) && state.lastTimeMs >= 0 && state.lastTimeMs <= Date.now(), "IntegrityClockRollback");
    requireValue(Array.isArray(state.incidents) && state.incidents.length <= 64);
    requireValue((state.state === "HARD_STOP_INTEGRITY") === (state.incidents.length > 0));
    requireValue(!this.#stopped || state.state === "HARD_STOP_INTEGRITY", "IntegrityStopRollback");
    if (state.state === "HARD_STOP_INTEGRITY") this.#stopped = true;
    for (const incident of state.incidents) {
      fields(incident, ["role", "code", "operationId", "evidenceDigest"]);
      requireValue(mayReport(incident.role, incident.code) && HASH.test(incident.operationId) && HASH.test(incident.evidenceDigest));
    }
    return { state, revision: result.revision };
  }
  #write(state, revision) {
    state.lastTimeMs = Date.now(); const bytes = Buffer.from(JSON.stringify(state));
    try { this.#lease.assertHeld(); return this.#store.write(bytes, revision).revision; } finally { bytes.fill(0); }
  }
  status() {
    const { state, revision } = this.#read();
    return Object.freeze({ protocol: INTEGRITY_PROTOCOL, state: state.state, generation: state.generation, revision, incidentCount: state.incidents.length });
  }
  handle({ method, peerRole, operationId, payload }) {
    requireValue(INTEGRITY_ROLES.includes(peerRole) && typeof operationId === "string" && HASH.test(operationId), "IntegrityRoleRejected");
    if (method === "integrityStatus") { fields(payload, []); return this.status(); }
    if (method === "assertRunning") {
      fields(payload, ["action"]); requireValue(mayPerform(peerRole, payload.action), "IntegrityActionRejected");
      const status = this.status(); requireValue(status.state === "RUNNING", "IntegrityAuthorizationStopped");
      return { ...status, operationId, action: payload.action, role: peerRole };
    }
    requireValue(method === "reportContradiction", "IntegrityMethodRejected");
    fields(payload, ["code", "evidenceDigest"]);
    requireValue(mayReport(peerRole, payload.code) && typeof payload.evidenceDigest === "string" && HASH.test(payload.evidenceDigest), "IntegrityReportRejected");
    let current;
    try { current = this.#read(); } catch (error) { this.#stopped = true; throw error; }
    const { state, revision } = current;
    const incident = { role: peerRole, code: payload.code, operationId, evidenceDigest: payload.evidenceDigest };
    // A confirmed report must latch this process even when its durable write
    // cannot finish. Failure is never acknowledged as a persisted stop.
    this.#stopped = true;
    if (!state.incidents.some(value => JSON.stringify(value) === JSON.stringify(incident))) {
      requireValue(state.incidents.length < 64, "IntegrityIncidentCapacity");
      state.state = "HARD_STOP_INTEGRITY"; state.incidents.push(incident); this.#write(state, revision);
    }
    // Persistence completes before the reporting service receives acknowledgement.
    return this.status();
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store.close(); }
}

// No cached RUNNING permission, reset/clear/resume method, plaintext fallback or
// validator assertion-as-authority. Every sensitive boundary contacts the pinned
// supervisor. Previously dispatched blockchain transactions cannot be revoked.
export class RemoteIntegrityGuard {
  #ipc; #port; #revision = 0n; #generation = 0n; #stopped = false;
  constructor({ ipc, port }) {
    requireValue(ipc instanceof ProtectedServiceIpc && ipc.peerRole === "SUPERVISOR" && INTEGRITY_ROLES.includes(ipc.role), "IntegrityTransportRequired");
    this.#ipc = ipc; this.#port = port; GUARDS.add(this);
  }
  get role() { return this.#ipc.role; }
  assertDeployment(expected) {
    fields(expected, ["environment", "nativeGenesis", "solanaDeployment", "keyEpoch"]);
    requireValue(Object.entries(expected).every(([key, value]) => value === this.#ipc.deployment[key]), "IntegrityDeploymentRejected");
  }
  #observe(value) {
    requireValue(value?.protocol === INTEGRITY_PROTOCOL && ["RUNNING", "PAUSED_POLICY", "HARD_STOP_INTEGRITY"].includes(value.state));
    requireValue(!this.#stopped || value.state === "HARD_STOP_INTEGRITY", "IntegrityStopRollback");
    if (value.state === "HARD_STOP_INTEGRITY") this.#stopped = true;
    const revision = uint(value.revision), generation = uint(value.generation);
    requireValue(revision > 0n && generation > 0n && revision >= this.#revision && generation >= this.#generation, "IntegrityResponseRollback");
    this.#revision = revision; this.#generation = generation; return value;
  }
  async status(operationId) { return this.#observe(await this.#ipc.request(this.#port, { method: "integrityStatus", operationId, payload: {} })); }
  async assertRunning(operationId, action) {
    requireValue(mayPerform(this.role, action), "IntegrityActionRejected");
    const result = this.#observe(await this.#ipc.request(this.#port, { method: "assertRunning", operationId, payload: { action } }));
    requireValue(result.state === "RUNNING" && result.operationId === operationId && result.action === action && result.role === this.role, "IntegrityAuthorizationStopped");
  }
  async report(operationId, code, evidenceDigest) {
    requireValue(mayReport(this.role, code), "IntegrityReportRejected");
    const result = this.#observe(await this.#ipc.request(this.#port, { method: "reportContradiction", operationId, payload: { code, evidenceDigest } }));
    requireValue(result.state === "HARD_STOP_INTEGRITY", "IntegrityStopNotAcknowledged"); return result;
  }
}
export function requireIntegrityGuard(guard, role) {
  requireValue(GUARDS.has(guard) && guard.role === role, "AuthenticatedIntegrityGuardRequired");
}
