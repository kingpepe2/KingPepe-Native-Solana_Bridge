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
  hexToBytes,
  nativeSigningIntentDigest,
  sha256Canonical,
  validateNativeSigningIntent,
  dataRecord,
} from "../policy/native-signing-policy.mjs";
import { validateNativeFrostSigningRequest } from "../policy/signing-request.mjs";
import { createTwoPartyDkgRequest, nativeFrostKeyContext, sameNativeFrostKeyDeployment,
  validateNativeFrostDkgRequest } from "../policy/dkg-request.mjs";

function secureFrostRandomBytes(length = 32) {
  return Uint8Array.from(randomBytes(length));
}

// Matches the bounded plain-record parser. Retention is never auto-pruned.
const MAX_DKG_EPOCHS = 40;

export class NativeFrostSigner {
  #policy;
  #stateStore;
  #available = true;
  #nativeEvidenceValidator;
  #validatedNativeIntents = new Map();
  #keyContext;
  #dkgRequest;

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
    return this.#available;
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
    const localRound1 = serializeRound1(generated.public);
    state.dkg[request.sessionId] = {
      request: structuredClone(request),
      secret: serializeDkgSecret(generated.secret),
      localRound1,
    };
    this.#stateStore.save(state);
    return { signerId: this.signerId, round1: localRound1 };
  }

  dkgRound2(request, round1Messages) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    const session = requireDkgSession(state, request);
    const accepted = validateRound1Set(request, round1Messages);
    if (session.acceptedRound1 !== undefined) {
      assertSameCanonical(session.acceptedRound1, accepted, "DKG round1 transcript changed after acceptance");
    }
    const secret = deserializeDkgSecret(session.secret);
    const ownIdentifier = this.frostIdentifier();
    const remote = accepted.filter((entry) => entry.identifier !== ownIdentifier).map(deserializeRound1);
    const outgoing = schnorr_FROST.DKG.round2(secret, remote);
    session.secret = serializeDkgSecret(secret);
    session.acceptedRound1 = accepted;
    this.#stateStore.save(state);

    return Object.fromEntries(
      request.participants
        .filter((participant) => participant.signerId !== this.signerId)
        .map((participant) => {
          const receiverIdentifier = schnorr_FROST.Identifier.fromNumber(participant.index + 1);
          const value = outgoing[receiverIdentifier];
          if (value === undefined) throw new Error("FROST DKG omitted an enrolled receiver");
          return [participant.signerId, serializeRound2(value)];
        }),
    );
  }

  dkgFinalize(request, round1Messages, incomingRound2) {
    this.#requireAvailable();
    request = validateNativeFrostDkgRequest(request, this.#keyContext);
    const state = this.#stateStore.load();
    this.#validateDkgState(state, request);
    const session = requireDkgSession(state, request);
    if (session.finalKey !== undefined) return this.#completion(request, session.finalKey);
    const accepted = validateRound1Set(request, round1Messages);
    assertSameCanonical(session.acceptedRound1, accepted, "DKG finalization requires the accepted round1 transcript");

    const ownIdentifier = this.frostIdentifier();
    const remoteRound1 = accepted.filter((entry) => entry.identifier !== ownIdentifier).map(deserializeRound1);
    const packages = incomingRound2.map(({ senderId, round2 }) => {
      const sender = request.participants.find((participant) => participant.signerId === senderId);
      if (sender === undefined || sender.signerId === this.signerId) throw new Error("invalid DKG round2 sender");
      const expectedIdentifier = schnorr_FROST.Identifier.fromNumber(sender.index + 1);
      if (round2.identifier !== expectedIdentifier) throw new Error("DKG round2 sender identifier mismatch");
      return deserializeRound2(round2);
    });
    if (packages.length !== request.participants.length - 1) throw new Error("missing FROST DKG round2 package");

    const secret = deserializeDkgSecret(session.secret);
    const key = schnorr_FROST.DKG.round3(secret, remoteRound1, packages);
    schnorr_FROST.validateSecret(key.secret, key.public);
    schnorr_FROST.DKG.clean(secret);
    session.finalKey = serializeKey(key);
    delete session.secret;
    state.activeEpoch = request.epoch;
    this.#stateStore.save(state);
    return this.#completion(request, session.finalKey);
  }

  signingCommitment(request) {
    this.#requireAvailable();
    request = validateNativeFrostSigningRequest(request);
    const { state, key } = this.#authorizeRequestWithKey(request);
    const existing = state.signing[request.sessionId];
    if (existing !== undefined) {
      assertSameSigningRequest(existing, request);
      if (existing.state === "ABORTED") throw new Error("FROST nonce was already burned");
      if (existing.commitment === undefined) throw new Error("FROST signing session is missing its public commitment");
      return commitmentEnvelope(this.signerId, request, existing.commitment);
    }

    const counter = nextCounter(state.nonceReservationCounter);
    const generated = schnorr_FROST.commit(key.secret, secureFrostRandomBytes);
    let nonce;
    try {
      nonce = serializeNonce(generated, this.signerId, counter, request);
    } finally {
      generated.nonces.hiding.fill(0);
      generated.nonces.binding.fill(0);
    }
    state.nonceReservationCounter = counter;
    state.signing[request.sessionId] = {
      requestId: request.requestId,
      epoch: request.epoch,
      intentDigest: request.intentDigest,
      messageHex: request.messageHex,
      participantIds: [...request.participantIds],
      nonceReservationId: nonce.commitment.nonceReservationId,
      reservationCounter: counter,
      state: "RESERVED",
      commitment: nonce.commitment,
      nonce,
    };
    state.nonceTombstones[nonce.commitment.nonceReservationId] = {
      nonceReservationId: nonce.commitment.nonceReservationId,
      reservationCounter: counter,
      requestId: request.requestId,
      epoch: request.epoch,
      sessionId: request.sessionId,
      intentDigest: request.intentDigest,
      messageHex: request.messageHex,
      participantIds: [...request.participantIds],
      commitmentSha256: sha256Canonical(nonce.commitment),
      state: "RESERVED",
    };
    this.#stateStore.save(state);
    return commitmentEnvelope(this.signerId, request, nonce.commitment);
  }

  signatureShare(request, commitments) {
    this.#requireAvailable();
    request = validateNativeFrostSigningRequest(request);
    const { state, key } = this.#authorizeRequestWithKey(request);
    const session = state.signing[request.sessionId];
    if (session === undefined) throw new Error("signer has no reserved FROST nonce for session");
    assertSameSigningRequest(session, request);

    const commitmentPayloads = validateCommitmentSet(request, commitments);
    const commitmentSetHash = sha256Canonical(commitmentPayloads);
    if (session.state === "SIGNED") {
      if (session.commitmentSetHash !== commitmentSetHash || session.shareHex === undefined) {
        throw new Error("signed FROST session transcript changed");
      }
      return shareEnvelope(this.signerId, request, key.secret.identifier, session.shareHex, commitmentSetHash);
    }
    if (session.state !== "RESERVED" || session.nonce === undefined) throw new Error("FROST nonce is not available");

    const tombstone = state.nonceTombstones[session.nonceReservationId];
    if (tombstone?.state !== "RESERVED") throw new Error("FROST nonce tombstone is not reserved");

    const nonce = deserializeNonce(session.nonce);
    session.state = "ABORTED";
    delete session.nonce;
    tombstone.state = "CONSUMED";
    tombstone.outcome = "SHARE_COMPUTATION_STARTED";
    tombstone.commitmentSetHash = commitmentSetHash;
    this.#stateStore.save(state);

    let share;
    try {
      share = schnorr_FROST.signShare(
        key.secret,
        key.public,
        nonce.nonces,
        commitmentPayloads.map(deserializeCommitment),
        hexToBytes(request.messageHex, "FROST signing message"),
      );
    } finally {
      nonce.nonces.hiding.fill(0);
      nonce.nonces.binding.fill(0);
    }

    const freshState = this.#stateStore.load();
    const freshSession = freshState.signing[request.sessionId];
    const freshTombstone = freshState.nonceTombstones[session.nonceReservationId];
    freshSession.state = "SIGNED";
    freshSession.commitmentSetHash = commitmentSetHash;
    freshSession.shareHex = bytesToHex(share);
    freshTombstone.outcome = "SHARE_PERSISTED";
    freshTombstone.shareSha256 = sha256Canonical({ shareHex: freshSession.shareHex });
    this.#stateStore.save(freshState);
    return shareEnvelope(this.signerId, request, key.secret.identifier, freshSession.shareHex, commitmentSetHash);
  }

  abortSigningSession(sessionId) {
    const state = this.#stateStore.load();
    const session = state.signing[sessionId];
    if (session === undefined || session.state === "SIGNED" || session.state === "ABORTED") return;
    if (session.nonce !== undefined) delete session.nonce;
    session.state = "ABORTED";
    const tombstone = state.nonceTombstones[session.nonceReservationId];
    if (tombstone !== undefined) {
      tombstone.state = "CONSUMED";
      tombstone.outcome = "ABORTED";
    }
    this.#stateStore.save(state);
  }

  #authorizeRequestWithKey(request) {
    assertNativeSigningPolicy(this.#policy);
    assertNativeSigningApproved(this.#policy, request.intent);
    const state = this.#stateStore.load();
    const key = this.#activeKey(state, request.epoch);
    if (this.#nativeEvidenceValidator !== undefined) {
      const checkedAt = this.#validatedNativeIntents.get(request.intentDigest);
      if (checkedAt === undefined || performance.now() - checkedAt > 30_000) {
        throw new Error("FROST fresh independent Native evidence required");
      }
    }
    return { state, key };
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

  #completion(request, storedKey) {
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
    if (!this.#available) throw new Error(`${this.signerId} is unavailable`);
  }
}

function requireDkgSession(state, request) {
  const session = state.dkg[request.sessionId];
  if (session === undefined) throw new Error("FROST DKG session is missing");
  assertSameCanonical(session.request, request, "FROST DKG request changed");
  if (session.secret === undefined && session.finalKey === undefined) throw new Error("FROST DKG secret is unavailable");
  return session;
}

function validateRound1Set(request, round1Messages) {
  if (!Array.isArray(round1Messages) || round1Messages.length !== request.participants.length) {
    throw new Error("FROST DKG round1 set must contain A+B");
  }
  const bySigner = new Map();
  for (const message of round1Messages) {
    if (bySigner.has(message.signerId)) throw new Error("duplicate FROST DKG round1 sender");
    const participant = request.participants.find((entry) => entry.signerId === message.signerId);
    if (participant === undefined) throw new Error("unknown FROST DKG round1 sender");
    const expectedIdentifier = schnorr_FROST.Identifier.fromNumber(participant.index + 1);
    if (message.round1.identifier !== expectedIdentifier) throw new Error("FROST DKG round1 identifier mismatch");
    bySigner.set(message.signerId, message.round1);
  }
  return request.participants
    .map((participant) => bySigner.get(participant.signerId))
    .map((round1) => structuredClone(round1));
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

function serializeNonce(value, signerId, reservationCounter, request) {
  const commitment = {
    identifier: value.commitments.identifier,
    hidingHex: bytesToHex(value.commitments.hiding),
    bindingHex: bytesToHex(value.commitments.binding),
    intentDigest: request.intentDigest,
    messageHex: request.messageHex,
    participantIds: [...request.participantIds],
  };
  return {
    hidingHex: bytesToHex(value.nonces.hiding),
    bindingHex: bytesToHex(value.nonces.binding),
    commitment: {
      ...commitment,
      nonceReservationId: computeNonceReservationId(signerId, reservationCounter, request, commitment),
      reservationCounter,
    },
  };
}

function deserializeNonce(value) {
  return {
    nonces: {
      hiding: hexToBytes(value.hidingHex, "FROST hiding nonce"),
      binding: hexToBytes(value.bindingHex, "FROST binding nonce"),
    },
    commitments: deserializeCommitment(value.commitment),
  };
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
