// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Original local DKG input binding; not authenticated peer transport.
import { schnorr_FROST } from "@noble/curves/secp256k1.js";
import { dataArray, dataRecord, sha256Canonical } from "./native-signing-policy.mjs";

function fields(value, names, label) {
  const record = dataRecord(value, label);
  const keys = Object.keys(record);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) throw new Error(`${label}Fields`);
  return record;
}

function hex(value, expression, label) {
  if (typeof value !== "string" || !expression.test(value)) throw new Error(`${label}Encoding`);
  return value;
}

export function normalizeDkgRound1(value, identifier) {
  const raw = fields(value, ["identifier", "commitmentsHex", "proofOfKnowledgeHex"], "FrostDkgRound1");
  if (raw.identifier !== identifier) throw new Error("FrostDkgRound1Identifier");
  const commitments = dataArray(raw.commitmentsHex, 2, "FrostDkgCommitments");
  if (commitments.length !== 2) throw new Error("FrostDkgCommitmentsCount");
  // Exact encoding of the pinned Taproot-compatible primitive, not another suite.
  return Object.freeze({ identifier,
    commitmentsHex: Object.freeze(commitments.map(value => hex(value, /^(02|03)[0-9a-f]{64}$/u, "FrostDkgCommitment"))),
    proofOfKnowledgeHex: hex(raw.proofOfKnowledgeHex, /^[0-9a-f]{128}$/u, "FrostDkgProof") });
}

export function validateDkgRound1Set(request, input) {
  const messages = dataArray(input, 2, "FrostDkgRound1Set");
  if (messages.length !== 2) throw new Error("FrostDkgRound1SetCount");
  const byId = new Map();
  for (const message of messages) {
    const raw = fields(message, ["signerId", "round1"], "FrostDkgRound1Envelope");
    const participant = request.participants.find(p => p.signerId === raw.signerId);
    if (participant === undefined || byId.has(raw.signerId)) throw new Error("FrostDkgRound1Participant");
    byId.set(raw.signerId, normalizeDkgRound1(raw.round1, schnorr_FROST.Identifier.fromNumber(participant.index + 1)));
  }
  return Object.freeze(request.participants.map(p => byId.get(p.signerId)));
}

export function validateDkgRound2Set(request, signerId, input) {
  const messages = dataArray(input, 1, "FrostDkgRound2Set");
  if (messages.length !== 1) throw new Error("FrostDkgRound2SetCount");
  const raw = fields(messages[0], ["senderId", "round2"], "FrostDkgRound2Envelope");
  const peer = request.participants.find(p => p.signerId !== signerId);
  if (peer === undefined || raw.senderId !== peer.signerId) throw new Error("FrostDkgRound2Sender");
  const value = fields(raw.round2, ["identifier", "signingShareHex"], "FrostDkgRound2");
  const identifier = schnorr_FROST.Identifier.fromNumber(peer.index + 1);
  if (value.identifier !== identifier) throw new Error("FrostDkgRound2Identifier");
  return Object.freeze([Object.freeze({ senderId: peer.signerId, round2: Object.freeze({ identifier,
    signingShareHex: hex(value.signingShareHex, /^[0-9a-f]{64}$/u, "FrostDkgContribution") }) })]);
}

export function dkgFinalizationDigest(request, signerId, round1, incoming) {
  // The incoming scalar is private. This hash is retained locally for exact
  // retry comparison; neither the scalar nor this runtime record is published.
  return sha256Canonical({ protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG_HANDOFF/V1",
    request, signerId, round1, incoming });
}
