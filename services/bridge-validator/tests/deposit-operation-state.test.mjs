// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual ephemeral FROST/signature computation; checkpoint/chain facts below
// are codec fixtures, NOT a Native-node or protected Windows service proof.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalTaprootSighashEvidences, parseNativeTransactionHex } from "../../../native/node/native-taproot-transaction.mjs";
import { base58Encode } from "../solana-deposit-claim-transaction-plan.mjs";
import { depositOperationFixture } from "../../../tests/integration/deposit-operation-fixture.mjs";
import { initialDepositOperationState, decodeDepositOperationState, validateDepositOperationPlan, validateDepositOperationPolicy,
  depositOperationAccounting, MAX_DEPOSIT_OPERATIONS } from "../deposit-operation-state.mjs";
import { ProtectedDepositOperationJournal, requireDepositOperationJournal } from "../protected-deposit-journal.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";
import { ProtectedDepositSnapshotClient, requireDepositSnapshotClient } from "../protected-deposit-snapshot.mjs";

const h = value => createHash("sha256").update(value).digest("hex");
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const repoRoot = path.resolve(import.meta.dirname, "../../..");
let fixture, testRoot;
before(async () => {
  testRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-deposit-journal-unit-"));
  fixture = await depositOperationFixture({ root: testRoot, repoRoot });
});
after(() => {
  if (!testRoot) return;
  assert.equal(path.dirname(testRoot), path.resolve(os.tmpdir()));
  assert(path.basename(testRoot).startsWith("kingpepe-deposit-journal-unit-"));
  rmSync(testRoot, { recursive: true, force: true });
});
const decode = state => decodeDepositOperationState(Buffer.from(JSON.stringify(state)), fixture.policy);
const current = () => structuredClone(fixture.state);
function finalized() { const s = current(), r = s.operations[0]; r.signedTransactionHex = fixture.signedTransactionHex;
  r.broadcastAttempted = true; r.finalizedCredit = structuredClone(fixture.finalizedCredit); return s; }

test("deposit protected purpose is exclusive to the Bridge Validator role", () => {
  const context = { role: "BRIDGE_VALIDATOR", purpose: "deposit-operations", serviceSid: "S-1-5-21-1-2-3-1001",
    environment: "localnet", nativeGenesis: h("test genesis"), solanaDeployment: h("test deployment"), instanceId: h("test instance"), keyEpoch: 1 };
  assert.equal(normalizeProtectedContext(context).purpose, "deposit-operations");
  for (const role of ["COORDINATOR", "RELAYER", "RECONCILIATION", "INDEXER", "KINGPEPE_FROST_A", "ATTESTER_A"])
    assert.throws(() => normalizeProtectedContext({ ...context, role }), /ProtectedRolePurposeInvalid/u);
});
test("protected deposit journal rejects caller storage adapters before reading them", async () => {
  let read = false;
  await assert.rejects(ProtectedDepositOperationJournal.open({ store: { read() { read = true; } }, integrity: {}, policy: fixture.policy }), /ProtectedStoreRoleMismatch/u);
  assert.equal(read, false);
});
test("protected deposit journal capability cannot be forged from its prototype", () => {
  const forged = Object.create(ProtectedDepositOperationJournal.prototype);
  assert.throws(() => requireDepositOperationJournal(forged, fixture.policy, {}), /ProtectedDepositJournalRequired/u);
  assert.throws(() => requireDepositOperationJournal(new Proxy(forged, {}), fixture.policy, {}), /ProtectedDepositJournalRequired/u);
});
test("protected finalized-credit entry point does not accept serializable proof flags", async () => {
  const forged = Object.create(ProtectedDepositOperationJournal.prototype);
  await assert.rejects(forged.retainFinalizedCredit(fixture.plan.operationId, { receipt: { ...fixture.finalizedCredit, proofVerified: true } }), /RAW_NATIVE_VERIFIED_RESERVE_REQUIRED/u);
});
test("protected finalized-mint entry point does not accept caller settlement flags", async () => {
  const forged = Object.create(ProtectedDepositOperationJournal.prototype);
  await assert.rejects(forged.retainFinalizedMint(fixture.plan.operationId, { ...fixture.mintReceipt, finalized: true }), /ProtectedClaimObservationRequired/u);
});
test("protected reconciliation snapshot rejects caller transport and client capabilities", () => {
  assert.throws(() => new ProtectedDepositSnapshotClient({ ipc: { role: "RECONCILIATION", peerRole: "BRIDGE_VALIDATOR" }, port: 1, policy: fixture.policy }), /DepositSnapshotRejected/u);
  assert.throws(() => requireDepositSnapshotClient(Object.create(ProtectedDepositSnapshotClient.prototype), fixture.policy), /DepositSnapshotRejected/u);
});

