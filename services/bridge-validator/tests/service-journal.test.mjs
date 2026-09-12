// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Journal regressions, not substitutes for real-chain service execution.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { depositOperationFixture } from "../../../tests/integration/deposit-operation-fixture.mjs";
import { AuthenticatedLocalDepositLedger } from "../local-deposit-ledger.mjs";
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
let root, fixture;
before(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-service-journal-"));
  fixture = await depositOperationFixture({ root, repoRoot });
});
after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert(path.basename(root).startsWith("kingpepe-service-journal-"));
  rmSync(root, { recursive: true, force: true });
});
function options() { return { environment: "localnet", repoRoot, root: path.join(root, randomBytes(12).toString("hex")),
  deploymentHex: fixture.finalizedCredit.encodedMessageHex.slice(24, 360), journalIdHex: randomBytes(32).toString("hex"), authenticationKey: randomBytes(32) }; }
function use(fn) { const config = options(), ledger = AuthenticatedLocalDepositLedger.createLocal(config); try { return fn(ledger, config); } finally { ledger.close(); } }
const register = l => l.registerServiceDeposit(fixture.plan, fixture.policy);
const update = (l, action, value) => l.updateServiceDeposit(fixture.plan.operationId, action, value);

test("service deposits survive restart in the existing accounting database", () => use((l, config) => {
  register(l); const mark = l.checkpoint(); l.close();
  const reopened = AuthenticatedLocalDepositLedger.openLocal(config);
  try { assert.deepEqual(reopened.checkpoint(), mark); assert.equal(reopened.serviceDeposits()[0].state, "OBSERVED");
    assert.deepEqual(reopened.serviceDeposit(fixture.plan.operationId).operation.plan, fixture.plan); } finally { reopened.close(); }
}));
test("duplicate service deposit is idempotent, changed plan is rejected", () => use(l => {
  register(l); const mark = l.checkpoint(); register(l); assert.deepEqual(l.checkpoint(), mark);
  assert.throws(() => l.registerServiceDeposit({ ...fixture.plan, operationId: "a1".repeat(32) }, fixture.policy));
}));
test("service journal rejects cross-deployment reuse", () => use(l => {
  assert.throws(() => l.registerServiceDeposit(fixture.plan, { ...fixture.policy, mint: "a2".repeat(32) }));
  assert.deepEqual(l.serviceDeposits(), []);
}));
test("service journal rejects signing before validation and skips in lifecycle", () => use(l => {
  register(l); assert.throws(() => update(l, "SIGNED", fixture.signedTransactionHex));
  assert.throws(() => update(l, "BROADCAST", true)); assert.throws(() => update(l, "ACCEPTED", true));
  assert.throws(() => update(l, "COMPLETED", "a3".repeat(32)));
}));
test("signed sweep and broadcast ambiguity survive restart without another signing intent", () => use((l, config) => {
  register(l); update(l, "VALIDATED", fixture.plan.acceptedCheckpoint.evidenceDigestHex);
  update(l, "SIGNED", fixture.signedTransactionHex); update(l, "BROADCAST", true); l.close();
  const reopened = AuthenticatedLocalDepositLedger.openLocal(config);
  try { const r = reopened.serviceDeposit(fixture.plan.operationId);
    assert.equal(r.operation.signedTransactionHex, fixture.signedTransactionHex); assert.equal(r.operation.broadcastAttempted, true);
    assert.equal(r.operation.finalizedCredit, null); assert.equal(reopened.snapshot().mintedSupply, "0");
  } finally { reopened.close(); }
}));
test("service journal rejects changed signed sweep and invalid aggregate signature", () => use(l => {
  register(l); update(l, "VALIDATED", fixture.plan.acceptedCheckpoint.evidenceDigestHex);
  assert.throws(() => update(l, "SIGNED", fixture.signedTransactionHex.slice(0, -20) + "00".repeat(10)));
  update(l, "SIGNED", fixture.signedTransactionHex);
  assert.throws(() => update(l, "SIGNED", fixture.plan.unsignedTransactionHex));
}));
test("finalized sweep credit is retained before an interrupted accounting catch-up", () => use((l, config) => {
  register(l); assert.equal(l.serviceAccountingPending(), false); update(l, "VALIDATED", fixture.plan.acceptedCheckpoint.evidenceDigestHex);
  update(l, "SIGNED", fixture.signedTransactionHex); update(l, "BROADCAST", true); update(l, "ACCEPTED", true);
  update(l, "CREDIT", fixture.finalizedCredit); assert.equal(l.serviceAccountingPending(), true); l.close();
  const reopened = AuthenticatedLocalDepositLedger.openLocal(config);
  try { assert.deepEqual(reopened.serviceDeposit(fixture.plan.operationId).operation.finalizedCredit, fixture.finalizedCredit);
    reopened.recordValidatedDeposit(fixture.finalizedCredit); reopened.recordValidatedDeposit(fixture.finalizedCredit);
    // The accounting amount exists, but its canonical-reserve entry has not
    // been appended yet. A source outage must not turn that into a deficit.
    assert.equal(reopened.serviceAccountingPending(), true);
    assert.equal(reopened.bridgeSnapshot().pendingMintAtomic, fixture.plan.depositIntent.amountAtomic);
    assert.equal(reopened.serviceDeposits()[0].state, "SWEPT");
  } finally { reopened.close(); }
}));
test("policy pause persists, retry cannot unpause, explicit review can resume", () => use((l, config) => {
  l.pause(); const mark = l.checkpoint(); l.pause(); assert.deepEqual(l.checkpoint(), mark); l.close();
  const reopened = AuthenticatedLocalDepositLedger.openLocal(config);
  try { assert.equal(reopened.status().state, "PAUSED"); reopened.resumeAfterReview(); assert.equal(reopened.status().state, "OPEN_LOCAL_ACCOUNTING_ONLY"); }
  finally { reopened.close(); }
}));
test("policy resume cannot clear an integrity stop", () => use((l, config) => {
  l.hardStop("ACCOUNTING_CONTRADICTION"); assert.throws(() => l.resumeAfterReview(), /LocalLedgerHardStop/u); l.close();
  const reopened = AuthenticatedLocalDepositLedger.openLocal(config);
  try { assert.equal(reopened.status().state, "HARD_STOP"); assert.throws(() => reopened.resumeAfterReview(), /LocalLedgerHardStop/u); }
  finally { reopened.close(); }
}));
test("service delivery journal refuses packets without a verified retained credit and two attestations", () => use(l => {
  register(l); assert.throws(() => l.solanaServiceJournal("CLAIM").persistPrepared({ operationIdHex: fixture.plan.operationId }));
  assert.throws(() => l.solanaServiceJournal("UNRECOGNIZED"));
}));
test("unfunded watched requests cannot hide registered settlement work from the service page", () => use(l => {
  for (let i = 0; i < 16; i++) l.watchServiceDeposit({ operationId: randomBytes(32).toString("hex"),
    depositIntent: { ...fixture.plan.depositIntent, nonceHex: randomBytes(32).toString("hex") },
    userRecoveryPublicKeyHex: fixture.plan.depositPolicy.userRecoveryPublicKeyHex, depositTxidHex: randomBytes(32).toString("hex"),
    depositVout: null, feeFundingInputs: fixture.plan.inputs.slice(1) }, fixture.policy);
  register(l);
  assert.equal(l.serviceDepositRequests().length, 16);
  assert.equal(l.serviceDeposits({ limit: 16, registeredOnly: true, pendingOnly: true })[0].operationId, fixture.plan.operationId);
}));
test("expired canonical credit stays owed and cannot be cleared by ordinary policy resume", () => use(l => {
  register(l); update(l, "VALIDATED", fixture.plan.acceptedCheckpoint.evidenceDigestHex);
  update(l, "SIGNED", fixture.signedTransactionHex); update(l, "BROADCAST", true); update(l, "ACCEPTED", true);
  const message = decodeCanonicalBridgeMessage(fixture.finalizedCredit.encodedMessageHex);
  const expired = { ...fixture.finalizedCredit, encodedMessageHex: Buffer.from(encodeCanonicalBridgeMessage({ ...message,
    operationId: undefined, validFrom: 1n, validUntil: 2n })).toString("hex") };
  update(l, "CREDIT", expired); l.recordValidatedDeposit(expired); l.pause("DEPOSIT_CREDIT_EXPIRED");
  assert.throws(() => l.resumeAfterReview(), /LocalLedgerExpiredCreditPending/u);
  assert.equal(l.status().state, "PAUSED"); assert.equal(l.bridgeSnapshot().pendingMintAtomic, fixture.plan.depositIntent.amountAtomic);
  assert.deepEqual(l.serviceDeposit(fixture.plan.operationId).operation.finalizedCredit, expired);
}));
