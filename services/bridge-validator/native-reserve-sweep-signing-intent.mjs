import {
  FROST_SIGNING_INTENT_PROTOCOL,
  FROST_SIGNING_MODE,
  canonicalJson,
  createNativeSigningPolicy,
  evaluateNativeSigningPolicy,
  nativeSigningIntentDigest,
  validateNativeSigningIntent,
} from "../../native/frost/index.mjs";
import { hashJson, isHash32Hex, normalizeHex } from "../../shared/protocol/canonical-message.mjs";

export const LOCAL_NATIVE_RESERVE_SWEEP_SIGNING_INTENT_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_NATIVE_RESERVE_SWEEP_SIGNING_INTENT/V1";
export const LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE/V1";

const ZERO_HASH = "00".repeat(32);
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;

export function prepareLocalNativeReserveSweepSigningIntent(input) {
  const value = requireObject(input, "input");
  const config = normalizeLocalSigningConfig(value.config);
  const deposit = normalizeValidatedDeposit(value.deposit);
  const draft = normalizeUnsignedReserveSweepDraft(value.reserveSweepDraft);
  const sighashEvidence = normalizeTaprootSighashEvidence(value.nativeSighashEvidence);
  const operationId = normalizeHash32(value.operationIdHex, "operationIdHex");

  if (draft.depositOutpoint !== deposit.depositOutpoint) {
    throw new Error("LocalReserveSweepSigningIntentDepositOutpointMismatch");
  }
  if (draft.proofFingerprintHex !== deposit.proofFingerprintHex || sighashEvidence.proofFingerprintHex !== deposit.proofFingerprintHex) {
    throw new Error("LocalReserveSweepSigningIntentProofFingerprintMismatch");
  }
  if (sighashEvidence.unsignedNativeTransactionFingerprintHex !== draft.unsignedNativeTransactionFingerprintHex) {
    throw new Error("LocalReserveSweepSigningIntentUnsignedTransactionMismatch");
  }
  const depositInputIndex = sighashEvidence.inputOutpoints.indexOf(deposit.depositOutpoint);
  if (depositInputIndex === -1) {
    throw new Error("LocalReserveSweepSigningIntentInputOutpointMismatch");
  }
  const expectedInputOutpoints = [deposit.depositOutpoint, ...draft.feeFundingOutpoints];
  if (canonicalJson(sighashEvidence.inputOutpoints) !== canonicalJson(expectedInputOutpoints)) {
    throw new Error("LocalReserveSweepSigningIntentInputSetMismatch");
  }
  const signingOutpoint = sighashEvidence.inputOutpoints[sighashEvidence.signingInputIndex];
  if (signingOutpoint === undefined) {
    throw new Error("LocalReserveSweepSigningIntentSigningInputOutOfRange");
  }
  if (sighashEvidence.signingInputIndex !== depositInputIndex && !draft.feeFundingOutpoints.includes(signingOutpoint)) {
    throw new Error("LocalReserveSweepSigningIntentUnexpectedSigningInput");
  }
  if (sighashEvidence.nativeMinerFeeAtomic !== draft.nativeMinerFeeAtomic) {
    throw new Error("LocalReserveSweepSigningIntentFeeMismatch");
  }
  if (BigInt(sighashEvidence.nativeMinerFeeAtomic) > 0n && sighashEvidence.inputOutpoints.length === 1) {
    throw new Error("LocalReserveSweepSigningIntentFeeFundingInputRequired");
  }
  const expectedReserveAmount = deposit.amountAtomic;
  if (expectedReserveAmount !== draft.reserveAmountAtomic || expectedReserveAmount !== sighashEvidence.reserveAmountAtomic) {
    throw new Error("LocalReserveSweepSigningIntentReserveAmountMismatch");
  }
  if (sighashEvidence.recipientScriptPubKeyHex !== sighashEvidence.changeScriptPubKeyHex) {
    throw new Error("LocalReserveSweepSigningIntentReserveScriptMismatch");
  }

  const signingRequestId = hashJson({
    protocol: `${LOCAL_NATIVE_RESERVE_SWEEP_SIGNING_INTENT_PROTOCOL}/REQUEST_ID`,
    operationIdHex: operationId,
    depositOutpoint: deposit.depositOutpoint,
    unsignedNativeTransactionFingerprintHex: draft.unsignedNativeTransactionFingerprintHex,
    taprootSighashHex: sighashEvidence.taprootSighashHex,
    transactionCommitment: sighashEvidence.transactionCommitment,
    proofFingerprintHex: deposit.proofFingerprintHex,
  });
  const signingIntent = validateNativeSigningIntent({
    protocol: FROST_SIGNING_INTENT_PROTOCOL,
    mode: FROST_SIGNING_MODE,
    purpose: "RESERVE_SWEEP",
    nativeNetwork: config.nativeNetworkName,
    nativeGenesisHash: config.nativeGenesisHash,
    solanaDeployment: config.solanaDeployment,
    bridgeProgramId: config.bridgeProgramId,
    transceiverProgramId: config.transceiverProgramId,
    mint: config.mint,
    keyEpoch: config.keyEpoch,
    signingRequestId,
    operationId,
    withdrawalId: ZERO_HASH,
    proofFingerprint: deposit.proofFingerprintHex,
    unsignedNativeTransactionId: sighashEvidence.unsignedNativeTransactionId,
    transactionCommitment: sighashEvidence.transactionCommitment,
    signingInputIndex: sighashEvidence.signingInputIndex,
    taprootSighashHex: sighashEvidence.taprootSighashHex,
    recipientScriptPubKeyHex: sighashEvidence.recipientScriptPubKeyHex,
    amountAtomic: deposit.amountAtomic,
    feeAtomic: draft.nativeMinerFeeAtomic,
    changeScriptPubKeyHex: sighashEvidence.changeScriptPubKeyHex,
    changeAtomic: sighashEvidence.changeAtomic,
    inputOutpoints: sighashEvidence.inputOutpoints,
    outputCommitments: sighashEvidence.outputCommitments,
    reserveCommitment: sighashEvidence.reserveCommitment,
    pauseWithdrawals: false,
    hardStop: false,
  });
  const authorizedOperation = Object.freeze({
    signingRequestId: signingIntent.signingRequestId,
    operationId: signingIntent.operationId,
    withdrawalId: signingIntent.withdrawalId,
    taprootSighashHex: signingIntent.taprootSighashHex,
    transactionCommitment: signingIntent.transactionCommitment,
    signingInputIndex: signingIntent.signingInputIndex,
    recipientScriptPubKeyHex: signingIntent.recipientScriptPubKeyHex,
    amountAtomic: signingIntent.amountAtomic,
    feeAtomic: signingIntent.feeAtomic,
    changeScriptPubKeyHex: signingIntent.changeScriptPubKeyHex,
    changeAtomic: signingIntent.changeAtomic,
    inputOutpoints: signingIntent.inputOutpoints,
    outputCommitments: signingIntent.outputCommitments,
    reserveCommitment: signingIntent.reserveCommitment,
  });
  const signerPolicy = createNativeSigningPolicy({
    environment: "localnet",
    nativeNetwork: config.nativeNetworkName,
    nativeGenesisHash: config.nativeGenesisHash,
    solanaDeployment: config.solanaDeployment,
    bridgeProgramId: config.bridgeProgramId,
    transceiverProgramId: config.transceiverProgramId,
    mint: config.mint,
    keyEpoch: config.keyEpoch,
    maxAmountAtomic: config.maxAmountAtomic,
    maxFeeAtomic: config.maxFeeAtomic,
    reserveScriptPubKeyHex: sighashEvidence.changeScriptPubKeyHex,
    authorizedOperations: [authorizedOperation],
  });
  const signerPolicyDecision = evaluateNativeSigningPolicy(signerPolicy, signingIntent);
  if (signerPolicyDecision.result !== "APPROVED") {
    throw new Error(`LocalReserveSweepSigningIntentPolicyRejected:${signerPolicyDecision.failed.join(",")}`);
  }

  return Object.freeze({
    protocol: LOCAL_NATIVE_RESERVE_SWEEP_SIGNING_INTENT_PROTOCOL,
    state: "VERIFIED_READY",
    productionReady: false,
    mainnetActivation: "DISABLED",
    localOnly: true,
    nativeSweepTxidHex: sighashEvidence.nativeSweepTxidHex,
    signingIntent,
    signingIntentDigestHex: nativeSigningIntentDigest(signingIntent),
    authorizedOperation,
    signerPolicyDecision,
  });
}

