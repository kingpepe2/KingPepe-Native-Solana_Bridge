// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic chain observations; real-chain service regression is separate.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { validateEconomicLimits, reduceEconomicLimitEvent, economicLimitUsage } from "../economic-limits.mjs";
import { reduceServiceEvent, initialServiceState } from "../service-journal-state.mjs";
import { AuthenticatedLocalDepositLedger } from "../local-deposit-ledger.mjs";
import { NativeDepositObserver } from "../native-deposit-observer.mjs";
import { NativeRpcClient } from "../../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier, REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";
import { createUnsignedNativeTransaction, parseNativeTransactionHex } from "../../../native/node/native-taproot-transaction.mjs";
import { createNativeDepositRequest } from "../../../solana/ts/sdk/bridge.mjs";
import { base58Encode } from "../solana-deposit-claim-transaction-plan.mjs";
import { DEVNET_SOLANA_GENESIS } from "../../../shared/solana-test-network.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../.."), h = n => n.toString(16).padStart(2, "0").repeat(32);
const limits = { scope: "TEST_ONLY", windowSeconds: 10, maxMintPerTransfer: "60",
  maxMintPerWindow: "100" };
const configure = (policy = limits) => reduceEconomicLimitEvent(null, { action: "LIMIT_CONFIG", policy, timestampMs: 1000 }).state;
const event = (direction, operationId, amountAtomic, timestampMs = 2000, action = "LIMIT_RESERVE") =>
  ({ action, direction, operationId, amountAtomic, timestampMs });

const production = { scope: "MAINNET", productionLimitPolicy: "UNBOUNDED_BY_TEAM_DECISION", windowDuration: "NOT_APPLICABLE",
  maxMintPerTransfer: "UNBOUNDED",  maxMintPerWindow: "UNBOUNDED" };
test("explicit unbounded Mainnet policy retains exact amount, immutable reservation and settlement checks", () => {
  assert.deepEqual(validateEconomicLimits(production), production);
  for (const mutation of [{ scope: "TEST_ONLY" }, { windowDuration: 60 }, { maxMintPerTransfer: "1000" }, { windowSeconds: 60 }, { productionLimitPolicy: "UNBOUNDED" }])
    assert.throws(() => validateEconomicLimits({ ...production, ...mutation }));
  let state = configure(production);
  for (const kind of ["MINT"]) {
    state = reduceEconomicLimitEvent(state, event(kind, h(1), "18446744073709551615")).state;
    const duplicate = reduceEconomicLimitEvent(state, event(kind, h(1), "18446744073709551615"));
    assert(duplicate.unchanged); assert.equal(duplicate.state, state);
    assert.throws(() => reduceEconomicLimitEvent(state, event(kind, h(1), "1")), /EconomicLimitOperationChanged/);
    assert.throws(() => reduceEconomicLimitEvent(state, event(kind, h(2), "18446744073709551616")));
    assert.throws(() => reduceEconomicLimitEvent(state, event(kind, h(2), "0")));
    assert.throws(() => reduceEconomicLimitEvent(state, event(kind, h(2), "1", 2100, "LIMIT_SETTLE")), /EconomicLimitReservationMissing/);
  }
  assert.deepEqual(economicLimitUsage(state, 3000), { window: null, mintAtomic: "18446744073709551615" });
  assert.equal(state.breach, null);
  assert.throws(() => reduceEconomicLimitEvent(state, { action: "LIMIT_CONFIG", policy: limits, timestampMs: 3000 }), /EconomicLimitPolicyChanged/);
});

test("TEST limit configuration rejects missing, production, inexact, overflowing and contradictory ceilings", () => {
  assert.deepEqual(validateEconomicLimits(limits), limits);
  for (const change of [{ scope: "MAINNET" }, { scope: undefined }, { productionReady: false }, { windowSeconds: 0 },
    { windowSeconds: 1.5 }, { windowSeconds: 86401 }, { maxMintPerTransfer: "101" }, { maxPayoutPerWindow: "59" }])
    assert.throws(() => validateEconomicLimits({ ...limits, ...change }));
  for (const value of ["0", "-1", "01", "1.1", "1e2", "18446744073709551616", 1])
    assert.throws(() => validateEconomicLimits({ ...limits, maxMintPerTransfer: value }));
});

