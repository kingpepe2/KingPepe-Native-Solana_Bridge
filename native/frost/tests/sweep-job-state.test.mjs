// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real ephemeral signatures; synthetic chain evidence is codec evidence only.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { schnorr_FROST } from "@noble/curves/secp256k1.js";
import { depositOperationFixture } from "../../../tests/integration/deposit-operation-fixture.mjs";
import { validateRuntimeStateRoot } from "../../../shared/runtime-path-boundary.mjs";
import { parseNativeTransactionHex } from "../../node/native-taproot-transaction.mjs";
import { nativeSigningIntentDigest, REQUIRED_FROST_SIGNERS } from "../policy/native-signing-policy.mjs";
import { initialSweepJobState, decodeSweepJobState, sweepJobId, validateSweepJobIntent } from "../coordinator/sweep-job-state.mjs";
import { validateSweepJobResponse, ProtectedSweepJobClient, requireSweepJobClient } from "../coordinator/sweep-job-ipc.mjs";
import { requireProtectedSweepJobs } from "../coordinator/protected-sweep-jobs.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../../.."), h = x => createHash("sha256").update(x).digest("hex");
let root, f, intent, state, signed;
before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-sweep-jobs-test-")); validateRuntimeStateRoot(root, repoRoot);
  f = await depositOperationFixture({ root, repoRoot }); intent = f.plan.signingIntents[0]; state = JSON.parse(initialSweepJobState(f.policy));
  state.jobs.push({ jobId: sweepJobId(intent, f.policy), intent, attempts: 0, lastAttemptAt: 0, retryAfter: 0, completed: false });
  signed = { state: "SIGNED", jobId: state.jobs[0].jobId, result: { state: "SIGNED", requestId: intent.signingRequestId, epoch: intent.keyEpoch,
    sessionId: h("public synthetic session identity"), intentDigest: nativeSigningIntentDigest(intent), messageHex: intent.taprootSighashHex,
    signatureHex: Buffer.from(parseNativeTransactionHex(f.signedTransactionHex).inputs[0].witness[0]).toString("hex"), aggregateTweakedXOnlyPublicKey: f.policy.frostPublicKeyHex,
    signerIds: [...REQUIRED_FROST_SIGNERS], participantIdentifiers: [1, 2].map(n => schnorr_FROST.Identifier.fromNumber(n)) } };
});
after(() => { if (root) { validateRuntimeStateRoot(root, repoRoot); assert(path.basename(root).startsWith("kingpepe-sweep-jobs-test-")); rmSync(root, { recursive: true }); } });
const decode = v => decodeSweepJobState(Buffer.from(JSON.stringify(v)), f.policy);
test("empty and queued signing work decode without granting a signature", () => {
  assert.equal(decodeSweepJobState(initialSweepJobState(f.policy), f.policy).jobs.length, 0);
  assert.deepEqual(decode(state), state); assert.notEqual(state.jobs[0].jobId, intent.operationId);
  assert.equal(validateSweepJobResponse({ state: "ACCEPTED", jobId: state.jobs[0].jobId }, intent, f.policy, "enqueueSweepSignature").state, "ACCEPTED");
  assert.throws(() => validateSweepJobResponse({ state: "ACCEPTED", jobId: state.jobs[0].jobId }, intent, f.policy, "sweepSignatureStatus"));
});
for (const [name, patch] of Object.entries({ "wrong mint": { mint: h("other") }, "wrong deployment": { solanaDeployment: h("other") },
  "wrong recipient": { recipientScriptPubKeyHex: "5120" + h("other") }, "wrong epoch": { keyEpoch: 2 }, "wrong genesis": { nativeGenesisHash: h("other") },
  "payout": { purpose: "WITHDRAWAL" }, "migration": { purpose: "RESERVE_MIGRATION" }, "fee over cap": { feeAtomic: "10001" },
  "amount over cap": { amountAtomic: "1000000001" }, "unapproved change": { changeAtomic: "1" }, "paused": { pauseWithdrawals: true },
  "extra key": { privateShare: "not a key" }, "alternate encoding": { mint: "AA".repeat(32) } })) {
  test("signing job rejects " + name, () => assert.throws(() => validateSweepJobIntent({ ...intent, ...patch }, f.policy)));
}
for (const [name, change] of Object.entries({ "duplicate work": v => v.jobs.push(structuredClone(v.jobs[0])),
  "changed ID": v => { v.jobs[0].jobId = h("other"); }, "pretend completion": v => { v.jobs[0].completed = true; },
  "negative attempts": v => { v.jobs[0].attempts = -1; }, "retry bound": v => { v.jobs[0].retryAfter = 31000; },
  "clock rollback": v => { v.lastTimeMs = Date.now() + 100000; }, "unknown state": v => { v.jobs[0].approved = true; },
  "cross-operation input reuse": v => { const i = { ...intent, operationId: h("different operation"), signingRequestId: h("different request") };
    v.jobs.push({ ...v.jobs[0], jobId: sweepJobId(i, f.policy), intent: i }); } })) {
  test("retained signing jobs reject " + name, () => { const v = structuredClone(state); change(v); assert.throws(() => decode(v)); });
}
test("job codec rejects alternate JSON, malformed UTF-8 and oversized state", () => {
  const bytes = Buffer.from(JSON.stringify(state));
  for (const bad of [Buffer.concat([bytes, Buffer.from("\n")]), Buffer.from('{"protocol":"a","protocol":"b"}'), Buffer.from([255]), Buffer.alloc(900001)])
    assert.throws(() => decodeSweepJobState(bad, f.policy));
});
test("attempt exhaustion is retained, not reset by decoding or another operation identity", () => {
  const v = structuredClone(state), now = Date.now(); v.lastTimeMs = now;
  Object.assign(v.jobs[0], { attempts: 32, lastAttemptAt: now, retryAfter: now + 30000 });
  assert.equal(decode(v).jobs[0].attempts, 32);
  v.jobs[0].attempts++; assert.throws(() => decode(v));
});
test("different signing inputs of one operation must retain identical transaction commitments", () => {
  const v = structuredClone(state), next = f.plan.signingIntents[1];
  v.jobs.push({ ...v.jobs[0], jobId: sweepJobId(next, f.policy), intent: next }); assert.equal(decode(v).jobs.length, 2);
  v.jobs[1].intent = { ...next, unsignedNativeTransactionId: h("substituted transaction") };
  v.jobs[1].jobId = sweepJobId(v.jobs[1].intent, f.policy); assert.throws(() => decode(v));
});
test("returned job signature is independently BIP340 verified and bound", () => {
  assert.equal(validateSweepJobResponse(signed, intent, f.policy, "sweepSignatureStatus").state, "SIGNED");
  for (const patch of [{ signatureHex: "00".repeat(64) }, { signerIds: [REQUIRED_FROST_SIGNERS[0]] }, { requestId: h("other") },
    { messageHex: h("other") }, { intentDigest: h("other") }, { epoch: 2 }, { aggregateTweakedXOnlyPublicKey: h("other") }])
    assert.throws(() => validateSweepJobResponse({ ...signed, result: { ...signed.result, ...patch } }, intent, f.policy, "sweepSignatureStatus"));
  assert.throws(() => validateSweepJobResponse(signed, intent, f.policy, "enqueueSweepSignature"));
});
test("job endpoints cannot be constructed from duck types or forged capabilities", () => {
  assert.throws(() => new ProtectedSweepJobClient({ ipc: { role: "BRIDGE_VALIDATOR", peerRole: "COORDINATOR" }, port: 1234, policy: f.policy }));
  assert.throws(() => requireSweepJobClient(Object.create(ProtectedSweepJobClient.prototype), f.policy));
  assert.throws(() => requireProtectedSweepJobs({ assertBinding() {} }, f.policy, {}));
});
test("job protected state purpose cannot be read as another service role", () => {
  const context = { purpose: "coordinator-jobs", role: "COORDINATOR", serviceSid: "S-1-5-21-1-2-3-4", environment: "localnet",
    nativeGenesis: f.policy.nativeGenesis, solanaDeployment: f.policy.solanaDeployment, instanceId: h("public context"), keyEpoch: 1 };
  assert.equal(normalizeProtectedContext(context).purpose, "coordinator-jobs");
  for (const role of ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "BRIDGE_VALIDATOR", "RELAYER", "ATTESTER_A", "SUPERVISOR"])
    assert.throws(() => normalizeProtectedContext({ ...context, role }));
});
