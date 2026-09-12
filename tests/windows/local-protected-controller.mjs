// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TEST-only setup and observation. Separate CURRENT-PRINCIPAL role processes
// perform all economic actions through protected storage and real pinned mTLS.
// No imported credits, synthetic healthy reports, production keys or service install.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createLocalSecurityFixture, startActualLocalMonitor } from "./local-security-fixture.mjs";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { NativeFrostSigner, runTwoPartyDkg } from "../../native/frost/index.mjs";
import { createLocalNativeDkgPolicy, REQUIRED_FROST_SIGNERS } from "../../native/frost/policy/native-signing-policy.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { initialCoordinatorSigningState } from "../../native/frost/coordinator/protected-signing-journal.mjs";
import { initialSweepJobState } from "../../native/frost/coordinator/sweep-job-state.mjs";
import { ProjectAttester } from "../../services/attesters/attestation-service.mjs";
import { ProtectedAttesterAuthorizationJournal } from "../../services/attesters/authorization-journal.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier, REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { ProtectedNativeIntegrityMonitor } from "../../native/node/native-integrity.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { initialDepositOperationState, validateDepositOperationPlan } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { decodeDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { initialDepositControllerState } from "../../services/bridge-validator/deposit-controller-state.mjs";
import { initialNativeSweepOutbox } from "../../services/relayer/native-sweep-outbox.mjs";
import { initialSolanaDepositOutbox } from "../../services/relayer/solana-deposit-delivery.mjs";
import { initialReconciliationProgress, decodeReconciliationProgress } from "../../services/reconciliation/protected-deposit-reconciliation.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../.."), children = [], monitors = [], passed = [], boundaries = [];
const restartGroups = Object.freeze({
  NONE: [],
  DEPOSIT: ["DEPOSIT_OBSERVED", "NATIVE_VALIDATED", "SWEEP_PREPARED", "AGGREGATE_SIGNATURE_RETAINED"],
  CREDIT: ["NATIVE_BROADCAST_ATTEMPTED", "NATIVE_OUTBOX_ACCEPTED", "NATIVE_BROADCAST_ACCEPTED", "NATIVE_FINALITY_BEFORE_CREDIT_PERSIST", "NATIVE_FINALIZED_CREDIT_RETAINED"],
  CLAIM: ["ATTESTATION_A_READY", "ATTESTATION_B_READY", "RECEIPT_INTENT_PREPARED", "RECEIPT_PACKET_RETAINED", "RECEIPT_OUTBOX_ACCEPTED", "RECEIPT_ACCOUNT_FINALIZED", "CLAIM_INTENT_PREPARED", "CLAIM_PACKET_RETAINED", "CLAIM_OUTBOX_ACCEPTED"],
  SETTLEMENT: ["MINT_FINALIZED_RETAINED", "RECONCILIATION_PENDING", "COMPLETED"],
});
const restartGroup = process.env.KINGPEPE_TEST_CONTROLLER_RESTART_GROUP ?? "NONE";
assert(Object.hasOwn(restartGroups, restartGroup), "UnknownDisposableRestartGroup");
const restartTargets = [...restartGroups[restartGroup]], killedBoundaries = [];
const postMintReorg = process.env.KINGPEPE_TEST_CONTROLLER_POST_MINT_REORG === "1";
assert([undefined, "1"].includes(process.env.KINGPEPE_TEST_CONTROLLER_POST_MINT_REORG), "UnknownDisposableReorgMode");
const roleConfigurations = new Map(), monitorConfigurations = new Map();
let fixture, controlFile, stage = "SETUP", complete = false;
function actor(configuration) {
  roleConfigurations.set(configuration.role, structuredClone(configuration));
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "local-deposit-service-actor.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", failed, ended = false, closing = false, ready, completed, latest, halted, stopRejected = false;
  const finished = new Promise(resolve => child.once("close", code => { ended = true; if (!closing && !completed) failed ??= "SERVICE_EXITED"; resolve(code); }));
  const reject = () => { failed ??= "SERVICE_TRANSPORT_FAILED"; };
  child.on("error", reject); child.stdin.on("error", reject); child.stderr.on("data", reject);
  child.stdout.on("data", bytes => {
    buffer += bytes.toString("utf8"); if (buffer.length > 250000) { reject(); child.kill(); return; }
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line); assert(["READY", "STATUS", "BOUNDARY", "COMPLETED", "FAILED", "CLOSED", "STOP_REJECTED"].includes(value.event));
        if (value.event === "STOP_REJECTED") { assert.equal(value.role, configuration.role); assert.equal(configuration.probeStop, true); stopRejected = true; }
        if (value.event === "READY") { assert.equal(value.role, configuration.role); assert(!ready); ready = value; }
        if (value.event === "STATUS") latest = value;
        if (value.event === "BOUNDARY") { assert.match(value.stage, /^[A-Z_]{1,80}$/u); boundaries.push(value.stage);
          if (configuration.killBoundary === value.stage) halted = value.stage; }
        if (value.event === "COMPLETED") { assert.equal(configuration.role, "BRIDGE_VALIDATOR"); completed = value; }
        if (value.event === "FAILED") failed = /^[A-Za-z0-9_: -]{1,100}$/u.test(value.reason) ? value.reason : "SERVICE_REJECTED";
      } catch { reject(); child.kill(); }
    }
  });
  const value = {
    get ready() { return ready; }, get completed() { return completed; }, get latest() { return latest; },
    get failed() { return failed; }, get ended() { return ended; }, get halted() { return halted; }, role: configuration.role,
    get stopRejected() { return stopRejected; },
    async killAtBoundary(boundary) {
      assert.equal(configuration.role, "BRIDGE_VALIDATOR"); assert.equal(halted, boundary);
      assert(!ended && !closing && !completed); closing = true;
      assert(child.kill(), "ActualControllerKillRejected");
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("ActualControllerDeathTimeout")), 10000); });
      try { const code = await Promise.race([finished, timeout]); assert.notEqual(code, 0, "ControllerDidNotActuallyDie"); }
      finally { clearTimeout(timer); }
    },
    async close() {
      if (closing) return; closing = true;
      if (!ended && !child.stdin.destroyed) child.stdin.end(JSON.stringify(["STOP", {}]) + "\n");
      let timedOut = false; const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
      try { const code = await finished; assert.equal(code, 0, "ProtectedServiceStopFailed"); assert(!timedOut); }
      finally { clearTimeout(timer); }
    },
  };
  children.push(value); child.stdin.write(JSON.stringify(["INIT", configuration]) + "\n"); return value;
}
async function ready(child) {
  const until = Date.now() + 120000;
  while (!child.ready) { assert(!child.failed && !child.ended && Date.now() < until, child.failed ?? "ProtectedServiceStartTimeout"); await delay(100); }
  return child;
}
try {
  assert.equal(process.platform, "win32");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  controlFile = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const wait = async name => {
    const until = Date.now() + 1200000;
    while (!existsSync(controlFile(name))) { assert(Date.now() < until && !existsSync(controlFile("abort")), "ProtectedControllerTestHostUnavailable"); await delay(200); }
    const b = readFileSync(controlFile(name)); assert(b.length <= 250000); return JSON.parse(b);
  };
  const bootstrap = await wait("bootstrap.json"); assert.equal(bootstrap.protocol, "KINGPEPE_PROTECTED_DEPOSIT_BOOTSTRAP_V1");
  assert.equal(bootstrap.policy.environment, "localnet"); assert.equal(bootstrap.policy.nativeGenesis, REGTEST_GENESIS);
  fixture = await createLocalSecurityFixture({ repoRoot, policy: bootstrap.policy });
  stage = "EPHEMERAL_DKG_CEREMONY";
  const initial = bootstrap.policy, dkgPolicy = createLocalNativeDkgPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: initial.nativeGenesis,
    solanaDeployment: initial.solanaDeployment, bridgeProgramId: initial.managerProgramId, transceiverProgramId: initial.transceiverProgramId, mint: initial.mint, keyEpoch: initial.keyEpoch });
  const signerMaterial = [], setupSigners = [], setupStates = [];
  try {
    for (const [i, role] of REQUIRED_FROST_SIGNERS.entries()) {
      const stateOptions = fixture.options("frost-" + i, role, "frost-state");
      const base = WindowsProtectedFrostStateStore.createLocal(stateOptions, dkgPolicy);
      const state = await base.acquireExclusive(); setupStates.push(state);
      setupSigners.push(new NativeFrostSigner({ signerId: role, index: i, policy: dkgPolicy, stateStore: state }));
      signerMaterial.push({ role, stateOptions });
    }
    // Explicit TEST ceremony, not the runtime coordinator and no signing intent.
    // Only this public package may cross the inherited setup pipe afterward.
    const publicPackage = runTwoPartyDkg(setupSigners, { epoch: initial.keyEpoch });
    setupSigners.forEach(s => s.close()); for (const s of setupStates) await s.close();
    const attesterMaterial = [];
    for (const role of ["ATTESTER_A", "ATTESTER_B"]) {
      const seed = randomBytes(32), publicKeyHex = Buffer.from(ed25519.getPublicKey(seed)).toString("hex");
      const seedOptions = fixture.options(role.toLowerCase().replaceAll("_", "-") + "-seed", role, "attester-seed");
      const seedStore = fixture.store(seedOptions, seed);
      const policy = { role, attesterPublicKeyHex: publicKeyHex, protocolId: initial.protocolId, nativeNetwork: initial.nativeNetwork,
        nativeGenesisHex: initial.nativeGenesis, solanaDeploymentHex: initial.solanaDeployment, managerProgramIdHex: initial.managerProgramId,
        transceiverProgramIdHex: initial.transceiverProgramId, mintHex: initial.mint, policyEpoch: initial.policyEpoch, keyEpoch: initial.keyEpoch,
        acceptedNativeTrust: ["RPC_OBSERVATION"], depositsPaused: false, hardStop: false };
      const attester = ProjectAttester.fromWindowsProtectedStore({ store: seedStore, role, policy });
      const journalOptions = fixture.options(role.toLowerCase().replaceAll("_", "-") + "-journal", role, "attester-authorizations", seedOptions.context.instanceId);
      fixture.store(journalOptions, ProtectedAttesterAuthorizationJournal.initialState(attester)).close(); attester.close(); seedStore.close();
      attesterMaterial.push({ role, publicKeyHex, seedOptions, journalOptions, attesterPolicy: policy });
    }
    const payerSeed = randomBytes(32), feePayerPublicKey = base58Encode(ed25519.getPublicKey(payerSeed));
    const payerOptions = fixture.options("fee-payer", "FEE_PAYER", "fee-payer-seed"); fixture.store(payerOptions, payerSeed).close();
    writeFileSync(controlFile("identities.json"), JSON.stringify({ protocol: "KINGPEPE_DISPOSABLE_PROTECTED_IDENTITIES_V1",
      frostPublicKeyHex: publicPackage.aggregateTweakedXOnlyPublicKey, attesterPublicKeysHex: attesterMaterial.map(v => v.publicKeyHex), feePayerPublicKey }), { flag: "wx" });
    stage = "WAIT_REAL_DEPOSIT"; const prepared = await wait("prepared.json");
    assert.equal(prepared.protocol, "KINGPEPE_REAL_PROTECTED_DEPOSIT_PREPARED_V1");
    const { policy, manifest, deliveryPolicy } = prepared, operationPlan = validateDepositOperationPlan(prepared.operationPlan, policy);
    assert.equal(policy.frostPublicKeyHex, publicPackage.aggregateTweakedXOnlyPublicKey);
    assert.equal(deliveryPolicy.feePayerPublicKey, feePayerPublicKey);
    assert.deepEqual(deliveryPolicy.manifest, manifest); assert.deepEqual(deliveryPolicy.operationPolicy, policy);
    const executable = validateRuntimeFile(process.env.KINGPEPE_TEST_NATIVE_VERIFIER, repoRoot), executableSha256 = process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256;
    assert.match(executableSha256, /^[0-9a-f]{64}$/u); assert.equal(createHash("sha256").update(readFileSync(executable)).digest("hex"), executableSha256);
    for (const port of [bootstrap.nativeRpcPort, bootstrap.solanaRpcPort]) assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
    const rpcOptions = { endpoint: "http://127.0.0.1:" + bootstrap.nativeRpcPort, authCookieFile: controlFile("disposable-rpc.cookie"), repoRoot };
    const endpoint = "http://127.0.0.1:" + bootstrap.solanaRpcPort;
    const native = new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient(rpcOptions), executable });
    assert.equal((await native.observeChain()).genesis, policy.nativeGenesis); assert.equal(await new LocalDeploymentRpc({ endpoint }).genesis(), policy.solanaGenesis);
    const domain = { policy, deliveryPolicy, operationPlan, rpcOptions, endpoint, executable, executableSha256 };
    const supervisor = async role => { const p = await fixture.pair("SUPERVISOR", role); p.client.close(); return { supervisorOptions: p.clientOptions, supervisorPort: p.port }; };
    const endpoints = {};
    for (const material of signerMaterial) {
      stage = material.role; const pair = await fixture.deferredPair(material.role, "COORDINATOR");
      const child = await ready(actor({ ...domain, ...material, ...await supervisor(material.role), serverOptions: pair.serverOptions }));
      endpoints[material.role] = { role: material.role, options: pair.clientOptions, port: child.ready.ports.service };
    }
    stage = "COORDINATOR";
    const coordinatorPair = await fixture.deferredPair("COORDINATOR", "BRIDGE_VALIDATOR");
    const coordinatorJournal = fixture.options("coordinator-journal", "COORDINATOR", "coordinator-signing"), jobsOptions = fixture.options("coordinator-jobs", "COORDINATOR", "coordinator-jobs");
    fixture.store(coordinatorJournal, initialCoordinatorSigningState(publicPackage)).close(); fixture.store(jobsOptions, initialSweepJobState(policy)).close();
    const coordinator = await ready(actor({ ...domain, ...await supervisor("COORDINATOR"), role: "COORDINATOR", publicPackage,
      journalOptions: coordinatorJournal, jobsOptions, signers: REQUIRED_FROST_SIGNERS.map(role => endpoints[role]), serverOptions: coordinatorPair.serverOptions }));
    const attesters = [];
    for (const material of attesterMaterial) {
      stage = material.role; const pair = await fixture.deferredPair(material.role, "BRIDGE_VALIDATOR");
      const child = await ready(actor({ ...domain, ...material, ...await supervisor(material.role), serverOptions: pair.serverOptions }));
      attesters.push({ role: material.role, options: pair.clientOptions, port: child.ready.ports.service });
    }
    stage = "RELAYER"; const relayerPair = await fixture.deferredPair("RELAYER", "BRIDGE_VALIDATOR");
    const nativeOptions = fixture.options("native-delivery", "RELAYER", "native-sweep-outbox"), solanaOptions = fixture.options("solana-delivery", "RELAYER", "solana-deposit-outbox");
    fixture.store(nativeOptions, initialNativeSweepOutbox(policy)).close(); fixture.store(solanaOptions, initialSolanaDepositOutbox(deliveryPolicy)).close();
    const relayer = await ready(actor({ ...domain, ...await supervisor("RELAYER"), role: "RELAYER", nativeOptions, solanaOptions, serverOptions: relayerPair.serverOptions }));
    stage = "FEE_PAYER"; const payerPair = await fixture.deferredPair("FEE_PAYER", "BRIDGE_VALIDATOR");
    const payer = await ready(actor({ ...domain, ...await supervisor("FEE_PAYER"), role: "FEE_PAYER", seedOptions: payerOptions, serverOptions: payerPair.serverOptions }));
    stage = "BRIDGE_VALIDATOR"; const book = fixture.options("deposit-book", "BRIDGE_VALIDATOR", "deposit-operations"), controllerOptions = fixture.options("deposit-controller", "BRIDGE_VALIDATOR", "deposit-controller");
    fixture.store(book, initialDepositOperationState(policy)).close(); fixture.store(controllerOptions, initialDepositControllerState({ deliveryPolicy, creditValiditySeconds: 3600 })).close();
    const snapshotPair = await fixture.deferredPair("BRIDGE_VALIDATOR", "RECONCILIATION");
    const validatorConfig = { ...domain, ...await supervisor("BRIDGE_VALIDATOR"), role: "BRIDGE_VALIDATOR", journalOptions: book,
      controllerOptions, snapshotServerOptions: snapshotPair.serverOptions,
      jobs: { options: coordinatorPair.clientOptions, port: coordinator.ready.ports.service },
      nativeOutbox: { options: relayerPair.clientOptions, port: relayer.ready.ports.service },
      solanaOutbox: { options: relayerPair.clientOptions, port: relayer.ready.ports.service },
      feePayer: { options: payerPair.clientOptions, port: payer.ready.ports.service }, attesters };
    let validator = await ready(actor({ ...validatorConfig, killBoundary: restartTargets[0] }));
    const nativePolicy = { environment: "localnet", nativeGenesis: policy.nativeGenesis, solanaDeployment: policy.solanaDeployment,
      keyEpoch: policy.keyEpoch, minimumConfirmations: policy.minimumConfirmations, maximumStallMs: manifest.maximumStallMs };
    let reconciliationConfig;
    for (const role of ["NATIVE_OBSERVER", "SOLANA_OBSERVER", "RECONCILIATION"]) {
      stage = role; const progressOptions = fixture.options(role.toLowerCase().replaceAll("_", "-") + "-progress", role, role === "RECONCILIATION" ? "reconciliation-progress" : "chain-progress");
      const payload = role === "NATIVE_OBSERVER" ? ProtectedNativeIntegrityMonitor.initialPayload(nativePolicy, await native.observeChain()) :
        role === "SOLANA_OBSERVER" ? ProtectedSolanaDeploymentMonitor.initialProgress(manifest) : initialReconciliationProgress(policy, manifest);
      fixture.store(progressOptions, payload).close(); const p = await fixture.pair("SUPERVISOR", role); p.client.close();
      const configuration = { role, policy: role === "NATIVE_OBSERVER" ? nativePolicy : policy, manifest, progressOptions,
        ipcOptions: p.clientOptions, port: p.port, rpcOptions: role === "SOLANA_OBSERVER" ? { endpoint } : rpcOptions, executable, executableSha256,
        journalIpcOptions: snapshotPair.clientOptions, journalPort: validator.ready.ports.snapshot, solanaRpcOptions: { endpoint } };
      if (role === "RECONCILIATION") reconciliationConfig = configuration;
      monitorConfigurations.set(role, configuration);
      const monitor = await startActualLocalMonitor(configuration); monitors.push(monitor);
    }
    passed.push("SEPARATE_PROTECTED_ROLE_PROCESSES_STARTED_WITH_REAL_SOURCE_MONITORS");
    let retainedSigned, retainedCredit, retainedMint;
    const inspectRetained = () => {
      const store = new WindowsProtectedStore(book);
      try {
        const current = store.read();
        try {
          const state = decodeDepositOperationState(current.payload, policy); assert(state.operations.length <= 1);
          const operation = state.operations[0]; if (!operation) return;
          assert.deepEqual(operation.plan, operationPlan);
          for (const [key, retained] of [["signedTransactionHex", retainedSigned], ["finalizedCredit", retainedCredit], ["mintReceipt", retainedMint]])
            if (retained !== undefined) assert.deepEqual(operation[key], retained, "RetainedEconomicEffectChanged:" + key);
          if (operation.signedTransactionHex !== null) retainedSigned = operation.signedTransactionHex;
          if (operation.finalizedCredit !== null) retainedCredit = structuredClone(operation.finalizedCredit);
          if (operation.mintReceipt !== null) retainedMint = structuredClone(operation.mintReceipt);
        } finally { current.payload.fill(0); }
      } finally { store.close(); }
    };
    stage = "AUTOMATIC_DEPOSIT"; const until = Date.now() + 1200000; let last = "", lastClockDiagnostic = 0;
    while (!validator.completed) {
      assert(!existsSync(controlFile("abort")), "ProtectedControllerHostAborted");
      assert(Date.now() < until, "ProtectedControllerCompletionTimeout");
      const failed = children.find(c => c.failed); assert(!failed, failed?.role + ":" + failed?.failed);
      assert(monitors.every(m => !m.failed), "ActualProtectedSourceFailed");
      if (validator.halted) {
        const boundary = restartTargets[0]; assert.equal(validator.halted, boundary);
        await validator.killAtBoundary(boundary); inspectRetained();
        await monitors[2].close(); restartTargets.shift(); killedBoundaries.push(boundary);
        validator = await ready(actor({ ...validatorConfig, killBoundary: restartTargets[0] }));
        monitors[2] = await startActualLocalMonitor({ ...reconciliationConfig, journalPort: validator.ready.ports.snapshot });
        passed.push("ACTUAL_CONTROLLER_KILL_REOPEN_" + boundary);
        console.error("PROTECTED_CONTROLLER_RESTART:" + boundary); continue;
      }
      const state = await fixture.authority.status(); assert.notEqual(state.state, "HARD_STOP_INTEGRITY", "UnexpectedIntegrityStop");
      const observation = JSON.stringify({ controller: validator.latest, integrity: state.state, sources: monitors.map(m => m.latest),
        services: children.filter(c => !c.ended).map(c => ({ role: c.role, status: c.latest ?? null })), boundaries });
      if (observation !== last) { last = observation; console.error("PROTECTED_CONTROLLER_PROGRESS:" + observation); }
      if (boundaries.includes("CLAIM_PACKET_RETAINED") && Date.now() - lastClockDiagnostic >= 30000) {
        lastClockDiagnostic = Date.now();
        // Read-only TEST diagnostics, not time/finality authorization. Never
        // change a signed validity window, replace a blockhash or print packets.
        try {
          const rpc = new SolanaLocalRpcClient({ endpoint });
          const account = await rpc.getAccountInfo("SysvarC1ock11111111111111111111111111111111");
          assert(account && Array.isArray(account.data) && account.data[1] === "base64");
          const bytes = Buffer.from(account.data[0], "base64"); assert.equal(bytes.length, 40);
          console.error("PROTECTED_CONTROLLER_CLOCK:" + JSON.stringify({ wallSeconds: String(Math.floor(Date.now() / 1000)),
            clockSlot: bytes.readBigUInt64LE(0).toString(), clockSeconds: bytes.readBigInt64LE(32).toString(),
            finalizedHeight: (await rpc.getBlockHeight()).toString() }));
        } catch { console.error("PROTECTED_CONTROLLER_CLOCK:UNAVAILABLE"); }
      }
      await delay(1000);
    }
    const completion = validator.completed; assert.equal(completion.result.state, "COMPLETED");
    assert.equal(restartTargets.length, 0, "RequiredProcessKillNotExercised");
    assert.deepEqual(killedBoundaries, restartGroups[restartGroup]); inspectRetained();
    assert(completion.book.finalizedCredit && completion.book.mintReceipt);
    passed.push("AUTOMATIC_PROTECTED_FROST_ATTESTERS_FEE_PAYER_AND_RELAYER_REACH_COMPLETED");
    for (const boundary of ["DEPOSIT_OBSERVED", "NATIVE_VALIDATED", "SWEEP_PREPARED", "AGGREGATE_SIGNATURE_RETAINED", "NATIVE_BROADCAST_ATTEMPTED",
      "NATIVE_FINALIZED_CREDIT_RETAINED", "ATTESTATION_A_READY", "ATTESTATION_B_READY", "RECEIPT_PACKET_RETAINED", "CLAIM_PACKET_RETAINED", "MINT_FINALIZED_RETAINED", "COMPLETED"])
      assert(boundaries.includes(boundary), "ProtectedBoundaryNotExecuted:" + boundary);
    writeFileSync(controlFile("controller-completed.json"), JSON.stringify({ ...completion.result, book: completion.book }), { flag: "wx" });
    assert.equal((await wait("host-verified.json")).state, "COMPLETED");
    passed.push("INDEPENDENT_LINUX_RAW_NATIVE_AND_FINALIZED_SOLANA_RECHECK");
    if (postMintReorg) {
      stage = "ACTUAL_POST_MINT_REORG";
      writeFileSync(controlFile("reorg-request.json"), JSON.stringify({ action: "REGTEST_HIGHER_WORK_POST_MINT_REORG" }), { flag: "wx" });
      assert.equal((await wait("reorg-completed.json")).action, "REGTEST_HIGHER_WORK_POST_MINT_REORG");
      const waitForIncident = async () => {
        const until = Date.now() + 180000;
        for (;;) {
          assert(Date.now() < until, "ProtectedPostMintIncidentMissing");
          assert(monitors.every(m => !m.failed), "ProtectedIncidentMonitorFailed");
          if ((await fixture.authority.status()).state === "HARD_STOP_INTEGRITY" && monitors[2].latest?.state === "HARD_STOP_INTEGRITY" &&
              monitors[2].latest?.reason === "ACCEPTED_NATIVE_BASIS_INVALIDATED") return;
          await delay(1000);
        }
      };
      await waitForIncident();
      const progress = new WindowsProtectedStore(reconciliationConfig.progressOptions);
      try { const value = progress.read();
        try { const incident = decodeReconciliationProgress(value.payload, policy, manifest).incident;
          assert.equal(incident.reason, "ACCEPTED_NATIVE_BASIS_INVALIDATED");
          assert.deepEqual(incident.affectedOperations, [operationPlan.operationId]);
          assert.equal(incident.affectedReserveAtomic, operationPlan.depositIntent.amountAtomic);
        } finally { value.payload.fill(0); }
      } finally { progress.close(); }
      inspectRetained(); passed.push("ACTUAL_PROTECTED_POST_MINT_REORG_RETAINS_EXACT_INCIDENT_AND_LIABILITY");
      stage = "ALL_PROTECTED_SERVICES_RESTART_AFTER_INCIDENT";
      for (const m of [...monitors].reverse()) await m.close(); monitors.length = 0;
      for (const c of [...children].reverse()) await c.close();
      const supervisorPorts = await fixture.restartAuthorityProcess();
      assert.equal((await fixture.authority.status()).state, "HARD_STOP_INTEGRITY");
      const reopened = new Map();
      for (const role of ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "COORDINATOR", "ATTESTER_A", "ATTESTER_B", "RELAYER", "FEE_PAYER", "BRIDGE_VALIDATOR"]) {
        const configuration = structuredClone(roleConfigurations.get(role));
        configuration.supervisorPort = supervisorPorts.get(configuration.supervisorPort); assert(configuration.supervisorPort);
        configuration.probeStop = true; delete configuration.killBoundary;
        if (role === "COORDINATOR") for (const peer of configuration.signers) peer.port = reopened.get(peer.role).ready.ports.service;
        if (role === "BRIDGE_VALIDATOR") {
          configuration.jobs.port = reopened.get("COORDINATOR").ready.ports.service;
          configuration.nativeOutbox.port = reopened.get("RELAYER").ready.ports.service;
          configuration.solanaOutbox.port = reopened.get("RELAYER").ready.ports.service;
          configuration.feePayer.port = reopened.get("FEE_PAYER").ready.ports.service;
          for (const peer of configuration.attesters) peer.port = reopened.get(peer.role).ready.ports.service;
        }
        const child = await ready(actor(configuration)); assert(child.stopRejected); reopened.set(role, child);
      }
      validator = reopened.get("BRIDGE_VALIDATOR");
      for (const role of ["NATIVE_OBSERVER", "SOLANA_OBSERVER", "RECONCILIATION"]) {
        const configuration = structuredClone(monitorConfigurations.get(role));
        configuration.port = supervisorPorts.get(configuration.port); assert(configuration.port);
        if (role === "RECONCILIATION") configuration.journalPort = validator.ready.ports.snapshot;
        monitors.push(await startActualLocalMonitor(configuration));
      }
      await waitForIncident(); inspectRetained();
      passed.push("ACTUAL_FULL_PROTECTED_SERVICE_PROCESS_RESTART_RETAINS_STOP_AND_BLOCKS_ALL_ECONOMIC_ROLES");
      writeFileSync(controlFile("chain-recovery-request.json"), JSON.stringify({ action: "REGTEST_CHAIN_HEALTH_RECOVERY" }), { flag: "wx" });
      assert.equal((await wait("chain-recovered.json")).action, "REGTEST_CHAIN_HEALTH_RECOVERY");
      await delay(2000); await waitForIncident(); inspectRetained();
      const bank = await new LocalDeploymentRpc({ endpoint }).snapshot(manifest);
      assert.equal(Buffer.from(bank.accounts[2].data[0], "base64").readBigUInt64LE(36).toString(), operationPlan.depositIntent.amountAtomic);
      passed.push("CHAIN_RECOVERY_NEVER_AUTO_CLEARS_STOP_OR_MUTATES_SOLANA_SUPPLY");
    }
    writeFileSync(controlFile("windows-done.json"), JSON.stringify({ state: "COMPLETED" }), { flag: "wx" }); complete = true;
  } finally { setupSigners.forEach(s => s.close()); for (const s of setupStates) await s.close(); }
} catch (error) {
  const reason = /^[A-Za-z0-9_: -]{1,120}$/u.test(error?.message) ? error.message : "REDACTED";
  console.error("LOCAL_PROTECTED_CONTROLLER_FAILED:" + stage + ":" + reason); process.exitCode = 1;
  if (controlFile && !existsSync(controlFile("abort"))) writeFileSync(controlFile("abort"), "DISPOSABLE_TEST_ABORT", { flag: "wx" });
} finally {
  let cleanupFailed = false;
  for (const m of [...monitors].reverse()) { try { await m.close(); } catch { cleanupFailed = true; } }
  for (const c of [...children].reverse()) { try { await c.close(); } catch { cleanupFailed = true; } }
  try { await fixture?.close(); } catch { cleanupFailed = true; }
  if (cleanupFailed) { console.error("LOCAL_PROTECTED_CONTROLLER_CLEANUP_FAILED"); process.exitCode = 1; }
  if (complete && !cleanupFailed) console.log(JSON.stringify({ state: "COMPLETED", pass: passed.length, fail: 0, passed, boundaries,
    restartGroup, killedBoundaries, postMintReorg, scope: "CURRENT_PRINCIPAL_ACTUAL_CHAINS_SELECTED_CONTROLLER_KILLS_NOT_CROSS_SID_OR_COMPLETE_ALL_SERVICE_MATRIX",
    productionReady: false, mainnetActivation: "DISABLED", phase09: "NOT_STARTED" }));
}
