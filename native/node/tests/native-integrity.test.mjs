// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Pure comparison fixtures, not a claim of Native chain or DPAPI execution.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalNativeEvidenceVerifier, requireVerifiedRegtestChain, requireVerifiedRegtestReserve } from "../native-raw-evidence.mjs";
import { compareNativeProgress, initialNativeProgress, retainVerifiedReserveBasis, ProtectedNativeIntegrityMonitor } from "../native-integrity.mjs";
import { nativeProgressFixture as fixture, mainnetNativeProgressFixture, nativeFixtureHash as h } from "../../../tests/integration/native-progress-fixture.mjs";
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

test("Mainnet progress accepts actual-height ranges and rejects mixed deployment or finality policy", () => {
  const f = mainnetNativeProgressFixture();
  assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now).state, "OBSERVED_MATCH");
  for (const mutation of [{ minimumConfirmations: 11 }, { minimumConfirmations: 13 }, { nativeGenesis: h("other-chain") },
    { solanaDeployment: h("other-deployment") }, { keyEpoch: 2 }, { deployment: { ...f.expectedPolicy.deployment, mint: h("other-mint") } }])
    assert.throws(() => compareNativeProgress(f.stored, f.chain, { ...f.expectedPolicy, ...mutation }, f.now));
  assert.throws(() => compareNativeProgress(f.stored, { ...f.chain, genesis: h("other-chain") }, f.expectedPolicy, f.now));
  assert.throws(() => compareNativeProgress(f.stored, { ...f.chain, tipHeight: 1_000_001 }, f.expectedPolicy, f.now));
  for (const name of ["deposit", "sweep"]) {
    const immature = structuredClone(f.stored); immature.bases[0][name].height = 4990;
    // Preserve ordering so the failure specifically checks the finality boundary.
    if (name === "deposit") immature.bases[0].sweep.height = 4990;
    assert.throws(() => compareNativeProgress(immature, f.chain, f.expectedPolicy, f.now), /NativeReserveBasisFinalityInsufficient/);
  }
});

test("Mainnet pre-finality reorg waits for policy and an accepted-basis reorg retains exact stopped accounting", () => {
  const f = mainnetNativeProgressFixture();
  f.chain.headerHashes[4999] = h("shallow-fork"); f.chain.chainworkHex = "00".repeat(31) + "20";
  assert.equal(compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now).state, "OBSERVED_MATCH");
  f.chain.headerHashes[4988] = h("accepted-deposit-orphaned");
  const stopped = compareNativeProgress(f.stored, f.chain, f.expectedPolicy, f.now);
  assert.equal(stopped.state, "HARD_STOP_INTEGRITY"); assert.equal(stopped.incident.affectedReserveAtomic, "9007199254740993");
  const original = mainnetNativeProgressFixture(); original.chain.observedAt = f.now;
  assert.equal(compareNativeProgress(stopped.progress, original.chain, f.expectedPolicy, f.now).state, "HARD_STOP_INTEGRITY");
});

test("Mainnet observations require branded consensus verification and explicit matching runtime", async () => {
  const f = mainnetNativeProgressFixture();
  assert.throws(() => initialNativeProgress(f.expectedPolicy, f.chain), /RAW_NATIVE_VERIFIED_CHAIN_REQUIRED/);
  assert.throws(() => retainVerifiedReserveBasis(f.stored, { reserveBasis: f.stored.bases[0] }, h("fake-mainnet-receipt"), f.expectedPolicy), /RAW_NATIVE_VERIFIED_RESERVE_REQUIRED/);
  await assert.rejects(ProtectedNativeIntegrityMonitor.open({ expectedPolicy: f.expectedPolicy }), /NativeExplicitMainnetMonitorRequired/);
  await assert.rejects(ProtectedNativeIntegrityMonitor.openMainnet({ expectedPolicy: f.expectedPolicy,
    verifier: new LocalNativeEvidenceVerifier({ rpc: {}, executable: "unused-fixture" }) }), /NativeVerifierNetworkMismatch/);
  await assert.rejects(ProtectedNativeIntegrityMonitor.openMainnet({ expectedPolicy: fixture().expectedPolicy }), /NativeMainnetMonitorBindingRequired/);
});
