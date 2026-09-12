import { createHash } from "node:crypto";
import { serialize, deserialize } from "borsh";

export const PROTOCOL_MAGIC = "KPEPBRG2";
export const MESSAGE_VERSION = 2;
export const DEPLOYMENT_IDENTITY_LENGTH = 168;
export const NATIVE_OUTPOINT_LENGTH = 36;
export const MAX_DESTINATION_LENGTH = 128;
export const MESSAGE_LENGTH = 514;

// Borsh structs: field insertion order is the wire order. Fixed storage keeps
// Solana account/transaction sizes bounded; the destination tail MUST be zero.
// The operation-ID preimage uses Vec<u8> (a Borsh u32 length), not padding.
const fixedBytes = (len) => ({ array: { type: "u8", len } });
const hash32 = fixedBytes(32);
export const DEPLOYMENT_SCHEMA = { struct: {
  protocolId: "u32", nativeNetwork: "u32", nativeGenesis: hash32,
  solanaDeployment: hash32, managerProgramId: hash32,
  transceiverProgramId: hash32, mint: hash32,
} };
export const OUTPOINT_SCHEMA = { struct: { txid: hash32, vout: "u32" } };
export const CANONICAL_MESSAGE_SCHEMA = { struct: {
  magic: fixedBytes(8), version: "u8", action: "u8", direction: "u8", reserved: "u8",
  deployment: DEPLOYMENT_SCHEMA, operationId: hash32, depositOutpoint: OUTPOINT_SCHEMA,
  withdrawalId: hash32, amountAtomic: "u64", feeAtomic: "u64",
  destinationLength: "u16", destinationPadded: fixedBytes(MAX_DESTINATION_LENGTH),
  policyEpoch: "u32", keyEpoch: "u32", nonce: hash32,
  validFrom: "u64", validUntil: "u64", evidenceDigest: hash32,
} };
export const OPERATION_ID_SCHEMA = { struct: {
  domain: fixedBytes(8), version: "u8", action: "u8", direction: "u8",
  deployment: DEPLOYMENT_SCHEMA, depositOutpoint: OUTPOINT_SCHEMA,
  withdrawalId: hash32, amountAtomic: "u64", feeAtomic: "u64",
  destination: { array: { type: "u8" } }, policyEpoch: "u32", keyEpoch: "u32",
  nonce: hash32, validFrom: "u64", validUntil: "u64", evidenceDigest: hash32,
} };

export function decodeCanonicalBridgeMessage(input) {
  const bytes = asBytes(input, "canonicalMessage");
  if (bytes.length !== MESSAGE_LENGTH) throw new Error(`InvalidLength:${bytes.length}`);
  const wire = deserialize(CANONICAL_MESSAGE_SCHEMA, bytes);
  if (bytesToAscii(wire.magic) !== PROTOCOL_MAGIC) throw new Error("InvalidMagic");
  if (wire.version !== MESSAGE_VERSION) throw new Error("UnsupportedVersion");
  if (wire.reserved !== 0) throw new Error("NonZeroReservedByte");
  if (wire.destinationLength > MAX_DESTINATION_LENGTH) throw new Error("DestinationTooLong");
  if (wire.destinationPadded.slice(wire.destinationLength).some((byte) => byte !== 0)) {
    throw new Error("NonZeroDestinationPadding");
  }
  const deployment = { ...wire.deployment };
  for (const key of ["nativeGenesis", "solanaDeployment", "managerProgramId", "transceiverProgramId", "mint"]) {
    deployment[key] = Uint8Array.from(deployment[key]);
  }
  const decoded = {
    version: wire.version, action: decodeAction(wire.action), direction: decodeDirection(wire.direction),
    deployment, operationId: Uint8Array.from(wire.operationId),
    depositOutpoint: { txid: Uint8Array.from(wire.depositOutpoint.txid), vout: wire.depositOutpoint.vout },
    withdrawalId: Uint8Array.from(wire.withdrawalId),
    amountAtomic: wire.amountAtomic, feeAtomic: wire.feeAtomic,
    destination: Uint8Array.from(wire.destinationPadded.slice(0, wire.destinationLength)),
    policyEpoch: wire.policyEpoch, keyEpoch: wire.keyEpoch, nonce: Uint8Array.from(wire.nonce),
    validFrom: wire.validFrom, validUntil: wire.validUntil, evidenceDigest: Uint8Array.from(wire.evidenceDigest),
    encoded: Uint8Array.from(bytes),
  };
  validateDecodedMessage(decoded);
  if (!bytesEqual(decoded.operationId, deriveOperationId(decoded))) throw new Error("OperationIdMismatch");
  // borsh-js does not reject trailing bytes itself. Exact size plus re-encoding
  // enforces full consumption and a single accepted representation.
  if (!bytesEqual(bytes, encodeCanonicalBridgeMessage(decoded))) throw new Error("NonCanonicalBorsh");
  return {
    ...decoded,
    operationIdHex: bytesToHex(decoded.operationId), messageDigestHex: sha256Hex(bytes),
    destinationHex: bytesToHex(decoded.destination), evidenceDigestHex: bytesToHex(decoded.evidenceDigest),
    withdrawalIdHex: bytesToHex(decoded.withdrawalId),
    depositOutpointText: `${bytesToHex(decoded.depositOutpoint.txid)}:${decoded.depositOutpoint.vout}`,
  };
}

