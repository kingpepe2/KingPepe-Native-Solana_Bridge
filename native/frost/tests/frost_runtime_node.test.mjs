import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  FROST_SIGNING_INTENT_PROTOCOL,
  FROST_SIGNING_MODE,
  FileBackedFrostStateStore,
  NativeFrostCoordinator,
  NativeFrostSigner,
  REQUIRED_FROST_SIGNERS,
  createNativeSigningPolicy,
  nativeSigningIntentDigest,
  runTwoPartyDkg,
  sha256Canonical,
} from "../index.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

function outpoint(label, index = 0) {
  return `${h(label)}:${index}`;
}

function withTempRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "kingpepe-frost-phase04-"));
}

function baseAuthorization(overrides = {}) {
  const signingRequestId = h("signing-request");
  return {
    signingRequestId,
    operationId: h("operation"),
    withdrawalId: h("withdrawal"),
    taprootSighashHex: h("taproot-sighash"),
    transactionCommitment: h("native-transaction-commitment"),
    signingInputIndex: 0,
    recipientScriptPubKeyHex: p2tr("recipient"),
    amountAtomic: "250000000",
    feeAtomic: "1200",
    changeScriptPubKeyHex: p2tr("reserve"),
    changeAtomic: "750000000",
    inputOutpoints: [outpoint("input-a", 0), outpoint("input-b", 1)],
    outputCommitments: [h("recipient-output"), h("reserve-change-output")],
    reserveCommitment: h("reserve-commitment"),
    ...overrides,
  };
}

function intentFromAuthorization(auth, overrides = {}) {
  return {
    protocol: FROST_SIGNING_INTENT_PROTOCOL,
    mode: FROST_SIGNING_MODE,
    purpose: "WITHDRAWAL",
    nativeNetwork: "regtest",
    nativeGenesisHash: h("kingpepe-regtest-genesis"),
    solanaDeployment: h("solana-local-deployment"),
    bridgeProgramId: h("bridge-program-id"),
    transceiverProgramId: h("transceiver-program-id"),
    mint: h("kpepe-mint"),
    keyEpoch: 1,
    signingRequestId: auth.signingRequestId,
    operationId: auth.operationId,
    withdrawalId: auth.withdrawalId,
    proofFingerprint: h("finalized-withdrawal-proof"),
    unsignedNativeTransactionId: h("unsigned-native-txid"),
    transactionCommitment: auth.transactionCommitment,
    signingInputIndex: 0,
    taprootSighashHex: auth.taprootSighashHex,
    recipientScriptPubKeyHex: auth.recipientScriptPubKeyHex,
    amountAtomic: auth.amountAtomic,
    feeAtomic: auth.feeAtomic,
    changeScriptPubKeyHex: auth.changeScriptPubKeyHex,
    changeAtomic: auth.changeAtomic,
    inputOutpoints: auth.inputOutpoints,
    outputCommitments: auth.outputCommitments,
    reserveCommitment: auth.reserveCommitment,
    pauseWithdrawals: false,
    hardStop: false,
    ...overrides,
  };
}

function makePolicy(auth) {
  return createNativeSigningPolicy({
    nativeNetwork: "regtest",
    nativeGenesisHash: h("kingpepe-regtest-genesis"),
    solanaDeployment: h("solana-local-deployment"),
    bridgeProgramId: h("bridge-program-id"),
    transceiverProgramId: h("transceiver-program-id"),
    mint: h("kpepe-mint"),
    keyEpoch: 1,
    maxAmountAtomic: "10000000000",
    maxFeeAtomic: "100000",
    reserveScriptPubKeyHex: p2tr("reserve"),
    authorizedOperations: [auth],
  });
}

