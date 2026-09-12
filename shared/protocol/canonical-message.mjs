import { createHash } from "node:crypto";

export const PROTOCOL_MAGIC = "KPEPBRG1";
export const MESSAGE_VERSION = 1;
export const DEPLOYMENT_IDENTITY_LENGTH = 168;
export const NATIVE_OUTPOINT_LENGTH = 36;
export const MAX_DESTINATION_LENGTH = 128;
export const MESSAGE_LENGTH = 514;

export function decodeCanonicalBridgeMessage(input) {
  const bytes = asBytes(input, "canonicalMessage");
  if (bytes.length !== MESSAGE_LENGTH) {
    throw new Error(`InvalidLength:${bytes.length}`);
  }

  let cursor = 0;
  const magic = readBytes(bytes, cursor, 8);
  cursor += 8;
  if (bytesToAscii(magic) !== PROTOCOL_MAGIC) {
    throw new Error("InvalidMagic");
  }

  const version = bytes[cursor];
  cursor += 1;
  if (version !== MESSAGE_VERSION) {
    throw new Error("UnsupportedVersion");
  }

  const action = decodeAction(bytes[cursor]);
  cursor += 1;
  const direction = decodeDirection(bytes[cursor]);
  cursor += 1;
  const reserved = bytes[cursor];
  cursor += 1;
  if (reserved !== 0) {
    throw new Error("NonZeroReservedByte");
  }

  const deployment = {
    protocolId: readU32(bytes, cursor),
    nativeNetwork: readU32(bytes, cursor + 4),
    nativeGenesis: readBytes(bytes, cursor + 8, 32),
    solanaDeployment: readBytes(bytes, cursor + 40, 32),
    managerProgramId: readBytes(bytes, cursor + 72, 32),
    transceiverProgramId: readBytes(bytes, cursor + 104, 32),
    mint: readBytes(bytes, cursor + 136, 32),
  };
  cursor += DEPLOYMENT_IDENTITY_LENGTH;

  const operationId = readBytes(bytes, cursor, 32);
  cursor += 32;
  const depositOutpoint = {
    txid: readBytes(bytes, cursor, 32),
    vout: readU32(bytes, cursor + 32),
  };
  cursor += NATIVE_OUTPOINT_LENGTH;
  const withdrawalId = readBytes(bytes, cursor, 32);
  cursor += 32;
  const amountAtomic = readU64(bytes, cursor);
  cursor += 8;
  const feeAtomic = readU64(bytes, cursor);
  cursor += 8;
  const destinationLength = readU16(bytes, cursor);
  cursor += 2;
  if (destinationLength > MAX_DESTINATION_LENGTH) {
    throw new Error("DestinationTooLong");
  }
  const destinationPadded = readBytes(bytes, cursor, MAX_DESTINATION_LENGTH);
  const destination = destinationPadded.slice(0, destinationLength);
  const padding = destinationPadded.slice(destinationLength);
  if (padding.some((byte) => byte !== 0)) {
    throw new Error("NonZeroDestinationPadding");
  }
  cursor += MAX_DESTINATION_LENGTH;
  const policyEpoch = readU32(bytes, cursor);
  cursor += 4;
  const keyEpoch = readU32(bytes, cursor);
  cursor += 4;
  const nonce = readBytes(bytes, cursor, 32);
  cursor += 32;
  const validFrom = readU64(bytes, cursor);
  cursor += 8;
  const validUntil = readU64(bytes, cursor);
  cursor += 8;
  const evidenceDigest = readBytes(bytes, cursor, 32);
  cursor += 32;

  if (cursor !== MESSAGE_LENGTH) {
    throw new Error(`InvalidCursor:${cursor}`);
  }

  const decoded = {
    version,
    action,
    direction,
    deployment,
    operationId,
    depositOutpoint,
    withdrawalId,
    amountAtomic,
    feeAtomic,
    destination,
    policyEpoch,
    keyEpoch,
    nonce,
    validFrom,
    validUntil,
    evidenceDigest,
    encoded: bytes,
  };
  validateDecodedMessage(decoded);

  const derived = deriveOperationId(decoded);
  if (!bytesEqual(operationId, derived)) {
    throw new Error("OperationIdMismatch");
  }

  return {
    ...decoded,
    operationIdHex: bytesToHex(operationId),
    messageDigestHex: sha256Hex(bytes),
    destinationHex: bytesToHex(destination),
    evidenceDigestHex: bytesToHex(evidenceDigest),
    withdrawalIdHex: bytesToHex(withdrawalId),
    depositOutpointText: `${bytesToHex(depositOutpoint.txid)}:${depositOutpoint.vout}`,
  };
}

