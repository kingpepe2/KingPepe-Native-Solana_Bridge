import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { schnorr_FROST } from "@noble/curves/secp256k1.js";
import {
  REQUIRED_FROST_SIGNERS,
  assertNativeSigningApproved,
  assertNativeSigningPolicy,
  assertNativeFrostRuntimePolicy,
  bytesToHex,
  canonicalJson,
  canonicalUintDecimal,
  hexToBytes,
  nativeSigningIntentDigest,
  sha256Canonical,
  validateNativeSigningIntent,
  dataRecord,
  dataArray,
} from "../policy/native-signing-policy.mjs";
import { createNativeFrostAbortReceipt, validateNativeFrostSigningRequest } from "../policy/signing-request.mjs";
import { createTwoPartyDkgRequest, nativeFrostKeyContext, sameNativeFrostKeyDeployment,
  validateNativeFrostDkgRequest } from "../policy/dkg-request.mjs";
import { assertFrostStateEnvelope } from "../state/file-state-store.mjs";
import { dkgFinalizationDigest, normalizeDkgRound1, validateDkgRound1Set,
  validateDkgRound2Set } from "../policy/dkg-messages.mjs";

function secureFrostRandomBytes(length = 32) {
  return Uint8Array.from(randomBytes(length));
}

// Matches the bounded plain-record parser. Retention is never auto-pruned.
const MAX_DKG_EPOCHS = 40;
const MAX_SIGNING_SESSIONS = 4096; // Local resource ceiling; records are never pruned automatically.

export class NativeFrostSigner {
  #policy;
  #stateStore;
  #available = true;
  #nativeEvidenceValidator;
  #validatedNativeIntents = new Map();
  #keyContext;
  #dkgRequest;
  #nonces = new Map();
  #closed = false;

  constructor(options) {
    options = dataRecord(options, "FrostSignerOptions");
    if (!REQUIRED_FROST_SIGNERS.includes(options.signerId)) throw new Error("unsupported KingPepe FROST signer ID");
    if (!Number.isSafeInteger(options.index) || options.index < 0 || options.index > 1) throw new Error("invalid FROST signer index");
    if (REQUIRED_FROST_SIGNERS[options.index] !== options.signerId) throw new Error("FrostSignerRoleIndexMismatch");
    Object.defineProperties(this, { signerId: { value: options.signerId, enumerable: true },
      index: { value: options.index, enumerable: true } });
    this.#policy = assertNativeFrostRuntimePolicy(options.policy);
    this.#keyContext = nativeFrostKeyContext(this.#policy);
    this.#dkgRequest = createTwoPartyDkgRequest({ epoch: this.#keyContext.keyEpoch, context: this.#keyContext });
    this.#stateStore = options.stateStore;
    if (options.nativeEvidenceValidator !== undefined && typeof options.nativeEvidenceValidator !== "function") {
      throw new Error("FROST native evidence validator must be a function");
    }
    this.#nativeEvidenceValidator = options.nativeEvidenceValidator;
    const state = this.#stateStore.load();
    if (state.signerId !== this.signerId) throw new Error("FROST signer state identity mismatch");
    this.#validateStateDeployment(state);
    this.#recoverUncertainNonces(state);
  }

  dkgContext() {
    return this.#keyContext;
  }

  frostIdentifier() {
    return schnorr_FROST.Identifier.fromNumber(this.index + 1);
  }

  setAvailableForTestOnly(available) {
    this.#available = available === true;
  }

  isAvailable() {
    return this.#available && !this.#closed;
  }

