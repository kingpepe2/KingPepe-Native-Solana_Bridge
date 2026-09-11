import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
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
  createTwoPartyDkgRequest,
  evaluateNativeSigningPolicy,
  nativeSigningIntentDigest,
  runTwoPartyDkg,
  sha256Canonical,
  validateNativeSigningIntent,
  validateNativeFrostSigningRequest,
} from "../index.mjs";
import { REGTEST_GENESIS } from "../../node/native-raw-evidence.mjs";
import { validateNativeFrostDkgRequest } from "../policy/dkg-request.mjs";
import { initialSignerState } from "../state/file-state-store.mjs";
import { initialCoordinatorSigningState, decodeCoordinatorSigningState, MAX_COORDINATOR_REQUESTS,
  requireCoordinatorSigningJournal } from "../coordinator/protected-signing-journal.mjs";
import { createNativeFrostAbortReceipt } from "../policy/signing-request.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

test("coordinator construction requires the exact A+B set without extra signers", () => {
  const [a, b] = REQUIRED_FROST_SIGNERS;
  for (const ids of [[], [a], [b], [a, b, "UNAUTHORIZED_PARTICIPANT"], [a, "UNAUTHORIZED_PARTICIPANT"], [a, a]]) {
    assert.throws(() => new NativeFrostCoordinator({ signers: ids.map(signerId => ({ signerId })),
      publicPackage: {}, aggregateTweakedXOnlyPublicKey: "01".repeat(32) }));
  }
});

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
    proofFingerprint: h("finalized-withdrawal-proof"),
    unsignedNativeTransactionId: h("unsigned-native-txid"),
    pauseWithdrawals: false,
    hardStop: false,
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
  return { ...auth, ...overrides };
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

function stateStoreFixture(t) {
  const root = withTempRoot();
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("kingpepe-frost-phase04-"));
    rmSync(root, { recursive: true, force: true });
  });
  const options = { signerId: REQUIRED_FROST_SIGNERS[0], root: path.join(root, "frost-a"), repoRoot: REPO_ROOT };
  return { root, options, file: path.join(options.root, "frost-signer-state.json"), policy: makePolicy(baseAuthorization()) };
}

test("missing FROST state cannot be read or saved as a fresh signer", t => {
  const { options, file } = stateStoreFixture(t);
  const store = new FileBackedFrostStateStore(options);
  assert.throws(() => store.load(), /FrostStateMissing/u);
  assert.throws(() => store.save(initialSignerState(options.signerId)), /FrostStateMissing/u);
  assert.equal(existsSync(file), false);
  assert.deepEqual(readdirSync(options.root), []);
});

test("explicit local state creation requires a genuine local runtime policy before filesystem access", t => {
  const { root, options, policy } = stateStoreFixture(t);
  for (const unapproved of [undefined, null, {}, { ...policy }, { ...policy, environment: "mainnet" }]) {
    assert.throws(() => FileBackedFrostStateStore.createLocal({ ...options, policy: unapproved }), /PolicySnapshotRequired/u);
    assert.deepEqual(readdirSync(root), []);
  }
});

test("explicit local state creation creates only an empty role-bound envelope and never overwrites", t => {
  const { options, file, policy } = stateStoreFixture(t);
  const store = FileBackedFrostStateStore.createLocal({ ...options, policy });
  assert.deepEqual(store.load(), JSON.parse(JSON.stringify(initialSignerState(options.signerId))));
  const original = readFileSync(file);
  assert.throws(() => FileBackedFrostStateStore.createLocal({ ...options, policy }), /FrostStateAlreadyExists/u);
  assert.equal(original.equals(readFileSync(file)), true, "Existing local state must remain unchanged");
  assert.deepEqual(readdirSync(options.root), ["frost-signer-state.json"]);
});

test("explicit local DKG-only state creation does not grant transaction authorization", t => {
  const { options } = stateStoreFixture(t);
  const policy = createLocalNativeDkgPolicy(dkgContextFixture());
  const store = FileBackedFrostStateStore.createLocal({ ...options, policy });
  const signer = new NativeFrostSigner({ signerId: options.signerId, index: 0, policy, stateStore: store });
  assert.throws(() => signer.signingCommitment(frostRequestFor(baseAuthorization())), /PolicySnapshotRequired/u);
  assert.deepEqual(store.load().dkg, {});
  assert.deepEqual(store.load().signing, {});
});

test("explicit creation rejects an unknown role before creating an external directory", t => {
  const { root, options, policy } = stateStoreFixture(t);
  for (const signerId of ["A", "B", "coordinator", undefined]) {
    assert.throws(() => FileBackedFrostStateStore.createLocal({ ...options, policy, signerId }), /FrostStateRoleInvalid/u);
    assert.deepEqual(readdirSync(root), []);
  }
});

test("explicit creation keeps the actual checkout boundary even with a genuine local policy", t => {
  const { options, policy } = stateStoreFixture(t);
  assert.throws(() => FileBackedFrostStateStore.createLocal({ ...options, policy, root: REPO_ROOT }), /InsideRepositoryRejected/u);
});

test("state creation rejects accessors without evaluating them or creating a directory", t => {
  const { root, options, policy } = stateStoreFixture(t);
  let reads = 0;
  Object.defineProperty(options, "policy", { enumerable: true, get() { reads += 1; return policy; } });
  assert.throws(() => FileBackedFrostStateStore.createLocal(options), /PlainDataRequired/u);
  assert.equal(reads, 0);
  assert.deepEqual(readdirSync(root), []);
});

test("missing enrolled signer file stops reopen and signing without replacing test keys", () => {
  const runtime = createRuntime();
  try {
    const options = { signerId: REQUIRED_FROST_SIGNERS[0], root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT };
    const store = new FileBackedFrostStateStore(options);
    const saved = store.load();
    const file = path.join(options.root, "frost-signer-state.json");
    const retained = path.join(options.root, "retained-test-state.json");
    renameSync(file, retained); // Preserve the isolated test material until fixture cleanup.
    const before = readFileSync(retained);
    assert.throws(() => store.load(), /FrostStateMissing/u);
    assert.throws(() => store.save(saved), /FrostStateMissing/u);
    assert.throws(() => new NativeFrostSigner({ signerId: options.signerId, index: 0, policy: runtime.policy,
      stateStore: new FileBackedFrostStateStore(options) }), /FrostStateMissing/u);
    assert.throws(() => runtime.signerA.dkgRound1(runtime.epoch.request), /FrostStateMissing/u);
    assert.throws(() => runtime.signerA.signingCommitment(frostRequestFor(runtime.auth)), /FrostStateMissing/u);
    assert.equal(existsSync(file), false);
    assert.equal(before.equals(readFileSync(retained)), true, "Retained test material must be unchanged");
    assert.deepEqual(readdirSync(options.root), ["retained-test-state.json"]);
  } finally { runtime.cleanup(); }
});

test("corrupt signer JSON is redacted and cannot be replaced through an ordinary save", t => {
  const { options, file, policy } = stateStoreFixture(t);
  const store = FileBackedFrostStateStore.createLocal({ ...options, policy });
  const stale = store.load();
  const marker = "SYNTHETIC_PRIVATE_CONTENT_MUST_NOT_APPEAR";
  writeFileSync(file, `{${marker}`, { flag: "w" }); // Synthetic malformed content, never an operational secret.
  for (const action of [() => store.load(), () => store.save(stale)]) {
    assert.throws(action, error => error.message === "FrostStateInvalidJson" && !error.stack.includes(marker) &&
      !error.stack.includes(options.root) && error.cause === undefined);
  }
  assert.equal(readFileSync(file, "utf8") === `{${marker}`, true);
  assert.deepEqual(readdirSync(options.root), ["frost-signer-state.json"]);
});

test("ordinary save cannot overwrite an incompatible or wrong-role existing state", t => {
  const { options, file, policy } = stateStoreFixture(t);
  const store = FileBackedFrostStateStore.createLocal({ ...options, policy });
  const stale = store.load();
  for (const changes of [{ format: "unsupported-format" }, { signerId: REQUIRED_FROST_SIGNERS[1] }]) {
    const raw = JSON.stringify({ ...stale, ...changes });
    writeFileSync(file, raw);
    assert.throws(() => store.load(), /state format|state role mismatch/u);
    assert.throws(() => store.save(stale), /state format|state role mismatch/u);
    assert.equal(readFileSync(file, "utf8") === raw, true);
  }
});

test("FROST state envelope rejects coerced counters and array records before saving", t => {
  const { options, file, policy } = stateStoreFixture(t);
  const store = FileBackedFrostStateStore.createLocal({ ...options, policy });
  const original = readFileSync(file);
  for (const changes of [{ nonceReservationCounter: 0 }, { nonceReservationCounter: "18446744073709551616" },
    { dkg: [] }, { signing: [] }, { nonceTombstones: [] }]) {
    assert.throws(() => store.save({ ...store.load(), ...changes }), /invalid FROST/u);
    assert.equal(original.equals(readFileSync(file)), true);
  }
});

test("two local setup processes cannot both create the same signer envelope", async t => {
  const { options, file } = stateStoreFixture(t);
  const storeModule = pathToFileURL(path.join(REPO_ROOT, "native/frost/state/file-state-store.mjs")).href;
  const policyModule = pathToFileURL(path.join(REPO_ROOT, "native/frost/policy/native-signing-policy.mjs")).href;
  // No signing material is generated. Only synthetic policy and temporary paths
  // travel through stdin, and child output is restricted to these fixed markers.
  const code = `import { FileBackedFrostStateStore } from ${JSON.stringify(storeModule)};
    import { createLocalNativeDkgPolicy } from ${JSON.stringify(policyModule)};
    let raw = ''; for await (const chunk of process.stdin) raw += chunk;
    try { const input = JSON.parse(raw);
      FileBackedFrostStateStore.createLocal({ ...input.options, policy: createLocalNativeDkgPolicy(input.context) });
      process.stdout.write('CREATED');
    } catch (error) { if (error.message === 'FrostStateAlreadyExists') process.stdout.write('EXISTS');
      else process.exitCode = 1; }`;
  const create = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"], timeout: 20_000 });
    let output = "";
    let diagnosticBytes = 0;
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { diagnosticBytes += chunk.length; });
    child.on("error", () => reject(new Error("LocalStateCreationChildStartFailed")));
    child.on("close", exitCode => {
      if (exitCode !== 0 || diagnosticBytes !== 0 || !["CREATED", "EXISTS"].includes(output)) {
        reject(new Error("LocalStateCreationChildFailed"));
      } else resolve(output);
    });
    child.stdin.on("error", () => reject(new Error("LocalStateCreationChildInputFailed")));
    child.stdin.end(JSON.stringify({ options, context: dkgContextFixture() }));
  });
  assert.deepEqual((await Promise.all([create(), create()])).sort(), ["CREATED", "EXISTS"]);
  assert.equal(existsSync(file), true);
  assert.deepEqual(new FileBackedFrostStateStore(options).load().dkg, {});
  assert.deepEqual(readdirSync(options.root), ["frost-signer-state.json"]);
});

