import { schnorr, schnorr_FROST } from "@noble/curves/secp256k1.js";
import {
  REQUIRED_FROST_SIGNERS,
  REQUIRED_FROST_THRESHOLD,
  assertHashHex,
  bytesToHex,
  canonicalJson,
  dataRecord,
  hexToBytes,
  validateNativeSigningIntent,
} from "../policy/native-signing-policy.mjs";
import { createNativeFrostSigningRequest, validateNativeFrostAbortReceipt } from "../policy/signing-request.mjs";
import { createTwoPartyDkgRequest, normalizeNativeFrostKeyContext } from "../policy/dkg-request.mjs";
import { deserializeFrostPublic } from "../signer/native-frost-signer.mjs";
import { ProtectedRemoteFrostPeer } from "../signer/protected-service.mjs";

export { createTwoPartyDkgRequest } from "../policy/dkg-request.mjs";

export function runTwoPartyDkg(signers, options) {
  options = dataRecord(options, "FrostDkgCoordinatorOptions");
  if (Object.keys(options).length !== 1 || !Object.hasOwn(options, "epoch")) throw new Error("FrostDkgCoordinatorOptionsFields");
  if (signers.length !== REQUIRED_FROST_SIGNERS.length) throw new Error("FROST DKG requires A+B signers");
  const byId = signerMap(signers);
  const contexts = REQUIRED_FROST_SIGNERS.map((id) => normalizeNativeFrostKeyContext(byId.get(id).dkgContext()));
  if (canonicalJson(contexts[0]) !== canonicalJson(contexts[1])) throw new Error("FrostDkgParticipantContextMismatch");
  const request = createTwoPartyDkgRequest({ epoch: options.epoch, context: contexts[0] });
  const phases = request.participants.map(p => byId.get(p.signerId).dkgPhase(request));
  if (phases.some(phase => !["NOT_STARTED", "ROUND1", "ROUND2", "STAGED", "FINALIZED"].includes(phase))) throw new Error("FrostDkgPhaseInvalid");
  const ready = phases.every(phase => ["STAGED", "FINALIZED"].includes(phase));
  if (phases.includes("FINALIZED") && !ready) throw new Error("FrostDkgIncompleteHandoffRecovery");
  if (!ready) {
    const round1 = request.participants.map(p => byId.get(p.signerId).dkgRound1(request));
    const round2BySender = new Map(request.participants.map(p => [p.signerId, byId.get(p.signerId).dkgRound2(request, round1)]));
    // Persist the verified incoming contribution at BOTH recipients before
    // finalization destroys either participant's previous DKG material.
    for (const participant of request.participants) {
      const incoming = request.participants.filter(peer => peer.signerId !== participant.signerId)
        .map(peer => ({ senderId: peer.signerId, round2: round2BySender.get(peer.signerId)[participant.signerId] }));
      byId.get(participant.signerId).dkgStageRound2(request, round1, incoming);
    }
  }
  const completions = request.participants.map(p => byId.get(p.signerId).dkgCompleteStaged(request));
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
  #hardStop = false;
  #coordinating = false;

  constructor(options) {
    this.#signers = signerMap(options.signers);
    this.#publicPackage = options.publicPackage;
    this.#aggregateTweakedXOnlyPublicKey = assertHashHex(options.aggregateTweakedXOnlyPublicKey, "FROST aggregate x-only public key");
  }

  signersOnline() {
    return REQUIRED_FROST_SIGNERS.map((signerId) => ({ signerId, online: this.#signers.get(signerId)?.isAvailable() === true }));
  }

  async signAutomaticallyWithNativeEvidence(intent) {
    this.#requireReady();
    const snapshot = validateNativeSigningIntent(intent);
    // Verification executes in each participant's configured boundary; a
    // coordinator assertion cannot populate either participant's private fence.
    for (const signerId of REQUIRED_FROST_SIGNERS) {
      await this.#signers.get(signerId).verifyNativeEvidence(structuredClone(snapshot));
    }
    return this.signAutomatically(snapshot);
  }

  async signAutomaticallyOverIpc(intent, options = {}) {
    this.#requireReady();
    const request = createNativeFrostSigningRequest(intent, options);
    const signers = REQUIRED_FROST_SIGNERS.map(id => this.#signers.get(id));
    if (!signers.every(signer => signer instanceof ProtectedRemoteFrostPeer)) throw new Error("ProtectedRemoteSignersRequired");
    this.#coordinating = true;
    try {
      for (const signer of signers) await signer.verifyNativeEvidence(structuredClone(request.intent));
      const commitments = [];
      for (const signer of signers) commitments.push(await signer.signingCommitment(request));
      validateCommitmentEnvelopes(request, commitments);
      const shares = [];
      for (const signer of signers) shares.push(await signer.signatureShare(request, commitments));
      return this.#aggregate(request, commitments, shares);
    } catch (error) {
      let confirmed = true;
      for (const signer of signers) {
        try { validateNativeFrostAbortReceipt(await signer.abortSigningSession(request), request, signer.signerId); }
        catch { confirmed = false; }
      }
      if (!confirmed) this.#hardStop = true;
      throw error;
    } finally { this.#coordinating = false; }
  }

  signAutomatically(intent, options = {}) {
    this.#requireReady();
    const request = createNativeFrostSigningRequest(intent, options);
    const { requestId, intentDigest, messageHex, participantIds } = request;
    const existing = this.#completed.get(requestId);
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

    this.#coordinating = true;
    try {
      return this.#signRequest(request);
    } catch (error) {
      let confirmed = true;
      // A response may be lost after persistence. Always contact both selected
      // participants, including one whose commitment/share call threw.
      for (const signerId of participantIds) {
        try {
          const receipt = this.#signers.get(signerId).abortSigningSession(request);
          validateNativeFrostAbortReceipt(receipt, request, signerId);
        } catch { confirmed = false; }
      }
      if (!confirmed) {
        // Absorbing for this instance; durable service-wide fencing is separate.
        // Do not expose underlying storage/transport error text or private paths.
        this.#hardStop = true;
        throw new Error("FrostCoordinatorAbortIncomplete");
      }
      throw error;
    } finally { this.#coordinating = false; }
  }

  #requireReady() {
    if (this.#hardStop) throw new Error("FrostCoordinatorHardStop");
    if (this.#coordinating) throw new Error("FrostCoordinatorBusy");
  }

  #signRequest(request) {
    const { participantIds } = request;
    const signers = participantIds.map((signerId) => this.#signers.get(signerId));
    const commitments = signers.map((signer) => signer.signingCommitment(request));
    validateCommitmentEnvelopes(request, commitments);

    const shareEnvelopes = signers.map((signer) => signer.signatureShare(request, commitments));
    return this.#aggregate(request, commitments, shareEnvelopes);
  }

  #aggregate(request, commitments, shareEnvelopes) {
    const { requestId, intentDigest, messageHex, participantIds } = request;
    validateCommitmentEnvelopes(request, commitments);
    if (shareEnvelopes.length !== 2 || new Set(shareEnvelopes.map(s => s.signerId)).size !== 2) throw new Error("FrostShareParticipantSetRejected");
    const publicPackage = deserializeFrostPublic(this.#publicPackage);
    const nativeCommitments = commitments.map((entry) => deserializeCommitment(entry.commitment));
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
      epoch: request.epoch,
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
  if (Array.isArray(signers) && signers.length < REQUIRED_FROST_SIGNERS.length) {
    throw new Error("missing required FROST signer");
  }
  if (!Array.isArray(signers) || signers.length !== REQUIRED_FROST_SIGNERS.length) {
    throw new Error("FROST participant set must remain exactly A+B");
  }
  const map = new Map();
  for (const signer of signers) {
    if (!REQUIRED_FROST_SIGNERS.includes(signer?.signerId)) throw new Error("unknown FROST signer");
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
