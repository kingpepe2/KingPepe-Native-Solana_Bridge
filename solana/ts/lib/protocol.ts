import { createHash } from "node:crypto";

export const PROTOCOL_MAGIC = "KPEPBRG1";
export const MESSAGE_VERSION = 1;
export const DEPLOYMENT_IDENTITY_LENGTH = 168;
export const NATIVE_OUTPOINT_LENGTH = 36;
export const MAX_DESTINATION_LENGTH = 128;
export const MESSAGE_LENGTH = 514;

export type BridgeDirection = "NativeToSolana" | "SolanaToNative";
export type BridgeAction = "DepositClaim" | "WithdrawalRequest";

export interface DeploymentIdentity {
  protocolId: number;
  nativeNetwork: number;
  nativeGenesis: Uint8Array;
  solanaDeployment: Uint8Array;
  managerProgramId: Uint8Array;
  transceiverProgramId: Uint8Array;
  mint: Uint8Array;
}

export interface NativeOutpoint {
  txid: Uint8Array;
  vout: number;
}

export interface CanonicalBridgeMessage {
  version: number;
  action: BridgeAction;
  direction: BridgeDirection;
  deployment: DeploymentIdentity;
  operationId?: Uint8Array;
  depositOutpoint: NativeOutpoint;
  withdrawalId: Uint8Array;
  amountAtomic: bigint;
  feeAtomic: bigint;
  destination: Uint8Array;
  policyEpoch: number;
  keyEpoch: number;
  nonce: Uint8Array;
  validFrom: bigint;
  validUntil: bigint;
  evidenceDigest: Uint8Array;
}

export function encodeCanonicalBridgeMessage(input: CanonicalBridgeMessage): Uint8Array {
  validateMessage(input);
  const operationId = input.operationId ?? deriveOperationId(input);
  if (!bytesEqual(operationId, deriveOperationId(input))) {
    throw new Error("OperationIdMismatch");
  }

  const out = new Uint8Array(MESSAGE_LENGTH);
  let cursor = 0;
  cursor = writeBytes(out, cursor, ascii(PROTOCOL_MAGIC));
  cursor = writeU8(out, cursor, input.version);
  cursor = writeU8(out, cursor, actionCode(input.action));
  cursor = writeU8(out, cursor, directionCode(input.direction));
  cursor = writeU8(out, cursor, 0);
  cursor = writeDeployment(out, cursor, input.deployment);
  cursor = writeBytes(out, cursor, operationId);
  cursor = writeBytes(out, cursor, encodeOutpoint(input.depositOutpoint));
  cursor = writeBytes(out, cursor, input.withdrawalId);
  cursor = writeU64(out, cursor, input.amountAtomic);
  cursor = writeU64(out, cursor, input.feeAtomic);
  cursor = writeU16(out, cursor, input.destination.length);
  cursor = writeBytes(out, cursor, input.destination);
  cursor += MAX_DESTINATION_LENGTH - input.destination.length;
  cursor = writeU32(out, cursor, input.policyEpoch);
  cursor = writeU32(out, cursor, input.keyEpoch);
  cursor = writeBytes(out, cursor, input.nonce);
  cursor = writeU64(out, cursor, input.validFrom);
  cursor = writeU64(out, cursor, input.validUntil);
  cursor = writeBytes(out, cursor, input.evidenceDigest);
  if (cursor !== MESSAGE_LENGTH) {
    throw new Error(`InvalidLength:${cursor}`);
  }
  return out;
}

export function deriveOperationId(input: CanonicalBridgeMessage): Uint8Array {
  validateDestination(input.destination);
  const parts = [
    ascii(PROTOCOL_MAGIC),
    Uint8Array.of(MESSAGE_VERSION),
    Uint8Array.of(actionCode(input.action)),
    Uint8Array.of(directionCode(input.direction)),
    encodeDeployment(input.deployment),
    encodeOutpoint(input.depositOutpoint),
    checkedHash32(input.withdrawalId, "withdrawalId"),
    encodeU64(input.amountAtomic),
    encodeU64(input.feeAtomic),
    encodeU16(input.destination.length),
    input.destination,
    encodeU32(input.policyEpoch),
    encodeU32(input.keyEpoch),
    checkedHash32(input.nonce, "nonce"),
    encodeU64(input.validFrom),
    encodeU64(input.validUntil),
    checkedHash32(input.evidenceDigest, "evidenceDigest"),
  ];
  return sha256(concat(parts));
}