test("reopening enrolled signer state preserves its key and exact pending signing session", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    const a = runtime.signerA.signingCommitment(request);
    const options = { signerId: REQUIRED_FROST_SIGNERS[0], root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT };
    const file = path.join(options.root, "frost-signer-state.json");
    const before = readFileSync(file);
    assert.throws(() => FileBackedFrostStateStore.createLocal({ ...options, policy: runtime.policy }), /FrostStateAlreadyExists/u);
    const reopened = new FileBackedFrostStateStore(options);
    assert.equal(reopened.load().activeEpoch, 1);
    assert.equal(reopened.load().signing[request.sessionId].state, "RESERVED");
    assert.equal(before.equals(readFileSync(file)), true, "Reopen must not modify operational state");
    assert.deepEqual(runtime.signerA.signingCommitment(request), a);
    assert.equal(runtime.coordinator.signAutomatically(request.intent).state, "SIGNED");
  } finally { runtime.cleanup(); }
});

for (const [field, value] of [["purpose", "RESERVE_MIGRATION"], ["proofFingerprint", h("substituted-proof")],
  ["unsignedNativeTransactionId", h("substituted-unsigned-tx")]]) {
  test(`full intent enrollment rejects substitution of ${field}`, () => {
    const intent = intentFromAuthorization(baseAuthorization());
    const policy = makePolicy(intent);
    assert.equal(evaluateNativeSigningPolicy(policy, intent).result, "APPROVED");
    assert.equal(evaluateNativeSigningPolicy(policy, { ...intent, [field]: value }).result, "REJECTED");
  });
}

test("both signers reject substituted full-intent metadata before any nonce reservation", () => {
  const intent = intentFromAuthorization(baseAuthorization());
  const runtime = createRuntime({}, makePolicy(intent));
  try {
    for (const signer of [runtime.signerA, runtime.signerB]) {
      for (const changes of [{ purpose: "RESERVE_MIGRATION" }, { proofFingerprint: h("other-proof") },
        { unsignedNativeTransactionId: h("other-unsigned-tx") }]) {
        const request = frostRequestFor({ ...intent, ...changes });
        assert.throws(() => signer.signingCommitment(request), /authorizedOperationExact/u);
        assert.throws(() => signer.signatureShare(request, []), /authorizedOperationExact/u);
      }
    }
    for (const role of ["frost-a", "frost-b"]) {
      const state = JSON.parse(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"), "utf8"));
      assert.equal(state.nonceReservationCounter, "0");
      assert.equal(Object.keys(state.signing).length, 0);
    }
  } finally { runtime.cleanup(); }
});

test("authorization enrollment requires every complete intent field", () => {
  const intent = intentFromAuthorization(baseAuthorization());
  for (const field of Object.keys(intent)) {
    const incomplete = { ...intent };
    delete incomplete[field];
    assert.throws(() => makePolicy(incomplete), /IntentFields/u, field);
  }
});

test("intent and authorization reject unknown fields instead of dropping them", () => {
  const intent = { ...intentFromAuthorization(baseAuthorization()), proofVerified: true };
  assert.throws(() => validateNativeSigningIntent(intent), /IntentFields/u);
  assert.throws(() => makePolicy(intent), /IntentFields/u);
});

test("every normalized intent field is covered by authorization or independent policy guards", () => {
  const intent = baseAuthorization();
  const policy = makePolicy(intent);
  for (const [field, value] of Object.entries(intent)) {
    let changed;
    if (Array.isArray(value)) changed = field === "inputOutpoints" ? [...value].reverse() : [...value, h("extra-output")];
    else if (typeof value === "boolean") changed = true;
    else if (typeof value === "number") changed = value + 1;
    else if (field === "purpose") changed = "RESERVE_SWEEP";
    else if (field === "nativeNetwork") changed = "mainnet";
    else if (field.endsWith("Atomic")) changed = (BigInt(value) + 1n).toString();
    else if (field.endsWith("ScriptPubKeyHex")) changed = p2tr(`changed-${field}`);
    else changed = h(`changed-${field}`);
    let decision;
    try { decision = evaluateNativeSigningPolicy(policy, { ...intent, [field]: changed }).result; }
    catch { decision = "INVALID"; }
    assert.notEqual(decision, "APPROVED", field);
  }
});

test("enrolled purpose and evidence metadata stay detached and immutable", () => {
  const auth = baseAuthorization();
  const original = structuredClone(auth);
  const policy = makePolicy(auth);
  auth.purpose = "RESERVE_MIGRATION";
  auth.proofFingerprint = h("changed-proof");
  auth.unsignedNativeTransactionId = h("changed-unsigned-tx");
  const enrolled = policy.authorizedOperations[0];
  assert.equal(nativeSigningIntentDigest(enrolled), nativeSigningIntentDigest(original));
  for (const field of ["purpose", "proofFingerprint", "unsignedNativeTransactionId"]) {
    assert.throws(() => { enrolled[field] = auth[field]; }, TypeError);
  }
  assert.equal(evaluateNativeSigningPolicy(policy, original).result, "APPROVED");
  assert.equal(evaluateNativeSigningPolicy(policy, auth).result, "REJECTED");
});

test("metadata substitution is rejected before independent evidence callbacks", async () => {
  let calls = 0;
  const validate = async (intent) => { calls += 1; return { digestHex: intent.proofFingerprint }; };
  const runtime = createRuntime({ A: validate, B: validate });
  try {
    const intent = intentFromAuthorization(runtime.auth);
    await assert.rejects(runtime.coordinator.signAutomaticallyWithNativeEvidence({ ...intent, proofFingerprint: h("unapproved-proof") }),
      /authorizedOperationExact/u);
    assert.equal(calls, 0);
    assert.equal((await runtime.coordinator.signAutomaticallyWithNativeEvidence(intent)).state, "SIGNED");
    assert.equal(calls, 2);
  } finally { runtime.cleanup(); }
});

test("one participant's different enrollment cannot be overruled by the coordinator", () => {
  const runtime = createRuntime();
  try {
    const signerB = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[1], index: 1,
      policy: makePolicy(baseAuthorization({ proofFingerprint: h("B-approved-other-proof") })),
      stateStore: new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[1], root: path.join(runtime.root, "frost-b"), repoRoot: REPO_ROOT }) });
    const coordinator = new NativeFrostCoordinator({ signers: [runtime.signerA, signerB], publicPackage: runtime.epoch.publicPackage,
      aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey });
    assert.throws(() => coordinator.signAutomatically(intentFromAuthorization(runtime.auth)), /authorizedOperationExact/u);
    const b = JSON.parse(readFileSync(path.join(runtime.root, "frost-b", "frost-signer-state.json"), "utf8"));
    assert.equal(b.nonceReservationCounter, "0");
    const a = JSON.parse(readFileSync(path.join(runtime.root, "frost-a", "frost-signer-state.json"), "utf8"));
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    assert.equal(a.signing[request.sessionId].state, "ABORTED");
    assert.equal(a.signing[request.sessionId].nonce, undefined);
  } finally { runtime.cleanup(); }
});

function dkgContextFixture(overrides = {}) {
  return { protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_KEY_CONTEXT/V2", environment: "localnet",
    nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: h("solana-local-deployment"), bridgeProgramId: h("bridge-program-id"),
    transceiverProgramId: h("transceiver-program-id"), mint: h("kpepe-mint"), keyEpoch: 1, ...overrides };
}

test("DKG session identity changes with the deployment and Mint context", () => {
  const first = createTwoPartyDkgRequest({ epoch: 1, context: dkgContextFixture() });
  for (const field of ["solanaDeployment", "bridgeProgramId", "transceiverProgramId", "mint"]) {
    const other = createTwoPartyDkgRequest({ epoch: 1, context: dkgContextFixture({ [field]: h(`other-${field}`) }) });
    assert.notEqual(other.sessionId, first.sessionId, field);
  }
});

test("DKG request participants and their role indexes are immutable", () => {
  const context = dkgContextFixture();
  const request = createTwoPartyDkgRequest({ epoch: 1, context });
  assert.equal(Object.isFrozen(request.participants), true);
  assert.equal(Object.isFrozen(request.participants[0]), true);
  assert.equal(Object.isFrozen(request.context), true);
  context.mint = h("changed-after-build");
  assert.equal(request.context.mint, h("kpepe-mint"));
  assert.throws(() => { request.context.mint = context.mint; }, TypeError);
});

test("DKG V2 session hashes match the explicit public metadata transcript", () => {
  const context = dkgContextFixture();
  const participants = [{ signerId: REQUIRED_FROST_SIGNERS[0], index: 0 },
    { signerId: REQUIRED_FROST_SIGNERS[1], index: 1 }];
  const contextDigest = sha256Canonical(context);
  const participantSetHash = sha256Canonical({ protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_PARTICIPANT_SET/V2",
    participants, threshold: 2 });
  const sessionId = sha256Canonical({ protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG_SESSION/V2",
    epoch: 1, contextDigest, participantSetHash, threshold: 2 });
  const expected = { protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG/V2", epoch: 1, context,
    contextDigest, sessionId, participantSetHash, threshold: 2, participants };
  assert.deepEqual(createTwoPartyDkgRequest({ epoch: 1, context }), expected);
  assert.deepEqual(validateNativeFrostDkgRequest(expected, context), expected);
});

test("DKG rejects unknown fields, incompatible local context and ambiguous epochs", () => {
  const context = dkgContextFixture();
  for (const options of [{ epoch: 1 }, { epoch: 1, context, extra: true },
    { epoch: 1, context: { ...context, extra: true } }, { epoch: 2, context }]) {
    assert.throws(() => createTwoPartyDkgRequest(options), /FrostDkg/u);
  }
  for (const overrides of [{ protocol: "legacy" }, { environment: "mainnet" }, { nativeNetwork: "mainnet" },
    { nativeGenesisHash: h("wrong-genesis") }]) {
    assert.throws(() => createTwoPartyDkgRequest({ epoch: 1, context: { ...context, ...overrides } }), /FrostDkgLocalContext/u);
  }
  for (const epoch of [undefined, null, "1", 0, -1, 1.5, 0x1_0000_0000]) {
    assert.throws(() => createTwoPartyDkgRequest({ epoch, context: { ...context, keyEpoch: epoch } }), /FrostDkgEpoch/u);
  }
  const last = createTwoPartyDkgRequest({ epoch: 0xffff_ffff, context: { ...context, keyEpoch: 0xffff_ffff } });
  assert.equal(last.epoch, 0xffff_ffff);
  assert.notEqual(last.sessionId, createTwoPartyDkgRequest({ epoch: 1, context }).sessionId);
});

for (const [field, alter] of [
  ["protocol", (r) => { r.protocol = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG/V1"; }],
  ["epoch", (r) => { r.epoch = 2; }],
  ["contextDigest", (r) => { r.contextDigest = h("substituted-context"); }],
  ["sessionId", (r) => { r.sessionId = h("substituted-session"); }],
  ["participantSetHash", (r) => { r.participantSetHash = h("substituted-roles"); }],
  ["threshold", (r) => { r.threshold = 1; }],
  ["participants", (r) => { r.participants.reverse(); }],
]) {
  test(`all DKG rounds reject altered ${field} before loading or saving state`, () => {
    let loads = 0;
    let saves = 0;
    const signer = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0, policy: makePolicy(baseAuthorization()),
      stateStore: { load() { loads += 1; return initialSignerState(REQUIRED_FROST_SIGNERS[0]); }, save() { saves += 1; } } });
    const request = structuredClone(createTwoPartyDkgRequest({ epoch: 1, context: dkgContextFixture() }));
    alter(request);
    for (const round of ["dkgRound1", "dkgRound2", "dkgFinalize", "dkgStageRound2", "dkgPhase", "dkgCompleteStaged"]) {
      assert.throws(() => signer[round](request), /FrostDkg/u);
    }
    assert.equal(loads, 1);
    assert.equal(saves, 0);
  });
}