  close() {
    this.#closed = true;
    for (const id of this.#nonces.keys()) this.#discardNonce(id);
    this.#validatedNativeIntents.clear();
  }

  async verifyNativeEvidence(intent) {
    this.#requireAvailable();
    if (this.#nativeEvidenceValidator === undefined) throw new Error("FROST native evidence verifier required");
    const snapshot = validateNativeSigningIntent(intent);
    assertNativeSigningApproved(this.#policy, snapshot);
    const digest = nativeSigningIntentDigest(snapshot);
    this.#validatedNativeIntents.delete(digest);
    const result = await this.#nativeEvidenceValidator(structuredClone(snapshot));
    if (result?.digestHex !== snapshot.proofFingerprint) throw new Error("FROST Native evidence digest mismatch");
    // Local runtime freshness fence, not persistent rollback assurance.
    this.#validatedNativeIntents.clear();
    this.#validatedNativeIntents.set(digest, performance.now());
  }

  dkgRound1(request) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    const existing = state.dkg[request.sessionId];
    if (existing !== undefined) {
      assertSameCanonical(existing.request, request, "DKG round1 request changed");
      return { signerId: this.signerId, round1: existing.localRound1 };
    }
    if (Object.keys(state.dkg).length >= MAX_DKG_EPOCHS) throw new Error("FrostDkgStateCapacity");

    const generated = schnorr_FROST.DKG.round1(
      this.frostIdentifier(),
      { min: request.threshold, max: request.participants.length },
      undefined,
      secureFrostRandomBytes,
    );
    try {
      const localRound1 = serializeRound1(generated.public);
      state.dkg[request.sessionId] = { request: structuredClone(request),
        secret: serializeDkgSecret(generated.secret), localRound1 };
      this.#stateStore.save(state);
      return { signerId: this.signerId, round1: localRound1 };
    } finally { cleanDkgSecret(generated.secret); }
  }

  dkgRound2(request, round1Messages) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const accepted = validateDkgRound1Set(request, round1Messages);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    const session = requireDkgSession(state, request);
    this.#checkOwnRound1(session, accepted);
    if (session.acceptedRound1 !== undefined) {
      assertSameCanonical(session.acceptedRound1, accepted, "DKG round1 transcript changed after acceptance");
    }
    if (session.finalKey !== undefined) throw new Error("FrostDkgAlreadyFinalized");
    const secret = this.#checkedDkgSecret(session, session.acceptedRound1 === undefined ? 1 : 2);
    try {
      const remote = accepted.filter(entry => entry.identifier !== this.frostIdentifier()).map(deserializeRound1);
      let outgoing;
      try { outgoing = schnorr_FROST.DKG.round2(secret, remote); }
      catch { throw new Error("FrostDkgRound2ValidationFailed"); }
      const result = Object.fromEntries(request.participants.filter(p => p.signerId !== this.signerId).map(p => {
        const value = outgoing[schnorr_FROST.Identifier.fromNumber(p.index + 1)];
        if (value === undefined) throw new Error("FrostDkgReceiverMissing");
        return [p.signerId, serializeRound2(value)];
      }));
      session.secret = serializeDkgSecret(secret);
      session.acceptedRound1 = accepted;
      this.#stateStore.save(state);
      return result;
    } finally { cleanDkgSecret(secret); }
  }

  dkgStageRound2(request, round1Messages, incomingRound2) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const accepted = validateDkgRound1Set(request, round1Messages);
    const incoming = validateDkgRound2Set(request, this.signerId, incomingRound2);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    const session = requireDkgSession(state, request);
    this.#checkOwnRound1(session, accepted);
    assertSameCanonical(session.acceptedRound1, accepted, "DKG finalization requires the accepted round1 transcript");
    const digest = dkgFinalizationDigest(request, this.signerId, accepted, incoming);
    const phase = this.#dkgPhase(state, request);
    if (phase === "FINALIZED" || phase === "STAGED") {
      if (digest !== (session.finalizationDigest ?? session.stagedDigest)) throw new Error("FrostDkgTranscriptMismatch");
      return phase;
    }
    // Verify the exact contribution with the unchanged primitive before saving
    // the handoff. This temporary candidate is not activated or retained.
    const candidate = this.#deriveDkgKey(session, accepted, incoming);
    candidate.secret.signingShare.fill(0);
    const fresh = this.#unchangedDkgState(request, session);
    fresh.dkg[request.sessionId].stagedRound2 = structuredClone(incoming);
    fresh.dkg[request.sessionId].stagedDigest = digest;
    this.#stateStore.save(fresh);
    return "STAGED";
  }