export function encodeCanonicalBridgeMessage(input) {
  validateInputMessage(input);
  const destination = asBytes(input.destination, "destination");
  const operationId = input.operationId ? asHash32(input.operationId, "operationId") : deriveOperationId(input);
  const derived = deriveOperationId(input);
  if (!bytesEqual(operationId, derived)) {
    throw new Error("OperationIdMismatch");
  }

  const out = new Uint8Array(MESSAGE_LENGTH);
  let cursor = 0;
  cursor = writeBytes(out, cursor, ascii(PROTOCOL_MAGIC));
  cursor = writeU8(out, cursor, MESSAGE_VERSION);
  cursor = writeU8(out, cursor, encodeAction(input.action));
  cursor = writeU8(out, cursor, encodeDirection(input.direction));
  cursor = writeU8(out, cursor, 0);
  cursor = writeDeployment(out, cursor, input.deployment);
  cursor = writeBytes(out, cursor, operationId);
  cursor = writeOutpoint(out, cursor, input.depositOutpoint);
  cursor = writeBytes(out, cursor, asHash32(input.withdrawalId, "withdrawalId"));
  cursor = writeU64(out, cursor, BigInt(input.amountAtomic));
  cursor = writeU64(out, cursor, BigInt(input.feeAtomic));
  cursor = writeU16(out, cursor, destination.length);
  cursor = writeBytes(out, cursor, destination);
  cursor += MAX_DESTINATION_LENGTH - destination.length;
  cursor = writeU32(out, cursor, input.policyEpoch);
  cursor = writeU32(out, cursor, input.keyEpoch);
  cursor = writeBytes(out, cursor, asHash32(input.nonce, "nonce"));
  cursor = writeU64(out, cursor, BigInt(input.validFrom));
  cursor = writeU64(out, cursor, BigInt(input.validUntil));
  cursor = writeBytes(out, cursor, asHash32(input.evidenceDigest, "evidenceDigest"));
  if (cursor !== MESSAGE_LENGTH) {
    throw new Error(`InvalidLength:${cursor}`);
  }
  return out;
}

export function deriveOperationId(input) {
  const destination = asBytes(input.destination, "destination");
  validateDestination(destination);
  return sha256Bytes(
    concatBytes([
      ascii(PROTOCOL_MAGIC),
      Uint8Array.of(MESSAGE_VERSION),
      Uint8Array.of(encodeAction(input.action)),
      Uint8Array.of(encodeDirection(input.direction)),
      encodeDeployment(input.deployment),
      encodeOutpoint(input.depositOutpoint),
      asHash32(input.withdrawalId, "withdrawalId"),
      encodeU64(BigInt(input.amountAtomic)),
      encodeU64(BigInt(input.feeAtomic)),
      encodeU16(destination.length),
      destination,
      encodeU32(input.policyEpoch),
      encodeU32(input.keyEpoch),
      asHash32(input.nonce, "nonce"),
      encodeU64(BigInt(input.validFrom)),
      encodeU64(BigInt(input.validUntil)),
      asHash32(input.evidenceDigest, "evidenceDigest"),
    ]),
  );
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

function encodeDeployment(deployment) {
  const out = new Uint8Array(DEPLOYMENT_IDENTITY_LENGTH);
  const cursor = writeDeployment(out, 0, deployment);
  if (cursor !== DEPLOYMENT_IDENTITY_LENGTH) {
    throw new Error("InvalidDeploymentLength");
  }
  return out;
}

function writeDeployment(out, cursor, deployment) {
  cursor = writeU32(out, cursor, deployment.protocolId);
  cursor = writeU32(out, cursor, deployment.nativeNetwork);
  cursor = writeBytes(out, cursor, asHash32(deployment.nativeGenesis, "nativeGenesis"));
  cursor = writeBytes(out, cursor, asHash32(deployment.solanaDeployment, "solanaDeployment"));
  cursor = writeBytes(out, cursor, asHash32(deployment.managerProgramId, "managerProgramId"));
  cursor = writeBytes(out, cursor, asHash32(deployment.transceiverProgramId, "transceiverProgramId"));
  cursor = writeBytes(out, cursor, asHash32(deployment.mint, "mint"));
  return cursor;
}

function encodeOutpoint(outpoint) {
  const out = new Uint8Array(NATIVE_OUTPOINT_LENGTH);
  const cursor = writeOutpoint(out, 0, outpoint);
  if (cursor !== NATIVE_OUTPOINT_LENGTH) {
    throw new Error("InvalidOutpointLength");
  }
  return out;
}

function writeOutpoint(out, cursor, outpoint) {
  cursor = writeBytes(out, cursor, asHash32(outpoint.txid, "depositOutpoint.txid"));
  return writeU32(out, cursor, outpoint.vout);
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

function readBytes(bytes, cursor, length) {
  const end = cursor + length;
  if (end > bytes.length) {
    throw new Error("BufferUnderflow");
  }
  return bytes.slice(cursor, end);
}

function readU16(bytes, cursor) {
  return new DataView(bytes.buffer, bytes.byteOffset + cursor, 2).getUint16(0, true);
}

function readU32(bytes, cursor) {
  return new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getUint32(0, true);
}

function readU64(bytes, cursor) {
  return new DataView(bytes.buffer, bytes.byteOffset + cursor, 8).getBigUint64(0, true);
}

function writeBytes(out, cursor, bytes) {
  out.set(bytes, cursor);
  return cursor + bytes.length;
}

function writeU8(out, cursor, value) {
  out[cursor] = value;
  return cursor + 1;
}

function writeU16(out, cursor, value) {
  return writeBytes(out, cursor, encodeU16(value));
}

function writeU32(out, cursor, value) {
  return writeBytes(out, cursor, encodeU32(value));
}

function writeU64(out, cursor, value) {
  return writeBytes(out, cursor, encodeU64(value));
}

function encodeU16(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("U16OutOfRange");
  }
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function encodeU32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("U32OutOfRange");
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function encodeU64(value) {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("U64OutOfRange");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
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

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
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