test("each DKG round rejects a correctly hashed request for a different deployment", () => {
  let loads = 0;
  const signer = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0, policy: makePolicy(baseAuthorization()),
    stateStore: { load() { loads += 1; return initialSignerState(REQUIRED_FROST_SIGNERS[0]); } } });
  for (const field of ["solanaDeployment", "bridgeProgramId", "transceiverProgramId", "mint"]) {
    const request = createTwoPartyDkgRequest({ epoch: 1, context: dkgContextFixture({ [field]: h(`foreign-${field}`) }) });
    for (const round of ["dkgRound1", "dkgRound2", "dkgFinalize", "dkgStageRound2", "dkgPhase", "dkgCompleteStaged"]) {
      assert.throws(() => signer[round](request), /FrostDkgContextMismatch/u);
    }
  }
  assert.equal(loads, 1);
});

test("DKG participants require a complete, distinct, ordered and dense A+B set", () => {
  const request = createTwoPartyDkgRequest({ epoch: 1, context: dkgContextFixture() });
  for (const participants of [[request.participants[0]], [request.participants[1]],
    [request.participants[0], request.participants[0]], Array(2),
    [...request.participants, request.participants[0]],
    [{ ...request.participants[0], index: 1 }, request.participants[1]],
    [{ ...request.participants[0], extra: true }, request.participants[1]]]) {
    assert.throws(() => validateNativeFrostDkgRequest({ ...request, participants }, request.context), /FrostDkgParticipant/u);
  }
});

test("DKG metadata snapshots reject accessors, proxies and custom iterators without executing them", () => {
  let calls = 0;
  const request = createTwoPartyDkgRequest({ epoch: 1, context: dkgContextFixture() });
  const getter = { get() { calls += 1; return request.context; } };
  const options = { epoch: 1 };
  Object.defineProperty(options, "context", getter);
  assert.throws(() => createTwoPartyDkgRequest(options), /PlainDataRequired/u);
  const packet = { ...request };
  Object.defineProperty(packet, "context", getter);
  assert.throws(() => validateNativeFrostDkgRequest(packet, request.context), /PlainDataRequired/u);
  const context = { ...request.context };
  Object.defineProperty(context, "mint", getter);
  assert.throws(() => createTwoPartyDkgRequest({ epoch: 1, context }), /PlainDataRequired/u);
  const participants = [...request.participants];
  participants[Symbol.iterator] = () => { calls += 1; throw new Error("must not execute"); };
  assert.throws(() => validateNativeFrostDkgRequest({ ...request, participants }, request.context), /PlainArrayRequired/u);
  const proxy = new Proxy(request, { get() { calls += 1; } });
  assert.throws(() => validateNativeFrostDkgRequest(proxy, request.context), /PlainDataRequired/u);
  assert.equal(calls, 0);
});

test("DKG coordinator rejects options substitution before contacting participants", () => {
  let calls = 0;
  const signers = REQUIRED_FROST_SIGNERS.map((signerId) => ({ signerId,
    dkgContext() { calls += 1; return dkgContextFixture(); }, dkgRound1() { throw new Error("must not execute"); } }));
  for (const options of [{ epoch: 1, context: dkgContextFixture() }, { epoch: 1, extra: true }, {}]) {
    assert.throws(() => runTwoPartyDkg(signers, options), /FrostDkgCoordinatorOptions/u);
  }
  const options = {};
  Object.defineProperty(options, "epoch", { get() { calls += 1; return 1; } });
  assert.throws(() => runTwoPartyDkg(signers, options), /PlainDataRequired/u);
  assert.equal(calls, 0);
});

test("DKG coordinator rejects different A and B contexts before any DKG round", () => {
  let loads = 0;
  let saves = 0;
  const signers = REQUIRED_FROST_SIGNERS.map((signerId, index) => new NativeFrostSigner({ signerId, index,
    policy: makePolicy(baseAuthorization(), index === 1 ? { mint: h("different-mint") } : {}),
    stateStore: { load() { loads += 1; return initialSignerState(signerId); }, save() { saves += 1; } } }));
  assert.throws(() => runTwoPartyDkg(signers, { epoch: 1 }), /FrostDkgParticipantContextMismatch/u);
  assert.equal(loads, 2);
  assert.equal(saves, 0);
});

test("signer rejects a role/index mismatch before reading state", () => {
  let loads = 0;
  assert.throws(() => new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 1,
    policy: makePolicy(baseAuthorization()), stateStore: { load() { loads += 1; } } }), /FrostSignerRoleIndexMismatch/u);
  assert.equal(loads, 0);
});

test("signer options cannot change their role through an accessor", () => {
  let calls = 0;
  const options = { index: 0, policy: makePolicy(baseAuthorization()) };
  Object.defineProperty(options, "signerId", { get() { calls += 1; return REQUIRED_FROST_SIGNERS[0]; } });
  assert.throws(() => new NativeFrostSigner(options), /PlainDataRequired/u);
  assert.equal(calls, 0);
});

test("DKG retention capacity fails before generating or persisting another epoch", () => {
  const dkg = {};
  for (let epoch = 1; epoch <= 40; epoch += 1) {
    const request = createTwoPartyDkgRequest({ epoch, context: dkgContextFixture({ keyEpoch: epoch }) });
    dkg[request.sessionId] = { request };
  }
  let saves = 0;
  const signer = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0,
    policy: makePolicy(baseAuthorization(), { keyEpoch: 41 }),
    stateStore: { load() { return { ...initialSignerState(REQUIRED_FROST_SIGNERS[0]), dkg }; }, save() { saves += 1; } } });
  const request = createTwoPartyDkgRequest({ epoch: 41, context: dkgContextFixture({ keyEpoch: 41 }) });
  assert.throws(() => signer.dkgRound1(request), /FrostDkgStateCapacity/u);
  assert.equal(saves, 0);
  assert.equal(Object.keys(dkg).length, 40);
});

test("DKG state substitutions are rejected without replacing existing test material", () => {
  const runtime = createRuntime();
  try {
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const original = store.load();
    const id = runtime.epoch.request.sessionId;
    const mutations = [
      (s) => { s.dkg[id].request.context.mint = h("other-mint"); },
      (s) => { s.dkg[h("wrong-map-key")] = s.dkg[id]; delete s.dkg[id]; },
      (s) => { s.dkg[h("duplicate-map-key")] = structuredClone(s.dkg[id]); },
      (s) => { s.dkg[id].request.protocol = "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_DKG/V1"; delete s.dkg[id].request.context; },
      (s) => { s.dkg[id].finalKey.secret.identifier = runtime.signerB.frostIdentifier(); },
    ];
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    for (const alter of mutations) {
      const changed = structuredClone(original);
      alter(changed);
      store.save(changed);
      const before = readFileSync(path.join(store.root, "frost-signer-state.json"));
      assert.throws(() => runtime.signerA.signingCommitment(request), /FrostStateDeployment/u);
      assert.throws(() => new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0,
        policy: runtime.policy, stateStore: store }), /FrostStateDeployment/u);
      assert.equal(before.equals(readFileSync(path.join(store.root, "frost-signer-state.json"))), true);
    }
  } finally { runtime.cleanup(); }
});

test("new local key epoch selects its exact DKG session while retaining the earlier epoch", () => {
  const runtime = createRuntime();
  try {
    const policy = makePolicy({ ...runtime.auth, keyEpoch: 2 }, { keyEpoch: 2 });
    const signers = REQUIRED_FROST_SIGNERS.map((signerId, index) => new NativeFrostSigner({ signerId, index, policy,
      stateStore: new FileBackedFrostStateStore({ signerId, root: path.join(runtime.root, index === 0 ? "frost-a" : "frost-b"), repoRoot: REPO_ROOT }) }));
    const epoch = runTwoPartyDkg(signers, { epoch: 2 });
    assert.notEqual(epoch.request.sessionId, runtime.epoch.request.sessionId);
    const coordinator = new NativeFrostCoordinator({ signers, publicPackage: epoch.publicPackage,
      aggregateTweakedXOnlyPublicKey: epoch.aggregateTweakedXOnlyPublicKey });
    const result = coordinator.signAutomatically(intentFromAuthorization(runtime.auth, { keyEpoch: 2 }));
    assert.equal(result.state, "SIGNED");
    assert.equal(schnorr.verify(Buffer.from(result.signatureHex, "hex"), Buffer.from(result.messageHex, "hex"),
      Buffer.from(epoch.aggregateTweakedXOnlyPublicKey, "hex")), true);
    assert.throws(() => runtime.signerA.signingCommitment(frostRequestFor(intentFromAuthorization(runtime.auth))), /no active key/u);
    const saved = JSON.parse(readFileSync(path.join(runtime.root, "frost-a", "frost-signer-state.json"), "utf8"));
    assert.equal(Object.keys(saved.dkg).length, 2);
    assert.equal(saved.activeEpoch, 2);
  } finally { runtime.cleanup(); }
});

test("an earlier unfinished DKG cannot replace a later active key epoch", () => {
  const runtime = createRuntime();
  try {
    const stores = REQUIRED_FROST_SIGNERS.map((signerId, index) => new FileBackedFrostStateStore({ signerId,
      root: path.join(runtime.root, index === 0 ? "frost-a" : "frost-b"), repoRoot: REPO_ROOT }));
    const participants = (keyEpoch) => REQUIRED_FROST_SIGNERS.map((signerId, index) => new NativeFrostSigner({ signerId, index,
      policy: makePolicy(runtime.auth, { keyEpoch }), stateStore: stores[index] }));
    const old = participants(2);
    const request = createTwoPartyDkgRequest({ epoch: 2, context: dkgContextFixture({ keyEpoch: 2 }) });
    const round1 = old.map((signer) => signer.dkgRound1(request));
    const round2 = old.map((signer) => signer.dkgRound2(request, round1));
    runTwoPartyDkg(participants(3), { epoch: 3 });
    for (let i = 0; i < old.length; i += 1) {
      const file = path.join(stores[i].root, "frost-signer-state.json");
      const before = readFileSync(file);
      assert.throws(() => old[i].dkgFinalize(request, round1,
        [{ senderId: old[1 - i].signerId, round2: round2[1 - i][old[i].signerId] }]), /FrostDkgEpochRollback/u);
      assert.throws(() => old[i].dkgRound1(request), /FrostDkgEpochRollback/u);
      assert.throws(() => old[i].dkgRound2(request, round1), /FrostDkgEpochRollback/u);
      assert.equal(before.equals(readFileSync(file)), true);
      assert.equal(stores[i].load().activeEpoch, 3);
    }
  } finally { runtime.cleanup(); }
});

test("signer role and identifier index cannot change after initialization", () => {
  const runtime = createRuntime();
  try {
    assert.throws(() => { runtime.signerA.signerId = REQUIRED_FROST_SIGNERS[1]; }, TypeError);
    assert.throws(() => { runtime.signerB.index = 0; }, TypeError);
  } finally { runtime.cleanup(); }
});

