// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProtectedContext, protectedContextDigest, assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { validateRetainedIntegrityIncidents, MAX_RETAINED_INTEGRITY_INCIDENTS } from "../../shared/service-integrity-policy.mjs";
import { ProtectedServiceIpc, isProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { ProtectedRemoteFrostPeer, isProtectedRemoteFrostPeer } from "../../native/frost/signer/protected-service.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";

const context = () => ({ role: "KINGPEPE_FROST_A", purpose: "frost-state", serviceSid: "S-1-5-21-1-2-3-1001",
  environment: "localnet", nativeGenesis: "01".repeat(32), solanaDeployment: "02".repeat(32), instanceId: "03".repeat(32), keyEpoch: 1 });

test("protected context has exact immutable fields and rejects getters/proxies", () => {
  const c = context(); const copy = normalizeProtectedContext(c); c.role = "COORDINATOR";
  assert.equal(copy.role, "KINGPEPE_FROST_A"); assert(Object.isFrozen(copy));
  assert.throws(() => normalizeProtectedContext(new Proxy(context(), {})));
  assert.throws(() => normalizeProtectedContext({ ...context(), unexpected: true }));
  let invoked = false; const getter = context(); Object.defineProperty(getter, "keyEpoch", { get() { invoked = true; return 1; } });
  assert.throws(() => normalizeProtectedContext(getter)); assert.equal(invoked, false);
});
test("protected context binds role purpose identity network deployment instance and epoch", () => {
  const base = protectedContextDigest(context());
  for (const change of [{ role: "KINGPEPE_FROST_B" }, { purpose: "service-auth" }, { serviceSid: "S-1-5-21-1-2-3-1002" },
    { environment: "mainnet" }, { nativeGenesis: "04".repeat(32) }, { solanaDeployment: "05".repeat(32) }, { instanceId: "06".repeat(32) }, { keyEpoch: 2 }]) {
    assert.notEqual(protectedContextDigest({ ...context(), ...change }), base);
  }
});
test("protected context rejects malformed identities epoch and cross-role key purposes", () => {
  for (const change of [{ role: "COORDINATOR" }, { purpose: "attester-seed" }, { serviceSid: "local-user" },
    { nativeGenesis: "00".repeat(32) }, { environment: "MAINNET" }, { keyEpoch: 0 }, { keyEpoch: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => normalizeProtectedContext({ ...context(), ...change }));
  }
});
test("protected adapters reject caller-forged store capabilities", () => {
  assert.throws(() => assertWindowsProtectedStore({ context: context(), read() { throw new Error("MUST_NOT_READ"); } }, "KINGPEPE_FROST_A", "frost-state"), /ProtectedStoreRoleMismatch/u);
});

function forgedTransport(peerRole) {
  const fake = Object.create(ProtectedServiceIpc.prototype);
  Object.defineProperties(fake, { role: { value: "COORDINATOR" }, peerRole: { value: peerRole }, request: { value: async () => ({ state: "RUNNING" }) } });
  return fake;
}
test("supervisor guard rejects prototype-forged authenticated transport", () => {
  assert.throws(() => new RemoteIntegrityGuard({ ipc: forgedTransport("SUPERVISOR"), port: 1 }), /IntegrityTransportRequired/u);
});
test("remote FROST peer rejects prototype-forged authenticated transport", () => {
  assert.throws(() => new ProtectedRemoteFrostPeer({ ipc: forgedTransport("KINGPEPE_FROST_A"), port: 1, signerId: "KINGPEPE_FROST_A" }), /IpcSignerBindingRejected/u);
});
test("protected transport and remote peer brands cannot be forged by prototype or proxy", () => {
  const fake = forgedTransport("SUPERVISOR"), peer = Object.create(ProtectedRemoteFrostPeer.prototype);
  assert.equal(isProtectedServiceIpc(fake), false);
  assert.equal(isProtectedServiceIpc(new Proxy(fake, {})), false);
  assert.equal(isProtectedRemoteFrostPeer(peer), false);
  assert.equal(isProtectedRemoteFrostPeer(new Proxy(peer, {})), false);
});

const incident = () => ({ role: "COORDINATOR", code: "COORDINATOR_JOURNAL_INTEGRITY", operationId: "01".repeat(32), evidenceDigest: "02".repeat(32) });
test("retained integrity incidents are immutable exact role-bound metadata", () => {
  const input = [incident()], result = validateRetainedIntegrityIncidents(input, "COORDINATOR");
  input[0].code = "SOURCE_UNAVAILABLE";
  assert.equal(result[0].code, "COORDINATOR_JOURNAL_INTEGRITY");
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result[0]));
});
for (const [name, change] of [
  ["wrong role", v => { v[0].role = "KINGPEPE_FROST_A"; }],
  ["unauthorized code", v => { v[0].code = "SOLANA_DEPLOYMENT_CHANGED"; }],
  ["unavailability is not contradiction", v => { v[0].code = "SOURCE_UNAVAILABLE"; }],
  ["wrong operation", v => { v[0].operationId = "bad"; }],
  ["noncanonical evidence", v => { v[0].evidenceDigest = "AA".repeat(32); }],
  ["unexpected field", v => { v[0].clear = true; }],
  ["missing field", v => { delete v[0].evidenceDigest; }],
  ["duplicate incident", v => { v.push(incident()); }],
  ["array record", v => { v[0] = []; }],
  ["null record", v => { v[0] = null; }],
]) test("integrity incident metadata rejects " + name, () => {
  const value = [incident()]; change(value);
  assert.throws(() => validateRetainedIntegrityIncidents(value, "COORDINATOR"), /IntegrityOutboxRejected/u);
});
test("integrity outbox has a fixed capacity without silent pruning", () => {
  const records = Array.from({ length: MAX_RETAINED_INTEGRITY_INCIDENTS }, (_, i) => ({ ...incident(), operationId: i.toString(16).padStart(64, "0") }));
  assert.equal(validateRetainedIntegrityIncidents(records, "COORDINATOR").length, 64);
  records.push({ ...incident(), operationId: "ff".repeat(32) });
  assert.throws(() => validateRetainedIntegrityIncidents(records, "COORDINATOR"));
  assert.throws(() => validateRetainedIntegrityIncidents({}, "COORDINATOR"));
});
