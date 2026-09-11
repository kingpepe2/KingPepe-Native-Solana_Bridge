import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ProjectAttester,
  createEphemeralAttesterKeypairForTestOnly,
  combineProjectAttestations,
  evaluateDepositCredit,
  verifyProjectAttestation,
} from "../attestation-service.mjs";
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage, bytesToHex } from "../../../shared/protocol/canonical-message.mjs";
import { attesterEvidenceVerifier } from "../protected-service.mjs";

const vectorPath = path.resolve(import.meta.dirname, "../../../solana/modules/bridge-messages/vectors/canonical-v1.json");
const vectorFile = JSON.parse(readFileSync(vectorPath, "utf8"));
const depositVector = vectorFile.vectors.find((vector) => vector.name === "deposit-claim-v1");
const decodedDeposit = decodeCanonicalBridgeMessage(depositVector.encodedHex);

function policyFor(role, keypair, overrides = {}) {
  return {
    role,
    attesterPublicKeyHex: keypair.publicKeyHex,
    protocolId: depositVector.deployment.protocolId,
    nativeNetwork: depositVector.deployment.nativeNetwork,
    nativeGenesisHex: depositVector.deployment.nativeGenesis,
    solanaDeploymentHex: depositVector.deployment.solanaDeployment,
    managerProgramIdHex: depositVector.deployment.managerProgramId,
    transceiverProgramIdHex: depositVector.deployment.transceiverProgramId,
    mintHex: depositVector.deployment.mint,
    policyEpoch: depositVector.policyEpoch,
    keyEpoch: depositVector.keyEpoch,
    acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"],
    depositsPaused: false,
    hardStop: false,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    trust: "LOCALLY_VALIDATED_CHAIN_STATE",
    nativeNetwork: depositVector.deployment.nativeNetwork,
    nativeGenesisHash: depositVector.deployment.nativeGenesis,
    operationIdHex: decodedDeposit.operationIdHex,
    depositOutpoint: decodedDeposit.depositOutpointText,
    amountAtomic: decodedDeposit.amountAtomic.toString(),
    solanaRecipientHex: decodedDeposit.destinationHex,
    evidenceDigestHex: decodedDeposit.evidenceDigestHex,
    reserveAllocationIdHex: "11".repeat(32),
    reserveTransitionState: "CANONICAL_RESERVE",
    mintCreditState: "AUTHORIZED_UNCONSUMED",
    finalitySatisfied: true,
    sweepFinalized: true,
    utxoUnspentAtDeposit: true,
    noPriorConsumption: true,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    encodedMessageHex: depositVector.encodedHex,
    messageDigestHex: depositVector.messageDigest,
    evidence: evidence(),
    ...overrides,
  };
}

function runtime() {
  const keyA = createEphemeralAttesterKeypairForTestOnly();
  const keyB = createEphemeralAttesterKeypairForTestOnly();
  const attesterA = new ProjectAttester({
    role: "ATTESTER_A",
    secretKey: keyA.secretKey,
    policy: policyFor("ATTESTER_A", keyA),
  });
  const attesterB = new ProjectAttester({
    role: "ATTESTER_B",
    secretKey: keyB.secretKey,
    policy: policyFor("ATTESTER_B", keyB),
  });
  return { keyA, keyB, attesterA, attesterB };
}

test("attester service evidence policy requires its own verifier and exact peer operation binding", async () => {
  const { attesterA, attesterB } = runtime(); let calls = 0;
  try {
    assert.throws(() => attesterEvidenceVerifier({ attester: attesterA }));
    const handler = attesterEvidenceVerifier({ attester: attesterA, verifyNativeDeposit: async () => { calls++; throw new Error("TEST_SOURCE_UNAVAILABLE"); } });
    const input = { method: "attestDeposit", peerRole: "BRIDGE_VALIDATOR", operationId: decodedDeposit.operationIdHex,
      payload: { encodedMessageHex: depositVector.encodedHex, rawEvidence: {} } };
    await assert.rejects(handler({ ...input, peerRole: "COORDINATOR" }));
    await assert.rejects(handler({ ...input, operationId: "55".repeat(32) }));
    assert.equal(calls, 0);
    await assert.rejects(handler(input), /TEST_SOURCE_UNAVAILABLE/u); assert.equal(calls, 1);
  } finally { attesterA.close(); attesterB.close(); }
});