  dkgPhase(request) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    return this.#dkgPhase(state, request);
  }

  dkgFinalize(request, round1Messages, incomingRound2) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const accepted = validateDkgRound1Set(request, round1Messages);
    const incoming = validateDkgRound2Set(request, this.signerId, incomingRound2);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    const session = requireDkgSession(state, request);
    this.#checkOwnRound1(session, accepted);
    assertSameCanonical(session.acceptedRound1, accepted, "FrostDkgTranscriptMismatch");
    const digest = dkgFinalizationDigest(request, this.signerId, accepted, incoming);
    if (digest !== (session.finalizationDigest ?? session.stagedDigest)) throw new Error("FrostDkgTranscriptMismatch");
    return this.#completeStagedDkg(state, request);
  }

  dkgCompleteStaged(request) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    return this.#completeStagedDkg(state, request);
  }

  signingCommitment(request) {
    this.#requireAvailable();
    request = validateNativeFrostSigningRequest(request);
    const { state, key } = this.#authorizeRequestWithKey(request);
    try {
      const existing = state.signing[request.sessionId];
      if (existing !== undefined) {
        assertSameSigningRequest(existing, request);
        validateNonceSessionState(state, existing, request, this.signerId, this.frostIdentifier());
        if (existing.state === "ABORTED") { this.#discardNonce(request.sessionId); throw new Error("FROST nonce was already burned"); }
        if (existing.state === "RESERVED") this.#reservedNonce(request.sessionId, existing);
        return commitmentEnvelope(this.signerId, request, existing.commitment);
      }
      if (this.#nonces.has(request.sessionId)) {
        this.#discardNonce(request.sessionId);
        throw new Error("FrostNonceStateChanged");
      }
      if (Object.keys(state.signing).length >= MAX_SIGNING_SESSIONS) throw new Error("FrostSigningStateCapacity");
      const counter = nextCounter(state.nonceReservationCounter);
      const generated = schnorr_FROST.commit(key.secret, secureFrostRandomBytes);
      let retained = false;
      try {
        const commitment = serializePublicNonceCommitment(generated.commitments, this.signerId, counter, request);
        state.nonceReservationCounter = counter;
        state.signing[request.sessionId] = {
          request: structuredClone(request),
          requestId: request.requestId, epoch: request.epoch, intentDigest: request.intentDigest,
          messageHex: request.messageHex, participantIds: [...request.participantIds],
          nonceReservationId: commitment.nonceReservationId, reservationCounter: counter,
          state: "RESERVED", commitment,
        };
        state.nonceTombstones[commitment.nonceReservationId] = {
          nonceReservationId: commitment.nonceReservationId, reservationCounter: counter,
          requestId: request.requestId, epoch: request.epoch, sessionId: request.sessionId,
          intentDigest: request.intentDigest, messageHex: request.messageHex,
          participantIds: [...request.participantIds], commitmentSha256: sha256Canonical(commitment), state: "RESERVED",
        };
        // Only public reservation metadata reaches the store. Secret nonce bytes
        // stay in this instance and are discarded if persistence is uncertain.
        this.#stateStore.save(state);
        const envelope = commitmentEnvelope(this.signerId, request, commitment);
        this.#nonces.set(request.sessionId, { nonces: generated.nonces, commitmentHash: sha256Canonical(commitment) });
        retained = true;
        return envelope;
      } finally { if (!retained) zeroNonce(generated.nonces); }
    } finally { key.secret.signingShare.fill(0); }
  }

  signatureShare(request, commitments) {
    this.#requireAvailable();
    request = validateNativeFrostSigningRequest(request);
    const { state, key } = this.#authorizeRequestWithKey(request);
    try {
      const session = state.signing[request.sessionId];
      if (session === undefined) throw new Error("signer has no reserved FROST nonce for session");
      assertSameSigningRequest(session, request);
      const tombstone = validateNonceSessionState(state, session, request, this.signerId, this.frostIdentifier());

      const commitmentPayloads = validateCommitmentSet(request, commitments);
      const commitmentSetHash = sha256Canonical(commitmentPayloads);
      if (session.state === "SIGNED") {
        if (session.commitmentSetHash !== commitmentSetHash || session.shareHex === undefined) {
          throw new Error("signed FROST session transcript changed");
        }
        return shareEnvelope(this.signerId, request, key.secret.identifier, session.shareHex, commitmentSetHash);
      }
      if (session.state !== "RESERVED") { this.#discardNonce(request.sessionId); throw new Error("FROST nonce is not available"); }
      const nonce = this.#reservedNonce(request.sessionId, session);
      // Remove before either persistent consumption or cryptographic computation.
      // Even a failed pre-sign write cannot make these bytes available again.
      this.#nonces.delete(request.sessionId);
      try {
        session.state = "ABORTED";
        tombstone.state = "CONSUMED";
        tombstone.outcome = "SHARE_COMPUTATION_STARTED";
        tombstone.commitmentSetHash = commitmentSetHash;
        this.#stateStore.save(state);

        const share = schnorr_FROST.signShare(key.secret, key.public, nonce,
          commitmentPayloads.map(deserializeCommitment), hexToBytes(request.messageHex, "FROST signing message"));
        try {
          const freshState = this.#stateStore.load();
          this.#validateStateDeployment(freshState);
          const freshSession = freshState.signing[request.sessionId];
          const freshTombstone = freshState.nonceTombstones[session.nonceReservationId];
          if (canonicalJson(freshSession) !== canonicalJson(session) || canonicalJson(freshTombstone) !== canonicalJson(tombstone)) {
            throw new Error("FrostNonceStateChanged");
          }
          freshSession.state = "SIGNED";
          freshSession.commitmentSetHash = commitmentSetHash;
          freshSession.shareHex = bytesToHex(share);
          freshTombstone.outcome = "SHARE_PERSISTED";
          freshTombstone.shareSha256 = sha256Canonical({ shareHex: freshSession.shareHex });
          this.#stateStore.save(freshState);
          return shareEnvelope(this.signerId, request, key.secret.identifier, freshSession.shareHex, commitmentSetHash);
        } finally { share.fill(0); }
      } finally { zeroNonce(nonce); }
    } finally { key.secret.signingShare.fill(0); }
  }

  abortSigningSession(request) {
    this.#requireAvailable();
    request = validateNativeFrostSigningRequest(request);
    this.#discardNonce(request.sessionId);
    const state = this.#stateStore.load();
    this.#validateStateDeployment(state);
    const session = state.signing[request.sessionId];
    const receipt = outcome => createNativeFrostAbortReceipt(request, this.signerId, outcome);
    if (session === undefined) return receipt("NOT_RESERVED");
    // Cancellation never enrolls/authorizes an operation or deserializes a key.
    // In particular, a later policy rejection must not prevent nonce destruction.
    assertSameSigningRequest(session, request);
    let tombstone;
    try { tombstone = validateNonceSessionState(state, session, request, this.signerId, this.frostIdentifier()); }
    catch { throw new Error("FrostAbortStateInvalid"); }
    if (session.state === "SIGNED" || session.state === "ABORTED") return receipt(session.state);
    session.state = "ABORTED";
    tombstone.state = "CONSUMED";
    tombstone.outcome = "ABORTED";
    this.#stateStore.save(state);
    return receipt("ABORTED");
  }

  #authorizeRequestWithKey(request) {
    assertNativeSigningPolicy(this.#policy);
    assertNativeSigningApproved(this.#policy, request.intent);
    const state = this.#stateStore.load();
    if (this.#nativeEvidenceValidator !== undefined) {
      const checkedAt = this.#validatedNativeIntents.get(request.intentDigest);
      if (checkedAt === undefined || performance.now() - checkedAt > 30_000) {
        throw new Error("FROST fresh independent Native evidence required");
      }
    }
    return { state, key: this.#activeKey(state, request.epoch) };
  }

  #activeKey(state, epoch) {
    this.#validateStateDeployment(state);
    if (state.activeEpoch !== epoch) throw new Error("FROST signer has no active key for epoch");
    if (epoch !== this.#keyContext.keyEpoch) throw new Error("FrostActiveKeyEpochMismatch");
    const session = state.dkg[this.#dkgRequest.sessionId];
    if (session?.finalKey === undefined) throw new Error("FROST signer active share is unavailable");
    validateNativeFrostDkgRequest(session.request, this.#keyContext);
    return deserializeKey(session.finalKey);
  }

  #validateDkgState(state, request) {
    this.#validateStateDeployment(state);
    if (state.activeEpoch !== undefined && request.epoch < state.activeEpoch) throw new Error("FrostDkgEpochRollback");
  }

  #validateStateDeployment(state) {
    assertFrostStateEnvelope(state, this.signerId);
    // Structural context checks only, not authentication or rollback detection.
    // Existing incompatible state is rejected without reset, migration or keys.
    try {
      if (state.signerId !== this.signerId) throw new Error("RoleMismatch");
      if (state.activeEpoch !== undefined && (!Number.isInteger(state.activeEpoch) || state.activeEpoch < 1 ||
          state.activeEpoch > 0xffff_ffff)) throw new Error("EpochMismatch");
      const sessions = dataRecord(state.dkg, "FrostStateDkg");
      const epochs = new Set();
      for (const [id, session] of Object.entries(sessions)) {
        const entry = dataRecord(session, "FrostStateDkgSession");
        const request = dataRecord(entry.request, "FrostStateDkgRequest");
        const stored = validateNativeFrostDkgRequest(request, request.context);
        if (stored.sessionId !== id || !sameNativeFrostKeyDeployment(stored.context, this.#keyContext) || epochs.has(stored.epoch)) {
          throw new Error("ContextMismatch");
        }
        if (entry.localRound1 !== undefined && dataRecord(entry.localRound1, "FrostStateRound1").identifier !== this.frostIdentifier()) {
          throw new Error("RoleMismatch");
        }
        if (entry.finalKey !== undefined) {
          const key = dataRecord(entry.finalKey, "FrostStateKey");
          if (dataRecord(key.secret, "FrostStateKeyShare").identifier !== this.frostIdentifier()) throw new Error("RoleMismatch");
        }
        epochs.add(stored.epoch);
      }
    } catch {
      throw new Error("FrostStateDeploymentMismatch");
    }
  }

  #checkOwnRound1(session, accepted) {
    const local = normalizeDkgRound1(session.localRound1, this.frostIdentifier());
    assertSameCanonical(local, accepted[this.index], "FrostDkgOwnRound1Mismatch");
  }

  #storedRound1(session, request) {
    const raw = dataArray(session.acceptedRound1, 2, "FrostDkgStoredRound1");
    if (raw.length !== 2) throw new Error("FrostDkgStoredRound1Count");
    const accepted = validateDkgRound1Set(request, request.participants.map((p, index) => ({ signerId: p.signerId, round1: raw[index] })));
    this.#checkOwnRound1(session, accepted);
    return accepted;
  }

  #dkgPhase(state, request) {
    const raw = state.dkg[request.sessionId];
    if (raw === undefined) return "NOT_STARTED";
    const session = dataRecord(requireDkgSession(state, request), "FrostDkgSession");
    const allowed = ["request", "secret", "localRound1", "acceptedRound1", "stagedRound2", "stagedDigest", "finalKey", "finalizationDigest"];
    if (Object.keys(session).some(key => !allowed.includes(key))) throw new Error("FrostDkgSessionFields");
    normalizeDkgRound1(session.localRound1, this.frostIdentifier());
    if (session.finalKey !== undefined) {
      if (session.secret !== undefined || session.stagedRound2 !== undefined || session.stagedDigest !== undefined ||
          typeof session.finalizationDigest !== "string" || !/^[0-9a-f]{64}$/u.test(session.finalizationDigest) ||
          state.activeEpoch !== request.epoch) throw new Error("FrostDkgFinalizedStateInvalid");
      this.#storedRound1(session, request);
      return "FINALIZED";
    }
    if (session.finalizationDigest !== undefined) throw new Error("FrostDkgFinalizedStateInvalid");
    if (session.acceptedRound1 === undefined) {
      if (session.stagedRound2 !== undefined || session.stagedDigest !== undefined) throw new Error("FrostDkgHandoffStateInvalid");
      return "ROUND1";
    }
    const accepted = this.#storedRound1(session, request);
    if (session.stagedRound2 === undefined) {
      if (session.stagedDigest !== undefined) throw new Error("FrostDkgHandoffStateInvalid");
      return "ROUND2";
    }
    const incoming = validateDkgRound2Set(request, this.signerId, session.stagedRound2);
    if (session.stagedDigest !== dkgFinalizationDigest(request, this.signerId, accepted, incoming)) throw new Error("FrostDkgHandoffStateInvalid");
    return "STAGED";
  }

  #deriveDkgKey(session, accepted, incoming) {
    let secret;
    let cache;
    let key;
    const packages = [];
    try {
      secret = this.#checkedDkgSecret(session, 2);
      cache = secret.round2Cache;
      const remote = accepted.filter(entry => entry.identifier !== this.frostIdentifier()).map(deserializeRound1);
      for (const entry of incoming) packages.push(deserializeRound2(entry.round2));
      key = schnorr_FROST.DKG.round3(secret, remote, packages);
      if (key.secret.identifier !== this.frostIdentifier() || key.public.signers.min !== 2 || key.public.signers.max !== 2) {
        throw new Error();
      }
      schnorr_FROST.validateSecret(key.secret, key.public);
      return key;
    } catch {
      key?.secret?.signingShare.fill(0);
      throw new Error("FrostDkgContributionValidationFailed");
    } finally {
      for (const entry of packages) entry.signingShare.fill(0);
      cleanDkgSecret(secret, cache);
    }
  }

  #checkedDkgSecret(session, step) {
    let secret;
    try {
      secret = deserializeDkgSecret(session.secret);
      if (secret.identifier !== BigInt(this.index + 1) || secret.signers.min !== 2 || secret.signers.max !== 2 || secret.step !== step) {
        throw new Error();
      }
      const local = normalizeDkgRound1(session.localRound1, this.frostIdentifier());
      assertSameCanonical(secret.commitment.map(bytesToHex), local.commitmentsHex, "FrostDkgLocalPolynomialMismatch");
      return secret;
    } catch {
      cleanDkgSecret(secret);
      throw new Error("FrostDkgPrivateStateInvalid");
    }
  }

  #unchangedDkgState(request, session) {
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    assertSameCanonical(state.dkg[request.sessionId], session, "FrostDkgStateChanged");
    return state;
  }

  #completeStagedDkg(state, request) {
    const phase = this.#dkgPhase(state, request);
    const session = requireDkgSession(state, request);
    if (phase === "FINALIZED") return this.#completion(request, session.finalKey);
    if (phase !== "STAGED") throw new Error("FrostDkgHandoffRequired");
    const accepted = this.#storedRound1(session, request);
    const incoming = validateDkgRound2Set(request, this.signerId, session.stagedRound2);
    const key = this.#deriveDkgKey(session, accepted, incoming);
    try {
      const fresh = this.#unchangedDkgState(request, session);
      const stored = fresh.dkg[request.sessionId];
      stored.finalKey = serializeKey(key);
      stored.finalizationDigest = stored.stagedDigest;
      delete stored.secret;
      delete stored.stagedRound2;
      delete stored.stagedDigest;
      fresh.activeEpoch = request.epoch;
      this.#stateStore.save(fresh);
      return this.#completion(request, stored.finalKey);
    } finally { key.secret.signingShare.fill(0); }
  }

  #completion(request, storedKey) {
    let key;
    try {
      key = deserializeKey(storedKey);
      if (key.secret.identifier !== this.frostIdentifier() || key.public.signers.min !== 2 || key.public.signers.max !== 2) throw new Error();
      schnorr_FROST.validateSecret(key.secret, key.public);
    } catch { throw new Error("FrostDkgStoredKeyInvalid"); }
    finally { key?.secret?.signingShare.fill(0); }
    const publicPackageHash = sha256Canonical(storedKey.public);
    const group = storedKey.public.commitmentsHex[0];
    if (group === undefined || group.length !== 66) throw new Error("invalid FROST group commitment");
    return {
      signerId: this.signerId,
      frostIdentifier: storedKey.secret.identifier,
      epoch: request.epoch,
      sessionId: request.sessionId,
      participantSetHash: request.participantSetHash,
      publicPackage: storedKey.public,
      publicPackageHash,
      aggregateTweakedXOnlyPublicKey: group.slice(2),
      secretShareStoredLocally: true,
    };
  }

  #requireAvailable() {
    if (this.#closed) throw new Error("FrostSignerClosed");
    if (!this.#available) throw new Error(`${this.signerId} is unavailable`);
  }

  #reservedNonce(sessionId, session) {
    const value = this.#nonces.get(sessionId);
    if (value === undefined || value.commitmentHash !== sha256Canonical(session.commitment)) {
      this.#discardNonce(sessionId);
      throw new Error("FROST nonce is not available");
    }
    return value.nonces;
  }

  #discardNonce(sessionId) {
    const value = this.#nonces.get(sessionId);
    this.#nonces.delete(sessionId);
    if (value !== undefined) zeroNonce(value.nonces);
  }

  #recoverUncertainNonces(state) {
    const pending = [];
    try {
      const sessions = Object.entries(state.signing);
      if (sessions.length > MAX_SIGNING_SESSIONS || Object.keys(state.nonceTombstones).length !== sessions.length) throw new Error();
      const ids = new Set();
      const counters = new Set();
      for (const [sessionId, raw] of sessions) {
        const session = dataRecord(raw, "FrostNonceSession");
        const request = validateNativeFrostSigningRequest(session.request);
        if (request.sessionId !== sessionId) throw new Error();
        for (const field of ["nativeNetwork", "nativeGenesisHash", "solanaDeployment", "bridgeProgramId", "transceiverProgramId", "mint"]) {
          if (request.intent[field] !== this.#keyContext[field]) throw new Error();
        }
        const dkg = createTwoPartyDkgRequest({ epoch: request.epoch, context: { ...this.#keyContext, keyEpoch: request.epoch } });
        if (state.dkg[dkg.sessionId]?.finalKey === undefined || state.activeEpoch === undefined || state.activeEpoch < request.epoch) throw new Error();
        const tombstone = validateNonceSessionState(state, session, request, this.signerId, this.frostIdentifier());
        if (ids.has(session.nonceReservationId) || counters.has(session.reservationCounter)) throw new Error();
        ids.add(session.nonceReservationId);
        counters.add(session.reservationCounter);
        if (session.state === "RESERVED") pending.push({ sessionId, session, tombstone });
      }
    } catch { throw new Error("FrostNonceRecoveryStateInvalid"); }
    // Validate the entire snapshot first. Never partially repair contradictory
    // state, and never deserialize or generate a secret nonce during recovery.
    if (pending.length === 0) return;
    for (const { sessionId, session, tombstone } of pending) {
      state.signing[sessionId] = { ...session, state: "ABORTED" };
      tombstone.state = "CONSUMED";
      tombstone.outcome = "RECOVERY_UNCERTAIN_NONCE";
    }
    try { this.#stateStore.save(state); }
    catch { throw new Error("FrostNonceRecoveryPersistenceFailed"); }
  }
}

function requireDkgSession(state, request) {
  const session = state.dkg[request.sessionId];
  if (session === undefined) throw new Error("FROST DKG session is missing");
  assertSameCanonical(session.request, request, "FROST DKG request changed");
  if (session.secret === undefined && session.finalKey === undefined) throw new Error("FROST DKG secret is unavailable");
  return session;
}

function validateCommitmentSet(request, commitments) {
  if (!Array.isArray(commitments) || commitments.length !== REQUIRED_FROST_SIGNERS.length) {
    throw new Error("FROST commitment set must include A+B");
  }
  const seen = new Set();
  const payloads = commitments.map((envelope) => {
    if (seen.has(envelope.signerId)) throw new Error("duplicate FROST commitment signer");
    seen.add(envelope.signerId);
    if (!request.participantIds.includes(envelope.signerId)) throw new Error("FROST commitment signer outside participant set");
    if (envelope.requestId !== request.requestId || envelope.epoch !== request.epoch || envelope.sessionId !== request.sessionId) {
      throw new Error("FROST commitment domain mismatch");
    }
    const participantIndex = REQUIRED_FROST_SIGNERS.indexOf(envelope.signerId);
    const expectedIdentifier = schnorr_FROST.Identifier.fromNumber(participantIndex + 1);
    if (envelope.commitment.identifier !== expectedIdentifier) throw new Error("FROST commitment identifier mismatch");
    if (envelope.commitment.intentDigest !== request.intentDigest || envelope.commitment.messageHex !== request.messageHex) {
      throw new Error("FROST commitment transcript mismatch");
    }
    if (canonicalJson([...envelope.commitment.participantIds].sort()) !== canonicalJson([...request.participantIds].sort())) {
      throw new Error("FROST commitment participant set mismatch");
    }
    const { nonceReservationId, reservationCounter, ...unsigned } = envelope.commitment;
    const expectedReservation = computeNonceReservationId(envelope.signerId, reservationCounter, request, unsigned);
    if (nonceReservationId !== expectedReservation) throw new Error("FROST nonce reservation binding mismatch");
    return structuredClone(envelope.commitment);
  });
  if (seen.size !== REQUIRED_FROST_SIGNERS.length) throw new Error("missing FROST commitment signer");
  return payloads.sort((left, right) => left.identifier.localeCompare(right.identifier));
}

function serializeRound1(value) {
  return {
    identifier: value.identifier,
    commitmentsHex: value.commitment.map(bytesToHex),
    proofOfKnowledgeHex: bytesToHex(value.proofOfKnowledge),
  };
}

function deserializeRound1(value) {
  return {
    identifier: value.identifier,
    commitment: value.commitmentsHex.map((entry) => hexToBytes(entry, "FROST DKG commitment")),
    proofOfKnowledge: hexToBytes(value.proofOfKnowledgeHex, "FROST DKG proof of knowledge"),
  };
}

function serializeRound2(value) {
  return { identifier: value.identifier, signingShareHex: bytesToHex(value.signingShare) };
}

function deserializeRound2(value) {
  return { identifier: value.identifier, signingShare: hexToBytes(value.signingShareHex, "FROST DKG signing share") };
}

function serializeDkgSecret(value) {
  return {
    identifier: value.identifier.toString(16),
    ...(value.coefficients === undefined ? {} : { coefficients: value.coefficients.map((entry) => entry.toString(16)) }),
    commitmentHex: value.commitment.map(bytesToHex),
    signers: { ...value.signers },
    ...(value.round2Cache === undefined
      ? {}
      : { round2Cache: Object.fromEntries(Object.entries(value.round2Cache).map(([id, entry]) => [id, serializeRound2(entry)])) }),
    ...(value.step === undefined ? {} : { step: value.step }),
  };
}

function deserializeDkgSecret(value) {
  return {
    identifier: BigInt(`0x${value.identifier}`),
    ...(value.coefficients === undefined ? {} : { coefficients: value.coefficients.map((entry) => BigInt(`0x${entry}`)) }),
    commitment: value.commitmentHex.map((entry) => hexToBytes(entry, "FROST DKG secret commitment")),
    signers: { ...value.signers },
    ...(value.round2Cache === undefined
      ? {}
      : { round2Cache: Object.fromEntries(Object.entries(value.round2Cache).map(([id, entry]) => [id, deserializeRound2(entry)])) }),
    ...(value.step === undefined ? {} : { step: value.step }),
  };
}

function cleanDkgSecret(secret, retainedCache) {
  if (secret === undefined) return;
  for (const entry of Object.values(retainedCache ?? secret.round2Cache ?? {})) entry.signingShare.fill(0);
  // The pinned API clears its local scalar references. JavaScript/OS copies are
  // outside this guarantee; this is not a claim of forensic memory erasure.
  schnorr_FROST.DKG.clean(secret);
}

function serializeFrostPublic(value) {
  return {
    signers: { ...value.signers },
    commitmentsHex: value.commitments.map(bytesToHex),
    verifyingSharesHex: Object.fromEntries(
      Object.entries(value.verifyingShares)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, share]) => [id, bytesToHex(share)]),
    ),
  };
}