function remappedPlan(inputs, sequence = 0xffff_ffff) {
  const p = JSON.parse(JSON.stringify(fixture.plan)); p.operationId = h("second operation"); p.inputs = inputs;
  p.unsignedTransactionHex = Buffer.concat([u32(2), Buffer.of(inputs.length), ...inputs.flatMap(i =>
    [Buffer.from(i.txid, "hex").reverse(), u32(i.vout), Buffer.of(0), u32(sequence)]), Buffer.of(1),
    u64(p.depositIntent.amountAtomic), Buffer.of(34), Buffer.from(p.depositPolicy.canonicalReserveScriptPubKeyHex, "hex"), u32(0)]).toString("hex");
  const e = createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: p.unsignedTransactionHex,
    spentOutputs: inputs.map(i => ({ amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex })),
    tapscriptSpends: [p.depositPolicy.sweep, undefined], proofFingerprintHex: p.acceptedCheckpoint.evidenceDigestHex,
    reserveAmountAtomic: p.depositIntent.amountAtomic, nativeMinerFeeAtomic: "1000",
    expectedRecipientScriptPubKeyHex: p.depositPolicy.canonicalReserveScriptPubKeyHex, expectedChangeScriptPubKeyHex: p.depositPolicy.canonicalReserveScriptPubKeyHex });
  p.signingIntents = p.signingIntents.map((i, n) => ({ ...i, operationId: p.operationId, signingRequestId: h("remapped " + n),
    unsignedNativeTransactionId: e[n].unsignedNativeTransactionId, taprootSighashHex: e[n].taprootSighashHex,
    transactionCommitment: e[n].transactionCommitment, inputOutpoints: e[n].inputOutpoints,
    outputCommitments: e[n].outputCommitments, reserveCommitment: e[n].reserveCommitment }));
  return p;
}

