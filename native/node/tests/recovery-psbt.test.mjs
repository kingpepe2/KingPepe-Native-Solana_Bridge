// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public generator-point/format fixtures; no live wallet or chain-proof claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { REGTEST_GENESIS } from "../native-raw-evidence.mjs";
import { buildRegtestRecoverableDeposit } from "../../recovery/taproot-deposit.mjs";
import { prepareRegtestRecoveryPsbt, inspectUnsignedRecoveryPsbt, parsePublicDerivationPath } from "../../recovery/recovery-psbt.mjs";

const point = (p) => Buffer.from(p.toBytes()).subarray(1).toString("hex");
const user = point(secp256k1.Point.BASE.double());
const policy = buildRegtestRecoverableDeposit({ nativeGenesisHex: REGTEST_GENESIS, depositCommitmentHex: "07".repeat(32),
  frostPublicKeyHex: point(secp256k1.Point.BASE), userRecoveryPublicKeyHex: user, csvDelayBlocks: 12 });
const options = () => ({ depositPolicy: policy,
  fundingTransactionHex: `0200000001${"08".repeat(32)}0000000000ffffffff01701700000000000022${policy.scriptPubKeyHex}00000000`,
  outputIndex: 0, amountAtomic: "6000", destinationScriptPubKeyHex: `5120${user}`, feeAtomic: "1000", maximumFeeAtomic: "1000",
  userKeyOrigin: { masterFingerprintHex: "01020304", derivationPath: "m/84'/1'/0'/0/3" } });

test("offline PSBT carries exact unsigned economics and only the public user-recovery leaf", () => {
  const prepared = prepareRegtestRecoveryPsbt(options());
  const decoded = inspectUnsignedRecoveryPsbt(prepared.psbtBase64);
  assert.equal(prepared.signingAuthorized, false); assert.equal(prepared.broadcastAuthorized, false);
  assert.equal(prepared.walletSigningCompatibility, "NOT_VERIFIED");
  assert.equal(decoded.global["00"], prepared.unsignedTransactionHex);
  assert.equal(decoded.input["01"], `701700000000000022${policy.scriptPubKeyHex}`);
  assert.equal(decoded.input["03"], "00000000");
  assert.equal(decoded.input["15" + policy.recovery.controlBlockHex], policy.recovery.scriptHex + "c0");
  assert.equal(decoded.input["15" + policy.sweep.controlBlockHex], undefined);
  assert.equal(decoded.input["17"], policy.internalPublicKeyHex);
  assert.equal(decoded.input["18"], policy.merkleRootHex);
  const commitmentHash = createHash("sha256").update(Buffer.from(policy.depositCommitmentHex, "hex")).digest("hex");
  assert.equal(decoded.input["0b" + commitmentHash], policy.depositCommitmentHex);
  assert.equal(decoded.input["16" + user], `01${policy.recovery.leafHashHex}010203045400008001000080000000800000000003000000`);
});

test("public origin paths require explicit canonical bounded integer indexes", () => {
  assert.deepEqual(parsePublicDerivationPath("m/84h/1'/0'/0/3"), [0x80000054, 0x80000001, 0x80000000, 0, 3]);
  for (const path of ["m", "m/01", "m/-1", "m/0.5", "m/2147483648", "m/*", "m" + "/1".repeat(11), undefined]) {
    assert.throws(() => parsePublicDerivationPath(path), /DerivationPathInvalid/u);
  }
  for (const origin of [undefined, {}, { masterFingerprintHex: "01", derivationPath: "m/1" }]) {
    assert.throws(() => prepareRegtestRecoveryPsbt({ ...options(), userKeyOrigin: origin }), /OriginRequired/u);
  }
});

test("bounded PSBT inspection rejects duplicate keys, alternate lengths, malformed base64 and trailing data", () => {
  const prepared = prepareRegtestRecoveryPsbt(options());
  const bytes = Buffer.from(prepared.psbtBase64, "base64");
  const unsigned = Buffer.from(prepared.unsignedTransactionHex, "hex");
  const firstEntry = Buffer.concat([Buffer.of(1, 0, unsigned.length), unsigned]);
  const duplicate = Buffer.concat([bytes.subarray(0, 5), firstEntry, bytes.subarray(5)]);
  assert.throws(() => inspectUnsignedRecoveryPsbt(duplicate.toString("base64")), /DuplicateKey/u);
  const alternate = Buffer.concat([bytes.subarray(0, 5), Buffer.from("fd0100", "hex"), bytes.subarray(6)]);
  assert.throws(() => inspectUnsignedRecoveryPsbt(alternate.toString("base64")), /NoncanonicalLength/u);
  assert.throws(() => inspectUnsignedRecoveryPsbt(Buffer.concat([bytes, Buffer.of(0)]).toString("base64")), /TrailingData/u);
  for (const text of [prepared.psbtBase64 + " ", "***", Buffer.from("70736274ff", "hex").toString("base64"), "A".repeat(30_000)]) {
    assert.throws(() => inspectUnsignedRecoveryPsbt(text), /RecoveryPsbt/u);
  }
});

test("unsigned PSBT inspection rejects version, domain, signed-field and tree substitutions", () => {
  const prepared = prepareRegtestRecoveryPsbt(options());
  const checked = inspectUnsignedRecoveryPsbt(prepared.psbtBase64);
  const mutate = (change) => {
    const maps = structuredClone(checked); change(maps);
    const encoded = [Buffer.from("70736274ff", "hex")];
    for (const map of [maps.global, maps.input, maps.output]) {
      for (const [key, value] of Object.entries(map)) {
        const k = Buffer.from(key, "hex"); const v = Buffer.from(value, "hex");
        assert.ok(k.length < 253 && v.length < 253);
        encoded.push(Buffer.of(k.length), k, Buffer.of(v.length), v);
      }
      encoded.push(Buffer.of(0));
    }
    return Buffer.concat(encoded).toString("base64");
  };
  const domain = Object.keys(checked.global).find((key) => key.startsWith("fc"));
  const preimage = Object.keys(checked.input).find((key) => key.startsWith("0b"));
  const leaf = Object.keys(checked.input).find((key) => key.startsWith("15"));
  const origin = Object.keys(checked.input).find((key) => key.startsWith("16"));
  for (const change of [
    (maps) => { maps.global.fb = "02000000"; },
    (maps) => { maps.global[domain] = "00".repeat(32) + policy.depositCommitmentHex; },
    (maps) => { maps.input[preimage] = "00".repeat(32); },
    (maps) => { maps.input["01"] = "00"; },
    (maps) => { maps.input["18"] = "00".repeat(32); },
    (maps) => { maps.input[leaf] = "51c0"; },
    (maps) => { maps.input[origin] = "01" + "00".repeat(32) + maps.input[origin].slice(66); },
    (maps) => { maps.input["13"] = "07".repeat(64); },
    (maps) => { maps.input.fd0300 = maps.input["03"]; delete maps.input["03"]; },
    (maps) => { maps.global["00"] = "01000000" + maps.global["00"].slice(8); },
    (maps) => { maps.output["00"] = "51"; },
  ]) assert.throws(() => inspectUnsignedRecoveryPsbt(mutate(change)), /RecoveryPsbt|NativeTaproot/u);
});