test("reopening a signer under another deployment cannot reuse its existing key epoch", () => {
  const runtime = createRuntime();
  try {
    for (const field of ["solanaDeployment", "bridgeProgramId", "transceiverProgramId", "mint"]) {
      assert.throws(() => new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0,
        policy: makePolicy(runtime.auth, { [field]: h(`different-${field}`) }),
        stateStore: new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
          root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT }) }), /FrostStateDeployment/u);
    }
  } finally { runtime.cleanup(); }
});

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
  const auth = baseAuthorization({ keyEpoch: 0xffff_ffff });
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

function createRuntime(evidenceValidators = {}, policyOverride, initializeDkg = true) {
  const root = withTempRoot();
  const auth = baseAuthorization();
  const policy = policyOverride ?? makePolicy(auth);
  const storeA = FileBackedFrostStateStore.createLocal({
    policy,
    signerId: REQUIRED_FROST_SIGNERS[0],
    root: path.join(root, "frost-a"),
    repoRoot: REPO_ROOT,
  });
  const storeB = FileBackedFrostStateStore.createLocal({
    policy,
    signerId: REQUIRED_FROST_SIGNERS[1],
    root: path.join(root, "frost-b"),
    repoRoot: REPO_ROOT,
  });
  const signerA = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0, policy, stateStore: storeA,
    nativeEvidenceValidator: evidenceValidators.A });
  const signerB = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[1], index: 1, policy, stateStore: storeB,
    nativeEvidenceValidator: evidenceValidators.B });
  const epoch = initializeDkg ? runTwoPartyDkg([signerA, signerB], { epoch: 1 }) : undefined;
  const coordinator = epoch === undefined ? undefined : new NativeFrostCoordinator({
    signers: [signerA, signerB],
    publicPackage: epoch.publicPackage,
    aggregateTweakedXOnlyPublicKey: epoch.aggregateTweakedXOnlyPublicKey,
  });
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, auth, policy, signerA, signerB, epoch, coordinator, cleanup };
}

function dkgFixture(t) {
  const runtime = createRuntime({}, undefined, false);
  t.after(runtime.cleanup);
  const signers = [runtime.signerA, runtime.signerB];
  const stores = REQUIRED_FROST_SIGNERS.map((signerId, index) => new FileBackedFrostStateStore({ signerId,
    root: path.join(runtime.root, index === 0 ? "frost-a" : "frost-b"), repoRoot: REPO_ROOT }));
  const request = createTwoPartyDkgRequest({ epoch: 1, context: signers[0].dkgContext() });
  const round1 = signers.map(signer => signer.dkgRound1(request));
  const round2 = () => {
    const sent = signers.map(signer => signer.dkgRound2(request, round1));
    return signers.map((signer, index) => [{ senderId: signers[1 - index].signerId, round2: sent[1 - index][signer.signerId] }]);
  };
  return { ...runtime, signers, stores, request, round1, round2 };
}

// Portable codec tests use real ephemeral FROST results, not chain evidence or
// Windows protected-storage certification. Private shares stay in external fixtures.
function coordinatorJournalFixture(t) {
  const f = createRuntime(); t.after(f.cleanup);
  const request = createNativeFrostSigningRequest(f.auth), key = f.epoch;
  const state = JSON.parse(initialCoordinatorSigningState(key));
  state.records.push({ request: structuredClone(request), state: "PREPARED", abortReceipts: null, result: null });
  return { f, key, request, state, decode: v => decodeCoordinatorSigningState(Buffer.from(JSON.stringify(v)), key) };
}
test("coordinator journal codec verifies genuine A+B aggregate and retained exact binding", t => {
  const x = coordinatorJournalFixture(t); assert.deepEqual(x.decode(x.state), x.state);
  x.state.records[0].state = "SIGNED"; x.state.records[0].result = x.f.coordinator.signAutomatically(x.f.auth);
  assert.deepEqual(x.decode(x.state), x.state);
});
test("coordinator journal codec requires both exact terminal abort receipts", t => {
  const x = coordinatorJournalFixture(t), r = x.state.records[0]; r.state = "ABORTED";
  r.abortReceipts = REQUIRED_FROST_SIGNERS.map(id => createNativeFrostAbortReceipt(x.request, id, "ABORTED"));
  assert.deepEqual(x.decode(x.state), x.state);
  for (const receipts of [[r.abortReceipts[0]], [r.abortReceipts[0], r.abortReceipts[0]],
    [r.abortReceipts[1], r.abortReceipts[0]], [r.abortReceipts[0], { ...r.abortReceipts[1], sessionId: h("wrong") }]]) {
    assert.throws(() => x.decode({ ...x.state, records: [{ ...r, abortReceipts: receipts }] }));
  }
});
for (const [label, mutate] of [
  ["wrong protocol", v => { v.protocol += "x"; }],
  ["wrong key package", v => { v.identityDigest = h("wrong-key"); }],
  ["duplicate request", v => { v.records.push(structuredClone(v.records[0])); }],
  ["same input with new request identity", v => { v.records.push({ ...v.records[0], request: createNativeFrostSigningRequest({ ...v.records[0].request.intent, signingRequestId: h("new-id") }) }); }],
  ["wrong attempt", v => { v.records[0].request.attempt++; }],
  ["wrong deployment", v => { v.records[0].request.intent.solanaDeployment = h("wrong-deployment"); }],
  ["wrong amount", v => { v.records[0].request.intent.amountAtomic = "1"; }],
  ["wrong fee", v => { v.records[0].request.intent.feeAtomic = "1"; }],
  ["wrong sighash", v => { v.records[0].request.messageHex = h("wrong-sighash"); }],
  ["one participant", v => { v.records[0].request.participantIds.pop(); }],
  ["pretend completion", v => { v.records[0].state = "SIGNED"; }],
  ["unknown state", v => { v.records[0].state = "RETRY_ANYWAY"; }],
  ["unbounded records", v => { v.records = Array(MAX_COORDINATOR_REQUESTS + 1).fill(v.records[0]); }],
  ["secret field", v => { v.records[0].privateShare = "forbidden"; }],
]) test("coordinator journal codec rejects " + label, t => {
  const x = coordinatorJournalFixture(t); mutate(x.state); assert.throws(() => x.decode(x.state));
});
test("coordinator journal codec rejects malformed, duplicate-key and oversized state", t => {
  const x = coordinatorJournalFixture(t);
  for (const bytes of [Buffer.from("{"), Buffer.alloc(900001), Buffer.from(JSON.stringify(x.state).replace('"records":', '"records":[],"records":'))]) {
    assert.throws(() => decodeCoordinatorSigningState(bytes, x.key));
  }
});
test("coordinator journal rejects signature, public key and context substitution", t => {
  const x = coordinatorJournalFixture(t), result = x.f.coordinator.signAutomatically(x.f.auth);
  for (const patch of [{ signatureHex: "00".repeat(64) }, { epoch: 2 }, { sessionId: h("wrong-session") },
    { aggregateTweakedXOnlyPublicKey: h("wrong-key") }, { signerIds: [REQUIRED_FROST_SIGNERS[0]] }, { participantIdentifiers: [1, 1] }]) {
    x.state.records[0] = { request: x.request, state: "SIGNED", abortReceipts: null, result: { ...result, ...patch } };
    assert.throws(() => x.decode(x.state));
  }
});
test("coordinator journal cannot be replaced with an in-memory duck type", () => {
  assert.throws(() => requireCoordinatorSigningJournal({ assertBinding() {} }, {}, {}), /ProtectedCoordinatorJournalRequired/u);
});
test("coordinator journal enrollment rejects alternate threshold and private-share-shaped packages", t => {
  const x = coordinatorJournalFixture(t);
  for (const patch of [{ signers: { min: 1, max: 2 } }, { signers: { min: 2, max: 3 } },
    { commitmentsHex: [] }, { verifyingSharesHex: {} }, { privateShare: "forbidden" }]) {
    assert.throws(() => initialCoordinatorSigningState({ ...x.key, publicPackage: { ...x.key.publicPackage, ...patch } }));
  }
});
test("coordinator signing purpose is restricted to the exact service role", () => {
  const c = { role: "COORDINATOR", purpose: "coordinator-signing", serviceSid: "S-1-5-21-1-2-3-1001", environment: "localnet",
    nativeGenesis: h("genesis"), solanaDeployment: h("deployment"), instanceId: h("instance"), keyEpoch: 1 };
  assert.equal(normalizeProtectedContext(c).role, "COORDINATOR");
  for (const role of ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "ATTESTER_A", "SUPERVISOR", "BRIDGE_VALIDATOR"]) assert.throws(() => normalizeProtectedContext({ ...c, role }));
});

test("DKG rejects substituted self-generated round-one material before accepting a transcript", t => {
  const f = dkgFixture(t);
  const changed = structuredClone(f.round1);
  changed[0].round1.proofOfKnowledgeHex = "00".repeat(64);
  const before = readFileSync(path.join(f.stores[0].root, "frost-signer-state.json"));
  assert.throws(() => f.signers[0].dkgRound2(f.request, changed), /FrostDkgOwnRound1Mismatch/u);
  assert.equal(before.equals(readFileSync(path.join(f.stores[0].root, "frost-signer-state.json"))), true);
});

test("completed DKG cannot accept missing or changed retry payloads", () => {
  const runtime = createRuntime();
  try {
    assert.throws(() => runtime.signerA.dkgFinalize(runtime.epoch.request, [], []), /FrostDkg/u);
    const round1 = [runtime.signerA, runtime.signerB].map(s => s.dkgRound1(runtime.epoch.request));
    round1[0].round1.extra = true;
    assert.throws(() => runtime.signerA.dkgFinalize(runtime.epoch.request, round1, []), /FrostDkg/u);
  } finally { runtime.cleanup(); }
});

