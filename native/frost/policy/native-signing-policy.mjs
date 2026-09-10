import { createHash } from "node:crypto";
import { types } from "node:util";
import { REGTEST_GENESIS } from "../../node/native-raw-evidence.mjs";

export const FROST_SIGNING_INTENT_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SIGNING_INTENT/V1";
export const FROST_SIGNING_MODE = "SINGLE_HOST_PROJECT_CONTROLLED_FROST";
export const REQUIRED_FROST_SIGNERS = Object.freeze(["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]);
export const REQUIRED_FROST_THRESHOLD = 2;

const HASH_HEX = /^[0-9a-f]{64}$/u;
const HEX = /^(?:[0-9a-f]{2})*$/u;
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
// Local parser/resource ceilings, not approved production economic limits.
const MAX_POLICY_OPERATIONS = 256;
const MAX_INTENT_INPUTS = 256;
const MAX_INTENT_OUTPUTS = 256;
const MAX_SCRIPT_BYTES = 10_000;
const INTENT_FIELDS = Object.freeze(["protocol", "mode", "purpose", "nativeNetwork", "nativeGenesisHash",
  "solanaDeployment", "bridgeProgramId", "transceiverProgramId", "mint", "keyEpoch", "signingRequestId",
  "operationId", "withdrawalId", "proofFingerprint", "unsignedNativeTransactionId", "transactionCommitment",
  "signingInputIndex", "taprootSighashHex", "recipientScriptPubKeyHex", "amountAtomic", "feeAtomic",
  "changeScriptPubKeyHex", "changeAtomic", "inputOutpoints", "outputCommitments", "reserveCommitment",
  "pauseWithdrawals", "hardStop"]);
const authorizationSnapshots = new WeakMap();
const localDkgPolicies = new WeakSet();

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
  if (typeof value !== "string" || value.length > 20 || !UINT_DECIMAL.test(value) || BigInt(value) > U64_MAX) {
    throw new Error(`${label} must be a canonical u64 decimal string`);
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
  options = dataRecord(options, "policy");
  const context = localPolicyContext(options);
  const authorizedOperations = new Map();
  for (const operation of dataArray(options.authorizedOperations, MAX_POLICY_OPERATIONS, "authorized operations")) {
    // Enroll the entire immutable intent, not a hand-maintained economic subset.
    // Enrollment is local policy input; independent chain verification is still required.
    const normalized = validateNativeSigningIntent(operation);
    if (authorizedOperations.has(normalized.signingRequestId)) throw new Error("NativeSigningPolicyDuplicateRequest");
    authorizedOperations.set(normalized.signingRequestId, normalized);
  }
  const policy = Object.freeze({
    ...context,
    solanaDeployment: assertHashHex(options.solanaDeployment, "policy Solana deployment"),
    bridgeProgramId: assertHashHex(options.bridgeProgramId, "policy bridge program ID"),
    transceiverProgramId: assertHashHex(options.transceiverProgramId, "policy transceiver program ID"),
    mint: assertHashHex(options.mint, "policy mint"),
    keyEpoch: checkedSafeEpoch(options.keyEpoch, "policy key epoch"),
    maxAmountAtomic: BigInt(canonicalUintDecimal(options.maxAmountAtomic, "policy max amount")),
    maxFeeAtomic: BigInt(canonicalUintDecimal(options.maxFeeAtomic, "policy max fee")),
    reserveScriptPubKeyHex: checkedScript(options.reserveScriptPubKeyHex, "policy reserve scriptPubKey"),
    // Read-only inspection, never a writable enrollment interface.
    authorizedOperations: Object.freeze([...authorizedOperations.values()]),
  });
  authorizationSnapshots.set(policy, authorizedOperations);
  return policy;
}

// Explicit ephemeral local setup capability; it has no transaction authorization
// and cannot be upgraded in place into a signing policy after DKG.
export function createLocalNativeDkgPolicy(options) {
  options = dataRecord(options, "DKG policy");
  const policy = Object.freeze({ ...localPolicyContext(options), purpose: "LOCAL_DKG_ONLY",
    solanaDeployment: assertHashHex(options.solanaDeployment, "DKG policy Solana deployment"),
    bridgeProgramId: assertHashHex(options.bridgeProgramId, "DKG policy bridge program"),
    transceiverProgramId: assertHashHex(options.transceiverProgramId, "DKG policy transceiver program"),
    mint: assertHashHex(options.mint, "DKG policy mint"),
    keyEpoch: checkedSafeEpoch(options.keyEpoch, "DKG policy key epoch") });
  localDkgPolicies.add(policy);
  return policy;
}

function localPolicyContext(options) {
  if (options.environment !== "localnet") throw new Error("NativeSigningPolicyLocalnetOnly");
  if (options.nativeNetwork !== "regtest") throw new Error("NativeSigningPolicyRegtestOnly");
  if (options.nativeGenesisHash !== REGTEST_GENESIS) throw new Error("NativeSigningPolicyRegtestGenesisRequired");
  for (const flag of ["productionReady", "productionSigningAuthorized", "productionBroadcastAuthorized"]) {
    if (options[flag] !== undefined && options[flag] !== false) throw new Error("NativeSigningPolicyActivationDisabled");
  }
  if (options.mainnetActivation !== undefined && options.mainnetActivation !== "DISABLED") {
    throw new Error("NativeSigningPolicyActivationDisabled");
  }
  return Object.freeze({
    environment: "localnet",
    productionReady: false,
    productionSigningAuthorized: false,
    productionBroadcastAuthorized: false,
    mainnetActivation: "DISABLED",
    nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS,
  });
}

export function assertNativeSigningPolicy(policy) {
  if (!authorizationSnapshots.has(policy)) throw new Error("NativeSigningPolicySnapshotRequired");
  return policy;
}

export function assertNativeFrostRuntimePolicy(policy) {
  if (!localDkgPolicies.has(policy)) assertNativeSigningPolicy(policy);
  return policy;
}

function checkedSafeEpoch(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) throw new Error(`${label} must be a positive u32`);
  return value;
}

export function validateNativeSigningIntent(intent) {
  intent = dataRecord(intent, "intent");
  const fields = Object.keys(intent);
  if (fields.length !== INTENT_FIELDS.length || fields.some((field) => !INTENT_FIELDS.includes(field))) {
    throw new Error("NativeSigningIntentFields");
  }
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
    recipientScriptPubKeyHex: checkedScript(intent.recipientScriptPubKeyHex, "recipient scriptPubKey"),
    amountAtomic: canonicalUintDecimal(intent.amountAtomic, "amount"),
    feeAtomic: canonicalUintDecimal(intent.feeAtomic, "fee"),
    changeScriptPubKeyHex: checkedScript(intent.changeScriptPubKeyHex, "change scriptPubKey"),
    changeAtomic: canonicalUintDecimal(intent.changeAtomic, "change"),
    inputOutpoints: normalizeOutpoints(intent.inputOutpoints),
    outputCommitments: normalizeHashList(intent.outputCommitments, "output commitment"),
    reserveCommitment: assertHashHex(intent.reserveCommitment, "reserve commitment"),
    pauseWithdrawals: checkedBoolean(intent.pauseWithdrawals, "pauseWithdrawals"),
    hardStop: checkedBoolean(intent.hardStop, "hardStop"),
  };
  validateEconomicShape(normalized);
  return Object.freeze(normalized);
}

