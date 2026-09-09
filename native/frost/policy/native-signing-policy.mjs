import { createHash } from "node:crypto";

export const FROST_SIGNING_INTENT_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SIGNING_INTENT/V1";
export const FROST_SIGNING_MODE = "SINGLE_HOST_PROJECT_CONTROLLED_FROST";
export const REQUIRED_FROST_SIGNERS = Object.freeze(["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]);
export const REQUIRED_FROST_THRESHOLD = 2;

const HASH_HEX = /^[0-9a-f]{64}$/u;
const HEX = /^(?:[0-9a-f]{2})*$/u;
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;

export function bytesToHex(value) {
  return Buffer.from(value).toString("hex");
}

export function hexToBytes(value, label = "hex") {
  const normalized = assertHex(value, undefined, label);
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function assertHashHex(value, label) {
  if (typeof value !== "string" || !HASH_HEX.test(value.toLowerCase())) {
    throw new Error(`${label} must be a 32-byte lowercase hex value`);
  }
  return value.toLowerCase();
}

export function assertHex(value, bytes, label) {
  if (typeof value !== "string") throw new Error(`${label} must be hex`);
  const normalized = value.toLowerCase();
  if (!HEX.test(normalized)) throw new Error(`${label} must contain canonical lowercase hex bytes`);
  if (bytes !== undefined && normalized.length !== bytes * 2) {
    throw new Error(`${label} must be ${bytes} bytes`);
  }
  return normalized;
}

export function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label} must be a canonical unsigned decimal string`);
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value) {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Canonical(value) {
  return sha256Hex(canonicalJson(value));
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  throw new Error("unsupported value for canonical JSON");
}

export function createNativeSigningPolicy(options) {
  const authorizedOperations = new Map();
  for (const operation of options.authorizedOperations ?? []) {
    authorizedOperations.set(assertHashHex(operation.signingRequestId, "authorized signing request ID"), normalizeAuthorization(operation));
  }
  return Object.freeze({
    nativeNetwork: options.nativeNetwork,
    nativeGenesisHash: assertHashHex(options.nativeGenesisHash, "policy Native genesis hash"),
    solanaDeployment: assertHashHex(options.solanaDeployment, "policy Solana deployment"),
    bridgeProgramId: assertHashHex(options.bridgeProgramId, "policy bridge program ID"),
    transceiverProgramId: assertHashHex(options.transceiverProgramId, "policy transceiver program ID"),
    mint: assertHashHex(options.mint, "policy mint"),
    keyEpoch: checkedSafeEpoch(options.keyEpoch, "policy key epoch"),
    maxAmountAtomic: BigInt(canonicalUintDecimal(options.maxAmountAtomic, "policy max amount")),
    maxFeeAtomic: BigInt(canonicalUintDecimal(options.maxFeeAtomic, "policy max fee")),
    reserveScriptPubKeyHex: assertHex(options.reserveScriptPubKeyHex, undefined, "policy reserve scriptPubKey"),
    authorizedOperations,
  });
}

function normalizeAuthorization(value) {
  return Object.freeze({
    signingRequestId: assertHashHex(value.signingRequestId, "authorized signing request ID"),
    operationId: assertHashHex(value.operationId, "authorized operation ID"),
    withdrawalId: assertHashHex(value.withdrawalId, "authorized withdrawal ID"),
    taprootSighashHex: assertHashHex(value.taprootSighashHex, "authorized Taproot sighash"),
    transactionCommitment: assertHashHex(value.transactionCommitment, "authorized transaction commitment"),
    signingInputIndex: checkedNonNegativeIndex(value.signingInputIndex, "authorized signing input index"),
    recipientScriptPubKeyHex: assertHex(value.recipientScriptPubKeyHex, undefined, "authorized recipient scriptPubKey"),
    amountAtomic: canonicalUintDecimal(value.amountAtomic, "authorized amount"),
    feeAtomic: canonicalUintDecimal(value.feeAtomic, "authorized fee"),
    changeScriptPubKeyHex: assertHex(value.changeScriptPubKeyHex, undefined, "authorized change scriptPubKey"),
    changeAtomic: canonicalUintDecimal(value.changeAtomic, "authorized change"),
    inputOutpoints: Object.freeze([...value.inputOutpoints]),
    outputCommitments: Object.freeze([...value.outputCommitments]),
    reserveCommitment: assertHashHex(value.reserveCommitment, "authorized reserve commitment"),
  });
}

function checkedSafeEpoch(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

export function validateNativeSigningIntent(intent) {
  if (intent?.protocol !== FROST_SIGNING_INTENT_PROTOCOL) throw new Error("wrong Native FROST signing protocol");
  if (intent.mode !== FROST_SIGNING_MODE) throw new Error("wrong Native FROST signing mode");
  if (!["WITHDRAWAL", "RESERVE_SWEEP", "RESERVE_MIGRATION"].includes(intent.purpose)) {
    throw new Error("unsupported Native FROST signing purpose");
  }
  if (intent.nativeNetwork !== "regtest" && intent.nativeNetwork !== "mainnet") {
    throw new Error("unsupported Native network");
  }
  const normalized = {
    protocol: intent.protocol,
    mode: intent.mode,
    purpose: intent.purpose,
    nativeNetwork: intent.nativeNetwork,
    nativeGenesisHash: assertHashHex(intent.nativeGenesisHash, "Native genesis hash"),
    solanaDeployment: assertHashHex(intent.solanaDeployment, "Solana deployment"),
    bridgeProgramId: assertHashHex(intent.bridgeProgramId, "bridge program ID"),
    transceiverProgramId: assertHashHex(intent.transceiverProgramId, "transceiver program ID"),
    mint: assertHashHex(intent.mint, "mint"),
    keyEpoch: checkedSafeEpoch(intent.keyEpoch, "key epoch"),
    signingRequestId: assertHashHex(intent.signingRequestId, "signing request ID"),
    operationId: assertHashHex(intent.operationId, "operation ID"),
    withdrawalId: assertHashHex(intent.withdrawalId, "withdrawal ID"),
    proofFingerprint: assertHashHex(intent.proofFingerprint, "proof fingerprint"),
    unsignedNativeTransactionId: assertHashHex(intent.unsignedNativeTransactionId, "unsigned Native transaction ID"),
    transactionCommitment: assertHashHex(intent.transactionCommitment, "transaction commitment"),
    signingInputIndex: checkedNonNegativeIndex(intent.signingInputIndex, "signing input index"),
    taprootSighashHex: assertHashHex(intent.taprootSighashHex, "Taproot sighash"),
    recipientScriptPubKeyHex: assertHex(intent.recipientScriptPubKeyHex, undefined, "recipient scriptPubKey"),
    amountAtomic: canonicalUintDecimal(intent.amountAtomic, "amount"),
    feeAtomic: canonicalUintDecimal(intent.feeAtomic, "fee"),
    changeScriptPubKeyHex: assertHex(intent.changeScriptPubKeyHex, undefined, "change scriptPubKey"),
    changeAtomic: canonicalUintDecimal(intent.changeAtomic, "change"),
    inputOutpoints: normalizeOutpoints(intent.inputOutpoints),
    outputCommitments: normalizeHashList(intent.outputCommitments, "output commitment"),
    reserveCommitment: assertHashHex(intent.reserveCommitment, "reserve commitment"),
    pauseWithdrawals: intent.pauseWithdrawals === true,
    hardStop: intent.hardStop === true,
  };
  if (BigInt(normalized.amountAtomic) <= 0n) throw new Error("amount must be greater than zero");
  if (normalized.signingInputIndex >= normalized.inputOutpoints.length) {
    throw new Error("signing input index is outside the committed inputs");
  }
  if (normalized.outputCommitments.length === 0) throw new Error("output commitments are required");
  return Object.freeze(normalized);
}

function checkedNonNegativeIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}

function normalizeOutpoints(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error("input outpoints are required");
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !/^[0-9a-f]{64}:[0-9]+$/u.test(entry.toLowerCase())) {
      throw new Error("input outpoint must be txid:vout");
    }
    return entry.toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate input outpoint");
  return Object.freeze(normalized);
}

function normalizeHashList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} list is required`);
  return Object.freeze(value.map((entry, index) => assertHashHex(entry, `${label} ${index}`)));
}

