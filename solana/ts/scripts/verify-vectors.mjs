// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as protocol from "../lib/protocol.ts";
import { BRIDGE_ABI_SCHEMAS, encodeBridgeAbi, decodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { BRIDGE_INPUT_SCHEMAS, encodeBridgeInput, decodeBridgeInput } from "../../../shared/protocol/bridge-inputs.mjs";
import { encodeNativeInput } from "../../../shared/protocol/native-inputs.mjs";

const file = JSON.parse(readFileSync(new URL("../../modules/bridge-messages/vectors/canonical-borsh-v2.json", import.meta.url), "utf8"));
assert.equal(file.messageVersion, protocol.MESSAGE_VERSION);
assert.equal(file.messageLength, protocol.MESSAGE_LENGTH);
for (const vector of file.vectors) {
  const input = {
    ...vector, version: protocol.MESSAGE_VERSION,
    deployment: Object.fromEntries(Object.entries(vector.deployment).map(([key, value]) =>
      [key, typeof value === "string" ? protocol.hexToBytes(value) : value])),
    depositOutpoint: { txid: protocol.hexToBytes(vector.depositOutpoint.txid), vout: vector.depositOutpoint.vout },
    ...Object.fromEntries(["operationId", "withdrawalId", "destination", "nonce", "evidenceDigest"]
      .map((key) => [key, protocol.hexToBytes(vector[key])])),
    ...Object.fromEntries(["amountAtomic", "feeAtomic", "validFrom", "validUntil"]
      .map((key) => [key, BigInt(vector[key])])),
  };
  const encoded = protocol.encodeCanonicalBridgeMessage(input);
  assert.equal(protocol.bytesToHex(encoded), vector.encodedHex, vector.name);
  assert.equal(protocol.bytesToHex(protocol.deriveOperationId(input)), vector.operationId, vector.name);
  assert.equal(protocol.bytesToHex(protocol.encodeOperationIdInputs(input)), vector.operationIdInputsHex, vector.name);
  assert.equal(protocol.bytesToHex(protocol.messageDigest(input)), vector.messageDigest, vector.name);
  assert.deepEqual(protocol.encodeCanonicalBridgeMessage(protocol.decodeCanonicalBridgeMessage(encoded)), encoded);
  for (let length = 0; length < encoded.length; length++) {
    assert.throws(() => protocol.decodeCanonicalBridgeMessage(encoded.subarray(0, length)), /InvalidLength/);
  }
  assert.throws(() => protocol.decodeCanonicalBridgeMessage(Uint8Array.from([...encoded, 0])), /InvalidLength/);
  const oldVersion = Uint8Array.from(encoded); oldVersion[7] = 49; oldVersion[8] = 1;
  assert.throws(() => protocol.decodeCanonicalBridgeMessage(oldVersion), /InvalidMagic|UnsupportedVersion/);
  const badId = Uint8Array.from(encoded); badId[180] ^= 1;
  assert.throws(() => protocol.decodeCanonicalBridgeMessage(badId), /OperationIdMismatch/);
  const padding = Uint8Array.from(encoded);
  if (input.destination.length < protocol.MAX_DESTINATION_LENGTH) {
    padding[298 + input.destination.length] = 1; // First unused destination byte.
    assert.throws(() => protocol.decodeCanonicalBridgeMessage(padding), /NonZeroDestinationPadding/);
  }
  assert.throws(() => protocol.encodeCanonicalBridgeMessage({ ...input, amountAtomic: 0n }), /AmountZero/);
  for (const bad of [-1n, 18446744073709551616n, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => protocol.encodeCanonicalBridgeMessage({ ...input, feeAtomic: bad }));
  }
  for (const bad of [-1, 4294967296, 0.5, NaN]) {
    assert.throws(() => protocol.deriveOperationId({ ...input, policyEpoch: bad }), /U32OutOfRange/);
  }
}
console.log(`Verified ${file.vectors.length} canonical Borsh protocol vector(s), operation preimages, digests and strict rejection checks.`);

const abiFile = JSON.parse(readFileSync(new URL("../../modules/bridge-messages/vectors/abi-borsh-v2.json", import.meta.url), "utf8"));
function abiValue(schema, input) {
  if (typeof schema === "string") return schema === "u64" || schema === "u128" ? BigInt(input) : input;
  if (schema.array) return schema.array.type === "u8" ? Buffer.from(input, "hex") : input.map(v => abiValue(schema.array.type, v));
  return Object.fromEntries(Object.entries(schema.struct).map(([k, s]) => [k, abiValue(s, input[k])]));
}
for (const vector of abiFile.vectors) {
  const [schema] = BRIDGE_ABI_SCHEMAS[vector.type], input = abiValue(schema, vector.input);
  const bytes = encodeBridgeAbi(vector.type, input);
  assert.equal(bytes.toString("hex"), vector.encodedHex, vector.name);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), vector.sha256, vector.name);
  assert.deepEqual(encodeBridgeAbi(vector.type, decodeBridgeAbi(vector.type, bytes)), bytes);
  for (let length = 0; length < bytes.length; length++) assert.throws(() => decodeBridgeAbi(vector.type, bytes.subarray(0, length)));
  assert.throws(() => decodeBridgeAbi(vector.type, Buffer.concat([bytes, Buffer.from([0])])));
}
for (const [type, offset] of [["TransceiverConfig", 232], ["BridgeConfig", 252], ["VerifiedReceipt", 239]]) {
  const vector = abiFile.vectors.find(v => v.type === type);
  for (const value of [2, 255]) {
    const bytes = Buffer.from(vector.encodedHex, "hex"); bytes[offset] = value;
    assert.throws(() => decodeBridgeAbi(type, bytes), /BridgeAbiNonCanonical/);
  }
}
const burnVector = abiFile.vectors.find(v => v.name === "BurnChecked");
const burnInput = abiValue(BRIDGE_ABI_SCHEMAS.BurnChecked[0], burnVector.input);
for (const amountAtomic of [-1n, 1n << 64n, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => encodeBridgeAbi("BurnChecked", { ...burnInput, amountAtomic }), /BridgeAbiIntegerRange/);
}
assert.throws(() => encodeBridgeAbi("BurnChecked", { ...burnInput, decimals: 256 }), /BridgeAbiIntegerRange/);
console.log(`Verified ${abiFile.vectors.length} fixed Borsh ABI vectors with strict bounds/booleans.`);

