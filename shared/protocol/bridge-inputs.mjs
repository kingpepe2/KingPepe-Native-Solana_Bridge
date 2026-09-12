// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Application hash preimages only. Never replaces Native sighashes, FROST
// primitives, Solana SDK bytes, protected-store records or JSON RPC envelopes.
import { createHash } from "node:crypto";
import { serialize, deserialize } from "borsh";

const fixed = len => ({ array: { type: "u8", len } });
const h = fixed(32), point = fixed(33), blob = { array: { type: "u8" } };
const s = struct => ({ struct }), list = type => ({ array: { type } }), pair = type => ({ array: { type, len: 2 } });
const outpoint = s({ txid: h, vout: "u32" });
const roles = pair("string");
const keyContext = s({ protocol: "string", environment: "string", nativeNetwork: "string", nativeGenesisHash: h,
  solanaDeployment: h, bridgeProgramId: h, transceiverProgramId: h, mint: h, keyEpoch: "u32" });
const participant = s({ signerId: "string", index: "u32" });
const dkgRequest = s({ protocol: "string", epoch: "u32", context: keyContext, contextDigest: h,
  sessionId: h, participantSetHash: h, threshold: "u16", participants: pair(participant) });
const round1 = s({ identifier: h, commitmentsHex: pair(point), proofOfKnowledgeHex: fixed(64) });
const round2 = s({ senderId: "string", round2: s({ identifier: h, signingShareHex: h }) });
const unsignedCommitment = s({ identifier: h, hidingHex: point, bindingHex: point, intentDigest: h, messageHex: h, participantIds: roles });
const commitment = s({ ...unsignedCommitment.struct, nonceReservationId: h, reservationCounter: "u64" });
const verifyingShares = pair(s({ identifier: h, shareHex: point }));
const publicPackage = s({ signers: s({ min: "u16", max: "u16" }), commitmentsHex: pair(point), verifyingSharesHex: verifyingShares });

