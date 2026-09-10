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
