// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public generator-point fixtures only; not operational wallet identities.
import assert from "node:assert/strict";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bridgeNumsPublicKeyHex, tapLeafHashHex, verifyTaprootControlBlock } from "../native-tapscript.mjs";
import { REGTEST_GENESIS } from "../native-raw-evidence.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment, prepareRegtestRecoveryTransaction } from "../../recovery/taproot-deposit.mjs";
import { attachTaprootWitnesses, createLocalTaprootSighashEvidence, parseNativeTransactionHex,
  taprootKeyPathSighashDefault, taprootScriptPathSighashDefault } from "../native-taproot-transaction.mjs";

const pointX = (point) => Buffer.from(point.toBytes()).subarray(1).toString("hex");
const frost = pointX(secp256k1.Point.BASE);
const recovery = pointX(secp256k1.Point.BASE.double());
const h = (byte) => byte.repeat(32);
const config = () => ({ nativeGenesisHex: REGTEST_GENESIS, depositCommitmentHex: h("07"),
  frostPublicKeyHex: frost, userRecoveryPublicKeyHex: recovery, csvDelayBlocks: 12 });
const intent = () => ({ nativeGenesisHex: REGTEST_GENESIS, solanaDeploymentHex: h("01"), managerProgramIdHex: h("02"),
  transceiverProgramIdHex: h("03"), mintHex: h("04"), recipientHex: h("05"), nonceHex: h("06"),
  amountAtomic: "9007199254740993", protocolId: 1, nativeNetwork: 8_000_111, policyEpoch: 1, keyEpoch: 1 });

test("public NUMS derivation and both committed spending paths reconstruct the temporary P2TR output", () => {
  assert.equal(bridgeNumsPublicKeyHex(), "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0");
  const built = buildRegtestRecoverableDeposit(config());
  for (const leaf of [built.sweep, built.recovery]) {
    const checked = verifyTaprootControlBlock({ scriptPubKeyHex: built.scriptPubKeyHex, ...leaf });
    assert.equal(checked.leafHashHex, leaf.leafHashHex);
    assert.equal(checked.merkleRootHex, built.merkleRootHex);
    assert.equal(checked.leafVersion, 0xc0);
    assert.equal(leaf.controlBlockHex.length, 65 * 2);
  }
  assert.equal(built.productionReady, false);
  assert.equal(built.localOnly, true);
  assert.notEqual(built.scriptPubKeyHex, built.canonicalReserveScriptPubKeyHex);
});

test("CSV recovery branch uses minimal block-based script numbers at encoding boundaries", () => {
  for (const [delay, encoded] of [[1, "51"], [12, "5c"], [16, "60"], [17, "0111"], [127, "017f"],
    [128, "028000"], [255, "02ff00"], [256, "020001"], [32768, "03008000"], [65535, "03ffff00"]]) {
    const built = buildRegtestRecoverableDeposit({ ...config(), csvDelayBlocks: delay });
    assert.equal(built.recovery.scriptHex, `20${h("07")}75${encoded}b27520${recovery}ac`);
    assert.equal(built.sweep.scriptHex, `20${h("07")}7520${frost}ac`);
  }
});

test("control blocks reject script, sibling, parity, internal key and output substitution", () => {
  const built = buildRegtestRecoverableDeposit(config());
  const base = { scriptPubKeyHex: built.scriptPubKeyHex, ...built.recovery };
  for (const offset of [0, 1, 33, 64]) {
    const changed = Buffer.from(base.controlBlockHex, "hex"); changed[offset] ^= 1;
    assert.throws(() => verifyTaprootControlBlock({ ...base, controlBlockHex: changed.toString("hex") }));
  }
  for (const patch of [{ scriptHex: built.sweep.scriptHex }, { scriptPubKeyHex: built.canonicalReserveScriptPubKeyHex },
    { controlBlockHex: base.controlBlockHex + "00" }, { controlBlockHex: "c2" + base.controlBlockHex.slice(2) }]) {
    assert.throws(() => verifyTaprootControlBlock({ ...base, ...patch }));
  }
});