for (const direction of ["MINT"]) {
  test(direction + " per-transfer and cumulative ceilings reject excess without granting an allowance", () => {
    let state = configure();
    assert.throws(() => reduceEconomicLimitEvent(state, event(direction, h(1), "61")), /EconomicTransferLimitExceeded/u);
    assert.equal(state.records.size, 0);
    state = reduceEconomicLimitEvent(state, event(direction, h(1), "60")).state;
    state = reduceEconomicLimitEvent(state, event(direction, h(2), "40")).state;
    const excess = reduceEconomicLimitEvent(state, event(direction, h(3), "1"));
    assert.equal(excess.pauseReason, direction + "_WINDOW_LIMIT"); assert.equal(excess.state.records.size, 2);
    assert.equal(economicLimitUsage(excess.state, 2000)["mintAtomic"], "100");
    assert.throws(() => reduceEconomicLimitEvent(excess.state, { action: "LIMIT_REVIEW", timestampMs: 9000 }), /EconomicWindowStillExhausted/u);
  });
}

test("pending allowances carry across windows and settlement cannot release quota in its own window", () => {
  let state = reduceEconomicLimitEvent(configure(), event("MINT", h(1), "60")).state;
  assert.equal(economicLimitUsage(state, 20000).mintAtomic, "60");
  const rejected = reduceEconomicLimitEvent(state, event("MINT", h(2), "41", 20000));
  assert.equal(rejected.pauseReason, "MINT_WINDOW_LIMIT"); state = rejected.state;
  state = reduceEconomicLimitEvent(state, event("MINT", h(1), "60", 21000, "LIMIT_SETTLE")).state;
  assert.equal(economicLimitUsage(state, 29999).mintAtomic, "60");
  assert.equal(economicLimitUsage(state, 30000).mintAtomic, "0");
  state = reduceEconomicLimitEvent(state, { action: "LIMIT_REVIEW", timestampMs: 30000 }).state;
  assert.equal(state.breach, null);
  assert.equal(reduceEconomicLimitEvent(state, event("MINT", h(2), "41", 30000)).state.records.size, 2);
});

test("duplicate retry retains one allowance and cannot substitute value or settle an unknown operation", () => {
  const state = reduceEconomicLimitEvent(configure(), event("MINT", h(1), "60")).state;
  assert.equal(reduceEconomicLimitEvent(state, event("MINT", h(1), "60", 12000)).unchanged, true);
  assert.throws(() => reduceEconomicLimitEvent(state, event("MINT", h(1), "59")), /EconomicLimitOperationChanged/u);
  assert.throws(() => reduceEconomicLimitEvent(state, event("MINT", h(2), "60", 2000, "LIMIT_SETTLE")), /EconomicLimitReservationMissing/u);
  assert.throws(() => economicLimitUsage(state, 1999), /EconomicLimitClockRegression/u);
  assert.throws(() => reduceEconomicLimitEvent(state, { action: "LIMIT_CONFIG", policy: { ...limits, maxMintPerWindow: "101" }, timestampMs: 12000 }), /EconomicLimitPolicyChanged/u);
});