const inputsFile = JSON.parse(readFileSync(new URL("../../modules/bridge-messages/vectors/inputs-borsh-v2.json", import.meta.url), "utf8"));
for (const vector of inputsFile.vectors) {
  const [, schema] = BRIDGE_INPUT_SCHEMAS[vector.type], value = abiValue(schema, vector.input);
  const bytes = encodeBridgeInput(vector.type, value);
  assert.equal(bytes.toString("hex"), vector.encodedHex, vector.name);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), vector.sha256, vector.name);
  assert.deepEqual(encodeBridgeInput(vector.type, decodeBridgeInput(vector.type, bytes)), bytes);
  for (let length = 0; length < bytes.length; length++) assert.throws(() => decodeBridgeInput(vector.type, bytes.subarray(0, length)));
  assert.throws(() => decodeBridgeInput(vector.type, Buffer.concat([bytes, Buffer.from([0])])));
  for (const index of [0, 7, 8]) {
    const altered = Buffer.from(bytes); altered[index] ^= 1;
    assert.throws(() => decodeBridgeInput(vector.type, altered), /BridgeInputNonCanonical/);
  }
}
const signingVector = inputsFile.vectors.find(v => v.type === "NativeSigningIntent");
const signingValue = abiValue(BRIDGE_INPUT_SCHEMAS.NativeSigningIntent[1], signingVector.input);
const signingBytes = Buffer.from(signingVector.encodedHex, "hex");
const badLength = Buffer.from(signingBytes); badLength.writeUInt32LE(0xffffffff, 10);
assert.throws(() => decodeBridgeInput("NativeSigningIntent", badLength), /BridgeInputText/);
for (const index of [signingBytes.length - 1, signingBytes.length - 2]) {
  const badBoolean = Buffer.from(signingBytes); badBoolean[index] = 2;
  assert.throws(() => decodeBridgeInput("NativeSigningIntent", badBoolean), /BridgeInputBoolean/);
}
for (const amountAtomic of [-1n, 1n << 64n, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => encodeBridgeInput("NativeSigningIntent", { ...signingValue, amountAtomic }), /BridgeInputInteger/);
}
assert.throws(() => encodeBridgeInput("NativeSigningIntent", { ...signingValue, additionalField: true }), /BridgeInputFields/);
assert.throws(() => encodeBridgeInput("NativeSigningIntent", { ...signingValue, outputCommitments: Array(257).fill(Buffer.alloc(32)) }), /BridgeInputArray/);
console.log(`Verified ${inputsFile.vectors.length} Borsh signing/evidence preimage vectors and bounded rejection checks.`);

const nativeFile = JSON.parse(readFileSync(new URL("../../../native/proof/vectors/inputs-borsh-v2.json", import.meta.url), "utf8"));
for (const vector of nativeFile.vectors) {
  const bytes = encodeNativeInput(vector.type, vector.input);
  assert.equal(bytes.toString("hex"), vector.encodedHex);
  const digest = createHash("sha256").update(bytes).digest();
  assert.equal(digest.toString("hex"), vector.sha256);
  assert.equal(createHash("sha256").update(digest).digest("hex"), vector.sha256d);
  for (const amountAtomic of [-1n, 1n << 64n, 1.5]) {
    assert.throws(() => encodeNativeInput(vector.type, { ...vector.input, amountAtomic }), /NativeInputAmount/);
  }
}
console.log(`Verified ${nativeFile.vectors.length} Native Borsh hash-input vectors.`);