test("recovery construction rejects Mainnet selection, malformed keys, duplicate roles and unsafe CSV flags", () => {
  for (const patch of [{ nativeGenesisHex: h("00") }, { userRecoveryPublicKeyHex: frost },
    { userRecoveryPublicKeyHex: h("ff") }, { depositCommitmentHex: "aéz" },
    ...[0, -1, 65536, 1 << 22, 0x80000001, 1.5].map((csvDelayBlocks) => ({ csvDelayBlocks }))]) {
    assert.throws(() => buildRegtestRecoverableDeposit({ ...config(), ...patch }));
  }
  assert.throws(() => tapLeafHashHex("51".repeat(513)), /PublicEncodingInvalid/u);
});

test("binary deposit commitment binds every domain, economic and recipient field without Number conversion", () => {
  const base = intent();
  const expected = deriveRegtestDepositCommitment(base);
  for (const key of ["solanaDeploymentHex", "managerProgramIdHex", "transceiverProgramIdHex", "mintHex", "recipientHex", "nonceHex"]) {
    assert.notEqual(deriveRegtestDepositCommitment({ ...base, [key]: h("ff") }), expected);
  }
  for (const key of ["protocolId", "nativeNetwork", "policyEpoch", "keyEpoch"]) {
    assert.notEqual(deriveRegtestDepositCommitment({ ...base, [key]: base[key] + 1 }), expected);
  }
  assert.notEqual(deriveRegtestDepositCommitment({ ...base, amountAtomic: "9007199254740992" }), expected);
  for (const amountAtomic of ["0", "01", "1.0", "18446744073709551616", 1]) {
    assert.throws(() => deriveRegtestDepositCommitment({ ...base, amountAtomic }));
  }
  assert.throws(() => deriveRegtestDepositCommitment({ ...base, nativeGenesisHex: h("ff") }), /WrongNativeNetwork/u);
});

test("script-path sighash binds the leaf and mixed witness attachment preserves the transaction identity", () => {
  const built = buildRegtestRecoverableDeposit(config());
  const raw = `0200000001${h("08")}00000000000c000000018813000000000000225120${frost}00000000`;
  const spentOutputs = [{ amountAtomic: "6000", scriptPubKeyHex: built.scriptPubKeyHex }];
  const keyPath = taprootKeyPathSighashDefault({ transaction: raw, spentOutputs, inputIndex: 0 });
  const scriptPath = taprootScriptPathSighashDefault({ transaction: raw, spentOutputs, inputIndex: 0, scriptHex: built.recovery.scriptHex });
  assert.equal(scriptPath.extFlag, 1);
  assert.notEqual(keyPath.sigHashHex, scriptPath.sigHashHex);
  assert.equal(scriptPath.sigMsgWithEpochHex.slice(-74), `${built.recovery.leafHashHex}00ffffffff`);
  // epoch + hash type + version + locktime + five precomputed hashes
  assert.equal(Buffer.from(scriptPath.sigMsgWithEpochHex, "hex")[1 + 1 + 4 + 4 + 5 * 32], 2);
  const evidence = createLocalTaprootSighashEvidence({ unsignedNativeTransactionHex: raw, spentOutputs,
    signingInputIndex: 0, proofFingerprintHex: h("09"), reserveAmountAtomic: "5000", nativeMinerFeeAtomic: "1000",
    expectedRecipientScriptPubKeyHex: built.canonicalReserveScriptPubKeyHex, tapscriptSpend: built.recovery });
  assert.equal(evidence.taprootSighashHex, scriptPath.sigHashHex);
  // Signature bytes here are a serialization fixture, not a valid spend claim.
  const attached = attachTaprootWitnesses({ unsignedNativeTransactionHex: raw, spentOutputs,
    signatures: ["07".repeat(64)], tapscriptSpends: [built.recovery] });
  const parsed = parseNativeTransactionHex(attached.rawSignedTransactionHex);
  assert.equal(parsed.txidHex, parseNativeTransactionHex(raw).txidHex);
  assert.equal(parsed.inputs[0].witness.length, 3);
  assert.equal(Buffer.from(parsed.inputs[0].witness[1]).toString("hex"), built.recovery.scriptHex);
  assert.equal(Buffer.from(parsed.inputs[0].witness[2]).toString("hex"), built.recovery.controlBlockHex);
});

