import { schnorr, schnorr_FROST } from "@noble/curves/secp256k1.js";
import {
  REQUIRED_FROST_SIGNERS,
  REQUIRED_FROST_THRESHOLD,
  assertHashHex,
  bytesToHex,
  canonicalJson,
  hexToBytes,
  nativeSigningIntentDigest,
  sha256Canonical,
} from "../policy/native-signing-policy.mjs";
import { deserializeFrostPublic } from "../signer/native-frost-signer.mjs";

export function createTwoPartyDkgRequest(options) {
  const participants = [
    { signerId: REQUIRED_FROST_SIGNERS[0], index: 0 },
    { signerId: REQUIRED_FROST_SIGNERS[1], index: 1 },
  ];
  const participantSetHash = sha256Canonical({
    protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_PARTICIPANT_SET/V1",
    participants,
    threshold: REQUIRED_FROST_THRESHOLD,
  });
  const epoch = options.epoch;
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error("invalid DKG epoch");
  return Object.freeze({
    protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG/V1",
    epoch,
    sessionId: sha256Canonical({
      protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG_SESSION/V1",
      epoch,
      participantSetHash,
      threshold: REQUIRED_FROST_THRESHOLD,
    }),
    participantSetHash,
    threshold: REQUIRED_FROST_THRESHOLD,
    participants,
  });
}

export function runTwoPartyDkg(signers, options) {
  if (signers.length !== REQUIRED_FROST_SIGNERS.length) throw new Error("FROST DKG requires A+B signers");
  const byId = signerMap(signers);
  const request = createTwoPartyDkgRequest(options);
  const round1 = request.participants.map((participant) => byId.get(participant.signerId).dkgRound1(request));
  const round2BySender = new Map(
    request.participants.map((participant) => [participant.signerId, byId.get(participant.signerId).dkgRound2(request, round1)]),
  );
  const completions = request.participants.map((participant) => {
    const incoming = request.participants
      .filter((peer) => peer.signerId !== participant.signerId)
      .map((peer) => ({ senderId: peer.signerId, round2: round2BySender.get(peer.signerId)[participant.signerId] }));
    return byId.get(participant.signerId).dkgFinalize(request, round1, incoming);
  });
  const [first, second] = completions;
  if (canonicalJson(first.publicPackage) !== canonicalJson(second.publicPackage)) throw new Error("FROST public packages disagree");
  if (first.aggregateTweakedXOnlyPublicKey !== second.aggregateTweakedXOnlyPublicKey) throw new Error("FROST aggregate keys disagree");
  return Object.freeze({
    request,
    publicPackage: first.publicPackage,
    publicPackageHash: first.publicPackageHash,
    aggregateTweakedXOnlyPublicKey: first.aggregateTweakedXOnlyPublicKey,
    completions,
  });
}

export class NativeFrostCoordinator {
  #signers;
  #publicPackage;
  #aggregateTweakedXOnlyPublicKey;
  #completed = new Map();

  constructor(options) {
    this.#signers = signerMap(options.signers);
    this.#publicPackage = options.publicPackage;
    this.#aggregateTweakedXOnlyPublicKey = assertHashHex(options.aggregateTweakedXOnlyPublicKey, "FROST aggregate x-only public key");
  }

