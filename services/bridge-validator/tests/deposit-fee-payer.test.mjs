// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Ephemeral cryptography/synthetic accounts; not protected service or chain proof.
import assert from "node:assert/strict";
import test from "node:test";
import { solanaDeliveryFixture } from "../../../tests/integration/solana-delivery-fixture.mjs";
import { validateSolanaDeliveryPolicy, validateSolanaDepositSigningIntent } from "../../relayer/solana-deposit-delivery.mjs";
import { validateDepositFeePayerResponse, ProtectedDepositFeePayerClient, requireDepositFeePayerClient } from "../deposit-fee-payer-ipc.mjs";
import { ProtectedDepositFeePayer, requireProtectedDepositFeePayer } from "../protected-deposit-fee-payer.mjs";
import { mayPerform, mayReport } from "../../../shared/service-integrity-policy.mjs";
test("fee payer signing intent is immutable and requires exactly the unsigned delivery fields", async () => {
  const f = await solanaDeliveryFixture(), { preparedTransactionBase64, ...intent } = await f.delivery();
  const value = validateSolanaDepositSigningIntent(intent, f.policy); intent.attestations[0].signatureHex = "00".repeat(64);
  assert.notEqual(value.intent.attestations[0].signatureHex, intent.attestations[0].signatureHex);
  assert.throws(() => validateSolanaDepositSigningIntent({ ...value.intent, preparedTransactionBase64 }, f.policy));
});
test("fee payer key cannot be a project attester or configured deployment account", async () => {
  const f = await solanaDeliveryFixture();
  for (const key of [...f.policy.manifest.config.attesters, f.policy.manifest.mint.id, f.policy.manifest.manager.id])
    assert.throws(() => validateSolanaDeliveryPolicy({ ...f.policy, feePayerPublicKey: key }));
});
test("fee payer role has only constrained Solana preparation and integrity reports", () => {
  assert.equal(mayPerform("FEE_PAYER", "SIGN_SOLANA_CLAIM"), true);
  for (const action of ["FROST_SIGN", "COORDINATE_SWEEP", "ATTEST_MINT_CREDIT", "BROADCAST_SWEEP", "SUBMIT_CLAIM", "AUTHORIZE_CREDIT"])
    assert.equal(mayPerform("FEE_PAYER", action), false);
  assert.equal(mayPerform("COORDINATOR", "SIGN_SOLANA_CLAIM"), false);
  assert.equal(mayReport("FEE_PAYER", "FEE_PAYER_KEY_INTEGRITY"), true);
  assert.equal(mayReport("FEE_PAYER", "FEE_PAYER_DEPLOYMENT_CHANGED"), true);
  assert.equal(mayReport("FEE_PAYER", "SIGNER_ROLLBACK"), false);
});
for (const kind of ["RECEIPT", "CLAIM"]) test("fee payer response reconstructs the exact signed " + kind, async () => {
  const f = await solanaDeliveryFixture(), packet = await f.delivery(kind), { preparedTransactionBase64, ...intent } = packet;
  assert.deepEqual(validateDepositFeePayerResponse(packet, intent, f.policy), packet);
  const returned = validateDepositFeePayerResponse(packet, intent, f.policy);
  packet.attestations[0].signatureHex = "00".repeat(64);
  assert.notEqual(returned.attestations[0].signatureHex, packet.attestations[0].signatureHex);
});
for (const [name, mutate] of [
  ["operation", v => { v.operationId = "fa".repeat(32); }],
  ["packet", v => { v.preparedTransactionBase64 = Buffer.alloc(100).toString("base64"); }],
  ["blockhash", v => { v.recentBlockhash = "11111111111111111111111111111111"; }],
  ["expiry", v => { v.lastValidBlockHeight = "1001"; }],
  ["minimum root", v => { v.minimumSlot = "2"; }],
  ["kind", v => { v.kind = "CLAIM"; }],
  ["extra field", v => { v.approved = true; }],
]) test("fee payer response rejects substituted " + name, async () => {
  const f = await solanaDeliveryFixture(), packet = await f.delivery(), { preparedTransactionBase64, ...intent } = packet;
  mutate(packet); assert.throws(() => validateDepositFeePayerResponse(packet, intent, f.policy));
});
test("fee payer capabilities cannot be forged with class prototypes or arbitrary transports", async () => {
  const f = await solanaDeliveryFixture();
  assert.throws(() => new ProtectedDepositFeePayerClient({ ipc: {}, port: 1, policy: f.policy }));
  assert.throws(() => requireDepositFeePayerClient(Object.create(ProtectedDepositFeePayerClient.prototype), f.policy));
  assert.throws(() => requireProtectedDepositFeePayer(Object.create(ProtectedDepositFeePayer.prototype), f.policy, {}));
});