test("script witness metadata cannot override the actual spent output and extensions fail closed", () => {
  const built = buildRegtestRecoverableDeposit(config());
  const raw = `0200000001${h("08")}00000000000c000000018813000000000000225120${frost}00000000`;
  const spentOutputs = [{ amountAtomic: "6000", scriptPubKeyHex: built.canonicalReserveScriptPubKeyHex }];
  const malicious = { ...built.recovery, scriptPubKeyHex: built.scriptPubKeyHex };
  assert.throws(() => attachTaprootWitnesses({ unsignedNativeTransactionHex: raw, spentOutputs,
    signatures: ["07".repeat(64)], tapscriptSpends: [malicious] }), /ControlBlockMismatch/u);
  assert.throws(() => createLocalTaprootSighashEvidence({ unsignedNativeTransactionHex: raw, spentOutputs,
    signingInputIndex: 0, proofFingerprintHex: h("09"), reserveAmountAtomic: "5000", nativeMinerFeeAtomic: "1000",
    expectedRecipientScriptPubKeyHex: built.canonicalReserveScriptPubKeyHex, tapscriptSpend: malicious }), /ControlBlockMismatch/u);
  for (const patch of [{ extFlag: 0 }, { hashType: 1 }, { annex: "50" }, { codeSeparatorPosition: 0 }]) {
    assert.throws(() => taprootScriptPathSighashDefault({ transaction: raw, spentOutputs, inputIndex: 0,
      scriptHex: built.recovery.scriptHex, ...patch }), /Unsupported|OnlyDefaultSupported/u);
  }
});

test("offline recovery preparation binds the actual output and authorized fees without signing or broadcasting", () => {
  const policy = buildRegtestRecoverableDeposit(config());
  const raw = `0200000001${h("08")}0000000000ffffffff01701700000000000022${policy.scriptPubKeyHex}00000000`;
  const options = { depositPolicy: policy, fundingTransactionHex: raw, outputIndex: 0, amountAtomic: "6000",
    destinationScriptPubKeyHex: `5120${recovery}`, feeAtomic: "1000", maximumFeeAtomic: "1000" };
  const plan = prepareRegtestRecoveryTransaction(options);
  const parsed = parseNativeTransactionHex(plan.unsignedTransactionHex);
  assert.equal(plan.status, "UNSIGNED_UNBROADCAST_NOT_AUTHORIZED");
  assert.equal(plan.signingAuthorized, false); assert.equal(plan.broadcastAuthorized, false);
  assert.equal(parsed.hasWitness, false); assert.equal(parsed.version, 2);
  assert.equal(parsed.inputs[0].sequence, 12);
  assert.equal(parsed.inputs[0].outpoint, `${parseNativeTransactionHex(raw).txidHex}:0`);
  assert.equal(parsed.outputs[0].amountAtomic, "5000");
  for (const patch of [{ outputIndex: 1 }, { outputIndex: -1 }, { amountAtomic: "6001" }, { feeAtomic: "1001" },
    { depositPolicy: { ...policy, csvDelayBlocks: 13 } }, { destinationScriptPubKeyHex: "51" },
    { feeAtomic: "5670", maximumFeeAtomic: "6000" }]) {
    assert.throws(() => prepareRegtestRecoveryTransaction({ ...options, ...patch }), /Recovery/u);
  }
});
