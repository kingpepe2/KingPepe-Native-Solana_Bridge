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
  createLocalNativeDkgPolicy,
  createNativeFrostSigningRequest,
  evaluateNativeSigningPolicy,
  nativeSigningIntentDigest,
  runTwoPartyDkg,
  sha256Canonical,
  validateNativeSigningIntent,
  validateNativeFrostSigningRequest,
} from "../index.mjs";
import { REGTEST_GENESIS } from "../../node/native-raw-evidence.mjs";

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
    nativeGenesisHash: REGTEST_GENESIS,
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

function makePolicy(auth, overrides = {}) {
  return createNativeSigningPolicy({
    environment: "localnet",
    nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: h("solana-local-deployment"),
    bridgeProgramId: h("bridge-program-id"),
    transceiverProgramId: h("transceiver-program-id"),
    mint: h("kpepe-mint"),
    keyEpoch: 1,
    maxAmountAtomic: "10000000000",
    maxFeeAtomic: "100000",
    reserveScriptPubKeyHex: p2tr("reserve"),
    authorizedOperations: [auth],
    ...overrides,
  });
}

test("Native signing policy cannot enable Mainnet through matching configuration", () => {
  assert.throws(() => makePolicy(baseAuthorization(), { nativeNetwork: "mainnet" }), /RegtestOnly/u);
});

test("Native signing policy pins the verified REGTEST genesis", () => {
  assert.throws(() => makePolicy(baseAuthorization(), { nativeGenesisHash: h("different-genesis") }), /RegtestGenesis/u);
});

test("Native signing policy rejects an unbranded caller-built authorization Map", () => {
  const auth = baseAuthorization();
  const policy = makePolicy(auth);
  const forged = { ...policy, authorizedOperations: new Map([[auth.signingRequestId, auth]]) };
  assert.throws(() => evaluateNativeSigningPolicy(forged, intentFromAuthorization(auth)), /PolicySnapshotRequired/u);
});

test("Native signing authorization collection cannot enroll an operation after creation", () => {
  const auth = baseAuthorization();
  const policy = makePolicy(auth, { authorizedOperations: [] });
  assert.equal(evaluateNativeSigningPolicy(policy, intentFromAuthorization(auth)).result, "REJECTED");
  assert.throws(() => policy.authorizedOperations.set(auth.signingRequestId, auth), TypeError);
  assert.equal(evaluateNativeSigningPolicy(policy, intentFromAuthorization(auth)).result, "REJECTED");
});

for (const environment of [undefined, "devnet", "mainnet"]) {
  test(`Native signing policy rejects environment ${String(environment)}`, () => {
    assert.throws(() => makePolicy(baseAuthorization(), { environment }), /LocalnetOnly/u);
  });
}

for (const [flag, value] of [
  ["productionReady", true], ["productionSigningAuthorized", true],
  ["productionBroadcastAuthorized", true], ["mainnetActivation", "ENABLED"],
]) {
  test(`Native signing policy cannot enable ${flag}`, () => {
    assert.throws(() => makePolicy(baseAuthorization(), { [flag]: value }), /ActivationDisabled/u);
  });
}

test("Native signing policy is a frozen, detached authorization snapshot", () => {
  const auth = baseAuthorization();
  const original = intentFromAuthorization(structuredClone(auth));
  const operations = [auth];
  const overrides = { authorizedOperations: operations };
  const policy = makePolicy(auth, overrides);
  auth.amountAtomic = "1";
  auth.inputOutpoints[0] = outpoint("substituted-input");
  auth.outputCommitments[0] = h("substituted-output");
  operations.push(baseAuthorization({ signingRequestId: h("extra-request") }));
  overrides.maxFeeAtomic = "0";
  assert.equal(evaluateNativeSigningPolicy(policy, original).result, "APPROVED");
  assert.equal(evaluateNativeSigningPolicy(policy, intentFromAuthorization(auth)).result, "REJECTED");
  assert.throws(() => { policy.nativeNetwork = "mainnet"; }, TypeError);
  assert.throws(() => { policy.productionSigningAuthorized = true; }, TypeError);
  assert.throws(() => policy.authorizedOperations.push(auth), TypeError);
  assert.throws(() => { policy.authorizedOperations[0].amountAtomic = "1"; }, TypeError);
  assert.throws(() => { policy.authorizedOperations[0].inputOutpoints[0] = outpoint("other"); }, TypeError);
  assert.throws(() => { policy.authorizedOperations[0].outputCommitments[0] = h("other"); }, TypeError);
  assert.equal(evaluateNativeSigningPolicy(policy, original).result, "APPROVED");
});