test("complete DKG setup can reopen and repeat without changing either key or state", () => {
  const runtime = createRuntime();
  try {
    const files = ["frost-a", "frost-b"].map(role => path.join(runtime.root, role, "frost-signer-state.json"));
    const before = files.map(file => readFileSync(file));
    const next = runTwoPartyDkg([reopenSigner(runtime, 0), reopenSigner(runtime, 1)], { epoch: 1 });
    assert.equal(next.aggregateTweakedXOnlyPublicKey === runtime.epoch.aggregateTweakedXOnlyPublicKey, true);
    for (const [index, file] of files.entries()) assert.equal(before[index].equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

test("malformed DKG inner payloads are rejected before signer-state reads or getters", t => {
  const f = dkgFixture(t);
  let loads = 0;
  let getters = 0;
  const signer = reopenSigner(f, 0, { load() { loads += 1; return f.stores[0].load(); }, save: s => f.stores[0].save(s) });
  loads = 0;
  const accessor = structuredClone(f.round1);
  Object.defineProperty(accessor[0].round1, "proofOfKnowledgeHex", { get() { getters += 1; return "00".repeat(64); }, enumerable: true });
  const oversized = structuredClone(f.round1);
  oversized[1].round1.commitmentsHex.push(oversized[1].round1.commitmentsHex[0]);
  for (const raw of [[], accessor, oversized]) {
    assert.throws(() => signer.dkgRound2(f.request, raw), /FrostDkg/u);
    assert.throws(() => signer.dkgFinalize(f.request, raw, []), /FrostDkg/u);
  }
  assert.equal(loads, 0);
  assert.equal(getters, 0);
});

test("DKG stages both incoming packages before finalization and retains exact retry binding", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  for (let i = 0; i < 2; i += 1) {
    f.signers[i].dkgStageRound2(f.request, f.round1, incoming[i]);
    assert.equal(f.signers[i].dkgPhase(f.request), "STAGED");
    assert.equal(f.stores[i].load().activeEpoch, undefined);
  }
  const first = f.signers[0].dkgFinalize(f.request, f.round1, incoming[0]);
  const repeated = f.signers[0].dkgFinalize(f.request, f.round1, incoming[0]);
  assert.equal(first.publicPackageHash === repeated.publicPackageHash, true);
  const changed = structuredClone(incoming[0]);
  changed[0].round2.signingShareHex = "00".repeat(32);
  assert.throws(() => f.signers[0].dkgFinalize(f.request, f.round1, changed), /FrostDkgTranscriptMismatch/u);
  assert.throws(() => f.signers[0].dkgRound2(f.request, f.round1), /FrostDkgAlreadyFinalized/u);
  const resumed = runTwoPartyDkg([reopenSigner(f, 0), reopenSigner(f, 1)], { epoch: 1 });
  assert.equal(first.aggregateTweakedXOnlyPublicKey === resumed.aggregateTweakedXOnlyPublicKey, true);
  for (const store of f.stores) {
    const session = store.load().dkg[f.request.sessionId];
    assert.equal(session.secret, undefined);
    assert.equal(session.stagedRound2, undefined);
    assert.equal(typeof session.finalizationDigest, "string");
  }
});

for (const persisted of [false, true]) {
  test(`DKG resumes after finalization storage failure ${persisted ? "after" : "before"} persistence`, t => {
    const f = dkgFixture(t);
    let fail = true;
    const signerB = reopenSigner(f, 1, { load: () => f.stores[1].load(), save(state) {
      if (fail && state.dkg[f.request.sessionId]?.finalKey !== undefined) {
        if (persisted) f.stores[1].save(state);
        throw new Error("TEST_DKG_FINAL_SAVE_FAILURE");
      }
      f.stores[1].save(state);
    } });
    assert.throws(() => runTwoPartyDkg([f.signers[0], signerB], { epoch: 1 }), /TEST_DKG_FINAL_SAVE_FAILURE/u);
    const first = f.stores[0].load().dkg[f.request.sessionId].finalKey;
    fail = false;
    const resumed = runTwoPartyDkg([reopenSigner(f, 0), reopenSigner(f, 1)], { epoch: 1 });
    assert.equal(resumed.publicPackageHash === sha256Canonical(first.public), true);
  });
}

test("DKG rejects changed saved handoff data without creating a replacement key", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  for (let i = 0; i < 2; i += 1) f.signers[i].dkgStageRound2(f.request, f.round1, incoming[i]);
  const state = f.stores[1].load();
  state.dkg[f.request.sessionId].stagedRound2[0].round2.signingShareHex = "00".repeat(32);
  f.stores[1].save(state);
  const file = path.join(f.stores[1].root, "frost-signer-state.json");
  const before = readFileSync(file);
  assert.throws(() => runTwoPartyDkg(f.signers, { epoch: 1 }), /FrostDkg/u);
  assert.equal(before.equals(readFileSync(file)), true);
  assert.equal(f.stores[1].load().dkg[f.request.sessionId].finalKey, undefined);
});

for (const persisted of [false, true]) {
  test(`neither DKG participant finalizes if the second handoff fails ${persisted ? "after" : "before"} persistence`, t => {
    const f = dkgFixture(t);
    let fail = true;
    const signerB = reopenSigner(f, 1, { load: () => f.stores[1].load(), save(state) {
      if (fail && state.dkg[f.request.sessionId]?.stagedRound2 !== undefined) {
        if (persisted) f.stores[1].save(state);
        throw new Error("TEST_DKG_HANDOFF_SAVE_FAILURE");
      }
      f.stores[1].save(state);
    } });
    assert.throws(() => runTwoPartyDkg([f.signers[0], signerB], { epoch: 1 }), /TEST_DKG_HANDOFF_SAVE_FAILURE/u);
    for (const store of f.stores) {
      assert.equal(store.load().dkg[f.request.sessionId].finalKey, undefined);
      assert.equal(store.load().activeEpoch, undefined);
    }
    fail = false;
    const signers = [reopenSigner(f, 0), reopenSigner(f, 1)];
    const epoch = runTwoPartyDkg(signers, { epoch: 1 });
    const coordinator = new NativeFrostCoordinator({ signers, publicPackage: epoch.publicPackage,
      aggregateTweakedXOnlyPublicKey: epoch.aggregateTweakedXOnlyPublicKey });
    assert.equal(coordinator.signAutomatically(f.auth).state, "SIGNED");
  });
}

test("a finalized DKG participant cannot trigger replacement setup for a peer missing its handoff", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  for (let i = 0; i < 2; i += 1) f.signers[i].dkgStageRound2(f.request, f.round1, incoming[i]);
  f.signers[0].dkgCompleteStaged(f.request);
  const state = f.stores[1].load();
  delete state.dkg[f.request.sessionId].stagedRound2;
  delete state.dkg[f.request.sessionId].stagedDigest;
  f.stores[1].save(state);
  const file = path.join(f.stores[1].root, "frost-signer-state.json");
  const before = readFileSync(file);
  assert.throws(() => runTwoPartyDkg(f.signers, { epoch: 1 }), /FrostDkgIncompleteHandoffRecovery/u);
  assert.equal(before.equals(readFileSync(file)), true);
});

test("DKG round-one parser rejects noncanonical shapes and encodings before state access", t => {
  const f = dkgFixture(t);
  let loads = 0;
  const signer = reopenSigner(f, 0, { load() { loads += 1; return f.stores[0].load(); }, save: s => f.stores[0].save(s) });
  loads = 0;
  for (const change of [
    r => { r[1] = structuredClone(r[0]); },
    r => { r[1].signerId = "UNENROLLED"; },
    r => { r[1].round1.identifier = r[0].round1.identifier; },
    r => { r[1].round1.commitmentsHex[0] = r[1].round1.commitmentsHex[0].toUpperCase(); },
    r => { r[1].round1.proofOfKnowledgeHex += "00"; },
    r => { r[1].round1.proofOfKnowledgeHex = "00"; },
    r => { r[1].extra = true; },
    r => { r[1].round1.extra = true; },
    r => { delete r[1]; },
    r => { r.extra = true; },
  ]) {
    const raw = structuredClone(f.round1); change(raw);
    assert.throws(() => signer.dkgRound2(f.request, raw), /FrostDkg/u);
  }
  assert.equal(loads, 0);
});

test("DKG round-two parser rejects wrong sender, ambiguous scalars and accessors before state access", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  let loads = 0;
  let getters = 0;
  const signer = reopenSigner(f, 0, { load() { loads += 1; return f.stores[0].load(); }, save: s => f.stores[0].save(s) });
  loads = 0;
  for (const change of [
    r => { r.length = 0; },
    r => { r.push(structuredClone(r[0])); },
    r => { r[0].senderId = f.signers[0].signerId; },
    r => { r[0].round2.identifier = f.signers[0].frostIdentifier(); },
    r => { r[0].round2.signingShareHex += "00"; },
    r => { r[0].round2.signingShareHex = "AA".repeat(32); },
    r => { r[0].round2.extra = true; },
    r => { r[0].extra = true; },
    r => { Object.defineProperty(r[0].round2, "signingShareHex", { enumerable: true, get() { getters += 1; return "00".repeat(32); } }); },
  ]) {
    const raw = structuredClone(incoming[0]); change(raw);
    for (const method of ["dkgStageRound2", "dkgFinalize"]) assert.throws(() => signer[method](f.request, f.round1, raw), /FrostDkg/u);
  }
  assert.equal(loads, 0);
  assert.equal(getters, 0);
});

test("DKG rejects invalid peer proof and private contribution without persisting acceptance", t => {
  const f = dkgFixture(t);
  const file = path.join(f.stores[0].root, "frost-signer-state.json");
  let before = readFileSync(file);
  const invalid = structuredClone(f.round1);
  invalid[1].round1.proofOfKnowledgeHex = "00".repeat(64);
  assert.throws(() => f.signers[0].dkgRound2(f.request, invalid), /^Error: FrostDkgRound2ValidationFailed$/u);
  assert.equal(before.equals(readFileSync(file)), true);
  const incoming = f.round2();
  before = readFileSync(file);
  incoming[0][0].round2.signingShareHex = "00".repeat(32);
  assert.throws(() => f.signers[0].dkgStageRound2(f.request, f.round1, incoming[0]), /^Error: FrostDkgContributionValidationFailed$/u);
  assert.equal(before.equals(readFileSync(file)), true);
  assert.equal(f.signers[0].dkgPhase(f.request), "ROUND2");
});

test("DKG handoff snapshots stay unchanged when caller objects mutate during state reads", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  const callerRound1 = structuredClone(f.round1);
  const callerRound2 = structuredClone(incoming[0]);
  let mutate = false;
  const signer = reopenSigner(f, 0, { load() {
    if (mutate) {
      callerRound1[0].round1.proofOfKnowledgeHex = "00".repeat(64);
      callerRound2[0].round2.signingShareHex = "00".repeat(32);
    }
    return f.stores[0].load();
  }, save: s => f.stores[0].save(s) });
  mutate = true;
  signer.dkgStageRound2(f.request, callerRound1, callerRound2);
  const saved = f.stores[0].load().dkg[f.request.sessionId];
  assert.equal(sha256Canonical(saved.stagedRound2) === sha256Canonical(incoming[0]), true);
  const complete = signer.dkgFinalize(f.request, f.round1, incoming[0]);
  assert.equal(complete.secretShareStoredLocally, true);
});

test("DKG detects a handoff state change before publishing its final key", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  f.signers[0].dkgStageRound2(f.request, f.round1, incoming[0]);
  let reads = 0;
  let armed = false;
  const signer = reopenSigner(f, 0, { load() {
    if (armed && ++reads === 2) {
      const state = f.stores[0].load();
      state.dkg[f.request.sessionId].stagedDigest = h("changed-after-derivation");
      f.stores[0].save(state);
    }
    return f.stores[0].load();
  }, save: s => f.stores[0].save(s) });
  armed = true;
  assert.throws(() => signer.dkgCompleteStaged(f.request), /FrostDkgStateChanged/u);
  assert.equal(f.stores[0].load().dkg[f.request.sessionId].finalKey, undefined);
  assert.equal(f.stores[0].load().activeEpoch, undefined);
});