function createRuntime(evidenceValidators = {}) {
  const root = withTempRoot();
  const auth = baseAuthorization();
  const policy = makePolicy(auth);
  const storeA = new FileBackedFrostStateStore({
    signerId: REQUIRED_FROST_SIGNERS[0],
    root: path.join(root, "frost-a"),
    repoRoot: REPO_ROOT,
  });
  const storeB = new FileBackedFrostStateStore({
    signerId: REQUIRED_FROST_SIGNERS[1],
    root: path.join(root, "frost-b"),
    repoRoot: REPO_ROOT,
  });
  const signerA = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0, policy, stateStore: storeA,
    nativeEvidenceValidator: evidenceValidators.A });
  const signerB = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[1], index: 1, policy, stateStore: storeB,
    nativeEvidenceValidator: evidenceValidators.B });
  const epoch = runTwoPartyDkg([signerA, signerB], { epoch: 1 });
  const coordinator = new NativeFrostCoordinator({
    signers: [signerA, signerB],
    publicPackage: epoch.publicPackage,
    aggregateTweakedXOnlyPublicKey: epoch.aggregateTweakedXOnlyPublicKey,
  });
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, auth, policy, signerA, signerB, epoch, coordinator, cleanup };
}

function frostRequestFor(intent, attempt = 1) {
  const intentDigest = nativeSigningIntentDigest(intent);
  const participantIds = [...REQUIRED_FROST_SIGNERS];
  const messageHex = intent.taprootSighashHex.toLowerCase();
  return {
    protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_REQUEST/V1",
    requestId: intent.signingRequestId,
    epoch: intent.keyEpoch,
    attempt,
    sessionId: sha256Canonical({
      protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_SESSION/V1",
      requestId: intent.signingRequestId,
      epoch: intent.keyEpoch,
      attempt,
      intentDigest,
      messageHex,
      participantIds,
    }),
    intent,
    intentDigest,
    messageHex,
    participantIds,
  };
}

test("A+B DKG produces one valid BIP340 Taproot-compatible FROST signature", () => {
  const runtime = createRuntime();
  try {
    const intent = intentFromAuthorization(runtime.auth);
    const result = runtime.coordinator.signAutomatically(intent);
    assert.equal(result.state, "SIGNED");
    assert.equal(result.signerIds.join(","), REQUIRED_FROST_SIGNERS.join(","));
    assert.match(result.signatureHex, /^[0-9a-f]{128}$/u);
    assert.match(runtime.epoch.aggregateTweakedXOnlyPublicKey, /^[0-9a-f]{64}$/u);
    assert.equal(
      schnorr.verify(
        Uint8Array.from(Buffer.from(result.signatureHex, "hex")),
        Uint8Array.from(Buffer.from(result.messageHex, "hex")),
        Uint8Array.from(Buffer.from(runtime.epoch.aggregateTweakedXOnlyPublicKey, "hex")),
      ),
      true,
    );
  } finally {
    runtime.cleanup();
  }
});

test("configured signer evidence fences cannot be bypassed with synchronous coordination or A-only verification", async () => {
  const calls = [];
  const validator = (role) => async (intent) => { calls.push(role); return { digestHex: intent.proofFingerprint }; };
  const runtime = createRuntime({ A: validator("A"), B: validator("B") });
  try {
    const intent = intentFromAuthorization(runtime.auth);
    assert.throws(() => runtime.coordinator.signAutomatically(intent), /FROST fresh independent Native evidence required/u);
    await runtime.signerA.verifyNativeEvidence(intent);
    assert.throws(() => runtime.signerB.signingCommitment(frostRequestFor(intent)), /FROST fresh independent Native evidence required/u);
    const pending = runtime.coordinator.signAutomaticallyWithNativeEvidence(intent);
    // Caller's mutation cannot alter the authorization snapshot while awaiting RPC.
    intent.amountAtomic = "1";
    const result = await pending;
    assert.equal(result.state, "SIGNED");
    assert.deepEqual(calls, ["A", "A", "B"]);
  } finally { runtime.cleanup(); }
});

test("each participant fails closed when Native evidence is absent, changed or unavailable", async () => {
  for (const badRole of ["A", "B"]) {
    for (const behavior of ["missing", "changed", "outage"]) {
      const good = async (intent) => ({ digestHex: intent.proofFingerprint });
      const validators = { A: good, B: good };
      validators[badRole] = behavior === "missing" ? undefined : async () => {
        if (behavior === "outage") throw new Error("TEST_SOURCE_UNAVAILABLE");
        return { digestHex: h("substituted-proof") };
      };
      const runtime = createRuntime(validators);
      try {
        await assert.rejects(() => runtime.coordinator.signAutomaticallyWithNativeEvidence(intentFromAuthorization(runtime.auth)),
          /verifier required|evidence digest mismatch|TEST_SOURCE_UNAVAILABLE/u);
      } finally { runtime.cleanup(); }
    }
  }
});