test("attester service evidence policy ignores caller proof booleans and requires message-bound verifier output", async () => {
  const { attesterA, attesterB } = runtime();
  try {
    const handler = attesterEvidenceVerifier({ attester: attesterA, verifyNativeDeposit: async () => ({ proofVerified: true }) });
    await assert.rejects(handler({ method: "attestDeposit", peerRole: "BRIDGE_VALIDATOR", operationId: decodedDeposit.operationIdHex,
      payload: { encodedMessageHex: depositVector.encodedHex, rawEvidence: { proofVerified: true } } }), /AttesterIpcEvidenceMismatch/u);
  } finally { attesterA.close(); attesterB.close(); }
});

test("attester service evidence policy snapshots the message across await before signing", async () => {
  const { attesterA, attesterB } = runtime();
  try {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const encoded = bytesToHex(encodeCanonicalBridgeMessage({ ...decodedDeposit, operationId: undefined, validFrom: now - 1n, validUntil: now + 60n }));
    const decoded = decodeCanonicalBridgeMessage(encoded), payload = { encodedMessageHex: encoded, rawEvidence: {} };
    const handler = attesterEvidenceVerifier({ attester: attesterA, verifyNativeDeposit: async input => {
      assert.equal(input.encodedMessageHex, encoded); payload.encodedMessageHex = "ff";
      return { operationIdHex: decoded.operationIdHex, messageDigestHex: decoded.messageDigestHex,
        evidence: evidence({ operationIdHex: decoded.operationIdHex, evidenceDigestHex: decoded.evidenceDigestHex }) };
    } });
    const verified = await handler({ method: "attestDeposit", peerRole: "BRIDGE_VALIDATOR", operationId: decoded.operationIdHex, payload });
    const signed = attesterA.signDepositCredit(verified);
    assert.equal(verifyProjectAttestation(signed, encoded), true);
  } finally { attesterA.close(); attesterB.close(); }
});

test("attester signing key and policy are isolated from caller mutation", () => {
  const key = createEphemeralAttesterKeypairForTestOnly();
  const policy = policyFor("ATTESTER_A", key, { hardStop: true });
  const attester = new ProjectAttester({ role: "ATTESTER_A", secretKey: key.secretKey, policy });
  policy.hardStop = false;
  policy.acceptedNativeTrust.push("RPC_OBSERVATION");
  assert.equal(attester.secretKey, undefined);
  assert.equal(Object.keys(attester).includes("secretKey"), false);
  assert.throws(() => { attester.policy.hardStop = false; }, TypeError);
  assert.throws(() => { attester.policy = policy; }, TypeError);
  assert.throws(() => attester.policy.acceptedNativeTrust.push("RPC_OBSERVATION"), TypeError);
  assert.throws(() => attester.signDepositCredit(request(), 1_700_000_600), /HARD_STOP_ACTIVE/u);
  attester.close();
});

test("attester snapshots external key bytes and close permanently stops signing", () => {
  const key = createEphemeralAttesterKeypairForTestOnly();
  const attester = new ProjectAttester({ role: "ATTESTER_A", secretKey: key.secretKey, policy: policyFor("ATTESTER_A", key) });
  key.secretKey.fill(0);
  attester.publicKey.fill(0);
  assert.equal(verifyProjectAttestation(attester.signDepositCredit(request(), 1_700_000_600), request().encodedMessageHex), true);
  attester.close();
  assert.throws(() => attester.signDepositCredit(request(), 1_700_000_600), /AttesterClosed/u);
});

test("omitted attestation clock cannot bypass an expired message", () => {
  const { attesterA } = runtime();
  const encoded = encodeCanonicalBridgeMessage({ ...decodedDeposit, operationId: undefined, validFrom: 1n, validUntil: 2n });
  const decoded = decodeCanonicalBridgeMessage(encoded);
  const expired = request({ encodedMessageHex: bytesToHex(encoded), messageDigestHex: decoded.messageDigestHex });
  assert.throws(() => attesterA.signDepositCredit(expired), /MESSAGE_EXPIRED/u);
  attesterA.close();
});

