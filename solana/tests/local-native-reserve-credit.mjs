// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual raw Native proof/credit reconstruction after a real deposit. This
// does not mint a second representation or certify Windows journal recovery.
import assert from "node:assert/strict";
import path from "node:path";
import { runLocalProtectedClaimObservation } from "./local-protected-claim-observation.mjs";
import { createVerifiedNativeReserveCredit, createRawNativeCreditAttestationVerifier } from "../../services/bridge-validator/native-reserve-credit.mjs";
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../.."), passed = [];
try {
  const result = await runLocalProtectedClaimObservation(repoRoot, async f => {
    const record = f.state.operations[0], plan = record.plan, receipt = f.flow.nativeRawEvidence.reserveEvidence;
    const validityWindow = { validFrom: f.flowConfig.depositClaimValidFrom, validUntil: f.flowConfig.depositClaimValidUntil };
    const credit = createVerifiedNativeReserveCredit({ plan, policy: f.policy, receipt, validityWindow });
    const message = decodeCanonicalBridgeMessage(Buffer.from(credit.encodedMessageHex, "hex"));
    assert.equal(message.amountAtomic.toString(), plan.depositIntent.amountAtomic); assert.equal(message.depositOutpointText, plan.inputs[0].txid + ":" + plan.inputs[0].vout);
    assert.equal(message.destinationHex, plan.depositIntent.recipientHex);
    passed.push("ACTUAL_FINALIZED_RESERVE_DERIVES_EXACT_CANONICAL_USER_CREDIT");
    assert.deepEqual(createVerifiedNativeReserveCredit({ plan, policy: f.policy, receipt, validityWindow }), credit);
    passed.push("SAME_ACCEPTED_RESERVE_RECONSTRUCTS_IDENTICAL_ALLOCATION_AND_MESSAGE");
    const verify = createRawNativeCreditAttestationVerifier({ policy: f.policy, nativeVerifier: f.nativeVerifier });
    const rawEvidence = { plan, acceptedCheckpoint: credit.acceptedCheckpoint };
    const a = await verify({ encodedMessageHex: credit.encodedMessageHex, rawEvidence });
    const b = await verify({ encodedMessageHex: credit.encodedMessageHex, rawEvidence });
    assert.deepEqual(a, b); assert.equal(a.evidence.evidenceDigestHex, message.evidenceDigestHex);
    passed.push("TWO_INDEPENDENT_RAW_QUERIES_RECONSTRUCT_IDENTICAL_CREDIT_EVIDENCE");
    for (const [label, update] of [
      ["WRONG_AMOUNT", { amountAtomic: message.amountAtomic - 1n }],
      ["WRONG_RECIPIENT", { destination: Buffer.alloc(32, 19) }],
      ["WRONG_EVIDENCE", { evidenceDigest: Buffer.alloc(32, 20) }],
      ["WRONG_NONCE", { nonce: Buffer.alloc(32, 21) }],
      ["WRONG_EPOCH", { policyEpoch: message.policyEpoch + 1 }],
    ]) {
      const bytes = encodeCanonicalBridgeMessage({ ...message, operationId: undefined, ...update });
      await assert.rejects(verify({ encodedMessageHex: Buffer.from(bytes).toString("hex"), rawEvidence }));
      passed.push(label + "_CANNOT_SUBSTITUTE_REAL_RESERVE_CREDIT");
    }
    assert.throws(() => createVerifiedNativeReserveCredit({ plan, policy: f.policy, receipt: { ...receipt }, validityWindow }), /RAW_NATIVE_VERIFIED_RESERVE_REQUIRED/u);
    passed.push("SERIALIZED_COPY_OF_REAL_RECEIPT_IS_NOT_NATIVE_PROOF_CAPABILITY");
    assert.throws(() => createVerifiedNativeReserveCredit({ plan, policy: f.policy, receipt,
      validityWindow: { validFrom: "2", validUntil: "1" } }));
    passed.push("INVALID_VALIDITY_WINDOW_REJECTED");
  });
  assert.equal(result.pass, 14); assert.equal(passed.length, 10);
  console.log(JSON.stringify({ pass: passed.length, fail: 0, passed, depositPrerequisiteChecks: result.pass,
    scope: "ACTUAL_NATIVE_CREDIT_FACT_RECONSTRUCTION_NOT_PROTECTED_CONTROLLER", productionReady: false, phase09: "NOT_STARTED" }));
} catch { console.error("LOCAL_NATIVE_RESERVE_CREDIT_FAILED"); process.exitCode = 1; }