test("single participants and the coordinator alone cannot complete signing", () => {
  const runtime = createRuntime();
  try {
    const intent = intentFromAuthorization(runtime.auth);
    runtime.signerB.setAvailableForTestOnly(false);
    const waiting = runtime.coordinator.signAutomatically(intent);
    assert.equal(waiting.state, "WAITING_FOR_QUORUM");
    assert.equal(waiting.available, 1);
    assert.equal(waiting.required, 2);

    runtime.signerB.setAvailableForTestOnly(true);
    const request = frostRequestFor(intent, 2);
    const aCommitment = runtime.signerA.signingCommitment(request);
    assert.throws(() => runtime.signerA.signatureShare(request, [aCommitment]), /commitment set must include A\+B/u);
    assert.throws(() => new NativeFrostCoordinator({ signers: [runtime.signerA], publicPackage: runtime.epoch.publicPackage, aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey }), /missing required FROST signer/u);
  } finally {
    runtime.cleanup();
  }
});

test("each signer rejects altered transaction policy fields before producing a share", () => {
  const cases = [
    ["wrong sighash", { taprootSighashHex: h("wrong-sighash") }, /authorizedOperationExact/u],
    ["wrong epoch", { keyEpoch: 2 }, /active key|keyEpoch/u],
    ["wrong deployment", { solanaDeployment: h("wrong-deployment") }, /solanaDomain/u],
    ["wrong recipient", { recipientScriptPubKeyHex: p2tr("wrong-recipient") }, /authorizedOperationExact/u],
    ["wrong amount", { amountAtomic: "250000001" }, /authorizedOperationExact/u],
    ["wrong fee", { feeAtomic: "1201" }, /authorizedOperationExact/u],
    ["wrong change script", { changeScriptPubKeyHex: p2tr("wrong-reserve") }, /reserveChangeScriptExact|authorizedOperationExact/u],
    ["wrong change amount", { changeAtomic: "749999999" }, /authorizedOperationExact/u],
  ];

  for (const [name, overrides, pattern] of cases) {
    const runtime = createRuntime();
    try {
      const intent = intentFromAuthorization(runtime.auth, overrides);
      assert.throws(() => runtime.coordinator.signAutomatically(intent), pattern, name);
    } finally {
      runtime.cleanup();
    }
  }
});

test("nonce state is persisted before commitments and tombstoned after share generation", () => {
  const runtime = createRuntime();
  try {
    const intent = intentFromAuthorization(runtime.auth);
    const first = runtime.coordinator.signAutomatically(intent);
    const retry = runtime.coordinator.signAutomatically(intent);
    assert.equal(retry.signatureHex, first.signatureHex);

    for (const role of ["frost-a", "frost-b"]) {
      const state = JSON.parse(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"), "utf8"));
      const sessions = Object.values(state.signing);
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].state, "SIGNED");
      assert.equal(sessions[0].nonce, undefined);
      const tombstones = Object.values(state.nonceTombstones);
      assert.equal(tombstones.length, 1);
      assert.equal(tombstones[0].state, "CONSUMED");
      assert.equal(tombstones[0].outcome, "SHARE_PERSISTED");
    }

    const altered = intentFromAuthorization(runtime.auth, { taprootSighashHex: h("altered-after-completion") });
    assert.throws(() => runtime.coordinator.signAutomatically(altered), /altered message|authorizedOperationExact/u);
  } finally {
    runtime.cleanup();
  }
});

test("runtime rejects signer state roots inside the source repository", () => {
  const insideRepo = path.join(REPO_ROOT, "frost-state", "bad");
  assert.throws(
    () => new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0], root: insideRepo, repoRoot: REPO_ROOT }),
    /outside the source repository/u,
  );
});