export function deserializeFrostPublic(value) {
  return {
    signers: { ...value.signers },
    commitments: value.commitmentsHex.map((entry) => hexToBytes(entry, "FROST public commitment")),
    verifyingShares: Object.fromEntries(
      Object.entries(value.verifyingSharesHex).map(([id, share]) => [id, hexToBytes(share, "FROST verifying share")]),
    ),
  };
}

function serializeKey(value) {
  return {
    public: serializeFrostPublic(value.public),
    secret: { identifier: value.secret.identifier, signingShareHex: bytesToHex(value.secret.signingShare) },
  };
}

function deserializeKey(value) {
  return {
    public: deserializeFrostPublic(value.public),
    secret: { identifier: value.secret.identifier, signingShare: hexToBytes(value.secret.signingShareHex, "FROST signing share") },
  };
}

function serializePublicNonceCommitment(value, signerId, reservationCounter, request) {
  const commitment = {
    identifier: value.identifier,
    hidingHex: bytesToHex(value.hiding),
    bindingHex: bytesToHex(value.binding),
    intentDigest: request.intentDigest,
    messageHex: request.messageHex,
    participantIds: [...request.participantIds],
  };
  return {
    ...commitment,
    nonceReservationId: computeNonceReservationId(signerId, reservationCounter, request, commitment),
    reservationCounter,
  };
}