test("cloning or inheriting a valid policy does not manufacture a signing capability", () => {
  const auth = baseAuthorization();
  const policy = makePolicy(auth);
  for (const forged of [structuredClone(policy), Object.create(policy), new Proxy(policy, {})]) {
    assert.throws(() => evaluateNativeSigningPolicy(forged, intentFromAuthorization(auth)), /PolicySnapshotRequired/u);
  }
});

test("signer rejects forged policy before opening any state", () => {
  let loaded = false;
  const policy = makePolicy(baseAuthorization());
  assert.throws(() => new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0,
    policy: { ...policy }, stateStore: { load() { loaded = true; throw new Error("UnexpectedStateRead"); } } }),
  /PolicySnapshotRequired/u);
  assert.equal(loaded, false);
});

test("policy rejects duplicate request identifiers instead of replacing authorization", () => {
  const auth = baseAuthorization();
  assert.throws(() => makePolicy(auth, { authorizedOperations: [auth, { ...auth, amountAtomic: "1" }] }), /DuplicateRequest/u);
});

for (const field of ["amountAtomic", "feeAtomic", "changeAtomic"]) {
  test(`policy and intent reject oversized or ambiguous ${field}`, () => {
    for (const value of ["18446744073709551616", "9".repeat(100_000), "01", "1e2", "-1", 1]) {
      const auth = baseAuthorization({ [field]: value });
      assert.throws(() => makePolicy(auth), /canonical u64/u);
      assert.throws(() => validateNativeSigningIntent(intentFromAuthorization(auth)), /canonical u64/u);
    }
  });
}

test("policy caps reject u64 overflow and preserve exact boundary values", () => {
  for (const field of ["maxAmountAtomic", "maxFeeAtomic"]) {
    assert.throws(() => makePolicy(baseAuthorization(), { [field]: "18446744073709551616" }), /canonical u64/u);
  }
  const auth = baseAuthorization({ amountAtomic: "18446744073709551615", feeAtomic: "0", changeAtomic: "0" });
  const policy = makePolicy(auth, { maxAmountAtomic: auth.amountAtomic });
  assert.equal(evaluateNativeSigningPolicy(policy, intentFromAuthorization(auth)).result, "APPROVED");
});

test("policy and intent epochs are bounded to positive u32", () => {
  for (const keyEpoch of [0, -1, 1.5, 0x1_0000_0000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => makePolicy(baseAuthorization(), { keyEpoch }), /positive u32/u);
    assert.throws(() => validateNativeSigningIntent(intentFromAuthorization(baseAuthorization(), { keyEpoch })), /positive u32/u);
  }
  const auth = baseAuthorization();
  assert.equal(evaluateNativeSigningPolicy(makePolicy(auth, { keyEpoch: 0xffff_ffff }),
    intentFromAuthorization(auth, { keyEpoch: 0xffff_ffff })).result, "APPROVED");
});

test("policy and intent reject noncanonical, overflowing and duplicate outpoints", () => {
  for (const inputOutpoints of [[`${h("input")}:00`], [`${h("input")}:4294967296`],
    [`${h("input")}:${"9".repeat(100_000)}`], [outpoint("input"), outpoint("input")]]) {
    const auth = baseAuthorization({ inputOutpoints });
    assert.throws(() => makePolicy(auth), /outpoint/u);
    assert.throws(() => validateNativeSigningIntent(intentFromAuthorization(auth)), /outpoint/u);
  }
  const auth = baseAuthorization({ inputOutpoints: [outpoint("input", 0xffff_ffff)] });
  assert.equal(evaluateNativeSigningPolicy(makePolicy(auth), intentFromAuthorization(auth)).result, "APPROVED");
});

for (const field of ["recipientScriptPubKeyHex", "changeScriptPubKeyHex"]) {
  test(`policy and intent require bounded nonempty ${field}`, () => {
    for (const value of ["", "51".repeat(10_001)]) {
      const auth = baseAuthorization({ [field]: value });
      assert.throws(() => makePolicy(auth), /bounded nonempty/u);
      assert.throws(() => validateNativeSigningIntent(intentFromAuthorization(auth)), /bounded nonempty/u);
    }
  });
}

test("policy and intent enforce bounded dense operation, input and output arrays", () => {
  const auth = baseAuthorization();
  assert.throws(() => makePolicy(auth, { authorizedOperations: Array(257).fill(auth) }), /BoundedArray/u);
  for (const field of ["inputOutpoints", "outputCommitments"]) {
    for (const value of [Array(257).fill(auth[field][0]), Array(1), new Proxy(auth[field], {})]) {
      const altered = { ...auth, [field]: value };
      assert.throws(() => makePolicy(altered), /ArrayRequired/u);
      assert.throws(() => validateNativeSigningIntent(intentFromAuthorization(altered)), /ArrayRequired/u);
    }
  }
});

