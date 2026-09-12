// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic account/transport-state tests, not real-chain or DPAPI evidence.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { solanaDeliveryFixture } from "../../../tests/integration/solana-delivery-fixture.mjs";
import { validateSolanaDeliveryResponse } from "../solana-deposit-ipc.mjs";
import { sanitizedRpcDiagnostic, SolanaLocalRpcClient } from "../../bridge-validator/solana-deposit-claim-submitter.mjs";
import { validateSolanaDepositDelivery, initialSolanaDepositOutbox, decodeSolanaDepositOutbox,
  newSolanaDeliveryRecord, verifySolanaDeliveryAccounts, validateSolanaDeliveryStatus, solanaDeliveryId } from "../solana-deposit-delivery.mjs";
let f, first, replacement, claim;
before(async () => { f = await solanaDeliveryFixture(); first = await f.delivery(); replacement = await f.delivery("RECEIPT", 1); claim = await f.delivery("CLAIM"); });
const state = () => { const v = JSON.parse(initialSolanaDepositOutbox(f.policy)); v.records.push(newSolanaDeliveryRecord(first, f.policy)); return v; };
const decode = v => decodeSolanaDepositOutbox(Buffer.from(JSON.stringify(v)), f.policy);

test("delivery diagnostics preserve only bounded preflight codes, never provider payloads", () => {
  const input = { code: -32002, executionFault: "SBF_COMPUTE_BUDGET_EXCEEDED", transactionFailure: "BlockhashNotFound",
    instructionFailure: { index: 0, customCode: 123, extra: "untrusted-private-data" },
    message: "untrusted-private-data", data: "untrusted-private-data", stack: "untrusted-private-data" };
  assert.deepEqual(sanitizedRpcDiagnostic(input), { rpcCode: -32002, executionFault: "SBF_COMPUTE_BUDGET_EXCEEDED",
    transactionFailure: "BlockhashNotFound", instructionFailure: { index: 0, customCode: 123 } });
  assert(!JSON.stringify(sanitizedRpcDiagnostic(input)).includes("untrusted-private-data"));
});
test("delivery diagnostics reject unbounded and invented failure fields", () => {
  for (const input of [{ code: Infinity, executionFault: "untrusted-private-data", transactionFailure: "untrusted-private-data" },
    { instructionFailure: { index: -1, customCode: 1 } }, { instructionFailure: { index: 256, customCode: 1 } },
    { instructionFailure: { index: 0, customCode: 0x1_0000_0000 } },
    { instructionFailure: { index: 0, reason: "untrusted-private-data" } }])
    assert.deepEqual(sanitizedRpcDiagnostic(input), {});
});
for (const failure of ["BlockhashNotFound", "InsufficientFundsForFee", "untrusted-private-data", { untrusted: "private-data" }])
  test("RPC transaction-level rejection has bounded diagnostic: " + (typeof failure === "string" && failure !== "untrusted-private-data" ? failure : "REDACTED"), async () => {
    // Synthetic provider response tests redaction, not actual chain execution.
    const rpc = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:54321", fetchImpl: async (_, request) => {
      const id = JSON.parse(request.body).id;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32002, message: "untrusted-private-data",
        data: { err: failure, logs: ["untrusted-private-data"] } } }), { status: 200 });
    } });
    await assert.rejects(rpc.getBlockHeight(), error => {
      const diagnostic = sanitizedRpcDiagnostic(error), expected = ["BlockhashNotFound", "InsufficientFundsForFee"].includes(failure);
      assert.deepEqual(diagnostic, { rpcCode: -32002, ...(expected ? { transactionFailure: failure } : {}) });
      assert(!JSON.stringify(diagnostic).includes("untrusted-private-data")); return true;
    });
  });

