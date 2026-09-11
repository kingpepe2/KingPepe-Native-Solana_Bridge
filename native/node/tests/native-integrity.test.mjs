// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Pure comparison fixtures, not a claim of Native chain or DPAPI execution.
import assert from "node:assert/strict";
import { test } from "node:test";
import { requireVerifiedRegtestChain, requireVerifiedRegtestReserve } from "../native-raw-evidence.mjs";
import { compareNativeProgress, initialNativeProgress, retainVerifiedReserveBasis, ProtectedNativeIntegrityMonitor } from "../native-integrity.mjs";
import { nativeProgressFixture as fixture, nativeFixtureHash as h } from "../../../tests/integration/native-progress-fixture.mjs";
test("unchanged Native accepted basis preserves exact liabilities and stable snapshot", () => {
  const f = fixture(); const r = compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now);
  assert.equal(r.state, "OBSERVED_MATCH"); assert.deepEqual(r.progress.bases, f.stored.bases);
});
test("higher-work shallow reorg above accepted boundary does not fabricate deficit", () => {
  const f = fixture(); f.chain.headerHashes[4] = h("shallow"); f.chain.headerHashes.push(h("higher-tip")); f.chain.tipHeight = 6;
  f.chain.tipHash = f.chain.headerHashes[6]; f.chain.chainworkHex = "00".repeat(31) + "20";
  assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now).state, "OBSERVED_MATCH");
});
for (const height of [2, 3]) test("accepted Native basis conflict remains stopped after chain recovers: height " + height, () => {
  const f = fixture(), healthy = structuredClone(f.chain); f.chain.headerHashes[height] = h("conflicting-block");
  f.chain.chainworkHex = "00".repeat(31) + "20";
  const r = compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now);
  assert.equal(r.state, "HARD_STOP_INTEGRITY"); assert.equal(r.incident.affectedReserveAtomic, "9007199254740993");
  assert.deepEqual(r.incident.affected, [f.stored.bases[0].operationId]); assert.deepEqual(r.progress.bases, f.stored.bases);
  assert.equal(compareNativeProgress(JSON.parse(JSON.stringify(r.progress)), healthy, f.expectedPolicy, f.now).state, "HARD_STOP_INTEGRITY");
});
test("lower work or equal-work competing tip is unresolved, not automatic approval or deficit", () => {
  const f = fixture(); f.chain.chainworkHex = "00".repeat(31) + "0f";
  assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now).state, "WAITING_FOR_DEPENDENCY");
  f.chain.chainworkHex = f.stored.chainworkHex; f.chain.tipHash = h("equal-work-tip"); f.chain.headerHashes[5] = f.chain.tipHash;
  assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now).state, "WAITING_FOR_DEPENDENCY");
});
test("stale observations, nonadvancing tips and clock rollback cannot refresh authorization", () => {
  const f = fixture(); assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now + 60001).state, "WAITING_FOR_DEPENDENCY");
  f.chain.observedAt = f.now - 1;
  const stale = compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now);
  assert.equal(stale.state, "WAITING_FOR_DEPENDENCY"); assert.deepEqual(stale.progress, f.stored);
  f.chain.observedAt = f.now + 60001;
  assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now + 60001).state, "WAITING_FOR_DEPENDENCY");
  assert.throws(() => compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now - 1), /NativeProgressClockRollback/u);
});
test("copied network/deployment/epoch, duplicate basis and malformed progress reject", () => {
  const f = fixture();
  for (const change of [s => { s.genesis = h("wrong-network"); }, s => { s.policyDigest = h("old-deployment"); },
    s => { s.bases.push(structuredClone(s.bases[0])); }, s => { s.bases[0].amountAtomic = "1e9"; }, s => { s.extra = true; }]) {
    const value = structuredClone(f.stored); change(value); assert.throws(() => compareNativeProgress(value, f.chain, f.expectedPolicy, f.now));
  }
  assert.throws(() => compareNativeProgress(f.stored, f.chain, { ...f.expectedPolicy, keyEpoch: 2 }, f.now));
  assert.throws(() => compareNativeProgress(f.stored, f.chain, { ...f.expectedPolicy, environment: "mainnet" }, f.now));
});
test("a fixture or RPC flag is never a verified chain/reserve or protected service capability", async () => {
  const f = fixture(); assert.throws(() => requireVerifiedRegtestChain(f.chain)); assert.throws(() => requireVerifiedRegtestReserve({ reserveBasis: f.stored.bases[0] }));
  assert.throws(() => initialNativeProgress(f.expectedPolicy, f.chain)); assert.throws(() => retainVerifiedReserveBasis(f.stored, {}, h("fake"), f.expectedPolicy));
  await assert.rejects(ProtectedNativeIntegrityMonitor.open({ expectedPolicy: f.expectedPolicy, verifier: { observeChain: () => f.chain } }), /NativeIndependentVerifierRequired/u);
});
