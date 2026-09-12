// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Codec tests use real ephemeral FROST signatures and synthetic chain facts.
// They do not certify protected persistence or a Native network broadcast.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { depositOperationFixture } from "../../../tests/integration/deposit-operation-fixture.mjs";
import { initialNativeSweepOutbox, decodeNativeSweepOutbox, validateNativeSweepDelivery,
  ProtectedNativeSweepOutbox, requireNativeSweepOutbox } from "../native-sweep-outbox.mjs";
import { ProtectedNativeSweepClient, requireNativeSweepClient, validateNativeSweepResponse } from "../native-sweep-ipc.mjs";
import { parseNativeTransactionHex } from "../../../native/node/native-taproot-transaction.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../../.."), hash = v => createHash("sha256").update(v).digest("hex");
let root, fixture;
before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-outbox-unit-"));
  fixture = await depositOperationFixture({ root, repoRoot });
});
after(() => {
  if (!root) return;
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("kingpepe-native-outbox-unit-"));
  rmSync(root, { recursive: true, force: true });
});
const delivery = () => structuredClone({ plan: fixture.plan, signedTransactionHex: fixture.signedTransactionHex });
const state = () => {
  const value = JSON.parse(initialNativeSweepOutbox(fixture.policy));
  value.records.push({ ...delivery(), sendAttempts: 0, lastSendAt: 0, retryAfter: 0, observed: false });
  return value;
};
const decode = (value, now = 100000) => decodeNativeSweepOutbox(Buffer.from(JSON.stringify(value)), fixture.policy, now);
test("Native outbox keeps exact signed bytes without prematurely granting credit or finality", () => {
  const value = decode(state()); assert.equal(value.records[0].signedTransactionHex, fixture.signedTransactionHex);
  assert.equal(value.records[0].observed, false); assert.equal(value.records[0].sendAttempts, 0);
  assert(!Object.hasOwn(value.records[0], "finalizedCredit"));
});
test("Native delivery capture cannot be modified after caller admission", () => {
  const input = delivery(), snapshot = validateNativeSweepDelivery(input, fixture.policy);
  input.plan.depositIntent.amountAtomic = "1"; assert.equal(snapshot.plan.depositIntent.amountAtomic, fixture.plan.depositIntent.amountAtomic);
});
test("Native outbox retains sent uncertainty and exact acknowledgement across canonical reopen", () => {
  const value = state(); value.lastTimeMs = 1000;
  Object.assign(value.records[0], { sendAttempts: 1, lastSendAt: 1000, retryAfter: 3000 });
  assert.equal(decode(value).records[0].observed, false);
  value.records[0].observed = true; assert.equal(decode(value).records[0].observed, true);
});
for (const [name, mutate] of [
  ["missing signature", r => { r.signedTransactionHex = null; }],
  ["altered signature", r => { r.signedTransactionHex = "00"; }],
  ["wrong amount", r => { r.plan.depositIntent.amountAtomic = "1"; }],
  ["wrong recipient", r => { r.plan.depositIntent.recipientHex = hash("wrong"); }],
  ["wrong fee", r => { r.plan.signingIntents[0].feeAtomic = "1"; }],
  ["changed sighash", r => { r.plan.signingIntents[0].taprootSighashHex = hash("wrong"); }],
  ["wrong epoch", r => { r.plan.signingIntents[0].keyEpoch++; }],
  ["extra trust flag", r => { r.approved = true; }],
  ["negative attempts", r => { r.sendAttempts = -1; }],
  ["unbounded attempts", r => { r.sendAttempts = 33; }],
  ["attempt without durable time", r => { r.sendAttempts = 1; }],
  ["unbounded delay", r => { r.retryAfter = 30001; }],
  ["invalid observed type", r => { r.observed = "true"; }],
]) test("Native delivery rejects " + name, () => { const value = state(); mutate(value.records[0]); assert.throws(() => decode(value)); });
test("Native outbox rejects duplicate economic operation and reused inputs", () => {
  const value = state(); value.records.push(structuredClone(value.records[0])); assert.throws(() => decode(value));
});
test("Native outbox rejects restored-future time, wrong deployment and alternative encoding", () => {
  const value = state(); value.lastTimeMs = 100001; assert.throws(() => decode(value));
  const bytes = initialNativeSweepOutbox(fixture.policy);
  assert.throws(() => decodeNativeSweepOutbox(bytes, { ...fixture.policy, solanaDeployment: hash("wrong") }));
  assert.throws(() => decodeNativeSweepOutbox(Buffer.from(bytes.toString() + "\n"), fixture.policy));
  assert.throws(() => decodeNativeSweepOutbox(Buffer.from(bytes.toString().replace('"records":[]', '"records":[],"records":[]')), fixture.policy));
});
test("Native outbox cannot be a caller-injected storage adapter or prototype capability", async () => {
  await assert.rejects(ProtectedNativeSweepOutbox.open({ store: {}, integrity: {}, policy: fixture.policy }), /ProtectedStoreRoleMismatch/u);
  assert.throws(() => requireNativeSweepOutbox(Object.create(ProtectedNativeSweepOutbox.prototype), fixture.policy, {}));
  assert.throws(() => requireNativeSweepClient(Object.create(ProtectedNativeSweepClient.prototype), fixture.policy));
  assert.throws(() => new ProtectedNativeSweepClient({ ipc: { role: "BRIDGE_VALIDATOR", peerRole: "RELAYER" }, port: 1, policy: fixture.policy }));
});
test("Native outbox protected purpose belongs only to the relayer, never signer or coordinator", () => {
  const context = { role: "RELAYER", purpose: "native-sweep-outbox", serviceSid: "S-1-5-21-1-2-3-1001",
    environment: "localnet", nativeGenesis: fixture.policy.nativeGenesis, solanaDeployment: fixture.policy.solanaDeployment, instanceId: hash("test instance"), keyEpoch: 1 };
  assert.equal(normalizeProtectedContext(context).purpose, "native-sweep-outbox");
  for (const role of ["COORDINATOR", "KINGPEPE_FROST_A", "BRIDGE_VALIDATOR", "INDEXER", "ATTESTER_A"])
    assert.throws(() => normalizeProtectedContext({ ...context, role }));
});
const response = state => ({ state, operationId: fixture.plan.operationId, txid: parseNativeTransactionHex(fixture.signedTransactionHex).txidHex });
test("Native delivery IPC distinguishes durable acceptance from observed transaction, never finality", () => {
  assert.equal(validateNativeSweepResponse(response("ACCEPTED"), delivery(), fixture.policy, "enqueueNativeSweep").state, "ACCEPTED");
  for (const state of ["WAITING_FOR_DEPENDENCY", "QUEUED_BY_LIMIT", "BROADCAST_OBSERVED"])
    assert.equal(validateNativeSweepResponse(response(state), delivery(), fixture.policy, "nativeSweepStatus").state, state);
});
for (const [name, mutate] of [
  ["wrong operation", r => { r.operationId = hash("wrong"); }],
  ["wrong transaction", r => { r.txid = hash("wrong"); }],
  ["invented finality", r => { r.state = "FINALIZED"; }],
  ["caller mint grant", r => { r.mintAllowed = true; }],
]) test("Native IPC delivery rejects " + name, () => {
  const value = response("BROADCAST_OBSERVED"); mutate(value);
  assert.throws(() => validateNativeSweepResponse(value, delivery(), fixture.policy, "nativeSweepStatus"));
});
test("Native status cannot masquerade as enqueue acknowledgement", () => {
  assert.throws(() => validateNativeSweepResponse(response("BROADCAST_OBSERVED"), delivery(), fixture.policy, "enqueueNativeSweep"));
});