export const BRIDGE_INPUT_SCHEMAS = Object.freeze({
  NativeSigningIntent: [1, s({ protocol: "string", mode: "string", purpose: "string", nativeNetwork: "string",
    nativeGenesisHash: h, solanaDeployment: h, bridgeProgramId: h, transceiverProgramId: h, mint: h,
    keyEpoch: "u32", signingRequestId: h, operationId: h, withdrawalId: h, proofFingerprint: h,
    unsignedNativeTransactionId: h, transactionCommitment: h, signingInputIndex: "u32", taprootSighashHex: h,
    recipientScriptPubKeyHex: blob, amountAtomic: "u64", feeAtomic: "u64", changeScriptPubKeyHex: blob,
    changeAtomic: "u64", inputOutpoints: list(outpoint), outputCommitments: list(h), reserveCommitment: h,
    pauseWithdrawals: "bool", hardStop: "bool" })],
  FrostSession: [2, s({ protocol: "string", requestId: h, epoch: "u32", attempt: "u32",
    intentDigest: h, messageHex: h, participantIds: roles })],
  FrostKeyContext: [3, keyContext],
  FrostParticipantSet: [4, s({ protocol: "string", participants: pair(participant), threshold: "u16" })],
  FrostDkgSession: [5, s({ protocol: "string", epoch: "u32", contextDigest: h, participantSetHash: h, threshold: "u16" })],
  FrostDkgHandoff: [6, s({ protocol: "string", request: dkgRequest, signerId: "string",
    round1: pair(round1), incoming: { array: { type: round2, len: 1 } } })],
  FrostNonceReservation: [7, s({ domain: "string", signerId: "string", reservationCounter: "u64", requestId: h,
    epoch: "u32", sessionId: h, intentDigest: h, messageHex: h, participantIds: roles, commitment: unsignedCommitment })],
  FrostCommitment: [8, commitment],
  FrostCommitmentSet: [9, pair(commitment)],
  FrostShare: [10, s({ shareHex: h })],
  FrostPublicPackage: [11, publicPackage],
  CoordinatorKey: [12, s({ protocol: "string", publicPackage, aggregateTweakedXOnlyPublicKey: h })],
  DepositPolicy: [13, s({ environment: "string", nativeGenesis: h, solanaDeployment: h, solanaGenesis: h,
    minimumSolanaSlot: "u64", managerProgramId: h, transceiverProgramId: h, mint: h, protocolId: "u32",
    nativeNetwork: "u32", policyEpoch: "u32", keyEpoch: "u32", frostPublicKeyHex: h, csvDelayBlocks: "u32",
    minimumConfirmations: "u32", maximumAmountAtomic: "u64", maximumFeeAtomic: "u64" })],
  ReserveAllocation: [14, s({ protocol: "string", policyDigest: h, deposit: outpoint, sweep: outpoint })],
  ReserveCreditEvidence: [15, s({ protocol: "string", policyDigest: h, allocationId: h, proofDigest: h })],
  ReserveCreditNonce: [16, s({ protocol: "string", allocationId: h, depositNonce: h })],
  TransactionCommitment: [17, s({ protocol: "string", txidHex: h, inputOutpoints: list(outpoint), outputCommitments: list(h),
    shaPrevouts: h, shaAmounts: h, shaScriptPubKeys: h, shaSequences: h, shaOutputs: h })],
  IndexedOutput: [18, s({ index: "u32", amountAtomic: "u64", scriptPubKeyHex: blob })],
  SweepRequest: [19, s({ protocol: "string", operationIdHex: h, depositOutpoint: outpoint,
    unsignedNativeTransactionFingerprintHex: h, taprootSighashHex: h, transactionCommitment: h, proofFingerprintHex: h })],
  WithdrawalProof: [20, s({ withdrawal: h, native: h })],
  WithdrawalSigningRequest: [21, s({ purpose: "string", operationId: h, txid: h, input: "u32", sighash: h })],
  FinalizedWithdrawal: [22, s({ signature: fixed(64), message: fixed(514), record: fixed(283), slot: "u64" })],
  WithdrawalObservation: [23, s({ protocol: "string", cluster: "string", solanaDeploymentHex: h, transactionSignature: "string",
    slot: "u64", rootSlot: "u64", commitment: "string", operationIdHex: h, withdrawalIdHex: h, messageDigestHex: h,
    grossAmountAtomic: "u64", feeAtomic: "u64", nativeDestinationHex: blob, trust: "string" })],
  DepositReserveEvidence: [24, s({ protocol: "string", deposit: s({ trust: "string", nativeNetwork: "u32", nativeGenesisHash: h,
    depositOutpoint: outpoint, amountAtomic: "u64", solanaRecipientHex: h, proofFingerprint: h, finalitySatisfied: "bool",
    utxoUnspentAtDeposit: "bool", noPriorConsumption: "bool" }), reserveSweep: s({ reserveAllocationIdHex: h,
      nativeSweepTxidHex: h, canonicalReserveScriptPubKeyHex: blob, transactionCommitment: h, taprootSighashHex: h,
      outputCommitments: list(h), changeAtomic: "u64" }) })],
  LocalClaimNonce: [25, s({ protocol: "string", depositOutpoint: outpoint, reserveAllocationIdHex: h, solanaRecipientHex: h, mintHex: h })],
  LocalSweepSummary: [26, s({ protocol: "string", unsignedNativeTransactionFingerprintHex: h, nativeSweepTxidHex: h,
    inputOutpoints: list(outpoint), reserveAmountAtomic: "u64", canonicalReserveScriptPubKeyHex: blob,
    nativeMinerFeeAtomic: "u64", allSighashDigestHex: h })],
  LocalReserveOutput: [27, s({ protocol: "string", nativeSweepTxidHex: h, vout: "u32", amountAtomic: "u64", scriptPubKeyHex: blob })],
  TaprootEvidenceSet: [28, s({ protocol: "string", evidences: list(s({ signingInputIndex: "u32", taprootSighashHex: h,
    unsignedNativeTransactionFingerprintHex: h, nativeSweepTxidHex: h })) })],
  LocalReserveAllocation: [29, s({ protocol: "string", solanaDeploymentHex: h, mintHex: h, depositOutpoint: outpoint,
    unsignedNativeTransactionFingerprintHex: h, nativeSweepTxidHex: h, inputOutpoints: list(outpoint), reserveOutputVout: "u32",
    reserveAmountAtomic: "u64", canonicalReserveScriptPubKeyHex: blob, solanaRecipientHex: h })],
  SweepJobIdentity: [30, s({ protocol: "string", policyDigest: h, signingRequestId: h, intentDigest: h })],
});