export function encodeCanonicalBridgeMessage(input) {
  validateInputMessage(input);
  const fields = operationFields(input);
  const derived = deriveOperationId(input);
  const operationId = input.operationId ? asHash32(input.operationId, "operationId") : derived;
  if (!bytesEqual(operationId, derived)) throw new Error("OperationIdMismatch");
  const destinationPadded = new Uint8Array(MAX_DESTINATION_LENGTH);
  destinationPadded.set(fields.destination);
  const out = serialize(CANONICAL_MESSAGE_SCHEMA, {
    ...fields, magic: ascii(PROTOCOL_MAGIC), reserved: 0, operationId,
    destinationLength: fields.destination.length, destinationPadded,
  });
  if (out.length !== MESSAGE_LENGTH) throw new Error(`InvalidLength:${out.length}`);
  return out;
}

export function encodeOperationIdInputs(input) {
  return serialize(OPERATION_ID_SCHEMA, { domain: ascii("KPEPID02"), ...operationFields(input) });
}

export function deriveOperationId(input) {
  return sha256Bytes(encodeOperationIdInputs(input));
}

function operationFields(input) {
  if (input.version !== undefined && input.version !== MESSAGE_VERSION) throw new Error("UnsupportedVersion");
  const destination = asBytes(input.destination, "destination");
  validateDestination(destination);
  const d = input.deployment;
  return {
    version: MESSAGE_VERSION, action: encodeAction(input.action), direction: encodeDirection(input.direction),
    deployment: {
      protocolId: checkedU32(d.protocolId), nativeNetwork: checkedU32(d.nativeNetwork),
      nativeGenesis: asHash32(d.nativeGenesis, "nativeGenesis"),
      solanaDeployment: asHash32(d.solanaDeployment, "solanaDeployment"),
      managerProgramId: asHash32(d.managerProgramId, "managerProgramId"),
      transceiverProgramId: asHash32(d.transceiverProgramId, "transceiverProgramId"),
      mint: asHash32(d.mint, "mint"),
    },
    depositOutpoint: { txid: asHash32(input.depositOutpoint.txid, "depositOutpoint.txid"),
      vout: checkedU32(input.depositOutpoint.vout) },
    withdrawalId: asHash32(input.withdrawalId, "withdrawalId"),
    amountAtomic: checkedU64(input.amountAtomic), feeAtomic: checkedU64(input.feeAtomic),
    destination, policyEpoch: checkedU32(input.policyEpoch), keyEpoch: checkedU32(input.keyEpoch),
    nonce: asHash32(input.nonce, "nonce"), validFrom: checkedU64(input.validFrom),
    validUntil: checkedU64(input.validUntil), evidenceDigest: asHash32(input.evidenceDigest, "evidenceDigest"),
  };
}

export function messageDigestHex(input) {
  return sha256Hex(asBytes(input, "message"));
}