function zeroNonce(value) {
  value.hiding.fill(0);
  value.binding.fill(0);
}

function deserializeCommitment(value) {
  return {
    identifier: value.identifier,
    hiding: hexToBytes(value.hidingHex, "FROST hiding commitment"),
    binding: hexToBytes(value.bindingHex, "FROST binding commitment"),
  };
}

function computeNonceReservationId(signerId, reservationCounter, request, commitment) {
  return sha256Canonical({
    domain: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_NONCE_RESERVATION/V1",
    signerId,
    reservationCounter,
    requestId: request.requestId,
    epoch: request.epoch,
    sessionId: request.sessionId,
    intentDigest: request.intentDigest,
    messageHex: request.messageHex,
    participantIds: [...request.participantIds].sort(),
    commitment,
  });
}

function commitmentEnvelope(signerId, request, commitment) {
  return {
    protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_COMMITMENT/V1",
    signerId,
    requestId: request.requestId,
    epoch: request.epoch,
    sessionId: request.sessionId,
    commitment: structuredClone(commitment),
  };
}

function shareEnvelope(signerId, request, identifier, shareHex, commitmentSetHash) {
  return {
    protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SHARE/V1",
    signerId,
    requestId: request.requestId,
    epoch: request.epoch,
    sessionId: request.sessionId,
    share: {
      identifier,
      shareHex,
      intentDigest: request.intentDigest,
      messageHex: request.messageHex,
      commitmentSetHash,
    },
  };
}