test("old completed DKG without a finalization transcript is rejected for setup resume without migration", () => {
  const runtime = createRuntime();
  try {
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0], root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const state = store.load();
    delete state.dkg[runtime.epoch.request.sessionId].finalizationDigest;
    store.save(state);
    const file = path.join(store.root, "frost-signer-state.json");
    const before = readFileSync(file);
    assert.throws(() => runTwoPartyDkg([runtime.signerA, runtime.signerB], { epoch: 1 }), /FrostDkgFinalizedStateInvalid/u);
    assert.equal(before.equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

test("DKG cannot finalize private polynomial state that differs from its announced local commitment", t => {
  const f = dkgFixture(t);
  const incoming = f.round2();
  const other = dkgFixture(t);
  other.round2();
  const state = f.stores[0].load();
  state.dkg[f.request.sessionId].secret = other.stores[0].load().dkg[other.request.sessionId].secret;
  f.stores[0].save(state);
  const file = path.join(f.stores[0].root, "frost-signer-state.json");
  const before = readFileSync(file);
  assert.throws(() => f.signers[0].dkgStageRound2(f.request, f.round1, incoming[0]), /FrostDkgContributionValidationFailed/u);
  assert.equal(before.equals(readFileSync(file)), true);
  assert.equal(f.stores[0].load().dkg[f.request.sessionId].finalKey, undefined);
});

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

function reopenSigner(runtime, index, stateStore) {
  const signerId = REQUIRED_FROST_SIGNERS[index];
  return new NativeFrostSigner({ signerId, index, policy: runtime.policy,
    stateStore: stateStore ?? new FileBackedFrostStateStore({ signerId,
      root: path.join(runtime.root, index === 0 ? "frost-a" : "frost-b"), repoRoot: REPO_ROOT }) });
}

test("reserved signing state persists the full request but no secret nonce bytes", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    const publicA = runtime.signerA.signingCommitment(request);
    const state = JSON.parse(readFileSync(path.join(runtime.root, "frost-a", "frost-signer-state.json"), "utf8"));
    assert.equal(state.format, "kingpepe-native-solana-frost-state/v2");
    const session = state.signing[request.sessionId];
    assert.equal(session.state, "RESERVED");
    assert.equal(Object.hasOwn(session, "nonce"), false, "Private nonce data must not be serialized");
    assert.deepEqual(session.request, createNativeFrostSigningRequest(runtime.auth));
    assert.deepEqual(session.commitment, publicA.commitment);
    assert.deepEqual(runtime.signerA.signingCommitment(request), publicA);
    assert.equal(runtime.coordinator.signAutomatically(request.intent).state, "SIGNED");
  } finally { runtime.cleanup(); }
});

test("signer reopen burns uncertain reservations before becoming available", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    const commitments = [runtime.signerA.signingCommitment(request), runtime.signerB.signingCommitment(request)];
    const freshA = reopenSigner(runtime, 0);
    assertSessionOutcome(runtime, "A", request, "ABORTED");
    assert.throws(() => freshA.signingCommitment(request), /already burned/u);
    assert.throws(() => freshA.signatureShare(request, commitments), /nonce is not available/u);
    assert.throws(() => runtime.signerA.signatureShare(request, commitments), /nonce is not available/u);
    const again = reopenSigner(runtime, 0);
    assert.throws(() => again.signingCommitment(request), /already burned/u);
    assert.equal(runtime.signerB.abortSigningSession(request).state, "ABORTED");
    const coordinator = new NativeFrostCoordinator({ signers: [freshA, runtime.signerB],
      publicPackage: runtime.epoch.publicPackage, aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey });
    assert.equal(coordinator.signAutomatically(request.intent, { attempt: 2 }).state, "SIGNED");
  } finally { runtime.cleanup(); }
});

test("reopened completed signers reproduce the exact saved aggregate without new nonces", () => {
  const runtime = createRuntime();
  try {
    const first = runtime.coordinator.signAutomatically(runtime.auth);
    const before = ["frost-a", "frost-b"].map(role => readFileSync(path.join(runtime.root, role, "frost-signer-state.json")));
    const coordinator = new NativeFrostCoordinator({ signers: [reopenSigner(runtime, 0), reopenSigner(runtime, 1)],
      publicPackage: runtime.epoch.publicPackage, aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey });
    assert.equal(coordinator.signAutomatically(runtime.auth).signatureHex, first.signatureHex);
    for (const [index, role] of ["frost-a", "frost-b"].entries()) {
      assert.equal(before[index].equals(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"))), true);
    }
  } finally { runtime.cleanup(); }
});

test("V1 signer state is rejected without migration or removal of test recovery material", () => {
  const runtime = createRuntime();
  try {
    const file = path.join(runtime.root, "frost-a", "frost-signer-state.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    state.format = "kingpepe-native-solana-frost-state/v1";
    writeFileSync(file, JSON.stringify(state));
    const before = readFileSync(file);
    assert.throws(() => reopenSigner(runtime, 0), /unsupported FROST signer state format/u);
    assert.equal(before.equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

test("restoring a public reservation snapshot cannot recover a consumed volatile nonce", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    const commitments = [runtime.signerA.signingCommitment(request), runtime.signerB.signingCommitment(request)];
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const reservation = store.load();
    runtime.signerA.signatureShare(request, commitments);
    store.save(reservation); // Only the isolated test's earlier public reservation state.
    assert.throws(() => runtime.signerA.signatureShare(request, commitments), /nonce is not available/u);
    const fresh = reopenSigner(runtime, 0);
    assertSessionOutcome(runtime, "A", request, "ABORTED");
    assert.throws(() => fresh.signatureShare(request, commitments), /nonce is not available/u);
  } finally { runtime.cleanup(); }
});

for (const persisted of [false, true]) {
  test(`restart fails closed when uncertain reservation cleanup fails ${persisted ? "after" : "before"} persistence`, () => {
    const runtime = createRuntime();
    try {
      const request = frostRequestFor(runtime.auth);
      runtime.signerA.signingCommitment(request);
      const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
        root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
      let writes = 0;
      assert.throws(() => reopenSigner(runtime, 0, { load: () => store.load(), save(state) {
        writes += 1;
        if (persisted) store.save(state);
        throw new Error("TEST_RECOVERY_WRITE_FAILURE");
      } }), /FrostNonceRecoveryPersistenceFailed/u);
      assert.equal(writes, 1);
      assert.equal(store.load().signing[request.sessionId].state, persisted ? "ABORTED" : "RESERVED");
      const fresh = reopenSigner(runtime, 0);
      assert.throws(() => fresh.signingCommitment(request), /already burned/u);
    } finally { runtime.cleanup(); }
  });
}

test("signer restart validates all pending sessions before writing any recovery transition", () => {
  const runtime = createRuntime();
  try {
    const first = frostRequestFor(runtime.auth);
    const second = frostRequestFor(runtime.auth, 2);
    runtime.signerA.signingCommitment(first);
    runtime.signerA.signingCommitment(second);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const state = store.load();
    state.nonceTombstones[state.signing[second.sessionId].nonceReservationId].sessionId = h("corrupt-session");
    store.save(state);
    const file = path.join(store.root, "frost-signer-state.json");
    const before = readFileSync(file);
    assert.throws(() => reopenSigner(runtime, 0), /FrostNonceRecoveryStateInvalid/u);
    assert.equal(before.equals(readFileSync(file)), true);
    assert.equal(store.load().signing[first.sessionId].state, "RESERVED");
  } finally { runtime.cleanup(); }
});

test("failed consumed-marker persistence makes the volatile nonce unavailable in that signer", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    let fail = true;
    const signerA = reopenSigner(runtime, 0, { load: () => store.load(), save(state) {
      if (fail && state.signing[request.sessionId]?.state === "ABORTED") throw new Error("TEST_CONSUME_WRITE_FAILURE");
      store.save(state);
    } });
    const commitments = [signerA.signingCommitment(request), runtime.signerB.signingCommitment(request)];
    assert.throws(() => signerA.signatureShare(request, commitments), /TEST_CONSUME_WRITE_FAILURE/u);
    fail = false;
    assert.throws(() => signerA.signatureShare(request, commitments), /nonce is not available/u);
    assert.equal(signerA.abortSigningSession(request).state, "ABORTED");
  } finally { runtime.cleanup(); }
});

test("a killed signer process cannot resume its old reserved nonce after reopening", async () => {
  const runtime = createRuntime();
  try {
    const module = pathToFileURL(path.join(REPO_ROOT, "native/frost/index.mjs")).href;
    const code = `import { FileBackedFrostStateStore, NativeFrostSigner, createNativeSigningPolicy,
      createNativeFrostSigningRequest } from ${JSON.stringify(module)};
      let raw = ''; for await (const chunk of process.stdin) raw += chunk;
      try { const input = JSON.parse(raw);
        const signer = new NativeFrostSigner({ ...input.options, policy: createNativeSigningPolicy(input.policy),
          stateStore: new FileBackedFrostStateStore(input.store) });
        signer.signingCommitment(createNativeFrostSigningRequest(input.intent));
        setInterval(() => {}, 1000);
        process.stdout.write('RESERVED');
      } catch { process.exitCode = 1; }`;
    const policy = { ...runtime.policy, maxAmountAtomic: runtime.policy.maxAmountAtomic.toString(),
      maxFeeAtomic: runtime.policy.maxFeeAtomic.toString() };
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"], timeout: 20_000 });
      let output = "";
      let diagnostics = 0;
      let killed = false;
      child.stdout.on("data", chunk => {
        output += chunk;
        if (output === "RESERVED" && !killed) killed = child.kill("SIGKILL");
      });
      child.stderr.on("data", chunk => { diagnostics += chunk.length; });
      child.on("error", () => reject(new Error("NonceCrashChildStartFailed")));
      child.stdin.on("error", () => reject(new Error("NonceCrashChildInputFailed")));
      child.on("close", (code, signal) => {
        if (!killed || output !== "RESERVED" || diagnostics !== 0 || signal !== "SIGKILL") {
          reject(new Error("NonceCrashChildNotConfirmed"));
        } else resolve();
      });
      // No keys/nonces in IPC or output. The child reads only its isolated A file.
      child.stdin.end(JSON.stringify({ policy, intent: runtime.auth,
        options: { signerId: REQUIRED_FROST_SIGNERS[0], index: 0 },
        store: { signerId: REQUIRED_FROST_SIGNERS[0], root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT } }));
    });
    const request = frostRequestFor(runtime.auth);
    const fresh = reopenSigner(runtime, 0);
    assertSessionOutcome(runtime, "A", request, "ABORTED");
    assert.throws(() => fresh.signingCommitment(request), /already burned/u);
    const coordinator = new NativeFrostCoordinator({ signers: [fresh, runtime.signerB], publicPackage: runtime.epoch.publicPackage,
      aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey });
    assert.equal(coordinator.signAutomatically(request.intent, { attempt: 2 }).state, "SIGNED");
  } finally { runtime.cleanup(); }
});

for (const persisted of [false, true]) {
  test(`reservation persistence failure ${persisted ? "after" : "before"} saving never retains a usable secret nonce`, () => {
    const runtime = createRuntime();
    try {
      const request = frostRequestFor(runtime.auth);
      const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
        root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
      let fail = true;
      const signerA = reopenSigner(runtime, 0, { load: () => store.load(), save(state) {
        if (fail && state.signing[request.sessionId]?.state === "RESERVED") {
          if (persisted) store.save(state);
          throw new Error("TEST_RESERVATION_PERSISTENCE_FAILURE");
        }
        store.save(state);
      } });
      assert.throws(() => signerA.signingCommitment(request), /TEST_RESERVATION_PERSISTENCE_FAILURE/u);
      fail = false;
      if (persisted) assert.throws(() => signerA.signingCommitment(request), /nonce is not available/u);
      else assert.equal(store.load().signing[request.sessionId], undefined);
      assert.equal(signerA.abortSigningSession(request).state, persisted ? "ABORTED" : "NOT_RESERVED");
      const coordinator = new NativeFrostCoordinator({ signers: [signerA, runtime.signerB], publicPackage: runtime.epoch.publicPackage,
        aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey });
      assert.equal(coordinator.signAutomatically(request.intent, { attempt: 2 }).state, "SIGNED");
    } finally { runtime.cleanup(); }
  });
}

test("closing a signer discards its nonce capability and cannot be undone by availability toggles", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    runtime.signerA.signingCommitment(request);
    runtime.signerA.close();
    runtime.signerA.close();
    runtime.signerA.setAvailableForTestOnly(true);
    assert.equal(runtime.signerA.isAvailable(), false);
    assert.throws(() => runtime.signerA.signingCommitment(request), /FrostSignerClosed/u);
    const fresh = reopenSigner(runtime, 0);
    assertSessionOutcome(runtime, "A", request, "ABORTED");
    assert.throws(() => fresh.signingCommitment(request), /already burned/u);
  } finally { runtime.cleanup(); }
});

