// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Codec/cryptographic boundaries only; synthetic chain facts are not chain proof.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { depositControllerFixture } from "../../../tests/integration/deposit-controller-fixture.mjs";
import { decodeDepositControllerState, initialDepositControllerState, newDepositControllerRecord, controllerAttestationRequest } from "../deposit-controller-state.mjs";
import { validateProtectedAttestationRequest, validateProtectedAttestationResponse, ProtectedDepositAttesterClient, requireDepositAttesterClient } from "../../attesters/protected-client.mjs";
import { ProtectedDepositController, requireProtectedDepositController } from "../protected-deposit-controller.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";
let f, root, observed, ready, receipt, claim;
const bytes = v => Buffer.from(JSON.stringify(v)), copy = v => structuredClone(v);
before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-controller-codec-"));
  f = await depositControllerFixture({ root, repoRoot: path.resolve(import.meta.dirname, "../../..") });
  observed = copy(f.state); f.ready(); ready = copy(f.state); receipt = await f.packet(); claim = await f.packet("CLAIM", 1);
});
after(() => { f?.dispose(); if (root) { assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("kingpepe-controller-codec-")); rmSync(root, { recursive: true }); } });
const decode = (v, policy = f.policy, now) => decodeDepositControllerState(bytes(v), policy, now);
test("controller empty and observed state create no credit or approval", () => {
  assert.equal(decodeDepositControllerState(initialDepositControllerState(f.policy), f.policy).records.length, 0);
  assert.deepEqual(decode(observed), observed); assert.equal(observed.records[0].nativeValidationDigest, null);
});
test("controller retains validated intent, exact window and two genuine signatures", () => {
  assert.deepEqual(decode(ready), ready); const req = controllerAttestationRequest(ready.records[0]);
  assert.deepEqual(validateProtectedAttestationRequest(req, f.policy.deliveryPolicy).request, req);
  for (const [i, role] of ["ATTESTER_A", "ATTESTER_B"].entries())
    assert.deepEqual(validateProtectedAttestationResponse(f.attestations[i], req, f.policy.deliveryPolicy, role), f.attestations[i]);
});
test("controller preserves exact prepared and signed receipt then claim", () => {
  const s = copy(ready); s.records[0].packets.push({ intent: receipt.intent, delivery: null, unsignedExpiredAtHeight: null }); decode(s);
  s.records[0].packets[0] = copy(receipt); decode(s); s.records[0].packets.push(copy(claim)); decode(s);
  s.records[0].completed = { journalRevision: "9", solanaSlot: "20", evidenceDigest: "23".repeat(32) }; decode(s);
});
test("controller permits a bounded strictly newer same-economic-operation packet", async () => {
  const s = copy(ready); s.records[0].packets.push(copy(receipt), await f.packet("RECEIPT", 2)); decode(s);
});
test("controller retains unsigned expiry and permits only a newer same-stage request", async () => {
  const s = copy(ready); s.records[0].packets.push({ intent: copy(receipt.intent), delivery: null, unsignedExpiredAtHeight: "1001" }, await f.packet("RECEIPT", 2));
  decode(s); s.records[0].packets[0].unsignedExpiredAtHeight = "1000"; assert.throws(() => decode(s));
});
test("controller cannot abandon an already signed transaction", () => {
  const s = copy(ready); s.records[0].packets.push({ ...copy(receipt), unsignedExpiredAtHeight: "1001" }); assert.throws(() => decode(s));
});
test("controller cannot skip an expired unsigned receipt and proceed to claim", () => {
  const s = copy(ready); s.records[0].packets.push({ intent: copy(receipt.intent), delivery: null, unsignedExpiredAtHeight: "1001" }, copy(claim));
  assert.throws(() => decode(s));
});
test("controller requires protected storage and a genuine controller capability", async () => {
  await assert.rejects(ProtectedDepositController.open({ store: {}, policy: f.policy }));
  assert.throws(() => requireProtectedDepositController(Object.create(ProtectedDepositController.prototype), f.policy, {}));
});
test("controller protected purpose belongs only to the bridge validator", () => {
  const c = { role: "BRIDGE_VALIDATOR", purpose: "deposit-controller", serviceSid: "S-1-5-21-1-2-3-1001", environment: "localnet",
    nativeGenesis: f.policy.deliveryPolicy.operationPolicy.nativeGenesis, solanaDeployment: f.policy.deliveryPolicy.operationPolicy.solanaDeployment,
    instanceId: "31".repeat(32), keyEpoch: 1 };
  assert.equal(normalizeProtectedContext(c).purpose, "deposit-controller");
  for (const role of ["COORDINATOR", "RELAYER", "FEE_PAYER", "KINGPEPE_FROST_A", "ATTESTER_A", "INDEXER"])
    assert.throws(() => normalizeProtectedContext({ ...c, role }));
});
for (const [name, mutate] of [
  ["unknown property", s => { s.bypass = true; }],
  ["future clock", s => { s.lastTimeMs = Date.now() + 60000; }],
  ["duplicate operation", s => s.records.push(copy(s.records[0]))],
  ["invalid validated digest", s => { s.records[0].nativeValidationDigest = "ab".repeat(32); }],
  ["credit without Native validation", s => { s.records[0].nativeValidationDigest = null; }],
  ["credit without retained window", s => { s.records[0].creditWindow = null; }],
  ["alternate window", s => { const w = s.records[0].creditWindow; w.validFrom = String(BigInt(w.validFrom) - 1n); w.validUntil = String(BigInt(w.validUntil) - 1n); }],
  ["changed reserve amount", s => { s.records[0].credit.reserveBasis.amountAtomic = "1"; }],
  ["duplicate attester", s => { s.records[0].attestations[1] = copy(s.records[0].attestations[0]); }],
  ["wrong attester signature", s => { s.records[0].attestations[0].signatureHex = "00".repeat(64); }],
  ["claim before receipt", s => { s.records[0].packets = [copy(claim)]; }],
  ["unsigned receipt before claim", s => { s.records[0].packets = [{ intent: copy(receipt.intent), delivery: null, unsignedExpiredAtHeight: null }, copy(claim)]; }],
  ["duplicate packet", s => { s.records[0].packets = [copy(receipt), copy(receipt)]; }],
  ["swapped prepared packet", s => { s.records[0].packets = [{ intent: copy(receipt.intent), delivery: copy(claim.delivery), unsignedExpiredAtHeight: null }]; }],
  ["completion without claim", s => { s.records[0].completed = { journalRevision: "1", solanaSlot: "20", evidenceDigest: "23".repeat(32) }; }],
]) test("controller rejects " + name, () => { const s = copy(ready); mutate(s); assert.throws(() => decode(s)); });
test("controller rejects alternate encodings, truncation and oversized state", () => {
  for (const data of [Buffer.concat([bytes(ready), Buffer.from(" ")]), bytes(ready).subarray(0, 8), Buffer.alloc(900001), Buffer.from("{}")])
    assert.throws(() => decodeDepositControllerState(data, f.policy));
});
test("controller state binds exact environment, deployment and validity policy", () => {
  for (const change of [p => { p.deliveryPolicy.operationPolicy.environment = "mainnet"; },
    p => { p.creditValiditySeconds++; }, p => { p.deliveryPolicy.manifest.identityVersion++; }]) {
    const p = copy(f.policy); change(p); assert.throws(() => decode(ready, p));
  }
});
test("controller snapshots do not allow post-validation caller mutation", () => {
  const plan = copy(f.plan), r = newDepositControllerRecord(plan, f.policy); plan.inputs[0].amountAtomic = "1";
  assert.equal(r.plan.inputs[0].amountAtomic, f.plan.inputs[0].amountAtomic);
});
test("attester client rejects wrong role, changed message, signer identity and fields", () => {
  const req = controllerAttestationRequest(ready.records[0]), p = f.policy.deliveryPolicy;
  assert.throws(() => validateProtectedAttestationResponse(f.attestations[0], req, p, "ATTESTER_B"));
  for (const changed of [{ ...f.attestations[0], operationIdHex: "00".repeat(32) }, { ...f.attestations[0], extra: true }])
    assert.throws(() => validateProtectedAttestationResponse(changed, req, p, "ATTESTER_A"));
  const wrong = copy(req); wrong.rawEvidence.plan.depositIntent.recipientHex = "00".repeat(32);
  assert.throws(() => validateProtectedAttestationRequest(wrong, p));
});
test("attester client rejects unprotected and prototype-forged transports", () => {
  assert.throws(() => new ProtectedDepositAttesterClient({ ipc: {}, port: 12345, role: "ATTESTER_A", policy: f.policy.deliveryPolicy }));
  assert.throws(() => requireDepositAttesterClient(Object.create(ProtectedDepositAttesterClient.prototype), f.policy.deliveryPolicy, "ATTESTER_A"));
});
