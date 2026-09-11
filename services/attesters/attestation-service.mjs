import { ed25519 } from "@noble/curves/ed25519.js";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { timingSafeEqual } from "node:crypto";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";

export const ATTESTATION_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/PROJECT_ATTESTATION/V1";
export const ATTESTATION_MODE = "PROJECT_ATTESTED_2_OF_2_ED25519";
export const ATTESTATION_ROLES = Object.freeze(["ATTESTER_A", "ATTESTER_B"]);
export const VERIFIED_READY = "VERIFIED_READY";
export const WAITING_FOR_FINALITY = "WAITING_FOR_FINALITY";
export const WAITING_FOR_DEPENDENCY = "WAITING_FOR_DEPENDENCY";
export const REJECTED = "REJECTED";
export const HARD_STOP = "HARD_STOP";

export class ProjectAttester {
  #secretKey;
  #policy;
  #closed = false;
  #protectedStore;
  static fromWindowsProtectedStore({ store, role, policy }) {
    // Snapshot before the storage binding checks; never check one policy and
    // construct the attester from a second read of mutable/accessor input.
    policy = normalizePolicy(structuredClone(policy));
    assertWindowsProtectedStore(store, role, "attester-seed");
    if (store.context.environment !== "localnet") throw new Error("ProtectedAttesterLocalOnly");
    if (store.context.nativeGenesis !== policy.nativeGenesisHex ||
        store.context.solanaDeployment !== policy.solanaDeploymentHex ||
        store.context.keyEpoch !== policy.keyEpoch) throw new Error("ProtectedAttesterContextMismatch");
    const result = store.read();
    try {
      if (result.payload.length !== 32) throw new Error("ProtectedAttesterKeyInvalid");
      const attester = new ProjectAttester({ role, secretKey: result.payload, policy });
      attester.#protectedStore = store; return attester;
    } finally { result.payload.fill(0); }
  }
  constructor({ role, secretKey, policy }) {
    if (!ATTESTATION_ROLES.includes(role)) {
      throw new Error("InvalidAttesterRole");
    }
    if (!secretKey) {
      throw new Error("MissingAttesterSecretKeyRef");
    }
    this.#secretKey = Uint8Array.from(toBytes(secretKey, "secretKey"));
    const publicKeyHex = bytesToHex(ed25519.getPublicKey(this.#secretKey));
    this.#policy = normalizePolicy(structuredClone(policy));
    Object.defineProperties(this, { role: { value: role, enumerable: true },
      publicKeyHex: { value: publicKeyHex, enumerable: true } });
    if (this.#policy.role !== role || this.#policy.attesterPublicKeyHex !== this.publicKeyHex) {
      this.#secretKey.fill(0);
      throw new Error("AttesterPolicyIdentityMismatch");
    }
    Object.freeze(this);
  }

  get policy() { return this.#policy; }
  get publicKey() { return hexToBytes(this.publicKeyHex, "attesterPublicKeyHex"); }
  close() { this.#closed = true; this.#secretKey.fill(0); }
  assertProtectedStorage() {
    if (this.#closed || !this.#protectedStore) throw new Error("ProtectedAttesterStorageRequired");
    assertWindowsProtectedStore(this.#protectedStore, this.role, "attester-seed");
    const result = this.#protectedStore.read();
    try {
      if (result.payload.length !== this.#secretKey.length || !timingSafeEqual(result.payload, this.#secretKey)) throw new Error("ProtectedAttesterStateChanged");
    } finally { result.payload.fill(0); }
  }

  evaluateDepositCredit(request, nowUnix = undefined) {
    const decoded = decodeCanonicalBridgeMessage(hexToBytes(request.encodedMessageHex, "encodedMessageHex"));
    return evaluateDepositCredit({
      policy: this.policy,
      request,
      decoded,
      nowUnix,
    });
  }

  signDepositCredit(request, nowUnix = undefined) {
    if (this.#closed) throw new Error("AttesterClosed");
    const decoded = decodeCanonicalBridgeMessage(hexToBytes(request.encodedMessageHex, "encodedMessageHex"));
    const decision = evaluateDepositCredit({
      policy: this.policy,
      request,
      decoded,
      nowUnix,
    });
    if (decision.state !== VERIFIED_READY) {
      const error = new Error(`AttestationNotAuthorized:${decision.reason}`);
      error.decision = decision;
      throw error;
    }
    const signature = ed25519.sign(decoded.encoded, this.#secretKey);
    return {
      protocol: ATTESTATION_PROTOCOL,
      mode: ATTESTATION_MODE,
      role: this.role,
      keyEpoch: decoded.keyEpoch,
      policyEpoch: decoded.policyEpoch,
      attesterPublicKeyHex: this.publicKeyHex,
      messageDigestHex: decoded.messageDigestHex,
      operationIdHex: decoded.operationIdHex,
      signedBytes: "CANONICAL_BRIDGE_MESSAGE_V1",
      signatureHex: bytesToHex(signature),
      state: VERIFIED_READY,
    };
  }
}

export function createEphemeralAttesterKeypairForTestOnly(seed) {
  const secretKey = seed ? hexToBytes(seed, "seed") : ed25519.utils.randomSecretKey();
  if (secretKey.length !== 32) {
    throw new Error("TestSecretKeyMustBe32Bytes");
  }
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    publicKeyHex: bytesToHex(publicKey),
  };
}

export function evaluateDepositCredit({ policy, request, decoded, nowUnix = undefined }) {
  const normalizedPolicy = normalizePolicy(policy);
  const message = decoded ?? decodeCanonicalBridgeMessage(hexToBytes(request.encodedMessageHex, "encodedMessageHex"));
  if (normalizedPolicy.hardStop) {
    return decision(HARD_STOP, "HARD_STOP_ACTIVE", message);
  }
  if (normalizedPolicy.depositsPaused) {
    return decision(WAITING_FOR_DEPENDENCY, "DEPOSITS_PAUSED", message);
  }
  if (message.action !== "DepositClaim" || message.direction !== "NativeToSolana") {
    return decision(REJECTED, "WRONG_MESSAGE_KIND", message);
  }
  if (request.messageDigestHex && request.messageDigestHex.toLowerCase() !== message.messageDigestHex) {
    return decision(REJECTED, "MESSAGE_DIGEST_MISMATCH", message);
  }
  const domainResult = checkDomain(normalizedPolicy, message);
  if (domainResult) {
    return decision(REJECTED, domainResult, message);
  }
  const timeResult = checkValidityWindow(message, nowUnix);
  if (timeResult) {
    return decision(timeResult.state, timeResult.reason, message);
  }
  const evidence = normalizeDepositEvidence(request.evidence);
  if (!normalizedPolicy.acceptedNativeTrust.includes(evidence.trust)) {
    return decision(WAITING_FOR_DEPENDENCY, "NATIVE_TRUST_NOT_ACCEPTED", message);
  }
  if (!evidence.finalitySatisfied || !evidence.sweepFinalized) {
    return decision(WAITING_FOR_FINALITY, "NATIVE_FINALITY_NOT_SATISFIED", message);
  }
  if (!evidence.utxoUnspentAtDeposit || !evidence.noPriorConsumption) {
    return decision(REJECTED, "BACKING_NOT_UNIQUELY_AVAILABLE", message);
  }
  if (evidence.reserveTransitionState !== "CANONICAL_RESERVE") {
    return decision(WAITING_FOR_DEPENDENCY, "RESERVE_TRANSITION_NOT_CANONICAL", message);
  }
  if (evidence.mintCreditState !== "AUTHORIZED_UNCONSUMED") {
    return decision(REJECTED, "MINT_CREDIT_NOT_AVAILABLE", message);
  }
  if (evidence.nativeNetwork !== normalizedPolicy.nativeNetwork) {
    return decision(REJECTED, "NATIVE_NETWORK_MISMATCH", message);
  }
  if (evidence.nativeGenesisHash !== normalizedPolicy.nativeGenesisHex) {
    return decision(REJECTED, "NATIVE_GENESIS_MISMATCH", message);
  }
  if (evidence.operationIdHex !== message.operationIdHex) {
    return decision(REJECTED, "OPERATION_ID_MISMATCH", message);
  }
  if (evidence.depositOutpoint !== message.depositOutpointText) {
    return decision(REJECTED, "DEPOSIT_OUTPOINT_MISMATCH", message);
  }
  if (BigInt(evidence.amountAtomic) !== message.amountAtomic) {
    return decision(REJECTED, "AMOUNT_MISMATCH", message);
  }
  if (evidence.solanaRecipientHex !== message.destinationHex) {
    return decision(REJECTED, "RECIPIENT_MISMATCH", message);
  }
  if (evidence.evidenceDigestHex !== message.evidenceDigestHex) {
    return decision(REJECTED, "EVIDENCE_DIGEST_MISMATCH", message);
  }
  if (!isHash32Hex(evidence.reserveAllocationIdHex)) {
    return decision(REJECTED, "RESERVE_ALLOCATION_ID_INVALID", message);
  }
  return decision(VERIFIED_READY, "ALL_REQUIRED_CHECKS_PASSED", message);
}

export function verifyProjectAttestation(attestation, encodedMessageHex) {
  let decoded;
  let publicKey;
  let signature;
  try {
    decoded = decodeCanonicalBridgeMessage(hexToBytes(encodedMessageHex, "encodedMessageHex"));
    publicKey = hexToBytes(attestation.attesterPublicKeyHex, "attesterPublicKeyHex");
    signature = hexToBytes(attestation.signatureHex, "signatureHex");
  } catch {
    return false;
  }
  if (attestation.messageDigestHex !== decoded.messageDigestHex || attestation.operationIdHex !== decoded.operationIdHex) {
    return false;
  }
  if (attestation.keyEpoch !== decoded.keyEpoch || attestation.policyEpoch !== decoded.policyEpoch) {
    return false;
  }
  if (attestation.protocol !== ATTESTATION_PROTOCOL || attestation.mode !== ATTESTATION_MODE) {
    return false;
  }
  return ed25519.verify(signature, decoded.encoded, publicKey);
}

export function combineProjectAttestations({ attestations, encodedMessageHex, authorizedAttesterPublicKeys }) {
  if (!Array.isArray(attestations) || attestations.length !== 2) {
    throw new Error("ThresholdNotMet");
  }
  const authorized = new Set(authorizedAttesterPublicKeys.map((key) => normalizeHex(key, "authorizedAttesterPublicKey")));
  const seen = new Set();
  const decoded = decodeCanonicalBridgeMessage(hexToBytes(encodedMessageHex, "encodedMessageHex"));
  for (const attestation of attestations) {
    const key = normalizeHex(attestation.attesterPublicKeyHex, "attesterPublicKeyHex");
    if (!authorized.has(key)) {
      throw new Error("UnauthorizedAttester");
    }
    if (seen.has(key)) {
      throw new Error("DuplicateAttester");
    }
    if (!verifyProjectAttestation(attestation, encodedMessageHex)) {
      throw new Error("InvalidAttestationSignature");
    }
    seen.add(key);
  }
  return {
    mode: ATTESTATION_MODE,
    threshold: 2,
    messageDigestHex: decoded.messageDigestHex,
    operationIdHex: decoded.operationIdHex,
    attesterPublicKeys: [...seen].sort(),
    state: VERIFIED_READY,
  };
}

function normalizePolicy(policy) {
  if (!policy || typeof policy !== "object") {
    throw new Error("MissingAttestationPolicy");
  }
  return Object.freeze({
    role: policy.role,
    attesterPublicKeyHex: normalizeHashLike(policy.attesterPublicKeyHex, "attesterPublicKeyHex"),
    protocolId: policy.protocolId,
    nativeNetwork: policy.nativeNetwork,
    nativeGenesisHex: normalizeHashLike(policy.nativeGenesisHex, "nativeGenesisHex"),
    solanaDeploymentHex: normalizeHashLike(policy.solanaDeploymentHex, "solanaDeploymentHex"),
    managerProgramIdHex: normalizeHashLike(policy.managerProgramIdHex, "managerProgramIdHex"),
    transceiverProgramIdHex: normalizeHashLike(policy.transceiverProgramIdHex, "transceiverProgramIdHex"),
    mintHex: normalizeHashLike(policy.mintHex, "mintHex"),
    policyEpoch: policy.policyEpoch,
    keyEpoch: policy.keyEpoch,
    acceptedNativeTrust: Object.freeze([...(policy.acceptedNativeTrust ?? ["LOCALLY_VALIDATED_CHAIN_STATE"])]),
    depositsPaused: policy.depositsPaused === true,
    hardStop: policy.hardStop === true,
  });
}

function normalizeDepositEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("MissingDepositEvidence");
  }
  return {
    trust: evidence.trust,
    nativeNetwork: evidence.nativeNetwork,
    nativeGenesisHash: normalizeHashLike(evidence.nativeGenesisHash, "nativeGenesisHash"),
    operationIdHex: normalizeHashLike(evidence.operationIdHex, "operationIdHex"),
    depositOutpoint: evidence.depositOutpoint,
    amountAtomic: evidence.amountAtomic,
    solanaRecipientHex: normalizeHex(evidence.solanaRecipientHex, "solanaRecipientHex"),
    evidenceDigestHex: normalizeHashLike(evidence.evidenceDigestHex, "evidenceDigestHex"),
    reserveAllocationIdHex: normalizeHashLike(evidence.reserveAllocationIdHex, "reserveAllocationIdHex"),
    reserveTransitionState: evidence.reserveTransitionState,
    mintCreditState: evidence.mintCreditState,
    finalitySatisfied: evidence.finalitySatisfied === true,
    sweepFinalized: evidence.sweepFinalized === true,
    utxoUnspentAtDeposit: evidence.utxoUnspentAtDeposit === true,
    noPriorConsumption: evidence.noPriorConsumption === true,
  };
}

function checkDomain(policy, message) {
  if (message.deployment.protocolId !== policy.protocolId) return "PROTOCOL_ID_MISMATCH";
  if (message.deployment.nativeNetwork !== policy.nativeNetwork) return "NATIVE_NETWORK_MISMATCH";
  if (bytesToHex(message.deployment.nativeGenesis) !== policy.nativeGenesisHex) return "NATIVE_GENESIS_MISMATCH";
  if (bytesToHex(message.deployment.solanaDeployment) !== policy.solanaDeploymentHex) return "SOLANA_DEPLOYMENT_MISMATCH";
  if (bytesToHex(message.deployment.managerProgramId) !== policy.managerProgramIdHex) return "MANAGER_PROGRAM_MISMATCH";
  if (bytesToHex(message.deployment.transceiverProgramId) !== policy.transceiverProgramIdHex) {
    return "TRANSCEIVER_PROGRAM_MISMATCH";
  }
  if (bytesToHex(message.deployment.mint) !== policy.mintHex) return "MINT_MISMATCH";
  if (message.policyEpoch !== policy.policyEpoch) return "POLICY_EPOCH_MISMATCH";
  if (message.keyEpoch !== policy.keyEpoch) return "KEY_EPOCH_MISMATCH";
  return null;
}

function checkValidityWindow(message, nowUnix) {
  const now = BigInt(nowUnix ?? Math.floor(Date.now() / 1000));
  if (now < message.validFrom) {
    return { state: WAITING_FOR_DEPENDENCY, reason: "MESSAGE_NOT_YET_VALID" };
  }
  if (now > message.validUntil) {
    return { state: REJECTED, reason: "MESSAGE_EXPIRED" };
  }
  return null;
}

function decision(state, reason, message) {
  return {
    state,
    reason,
    operationIdHex: message.operationIdHex,
    messageDigestHex: message.messageDigestHex,
  };
}

function normalizeHashLike(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized.length !== 64) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function toBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (typeof value === "string") return hexToBytes(value, label);
  throw new Error(`${label}:ExpectedBytes`);
}