export function nativeSigningIntentDigest(intent) {
  return sha256Canonical(validateNativeSigningIntent(intent));
}

export function evaluateNativeSigningPolicy(policy, intent) {
  const normalized = validateNativeSigningIntent(intent);
  const amount = BigInt(normalized.amountAtomic);
  const fee = BigInt(normalized.feeAtomic);
  const authorization = policy.authorizedOperations.get(normalized.signingRequestId);
  const checks = {
    noHardStop: !normalized.hardStop,
    withdrawalsOpen: !normalized.pauseWithdrawals,
    nativeDomain: policy.nativeNetwork === normalized.nativeNetwork && policy.nativeGenesisHash === normalized.nativeGenesisHash,
    solanaDomain:
      policy.solanaDeployment === normalized.solanaDeployment &&
      policy.bridgeProgramId === normalized.bridgeProgramId &&
      policy.transceiverProgramId === normalized.transceiverProgramId &&
      policy.mint === normalized.mint,
    keyEpoch: policy.keyEpoch === normalized.keyEpoch,
    amountWithinPolicy: amount > 0n && amount <= policy.maxAmountAtomic,
    feeWithinPolicy: fee <= policy.maxFeeAtomic,
    reserveChangeScriptExact: normalized.changeScriptPubKeyHex === policy.reserveScriptPubKeyHex,
    authorizedOperationPresent: authorization !== undefined,
    authorizedOperationExact: authorization === undefined ? false : authorizationMatches(authorization, normalized),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return Object.freeze({
    result: failed.length === 0 ? "APPROVED" : "REJECTED",
    intentDigest: sha256Canonical(normalized),
    checks: Object.freeze(checks),
    failed: Object.freeze(failed),
  });
}

function authorizationMatches(authorization, intent) {
  return (
    authorization.operationId === intent.operationId &&
    authorization.withdrawalId === intent.withdrawalId &&
    authorization.taprootSighashHex === intent.taprootSighashHex &&
    authorization.transactionCommitment === intent.transactionCommitment &&
    authorization.signingInputIndex === intent.signingInputIndex &&
    authorization.recipientScriptPubKeyHex === intent.recipientScriptPubKeyHex &&
    authorization.amountAtomic === intent.amountAtomic &&
    authorization.feeAtomic === intent.feeAtomic &&
    authorization.changeScriptPubKeyHex === intent.changeScriptPubKeyHex &&
    authorization.changeAtomic === intent.changeAtomic &&
    authorization.reserveCommitment === intent.reserveCommitment &&
    canonicalJson(authorization.inputOutpoints) === canonicalJson(intent.inputOutpoints) &&
    canonicalJson(authorization.outputCommitments) === canonicalJson(intent.outputCommitments)
  );
}

export function assertNativeSigningApproved(policy, intent) {
  const decision = evaluateNativeSigningPolicy(policy, intent);
  if (decision.result !== "APPROVED") {
    throw new Error(`Native FROST signer policy rejected request: ${decision.failed.join(",")}`);
  }
  return decision;
}