test("deposit operation retains exact raw plan and immutable per-input FROST requests", () => {
  const plan = validateDepositOperationPlan(fixture.plan, fixture.policy); assert(Object.isFrozen(plan.signingIntents[0]));
  assert.deepEqual(decode(current()), fixture.state);
});
test("signed broadcast ambiguity is encumbered and creates no operator surplus or mint credit", () => {
  const s = current(); s.operations[0].signedTransactionHex = fixture.signedTransactionHex; s.operations[0].broadcastAttempted = true;
  const totals = depositOperationAccounting(s, fixture.policy);
  assert.equal(totals.unresolvedSignedSweepAmount, "100000000"); assert.equal(totals.canonicalReserve, "0");
  assert.equal(totals.authorizedUnmintedCredits, "0"); assert.equal(totals.surplus, "0"); assert.equal(totals.reservedInputCount, 2);
});
test("finalized sweep records reserve and pending liability together; mint changes liability form only", () => {
  const s = finalized(), before = depositOperationAccounting(s, fixture.policy);
  assert.equal(before.canonicalReserve, "100000000"); assert.equal(before.authorizedUnmintedCredits, "100000000"); assert.equal(before.unresolvedSignedSweepAmount, "0");
  s.operations[0].mintReceipt = structuredClone(fixture.mintReceipt); const after = depositOperationAccounting(s, fixture.policy);
  assert.equal(after.mintedSupply, "100000000"); assert.equal(after.authorizedUnmintedCredits, "0"); assert.equal(after.surplus, "0");
});
for (const [name, mutate] of [
  ["wrong environment", p => { p.environment = "mainnet"; }],
  ["wrong genesis", p => { p.nativeGenesis = h("wrong"); }],
  ["unsafe numeric amount", p => { p.maximumAmountAtomic = Number.MAX_SAFE_INTEGER + 1; }],
  ["overflow fee", p => { p.maximumFeeAtomic = "18446744073709551616"; }],
  ["unapproved option", p => { p.autoApprove = true; }],
]) test("operation policy rejects " + name, () => { const p = structuredClone(fixture.policy); mutate(p); assert.throws(() => validateDepositOperationPolicy(p)); });
for (const [name, mutate] of [
  ["wrong recipient", p => { p.depositIntent.recipientHex = h("wrong"); }],
  ["wrong mint", p => { p.depositIntent.mintHex = h("wrong"); }],
  ["wrong epoch", p => { p.signingIntents[0].keyEpoch++; }],
  ["wrong amount", p => { p.signingIntents[0].amountAtomic = "999"; }],
  ["wrong fee", p => { p.signingIntents[0].feeAtomic = "1"; }],
  ["wrong change", p => { p.signingIntents[0].changeAtomic = "1"; }],
  ["wrong transaction", p => { p.signingIntents[0].transactionCommitment = h("wrong"); }],
  ["wrong sighash", p => { p.signingIntents[1].taprootSighashHex = h("wrong"); }],
  ["different per-input operation", p => { p.signingIntents[1].operationId = h("wrong"); }],
  ["duplicate request identity", p => { p.signingIntents[1].signingRequestId = p.signingIntents[0].signingRequestId; }],
  ["missing input request", p => { p.signingIntents.pop(); }],
  ["reordered inputs", p => { p.inputs.reverse(); }],
  ["fee source substituted", p => { p.inputs[1].scriptPubKeyHex = p.inputs[0].scriptPubKeyHex; }],
  ["wrong checkpoint domain", p => { p.acceptedCheckpoint.genesis = h("wrong"); }],
  ["raw transaction trailing data", p => { p.unsignedTransactionHex += "00"; }],
]) test("operation plan rejects " + name, () => { const p = JSON.parse(JSON.stringify(fixture.plan)); mutate(p); assert.throws(() => validateDepositOperationPlan(p, fixture.policy)); });
for (const [name, change] of [
  ["broadcast without signature", r => { r.broadcastAttempted = true; }],
  ["acknowledged without attempt", r => { r.broadcastAccepted = true; }],
  ["credit without broadcast", r => { r.finalizedCredit = fixture.finalizedCredit; }],
  ["mint before credit", r => { r.mintReceipt = fixture.mintReceipt; }],
  ["malformed signed transaction", r => { r.signedTransactionHex = "00"; }],
  ["caller approval marker", r => { r.proofVerified = true; }],
]) test("operation journal rejects " + name, () => { const s = current(); change(s.operations[0]); assert.throws(() => decode(s)); });
test("different operation IDs cannot reserve the same deposit or fee input", () => {
  const s = current(), copy = structuredClone(s.operations[0]); copy.plan.operationId = h("second operation");
  for (const [index, intent] of copy.plan.signingIntents.entries()) { intent.operationId = copy.plan.operationId; intent.signingRequestId = h("second request " + index); }
  s.operations.push(copy); assert.throws(() => decode(s), /DepositInputAlreadyReserved/u);
});
test("operation plan reserves evidence capacity for the eventual sweep transaction", () => {
  const p = structuredClone(fixture.plan);
  p.inputs = Array.from({ length: 16 }, (_, index) => ({ ...p.inputs[index === 0 ? 0 : 1], txid: h("capacity-input-" + index) }));
  assert.throws(() => validateDepositOperationPlan(p, fixture.policy), /DepositInputEvidenceCapacity/u);
});
test("operation journal rejects capacity, duplicate JSON fields, trailing bytes and policy substitution", () => {
  const s = current(); s.operations = Array(MAX_DEPOSIT_OPERATIONS + 1).fill(s.operations[0]); assert.throws(() => decode(s));
  const empty = initialDepositOperationState(fixture.policy).toString();
  assert.throws(() => decodeDepositOperationState(Buffer.from(empty.replace('"operations":[]', '"operations":[],"operations":[]')), fixture.policy));
  assert.throws(() => decodeDepositOperationState(Buffer.from(empty + " "), fixture.policy));
  assert.throws(() => decodeDepositOperationState(Buffer.from(empty), { ...fixture.policy, keyEpoch: 2 }));
});
test("no operation order permits bridge backing to fund another deposit's fee", () => {
  const s = current(), inputs = structuredClone(fixture.plan.inputs); inputs[0].txid = h("second deposit");
  inputs[1].txid = parseNativeTransactionHex(fixture.plan.unsignedTransactionHex).txidHex; inputs[1].vout = 0;
  const p = remappedPlan(inputs); validateDepositOperationPlan(p, fixture.policy);
  s.operations.push({ ...structuredClone(s.operations[0]), plan: p });
  assert.throws(() => decode(s), /DepositBackingCannotFundFees/u);
  s.operations.reverse(); assert.throws(() => decode(s), /DepositBackingCannotFundFees/u);
});
test("fully rebound RBF transaction still violates the explicit no-replacement policy", () => {
  const p = remappedPlan(structuredClone(fixture.plan.inputs), 0xffff_fffd);
  assert.throws(() => validateDepositOperationPlan(p, fixture.policy), /DepositSweepReplacementDisabled/u);
});
for (const [name, mutate] of [
  ["wrong reserve basis", f => { f.reserveBasis.sweep.txid = h("wrong"); }],
  ["wrong reserve destination", f => { f.reserveBasis.reserveScriptHex = "5120" + h("wrong"); }],
  ["wrong reserve amount", f => { f.reserveBasis.amountAtomic = "1"; }],
  ["insufficient finality", f => { f.reserveBasis.sweep.height = 100; }],
  ["wrong credit allocation", f => { f.reserveAllocationIdHex = "bad"; }],
  ["alternate message serialization", f => { f.encodedMessageHex += "00"; }],
]) test("operation credit rejects " + name, () => { const s = finalized(); mutate(s.operations[0].finalizedCredit); assert.throws(() => decode(s)); });
for (const [name, mutate] of [
  ["wrong genesis", r => { r.genesis = base58Encode(Buffer.from(h("wrong"), "hex")); }],
  ["stale deployment slot", r => { r.slot = "1"; }],
  ["unrooted mint", r => { r.rootSlot = "8"; }],
  ["wrong operation", r => { r.operationId = h("wrong"); }],
  ["wrong message", r => { r.messageDigest = h("wrong"); }],
  ["wrong amount", r => { r.amountAtomic = "1"; }],
  ["wrong recipient", r => { r.recipientHex = h("wrong"); }],
  ["wrong mint", r => { r.mint = h("wrong"); }],
  ["invalid signature encoding", r => { r.signature = "bad"; }],
]) test("retained mint receipt rejects " + name, () => {
  const s = finalized(); s.operations[0].mintReceipt = structuredClone(fixture.mintReceipt);
  mutate(s.operations[0].mintReceipt); assert.throws(() => decode(s));
});