function normalizeLocalSigningConfig(config) {
  const value = requireObject(config, "config");
  if (value.environment !== "localnet") {
    throw new Error("LocalReserveSweepSigningIntentLocalnetOnly");
  }
  if (value.nativeNetworkName !== "regtest") {
    throw new Error("LocalReserveSweepSigningIntentRegtestOnly");
  }
  return Object.freeze({
    environment: "localnet",
    nativeNetworkName: "regtest",
    nativeGenesisHash: normalizeHash32(value.nativeGenesisHash, "config.nativeGenesisHash"),
    solanaDeployment: normalizeHash32(value.solanaDeployment, "config.solanaDeployment"),
    bridgeProgramId: normalizeHash32(value.bridgeProgramId, "config.bridgeProgramId"),
    transceiverProgramId: normalizeHash32(value.transceiverProgramId, "config.transceiverProgramId"),
    mint: normalizeHash32(value.mint, "config.mint"),
    keyEpoch: checkedPositiveSafeInteger(value.keyEpoch, "config.keyEpoch"),
    maxAmountAtomic: canonicalUintDecimal(value.maxAmountAtomic, "config.maxAmountAtomic"),
    maxFeeAtomic: canonicalUintDecimal(value.maxFeeAtomic, "config.maxFeeAtomic"),
  });
}