test("a valid abort discards its volatile nonce even if reading state fails", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    let fail = false;
    const signerA = reopenSigner(runtime, 0, { load() {
      if (fail) throw new Error("TEST_ABORT_READ_FAILURE");
      return store.load();
    }, save: state => store.save(state) });
    const commitments = [signerA.signingCommitment(request), runtime.signerB.signingCommitment(request)];
    fail = true;
    assert.throws(() => signerA.abortSigningSession(request), /TEST_ABORT_READ_FAILURE/u);
    fail = false;
    assert.throws(() => signerA.signatureShare(request, commitments), /nonce is not available/u);
    assert.equal(signerA.abortSigningSession(request).state, "ABORTED");
  } finally { runtime.cleanup(); }
});

test("restart rejects missing, substituted or extra nonce metadata without repairing it", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    runtime.signerA.signingCommitment(request);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const original = store.load();
    for (const alter of [
      (session) => { delete session.request; },
      (session) => { session.request.intent.proofFingerprint = h("replaced-proof"); },
      (session) => { session.nonce = { testMarker: "not-a-real-secret" }; },
      (session, tombstone) => { tombstone.extra = "unexpected"; },
      (session, tombstone) => { tombstone.commitmentSetHash = h("unexpected-transcript"); },
      (session) => { session.commitment.hidingHex = "00"; },
    ]) {
      const changed = structuredClone(original);
      const session = changed.signing[request.sessionId];
      alter(session, changed.nonceTombstones[session.nonceReservationId]);
      store.save(changed);
      const file = path.join(store.root, "frost-signer-state.json");
      const before = readFileSync(file);
      assert.throws(() => reopenSigner(runtime, 0), /FrostNonceRecoveryStateInvalid/u);
      assert.equal(before.equals(readFileSync(file)), true);
    }
  } finally { runtime.cleanup(); }
});

test("a reservation without its active epoch is contradictory state, not recoverable setup", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(runtime.auth);
    runtime.signerA.signingCommitment(request);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const state = store.load();
    delete state.activeEpoch;
    store.save(state);
    const file = path.join(store.root, "frost-signer-state.json");
    const before = readFileSync(file);
    assert.throws(() => reopenSigner(runtime, 0), /FrostNonceRecoveryStateInvalid/u);
    assert.equal(before.equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

function coordinatorWithFaults(runtime, faults = {}) {
  const signers = [runtime.signerA, runtime.signerB].map((signer, index) => {
    const fault = faults[index === 0 ? "A" : "B"] ?? {};
    const invoke = (method, args) => fault[method] === undefined ? signer[method](...args) :
      fault[method](...args, () => signer[method](...args));
    return { signerId: signer.signerId, isAvailable: () => signer.isAvailable(),
      signingCommitment: request => invoke("signingCommitment", [request]),
      signatureShare: (request, commitments) => invoke("signatureShare", [request, commitments]),
      abortSigningSession: request => invoke("abortSigningSession", [request]) };
  });
  return new NativeFrostCoordinator({ signers, publicPackage: runtime.epoch.publicPackage,
    aggregateTweakedXOnlyPublicKey: runtime.epoch.aggregateTweakedXOnlyPublicKey });
}

function assertSessionOutcome(runtime, role, request, expected) {
  const state = JSON.parse(readFileSync(path.join(runtime.root, role === "A" ? "frost-a" : "frost-b", "frost-signer-state.json"), "utf8"));
  const session = state.signing[request.sessionId];
  assert.equal(session?.state, expected);
  if (expected === undefined) return;
  assert.equal(session.nonce, undefined);
  assert.equal(state.nonceReservationCounter, "1");
  const tombstone = state.nonceTombstones[session.nonceReservationId];
  assert.equal(tombstone.state, "CONSUMED");
  if (expected === "SIGNED") assert.equal(tombstone.outcome, "SHARE_PERSISTED");
}

for (const [stage, persisted, expectedA, expectedB] of [
  ["signingCommitment", false, "ABORTED", undefined],
  ["signingCommitment", true, "ABORTED", "ABORTED"],
  ["signatureShare", false, "SIGNED", "ABORTED"],
  ["signatureShare", true, "SIGNED", "SIGNED"],
]) {
  test(`coordinator cleans both peers after B ${stage} fails ${persisted ? "after" : "before"} persistence`, () => {
    const runtime = createRuntime();
    try {
      let aborts = 0;
      const abort = (request, original) => { aborts += 1; return original(); };
      const fail = (...args) => { if (persisted) args.at(-1)(); throw new Error("TEST_LOST_PARTICIPANT_RESPONSE"); };
      const coordinator = coordinatorWithFaults(runtime, { A: { abortSigningSession: abort },
        B: { [stage]: fail, abortSigningSession: abort } });
      const request = frostRequestFor(intentFromAuthorization(runtime.auth));
      assert.throws(() => coordinator.signAutomatically(request.intent), /TEST_LOST_PARTICIPANT_RESPONSE/u);
      assert.equal(aborts, 2);
      assertSessionOutcome(runtime, "A", request, expectedA);
      assertSessionOutcome(runtime, "B", request, expectedB);
    } finally { runtime.cleanup(); }
  });
}

test("invalid commitment envelope aborts both real reservations before shares", () => {
  const runtime = createRuntime();
  try {
    const coordinator = coordinatorWithFaults(runtime, { B: { signingCommitment: (request, original) =>
      ({ ...original(), sessionId: h("altered-commitment-session") }) } });
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    assert.throws(() => coordinator.signAutomatically(request.intent), /commitment domain mismatch/u);
    for (const role of ["A", "B"]) assertSessionOutcome(runtime, role, request, "ABORTED");
  } finally { runtime.cleanup(); }
});

test("A share failure burns both reservations even though B was not asked for a share", () => {
  const runtime = createRuntime();
  try {
    const coordinator = coordinatorWithFaults(runtime, { A: { signatureShare: () => { throw new Error("TEST_SHARE_FAILURE"); } } });
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    assert.throws(() => coordinator.signAutomatically(request.intent), /TEST_SHARE_FAILURE/u);
    for (const role of ["A", "B"]) assertSessionOutcome(runtime, role, request, "ABORTED");
  } finally { runtime.cleanup(); }
});

test("cleanup failure still visits the other peer and permanently refuses this coordinator instance", () => {
  const runtime = createRuntime();
  try {
    let calls = 0;
    const coordinator = coordinatorWithFaults(runtime, {
      A: { signingCommitment: (request, original) => { calls += 1; return original(); },
        abortSigningSession: () => { throw new Error("TEST_STORAGE_UNAVAILABLE"); } },
      B: { signingCommitment: (request, original) => { original(); throw new Error("TEST_LOST_RESPONSE"); } },
    });
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    assert.throws(() => coordinator.signAutomatically(request.intent), /FrostCoordinatorAbortIncomplete/u);
    assertSessionOutcome(runtime, "B", request, "ABORTED");
    assert.throws(() => coordinator.signAutomatically(request.intent, { attempt: 2 }), /FrostCoordinatorHardStop/u);
    assert.equal(calls, 1);
  } finally { runtime.cleanup(); }
});

test("bare abort session IDs are rejected without altering a valid pending reservation", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    runtime.signerA.signingCommitment(request);
    const file = path.join(runtime.root, "frost-a", "frost-signer-state.json");
    const before = readFileSync(file);
    assert.throws(() => runtime.signerA.abortSigningSession(request.sessionId), /PlainDataRequired/u);
    assert.equal(before.equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

test("bound abort is durable and idempotent without reopening a burned nonce", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    runtime.signerA.signingCommitment(request);
    const first = runtime.signerA.abortSigningSession(request);
    assert.equal(first?.state, "ABORTED");
    assert.equal(first.sessionId, request.sessionId);
    assert.equal(first.signerId, REQUIRED_FROST_SIGNERS[0]);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(runtime.signerA.abortSigningSession(request).state, "ABORTED");
    assertSessionOutcome(runtime, "A", request, "ABORTED");
    assert.throws(() => runtime.signerA.signingCommitment(request), /already burned/u);
  } finally { runtime.cleanup(); }
});

test("abort preserves a persisted signature share and returns a bound signed receipt", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    runtime.coordinator.signAutomatically(request.intent);
    for (const [index, signer] of [runtime.signerA, runtime.signerB].entries()) {
      const file = path.join(runtime.root, index === 0 ? "frost-a" : "frost-b", "frost-signer-state.json");
      const before = readFileSync(file);
      const receipt = signer.abortSigningSession(request);
      assert.equal(receipt.state, "SIGNED");
      assert.equal(receipt.intentDigest, request.intentDigest);
      assert.equal(before.equals(readFileSync(file)), true);
    }
  } finally { runtime.cleanup(); }
});

test("an aborted label cannot conceal a previously persisted share", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(baseAuthorization());
    runtime.coordinator.signAutomatically(request.intent);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const altered = store.load();
    altered.signing[request.sessionId].state = "ABORTED";
    store.save(altered);
    const file = path.join(store.root, "frost-signer-state.json");
    const before = readFileSync(file);
    assert.throws(() => runtime.signerA.abortSigningSession(request), /FrostAbortStateInvalid/u);
    assert.equal(before.equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

test("abort of a valid unknown request does not create a reservation or write state", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(intentFromAuthorization(runtime.auth));
    const file = path.join(runtime.root, "frost-a", "frost-signer-state.json");
    const before = readFileSync(file);
    assert.equal(runtime.signerA.abortSigningSession(request).state, "NOT_RESERVED");
    assert.equal(before.equals(readFileSync(file)), true);
  } finally { runtime.cleanup(); }
});