function normalized(schema, value) {
  if (typeof schema === "string") {
    if (schema === "string") {
      if (typeof value !== "string" || !/^[\x20-\x7e]{1,256}$/u.test(value)) throw Error("BridgeInputText");
      return value;
    }
    if (schema === "bool") {
      if (typeof value !== "boolean") throw Error("BridgeInputBoolean");
      return value;
    }
    const width = Number(schema.slice(1));
    if (typeof value === "string") {
      if (!/^(0|[1-9][0-9]{0,19})$/u.test(value)) throw Error("BridgeInputInteger");
      value = BigInt(value);
    }
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw Error("BridgeInputInteger");
    if (!["number", "bigint"].includes(typeof value) || BigInt(value) < 0n || BigInt(value) >= 1n << BigInt(width)) throw Error("BridgeInputInteger");
    return width <= 32 ? Number(value) : BigInt(value);
  }
  if (schema === outpoint && typeof value === "string") {
    if (!/^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/u.test(value)) throw Error("BridgeInputOutpoint");
    const [txid, vout] = value.split(":"); value = { txid, vout };
  }
  if (schema === verifyingShares && !Array.isArray(value)) {
    if (!value || typeof value !== "object") throw Error("BridgeInputShares");
    value = Object.keys(value).sort().map(identifier => ({ identifier, shareHex: value[identifier] }));
  }
  if (schema.array) {
    const { type, len } = schema.array;
    if (type === "u8" && typeof value === "string") {
      if (value.length > 20_000 || !/^(?:[0-9a-f]{2})*$/u.test(value)) throw Error("BridgeInputHex");
      value = Buffer.from(value, "hex");
    }
    const limit = len ?? (type === "u8" ? 10_000 : 256);
    if (!(Array.isArray(value) || value instanceof Uint8Array) || value.length > limit || (len !== undefined && value.length !== len)) throw Error("BridgeInputArray");
    return Array.from(value, v => normalized(type, v));
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== Object.keys(schema.struct).sort().join()) throw Error("BridgeInputFields");
  return Object.fromEntries(Object.entries(schema.struct).map(([k, t]) => [k, normalized(t, value[k])]));
}
function definition(name) {
  const entry = BRIDGE_INPUT_SCHEMAS[name];
  if (!entry) throw Error("BridgeInputType");
  return { kind: entry[0], schema: s({ magic: fixed(8), kind: "u16", value: entry[1] }) };
}
export function encodeBridgeInput(name, value) {
  const { kind, schema } = definition(name);
  return Buffer.from(serialize(schema, normalized(schema, { magic: Buffer.from("KPINPUT2"), kind, value })));
}
export function bridgeInputDigest(name, value) {
  return createHash("sha256").update(encodeBridgeInput(name, value)).digest("hex");
}
// Check all dynamic lengths BEFORE calling borsh-js (its Vec decoder allocates).
function checkBounds(schema, bytes) {
  let at = 0;
  const take = n => { if (!Number.isSafeInteger(n) || n < 0 || n > bytes.length - at) throw Error("BridgeInputTruncated"); const start = at; at += n; return start; };
  const length = () => bytes.readUInt32LE(take(4));
  function visit(type) {
    if (typeof type === "string") {
      if (type === "string") { const n = length(); if (n > 256) throw Error("BridgeInputText"); take(n); }
      else if (type === "bool") { if (bytes[take(1)] > 1) throw Error("BridgeInputBoolean"); }
      else take(Number(type.slice(1)) / 8);
    } else if (type.array) {
      const n = type.array.len ?? length(), bound = type.array.len ?? (type.array.type === "u8" ? 10_000 : 256);
      if (n > bound) throw Error("BridgeInputArray");
      if (type.array.type === "u8") take(n); else for (let i = 0; i < n; i++) visit(type.array.type);
    } else for (const field of Object.values(type.struct)) visit(field);
  }
  visit(schema); if (at !== bytes.length) throw Error("BridgeInputTrailing");
}
export function decodeBridgeInput(name, input) {
  if (!(input instanceof Uint8Array) || input.length > 1_048_576) throw Error("BridgeInputLength");
  const bytes = Buffer.from(input), { kind, schema } = definition(name);
  checkBounds(schema, bytes);
  const decoded = deserialize(schema, bytes);
  if (Buffer.from(decoded.magic).toString("ascii") !== "KPINPUT2" || decoded.kind !== kind ||
      !encodeBridgeInput(name, decoded.value).equals(bytes)) throw Error("BridgeInputNonCanonical");
  return decoded.value;
}
