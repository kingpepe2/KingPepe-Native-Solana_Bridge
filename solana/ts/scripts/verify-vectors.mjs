import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAGIC = bytes("KPEPBRG1");
const VERSION = 1;
const DEPLOYMENT_LENGTH = 168;
const OUTPOINT_LENGTH = 36;
const MAX_DESTINATION_LENGTH = 128;
const MESSAGE_LENGTH = 514;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const vectorPath = resolve(scriptDir, "../../modules/bridge-messages/vectors/canonical-v1.json");
const vectorFile = JSON.parse(readFileSync(vectorPath, "utf8"));

if (vectorFile.messageVersion !== VERSION || vectorFile.messageLength !== MESSAGE_LENGTH) {
  throw new Error("Vector metadata does not match protocol constants");
}

for (const vector of vectorFile.vectors) {
  const encoded = encode(vector);
  const operationId = deriveOperationId(vector);
  const digest = sha256(encoded);

  assertHex(vector.name, "operationId", operationId, vector.operationId);
  assertHex(vector.name, "messageDigest", digest, vector.messageDigest);
  assertHex(vector.name, "encodedHex", encoded, vector.encodedHex);
}

console.log(`Verified ${vectorFile.vectors.length} canonical protocol vector(s).`);

function encode(input) {
  const operationId = deriveOperationId(input);
  const destination = hex(input.destination);
  const encoded = concat([
    MAGIC,
    Uint8Array.of(VERSION, actionCode(input.action), directionCode(input.direction), 0),
    deploymentBytes(input.deployment),
    operationId,
    outpointBytes(input.depositOutpoint),
    hash32(input.withdrawalId, "withdrawalId"),
    u64(input.amountAtomic),
    u64(input.feeAtomic),
    u16(destination.length),
    destination,
    new Uint8Array(MAX_DESTINATION_LENGTH - destination.length),
    u32(input.policyEpoch),
    u32(input.keyEpoch),
    hash32(input.nonce, "nonce"),
    u64(input.validFrom),
    u64(input.validUntil),
    hash32(input.evidenceDigest, "evidenceDigest"),
  ]);
  if (encoded.length !== MESSAGE_LENGTH) {
    throw new Error(`${input.name}: invalid encoded length ${encoded.length}`);
  }
  return encoded;
}

function deriveOperationId(input) {
  const destination = hex(input.destination);
  return sha256(
    concat([
      MAGIC,
      Uint8Array.of(VERSION),
      Uint8Array.of(actionCode(input.action)),
      Uint8Array.of(directionCode(input.direction)),
      deploymentBytes(input.deployment),
      outpointBytes(input.depositOutpoint),
      hash32(input.withdrawalId, "withdrawalId"),
      u64(input.amountAtomic),
      u64(input.feeAtomic),
      u16(destination.length),
      destination,
      u32(input.policyEpoch),
      u32(input.keyEpoch),
      hash32(input.nonce, "nonce"),
      u64(input.validFrom),
      u64(input.validUntil),
      hash32(input.evidenceDigest, "evidenceDigest"),
    ]),
  );
}

function deploymentBytes(deployment) {
  const encoded = concat([
    u32(deployment.protocolId),
    u32(deployment.nativeNetwork),
    hash32(deployment.nativeGenesis, "nativeGenesis"),
    hash32(deployment.solanaDeployment, "solanaDeployment"),
    hash32(deployment.managerProgramId, "managerProgramId"),
    hash32(deployment.transceiverProgramId, "transceiverProgramId"),
    hash32(deployment.mint, "mint"),
  ]);
  if (encoded.length !== DEPLOYMENT_LENGTH) {
    throw new Error(`invalid deployment length ${encoded.length}`);
  }
  return encoded;
}

function outpointBytes(outpoint) {
  const encoded = concat([hash32(outpoint.txid, "outpoint.txid"), u32(outpoint.vout)]);
  if (encoded.length !== OUTPOINT_LENGTH) {
    throw new Error(`invalid outpoint length ${encoded.length}`);
  }
  return encoded;
}

function actionCode(action) {
  if (action === "DepositClaim") return 0;
  if (action === "WithdrawalRequest") return 1;
  throw new Error(`invalid action ${action}`);
}

function directionCode(direction) {
  if (direction === "NativeToSolana") return 0;
  if (direction === "SolanaToNative") return 1;
  throw new Error(`invalid direction ${direction}`);
}

function hash32(value, label) {
  const parsed = hex(value);
  if (parsed.length !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return parsed;
}

function hex(value) {
  if (value.length % 2 !== 0) {
    throw new Error("invalid hex length");
  }
  const out = new Uint8Array(value.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function bytes(value) {
  return Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0)));
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function sha256(value) {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function u16(value) {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64(value) {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > 0xffffffffffffffffn) {
    throw new Error("u64 out of range");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, parsed, true);
  return out;
}

function assertHex(vectorName, fieldName, actualBytes, expectedHex) {
  const actualHex = Array.from(actualBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actualHex !== expectedHex) {
    throw new Error(`${vectorName}: ${fieldName} mismatch`);
  }
}
