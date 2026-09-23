// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as protocol from "../lib/protocol.ts";
import { BRIDGE_ABI_SCHEMAS, encodeBridgeAbi, decodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { encodeNativeInput } from "../../../shared/protocol/native-inputs.mjs";

const burnVector=JSON.parse(readFileSync(new URL('../../modules/bridge-messages/vectors/burn-borsh-v4.json',import.meta.url),'utf8'));
const canonical=Buffer.from(burnVector.messageHex,'hex'), decoded=protocol.decodeCanonicalBridgeMessage(canonical);
assert.equal(canonical.length,protocol.MESSAGE_LENGTH);
assert.equal(Buffer.from(protocol.encodeCanonicalBridgeMessage(decoded)).toString('hex'),burnVector.messageHex);
assert.equal(Buffer.from(protocol.messageDigest(decoded)).toString('hex'),burnVector.messageDigest);
for(let n=0;n<canonical.length;n++)assert.throws(()=>protocol.decodeCanonicalBridgeMessage(canonical.subarray(0,n)));
assert.throws(()=>protocol.decodeCanonicalBridgeMessage(Buffer.concat([canonical,Buffer.of(0)])));
for(let n=0;n<9;n++){const bad=Buffer.from(canonical);bad[n]^=1;assert.throws(()=>protocol.decodeCanonicalBridgeMessage(bad));}
for(const mutation of [{amountAtomic:decoded.amountAtomic+1n},{feeAtomic:1n},{destination:Buffer.alloc(32,7)},{version:3}])
  assert.throws(()=>protocol.encodeCanonicalBridgeMessage({...decoded,...mutation}));
assert.throws(()=>protocol.encodeCanonicalBridgeMessage({amountAtomic:1n,feeAtomic:0n}));
console.log('Verified V4 finalized-burn canonical bytes, digest, exact lengths, domain and economic binding.');

const abiFile = JSON.parse(readFileSync(new URL("../../modules/bridge-messages/vectors/abi-borsh-v4.json", import.meta.url), "utf8"));
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
const claimVector = abiFile.vectors.find(v => v.name === "DepositClaim");
const claimInput = abiValue(BRIDGE_ABI_SCHEMAS.DepositClaim[0], claimVector.input);
for (const amountAtomic of [-1n, 1n << 64n, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => encodeBridgeAbi("DepositClaim", { ...claimInput, amountAtomic }), /BridgeAbiIntegerRange/);
}
assert.throws(() => encodeBridgeAbi("DepositClaim", { ...claimInput, version: 256 }), /BridgeAbiIntegerRange/);
for (const schema of ["WithdrawalRecord", "RecordWithdrawal", "BurnChecked"]) assert(!Object.hasOwn(BRIDGE_ABI_SCHEMAS, schema));
console.log(`Verified ${abiFile.vectors.length} fixed Borsh ABI vectors with strict bounds/booleans.`);

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
