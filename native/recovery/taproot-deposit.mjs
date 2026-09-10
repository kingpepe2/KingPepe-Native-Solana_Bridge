// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// REGTEST-only public script construction; no secret creation or signing.
import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { REGTEST_GENESIS } from "../node/native-raw-evidence.mjs";
import { bridgeNumsPublicKeyHex, createTwoLeafTaprootOutput } from "../node/native-tapscript.mjs";
import { parseNativeTransactionHex } from "../node/native-taproot-transaction.mjs";

export function deriveRegtestDepositCommitment(input) {
  if (input?.nativeGenesisHex !== REGTEST_GENESIS) throw new Error("RecoveryWrongNativeNetwork");
  const domains = ["nativeGenesisHex", "solanaDeploymentHex", "managerProgramIdHex", "transceiverProgramIdHex", "mintHex", "recipientHex", "nonceHex"];
  const amount = atomic(input.amountAtomic);
  if (amount === 0n) throw new Error("RecoveryAmountMustBePositive");
  const units = Buffer.alloc(8); units.writeBigUInt64LE(amount);
  const counters = Buffer.alloc(16);
  for (const [index, field] of ["protocolId", "nativeNetwork", "policyEpoch", "keyEpoch"].entries()) {
    counters.writeUInt32LE(positive(input[field], 0xffff_ffff), index * 4);
  }
  return createHash("sha256").update(Buffer.concat([Buffer.from("KPDINT01"), ...domains.map((key) => hash32(input[key])), units, counters])).digest("hex");
}

export function buildRegtestRecoverableDeposit({ nativeGenesisHex, depositCommitmentHex, frostPublicKeyHex, userRecoveryPublicKeyHex, csvDelayBlocks }) {
  if (nativeGenesisHex !== REGTEST_GENESIS) throw new Error("RecoveryWrongNativeNetwork");
  const commitment = hash32(depositCommitmentHex).toString("hex");
  const frost = publicKey(frostPublicKeyHex);
  const recovery = publicKey(userRecoveryPublicKeyHex);
  if (frost === recovery) throw new Error("RecoveryKeyMustBeDistinct");
  const delay = positive(csvDelayBlocks, 0xffff);
  // Standard Miniscript fragments let the Native wallet sign the recovery
  // PSBT. The 32-byte intent digest is PUBLIC, not an access-control secret.
  // Each branch still requires its key's signature; recovery also requires CSV.
  const commitmentHash = createHash("sha256").update(Buffer.from(commitment, "hex")).digest("hex");
  const intentLock = `82012088a820${commitmentHash}88`;
  const sweepScriptHex = `${intentLock}20${frost}ac`;
  const recoveryScriptHex = `${scriptNumber(delay)}b269${intentLock}20${recovery}ac`;
  const output = createTwoLeafTaprootOutput({ internalPublicKeyHex: bridgeNumsPublicKeyHex(),
    firstScriptHex: sweepScriptHex, secondScriptHex: recoveryScriptHex });
  const canonicalReserveScriptPubKeyHex = `5120${frost}`;
  if (output.scriptPubKeyHex === canonicalReserveScriptPubKeyHex) throw new Error("RecoveryReserveMustBeSeparate");
  return Object.freeze({ protocol: "KINGPEPE_REGTEST_RECOVERABLE_DEPOSIT/V2", localOnly: true, productionReady: false,
    nativeGenesisHex, depositCommitmentHex: commitment, frostPublicKeyHex: frost, userRecoveryPublicKeyHex: recovery,
    csvDelayBlocks: delay, scriptPubKeyHex: output.scriptPubKeyHex, outputPublicKeyHex: output.outputPublicKeyHex,
    internalPublicKeyHex: output.internalPublicKeyHex, merkleRootHex: output.merkleRootHex,
    sweep: Object.freeze({ ...output.first, publicPreimageHex: commitment }),
    recovery: Object.freeze({ ...output.second, publicPreimageHex: commitment }), canonicalReserveScriptPubKeyHex });
}

