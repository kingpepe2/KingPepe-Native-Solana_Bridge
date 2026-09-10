// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Original bounded PSBTv0/BIP371 encoding. Offline, REGTEST-only, no key access.
import { createHash } from "node:crypto";
import { prepareRegtestRecoveryTransaction, buildRegtestRecoverableDeposit } from "./taproot-deposit.mjs";
import { parseNativeTransactionHex } from "../node/native-taproot-transaction.mjs";
import { bridgeNumsPublicKeyHex, verifyTaprootControlBlock } from "../node/native-tapscript.mjs";
import { REGTEST_GENESIS } from "../node/native-raw-evidence.mjs";

const MAGIC = Buffer.from("70736274ff", "hex");
const MAX_PSBT_BYTES = 16_384;
const DOMAIN_KEY = "fc08" + Buffer.from("KingPepe").toString("hex") + "01";

export function prepareRegtestRecoveryPsbt(options) {
  const transaction = prepareRegtestRecoveryTransaction(options);
  const policy = buildRegtestRecoverableDeposit(options.depositPolicy);
  const origin = options.userKeyOrigin;
  if (typeof origin?.masterFingerprintHex !== "string" || !/^[0-9a-f]{8}$/u.test(origin.masterFingerprintHex)) {
    throw new Error("RecoveryPublicKeyOriginRequired");
  }
  const path = parsePublicDerivationPath(origin.derivationPath);
  const keyOrigin = Buffer.concat([Buffer.of(1), Buffer.from(policy.recovery.leafHashHex, "hex"),
    Buffer.from(origin.masterFingerprintHex, "hex"), ...path.map(u32)]);
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(BigInt(transaction.amountAtomic));
  const global = [entry("00", Buffer.from(transaction.unsignedTransactionHex, "hex")),
    // Public domain marker: wallets may preserve unknown proprietary fields.
    // It is not a replacement for the user's network/transaction verification.
    entry(DOMAIN_KEY,
      Buffer.concat([Buffer.from(policy.nativeGenesisHex, "hex"), Buffer.from(policy.depositCommitmentHex, "hex")]))];
  const input = [entry("01", Buffer.concat([amount, compact(34), Buffer.from(policy.scriptPubKeyHex, "hex")])),
    entry("03", u32(0)),
    entry("0b" + createHash("sha256").update(Buffer.from(policy.depositCommitmentHex, "hex")).digest("hex"),
      Buffer.from(policy.depositCommitmentHex, "hex")),
    entry("15" + policy.recovery.controlBlockHex, Buffer.concat([Buffer.from(policy.recovery.scriptHex, "hex"), Buffer.of(0xc0)])),
    entry("16" + policy.userRecoveryPublicKeyHex, keyOrigin),
    entry("17", Buffer.from(policy.internalPublicKeyHex, "hex")),
    entry("18", Buffer.from(policy.merkleRootHex, "hex"))];
  const bytes = Buffer.concat([MAGIC, encodeMap(global), encodeMap(input), Buffer.of(0)]);
  if (bytes.length > MAX_PSBT_BYTES) throw new Error("RecoveryPsbtTooLarge");
  return Object.freeze({ ...transaction, psbtVersion: 0, psbtBase64: bytes.toString("base64"),
    psbtSha256: createHash("sha256").update(bytes).digest("hex"), walletSigningCompatibility: "NOT_VERIFIED",
    publicKeyOriginIncluded: true });
}

