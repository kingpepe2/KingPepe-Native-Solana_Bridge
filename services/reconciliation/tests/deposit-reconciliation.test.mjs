// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic accounting/account-layout fixtures, not real-chain evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconciliationFixture as fixture } from "../../../tests/integration/reconciliation-fixture.mjs";
import { compareDepositAccounting, validateReconciliationBinding, verifyDepositClaimSnapshot, depositReconciliationClaimAddresses, readDepositReconciliation } from "../deposit-reconciliation.mjs";

const journal = { canonicalReserve: "100", authorizedUnmintedCredits: "0", mintedSupply: "100" };
const observed = { canonicalReserve: "100", mintSupplyAtomic: "100", managerMintedAtomic: "100", burnedUnpaidAtomic: "0" };
test("reconciliation keeps burned-but-unpaid value as liability, not operator surplus", () => {
  const result = compareDepositAccounting(journal, { ...observed, mintSupplyAtomic: "80", managerMintedAtomic: "80", burnedUnpaidAtomic: "20" });
  assert.equal(result.coverageRequired, "100"); assert.equal(result.burnedUnpaidWithdrawals, "20");
  assert.equal(result.unclaimedDirectBurnDifference, "0"); assert.equal(result.operatorWithdrawalAuthorized, false);
});
test("direct SPL burn difference grants no payout or reserve-withdrawal authority", () => {
  const result = compareDepositAccounting(journal, { ...observed, mintSupplyAtomic: "80" });
  assert.equal(result.coverageRequired, "80"); assert.equal(result.burnedUnpaidWithdrawals, "0");
  assert.equal(result.unclaimedDirectBurnDifference, "20"); assert.equal(result.operatorWithdrawalAuthorized, false);
});
test("pending mint credits remain fully covered and cannot become surplus", () => {
  const result = compareDepositAccounting({ ...journal, authorizedUnmintedCredits: "20", mintedSupply: "80" }, { ...observed, managerMintedAtomic: "80", mintSupplyAtomic: "80" });
  assert.equal(result.coverageRequired, "100"); assert.equal(result.unclaimedDirectBurnDifference, "0");
});
for (const [name, change] of [
  ["reserve deficit", o => { o.canonicalReserve = "99"; }],
  ["unattributed reserve increase", o => { o.canonicalReserve = "101"; }],
  ["unauthorized supply", o => { o.mintSupplyAtomic = "101"; }],
  ["unexplained manager mint counter", o => { o.managerMintedAtomic = "99"; }],
  ["unpaid withdrawal dropped", o => { o.mintSupplyAtomic = "80"; o.managerMintedAtomic = "80"; }],
  ["double-counted withdrawal", o => { o.burnedUnpaidAtomic = "20"; }],
]) test("coherent accounting detects " + name, () => {
  const o = { ...observed }; change(o);
  assert.throws(() => compareDepositAccounting(journal, o), error => error.message === "ReconciliationConfirmedContradiction" && /^[0-9a-f]{64}$/u.test(error.incident.evidenceDigest));
});
for (const amount of [100, -1, "-1", "01", "1.1", "1e9", "18446744073709551616"])
  test("observed SPL amount rejects noncanonical/overflow input " + String(amount), () => assert.throws(() => compareDepositAccounting(journal, { ...observed, mintSupplyAtomic: amount })));
test("atomic precision survives above JavaScript safe integer range", () => {
  const n = "18446744073709551615";
  assert.equal(compareDepositAccounting({ canonicalReserve: n, authorizedUnmintedCredits: "0", mintedSupply: n },
    { canonicalReserve: n, mintSupplyAtomic: n, managerMintedAtomic: n, burnedUnpaidAtomic: "0" }).coverageRequired, n);
});
test("malformed or overflow journal values are not an observed deficit", () => {
  for (const n of ["340282366920938463463374607431768211456", 100, "NaN"])
    assert.throws(() => compareDepositAccounting({ ...journal, mintedSupply: n }, observed), error => error.message !== "ReconciliationConfirmedContradiction");
});

test("one-bank claim/account snapshot binds the exact operation, value and recipient", () => {
  const f = fixture(), result = verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest);
  assert.equal(result.needsCatchup, false); assert.equal(result.deployment.slot, "10");
  assert.equal(depositReconciliationClaimAddresses(f.operations, f.policy.managerProgramId).length, 1);
});
test("minted claim missing from local journal is catch-up, not free reserve or immediate deficit", () => {
  const f = fixture(); f.operations[0].mintReceipt = null;
  assert.equal(verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest).needsCatchup, true);
});
test("unminted pending credit with absent claim remains pending", () => {
  const f = fixture(); f.operations[0].mintReceipt = null; f.snapshot.accounts[f.snapshot.accounts.length - 1] = null;
  assert.equal(verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest).needsCatchup, false);
});
test("already finalized claim disappearing is a retained integrity contradiction", () => {
  const f = fixture(); f.snapshot.accounts[f.snapshot.accounts.length - 1] = null;
  assert.throws(() => verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest), e => e.incident?.reason === "FINALIZED_CLAIM_DISAPPEARED");
});
for (const [name, change] of [
  ["wrong account program", a => { a.owner = "11111111111111111111111111111111"; }],
  ["executable claim", a => { a.executable = true; }],
  ["wrong operation", a => { const b = Buffer.from(a.data[0], "base64"); b[9] ^= 1; a.data[0] = b.toString("base64"); }],
  ["wrong digest", a => { const b = Buffer.from(a.data[0], "base64"); b[41] ^= 1; a.data[0] = b.toString("base64"); }],
  ["wrong amount", a => { const b = Buffer.from(a.data[0], "base64"); b[73] ^= 1; a.data[0] = b.toString("base64"); }],
  ["wrong recipient", a => { const b = Buffer.from(a.data[0], "base64"); b[83] ^= 1; a.data[0] = b.toString("base64"); }],
]) test("claim integrity rejects " + name, () => {
  const f = fixture(); change(f.snapshot.accounts.at(-1));
  assert.throws(() => verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest), e => e.message === "ReconciliationConfirmedContradiction");
});
test("lower bank/context and malformed claim remain unavailable, not fabricated contradictions", () => {
  const f = fixture(); f.snapshot.slot = 8;
  assert.throws(() => verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest), /ReconciliationSolanaSnapshotStale/u);
  f.snapshot.slot = 10; f.snapshot.accounts.at(-1).data[0] = "AAAA";
  assert.throws(() => verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest), e => e.message !== "ReconciliationConfirmedContradiction");
});
test("stale bank with an absent previously minted claim is waiting, not a fabricated loss", () => {
  const f = fixture(); f.snapshot.slot = 8; f.snapshot.accounts[f.snapshot.accounts.length - 1] = null;
  assert.throws(() => verifyDepositClaimSnapshot(f.operations, f.policy, f.snapshot, f.manifest), /ReconciliationSolanaSnapshotStale/u);
});
for (const field of ["nativeGenesis", "solanaDeployment", "managerProgramId", "transceiverProgramId", "mint"])
  test("journal/deployment binding rejects " + field, () => {
    const f = fixture(); f.policy[field] = "fe".repeat(32); assert.throws(() => validateReconciliationBinding(f.policy, f.manifest));
  });
test("live reconciliation refuses plain callback sources", async () => {
  const f = fixture(); await assert.rejects(readDepositReconciliation({ ...f, nativeVerifier: {}, solanaRpc: {} }), /ReconciliationLiveSourcesRequired/u);
});