function nextCounter(value) {
  const current = BigInt(value);
  if (current >= 0xffff_ffff_ffff_ffffn) throw new Error("FROST nonce reservation counter exhausted");
  return (current + 1n).toString();
}

function validateNonceSessionState(state, session, request, signerId, identifier) {
  // These are consistency checks against the currently loaded local state, not
  // an authenticated monotonic anchor or proof against whole-state rollback.
  try {
    session = dataRecord(session, "FrostNonceSession");
    const fields = ["request", "requestId", "epoch", "intentDigest", "messageHex", "participantIds", "nonceReservationId",
      "reservationCounter", "state", "commitment", "commitmentSetHash", "shareHex"];
    if (Object.keys(session).some(field => !fields.includes(field))) throw new Error();
    assertSameSigningRequest(session, request);
    assertSameCanonical(validateNativeFrostSigningRequest(session.request), request, "FrostStoredRequestMismatch");
    const commitment = dataRecord(session.commitment, "FrostAbortCommitment");
    if (Object.keys(commitment).length !== 8 || !/^(02|03)[0-9a-f]{64}$/u.test(commitment.hidingHex) ||
        !/^(02|03)[0-9a-f]{64}$/u.test(commitment.bindingHex)) throw new Error();
    const { nonceReservationId, reservationCounter, ...unsigned } = commitment;
    canonicalUintDecimal(reservationCounter, "FROST reservation counter");
    canonicalUintDecimal(state.nonceReservationCounter, "FROST nonce high-water mark");
    if (reservationCounter === "0" ||
        BigInt(state.nonceReservationCounter) < BigInt(reservationCounter) ||
        reservationCounter !== session.reservationCounter || nonceReservationId !== session.nonceReservationId ||
        unsigned.identifier !== identifier || unsigned.intentDigest !== request.intentDigest ||
        unsigned.messageHex !== request.messageHex || canonicalJson(unsigned.participantIds) !== canonicalJson(request.participantIds) ||
        computeNonceReservationId(signerId, reservationCounter, request, unsigned) !== nonceReservationId) throw new Error();
    const storedTombstone = state.nonceTombstones[nonceReservationId];
    const tombstone = dataRecord(storedTombstone, "FrostNonceTombstone");
    const tombstoneFields = ["nonceReservationId", "reservationCounter", "requestId", "epoch", "sessionId",
      "intentDigest", "messageHex", "participantIds", "commitmentSha256", "state", "outcome", "commitmentSetHash", "shareSha256"];
    if (Object.keys(tombstone).some(field => !tombstoneFields.includes(field)) || tombstone.nonceReservationId !== nonceReservationId ||
        tombstone.reservationCounter !== reservationCounter || tombstone.sessionId !== request.sessionId ||
        tombstone.requestId !== request.requestId || tombstone.epoch !== request.epoch ||
        tombstone.intentDigest !== request.intentDigest || tombstone.messageHex !== request.messageHex ||
        canonicalJson(tombstone.participantIds) !== canonicalJson(request.participantIds) ||
        tombstone.commitmentSha256 !== sha256Canonical(commitment)) throw new Error();
    if (session.state === "RESERVED") {
      if (tombstone.state !== "RESERVED" || session.shareHex !== undefined || session.commitmentSetHash !== undefined ||
          tombstone.outcome !== undefined || tombstone.shareSha256 !== undefined || tombstone.commitmentSetHash !== undefined) throw new Error();
    } else {
      if (!["SIGNED", "ABORTED"].includes(session.state) || tombstone.state !== "CONSUMED" || session.nonce !== undefined) throw new Error();
      if (session.state === "SIGNED" && (typeof session.shareHex !== "string" || !/^[0-9a-f]{64}$/u.test(session.shareHex) ||
          typeof session.commitmentSetHash !== "string" || !/^[0-9a-f]{64}$/u.test(session.commitmentSetHash) ||
          session.commitmentSetHash !== tombstone.commitmentSetHash ||
          tombstone.outcome !== "SHARE_PERSISTED" ||
          tombstone.shareSha256 !== sha256Canonical({ shareHex: session.shareHex }))) throw new Error();
      if (session.state === "ABORTED" && (session.shareHex !== undefined || tombstone.shareSha256 !== undefined ||
          session.commitmentSetHash !== undefined ||
          !["ABORTED", "SHARE_COMPUTATION_STARTED", "RECOVERY_UNCERTAIN_NONCE"].includes(tombstone.outcome))) throw new Error();
      if (session.state === "ABORTED" && (tombstone.outcome === "SHARE_COMPUTATION_STARTED" ?
        typeof tombstone.commitmentSetHash !== "string" || !/^[0-9a-f]{64}$/u.test(tombstone.commitmentSetHash) :
        tombstone.commitmentSetHash !== undefined)) throw new Error();
    }
    // dataRecord validates a detached snapshot. Callers mutate the corresponding
    // stored record only after every consistency check succeeds.
    return storedTombstone;
  } catch { throw new Error("FrostNonceStateInvalid"); }
}

function assertSameSigningRequest(session, request) {
  if (
    session.requestId !== request.requestId ||
    session.epoch !== request.epoch ||
    session.intentDigest !== request.intentDigest ||
    session.messageHex !== request.messageHex ||
    canonicalJson([...session.participantIds].sort()) !== canonicalJson([...request.participantIds].sort())
  ) {
    throw new Error("FROST signing session replayed with altered transcript");
  }
}

function assertSameCanonical(left, right, message) {
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error(message);
}