export function parsePublicDerivationPath(value) {
  if (typeof value !== "string" || value.length > 128 || !/^m(?:\/(?:0|[1-9][0-9]{0,9})(?:'|h)?){1,10}$/u.test(value)) {
    throw new Error("RecoveryDerivationPathInvalid");
  }
  return Object.freeze(value.slice(2).split("/").map((part) => {
    const hardened = /['h]$/u.test(part);
    const number = Number(hardened ? part.slice(0, -1) : part);
    if (!Number.isSafeInteger(number) || number > 0x7fff_ffff) throw new Error("RecoveryDerivationPathInvalid");
    return number + (hardened ? 0x8000_0000 : 0);
  }));
}

// Inspect only this tooling's unsigned one-input/one-output PSBT subset.
// Reject duplicates, alternate compact lengths, trailing data and oversized maps.
// This function never treats a wallet-returned PSBT as signing authorization.
export function inspectUnsignedRecoveryPsbt(base64) {
  if (typeof base64 !== "string" || base64.length > Math.ceil(MAX_PSBT_BYTES / 3) * 4) throw new Error("RecoveryPsbtTooLarge");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > MAX_PSBT_BYTES || bytes.toString("base64") !== base64 || !bytes.subarray(0, 5).equals(MAGIC)) throw new Error("RecoveryPsbtEncodingInvalid");
  let offset = 5;
  const take = (length) => { if (offset + length > bytes.length) throw new Error("RecoveryPsbtTruncated");
    const out = bytes.subarray(offset, offset + length); offset += length; return out; };
  const size = () => { const first = take(1)[0]; if (first < 253) return first;
    if (first !== 253) throw new Error("RecoveryPsbtLengthInvalid");
    const value = take(2).readUInt16LE(); if (value < 253) throw new Error("RecoveryPsbtNoncanonicalLength"); return value; };
  const map = () => {
    const entries = new Map();
    while (true) {
      const keyLength = size(); if (keyLength === 0) return entries;
      if (keyLength > 4096 || entries.size >= 32) throw new Error("RecoveryPsbtMapTooLarge");
      const key = take(keyLength).toString("hex");
      const valueLength = size(); if (valueLength > 8192) throw new Error("RecoveryPsbtMapTooLarge");
      const value = take(valueLength).toString("hex");
      if (entries.has(key)) throw new Error("RecoveryPsbtDuplicateKey"); entries.set(key, value);
    }
  };
  const global = map(); const input = map(); const output = map();
  if (offset !== bytes.length) throw new Error("RecoveryPsbtTrailingData");
  // This is deliberately not a general-purpose wallet PSBT importer. Accept
  // only the unsigned shape emitted here, with no alternate key-type encoding.
  const preimageKeys = [...input.keys()].filter((key) => /^0b[0-9a-f]{64}$/u.test(key));
  const leafKeys = [...input.keys()].filter((key) => /^15c[01][0-9a-f]{128}$/u.test(key));
  const originKeys = [...input.keys()].filter((key) => /^16[0-9a-f]{64}$/u.test(key));
  if (global.size !== 2 || !global.has("00") || !global.has(DOMAIN_KEY)
    || !new RegExp(`^${REGTEST_GENESIS}[0-9a-f]{64}$`, "u").test(global.get(DOMAIN_KEY))
    || input.size !== 7 || !input.has("01") || input.get("03") !== "00000000"
    || input.get("17") !== bridgeNumsPublicKeyHex() || !/^[0-9a-f]{64}$/u.test(input.get("18") ?? "")
    || preimageKeys.length !== 1 || leafKeys.length !== 1 || originKeys.length !== 1 || output.size !== 0) {
    throw new Error("RecoveryPsbtSubsetInvalid");
  }
  const commitment = global.get(DOMAIN_KEY).slice(64);
  const commitmentHash = createHash("sha256").update(Buffer.from(commitment, "hex")).digest("hex");
  const witnessUtxo = input.get("01");
  const leaf = input.get(leafKeys[0]);
  const origin = input.get(originKeys[0]);
  if (preimageKeys[0] !== "0b" + commitmentHash || input.get(preimageKeys[0]) !== commitment
    || !/^[0-9a-f]{16}225120[0-9a-f]{64}$/u.test(witnessUtxo)
    || leaf.length < 2 || leaf.length > 1026 || !leaf.endsWith("c0")
    || leafKeys[0].slice(4, 68) !== input.get("17")
    || !/^01[0-9a-f]{80,152}$/u.test(origin) || (origin.length - 74) % 8 !== 0) {
    throw new Error("RecoveryPsbtSubsetInvalid");
  }
  const checkedLeaf = verifyTaprootControlBlock({ scriptPubKeyHex: witnessUtxo.slice(18),
    scriptHex: leaf.slice(0, -2), controlBlockHex: leafKeys[0].slice(2) });
  if (checkedLeaf.merkleRootHex !== input.get("18") || checkedLeaf.leafHashHex !== origin.slice(2, 66)) {
    throw new Error("RecoveryPsbtSubsetInvalid");
  }
  const transaction = parseNativeTransactionHex(global.get("00"));
  if (transaction.version !== 2 || transaction.hasWitness || transaction.inputs.length !== 1 || transaction.outputs.length !== 1
    || transaction.lockTime !== 0 || transaction.inputs[0].scriptSigHex !== ""
    || transaction.inputs[0].sequence < 1 || transaction.inputs[0].sequence > 65535
    || !/^5120[0-9a-f]{64}$/u.test(transaction.outputs[0].scriptPubKeyHex)) {
    throw new Error("RecoveryPsbtSubsetInvalid");
  }
  return Object.freeze({ global: Object.freeze(Object.fromEntries(global)), input: Object.freeze(Object.fromEntries(input)),
    output: Object.freeze(Object.fromEntries(output)), signingAuthorized: false, broadcastAuthorized: false });
}

function entry(key, value) { return [Buffer.from(key, "hex"), value]; }
function encodeMap(entries) {
  entries.sort(([a], [b]) => Buffer.compare(a, b));
  return Buffer.concat([...entries.flatMap(([key, value]) => [compact(key.length), key, compact(value.length), value]), Buffer.of(0)]);
}
function compact(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new Error("RecoveryPsbtLengthInvalid");
  if (value < 253) return Buffer.of(value);
  const encoded = Buffer.alloc(3); encoded[0] = 253; encoded.writeUInt16LE(value, 1); return encoded;
}
function u32(value) { const encoded = Buffer.alloc(4); encoded.writeUInt32LE(value); return encoded; }
