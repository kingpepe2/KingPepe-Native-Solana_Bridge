// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Derive one exact credit from actual raw Native validation. No callback or
// serialized proof flag substitutes for the verifier's private capability.
import { createHash } from "node:crypto";
import { bridgeInputDigest } from "../../shared/protocol/bridge-inputs.mjs";
import { LocalNativeEvidenceVerifier, requireVerifiedRegtestReserve, verifiedReserveChain } from "../../native/node/native-raw-evidence.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { canonicalJson, canonicalUintDecimal } from "../../native/frost/policy/native-signing-policy.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { validateDepositOperationPolicy, validateDepositOperationPlan, validateDepositCreditFact, depositOperationPolicyDigest } from "./deposit-operation-state.mjs";
import { requireDepositOperationJournal } from "./protected-deposit-journal.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
const digest = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
const check = (value, code = "NativeReserveCreditRejected") => { if (!value) throw new Error(code); };
function window(input) {
  check(input && Object.keys(input).sort().join() === "validFrom,validUntil");
  const validFrom = canonicalUintDecimal(input.validFrom, "validFrom"), validUntil = canonicalUintDecimal(input.validUntil, "validUntil");
  check(BigInt(validUntil) > BigInt(validFrom));
  return { validFrom, validUntil };
}
export function nativeReserveCreditEvidenceInput(plan, policy, acceptedCheckpoint = undefined) {
  const p = validateDepositOperationPolicy(policy), operation = validateDepositOperationPlan(plan, p);
  return { deposit: operation.inputs[0], feeInputs: operation.inputs.slice(1),
    sweepTxid: parseNativeTransactionHex(operation.unsignedTransactionHex).txidHex, reserveVout: 0,
    reserveScriptHex: operation.depositPolicy.canonicalReserveScriptPubKeyHex, feeAtomic: operation.signingIntents[0].feeAtomic,
    minimumConfirmations: p.minimumConfirmations, tapscriptSpends: [operation.depositPolicy.sweep, ...operation.inputs.slice(1).map(() => undefined)],
    ...(acceptedCheckpoint === undefined ? {} : { acceptedCheckpoint: structuredClone(acceptedCheckpoint) }) };
}
export function createVerifiedNativeReserveCredit({ plan, policy, receipt, validityWindow }) {
  requireVerifiedRegtestReserve(receipt);
  const chain = verifiedReserveChain(receipt), p = validateDepositOperationPolicy(policy), operation = validateDepositOperationPlan(plan, p);
  check(chain.genesis === p.nativeGenesis);
  const d = operation.depositIntent, validity = window(validityWindow), identity = depositOperationPolicyDigest(p);
  const reserveAllocationIdHex = bridgeInputDigest("ReserveAllocation", { protocol: "KINGPEPE_PROTECTED_RESERVE_ALLOCATION_V1", policyDigest: identity,
    deposit: { txid: operation.inputs[0].txid, vout: operation.inputs[0].vout },
    sweep: { txid: parseNativeTransactionHex(operation.unsignedTransactionHex).txidHex, vout: 0 } });
  // The raw proof digest binds the retained acceptance checkpoint. Advancing
  // the live tip does not authorize a different envelope after persistence.
  const evidenceDigest = bridgeInputDigest("ReserveCreditEvidence", { protocol: "KINGPEPE_RAW_RESERVE_CREDIT_EVIDENCE_V1", policyDigest: identity, allocationId: reserveAllocationIdHex, proofDigest: receipt.digestHex });
  const encoded = encodeCanonicalBridgeMessage({ action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, nativeGenesis: p.nativeGenesis,
      solanaDeployment: p.solanaDeployment, managerProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint },
    depositOutpoint: { txid: operation.inputs[0].txid, vout: operation.inputs[0].vout }, withdrawalId: "00".repeat(32),
    amountAtomic: d.amountAtomic, feeAtomic: "0", destination: Buffer.from(d.recipientHex, "hex"), policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch,
    nonce: bridgeInputDigest("ReserveCreditNonce", { protocol: "KINGPEPE_PROTECTED_RESERVE_CREDIT_NONCE_V1", allocationId: reserveAllocationIdHex, depositNonce: d.nonceHex }), ...validity, evidenceDigest });
  return validateDepositCreditFact(operation, { acceptedCheckpoint: receipt.acceptedCheckpoint, reserveBasis: receipt.reserveBasis,
    encodedMessageHex: Buffer.from(encoded).toString("hex"), reserveAllocationIdHex }, p);
}
export async function recoverNativeReserveCredit({ journal, integrity, policy, nativeVerifier, operationId, validityWindow }) {
  const p = validateDepositOperationPolicy(policy); requireIntegrityGuard(integrity, "BRIDGE_VALIDATOR");
  requireDepositOperationJournal(journal, p, integrity); check(nativeVerifier instanceof LocalNativeEvidenceVerifier);
  const record = await journal.inspect(operationId);
  check(record.broadcastAttempted && record.signedTransactionHex !== null, "NativeReserveCreditBroadcastNotPrepared");
  const receipt = await nativeVerifier.verifyReserve(nativeReserveCreditEvidenceInput(record.plan, p, record.finalizedCredit?.acceptedCheckpoint));
  const retained = record.finalizedCredit;
  const validity = retained ? decodeCanonicalBridgeMessage(Buffer.from(retained.encodedMessageHex, "hex")) : window(validityWindow);
  const credit = createVerifiedNativeReserveCredit({ plan: record.plan, policy: p, receipt,
    validityWindow: { validFrom: String(validity.validFrom), validUntil: String(validity.validUntil) } });
  if (retained && (credit.encodedMessageHex !== retained.encodedMessageHex || credit.reserveAllocationIdHex !== retained.reserveAllocationIdHex)) {
    await integrity.report(operationId, "IMPOSSIBLE_OPERATION_STATE", digest([retained, credit]));
    throw new Error("NativeReserveCreditChanged");
  }
  // Retain an already-created obligation even while health is suspended. This
  // does NOT authorize attestation/mint, which require current global admission.
  await journal.retainFinalizedCredit(operationId, { receipt, encodedMessageHex: credit.encodedMessageHex,
    reserveAllocationIdHex: credit.reserveAllocationIdHex });
  const current = await journal.inspect(operationId);
  return Object.freeze({ state: current.mintReceipt === null ? "PENDING_MINT_CREDIT_RETAINED" : "FINALIZED_MINT_ALREADY_RECORDED",
    operationId, credit: current.finalizedCredit });
}
export function createRawNativeCreditAttestationVerifier({ policy, nativeVerifier }) {
  const p = validateDepositOperationPolicy(policy); check(nativeVerifier instanceof LocalNativeEvidenceVerifier);
  return async ({ encodedMessageHex, rawEvidence }) => {
    check(typeof encodedMessageHex === "string" && /^[0-9a-f]{1028}$/u.test(encodedMessageHex));
    check(rawEvidence && Object.keys(rawEvidence).sort().join() === "acceptedCheckpoint,plan");
    const plan = validateDepositOperationPlan(rawEvidence.plan, p), message = decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex, "hex"));
    const receipt = await nativeVerifier.verifyReserve(nativeReserveCreditEvidenceInput(plan, p, rawEvidence.acceptedCheckpoint));
    const credit = createVerifiedNativeReserveCredit({ plan, policy: p, receipt,
      validityWindow: { validFrom: message.validFrom.toString(), validUntil: message.validUntil.toString() } });
    check(credit.encodedMessageHex === encodedMessageHex, "NativeCreditAttestationEvidenceChanged");
    return Object.freeze({ operationIdHex: message.operationIdHex, messageDigestHex: message.messageDigestHex,
      evidence: Object.freeze({ trust: "RPC_OBSERVATION", nativeNetwork: p.nativeNetwork, nativeGenesisHash: p.nativeGenesis,
        operationIdHex: message.operationIdHex, depositOutpoint: message.depositOutpointText, amountAtomic: plan.depositIntent.amountAtomic,
        solanaRecipientHex: plan.depositIntent.recipientHex, evidenceDigestHex: message.evidenceDigestHex,
        reserveAllocationIdHex: credit.reserveAllocationIdHex, reserveTransitionState: "CANONICAL_RESERVE", mintCreditState: "AUTHORIZED_UNCONSUMED",
        finalitySatisfied: true, sweepFinalized: true, utxoUnspentAtDeposit: true,
        // This statement is combined with the attester's own durable
        // outpoint/allocation authorization uniqueness before signing.
        noPriorConsumption: true }) });
  };
}