function normalizeValidatedDeposit(deposit) {
  const value = requireObject(deposit, "deposit");
  if (value.finalitySatisfied !== true) {
    throw new Error("LocalReserveSweepSigningIntentDepositFinalityRequired");
  }
  if (value.utxoUnspent !== true && value.utxoUnspentAtDeposit !== true) {
    throw new Error("LocalReserveSweepSigningIntentUnspentDepositRequired");
  }
  if (value.noPriorConsumption === false) {
    throw new Error("LocalReserveSweepSigningIntentPriorConsumptionRejected");
  }
  return Object.freeze({
    depositOutpoint: normalizeOutpoint(value.depositOutpoint ?? `${value.txidHex}:${value.vout}`, "deposit.depositOutpoint"),
    amountAtomic: canonicalUintDecimal(value.amountAtomic, "deposit.amountAtomic"),
    proofFingerprintHex: normalizeHash32(value.proofFingerprintHex ?? value.proofFingerprint, "deposit.proofFingerprintHex"),
  });
}

function normalizeUnsignedReserveSweepDraft(draft) {
  const value = requireObject(draft, "reserveSweepDraft");
  if (value.state !== "UNSIGNED_DRAFT_ONLY" || value.signed !== false || value.broadcast !== false) {
    throw new Error("LocalReserveSweepSigningIntentUnsignedDraftRequired");
  }
  return Object.freeze({
    depositOutpoint: normalizeOutpoint(value.depositOutpoint, "reserveSweepDraft.depositOutpoint"),
    reserveAmountAtomic: canonicalUintDecimal(value.reserveAmountAtomic, "reserveSweepDraft.reserveAmountAtomic"),
    nativeMinerFeeAtomic: canonicalUintDecimal(value.nativeMinerFeeAtomic, "reserveSweepDraft.nativeMinerFeeAtomic"),
    feeFundingOutpoints: normalizeOutpointList(value.feeFundingOutpoints ?? [], "reserveSweepDraft.feeFundingOutpoints", {
      allowEmpty: true,
    }),
    unsignedNativeTransactionFingerprintHex: normalizeHash32(
      value.unsignedNativeTransactionFingerprintHex,
      "reserveSweepDraft.unsignedNativeTransactionFingerprintHex",
    ),
    proofFingerprintHex: normalizeHash32(value.proofFingerprintHex, "reserveSweepDraft.proofFingerprintHex"),
  });
}