test("authorization validation rejects impossible indexes, empty outputs and zero amount", () => {
  for (const overrides of [{ signingInputIndex: 2 }, { signingInputIndex: -1 }, { outputCommitments: [] }, { amountAtomic: "0" }]) {
    assert.throws(() => makePolicy(baseAuthorization(overrides)), /input|outputs|output commitments|amount/u);
  }
});

test("intent stop and pause flags cannot turn missing or malformed evidence into false", () => {
  for (const flag of ["hardStop", "pauseWithdrawals"]) {
    for (const value of [undefined, null, 0, "false", "true"]) {
      assert.throws(() => validateNativeSigningIntent(intentFromAuthorization(baseAuthorization(), { [flag]: value })), /boolean/u);
    }
    const auth = baseAuthorization();
    assert.equal(evaluateNativeSigningPolicy(makePolicy(auth), intentFromAuthorization(auth, { [flag]: true })).result, "REJECTED");
  }
});

test("policy and intent reject accessors without running caller code", () => {
  let reads = 0;
  const auth = baseAuthorization();
  Object.defineProperty(auth, "amountAtomic", { get() { reads += 1; return "1"; } });
  assert.throws(() => makePolicy(auth), /PlainDataRequired/u);
  const intent = intentFromAuthorization(baseAuthorization());
  Object.defineProperty(intent, "hardStop", { get() { reads += 1; return false; } });
  assert.throws(() => validateNativeSigningIntent(intent), /PlainDataRequired/u);
  const options = {};
  Object.defineProperty(options, "environment", { get() { reads += 1; return "localnet"; } });
  assert.throws(() => createNativeSigningPolicy(options), /PlainDataRequired/u);
  const outpoints = [outpoint("input")];
  Object.defineProperty(outpoints, "0", { get() { reads += 1; return outpoint("other"); } });
  assert.throws(() => makePolicy(baseAuthorization({ inputOutpoints: outpoints })), /PlainArrayRequired/u);
  assert.equal(reads, 0);
});

test("policy rejects proxies and custom prototypes before reading policy values", () => {
  let reads = 0;
  const proxy = new Proxy({}, { get() { reads += 1; return "localnet"; } });
  assert.throws(() => createNativeSigningPolicy(proxy), /PlainDataRequired/u);
  assert.throws(() => makePolicy(Object.create(baseAuthorization())), /PlainDataRequired/u);
  assert.equal(reads, 0);
});

test("frozen normalized intent stays detached from later array changes", () => {
  const raw = intentFromAuthorization(baseAuthorization());
  const normalized = validateNativeSigningIntent(raw);
  const digest = nativeSigningIntentDigest(normalized);
  raw.inputOutpoints[0] = outpoint("other");
  raw.outputCommitments[0] = h("other");
  assert.equal(nativeSigningIntentDigest(normalized), digest);
  assert.throws(() => normalized.inputOutpoints.push(outpoint("more")), TypeError);
});