test("malformed abort requests fail before any state read or accessor execution", () => {
  let loads = 0;
  let getters = 0;
  const signer = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0,
    policy: makePolicy(baseAuthorization()), stateStore: { load() {
      loads += 1; return initialSignerState(REQUIRED_FROST_SIGNERS[0]);
    } } });
  const request = frostRequestFor(baseAuthorization());
  for (const change of [{ requestId: h("different") }, { epoch: 2 }, { sessionId: h("different") },
    { attempt: 2 }, { participantIds: [...REQUIRED_FROST_SIGNERS].reverse() }, { extra: true }]) {
    assert.throws(() => signer.abortSigningSession({ ...request, ...change }), /FrostRequest/u);
  }
  const accessor = { ...request };
  Object.defineProperty(accessor, "intent", { get() { getters += 1; return request.intent; } });
  assert.throws(() => signer.abortSigningSession(accessor), /PlainDataRequired/u);
  assert.equal(loads, 1);
  assert.equal(getters, 0);
});

test("abort rejects missing or contradictory tombstones without repairing stored state", () => {
  const runtime = createRuntime();
  try {
    const request = frostRequestFor(baseAuthorization());
    runtime.signerA.signingCommitment(request);
    const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
    const original = store.load();
    const nonceId = original.signing[request.sessionId].nonceReservationId;
    for (const tamper of [state => { delete state.nonceTombstones[nonceId]; },
      state => { state.nonceTombstones[nonceId].sessionId = h("other-session"); },
      state => { state.nonceTombstones[nonceId].commitmentSha256 = h("other-commitment"); },
      state => { state.nonceTombstones[nonceId].state = "CONSUMED"; },
      state => { state.nonceReservationCounter = "0"; },
      state => {
        const session = state.signing[request.sessionId];
        const tombstone = state.nonceTombstones[nonceId];
        const { nonceReservationId: ignored, reservationCounter: previous, ...commitment } = session.commitment;
        assert.equal(previous, "1");
        const reservationCounter = 1; // Deliberately noncanonical type for this small public counter.
        const replacement = sha256Canonical({ domain: "KINGPEPE_NATIVE_SOLANA_BRIDGE/FROST_NONCE_RESERVATION/V1",
          signerId: REQUIRED_FROST_SIGNERS[0], reservationCounter, requestId: request.requestId, epoch: request.epoch,
          sessionId: request.sessionId, intentDigest: request.intentDigest, messageHex: request.messageHex,
          participantIds: [...request.participantIds].sort(), commitment });
        session.reservationCounter = reservationCounter;
        session.nonceReservationId = replacement;
        session.commitment.reservationCounter = reservationCounter;
        session.commitment.nonceReservationId = replacement;
        tombstone.reservationCounter = reservationCounter;
        tombstone.nonceReservationId = replacement;
        tombstone.commitmentSha256 = sha256Canonical(session.commitment);
        delete state.nonceTombstones[nonceId];
        state.nonceTombstones[replacement] = tombstone;
      }]) {
      const corrupted = structuredClone(original);
      tamper(corrupted);
      store.save(corrupted);
      const file = path.join(store.root, "frost-signer-state.json");
      const before = readFileSync(file);
      assert.throws(() => runtime.signerA.abortSigningSession(request), /FrostAbortStateInvalid/u);
      assert.equal(before.equals(readFileSync(file)), true);
    }
  } finally { runtime.cleanup(); }
});

test("every abort receipt field and the exact field set are validated by the coordinator", () => {
  for (const field of ["protocol", "signerId", "requestId", "epoch", "sessionId", "intentDigest", "messageHex", "state", "extra", "missing"]) {
    const runtime = createRuntime();
    try {
      const coordinator = coordinatorWithFaults(runtime, {
        A: { abortSigningSession: (request, original) => {
          const receipt = { ...original() };
          if (field === "missing") delete receipt.epoch;
          else receipt[field] = field === "epoch" ? 2 : h("substituted-receipt");
          return receipt;
        } },
        B: { signingCommitment: (request, original) => { original(); throw new Error("TEST_LOST_RESPONSE"); } },
      });
      const request = frostRequestFor(baseAuthorization());
      assert.throws(() => coordinator.signAutomatically(request.intent), /FrostCoordinatorAbortIncomplete/u, field);
      for (const role of ["A", "B"]) assertSessionOutcome(runtime, role, request, "ABORTED");
      assert.throws(() => coordinator.signAutomatically(request.intent), /FrostCoordinatorHardStop/u);
    } finally { runtime.cleanup(); }
  }
});

test("abort receipt accessors are rejected without executing them", () => {
  const runtime = createRuntime();
  try {
    let getters = 0;
    const coordinator = coordinatorWithFaults(runtime, {
      A: { abortSigningSession: (request, original) => {
        const receipt = { ...original() };
        Object.defineProperty(receipt, "state", { get() { getters += 1; return "ABORTED"; } });
        return receipt;
      } }, B: { signingCommitment: () => { throw new Error("TEST_FAILURE"); } },
    });
    assert.throws(() => coordinator.signAutomatically(baseAuthorization()), /FrostCoordinatorAbortIncomplete/u);
    assert.equal(getters, 0);
  } finally { runtime.cleanup(); }
});

test("aggregate verification failure preserves signed shares for exact reconstruction", () => {
  const runtime = createRuntime();
  try {
    const wrong = new NativeFrostCoordinator({ signers: [runtime.signerA, runtime.signerB],
      publicPackage: runtime.epoch.publicPackage, aggregateTweakedXOnlyPublicKey: h("wrong-aggregate-key") });
    const request = frostRequestFor(baseAuthorization());
    assert.throws(() => wrong.signAutomatically(request.intent), /aggregate failed/u);
    for (const role of ["A", "B"]) assertSessionOutcome(runtime, role, request, "SIGNED");
    const result = runtime.coordinator.signAutomatically(request.intent);
    assert.equal(result.state, "SIGNED");
    assert.equal(schnorr.verify(Buffer.from(result.signatureHex, "hex"), Buffer.from(result.messageHex, "hex"),
      Buffer.from(runtime.epoch.aggregateTweakedXOnlyPublicKey, "hex")), true);
    for (const role of ["A", "B"]) assertSessionOutcome(runtime, role, request, "SIGNED");
  } finally { runtime.cleanup(); }
});

test("a burned attempt cannot be reused but an explicit fresh attempt uses new nonces", () => {
  const runtime = createRuntime();
  try {
    let failed = false;
    const coordinator = coordinatorWithFaults(runtime, { B: { signingCommitment: (request, original) => {
      const value = original();
      if (!failed) { failed = true; throw new Error("TEST_LOST_RESPONSE"); }
      return value;
    } } });
    const request = frostRequestFor(baseAuthorization());
    assert.throws(() => coordinator.signAutomatically(request.intent), /TEST_LOST_RESPONSE/u);
    assert.throws(() => coordinator.signAutomatically(request.intent), /already burned/u);
    const result = coordinator.signAutomatically(request.intent, { attempt: 2 });
    assert.equal(result.state, "SIGNED");
    assert.notEqual(result.sessionId, request.sessionId);
    for (const role of ["frost-a", "frost-b"]) {
      const state = JSON.parse(readFileSync(path.join(runtime.root, role, "frost-signer-state.json"), "utf8"));
      assert.equal(state.nonceReservationCounter, "2");
      assert.equal(state.signing[request.sessionId].state, "ABORTED");
      assert.equal(state.signing[result.sessionId].state, "SIGNED");
      assert.equal(state.signing[request.sessionId].nonceReservationId !== state.signing[result.sessionId].nonceReservationId, true);
      assert.equal(Object.values(state.signing).every(session => session.nonce === undefined), true);
    }
  } finally { runtime.cleanup(); }
});

test("an unconfirmed abort also stops asynchronous evidence coordination", async () => {
  const runtime = createRuntime();
  try {
    const coordinator = coordinatorWithFaults(runtime, { A: { abortSigningSession: () => undefined },
      B: { signingCommitment: () => { throw new Error("TEST_LOST_RESPONSE"); } } });
    assert.throws(() => coordinator.signAutomatically(baseAuthorization()), /FrostCoordinatorAbortIncomplete/u);
    await assert.rejects(() => coordinator.signAutomaticallyWithNativeEvidence(baseAuthorization()), /FrostCoordinatorHardStop/u);
  } finally { runtime.cleanup(); }
});

test("cleanup callbacks cannot reenter the active coordinator", () => {
  const runtime = createRuntime();
  try {
    let reentries = 0;
    const coordinator = coordinatorWithFaults(runtime, { A: { abortSigningSession: (request, original) => {
      assert.throws(() => coordinator.signAutomatically(request.intent, { attempt: 2 }), /FrostCoordinatorBusy/u);
      reentries += 1;
      return original();
    } }, B: { signingCommitment: () => { throw new Error("TEST_FAILURE"); } } });
    assert.throws(() => coordinator.signAutomatically(baseAuthorization()), /TEST_FAILURE/u);
    assert.equal(reentries, 1);
  } finally { runtime.cleanup(); }
});

test("waiting for quorum does not reserve or abort a signing session", () => {
  const runtime = createRuntime();
  try {
    let aborts = 0;
    runtime.signerB.setAvailableForTestOnly(false);
    const coordinator = coordinatorWithFaults(runtime, { A: { abortSigningSession: () => { aborts += 1; } } });
    assert.equal(coordinator.signAutomatically(baseAuthorization()).state, "WAITING_FOR_QUORUM");
    assert.equal(aborts, 0);
    for (const role of ["A", "B"]) assertSessionOutcome(runtime, role, frostRequestFor(baseAuthorization()), undefined);
  } finally { runtime.cleanup(); }
});

for (const saved of [false, true]) {
  test(`abort storage error ${saved ? "after" : "before"} persistence cannot acknowledge cleanup`, () => {
    const runtime = createRuntime();
    try {
      const store = new FileBackedFrostStateStore({ signerId: REQUIRED_FROST_SIGNERS[0],
        root: path.join(runtime.root, "frost-a"), repoRoot: REPO_ROOT });
      const request = frostRequestFor(baseAuthorization());
      const signerA = new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[0], index: 0, policy: runtime.policy,
        stateStore: { load: () => store.load(), save(state) {
          if (state.signing[request.sessionId]?.state === "ABORTED") {
            if (saved) store.save(state);
            throw Object.assign(new Error("TEST_STORAGE_FAILURE"), { code: "ENOSPC" });
          }
          store.save(state);
        } } });
      const coordinator = coordinatorWithFaults({ ...runtime, signerA }, {
        B: { signingCommitment: (packet, original) => { original(); throw new Error("TEST_RESPONSE_LOST"); } },
      });
      assert.throws(() => coordinator.signAutomatically(request.intent), /FrostCoordinatorAbortIncomplete/u);
      assert.equal(store.load().signing[request.sessionId].state, saved ? "ABORTED" : "RESERVED");
      assertSessionOutcome(runtime, "B", request, "ABORTED");
      assert.throws(() => coordinator.signAutomatically(request.intent, { attempt: 2 }), /FrostCoordinatorHardStop/u);
    } finally { runtime.cleanup(); }
  });
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
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: h("solana-local-deployment"), keyEpoch: 1,
    bridgeProgramId: h("bridge-program-id"), transceiverProgramId: h("transceiver-program-id"), mint: h("kpepe-mint") });
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
    solanaDeployment: h("solana-local-deployment"), keyEpoch: 1,
    bridgeProgramId: h("bridge-program-id"), transceiverProgramId: h("transceiver-program-id"), mint: h("kpepe-mint") };
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
    stateStore: { load() { loads += 1; return initialSignerState(REQUIRED_FROST_SIGNERS[0]); } } });
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
