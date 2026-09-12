// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Deterministic payout plan, not proof of a Solana burn or signing authority.
import { bridgeInputDigest } from "../../shared/protocol/bridge-inputs.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { REGTEST_GENESIS, verifyRegtestSweepSignatures } from "../node/native-raw-evidence.mjs";
import { createUnsignedNativePayout, createLocalTaprootSighashEvidences, parseNativeTransactionHex } from "../node/native-taproot-transaction.mjs";
import { FROST_SIGNING_INTENT_PROTOCOL, FROST_SIGNING_MODE, canonicalJson, validateNativeSigningIntent, canonicalUintDecimal } from "../frost/policy/native-signing-policy.mjs";
const check = v => { if (!v) throw new Error("WithdrawalPlanRejected"); };
const hex = v => Buffer.from(v).toString("hex");
const hash = v => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);
export function createWithdrawalPlan({ encodedMessageHex, solanaSignature, withdrawalEvidenceDigest, inputs, reserveScriptHex, acceptedCheckpoint, minimumConfirmations }) {
  check(typeof encodedMessageHex === "string" && /^[0-9a-f]{1028}$/u.test(encodedMessageHex));
  const m = decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex, "hex"));
  check(m.action === "WithdrawalRequest" && m.direction === "SolanaToNative" && hex(m.deployment.nativeGenesis) === REGTEST_GENESIS);
  check(m.amountAtomic > m.feeAtomic && /^(?:0014[0-9a-f]{40}|0020[0-9a-f]{64}|5120[0-9a-f]{64})$/u.test(m.destinationHex));
  check(hash(withdrawalEvidenceDigest) && typeof solanaSignature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(solanaSignature));
  check(/^5120[0-9a-f]{64}$/u.test(reserveScriptHex) && m.destinationHex !== reserveScriptHex);
  check(Number.isInteger(minimumConfirmations) && minimumConfirmations >= 1 && minimumConfirmations <= 1000);
  check(acceptedCheckpoint?.genesis === REGTEST_GENESIS && hash(acceptedCheckpoint.evidenceDigestHex) && hash(acceptedCheckpoint.tipHash));
  check(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= 8);
  const normalized = inputs.map(i => {
    check(hash(i.txid) && Number.isInteger(i.vout) && i.vout >= 0 && i.vout <= 0xffffffff && i.scriptPubKeyHex === reserveScriptHex);
    canonicalUintDecimal(i.amountAtomic, "reserve input"); check(BigInt(i.amountAtomic) > 0n);
    return { txid: i.txid, vout: i.vout, amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex };
  });
  const total = normalized.reduce((n, i) => n + BigInt(i.amountAtomic), 0n), change = total - m.amountAtomic;
  check(change >= 0n && total <= 0xffffffffffffffffn);
  const outputs = [{ amountAtomic: (m.amountAtomic - m.feeAtomic).toString(), scriptPubKeyHex: m.destinationHex }];
  if (change > 0n) outputs.push({ amountAtomic: change.toString(), scriptPubKeyHex: reserveScriptHex });
  const unsignedTransactionHex = createUnsignedNativePayout({ inputs: normalized, outputs });
  const plan = { protocol: "KINGPEPE_LOCAL_WITHDRAWAL_PLAN_V1", encodedMessageHex, solanaSignature, withdrawalEvidenceDigest,
    operationId: m.operationIdHex, withdrawalId: m.withdrawalIdHex, inputs: normalized, reserveScriptHex,
    acceptedCheckpoint: structuredClone(acceptedCheckpoint), minimumConfirmations, unsignedTransactionHex };
  check(Buffer.byteLength(JSON.stringify(plan)) <= 4096);
  return structuredClone(plan);
}
export function validateWithdrawalPlan(value) {
  const plan = createWithdrawalPlan(value); check(canonicalJson(plan) === canonicalJson(value)); return plan;
}
export function withdrawalSigningIntents(value) {
  const p = validateWithdrawalPlan(value), m = decodeCanonicalBridgeMessage(Buffer.from(p.encodedMessageHex, "hex")), d = m.deployment;
  const proofFingerprint = bridgeInputDigest("WithdrawalProof", { withdrawal: p.withdrawalEvidenceDigest, native: p.acceptedCheckpoint.evidenceDigestHex });
  return createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: p.unsignedTransactionHex, spentOutputs: p.inputs,
    proofFingerprintHex: proofFingerprint, reserveAmountAtomic: (m.amountAtomic - m.feeAtomic).toString(), nativeMinerFeeAtomic: m.feeAtomic.toString(),
    expectedRecipientScriptPubKeyHex: m.destinationHex, expectedChangeScriptPubKeyHex: p.reserveScriptHex }).map(e => validateNativeSigningIntent({
      protocol: FROST_SIGNING_INTENT_PROTOCOL, mode: FROST_SIGNING_MODE, purpose: "WITHDRAWAL", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
      solanaDeployment: hex(d.solanaDeployment), bridgeProgramId: hex(d.managerProgramId), transceiverProgramId: hex(d.transceiverProgramId), mint: hex(d.mint), keyEpoch: m.keyEpoch,
      signingRequestId: bridgeInputDigest("WithdrawalSigningRequest", { purpose: "NATIVE_WITHDRAWAL", operationId: p.operationId, txid: e.unsignedNativeTransactionId, input: e.signingInputIndex, sighash: e.taprootSighashHex }),
      operationId: p.operationId, withdrawalId: p.withdrawalId, proofFingerprint, unsignedNativeTransactionId: e.unsignedNativeTransactionId,
      transactionCommitment: e.transactionCommitment, signingInputIndex: e.signingInputIndex, taprootSighashHex: e.taprootSighashHex,
      recipientScriptPubKeyHex: m.destinationHex, amountAtomic: (m.amountAtomic - m.feeAtomic).toString(), feeAtomic: m.feeAtomic.toString(),
      changeScriptPubKeyHex: p.reserveScriptHex, changeAtomic: e.changeAtomic, inputOutpoints: e.inputOutpoints, outputCommitments: e.outputCommitments,
      reserveCommitment: e.reserveCommitment, pauseWithdrawals: false, hardStop: false,
    }));
}
export function validateSignedWithdrawal(plan, signedTransactionHex) {
  const p = validateWithdrawalPlan(plan), tx = parseNativeTransactionHex(signedTransactionHex);
  check(tx.strippedHex === p.unsignedTransactionHex);
  verifyRegtestSweepSignatures({ sweep: tx, inputs: p.inputs, reserveScriptHex: p.reserveScriptHex });
  return tx;
}