function createRuntime(evidenceValidators = {}, policyOverride) {
  const root = withTempRoot();
  const auth = baseAuthorization();
  const policy = policyOverride ?? makePolicy(auth);
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

test("A and B each reject a nonlocal Native domain before reserving any nonce", () => {
  const runtime = createRuntime();
  try {
    for (const altered of [{ nativeNetwork: "mainnet" }, { nativeGenesisHash: h("different-genesis") }]) {
      const request = frostRequestFor(intentFromAuthorization(runtime.auth, altered));
      for (const signer of [runtime.signerA, runtime.signerB]) {
        assert.throws(() => signer.signingCommitment(request), /nativeDomain/u);
      }
    }
    for (const role of ["frost-a", "frost-b"]) {
      const state = JSON.parse(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"), "utf8"));
      assert.equal(state.nonceReservationCounter, "0");
      assert.equal(Object.keys(state.signing).length, 0);
      assert.equal(Object.keys(state.nonceTombstones).length, 0);
    }
  } finally { runtime.cleanup(); }
});

test("B without A cannot cause a threshold downgrade", () => {
  const runtime = createRuntime();
  try {
    runtime.signerA.setAvailableForTestOnly(false);
    const result = runtime.coordinator.signAutomatically(intentFromAuthorization(runtime.auth));
    assert.equal(result.state, "WAITING_FOR_QUORUM");
    assert.equal(result.available, 1);
    assert.equal(result.required, 2);
    assert.equal(result.signatureHex, undefined);
  } finally { runtime.cleanup(); }
});

test("explicit local DKG capability cannot sign, even after successful A+B setup", () => {
  const policy = createLocalNativeDkgPolicy({ environment: "localnet", nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: h("solana-local-deployment"), keyEpoch: 1 });
  const runtime = createRuntime({}, policy);
  try {
    const intent = intentFromAuthorization(runtime.auth);
    assert.throws(() => runtime.coordinator.signAutomatically(intent), /PolicySnapshotRequired/u);
    for (const signer of [runtime.signerA, runtime.signerB]) {
      assert.throws(() => signer.signingCommitment(frostRequestFor(intent)), /PolicySnapshotRequired/u);
      assert.throws(() => signer.signatureShare(frostRequestFor(intent), []), /PolicySnapshotRequired/u);
    }
    assert.throws(() => { policy.authorizedOperations = [runtime.auth]; }, TypeError);
    assert.throws(() => evaluateNativeSigningPolicy(policy, intent), /PolicySnapshotRequired/u);
  } finally { runtime.cleanup(); }
});

test("local DKG capability applies the same environment and activation guards", () => {
  const options = { environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: h("solana-local-deployment"), keyEpoch: 1 };
  for (const overrides of [{ environment: "mainnet" }, { nativeNetwork: "mainnet" },
    { nativeGenesisHash: h("another-network") }, { productionSigningAuthorized: true }]) {
    assert.throws(() => createLocalNativeDkgPolicy({ ...options, ...overrides }), /LocalnetOnly|RegtestOnly|RegtestGenesis|ActivationDisabled/u);
  }
});

for (const [name, change, reason] of [
  ["request ID", (r) => { r.requestId = h("substituted-request-id"); }, /FrostRequestBinding:requestId/u],
  ["epoch", (r) => { r.epoch = 2; }, /FrostRequestBinding:epoch/u],
  ["session ID", (r) => { r.sessionId = h("substituted-session-id"); }, /FrostRequestBinding:sessionId/u],
  ["attempt", (r) => { r.attempt = 0; }, /FrostRequestAttempt/u],
  ["participant order", (r) => { r.participantIds.reverse(); }, /FrostRequestParticipants/u],
  ["unknown field", (r) => { r.extra = true; }, /FrostRequestFields/u],
]) {
  test(`each signer rejects altered request ${name} before nonce reservation`, () => {
    const runtime = createRuntime();
    try {
      const request = frostRequestFor(intentFromAuthorization(runtime.auth));
      change(request);
      for (const signer of [runtime.signerA, runtime.signerB]) {
        assert.throws(() => signer.signingCommitment(request), reason);
        assert.throws(() => signer.signatureShare(request, []), reason);
      }
      for (const role of ["frost-a", "frost-b"]) {
        const state = JSON.parse(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"), "utf8"));
        assert.equal(state.nonceReservationCounter, "0");
        assert.equal(Object.keys(state.signing).length, 0);
      }
    } finally { runtime.cleanup(); }
  });
}

test("shared FROST request builder agrees with the independent V1 transcript fixture", () => {
  const intent = intentFromAuthorization(baseAuthorization());
  for (const attempt of [1, 2, 0xffff_ffff]) {
    const expected = frostRequestFor(intent, attempt);
    const request = createNativeFrostSigningRequest(intent, { attempt });
    assert.deepEqual(request, expected);
    assert.deepEqual(validateNativeFrostSigningRequest(expected), request);
    assert.equal(request.messageHex, intent.taprootSighashHex);
    assert.notEqual(request.messageHex, request.intentDigest);
  }
});

test("FROST request construction and wire validation reject malformed attempt values", () => {
  const intent = intentFromAuthorization(baseAuthorization());
  for (const attempt of [undefined, null, 0, -1, 1.5, "1", 0x1_0000_0000, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createNativeFrostSigningRequest(intent, { attempt }), /FrostRequestAttempt/u);
    assert.throws(() => validateNativeFrostSigningRequest({ ...frostRequestFor(intent), attempt }), /FrostRequestAttempt/u);
  }
  assert.equal(createNativeFrostSigningRequest(intent).attempt, 1);
});

test("FROST wire metadata must match the canonical intent and required field set", () => {
  const request = frostRequestFor(intentFromAuthorization(baseAuthorization()));
  for (const field of ["protocol", "intentDigest", "messageHex"]) {
    assert.throws(() => validateNativeFrostSigningRequest({ ...request, [field]: h("substituted") }),
      new RegExp(`FrostRequestBinding:${field}`, "u"));
  }
  for (const field of Object.keys(request)) {
    const missing = { ...request };
    delete missing[field];
    assert.throws(() => validateNativeFrostSigningRequest(missing), /FrostRequestFields/u);
  }
  for (const participantIds of [[], [REQUIRED_FROST_SIGNERS[0]], [REQUIRED_FROST_SIGNERS[0], REQUIRED_FROST_SIGNERS[0]],
    [REQUIRED_FROST_SIGNERS[1], REQUIRED_FROST_SIGNERS[0]]]) {
    assert.throws(() => validateNativeFrostSigningRequest({ ...request, participantIds }), /FrostRequestParticipants/u);
  }
});

test("FROST request snapshots remain immutable when original data is modified", () => {
  const intent = intentFromAuthorization(baseAuthorization());
  const raw = frostRequestFor(intent);
  const snapshot = validateNativeFrostSigningRequest(raw);
  raw.intent.amountAtomic = "1";
  raw.intent.inputOutpoints[0] = outpoint("different");
  raw.participantIds.reverse();
  assert.equal(snapshot.intent.amountAtomic, "250000000");
  assert.deepEqual(snapshot.participantIds, REQUIRED_FROST_SIGNERS);
  assert.deepEqual(validateNativeFrostSigningRequest(snapshot), snapshot);
  assert.throws(() => { snapshot.attempt = 2; }, TypeError);
  assert.throws(() => { snapshot.intent.amountAtomic = "1"; }, TypeError);
  assert.throws(() => snapshot.participantIds.reverse(), TypeError);
  assert.throws(() => snapshot.intent.inputOutpoints.push(outpoint("extra")), TypeError);
});

test("request accessors and participant iterators cannot run during validation", () => {
  let calls = 0;
  const request = frostRequestFor(intentFromAuthorization(baseAuthorization()));
  Object.defineProperty(request, "requestId", { get() { calls += 1; return h("unexpected"); } });
  assert.throws(() => validateNativeFrostSigningRequest(request), /PlainDataRequired/u);
  const iterated = frostRequestFor(intentFromAuthorization(baseAuthorization()));
  iterated.participantIds[Symbol.iterator] = () => { calls += 1; return [][Symbol.iterator](); };
  assert.throws(() => validateNativeFrostSigningRequest(iterated), /PlainArrayRequired/u);
  assert.equal(calls, 0);
});

test("request and policy rejection happen before any signing-state load", () => {
  let loads = 0;
  const auth = baseAuthorization();
  const signer = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0, policy: makePolicy(auth),
    stateStore: { load() { loads += 1; return { signerId: REQUIRED_FROST_SIGNERS[0] }; } } });
  assert.equal(loads, 1);
  const badBinding = { ...frostRequestFor(intentFromAuthorization(auth)), requestId: h("wrong-request") };
  const badPolicy = frostRequestFor(intentFromAuthorization(auth, { amountAtomic: "1" }));
  for (const request of [badBinding, badPolicy]) {
    assert.throws(() => signer.signingCommitment(request), /FrostRequestBinding|authorizedOperationExact/u);
    assert.throws(() => signer.signatureShare(request, []), /FrostRequestBinding|authorizedOperationExact/u);
  }
  assert.equal(loads, 1);
});

test("an altered share request cannot consume an already reserved valid nonce", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    const a = runtime.signerA.signingCommitment(request);
    const b = runtime.signerB.signingCommitment(request);
    const altered = { ...request, attempt: 2 };
    for (const signer of [runtime.signerA, runtime.signerB]) {
      assert.throws(() => signer.signatureShare(altered, [a, b]), /FrostRequestBinding:sessionId/u);
    }
    for (const role of ["frost-a", "frost-b"]) {
      const state = JSON.parse(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"), "utf8"));
      assert.equal(state.signing[request.sessionId].state, "RESERVED");
      assert.equal(state.nonceReservationCounter, "1");
    }
    assert.equal(runtime.coordinator.signAutomatically(request.intent).state, "SIGNED");
  } finally { runtime.cleanup(); }
});

test("coordinator rejects getter-backed intent without calling user code", async () => {
  const runtime = createRuntime();
  try {
    let calls = 0;
    const intent = intentFromAuthorization(runtime.auth);
    Object.defineProperty(intent, "taprootSighashHex", { get() { calls += 1; return runtime.auth.taprootSighashHex; } });
    assert.throws(() => runtime.coordinator.signAutomatically(intent), /PlainDataRequired/u);
    await assert.rejects(() => runtime.coordinator.signAutomaticallyWithNativeEvidence(intent), /PlainDataRequired/u);
    assert.equal(calls, 0);
  } finally { runtime.cleanup(); }
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