for (const kind of ["RECEIPT", "CLAIM"]) test("authenticated negative " + kind + " lookup is not a finalized account or enqueue acknowledgement", () => {
  const delivery = kind === "RECEIPT" ? first : claim;
  const expected = validateSolanaDepositDelivery(delivery, f.policy);
  const value = { state: "NOT_ENQUEUED", deliveryId: solanaDeliveryId(delivery, f.policy),
    operationId: delivery.operationId, kind, signature: expected.signature };
  assert.deepEqual(validateSolanaDeliveryResponse(value, delivery, f.policy, "solanaDepositStatus"), value);
  assert.throws(() => validateSolanaDeliveryResponse(value, delivery, f.policy, "enqueueSolanaDeposit"));
  assert.throws(() => validateSolanaDeliveryResponse({ ...value, observedSlot: "1" }, delivery, f.policy, "solanaDepositStatus"));
});
test("authenticated negative lookup binds delivery, operation, kind and exact signature", () => {
  const value = { state: "NOT_ENQUEUED", deliveryId: solanaDeliveryId(claim, f.policy),
    operationId: claim.operationId, kind: "CLAIM", signature: validateSolanaDepositDelivery(claim, f.policy).signature };
  for (const change of [{ deliveryId: "00".repeat(32) }, { operationId: "00".repeat(32) },
    { kind: "RECEIPT" }, { signature: "wrong" }, { state: "FINALIZED_ACCOUNT" }, { state: "UNKNOWN" }])
    assert.throws(() => validateSolanaDeliveryResponse({ ...value, ...change }, claim, f.policy, "solanaDepositStatus"));
});
test("signed receipt and claim are distinct deliveries of the same exact operation", () => {
  const a = validateSolanaDepositDelivery(first, f.policy), b = validateSolanaDepositDelivery(claim, f.policy);
  assert.equal(a.message.operationIdHex, b.message.operationIdHex); assert.notEqual(solanaDeliveryId(first, f.policy), solanaDeliveryId(claim, f.policy));
  const v = state(); v.records.push(newSolanaDeliveryRecord(claim, f.policy)); assert.equal(decode(v).records.length, 2);
});
test("capture is immutable from the caller and contains no economic completion assertion", () => {
  const input = structuredClone(first), v = validateSolanaDepositDelivery(input, f.policy);
  input.attestations[0].signatureHex = "00"; assert.notEqual(v.delivery.attestations[0].signatureHex, "00");
  assert(!Object.hasOwn(v.delivery, "finalityVerified")); assert(!Object.hasOwn(v.delivery, "minted"));
});
for (const [name, mutate] of [
  ["wrong kind", v => { v.kind = "PAYOUT"; }], ["wrong blockhash", v => { v.recentBlockhash = f.policy.manifest.mint.id; }],
  ["wrong epoch", v => { v.attestations[0].keyEpoch++; }], ["wrong attester role", v => { v.attestations[0].role = "ATTESTER_B"; }],
  ["duplicate attester", v => { v.attestations[1] = v.attestations[0]; }], ["invalid signature", v => { v.attestations[0].signatureHex = "00".repeat(64); }],
  ["noncanonical encoding", v => { v.encodedMessageHex += "00"; }], ["extra proof flag", v => { v.proofVerified = true; }],
  ["wrong signed packet", v => { v.preparedTransactionBase64 = "AA=="; }], ["unsafe height", v => { v.lastValidBlockHeight = 1000; }],
  ["stale minimum slot", v => { v.minimumSlot = "0"; }], ["negative height", v => { v.lastValidBlockHeight = "-1"; }],
]) test("Solana delivery rejects " + name, () => { const v = structuredClone(first); mutate(v); assert.throws(() => validateSolanaDepositDelivery(v, f.policy)); });
test("wrong manifest, fee payer, genesis or policy cannot reopen a signed delivery", () => {
  for (const mutate of [p => { p.feePayerPublicKey = p.manifest.mint.id; }, p => { p.operationPolicy.keyEpoch++; },
    p => { p.operationPolicy.nativeGenesis = "00".repeat(32); }, p => { p.manifest.config.attesters.reverse(); }]) {
    const p = structuredClone(f.policy); mutate(p); assert.throws(() => validateSolanaDepositDelivery(first, p));
  }
});
test("old signature outcome must be retained before a rebuilt blockhash is admitted", () => {
  const v = state(); v.records.push(newSolanaDeliveryRecord(replacement, f.policy)); assert.throws(() => decode(v));
  Object.assign(v.records[0], { outcome: "EXPIRED_UNSEEN", observedSlot: replacement.minimumSlot, finalizedHeight: "1001" });
  assert.equal(decode(v).records.length, 2);
  v.records[0].outcome = "FINALIZED_ACCOUNT"; assert.throws(() => decode(v));
});
test("an expired envelope needs a strictly later finalized height, not a timeout", () => {
  const v = state(); Object.assign(v.records[0], { outcome: "EXPIRED_UNSEEN", observedSlot: "10", finalizedHeight: "1000" });
  assert.throws(() => decode(v)); v.records[0].finalizedHeight = "1001"; assert.equal(decode(v).records[0].outcome, "EXPIRED_UNSEEN");
});
test("duplicate delivery, reused deposit and state time rollback fail closed", () => {
  const v = state(); v.records.push(structuredClone(v.records[0])); assert.throws(() => decode(v));
  v.records[1].delivery.operationId = "11".repeat(32); assert.throws(() => decode(v));
  const old = state(); old.lastTimeMs = Date.now() + 60000; assert.throws(() => decode(old));
});
for (const [name, mutate] of [
  ["negative send count", r => { r.sendAttempts = -1; }], ["unbounded send count", r => { r.sendAttempts = 33; }],
  ["send before persistence", r => { r.sendAttempts = 1; }], ["unbounded retry", r => { r.retryAfter = 30001; }],
  ["unknown outcome", r => { r.outcome = "AUTO_APPROVED"; }], ["missing observed root", r => { r.outcome = "FINALIZED_ACCOUNT"; }],
]) test("retained Solana delivery rejects " + name, () => { const v = state(); mutate(v.records[0]); assert.throws(() => decode(v)); });
test("one finalized bank distinguishes absence, receipt and minted claim", () => {
  assert.deepEqual(verifySolanaDeliveryAccounts(first, f.policy, f.accounts()), { slot: "10", receiptExists: false, claimExists: false, genesis: f.policy.manifest.solanaGenesis });
  assert.equal(verifySolanaDeliveryAccounts(first, f.policy, f.accounts({ receipt: true })).receiptExists, true);
  assert.equal(verifySolanaDeliveryAccounts(claim, f.policy, f.accounts({ receipt: true, claim: true })).claimExists, true);
});
for (const [name, mutate] of [
  ["wrong genesis", s => { s.genesis = f.policy.manifest.mint.id; }], ["wrong program data", s => { s.accounts[0].executable = false; }],
  ["wrong receipt authority", s => { s.accounts.at(-2).owner = f.policy.manifest.manager.id; }],
  ["substituted receipt bytes", s => { const b = Buffer.from(s.accounts.at(-2).data[0], "base64"); b[9] ^= 1; s.accounts.at(-2).data[0] = b.toString("base64"); }],
  ["wrong claim amount", s => { const b = Buffer.from(s.accounts.at(-1).data[0], "base64"); b[73] ^= 1; s.accounts.at(-1).data[0] = b.toString("base64"); }],
  ["wrong recipient", s => { const b = Buffer.from(s.accounts.at(-1).data[0], "base64"); b[83] ^= 1; s.accounts.at(-1).data[0] = b.toString("base64"); }],
  ["claim without receipt", s => { s.accounts[s.accounts.length - 2] = null; }],
]) test("Solana delivery account observation rejects " + name, () => { const s = f.accounts({ receipt: true, claim: true }); mutate(s); assert.throws(() => verifySolanaDeliveryAccounts(claim, f.policy, s)); });
test("unfinalized or malformed execution status never means a finalized delivery", () => {
  assert.equal(validateSolanaDeliveryStatus(null), null);
  assert.equal(validateSolanaDeliveryStatus({ err: null, slot: 10, confirmationStatus: "processed" }).finalized, false);
  assert.equal(validateSolanaDeliveryStatus({ err: {}, slot: 10, confirmationStatus: "finalized" }).successful, false);
  for (const s of [{}, { err: undefined, slot: 10, confirmationStatus: "finalized" }, { err: null, slot: -1, confirmationStatus: "finalized" }])
    assert.throws(() => validateSolanaDeliveryStatus(s));
});