export function hexToBytes(hex, label = "hex") {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-f]/iu.test(hex)) {
    throw new Error(`${label}:InvalidHex`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(asBytes(bytes, "bytes"), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashJson(value) {
  return sha256Hex(Buffer.from(stableJson(value), "utf8"));
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function isHash32Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function normalizeHex(value, label = "hex") {
  if (typeof value !== "string") {
    throw new Error(`${label}:ExpectedString`);
  }
  const normalized = value.toLowerCase();
  hexToBytes(normalized, label);
  return normalized;
}

function validateInputMessage(input) {
  if (input.version !== undefined && input.version !== MESSAGE_VERSION) {
    throw new Error("UnsupportedVersion");
  }
  validateDecodedMessage({
    ...input,
    version: MESSAGE_VERSION,
    operationId: input.operationId ?? new Uint8Array(32),
    withdrawalId: asHash32(input.withdrawalId, "withdrawalId"),
    nonce: asHash32(input.nonce, "nonce"),
    evidenceDigest: asHash32(input.evidenceDigest, "evidenceDigest"),
    destination: asBytes(input.destination, "destination"),
  });
}

function validateDecodedMessage(input) {
  if (input.version !== MESSAGE_VERSION) {
    throw new Error("UnsupportedVersion");
  }
  if (BigInt(input.amountAtomic) <= 0n) {
    throw new Error("AmountZero");
  }
  if (BigInt(input.feeAtomic) > BigInt(input.amountAtomic)) {
    throw new Error("FeeExceedsAmount");
  }
  if (input.policyEpoch === 0 || input.keyEpoch === 0) {
    throw new Error("EpochZero");
  }
  if (BigInt(input.validUntil) <= BigInt(input.validFrom)) {
    throw new Error("InvalidValidityWindow");
  }
  validateDestination(input.destination);
  if (isZeroHash(input.nonce)) {
    throw new Error("NonceZero");
  }
  if (isZeroHash(input.evidenceDigest)) {
    throw new Error("EvidenceDigestZero");
  }
  const zeroOutpoint = isZeroHash(input.depositOutpoint.txid) && input.depositOutpoint.vout === 0;
  const zeroWithdrawal = isZeroHash(input.withdrawalId);
  if (input.action === "DepositClaim" && input.direction === "NativeToSolana") {
    if (zeroOutpoint) throw new Error("MissingDepositOutpoint");
    if (!zeroWithdrawal) throw new Error("UnexpectedWithdrawalId");
    return;
  }
  if (input.action === "WithdrawalRequest" && input.direction === "SolanaToNative") {
    if (!zeroOutpoint) throw new Error("UnexpectedDepositOutpoint");
    if (zeroWithdrawal) throw new Error("MissingWithdrawalId");
    return;
  }
  throw new Error("ActionDirectionMismatch");
}

function validateDestination(destination) {
  if (destination.length === 0) {
    throw new Error("DestinationEmpty");
  }
  if (destination.length > MAX_DESTINATION_LENGTH) {
    throw new Error("DestinationTooLong");
  }
}

function encodeAction(action) {
  if (action === "DepositClaim") return 0;
  if (action === "WithdrawalRequest") return 1;
  throw new Error("InvalidAction");
}

function encodeDirection(direction) {
  if (direction === "NativeToSolana") return 0;
  if (direction === "SolanaToNative") return 1;
  throw new Error("InvalidDirection");
}

function decodeAction(value) {
  if (value === 0) return "DepositClaim";
  if (value === 1) return "WithdrawalRequest";
  throw new Error(`InvalidAction:${value}`);
}

function decodeDirection(value) {
  if (value === 0) return "NativeToSolana";
  if (value === 1) return "SolanaToNative";
  throw new Error(`InvalidDirection:${value}`);
}

function checkedU32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("U32OutOfRange");
  return value;
}

function checkedU64(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("U64OutOfRange");
  if (!["bigint", "number", "string"].includes(typeof value) ||
      (typeof value === "string" && !/^(0|[1-9][0-9]*)$/u.test(value))) throw new Error("U64OutOfRange");
  const number = BigInt(value);
  if (number < 0n || number > 0xffffffffffffffffn) throw new Error("U64OutOfRange");
  return number;
}

function ascii(value) {
  return Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0)));
}

function bytesToAscii(bytes) {
  return String.fromCharCode(...bytes);
}

function asHash32(input, label) {
  const bytes = typeof input === "string" ? hexToBytes(input, label) : asBytes(input, label);
  if (bytes.length !== 32) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return bytes;
}

function asBytes(input, label) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (Buffer.isBuffer(input)) {
    return new Uint8Array(input);
  }
  if (typeof input === "string") {
    return hexToBytes(input, label);
  }
  throw new Error(`${label}:ExpectedBytes`);
}

function isZeroHash(input) {
  const bytes = asHash32(input, "hash");
  return bytes.every((byte) => byte === 0);
}

function sha256Bytes(bytes) {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