test("A+B project attestations sign exactly the same canonical deposit message", () => {
  const { keyA, keyB, attesterA, attesterB } = runtime();
  const first = attesterA.signDepositCredit(request(), 1_700_000_600);
  const second = attesterB.signDepositCredit(request(), 1_700_000_600);

  assert.equal(first.messageDigestHex, depositVector.messageDigest);
  assert.equal(second.messageDigestHex, depositVector.messageDigest);
  assert.equal(verifyProjectAttestation(first, depositVector.encodedHex), true);
  assert.equal(verifyProjectAttestation(second, depositVector.encodedHex), true);

  const combined = combineProjectAttestations({
    attestations: [first, second],
    encodedMessageHex: depositVector.encodedHex,
    authorizedAttesterPublicKeys: [keyA.publicKeyHex, keyB.publicKeyHex],
  });
  assert.equal(combined.state, "VERIFIED_READY");
  assert.equal(combined.threshold, 2);
  assert.deepEqual(combined.attesterPublicKeys, [keyA.publicKeyHex, keyB.publicKeyHex].sort());
});

test("one attester or the same attester twice does not satisfy PROJECT_ATTESTED_2_OF_2", () => {
  const { keyA, keyB, attesterA } = runtime();
  const signed = attesterA.signDepositCredit(request(), 1_700_000_600);

  assert.throws(
    () =>
      combineProjectAttestations({
        attestations: [signed],
        encodedMessageHex: depositVector.encodedHex,
        authorizedAttesterPublicKeys: [keyA.publicKeyHex, keyB.publicKeyHex],
      }),
    /ThresholdNotMet/u,
  );
  assert.throws(
    () =>
      combineProjectAttestations({
        attestations: [signed, signed],
        encodedMessageHex: depositVector.encodedHex,
        authorizedAttesterPublicKeys: [keyA.publicKeyHex, keyB.publicKeyHex],
      }),
    /DuplicateAttester/u,
  );
});

test("attesters reject missing or invalid Native reserve evidence before signing", () => {
  const { keyA } = runtime();
  const policy = policyFor("ATTESTER_A", keyA);

  const rpcOnly = evaluateDepositCredit({
    policy,
    nowUnix: 1_700_000_600,
    request: request({ evidence: evidence({ trust: "RPC_OBSERVATION" }) }),
  });
  assert.equal(rpcOnly.state, "WAITING_FOR_DEPENDENCY");
  assert.equal(rpcOnly.reason, "NATIVE_TRUST_NOT_ACCEPTED");

  const recoverable = evaluateDepositCredit({
    policy,
    nowUnix: 1_700_000_600,
    request: request({ evidence: evidence({ reserveTransitionState: "TEMPORARY_RECOVERABLE" }) }),
  });
  assert.equal(recoverable.state, "WAITING_FOR_DEPENDENCY");
  assert.equal(recoverable.reason, "RESERVE_TRANSITION_NOT_CANONICAL");

  const wrongAmount = evaluateDepositCredit({
    policy,
    nowUnix: 1_700_000_600,
    request: request({ evidence: evidence({ amountAtomic: "12346" }) }),
  });
  assert.equal(wrongAmount.state, "REJECTED");
  assert.equal(wrongAmount.reason, "AMOUNT_MISMATCH");
});

test("attestation signatures are invalid if the canonical bytes change", () => {
  const { attesterA } = runtime();
  const signed = attesterA.signDepositCredit(request(), 1_700_000_600);
  const mutated = `${depositVector.encodedHex.slice(0, -2)}00`;
  assert.equal(verifyProjectAttestation(signed, mutated), false);
});

test("policy domain mismatch and expired messages fail closed", () => {
  const key = createEphemeralAttesterKeypairForTestOnly();
  assert.throws(
    () =>
      new ProjectAttester({
        role: "ATTESTER_A",
        secretKey: key.secretKey,
        policy: policyFor("ATTESTER_B", key),
      }),
    /AttesterPolicyIdentityMismatch/u,
  );

  const attester = new ProjectAttester({
    role: "ATTESTER_A",
    secretKey: key.secretKey,
    policy: policyFor("ATTESTER_A", key),
  });
  assert.throws(() => attester.signDepositCredit(request(), 1_700_002_000), /MESSAGE_EXPIRED/u);
});