export function messageDigest(input: CanonicalBridgeMessage): Uint8Array {
  return sha256(encodeCanonicalBridgeMessage(input));
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("InvalidHexLength");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateMessage(input: CanonicalBridgeMessage): void {
  if (input.version !== MESSAGE_VERSION) {
    throw new Error("UnsupportedVersion");
  }
  if (input.amountAtomic <= 0n) {
    throw new Error("AmountZero");
  }
  if (input.feeAtomic > input.amountAtomic) {
    throw new Error("FeeExceedsAmount");
  }
  if (input.policyEpoch === 0 || input.keyEpoch === 0) {
    throw new Error("EpochZero");
  }
  if (input.validUntil <= input.validFrom) {
    throw new Error("InvalidValidityWindow");
  }
  validateDestination(input.destination);
  checkedHash32(input.nonce, "nonce");
  checkedHash32(input.evidenceDigest, "evidenceDigest");

  if (input.action === "DepositClaim" && input.direction === "NativeToSolana") {
    if (isZeroOutpoint(input.depositOutpoint)) {
      throw new Error("MissingDepositOutpoint");
    }
    if (!isZeroHash(input.withdrawalId)) {
      throw new Error("UnexpectedWithdrawalId");
    }
    return;
  }

  if (input.action === "WithdrawalRequest" && input.direction === "SolanaToNative") {
    if (!isZeroOutpoint(input.depositOutpoint)) {
      throw new Error("UnexpectedDepositOutpoint");
    }
    if (isZeroHash(input.withdrawalId)) {
      throw new Error("MissingWithdrawalId");
    }
    return;
  }

  throw new Error("ActionDirectionMismatch");
}

function validateDestination(destination: Uint8Array): void {
  if (destination.length === 0) {
    throw new Error("DestinationEmpty");
  }
  if (destination.length > MAX_DESTINATION_LENGTH) {
    throw new Error("DestinationTooLong");
  }
}

function writeDeployment(out: Uint8Array, cursor: number, deployment: DeploymentIdentity): number {
  return writeBytes(out, cursor, encodeDeployment(deployment));
}

function encodeDeployment(deployment: DeploymentIdentity): Uint8Array {
  const out = new Uint8Array(DEPLOYMENT_IDENTITY_LENGTH);
  let cursor = 0;
  cursor = writeU32(out, cursor, deployment.protocolId);
  cursor = writeU32(out, cursor, deployment.nativeNetwork);
  cursor = writeBytes(out, cursor, checkedHash32(deployment.nativeGenesis, "nativeGenesis"));
  cursor = writeBytes(out, cursor, checkedHash32(deployment.solanaDeployment, "solanaDeployment"));
  cursor = writeBytes(out, cursor, checkedHash32(deployment.managerProgramId, "managerProgramId"));
  cursor = writeBytes(out, cursor, checkedHash32(deployment.transceiverProgramId, "transceiverProgramId"));
  cursor = writeBytes(out, cursor, checkedHash32(deployment.mint, "mint"));
  if (cursor !== DEPLOYMENT_IDENTITY_LENGTH) {
    throw new Error("InvalidDeploymentLength");
  }
  return out;
}

function encodeOutpoint(outpoint: NativeOutpoint): Uint8Array {
  const out = new Uint8Array(NATIVE_OUTPOINT_LENGTH);
  let cursor = 0;
  cursor = writeBytes(out, cursor, checkedHash32(outpoint.txid, "depositOutpoint.txid"));
  cursor = writeU32(out, cursor, outpoint.vout);
  return out;
}

function checkedHash32(value: Uint8Array, name: string): Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${name}:Expected32Bytes`);
  }
  return value;
}

function isZeroHash(value: Uint8Array): boolean {
  checkedHash32(value, "hash");
  return value.every((byte) => byte === 0);
}

function isZeroOutpoint(value: NativeOutpoint): boolean {
  return isZeroHash(value.txid) && value.vout === 0;
}

function actionCode(action: BridgeAction): number {
  if (action === "DepositClaim") return 0;
  if (action === "WithdrawalRequest") return 1;
  throw new Error("InvalidAction");
}

function directionCode(direction: BridgeDirection): number {
  if (direction === "NativeToSolana") return 0;
  if (direction === "SolanaToNative") return 1;
  throw new Error("InvalidDirection");
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0)));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function writeBytes(out: Uint8Array, cursor: number, bytes: Uint8Array): number {
  out.set(bytes, cursor);
  return cursor + bytes.length;
}

function writeU8(out: Uint8Array, cursor: number, value: number): number {
  out[cursor] = value;
  return cursor + 1;
}

function writeU16(out: Uint8Array, cursor: number, value: number): number {
  return writeBytes(out, cursor, encodeU16(value));
}

function writeU32(out: Uint8Array, cursor: number, value: number): number {
  return writeBytes(out, cursor, encodeU32(value));
}

function writeU64(out: Uint8Array, cursor: number, value: bigint): number {
  return writeBytes(out, cursor, encodeU64(value));
}

function encodeU16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function encodeU32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function encodeU64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("U64OutOfRange");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
