// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Capability and request-boundary tests. Actual reserve credit derivation is
// exercised separately against the authoritative regtest node.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { depositOperationFixture } from "../../../tests/integration/deposit-operation-fixture.mjs";
import { nativeReserveCreditEvidenceInput, createVerifiedNativeReserveCredit, recoverNativeReserveCredit,
  createRawNativeCreditAttestationVerifier } from "../native-reserve-credit.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../../.."), h = v => createHash("sha256").update(v).digest("hex");
let fixture, root;
before(async () => { root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-credit-recovery-unit-")); fixture = await depositOperationFixture({ root, repoRoot }); });
after(() => { if (root) { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-credit-recovery-unit-")); rmSync(root, { recursive: true }); } });
test("credit recovery derives the exact deposit, fee inputs and fixed reserve destination", () => {
  const value = nativeReserveCreditEvidenceInput(fixture.plan, fixture.policy, fixture.plan.acceptedCheckpoint);
  assert.deepEqual(value.deposit, fixture.plan.inputs[0]); assert.deepEqual(value.feeInputs, fixture.plan.inputs.slice(1));
  assert.equal(value.reserveVout, 0); assert.equal(value.feeAtomic, "1000"); assert.equal(value.minimumConfirmations, fixture.policy.minimumConfirmations);
  assert.deepEqual(value.acceptedCheckpoint, fixture.plan.acceptedCheckpoint);
  assert.equal(value.tapscriptSpends[0].scriptHex, fixture.plan.depositPolicy.sweep.scriptHex);
});
test("credit recovery input snapshot cannot be changed by the caller while verification awaits", () => {
  const plan = structuredClone(fixture.plan), point = structuredClone(plan.acceptedCheckpoint);
  const value = nativeReserveCreditEvidenceInput(plan, fixture.policy, point);
  point.tipHash = h("changed"); plan.inputs[0].amountAtomic = "1";
  assert.equal(value.acceptedCheckpoint.tipHash, fixture.plan.acceptedCheckpoint.tipHash);
  assert.equal(value.deposit.amountAtomic, fixture.plan.inputs[0].amountAtomic);
});
for (const [name, change] of [
  ["recipient", p => { p.depositIntent.recipientHex = h("wrong"); }],
  ["amount", p => { p.depositIntent.amountAtomic = "1"; }],
  ["reserve script", p => { p.depositPolicy.canonicalReserveScriptPubKeyHex = "5120" + h("wrong"); }],
  ["genesis", p => { p.depositIntent.nativeGenesisHex = h("wrong"); }],
  ["sighash", p => { p.signingIntents[0].taprootSighashHex = h("wrong"); }],
]) test("credit recovery refuses a substituted " + name + " before a node query", () => {
  const plan = structuredClone(fixture.plan); change(plan); assert.throws(() => nativeReserveCreditEvidenceInput(plan, fixture.policy));
});
test("credit factory never accepts serialized reserve facts or proof flags as genuine validation", () => {
  assert.throws(() => createVerifiedNativeReserveCredit({ plan: fixture.plan, policy: fixture.policy,
    receipt: { ...fixture.finalizedCredit, proofVerified: true }, validityWindow: { validFrom: "1", validUntil: "2" } }), /RAW_NATIVE_VERIFIED_RESERVE_REQUIRED/u);
});
test("credit recovery rejects caller journal and guard adapters before any side effect", async () => {
  let called = false;
  await assert.rejects(recoverNativeReserveCredit({ policy: fixture.policy, journal: { inspect() { called = true; } }, integrity: {},
    nativeVerifier: {}, operationId: fixture.plan.operationId }), /IntegrityGuardRequired/u);
  assert.equal(called, false);
});
test("attester credit verifier requires the concrete Native verifier, not an approval callback", () => {
  assert.throws(() => createRawNativeCreditAttestationVerifier({ policy: fixture.policy, nativeVerifier: { verifyReserve() { return { proofVerified: true }; } } }));
});