  signersOnline() {
    return REQUIRED_FROST_SIGNERS.map((signerId) => ({ signerId, online: this.#signers.get(signerId)?.isAvailable() === true }));
  }

  async signAutomaticallyWithNativeEvidence(intent) {
    const snapshot = structuredClone(intent);
    // Verification executes in each participant's configured boundary; a
    // coordinator assertion cannot populate either participant's private fence.
    for (const signerId of REQUIRED_FROST_SIGNERS) {
      await this.#signers.get(signerId).verifyNativeEvidence(structuredClone(snapshot));
    }
    return this.signAutomatically(snapshot);
  }

  signAutomatically(intent, options = {}) {
    const requestId = assertHashHex(intent.signingRequestId, "FROST signing request ID");
    const existing = this.#completed.get(requestId);
    const intentDigest = nativeSigningIntentDigest(intent);
    const messageHex = intent.taprootSighashHex.toLowerCase();
    if (existing !== undefined) {
      if (existing.intentDigest !== intentDigest || existing.messageHex !== messageHex) {
        throw new Error("completed FROST request replayed with altered message");
      }
      return structuredClone(existing);
    }

    const available = REQUIRED_FROST_SIGNERS.filter((signerId) => this.#signers.get(signerId)?.isAvailable() === true);
    if (available.length < REQUIRED_FROST_THRESHOLD) {
      return Object.freeze({
        state: "WAITING_FOR_QUORUM",
        requestId,
        available: available.length,
        required: REQUIRED_FROST_THRESHOLD,
      });
    }
    if (available.length !== REQUIRED_FROST_SIGNERS.length) throw new Error("FROST participant set must remain exactly A+B");

    const attempt = options.attempt ?? 1;
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("invalid FROST signing attempt");
    const participantIds = [...REQUIRED_FROST_SIGNERS];
    const request = Object.freeze({
      protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_REQUEST/V1",
      requestId,
      epoch: intent.keyEpoch,
      attempt,
      sessionId: sha256Canonical({
        protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SESSION/V1",
        requestId,
        epoch: intent.keyEpoch,
        attempt,
        intentDigest,
        messageHex,
        participantIds,
      }),
      intent: structuredClone(intent),
      intentDigest,
      messageHex,
      participantIds,
    });

    const signers = participantIds.map((signerId) => this.#signers.get(signerId));
    const commitments = signers.map((signer) => signer.signingCommitment(request));
    validateCommitmentEnvelopes(request, commitments);

    const publicPackage = deserializeFrostPublic(this.#publicPackage);
    const nativeCommitments = commitments.map((entry) => deserializeCommitment(entry.commitment));
    const shareEnvelopes = signers.map((signer) => signer.signatureShare(request, commitments));
    const validShares = {};
    for (const envelope of shareEnvelopes) {
      validateShareEnvelope(request, envelope);
      const participantIndex = REQUIRED_FROST_SIGNERS.indexOf(envelope.signerId);
      const identifier = schnorr_FROST.Identifier.fromNumber(participantIndex + 1);
      if (envelope.share.identifier !== identifier) throw new Error("FROST share identifier mismatch");
      const share = hexToBytes(envelope.share.shareHex, "FROST signature share");
      if (!schnorr_FROST.verifyShare(publicPackage, nativeCommitments, hexToBytes(messageHex, "Taproot sighash"), identifier, share)) {
        throw new Error("FROST share failed verification");
      }
      validShares[identifier] = share;
    }
    if (Object.keys(validShares).length !== REQUIRED_FROST_THRESHOLD) throw new Error("FROST threshold was not met");

    const aggregateSignature = schnorr_FROST.aggregate(
      publicPackage,
      nativeCommitments,
      hexToBytes(messageHex, "Taproot sighash"),
      validShares,
    );
    const aggregateSignatureHex = bytesToHex(aggregateSignature);
    if (!schnorr_FROST.verify(aggregateSignature, hexToBytes(messageHex, "Taproot sighash"), hexToBytes(this.#aggregateTweakedXOnlyPublicKey, "x-only key"))) {
      throw new Error("FROST aggregate failed ciphersuite verification");
    }
    if (!schnorr.verify(aggregateSignature, hexToBytes(messageHex, "Taproot sighash"), hexToBytes(this.#aggregateTweakedXOnlyPublicKey, "x-only key"))) {
      throw new Error("FROST aggregate failed independent BIP340 verification");
    }

    const success = Object.freeze({
      state: "SIGNED",
      requestId,
      epoch: intent.keyEpoch,
      sessionId: request.sessionId,
      intentDigest,
      messageHex,
      signatureHex: aggregateSignatureHex,
      aggregateTweakedXOnlyPublicKey: this.#aggregateTweakedXOnlyPublicKey,
      signerIds: participantIds,
      participantIdentifiers: participantIds.map((_, index) => schnorr_FROST.Identifier.fromNumber(index + 1)),
    });
    this.#completed.set(requestId, success);
    return structuredClone(success);
  }
}

function signerMap(signers) {
  const map = new Map();
  for (const signer of signers) {
    if (map.has(signer.signerId)) throw new Error("duplicate FROST signer");
    map.set(signer.signerId, signer);
  }
  for (const signerId of REQUIRED_FROST_SIGNERS) {
    if (!map.has(signerId)) throw new Error("missing required FROST signer");
  }
  return map;
}

function validateCommitmentEnvelopes(request, envelopes) {
  if (envelopes.length !== REQUIRED_FROST_SIGNERS.length) throw new Error("missing FROST commitment");
  const seen = new Set();
  for (const envelope of envelopes) {
    if (envelope.protocol !== "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_COMMITMENT/V1") throw new Error("wrong FROST commitment protocol");
    if (seen.has(envelope.signerId)) throw new Error("duplicate FROST commitment");
    seen.add(envelope.signerId);
    if (!REQUIRED_FROST_SIGNERS.includes(envelope.signerId)) throw new Error("unknown FROST commitment signer");
    if (envelope.requestId !== request.requestId || envelope.epoch !== request.epoch || envelope.sessionId !== request.sessionId) {
      throw new Error("FROST commitment domain mismatch");
    }
  }
}

function validateShareEnvelope(request, envelope) {
  if (envelope.protocol !== "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SHARE/V1") throw new Error("wrong FROST share protocol");
  if (!REQUIRED_FROST_SIGNERS.includes(envelope.signerId)) throw new Error("unknown FROST share signer");
  if (envelope.requestId !== request.requestId || envelope.epoch !== request.epoch || envelope.sessionId !== request.sessionId) {
    throw new Error("FROST share domain mismatch");
  }
  if (envelope.share.intentDigest !== request.intentDigest || envelope.share.messageHex !== request.messageHex) {
    throw new Error("FROST share transcript mismatch");
  }
}

function deserializeCommitment(value) {
  return {
    identifier: value.identifier,
    hiding: hexToBytes(value.hidingHex, "FROST hiding commitment"),
    binding: hexToBytes(value.bindingHex, "FROST binding commitment"),
  };
}