function normalizeTaprootSighashEvidence(evidence) {
  const value = requireObject(evidence, "nativeSighashEvidence");
  if (value.protocol !== LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL) {
    throw new Error("LocalReserveSweepSigningIntentWrongSighashEvidenceProtocol");
  }
  if (value.state !== "LOCALLY_VALIDATED_NATIVE_SIGHASH") {
    throw new Error("LocalReserveSweepSigningIntentSighashEvidenceNotValidated");
  }
  const outputCommitments = normalizeHashList(value.outputCommitments, "nativeSighashEvidence.outputCommitments");
  if (outputCommitments.length === 0) {
    throw new Error("LocalReserveSweepSigningIntentOutputCommitmentsRequired");
  }
  const inputOutpoints = normalizeOutpointList(value.inputOutpoints, "nativeSighashEvidence.inputOutpoints");
  return Object.freeze({
    unsignedNativeTransactionFingerprintHex: normalizeHash32(
      value.unsignedNativeTransactionFingerprintHex,
      "nativeSighashEvidence.unsignedNativeTransactionFingerprintHex",
    ),
    nativeSweepTxidHex: normalizeHash32(value.nativeSweepTxidHex, "nativeSighashEvidence.nativeSweepTxidHex"),
    unsignedNativeTransactionId: normalizeHash32(
      value.unsignedNativeTransactionId ?? value.nativeSweepTxidHex,
      "nativeSighashEvidence.unsignedNativeTransactionId",
    ),
    transactionCommitment: normalizeHash32(value.transactionCommitment, "nativeSighashEvidence.transactionCommitment"),
    taprootSighashHex: normalizeHash32(value.taprootSighashHex, "nativeSighashEvidence.taprootSighashHex"),
    proofFingerprintHex: normalizeHash32(value.proofFingerprintHex, "nativeSighashEvidence.proofFingerprintHex"),
    signingInputIndex: checkedNonNegativeSafeInteger(value.signingInputIndex, "nativeSighashEvidence.signingInputIndex"),
    recipientScriptPubKeyHex: normalizeNonEmptyHex(value.recipientScriptPubKeyHex, "nativeSighashEvidence.recipientScriptPubKeyHex"),
    changeScriptPubKeyHex: normalizeNonEmptyHex(value.changeScriptPubKeyHex, "nativeSighashEvidence.changeScriptPubKeyHex"),
    changeAtomic: canonicalUintDecimal(value.changeAtomic, "nativeSighashEvidence.changeAtomic"),
    nativeMinerFeeAtomic: canonicalUintDecimal(value.nativeMinerFeeAtomic, "nativeSighashEvidence.nativeMinerFeeAtomic"),
    reserveAmountAtomic: canonicalUintDecimal(value.reserveAmountAtomic, "nativeSighashEvidence.reserveAmountAtomic"),
    inputOutpoints,
    outputCommitments,
    reserveCommitment: normalizeHash32(value.reserveCommitment, "nativeSighashEvidence.reserveCommitment"),
  });
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:ExpectedHash32`);
  }
  return normalized;
}

function normalizeNonEmptyHex(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized.length === 0) {
    throw new Error(`${label}:ExpectedNonEmptyHex`);
  }
  return normalized;
}

function normalizeOutpoint(value, label) {
  if (typeof value === "string") {
    const match = /^(?<txid>[0-9a-fA-F]{64}):(?<vout>0|[1-9][0-9]*)$/u.exec(value);
    if (match === null) {
      throw new Error(`${label}:InvalidOutpoint`);
    }
    return `${match.groups.txid.toLowerCase()}:${Number(match.groups.vout)}`;
  }
  const object = requireObject(value, label);
  const txid = normalizeHash32(object.txid, `${label}.txid`);
  const vout = checkedNonNegativeSafeInteger(object.vout, `${label}.vout`);
  return `${txid}:${vout}`;
}

function normalizeOutpointList(value, label, options = {}) {
  if (!Array.isArray(value) || (value.length === 0 && options.allowEmpty !== true)) {
    throw new Error(`${label}:ExpectedNonEmptyArray`);
  }
  const normalized = value.map((entry, index) => normalizeOutpoint(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label}:DuplicateOutpoint`);
  }
  return Object.freeze(normalized);
}

function normalizeHashList(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label}:ExpectedArray`);
  }
  return Object.freeze(value.map((entry, index) => normalizeHash32(entry, `${label}[${index}]`)));
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function checkedPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}:ExpectedPositiveSafeInteger`);
  }
  return value;
}

function checkedNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}:ExpectedNonNegativeSafeInteger`);
  }
  return value;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}
