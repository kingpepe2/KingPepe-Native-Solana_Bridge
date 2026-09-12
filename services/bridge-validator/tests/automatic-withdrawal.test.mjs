// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { createWithdrawalPlan, validateWithdrawalPlan, withdrawalSigningIntents, validateSignedWithdrawal } from "../../../native/reserve/withdrawal-plan.mjs";
import { parseNativeTransactionHex } from "../../../native/node/native-taproot-transaction.mjs";
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";
import { requireFinalizedWithdrawal } from "../../solana-observer/finalized-withdrawal.mjs";
import { compareWithdrawalAccounting } from "../automatic-withdrawal.mjs";
import { base58Encode, base58Decode, base58DecodeInstruction } from "../solana-deposit-claim-transaction-plan.mjs";
const h = v => createHash("sha256").update(v).digest("hex");
const script = "5120" + h("public-reserve-test");
function fixture(patch = {}) {
  const message = { action: "WithdrawalRequest", direction: "SolanaToNative", deployment: { protocolId: 1, nativeNetwork: 1, nativeGenesis: REGTEST_GENESIS,
    solanaDeployment: h("local"), managerProgramId: h("manager"), transceiverProgramId: h("transceiver"), mint: h("mint") },
    depositOutpoint: { txid: "00".repeat(32), vout: 0 }, withdrawalId: h("withdrawal"), amountAtomic: 20n, feeAtomic: 1n,
    destination: "5120" + h("recipient"), policyEpoch: 1, keyEpoch: 1, nonce: h("nonce"), validFrom: 1n, validUntil: 100n, evidenceDigest: h("evidence"), ...patch };
  return { encodedMessageHex: Buffer.from(encodeCanonicalBridgeMessage(message)).toString("hex"), solanaSignature: "1".repeat(64), withdrawalEvidenceDigest: h("verified-withdrawal"),
    inputs: [{ txid: h("reserve-tx"), vout: 0, amountAtomic: "100", scriptPubKeyHex: script }], reserveScriptHex: script, minimumConfirmations: 2,
    acceptedCheckpoint: { protocol: "KINGPEPE_REGTEST_ACCEPTANCE_CHECKPOINT_V1", genesis: REGTEST_GENESIS, tipHash: h("tip"), tipHeight: 5, chainworkHex: "02", minimumConfirmations: 1, evidenceDigestHex: h("native-proof") } };
}
test("payout keeps exact recipient, committed fee and canonical reserve change", () => {
  const p = createWithdrawalPlan(fixture()), tx = parseNativeTransactionHex(p.unsignedTransactionHex);
  assert.equal(tx.outputs[0].amountAtomic, "19"); assert.equal(tx.outputs[1].amountAtomic, "80");
  assert.equal(tx.outputs[1].scriptPubKeyHex, script); assert.equal(tx.inputs[0].sequence, 0xffffffff);
  assert.deepEqual(validateWithdrawalPlan(p), p);
  const [intent] = withdrawalSigningIntents(p);
  assert.equal(intent.purpose, "WITHDRAWAL"); assert.equal(intent.amountAtomic, "19"); assert.equal(intent.feeAtomic, "1"); assert.equal(intent.changeAtomic, "80");
});
test("canonical recipient hex and bytes encode the same economic request", () => {
  assert.equal(fixture().encodedMessageHex, fixture({ destination: Buffer.from("5120" + h("recipient"), "hex") }).encodedMessageHex);
});
test("bounded instruction decoder covers actual BurnChecked and Manager payload widths", () => {
  for (const size of [10, 620]) {
    const bytes = Buffer.alloc(size, 15), encoded = base58Encode(bytes);
    assert.deepEqual(Buffer.from(base58DecodeInstruction(encoded)), bytes); assert.throws(() => base58Decode(encoded));
  }
  assert.throws(() => base58DecodeInstruction("1".repeat(1025))); assert.throws(() => base58DecodeInstruction("0"));
});
for (const [label, change] of [
  ["wrong amount", o => { o.inputs[0].amountAtomic = "1"; }],
  ["foreign reserve", o => { o.inputs[0].scriptPubKeyHex = "5120" + h("foreign"); }],
  ["duplicate input", o => { o.inputs.push({ ...o.inputs[0] }); }],
  ["unsafe JS amount", o => { o.inputs[0].amountAtomic = 100; }],
  ["wrong network", o => { o.acceptedCheckpoint.genesis = h("wrong-chain"); }],
  ["missing proof", o => { o.withdrawalEvidenceDigest = undefined; }],
  ["invalid finality", o => { o.minimumConfirmations = 0; }],
]) test("payout plan rejects " + label, () => { const o = fixture(); change(o); assert.throws(() => createWithdrawalPlan(o)); });
for (const [label, patch] of [["fee consumes amount", { feeAtomic: 20n }], ["malformed destination", { destination: "51" }],
  ["reserve as recipient", { destination: script }]]) test(label, () => assert.throws(() => createWithdrawalPlan(fixture(patch))));
test("unsigned and substituted transactions cannot become signed payout records", () => {
  const p = createWithdrawalPlan(fixture()); assert.throws(() => validateSignedWithdrawal(p, p.unsignedTransactionHex));
  assert.throws(() => validateWithdrawalPlan({ ...p, unsignedTransactionHex: p.unsignedTransactionHex + "00" }));
  assert.throws(() => requireFinalizedWithdrawal({ protocol: "KINGPEPE_FINALIZED_WITHDRAWAL_V1", finalized: true }));
});
test("burned but unpaid amount remains a liability, not surplus", () => {
  const j = { canonicalReserveAtomic: "100", bridgeIssuedOutstandingAtomic: "80", pendingMintAtomic: "0", burnedRecordedAtomic: "20",
    pendingWithdrawalAtomic: "20", broadcastPayoutAtomic: "20", finalizedPayoutAtomic: "0", nativeFeesAtomic: "0" };
  assert.equal(compareWithdrawalAccounting(j, { reserve: "100", supply: "80", managerIssued: "80", recordedBurns: "20" }).state, "MATCH");
  assert.equal(compareWithdrawalAccounting({ ...j, pendingWithdrawalAtomic: "0" }, { reserve: "100", supply: "80", managerIssued: "80", recordedBurns: "20" }).state, "PAUSED");
  assert.equal(compareWithdrawalAccounting(j, { reserve: "79", supply: "80", managerIssued: "80", recordedBurns: "20" }).state, "PAUSED");
  const direct = compareWithdrawalAccounting(j, { reserve: "100", supply: "79", managerIssued: "80", recordedBurns: "20" });
  assert.equal(direct.directBurnDifferenceAtomic, "1");
  assert.equal(compareWithdrawalAccounting(j, { reserve: "100", supply: "60", managerIssued: "60", recordedBurns: "40" }).state, "WAITING_FOR_DEPENDENCY");
});

test("cumulative bridge counters retain u128 precision while SPL supply remains u64", () => {
  const issued = (1n << 64n).toString();
  const j = { canonicalReserveAtomic: issued, bridgeIssuedOutstandingAtomic: issued, pendingMintAtomic: "0",
    pendingWithdrawalAtomic: "0", burnedRecordedAtomic: "0", finalizedPayoutAtomic: "0" };
  const r = compareWithdrawalAccounting(j, { reserve: issued, supply: "1", managerIssued: issued, recordedBurns: "0" });
  assert.equal(r.state, "MATCH"); assert.equal(r.directBurnDifferenceAtomic, ((1n << 64n) - 1n).toString());
  assert.throws(() => compareWithdrawalAccounting(j, { reserve: issued, supply: issued, managerIssued: issued, recordedBurns: "0" }));
});