function validateEconomicShape(normalized) {
  if (BigInt(normalized.amountAtomic) <= 0n) throw new Error("amount must be greater than zero");
  if (normalized.signingInputIndex >= normalized.inputOutpoints.length) {
    throw new Error("signing input index is outside the committed inputs");
  }
  if (normalized.outputCommitments.length === 0) throw new Error("output commitments are required");
}

function checkedNonNegativeIndex(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${label} must be a u32`);
  return value;
}

function normalizeOutpoints(value) {
  value = dataArray(value, MAX_INTENT_INPUTS, "input outpoints");
  if (value.length === 0) throw new Error("input outpoints are required");
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || entry.length > 75 || !/^[0-9a-f]{64}:(0|[1-9][0-9]*)$/u.test(entry.toLowerCase()) ||
        BigInt(entry.slice(65)) > 0xffff_ffffn) {
      throw new Error("input outpoint must be txid:canonical-u32-vout");
    }
    return entry.toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate input outpoint");
  return Object.freeze(normalized);
}

function normalizeHashList(value, label) {
  value = dataArray(value, MAX_INTENT_OUTPUTS, label);
  return Object.freeze(value.map((entry, index) => assertHashHex(entry, `${label} ${index}`)));
}

function checkedScript(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SCRIPT_BYTES * 2) {
    throw new Error(`${label} must be a bounded nonempty script`);
  }
  return assertHex(value, undefined, label);
}

function checkedBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

// Capture ordinary data once. Reject accessors, proxies, sparse arrays and
// custom prototypes before invoking any caller-supplied getter or iterator.
// This is an API integrity boundary, not a sandbox for hostile in-process code.
export function dataRecord(value, label) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}:PlainDataRequired`);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 40) throw new Error(`${label}:TooManyFields`);
  const snapshot = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !Object.hasOwn(field, "value")) throw new Error(`${label}:PlainDataRequired`);
    snapshot[key] = field.value;
  }
  return snapshot;
}

export function dataArray(value, limit, label) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) {
    throw new Error(`${label}:BoundedArrayRequired`);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error(`${label}:PlainArrayRequired`);
  const snapshot = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(i));
    if (entry === undefined || !Object.hasOwn(entry, "value")) throw new Error(`${label}:PlainArrayRequired`);
    snapshot.push(entry.value);
  }
  return snapshot;
}

export function nativeSigningIntentDigest(intent) {
  return sha256Canonical(validateNativeSigningIntent(intent));
}

export function evaluateNativeSigningPolicy(policy, intent) {
  assertNativeSigningPolicy(policy);
  const normalized = validateNativeSigningIntent(intent);
  const intentDigest = sha256Canonical(normalized);
  const amount = BigInt(normalized.amountAtomic);
  const fee = BigInt(normalized.feeAtomic);
  const authorization = authorizationSnapshots.get(policy).get(normalized.signingRequestId);
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
    authorizedOperationExact: authorization !== undefined && sha256Canonical(authorization) === intentDigest,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return Object.freeze({
    result: failed.length === 0 ? "APPROVED" : "REJECTED",
    intentDigest,
    checks: Object.freeze(checks),
    failed: Object.freeze(failed),
  });
}

export function assertNativeSigningApproved(policy, intent) {
  const decision = evaluateNativeSigningPolicy(policy, intent);
  if (decision.result !== "APPROVED") {
    throw new Error(`Native FROST signer policy rejected request: ${decision.failed.join(",")}`);
  }
  return decision;
}