test("window breach atomically projects the existing pause reason and does not automatically resume", () => {
  let s = reduceServiceEvent(initialServiceState(), { action: "LIMIT_CONFIG", policy: limits, timestampMs: 1000 }, Buffer.alloc(168)).state;
  s = reduceServiceEvent(s, event("MINT", h(1), "60"), Buffer.alloc(168)).state;
  s = reduceServiceEvent(s, event("MINT", h(2), "41"), Buffer.alloc(168)).state;
  assert.equal(s.paused, "MINT_WINDOW_LIMIT"); assert.equal(s.limits.records.size, 1);
  assert.equal(economicLimitUsage(s.limits, 50000).mintAtomic, "60"); assert.equal(s.paused, "MINT_WINDOW_LIMIT");
  const reviewed = reduceServiceEvent(s, { action: "LIMIT_REVIEW", timestampMs: 50000 }, Buffer.alloc(168)).state;
  assert.equal(reviewed.paused, "MINT_WINDOW_LIMIT"); // Ordinary explicit resume is still required.
});

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-limit-regression-"));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-limit-regression-")); rmSync(root, { recursive: true, force: true }); });
  const cookie = path.join(root, "test.cookie"); writeFileSync(cookie, "unused:fixture");
  const rpc = new NativeRpcClient({ endpoint: "http://127.0.0.1:1", repoRoot, authCookieFile: cookie });
  const verifier = new LocalNativeEvidenceVerifier({ rpc, executable: "UNUSED_SYNTHETIC_FIXTURE" });
  // Public secp256k1 generator points, no private signing material.
  const generator = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
  const second = "c6047f9441ed7d6d3045406e95c07cd85a961ae58cd9ee37abac09b95c709ee5";
  const policy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: h(2), solanaGenesis: base58Encode(Buffer.from(h(3), "hex")),
    minimumSolanaSlot: "0", managerProgramId: h(4), transceiverProgramId: h(5), mint: h(6), protocolId: 1, nativeNetwork: 8000111,
    policyEpoch: 1, keyEpoch: 1, frostPublicKeyHex: generator, csvDelayBlocks: 12, minimumConfirmations: 6, maximumAmountAtomic: "1000", maximumFeeAtomic: "10" };
  const checkpoint = { protocol: "KINGPEPE_REGTEST_ACCEPTANCE_CHECKPOINT_V1", genesis: REGTEST_GENESIS, tipHash: h(30), tipHeight: 10,
    chainworkHex: "00".repeat(31) + "ff", minimumConfirmations: 6, evidenceDigestHex: h(31) };
  const transactions = new Map();
  rpc.getSourceSnapshot = async () => ({ state: "READY", bestHash: h(30) });
  rpc.getRawTransaction = async txid => { assert(transactions.has(txid), "UNKNOWN_FIXTURE_TRANSACTION"); return transactions.get(txid); };
  rpc.getUtxoObservation = async ({ txid, vout }) => {
    const output = parseNativeTransactionHex(transactions.get(txid)).outputs[vout];
    return { unspent: true, valueAtomic: output.amountAtomic, scriptPubKeyHex: output.scriptPubKeyHex, bestBlockHash: h(30) };
  };
  verifier.verifyInputs = async () => ({ digestHex: h(31), acceptedCheckpoint: checkpoint });
  const observer = new NativeDepositObserver({ nativeRpc: rpc, nativeVerifier: verifier, policy });
  const request = (n, amountAtomic = "60") => {
    const quote = createNativeDepositRequest({ policy, amountAtomic, recipient: base58Encode(Buffer.from(h(7), "hex")), userRecoveryPublicKeyHex: second, nonceHex: h(n) });
    const raw = createUnsignedNativeTransaction({ inputs: [{ txid: h(n + 50), vout: 0 }], outputs: [{ amountAtomic, scriptPubKeyHex: quote.recovery.scriptPubKeyHex }] });
    const depositTxidHex = parseNativeTransactionHex(raw).txidHex; transactions.set(depositTxidHex, raw);
    return { operationId: quote.operationId, depositIntent: quote.depositIntent, userRecoveryPublicKeyHex: second, depositTxidHex, depositVout: 0,
      feeFundingInputs: [{ txid: h(n + 100), vout: 0, amountAtomic: "1", scriptPubKeyHex: "5120" + generator, minimumConfirmations: 1 }] };
  };
  const deploymentHex = Buffer.concat([Buffer.from("010000006f127a00", "hex"), ...[policy.nativeGenesis, policy.solanaDeployment, policy.managerProgramId, policy.transceiverProgramId, policy.mint].map(v => Buffer.from(v, "hex"))]).toString("hex");
  const options = { environment: "localnet", repoRoot, root: path.join(root, "journal"), deploymentHex,
    journalIdHex: randomBytes(32).toString("hex"), authenticationKey: randomBytes(32) };
  return { policy, observer, request, options, rpc, transactions };
}

