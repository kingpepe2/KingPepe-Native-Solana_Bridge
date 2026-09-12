// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Progress-codec tests only. Actual Windows persistence is a separate suite.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconciliationFixture } from "../../../tests/integration/reconciliation-fixture.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";
import { mayReport } from "../../../shared/service-integrity-policy.mjs";
import { initialReconciliationProgress, decodeReconciliationProgress, ProtectedDepositReconciliationMonitor, requireReconciliationJournalRevision } from "../protected-deposit-reconciliation.mjs";
const { policy, manifest } = reconciliationFixture();
const empty = () => JSON.parse(initialReconciliationProgress(policy, manifest));
const decode = v => decodeReconciliationProgress(Buffer.from(JSON.stringify(v)), policy, manifest);
function progress() { return { ...empty(), native: { height: 120, tipHash: "a1".repeat(32), chainworkHex: "00".repeat(31) + "ff" },
  journalRevision: "2", observedAt: 100, nativeAdvanceAt: 100, solanaAdvanceAt: 100, solanaSlot: "10", solanaSnapshotDigest: "b1".repeat(32), evidenceDigest: "c1".repeat(32) }; }
test("reconciliation enrollment starts without any cached healthy observation", () => {
  const v = decode(empty()); assert.equal(v.native, null); assert.equal(v.observedAt, 0); assert.equal(v.incident, null);
});
test("network-bound last accepted reconciliation progress roundtrips exactly", () => assert.deepEqual(decode(progress()), progress()));
test("authenticated journal revision rollback is an incident, not an RPC outage", () => {
  assert.throws(() => requireReconciliationJournalRevision("9", "10"),
    error => error.incident?.reason === "AUTHENTICATED_JOURNAL_ROLLBACK" && error.incident.affectedReserveAtomic === "0");
  requireReconciliationJournalRevision("10", "10"); requireReconciliationJournalRevision("11", "10");
});
test("journal freshness never uses unsafe numeric revision conversion", () => {
  const current = "9007199254740992", retained = "9007199254740993";
  assert.throws(() => requireReconciliationJournalRevision(current, retained), error => error.incident?.reason === "AUTHENTICATED_JOURNAL_ROLLBACK");
  for (const bad of [-1, "01", "18446744073709551616"]) assert.throws(() => requireReconciliationJournalRevision(bad, retained));
});
for (const [name, change] of [
  ["wrong genesis", v => { v.nativeGenesis = "a2".repeat(32); }],
  ["wrong Solana genesis", v => { v.solanaGenesis = "11111111111111111111111111111111"; }],
  ["old policy", v => { v.policyDigest = "a2".repeat(32); }],
  ["old manifest", v => { v.manifestDigest = "a2".repeat(32); }],
  ["slot below enrollment", v => { v.solanaSlot = "0"; }],
  ["missing journal revision", v => { v.journalRevision = "0"; }],
  ["negative height", v => { v.native.height = -1; }],
  ["zero work", v => { v.native.chainworkHex = "00".repeat(32); }],
  ["unsafe slot number", v => { v.solanaSlot = 10; }],
  ["future local time", v => { v.observedAt = Date.now() + 100000; }],
  ["future chain advance", v => { v.nativeAdvanceAt = v.observedAt + 1; }],
  ["pretend RUNNING flag", v => { v.running = true; }],
]) test("reconciliation progress rejects " + name, () => { const v = progress(); change(v); assert.throws(() => decode(v)); });
test("reconciliation incident persists exact affected value without a reset field", () => {
  const v = progress(); v.incident = { reason: "ACCEPTED_NATIVE_BASIS_INVALIDATED", evidenceDigest: "d1".repeat(32), affectedOperations: ["e1".repeat(32)], affectedReserveAtomic: "100" };
  assert.deepEqual(decode(v), v); v.incident.clear = true; assert.throws(() => decode(v));
});
test("reconciliation rejects duplicate incident IDs and unbounded values", () => {
  const v = progress(); v.incident = { reason: "RESERVE_DEFICIT", evidenceDigest: "d1".repeat(32), affectedOperations: ["e1".repeat(32), "e1".repeat(32)], affectedReserveAtomic: "100" };
  assert.throws(() => decode(v)); v.incident.affectedOperations.pop(); v.incident.affectedReserveAtomic = (1n << 128n).toString(); assert.throws(() => decode(v));
});
test("reconciliation rejects alternate persisted serialization and oversized data", () => {
  const b = initialReconciliationProgress(policy, manifest);
  for (const bytes of [Buffer.concat([b, Buffer.from(" ")]), Buffer.alloc(32001), Buffer.from("{"), Buffer.from(b.toString().replace('"incident":null', '"incident":null,"incident":null'))])
    assert.throws(() => decodeReconciliationProgress(bytes, policy, manifest));
});
test("reconciliation progress purpose cannot be reused by signers or coordinator", () => {
  const context = { role: "RECONCILIATION", purpose: "reconciliation-progress", serviceSid: "S-1-5-21-1-2-3-1001", environment: "localnet",
    nativeGenesis: policy.nativeGenesis, solanaDeployment: policy.solanaDeployment, keyEpoch: 1, instanceId: "12".repeat(32) };
  assert.equal(normalizeProtectedContext(context).role, "RECONCILIATION");
  for (const role of ["COORDINATOR", "KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "ATTESTER_A", "RELAYER", "INDEXER", "BRIDGE_VALIDATOR"])
    assert.throws(() => normalizeProtectedContext({ ...context, role }), /ProtectedRolePurposeInvalid/u);
});
test("only reconciliation can report its authenticated contradiction category", () => {
  assert(mayReport("RECONCILIATION", "RECONCILIATION_CONTRADICTION"));
  for (const role of ["COORDINATOR", "INDEXER", "RELAYER", "BRIDGE_VALIDATOR"]) assert.equal(mayReport(role, "RECONCILIATION_CONTRADICTION"), false);
});
test("protected monitor rejects unregistered journal clients before accessing storage", async () => {
  let accessed = false;
  await assert.rejects(ProtectedDepositReconciliationMonitor.open({ policy, manifest, journalClient: {}, store: { read() { accessed = true; } } }), /DepositSnapshotRejected/u);
  assert.equal(accessed, false);
});