// Each authorizing role rebuilds against its expected deployment/recipient and
// FROST identity. Coordinator-supplied script metadata is not authorization.
export function validateRegtestRecoverableDepositIntent({ intent, policy, depositScriptPubKeyHex,
  reserveScriptPubKeyHex, frostPublicKeyHex, userRecoveryPublicKeyHex, csvDelayBlocks }) {
  const rebuilt = buildRegtestRecoverableDeposit({ ...policy, nativeGenesisHex: intent.nativeGenesisHex,
    depositCommitmentHex: deriveRegtestDepositCommitment(intent), frostPublicKeyHex, userRecoveryPublicKeyHex, csvDelayBlocks });
  for (const field of ["protocol", "localOnly", "productionReady", "nativeGenesisHex", "depositCommitmentHex",
    "frostPublicKeyHex", "userRecoveryPublicKeyHex", "csvDelayBlocks", "scriptPubKeyHex", "outputPublicKeyHex",
    "internalPublicKeyHex", "merkleRootHex", "canonicalReserveScriptPubKeyHex"]) {
    if (rebuilt[field] !== policy[field]) throw new Error("RecoveryDepositIntentSubstituted");
  }
  for (const branch of ["sweep", "recovery"]) {
    for (const field of ["scriptHex", "controlBlockHex", "leafHashHex", "publicPreimageHex"]) {
      if (rebuilt[branch][field] !== policy[branch]?.[field]) throw new Error("RecoveryDepositIntentSubstituted");
    }
  }
  if (depositScriptPubKeyHex !== rebuilt.scriptPubKeyHex || reserveScriptPubKeyHex !== rebuilt.canonicalReserveScriptPubKeyHex) {
    throw new Error("RecoveryDepositIntentSubstituted");
  }
  return rebuilt;
}

// Offline preparation does not assert current UTXO availability or maturity and
// never signs/broadcasts. Those conditions must be established before broadcast.
export function prepareRegtestRecoveryTransaction({ depositPolicy, fundingTransactionHex, outputIndex,
  amountAtomic, destinationScriptPubKeyHex, feeAtomic, maximumFeeAtomic }) {
  const policy = buildRegtestRecoverableDeposit(depositPolicy);
  const funding = parseNativeTransactionHex(fundingTransactionHex);
  if (!Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex > 0xffff_ffff) throw new Error("RecoveryOutputIndexInvalid");
  const output = funding.outputs[outputIndex];
  const amount = atomic(amountAtomic);
  const fee = atomic(feeAtomic);
  if (output?.amountAtomic !== amount.toString() || output.scriptPubKeyHex !== policy.scriptPubKeyHex) throw new Error("RecoveryFundingOutputMismatch");
  if (fee > atomic(maximumFeeAtomic) || fee >= amount) throw new Error("RecoveryFeeNotAuthorized");
  if (typeof destinationScriptPubKeyHex !== "string" || !/^5120[0-9a-f]{64}$/u.test(destinationScriptPubKeyHex)) throw new Error("RecoveryDestinationMustBeP2tr");
  publicKey(destinationScriptPubKeyHex.slice(4));
  const net = amount - fee;
  // Pinned Native P2TR dust policy; this tool does not support other output types.
  if (net <= 330n) throw new Error("RecoveryOutputBelowDustPolicy");
  const vout = Buffer.alloc(4); vout.writeUInt32LE(outputIndex);
  const sequence = Buffer.alloc(4); sequence.writeUInt32LE(policy.csvDelayBlocks);
  const value = Buffer.alloc(8); value.writeBigUInt64LE(net);
  const bytes = Buffer.concat([Buffer.from("0200000001", "hex"), Buffer.from(funding.txidHex, "hex").reverse(),
    vout, Buffer.of(0), sequence, Buffer.of(1), value, Buffer.of(34), Buffer.from(destinationScriptPubKeyHex, "hex"), Buffer.alloc(4)]);
  return Object.freeze({ status: "UNSIGNED_UNBROADCAST_NOT_AUTHORIZED", localOnly: true, productionReady: false,
    signingAuthorized: false, broadcastAuthorized: false, unsignedTransactionHex: bytes.toString("hex"),
    inputOutpoint: `${funding.txidHex}:${outputIndex}`, amountAtomic, feeAtomic, netAmountAtomic: net.toString(),
    spentOutputs: Object.freeze([Object.freeze({ amountAtomic, scriptPubKeyHex: policy.scriptPubKeyHex })]),
    tapscriptSpends: Object.freeze([policy.recovery]), csvDelayBlocks: policy.csvDelayBlocks });
}

function scriptNumber(value) {
  if (value <= 16) return (0x50 + value).toString(16);
  const bytes = [];
  for (let remaining = value; remaining > 0; remaining >>>= 8) bytes.push(remaining & 0xff);
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0);
  return Buffer.from([bytes.length, ...bytes]).toString("hex");
}
function publicKey(value) {
  const bytes = hash32(value);
  schnorr.utils.lift_x(BigInt(`0x${bytes.toString("hex")}`));
  return bytes.toString("hex");
}
function hash32(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error("RecoveryCanonicalHashRequired");
  return Buffer.from(value, "hex");
}
function positive(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("RecoveryIntegerOutOfRange");
  return value;
}
function atomic(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value) || BigInt(value) > 0xffff_ffff_ffff_ffffn) throw new Error("RecoveryAtomicAmountInvalid");
  return BigInt(value);
}