test("authenticated journal retains exact allowances and automatic pause across close/reopen", async t => {
  const f = fixture(t), first = await f.observer.observe(f.request(8)), second = await f.observer.observe(f.request(9));
  let ledger = AuthenticatedLocalDepositLedger.createLocal(f.options);
  try {
    ledger.configureEconomicLimits(limits, 1000);
    ledger.registerServiceDeposit(first, f.policy); ledger.registerServiceDeposit(second, f.policy);
    ledger.authorizeEconomicOperation("MINT", first.operationId, 2000);
    const checkpoint = ledger.checkpoint(); ledger.authorizeEconomicOperation("MINT", first.operationId, 2000);
    assert.deepEqual(ledger.checkpoint(), checkpoint);
    assert.throws(() => ledger.authorizeEconomicOperation("MINT", second.operationId, 2000), /EconomicWindowLimitExceeded/u);
    assert.equal(ledger.status().reason, "MINT_WINDOW_LIMIT"); assert.equal(ledger.snapshot().mintedSupply, "0");
    const paused = ledger.checkpoint(); ledger.close(); ledger = AuthenticatedLocalDepositLedger.openLocal(f.options);
    assert.deepEqual(ledger.checkpoint(), paused); assert.equal(ledger.status().state, "PAUSED");
    assert.equal(ledger.economicLimitsStatus(3000).mintAtomic, "60");
    assert.throws(() => ledger.resumeAfterReview(9000), /EconomicWindowStillExhausted/u);
    ledger.resumeAfterReview(20000); assert.equal(ledger.status().state, "OPEN_LOCAL_ACCOUNTING_ONLY");
    assert.throws(() => ledger.authorizeEconomicOperation("MINT", second.operationId, 20000), /EconomicWindowLimitExceeded/u);
    assert.equal(ledger.economicLimitsStatus(20000).pending, 1);
    assert.throws(() => ledger.settleEconomicOperation("MINT", first.operationId, 20000), /EconomicLimitSettlementUnverified/u);
  } finally { ledger.close(); }
});

test("a pending legacy operation cannot silently install limits and Devnet cannot omit them", async t => {
  const f = fixture(t), plan = await f.observer.observe(f.request(8));
  const ledger = AuthenticatedLocalDepositLedger.createLocal(f.options);
  try { assert.throws(() => ledger.configureEconomicLimits(production, 1000), /EconomicLimitEnvironmentMismatch/); ledger.registerServiceDeposit(plan, f.policy); assert.throws(() => ledger.configureEconomicLimits(limits, 1000), /EconomicLimitsRequireQuiescentInstallation/u); }
  finally { ledger.close(); }
  const devnet = AuthenticatedLocalDepositLedger.createLocal({ ...f.options, root: f.options.root + "-devnet", environment: "devnet", solanaGenesis: DEVNET_SOLANA_GENESIS });
  try { assert.throws(() => devnet.assertEconomicLimitsReady(), /EconomicLimitsRequired/u); devnet.configureEconomicLimits(limits, 1000); devnet.assertEconomicLimitsReady(); }
  finally { devnet.close(); }
});

test("deposit intake rejects irrelevant, changed, spent and wrong-network evidence before a durable watch", async t => {
  const f = fixture(t), request = f.request(8);
  assert.deepEqual(await f.observer.verifyNotification(request), request);
  for (let n = 0; n < 128; n++) await assert.rejects(f.observer.verifyNotification({ ...request, depositTxidHex: h(200) }));
  await assert.rejects(f.observer.verifyNotification({ ...request, depositVout: 1 }));
  await assert.rejects(f.observer.verifyNotification({ ...request, depositIntent: { ...request.depositIntent, amountAtomic: "59" } }));
  const unspent = f.rpc.getUtxoObservation;
  f.rpc.getUtxoObservation = async () => ({ unspent: false }); await assert.rejects(f.observer.verifyNotification(request));
  f.rpc.getUtxoObservation = unspent;
  f.rpc.getSourceSnapshot = async () => ({ state: "REJECTED" }); await assert.rejects(f.observer.verifyNotification(request));
  f.rpc.getSourceSnapshot = async () => ({ state: "READY", bestHash: h(30) });
  assert.equal((await f.observer.observe(request)).operationId, request.operationId);
});
