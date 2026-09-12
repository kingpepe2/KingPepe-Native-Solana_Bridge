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
import { isProtectedRemoteFrostPeer } from "../signer/protected-service.mjs";
import { requireIntegrityGuard } from "../../../services/supervisor/protected-integrity.mjs";
import { requireCoordinatorSigningJournal } from "./protected-signing-journal.mjs";
import { AuthenticatedLocalDepositLedger } from "../../../services/bridge-validator/local-deposit-ledger.mjs";

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
  #integrity;
  #signingJournal;
  #localJournal;

  constructor(options) {
    this.#integrity = options.integrity;
    this.#signingJournal = options.signingJournal;
    this.#signers = signerMap(options.signers);
    this.#publicPackage = structuredClone(options.publicPackage);
    this.#aggregateTweakedXOnlyPublicKey = assertHashHex(options.aggregateTweakedXOnlyPublicKey, "FROST aggregate x-only public key");
  }

  signersOnline() {
    return REQUIRED_FROST_SIGNERS.map((signerId) => ({ signerId, online: this.#signers.get(signerId)?.isAvailable() === true }));
  }

  useLocalOperationJournal(ledger) {
    this.#requireReady();
    if (!(ledger instanceof AuthenticatedLocalDepositLedger)) throw new Error("FrostLocalOperationJournalRequired");
    // Protected IPC peers keep their existing protected journal. The plain
    // localnet path retains public attempts in the service's existing SQLite.
    if ([...this.#signers.values()].some(isProtectedRemoteFrostPeer)) return;
    this.#localJournal = ledger.nativeSigningJournal({ publicPackage: this.#publicPackage,
      aggregateTweakedXOnlyPublicKey: this.#aggregateTweakedXOnlyPublicKey });
  }

  async signAutomaticallyWithNativeEvidence(intent) {
    this.#requireReady();
    const remote = [...this.#signers.values()].map(isProtectedRemoteFrostPeer);
    if (remote.some(Boolean)) {
      if (!remote.every(Boolean)) throw new Error("FrostMixedTransportRejected");
      // The same bridge API supports authenticated peers. A transport failure
      // must never fall through to local signing or discard its durable journal.
      return this.signAutomaticallyOverIpc(intent);
    }
    const snapshot = validateNativeSigningIntent(intent);
    if (this.#localJournal) return this.#signLocallyWithJournal(snapshot);
    // Verification executes in each participant's configured boundary; a
    // coordinator assertion cannot populate either participant's private fence.
    for (const signerId of REQUIRED_FROST_SIGNERS) {
      await this.#signers.get(signerId).verifyNativeEvidence(structuredClone(snapshot));
    }
    return this.signAutomatically(snapshot);
  }

  async #signLocallyWithJournal(snapshot) {
    const journal = this.#localJournal, signers = REQUIRED_FROST_SIGNERS.map(id => this.#signers.get(id));
    this.#coordinating = true;
    try { return await journal.runExclusive(async () => {
      const abort = async request => {
        const receipts = [];
        for (const signer of signers) {
          try { receipts.push(validateNativeFrostAbortReceipt(await signer.abortSigningSession(request), request, signer.signerId)); }
          catch { receipts.push(null); }
        }
        if (receipts.some(r => r === null)) throw new Error("FrostCoordinatorAbortIncomplete");
        journal.markAborted(request, receipts);
      };
      let request;
      try {
        const retained = journal.lookup(snapshot);
        if (retained?.state === "SIGNED") return journal.retainedResult(snapshot);
        if (retained?.state === "PREPARED") await abort(retained.request);
        for (const signer of signers) await signer.verifyNativeEvidence(structuredClone(snapshot));
        request = journal.prepare(snapshot); // Persist before either nonce is reserved.
        const commitments = [];
        for (const signer of signers) commitments.push(await signer.signingCommitment(request));
        validateCommitmentEnvelopes(request, commitments);
        const shares = [];
        for (const signer of signers) shares.push(await signer.signatureShare(request, commitments));
        const result = this.#aggregate(request, commitments, shares);
        journal.markSigned(request, result); return journal.retainedResult(snapshot);
      } catch (error) {
        if (request && journal.lookup(snapshot)?.state === "PREPARED") await abort(request);
        throw error;
      }
    }); } finally { this.#coordinating = false; }
  }

  async signAutomaticallyOverIpc(intent, options = {}) {
    this.#requireReady();
    requireIntegrityGuard(this.#integrity, "COORDINATOR");
    // Attempts are derived ONLY from the retained journal, never a caller reset.
    if (Object.keys(dataRecord(options, "FROST protected options")).length !== 0) throw new Error("ProtectedFrostAttemptManagedDurably");
    const snapshot = validateNativeSigningIntent(intent);
    this.#integrity.assertDeployment({ environment: "localnet", nativeGenesis: snapshot.nativeGenesisHash,
      solanaDeployment: snapshot.solanaDeployment, keyEpoch: snapshot.keyEpoch });
    const journal = this.#signingJournal;
    requireCoordinatorSigningJournal(journal, { publicPackage: this.#publicPackage,
      aggregateTweakedXOnlyPublicKey: this.#aggregateTweakedXOnlyPublicKey }, this.#integrity);
    const signers = REQUIRED_FROST_SIGNERS.map(id => this.#signers.get(id));
    if (!signers.every(isProtectedRemoteFrostPeer)) throw new Error("ProtectedRemoteSignersRequired");
    this.#coordinating = true;
    try {
      return await journal.runExclusive(async () => {
        let request;
        const abort = async pending => {
          const receipts = [];
          // Contact BOTH even when the first transport fails. Unconfirmed
          // receipts retain PREPARED; no new attempt is permitted.
          for (const signer of signers) {
            try { receipts.push(validateNativeFrostAbortReceipt(await signer.abortSigningSession(pending), pending, signer.signerId)); }
            catch { receipts.push(null); }
          }
          if (receipts.some(r => r === null)) throw new Error("FrostCoordinatorAbortIncomplete");
          journal.markAborted(pending, receipts);
        };
        try {
          await this.#integrity.assertRunning(snapshot.operationId, "COORDINATE_SWEEP");
          const retained = journal.lookup(snapshot);
          if (retained?.state === "SIGNED") {
            // This is retrieval of an already-produced exact transaction
            // signature, NOT fresh signing. The relayer must still determine
            // the previous broadcast outcome before any external action.
            await this.#integrity.assertRunning(snapshot.operationId, "COORDINATE_SWEEP");
            return journal.retainedResult(snapshot); // Re-read and cryptographically verify after the await.
          }
          if (retained?.state === "PREPARED") { request = retained.request; await abort(request); request = undefined; }
          for (const signer of signers) await signer.verifyNativeEvidence(structuredClone(snapshot));
          await this.#integrity.assertRunning(snapshot.operationId, "COORDINATE_SWEEP");
          request = journal.prepare(snapshot);
          const commitments = [];
          for (const signer of signers) commitments.push(await signer.signingCommitment(request));
          validateCommitmentEnvelopes(request, commitments);
          const shares = [];
          for (const signer of signers) shares.push(await signer.signatureShare(request, commitments));
          const result = this.#aggregate(request, commitments, shares);
          journal.markSigned(request, result); // Persist BEFORE any result release.
          await this.#integrity.assertRunning(snapshot.operationId, "COORDINATE_SWEEP");
          return journal.retainedResult(snapshot);
        } catch (error) {
          // A lost protected-write response may have committed SIGNED. Never
          // replace that outcome with ABORTED or create a new signing attempt.
          if (request) {
            try { if (journal.lookup(snapshot)?.state === "PREPARED") await abort(request); }
            catch (recoveryError) {
              this.#hardStop = true;
              // Integrity errors reach the journal's durable global detector;
              // an unavailable abort is retained uncertainty, not contradiction.
              if (["ProtectedStateRollbackDetected", "CoordinatorJournalAuthenticatedStateInvalid"].includes(recoveryError?.message)) throw recoveryError;
            }
          }
          if (["FROST share failed verification", "FROST aggregate failed ciphersuite verification", "FROST aggregate failed independent BIP340 verification"].includes(error?.message)) {
            await this.#integrity.report(snapshot.operationId, "SIGNING_TRANSCRIPT_CONFLICT", request.intentDigest);
          }
          throw error;
        }
      });
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
