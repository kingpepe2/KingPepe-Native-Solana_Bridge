// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Original bounded implementation of BIP341 public tree/control-block rules.
// No signing keys; no claim that a committed arbitrary script is safe to spend.
import { createHash } from "node:crypto";
import { secp256k1, schnorr } from "@noble/curves/secp256k1.js";

export const TAPSCRIPT_LEAF_VERSION = 0xc0;
export const MAX_BRIDGE_TAPSCRIPT_BYTES = 512;

export function tapLeafHashHex(scriptHex) {
  const script = publicHex(scriptHex, undefined, MAX_BRIDGE_TAPSCRIPT_BYTES);
  return tagged("TapLeaf", Buffer.concat([Buffer.of(TAPSCRIPT_LEAF_VERSION), compactScriptLength(script.length), script])).toString("hex");
}

export function createTwoLeafTaprootOutput({ internalPublicKeyHex, firstScriptHex, secondScriptHex }) {
  const internal = publicHex(internalPublicKeyHex, 32);
  const first = Buffer.from(tapLeafHashHex(firstScriptHex), "hex");
  const second = Buffer.from(tapLeafHashHex(secondScriptHex), "hex");
  if (first.equals(second)) throw new Error("NativeTaprootDuplicateLeaves");
  const root = branchHash(first, second);
  const output = tweakedOutput(internal, root);
  const prefix = Buffer.concat([Buffer.of(TAPSCRIPT_LEAF_VERSION | output.parity), internal]);
  return Object.freeze({ scriptPubKeyHex: `5120${output.xOnlyHex}`, outputPublicKeyHex: output.xOnlyHex,
    internalPublicKeyHex: internal.toString("hex"), merkleRootHex: root.toString("hex"),
    first: Object.freeze({ scriptHex: firstScriptHex.toLowerCase(), controlBlockHex: Buffer.concat([prefix, second]).toString("hex"), leafHashHex: first.toString("hex") }),
    second: Object.freeze({ scriptHex: secondScriptHex.toLowerCase(), controlBlockHex: Buffer.concat([prefix, first]).toString("hex"), leafHashHex: second.toString("hex") }) });
}

export function verifyTaprootControlBlock({ scriptPubKeyHex, scriptHex, controlBlockHex }) {
  const outputScript = publicHex(scriptPubKeyHex, 34);
  if (outputScript[0] !== 0x51 || outputScript[1] !== 0x20) throw new Error("NativeTaprootOutputScriptInvalid");
  const control = publicHex(controlBlockHex, undefined, 33 + 128 * 32);
  if (control.length < 33 || (control.length - 33) % 32 !== 0 || (control[0] & 0xfe) !== TAPSCRIPT_LEAF_VERSION) {
    throw new Error("NativeTaprootControlBlockInvalid");
  }
  let root = Buffer.from(tapLeafHashHex(scriptHex), "hex");
  for (let offset = 33; offset < control.length; offset += 32) root = branchHash(root, control.subarray(offset, offset + 32));
  const output = tweakedOutput(control.subarray(1, 33), root);
  if (output.parity !== (control[0] & 1) || output.xOnlyHex !== outputScript.subarray(2).toString("hex")) {
    throw new Error("NativeTaprootControlBlockMismatch");
  }
  return Object.freeze({ leafHashHex: tapLeafHashHex(scriptHex), merkleRootHex: root.toString("hex"), leafVersion: TAPSCRIPT_LEAF_VERSION });
}

// BIP341's public NUMS construction: lift_x(SHA256(uncompressed generator)).
// Its discrete logarithm is not known. The bridge never provisions a key-path
// secret for this point; both temporary-deposit spending branches are scripts.
export function bridgeNumsPublicKeyHex() {
  const candidate = createHash("sha256").update(secp256k1.Point.BASE.toBytes(false)).digest();
  schnorr.utils.lift_x(BigInt(`0x${candidate.toString("hex")}`));
  return candidate.toString("hex");
}

function tweakedOutput(internal, root) {
  const point = schnorr.utils.lift_x(BigInt(`0x${internal.toString("hex")}`));
  const tweak = BigInt(`0x${tagged("TapTweak", Buffer.concat([internal, root])).toString("hex")}`);
  if (tweak >= secp256k1.Point.Fn.ORDER) throw new Error("NativeTaprootTweakOverflow");
  const output = tweak === 0n ? point : point.add(secp256k1.Point.BASE.multiply(tweak));
  output.assertValidity();
  const compressed = Buffer.from(output.toBytes());
  return { parity: compressed[0] & 1, xOnlyHex: compressed.subarray(1).toString("hex") };
}
function branchHash(left, right) {
  const ordered = Buffer.compare(left, right) < 0 ? [left, right] : [right, left];
  return tagged("TapBranch", Buffer.concat(ordered));
}
function tagged(tag, message) {
  const prefix = createHash("sha256").update(tag).digest();
  return createHash("sha256").update(prefix).update(prefix).update(message).digest();
}
function publicHex(value, length, maximum = length) {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || value.length > maximum * 2
    || (length !== undefined && value.length !== length * 2) || !/^[0-9a-f]+$/iu.test(value)) throw new Error("NativeTaprootPublicEncodingInvalid");
  return Buffer.from(value, "hex");
}
function compactScriptLength(length) {
  if (length < 253) return Buffer.of(length);
  const encoded = Buffer.alloc(3); encoded[0] = 253; encoded.writeUInt16LE(length, 1); return encoded;
}
