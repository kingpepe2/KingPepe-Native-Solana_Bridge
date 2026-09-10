// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Original project DKG metadata. This does not alter the pinned FROST primitive.
import { REGTEST_GENESIS } from "../../node/native-raw-evidence.mjs";
import { REQUIRED_FROST_SIGNERS, REQUIRED_FROST_THRESHOLD, assertHashHex,
  assertNativeFrostRuntimePolicy, canonicalJson, dataArray, dataRecord, sha256Canonical } from "./native-signing-policy.mjs";

const CONTEXT_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_KEY_CONTEXT/V2";
const DKG_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG/V2";
const CONTEXT_FIELDS = Object.freeze(["protocol", "environment", "nativeNetwork", "nativeGenesisHash",
  "solanaDeployment", "bridgeProgramId", "transceiverProgramId", "mint", "keyEpoch"]);
const REQUEST_FIELDS = Object.freeze(["protocol", "epoch", "context", "contextDigest", "sessionId",
  "participantSetHash", "threshold", "participants"]);
const PARTICIPANTS = Object.freeze(REQUIRED_FROST_SIGNERS.map((signerId, index) => Object.freeze({ signerId, index })));

function fields(value, expected, label) {
  const record = dataRecord(value, label);
  const keys = Object.keys(record);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) throw new Error(`${label}Fields`);
  return record;
}

function epoch(value) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) throw new Error("FrostDkgEpoch");
  return value;
}

export function normalizeNativeFrostKeyContext(value) {
  const context = fields(value, CONTEXT_FIELDS, "FrostDkgContext");
  if (context.protocol !== CONTEXT_PROTOCOL || context.environment !== "localnet" || context.nativeNetwork !== "regtest" ||
      context.nativeGenesisHash !== REGTEST_GENESIS) throw new Error("FrostDkgLocalContextRequired");
  return Object.freeze({ protocol: CONTEXT_PROTOCOL, environment: "localnet", nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: assertHashHex(context.solanaDeployment, "DKG deployment"),
    bridgeProgramId: assertHashHex(context.bridgeProgramId, "DKG bridge program"),
    transceiverProgramId: assertHashHex(context.transceiverProgramId, "DKG transceiver program"),
    mint: assertHashHex(context.mint, "DKG mint"), keyEpoch: epoch(context.keyEpoch) });
}

export function nativeFrostKeyContext(policy) {
  assertNativeFrostRuntimePolicy(policy);
  return normalizeNativeFrostKeyContext({ protocol: CONTEXT_PROTOCOL, environment: policy.environment,
    nativeNetwork: policy.nativeNetwork, nativeGenesisHash: policy.nativeGenesisHash, solanaDeployment: policy.solanaDeployment,
    bridgeProgramId: policy.bridgeProgramId, transceiverProgramId: policy.transceiverProgramId,
    mint: policy.mint, keyEpoch: policy.keyEpoch });
}

export function sameNativeFrostKeyDeployment(left, right) {
  const a = normalizeNativeFrostKeyContext(left);
  const b = normalizeNativeFrostKeyContext(right);
  return CONTEXT_FIELDS.every((field) => field === "keyEpoch" || a[field] === b[field]);
}

export function createTwoPartyDkgRequest(options) {
  const value = fields(options, ["epoch", "context"], "FrostDkgOptions");
  const context = normalizeNativeFrostKeyContext(value.context);
  if (epoch(value.epoch) !== context.keyEpoch) throw new Error("FrostDkgEpochMismatch");
  const contextDigest = sha256Canonical(context);
  const participantSetHash = sha256Canonical({ protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_PARTICIPANT_SET/V2",
    participants: PARTICIPANTS, threshold: REQUIRED_FROST_THRESHOLD });
  const sessionId = sha256Canonical({ protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG_SESSION/V2",
    epoch: context.keyEpoch, contextDigest, participantSetHash, threshold: REQUIRED_FROST_THRESHOLD });
  return Object.freeze({ protocol: DKG_PROTOCOL, epoch: context.keyEpoch, context, contextDigest, sessionId,
    participantSetHash, threshold: REQUIRED_FROST_THRESHOLD, participants: PARTICIPANTS });
}

export function validateNativeFrostDkgRequest(request, expectedContext) {
  const value = fields(request, REQUEST_FIELDS, "FrostDkgRequest");
  const context = normalizeNativeFrostKeyContext(value.context);
  const expected = createTwoPartyDkgRequest({ epoch: context.keyEpoch, context: expectedContext });
  if (canonicalJson(context) !== canonicalJson(expected.context)) throw new Error("FrostDkgContextMismatch");
  for (const field of REQUEST_FIELDS) {
    if (field !== "context" && field !== "participants" && value[field] !== expected[field]) {
      throw new Error(`FrostDkgBinding:${field}`);
    }
  }
  const participants = dataArray(value.participants, PARTICIPANTS.length, "FrostDkgParticipants");
  if (participants.length !== PARTICIPANTS.length) throw new Error("FrostDkgParticipants");
  for (let i = 0; i < participants.length; i += 1) {
    const participant = fields(participants[i], ["signerId", "index"], "FrostDkgParticipant");
    if (participant.signerId !== PARTICIPANTS[i].signerId || participant.index !== i) throw new Error("FrostDkgParticipants");
  }
  return expected;
}
