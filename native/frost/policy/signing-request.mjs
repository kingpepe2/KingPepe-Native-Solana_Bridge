// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Project request metadata only. The Native signing message remains the exact
// independently validated Taproot sighash, not a project/session digest.
import { REQUIRED_FROST_SIGNERS, dataArray, dataRecord, nativeSigningIntentDigest,
  sha256Canonical, validateNativeSigningIntent } from "./native-signing-policy.mjs";

const REQUEST_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_REQUEST/V1";
const SESSION_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SESSION/V1";
const FIELDS = Object.freeze(["protocol", "requestId", "epoch", "attempt", "sessionId",
  "intent", "intentDigest", "messageHex", "participantIds"]);
const ABORT_FIELDS = Object.freeze(["protocol", "signerId", "requestId", "epoch", "sessionId",
  "intentDigest", "messageHex", "state"]);
const ABORT_STATES = Object.freeze(["NOT_RESERVED", "ABORTED", "SIGNED"]);

export function createNativeFrostSigningRequest(intent, options = {}) {
  const snapshot = validateNativeSigningIntent(intent);
  const values = dataRecord(options, "FROST request options");
  if (Object.keys(values).some((key) => key !== "attempt")) throw new Error("FrostRequestFields");
  const attempt = Object.hasOwn(values, "attempt") ? values.attempt : 1;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 0xffff_ffff) throw new Error("FrostRequestAttempt");
  const transcript = Object.freeze({ requestId: snapshot.signingRequestId, epoch: snapshot.keyEpoch,
    attempt, intentDigest: nativeSigningIntentDigest(snapshot), messageHex: snapshot.taprootSighashHex,
    participantIds: REQUIRED_FROST_SIGNERS });
  return Object.freeze({ protocol: REQUEST_PROTOCOL, ...transcript,
    sessionId: sha256Canonical({ protocol: SESSION_PROTOCOL, ...transcript }), intent: snapshot });
}

export function validateNativeFrostSigningRequest(request) {
  const values = dataRecord(request, "FROST request");
  const keys = Object.keys(values);
  if (keys.length !== FIELDS.length || keys.some((key) => !FIELDS.includes(key))) throw new Error("FrostRequestFields");
  // A missing/null attempt is invalid on the wire, even though construction
  // may deliberately use a default for an omitted options object.
  if (!Number.isInteger(values.attempt) || values.attempt < 1 || values.attempt > 0xffff_ffff) {
    throw new Error("FrostRequestAttempt");
  }
  const expected = createNativeFrostSigningRequest(values.intent, { attempt: values.attempt });
  for (const field of FIELDS) {
    if (field !== "intent" && field !== "participantIds" && values[field] !== expected[field]) {
      throw new Error(`FrostRequestBinding:${field}`);
    }
  }
  const participants = dataArray(values.participantIds, REQUIRED_FROST_SIGNERS.length, "FROST participants");
  if (participants.length !== REQUIRED_FROST_SIGNERS.length ||
      participants.some((role, index) => role !== REQUIRED_FROST_SIGNERS[index])) throw new Error("FrostRequestParticipants");
  return expected;
}

// A local API receipt, not an attestation that an untrusted remote store is safe.
export function createNativeFrostAbortReceipt(request, signerId, state) {
  const snapshot = validateNativeFrostSigningRequest(request);
  if (!REQUIRED_FROST_SIGNERS.includes(signerId) || !ABORT_STATES.includes(state)) {
    throw new Error("FrostAbortReceiptValue");
  }
  return Object.freeze({ protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_ABORT_RECEIPT/V1", signerId,
    requestId: snapshot.requestId, epoch: snapshot.epoch, sessionId: snapshot.sessionId,
    intentDigest: snapshot.intentDigest, messageHex: snapshot.messageHex, state });
}

export function validateNativeFrostAbortReceipt(receipt, request, signerId) {
  const value = dataRecord(receipt, "FrostAbortReceipt");
  const keys = Object.keys(value);
  if (keys.length !== ABORT_FIELDS.length || keys.some(key => !ABORT_FIELDS.includes(key))) {
    throw new Error("FrostAbortReceiptFields");
  }
  const expected = createNativeFrostAbortReceipt(request, signerId, value.state);
  if (ABORT_FIELDS.some(field => value[field] !== expected[field])) throw new Error("FrostAbortReceiptBinding");
  return expected;
}
