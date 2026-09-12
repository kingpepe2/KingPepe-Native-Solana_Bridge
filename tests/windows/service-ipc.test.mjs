// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import tls from "node:tls";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { WindowsProtectedStore, windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc, encodeIpcEnrollment } from "../../shared/windows/service-ipc.mjs";
import { nativeFrostIpcHandler, ProtectedRemoteFrostPeer } from "../../native/frost/signer/protected-service.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { WindowsFencedFrostStateStore } from "../../native/frost/state/windows-fenced-state-store.mjs";
import { NativeFrostSigner, NativeFrostCoordinator, createNativeSigningPolicy, createNativeFrostSigningRequest, runTwoPartyDkg,
  FROST_SIGNING_INTENT_PROTOCOL, FROST_SIGNING_MODE, REQUIRED_FROST_SIGNERS } from "../../native/frost/index.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { ProtectedIntegrityAuthority, RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { INTEGRITY_ROLES } from "../../shared/service-integrity-policy.mjs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ProjectAttester, verifyProjectAttestation } from "../../services/attesters/attestation-service.mjs";
import { attesterIpcHandler } from "../../services/attesters/protected-service.mjs";
import { ProtectedAttesterAuthorizationJournal } from "../../services/attesters/authorization-journal.mjs";
import { ProtectedCoordinatorSigningJournal, initialCoordinatorSigningState } from "../../native/frost/coordinator/protected-signing-journal.mjs";
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { deploymentFixture } from "../integration/deployment-fixture.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { ProtectedNativeIntegrityMonitor, compareNativeProgress } from "../../native/node/native-integrity.mjs";
import { nativeProgressFixture } from "../integration/native-progress-fixture.mjs";
import { witnessTestAction } from "./protected-witness-test-helper.mjs";
import { SOURCE_HEALTH_ROLES } from "../../shared/source-health-window.mjs";
import { depositOperationFixture } from "../integration/deposit-operation-fixture.mjs";
import { ProtectedDepositOperationJournal } from "../../services/bridge-validator/protected-deposit-journal.mjs";
import { initialDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { depositSnapshotIpcHandler, ProtectedDepositSnapshotClient } from "../../services/bridge-validator/protected-deposit-snapshot.mjs";
import { reconciliationFixture } from "../integration/reconciliation-fixture.mjs";
import { initialReconciliationProgress, ProtectedDepositReconciliationMonitor } from "../../services/reconciliation/protected-deposit-reconciliation.mjs";
import { initialSweepJobState, decodeSweepJobState } from "../../native/frost/coordinator/sweep-job-state.mjs";
import { ProtectedSweepJobs } from "../../native/frost/coordinator/protected-sweep-jobs.mjs";
import { ProtectedSweepJobClient, sweepJobIpcHandler } from "../../native/frost/coordinator/sweep-job-ipc.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { solanaDeliveryFixture } from "../integration/solana-delivery-fixture.mjs";
import { initialSolanaDepositOutbox, decodeSolanaDepositOutbox, validateSolanaDepositDelivery, solanaDeliveryId } from "../../services/relayer/solana-deposit-delivery.mjs";
import { ProtectedSolanaDepositOutbox } from "../../services/relayer/protected-solana-deposit-outbox.mjs";
import { ProtectedSolanaDepositClient, solanaDepositIpcHandler } from "../../services/relayer/solana-deposit-ipc.mjs";

if (process.platform !== "win32") throw new Error("WINDOWS_IPC_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../.."), serviceSid = windowsCurrentServiceSid();
const h = v => createHash("sha256").update(v).digest("hex");
const deployment = h("protected-ipc-local-deployment"), protocol = "KINGPEPE_SERVICE_IPC_V2";
const cleanups = new Map(), witnessOptions = new Map();
function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ipc-test-"));
  cleanups.set(root, []);
  witnessOptions.set(root, new Map());
  t.after(async () => {
    let failed = false;
    for (const fn of cleanups.get(root)) { try { await fn(); } catch { failed = true; } }
    for (const opts of witnessOptions.get(root).values()) { try { witnessTestAction(opts, "DELETE"); } catch { failed = true; } }
    witnessOptions.delete(root);
    cleanups.delete(root);
    assert(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-ipc-test-"), "UnsafeTestCleanup");
    try { rmSync(root, { recursive: true }); } catch { failed = true; }
    if (failed) throw new Error("IpcTestCleanupFailed");
  }); return root;
}
function certificate(root, name) {
  const keyFile = path.join(root, name + ".key"), certFile = path.join(root, name + ".crt");
  const result = spawnSync(process.env.KINGPEPE_TEST_OPENSSL ?? "openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
    "-nodes", "-days", "1", "-subj", "/CN=kingpepe-service.invalid", "-addext", "subjectAltName=DNS:kingpepe-service.invalid",
    "-keyout", keyFile, "-out", certFile], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 15000 });
  assert(result.status === 0, "AuthoritativeTestOpenSslRequired");
  const privateKeyPem = readFileSync(keyFile, "utf8"), certificatePem = readFileSync(certFile, "utf8");
  unlinkSync(keyFile); // Disposable generation output removed BEFORE protected enrollment.
  return { privateKeyPem, certificatePem };
}
function options(root, name, role, purpose = "service-auth", instanceId = h(name)) {
  const opts = { root: path.join(root, name), anchorRoot: path.join(root, name + "-anchor"), repoRoot,
    context: { role, purpose, serviceSid, environment: "localnet", nativeGenesis: REGTEST_GENESIS,
      solanaDeployment: deployment, instanceId, keyEpoch: 1 } };
  // Negative tests mutate enrollment inputs. Cleanup retains the independently
  // registered LOCALNET snapshot, not those subsequently corrupted references.
  witnessOptions.get(root).set(name, structuredClone(opts)); return opts;
}
function enroll(opts, own, peer, peerRole) {
  const bytes = encodeIpcEnrollment({ ...own, peerCertificatePem: peer.certificatePem, peerRole });
  try { return WindowsProtectedStore.create(opts, bytes); } finally { bytes.fill(0); }
}
function fixture(t, role = "KINGPEPE_FROST_A", clientRole = "COORDINATOR") {
  const root = temporary(t), serverCert = certificate(root, "server"), clientCert = certificate(root, "client");
  const serverOptions = options(root, "server-state", role), clientOptions = options(root, "client-state", clientRole);
  const serverStore = enroll(serverOptions, serverCert, clientCert, clientRole), clientStore = enroll(clientOptions, clientCert, serverCert, role);
  const server = new ProtectedServiceIpc(serverStore), client = new ProtectedServiceIpc(clientStore);
  cleanups.get(root).push(() => { server.close(); client.close(); serverStore.close(); clientStore.close(); });
  return { root, role, server, client, serverStore, clientStore, serverOptions, clientOptions, serverCert, clientCert };
}
function request(overrides = {}) { return { method: "verifyNativeEvidence", operationId: h("operation"), payload: { bounded: true }, ...overrides }; }

async function integrityFixture(t, initialState = "RUNNING") {
  const root = temporary(t), opts = options(root, "authority", "SUPERVISOR", "global-integrity");
  let authority = await ProtectedIntegrityAuthority.createLocal(opts, initialState);
  cleanups.get(root).push(() => authority.close());
  return { options: opts, get authority() { return authority; },
    async restart() { await authority.close(); authority = await ProtectedIntegrityAuthority.openLocal(new WindowsProtectedStore(opts)); },
    async peer(role) {
      const f = fixture(t, "SUPERVISOR", role), port = await f.server.listen(input => authority.handle(input));
      return { ...f, port, guard: new RemoteIntegrityGuard({ ipc: f.client, port }) };
    } };
}

async function isolatedIntegrityFixture(t) {
  // Real process separation keeps the synthetic source watchdog independent of
  // synchronous signer DPAPI work. No private FROST material crosses this pipe.
  const root = temporary(t), opts = options(root, "authority", "SUPERVISOR", "global-integrity");
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "integrity-authority-actor.mjs")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let id = 0, buffer = ""; const pending = new Map(), ended = new Promise(resolve => child.once("close", resolve));
  const failed = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("TestAuthorityActorUnavailable")); } pending.clear(); };
  child.on("error", failed); child.on("close", failed); child.stderr.on("data", failed); child.stdin.on("error", failed);
  child.stdout.on("data", b => {
    buffer += b.toString("utf8"); if (buffer.length > 16384) { failed(); child.kill(); return; }
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const [responseId, ok, result] = JSON.parse(line), p = pending.get(responseId); assert(p);
        clearTimeout(p.timer); pending.delete(responseId); if (ok) p.resolve(result); else p.reject(new Error("TestAuthorityActorRejected"));
      } catch { failed(); child.kill(); }
    }
  });
  const call = (method, payload = {}) => new Promise((resolve, reject) => {
    const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(new Error("TestAuthorityActorTimeout")); }, 15000);
    pending.set(requestId, { resolve, reject, timer }); child.stdin.write(JSON.stringify([requestId, method, payload]) + "\n");
  });
  cleanups.get(root).push(async () => {
    try { await call("CLOSE"); } finally { child.stdin.end();
      const timer = setTimeout(() => child.kill(), 10000); try { await ended; } finally { clearTimeout(timer); } }
  });
  await call("INIT", opts);
  return { authority: { status: () => call("STATUS") }, restart: () => call("REOPEN"), enableTestSources: () => call("WATCH_TEST_SOURCES"),
    async reopenPeerTransport(peer) {
      const server = new ProtectedServiceIpc(new WindowsProtectedStore(peer.serverOptions));
      cleanups.get(peer.root).push(() => server.close());
      return server.listen(input => call("HANDLE", input));
    },
    async peer(role) {
      const f = fixture(t, "SUPERVISOR", role), port = await f.server.listen(input => call("HANDLE", input));
      return { ...f, port, guard: new RemoteIntegrityGuard({ ipc: f.client, port }) };
    } };
}

// ONLY the synthetic FROST/attester component fixtures use this watchdog.
// It does not represent a chain or reconciliation check. Dedicated admission
// tests below use real mutually authenticated reports and never this helper.
function testOnlyHealthySources(t, global) {
  const pulse = () => {
    for (const peerRole of SOURCE_HEALTH_ROLES) {
      const operationId = h("synthetic-health-" + peerRole);
      const { check } = global.authority.handle({ peerRole, operationId, method: "beginSourceCheck", payload: {} });
      global.authority.handle({ peerRole, operationId, method: "finishSourceCheck", payload: {
        generation: check.generation, challenge: check.challenge, state: "OBSERVED_MATCH", evidenceDigest: h("TEST_ONLY_SOURCE_FIXTURE") } });
    }
  };
  pulse();
  const timer = setInterval(() => { try { pulse(); } catch { clearInterval(timer); } }, 10000);
  t.after(() => clearInterval(timer));
}

async function protectedDepositFixture(t) {
  const global = await isolatedIntegrityFixture(t), peer = await global.peer("BRIDGE_VALIDATOR");
  const data = await depositOperationFixture({ root: peer.root, repoRoot, solanaDeployment: deployment });
  const opts = options(peer.root, "deposit-operations", "BRIDGE_VALIDATOR", "deposit-operations");
  const bytes = initialDepositOperationState(data.policy);
  let store;
  try { store = WindowsProtectedStore.create(opts, bytes); } finally { bytes.fill(0); }
  cleanups.get(peer.root).push(() => store.close());
  const open = nextStore => ProtectedDepositOperationJournal.open({ store: nextStore ?? new WindowsProtectedStore(opts), integrity: peer.guard, policy: data.policy });
  const journal = await open(store); cleanups.get(peer.root).push(() => journal.close());
  await global.enableTestSources();
  return { ...data, global, peer, opts, store, journal, open };
}

// Real protected storage/mTLS and HTTP transport, SYNTHETIC Solana accounts.
// These are failure-boundary tests, not local-validator or chain evidence.
async function protectedSolanaDeliveryFixture(t) {
  const global = await isolatedIntegrityFixture(t), peer = await global.peer("RELAYER"), f = await solanaDeliveryFixture();
  const delivery = await f.delivery(), expected = validateSolanaDepositDelivery(delivery, f.policy);
  const control = { snapshot: f.accounts(), status: null, height: 100, sends: [], loseSend: false, hook: undefined };
  let serverFailed = false;
  const server = http.createServer(async (req, res) => {
    try {
      let text = ""; for await (const bytes of req) { text += bytes.toString("utf8"); assert(text.length <= 16000); }
      const request = JSON.parse(text); let result;
      if (request.method === "getGenesisHash") result = control.snapshot.genesis;
      else if (request.method === "getBlockHeight") result = control.height;
      else if (request.method === "getSignatureStatuses") result = { context: { slot: control.snapshot.slot }, value: [control.status] };
      else if (request.method === "getMultipleAccounts") {
        result = { context: { slot: control.snapshot.slot }, value: control.snapshot.accounts };
        if (control.hook) { const hook = control.hook; control.hook = undefined; await hook(); }
      } else if (request.method === "sendTransaction") {
        assert.equal(request.params[0], delivery.preparedTransactionBase64);
        assert.equal(request.params[1].skipPreflight, false); control.sends.push(request.params[0]);
        if (control.loseSend) { res.destroy(); return; } result = expected.signature;
      } else throw new Error("UnexpectedSyntheticSolanaMethod");
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    } catch { serverFailed = true; res.destroy(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(() => serverFailed ? reject(new Error("SyntheticSolanaTransportFixtureFailed")) : resolve()); }));
  const endpoint = "http://127.0.0.1:" + server.address().port, opts = options(peer.root, "solana-delivery", "RELAYER", "solana-deposit-outbox");
  const bytes = initialSolanaDepositOutbox(f.policy); let store = WindowsProtectedStore.create(opts, bytes); bytes.fill(0);
  let outbox;
  const open = () => ProtectedSolanaDepositOutbox.open({ store, integrity: peer.guard, policy: f.policy, endpoint });
  outbox = await open(); cleanups.get(peer.root).push(() => outbox.close());
  const transport = fixture(t, "RELAYER", "BRIDGE_VALIDATOR"); let loseEnqueue = false, didLoseEnqueue = false;
  const port = await transport.server.listen(async input => {
    const result = await solanaDepositIpcHandler({ outbox, policy: f.policy, integrity: peer.guard })(input);
    if (loseEnqueue) { loseEnqueue = false; didLoseEnqueue = true; throw new Error("TEST_DURABLE_ENQUEUE_ACK_LOST"); } return result;
  });
  const client = new ProtectedSolanaDepositClient({ ipc: transport.client, port, policy: f.policy });
  await global.enableTestSources();
  const probe = () => { const s = new WindowsProtectedStore(opts); try { const r = s.read();
    try { return { revision: r.revision, state: decodeSolanaDepositOutbox(r.payload, f.policy) }; } finally { r.payload.fill(0); }
  } finally { s.close(); } };
  return { ...f, makeDelivery: f.delivery, delivery, expected, control, global, peer, opts, endpoint, client, transport, port, probe,
    get outbox() { return outbox; }, get store() { return store; },
    loseEnqueue() { loseEnqueue = true; }, get didLoseEnqueue() { return didLoseEnqueue; },
    async reopen() { await outbox.close(); store = new WindowsProtectedStore(opts); outbox = await open(); } };
}

test("protected Solana delivery persists before lost mTLS acceptance and rejects substituted operation", async t => {
  const f = await protectedSolanaDeliveryFixture(t); f.loseEnqueue();
  await assert.rejects(f.client.enqueue(f.delivery)); assert(f.didLoseEnqueue);
  const accepted = await f.client.enqueue(f.delivery); assert.equal(accepted.state, "ACCEPTED");
  const before = f.probe(); await f.reopen(); assert.deepEqual(await f.client.enqueue(f.delivery), accepted);
  assert.equal(f.probe().revision, before.revision); assert.equal(f.probe().state.records.length, 1); assert.equal(f.control.sends.length, 0);
  await assert.rejects(f.transport.client.request(f.port, { method: "enqueueSolanaDeposit", operationId: h("wrong"), payload: f.delivery }));
});
test("protected Solana delivery retains uncertainty after lost send and observes outcome without resend", async t => {
  const f = await protectedSolanaDeliveryFixture(t); await f.client.enqueue(f.delivery); f.control.loseSend = true;
  assert.equal((await f.outbox.runOne()).state, "WAITING_FOR_DEPENDENCY"); assert.equal(f.control.sends.length, 1);
  assert.equal(f.probe().state.records[0].sendAttempts, 1);
  f.control.snapshot = f.accounts({ receipt: true }); f.control.status = { err: null, slot: 10, confirmationStatus: "finalized" };
  await f.reopen();
  const until = Date.now() + 10000;
  while ((await f.client.status(f.delivery)).state !== "FINALIZED_ACCOUNT") {
    assert(Date.now() < until); await f.outbox.runOne(); await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(f.control.sends.length, 1);
});
test("protected Solana delivery permits rebuild only after actual expired-status observation", async t => {
  const f = await protectedSolanaDeliveryFixture(t); await f.client.enqueue(f.delivery);
  const next = { ...await f.makeDelivery("RECEIPT", 1), minimumSlot: "10" };
  await assert.rejects(f.client.enqueue(next)); f.control.height = 1001;
  assert.equal((await f.outbox.runOne()).state, "EXPIRED_UNSEEN"); assert.equal(f.control.sends.length, 0);
  assert.equal((await f.client.enqueue(next)).state, "ACCEPTED"); assert.equal(f.probe().state.records.length, 2);
  const changed = { ...next, attestations: [next.attestations[1], next.attestations[0]] };
  await assert.rejects(f.client.enqueue(changed));
});
test("protected Solana delivery missing finalized account causes persistent global stop", async t => {
  const f = await protectedSolanaDeliveryFixture(t); await f.client.enqueue(f.delivery);
  f.control.status = { err: null, slot: 10, confirmationStatus: "finalized" };
  assert.equal((await f.outbox.runOne()).state, "HARD_STOP_INTEGRITY");
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY"); assert.equal(f.control.sends.length, 0);
  await f.global.restart(); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await assert.rejects(f.client.enqueue(f.delivery));
});
test("protected Solana delivery rechecks global stop after observing deployment", async t => {
  const f = await protectedSolanaDeliveryFixture(t); await f.client.enqueue(f.delivery);
  const observer = await f.global.peer("SOLANA_OBSERVER");
  f.control.hook = () => observer.guard.report(h("deployment mutation"), "SOLANA_DEPLOYMENT_CHANGED", h("confirmed component incident"));
  assert.equal((await f.outbox.runOne()).state, "WAITING_FOR_DEPENDENCY");
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  assert.equal(f.control.sends.length, 0); assert.equal(f.probe().state.records[0].sendAttempts, 0);
});
test("protected Solana delivery recovers committed observation after lost protected write acknowledgement", async t => {
  const f = await protectedSolanaDeliveryFixture(t); await f.client.enqueue(f.delivery);
  f.control.snapshot = f.accounts({ receipt: true });
  const write = f.store.write.bind(f.store); let lost = false;
  f.store.write = (...args) => { const result = write(...args); if (!lost) { lost = true; throw new Error("TEST_OBSERVED_ACK_LOST"); } return result; };
  assert.equal((await f.outbox.runOne()).state, "WAITING_FOR_DEPENDENCY"); assert(lost);
  await f.reopen(); assert.equal((await f.client.status(f.delivery)).state, "FINALIZED_ACCOUNT"); assert.equal(f.control.sends.length, 0);
});
test("protected Solana delivery refuses duplicate lifetime and restored stale journal", async t => {
  const f = await protectedSolanaDeliveryFixture(t);
  await assert.rejects(ProtectedSolanaDepositOutbox.open({ store: new WindowsProtectedStore(f.opts), integrity: f.peer.guard, policy: f.policy, endpoint: f.endpoint }));
  const files = [f.opts.root, f.opts.anchorRoot].map(root => path.join(root, "state.protected")), previous = files.map(file => readFileSync(file));
  await f.client.enqueue(f.delivery); await f.outbox.close();
  files.forEach((file, i) => writeFileSync(file, previous[i])); previous.forEach(b => b.fill(0));
  await assert.rejects(f.reopen()); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

for (const method of ["reservePlan", "prepareBroadcast"]) for (const stopped of [false, true]) {
  test(`protected deposit admission leaves reconciliation readable during ${method} and ${stopped ? "rejects intervening stop" : "retains exact action"}`, async t => {
    const f = await protectedDepositFixture(t), id = f.plan.operationId;
    if (method === "prepareBroadcast") {
      await f.journal.reservePlan(f.plan); await f.journal.retainSigned(id, f.signedTransactionHex);
    }
    const transport = fixture(t, "BRIDGE_VALIDATOR", "RECONCILIATION");
    const port = await transport.server.listen(depositSnapshotIpcHandler({ journal: f.journal, integrity: f.peer.guard, policy: f.policy }));
    const client = new ProtectedDepositSnapshotClient({ ipc: transport.client, port, policy: f.policy });
    const before = await client.read(), original = f.peer.guard.assertRunning.bind(f.peer.guard);
    let entered, release, outcome;
    const waiting = new Promise(resolve => { entered = resolve; }), suspended = new Promise(resolve => { release = resolve; });
    // Suspend BEFORE the real mutually authenticated authorization. The test
    // never fabricates permission or extends any production freshness window.
    f.peer.guard.assertRunning = async (...args) => { entered(); await suspended; return original(...args); };
    const pending = (method === "reservePlan" ? f.journal.reservePlan(f.plan) : f.journal.prepareBroadcast(id))
      .then(value => ({ value }), error => ({ error }));
    try {
      await waiting;
      const during = await client.read(); await client.assertCurrent(during);
      assert.equal(during.revision, before.revision);
      if (stopped) await f.peer.guard.report(id, "IMPOSSIBLE_OPERATION_STATE", h("intervening deposit admission incident"));
    } finally { release(); outcome = await pending; f.peer.guard.assertRunning = original; }
    const after = await f.journal.snapshot();
    if (stopped) {
      assert.match(outcome.error?.message ?? "", /IntegrityAuthorizationStopped/u);
      assert.equal(after.revision, before.revision);
      assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
    } else {
      assert.ifError(outcome.error);
      assert.equal(after.operations.length, 1);
      assert.deepEqual(after.operations[0].plan, f.plan);
      assert.equal(after.operations[0].broadcastAttempted, method === "prepareBroadcast");
      if (method === "prepareBroadcast") assert.equal(outcome.value, f.signedTransactionHex);
    }
  });
}


test("protected deposit operations retain exact signed liability across reopen and reject reused inputs", async t => {
  const f = await protectedDepositFixture(t), id = f.plan.operationId;
  const original = structuredClone(f.plan); await f.journal.reservePlan(original);
  original.depositIntent.amountAtomic = "1";
  assert.deepEqual((await f.journal.inspect(id)).plan, f.plan);
  const before = await f.journal.snapshot();
  await f.journal.reservePlan(f.plan);
  assert.equal((await f.journal.snapshot()).revision, before.revision);
  await assert.rejects(f.journal.prepareBroadcast(id), /DepositSignatureNotRetained/u);
  await assert.rejects(f.journal.retainSigned(id, f.plan.unsignedTransactionHex));
  assert.equal((await f.journal.inspect(id)).signedTransactionHex, null);
  await f.journal.retainSigned(id, f.signedTransactionHex);
  const signed = await f.journal.snapshot();
  assert.equal(signed.accounting.unresolvedSignedSweepAmount, f.plan.depositIntent.amountAtomic);
  assert.equal(signed.accounting.canonicalReserve, "0");
  assert.equal(signed.accounting.reservedInputCount, 2);
  const changed = structuredClone(f.plan); changed.operationId = h("different deposit operation");
  changed.signingIntents.forEach(i => { i.operationId = changed.operationId; i.signingRequestId = h(i.signingRequestId); });
  await assert.rejects(f.journal.reservePlan(changed), /DepositInputAlreadyReserved/u);
  assert.equal((await f.journal.snapshot()).revision, signed.revision);
  const raw = await f.journal.prepareBroadcast(id); assert.equal(raw, f.signedTransactionHex);
  await assert.rejects(f.journal.recordBroadcastAccepted(id, h("wrong transaction")), /DepositBroadcastIdentityChanged/u);
  await f.journal.recordBroadcastAccepted(id, f.plan.signingIntents[0].unsignedNativeTransactionId);
  await assert.rejects(f.journal.retainFinalizedCredit(id, { receipt: f.finalizedCredit }), /RAW_NATIVE_VERIFIED_RESERVE_REQUIRED/u);
  await assert.rejects(f.journal.retainFinalizedMint(id, f.mintReceipt), /ProtectedClaimObservationRequired/u);
  await f.journal.close(); const reopened = await f.open(); cleanups.get(f.peer.root).push(() => reopened.close());
  const restored = await reopened.inspect(id);
  assert.equal(restored.broadcastAccepted, true); assert.equal(restored.signedTransactionHex, raw);
  assert.equal((await reopened.snapshot()).accounting.unresolvedSignedSweepAmount, f.plan.depositIntent.amountAtomic);
  assert.equal(restored.finalizedCredit, null); assert.equal(restored.mintReceipt, null);
});

test("protected deposit operations recover committed signed bytes and broadcast intent after lost CAS acknowledgement", async t => {
  const f = await protectedDepositFixture(t), id = f.plan.operationId;
  await f.journal.reservePlan(f.plan);
  const persist = f.store.write.bind(f.store); let fault = true;
  f.store.write = (bytes, revision) => { const result = persist(bytes, revision);
    if (fault) throw new Error("TEST_DEPOSIT_WRITE_RESPONSE_LOST"); return result; };
  await assert.rejects(f.journal.retainSigned(id, f.signedTransactionHex), /TEST_DEPOSIT_WRITE_RESPONSE_LOST/u);
  assert.equal((await f.journal.inspect(id)).signedTransactionHex, f.signedTransactionHex);
  await assert.rejects(f.journal.prepareBroadcast(id), /TEST_DEPOSIT_WRITE_RESPONSE_LOST/u);
  assert.equal((await f.journal.inspect(id)).broadcastAttempted, true);
  fault = false;
  await f.journal.close(); const reopened = await f.open(); cleanups.get(f.peer.root).push(() => reopened.close());
  assert.equal(await reopened.prepareBroadcast(id), f.signedTransactionHex);
  assert.equal((await reopened.snapshot()).accounting.unresolvedSignedSweepAmount, f.plan.depositIntent.amountAtomic);
});

test("protected deposit operations preserve existing risk read-only during durable global stop", async t => {
  const f = await protectedDepositFixture(t), id = f.plan.operationId; await f.journal.reservePlan(f.plan);
  await f.peer.guard.report(id, "IMPOSSIBLE_OPERATION_STATE", h("confirmed component incident"));
  await f.journal.retainSigned(id, f.signedTransactionHex); // Retain already-created risk, never new signing.
  await assert.rejects(f.journal.reservePlan(f.plan), /IntegrityAuthorizationStopped/u);
  await assert.rejects(f.journal.prepareBroadcast(id), /IntegrityAuthorizationStopped/u);
  await f.global.restart();
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await f.journal.close(); const reopened = await f.open(); cleanups.get(f.peer.root).push(() => reopened.close());
  assert.equal((await reopened.snapshot()).accounting.unresolvedSignedSweepAmount, f.plan.depositIntent.amountAtomic);
  await assert.rejects(reopened.prepareBroadcast(id), /IntegrityAuthorizationStopped/u);
});

test("protected deposit operations reject duplicate lifetime lease and co-restored data plus anchor", async t => {
  const f = await protectedDepositFixture(t);
  await assert.rejects(f.open(), /DepositJournalUnavailable/u);
  const files = [path.join(f.opts.root, "state.protected"), path.join(f.opts.anchorRoot, "state.protected")], old = files.map(file => readFileSync(file));
  await f.journal.reservePlan(f.plan); await f.journal.retainSigned(f.plan.operationId, f.signedTransactionHex); await f.journal.close();
  try { files.forEach((file, index) => writeFileSync(file, old[index])); } finally { old.forEach(bytes => bytes.fill(0)); }
  await assert.rejects(f.open(), /DepositJournalUnavailable/u);
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

test("protected deposit operations reject malformed authenticated journal without resetting it", async t => {
  const f = await protectedDepositFixture(t);
  await f.journal.close(); const store = new WindowsProtectedStore(f.opts), before = store.read();
  try { store.write(Buffer.from("{"), before.revision); } finally { before.payload.fill(0); }
  await assert.rejects(f.open(store), /DepositJournalUnavailable/u);
  await f.global.restart(); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  const verify = new WindowsProtectedStore(f.opts), saved = verify.read();
  try { assert.equal(saved.payload.toString(), "{", "MalformedStateNotSilentlyReplaced"); } finally { saved.payload.fill(0); verify.close(); }
});

test("protected deposit operations retain concurrent-state incident through unavailable supervisor and transport restart", async t => {
  const f = await protectedDepositFixture(t);
  f.peer.server.close();
  const old = f.store.read(); try { f.store.write(old.payload, old.revision); } finally { old.payload.fill(0); }
  await assert.rejects(f.journal.snapshot(), /IpcRequestRejected/u);
  await f.journal.close(); f.peer.client.close();
  assert.equal((await f.global.authority.status()).policyState, "RUNNING");
  const ipc = new ProtectedServiceIpc(new WindowsProtectedStore(f.peer.clientOptions)); cleanups.get(f.peer.root).push(() => ipc.close());
  assert.equal(ipc.retainedIntegrityIncidents().length, 1);
  const guard = new RemoteIntegrityGuard({ ipc, port: await f.global.reopenPeerTransport(f.peer) });
  const reopened = await ProtectedDepositOperationJournal.open({ store: new WindowsProtectedStore(f.opts), integrity: guard, policy: f.policy });
  cleanups.get(f.peer.root).push(() => reopened.close());
  await assert.rejects(reopened.reservePlan(f.plan), /IntegrityAuthorizationStopped/u);
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  assert.equal((await reopened.snapshot()).operations.length, 0);
});

test("protected deposit snapshot is mutually authenticated bounded read-only and remains observable after stop", async t => {
  const f = await protectedDepositFixture(t), transport = fixture(t, "BRIDGE_VALIDATOR", "RECONCILIATION");
  let changeDuringRead = false;
  const handler = depositSnapshotIpcHandler({ journal: f.journal, integrity: f.peer.guard, policy: f.policy });
  const port = await transport.server.listen(async input => {
    const result = await handler(input);
    if (changeDuringRead) { changeDuringRead = false; await f.journal.retainSigned(f.plan.operationId, f.signedTransactionHex); }
    return result;
  });
  const client = new ProtectedDepositSnapshotClient({ ipc: transport.client, port, policy: f.policy });
  assert.equal((await client.read()).operations.length, 0);
  await f.journal.reservePlan(f.plan); changeDuringRead = true;
  await assert.rejects(client.read(), /IpcRequestRejected/u, "ConcurrentRevisionCannotBeCombined");
  const before = await client.read(); assert.equal(before.operations.length, 1);
  assert(Object.isFrozen(before.operations[0].plan.depositIntent));
  assert.equal(before.accounting.unresolvedSignedSweepAmount, f.plan.depositIntent.amountAtomic);
  for (const payload of [{ index: 64, revision: null }, { index: 1, revision: null }, { index: 0, revision: "999" }, { index: 0, revision: before.revision, clear: true }]) {
    await assert.rejects(transport.client.request(port, { method: "depositSnapshot", operationId: before.policyDigest, payload }));
  }
  await assert.rejects(transport.client.request(port, { method: "reservePlan", operationId: before.policyDigest, payload: f.plan }));
  await assert.rejects(transport.client.request(port, { method: "depositSnapshot", operationId: h("other policy"), payload: { index: 0, revision: null } }));
  await f.peer.guard.report(f.plan.operationId, "IMPOSSIBLE_OPERATION_STATE", h("confirmed read-only test stop"));
  assert.equal((await client.read()).revision, before.revision);
  assert.equal((await f.journal.inspect(f.plan.operationId)).broadcastAttempted, false);
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

test("deposit snapshot fresh-revision recheck rejects copied capabilities and concurrent changes", async t => {
  const f = await protectedDepositFixture(t), transport = fixture(t, "BRIDGE_VALIDATOR", "RECONCILIATION");
  const port = await transport.server.listen(depositSnapshotIpcHandler({ journal: f.journal, integrity: f.peer.guard, policy: f.policy }));
  const client = new ProtectedDepositSnapshotClient({ ipc: transport.client, port, policy: f.policy });
  const first = await client.read(); await client.assertCurrent(first);
  await assert.rejects(client.assertCurrent(structuredClone(first)), /DepositSnapshotRejected/u);
  await f.journal.reservePlan(f.plan);
  await assert.rejects(client.assertCurrent(first), /IpcRequestRejected/u);
  await client.assertCurrent(await client.read());
});

async function protectedReconciliationFixture(t, retainedIncident = false) {
  // Current-principal actual DPAPI/mTLS. An unavailable Native source is never
  // replaced by a fixture proof; these tests certify persistence/fail-closed
  // behavior only, not a successful protected chain reconciliation.
  const global = await integrityFixture(t), bridge = await global.peer("BRIDGE_VALIDATOR"), peer = await global.peer("RECONCILIATION");
  const { policy, manifest } = reconciliationFixture();
  const journalOptions = options(bridge.root, "empty-operations", "BRIDGE_VALIDATOR", "deposit-operations"), initialJournal = initialDepositOperationState(policy);
  const journalStore = WindowsProtectedStore.create(journalOptions, initialJournal); initialJournal.fill(0);
  const journal = await ProtectedDepositOperationJournal.open({ store: journalStore, integrity: bridge.guard, policy });
  cleanups.get(bridge.root).push(() => journal.close());
  const transport = fixture(t, "BRIDGE_VALIDATOR", "RECONCILIATION");
  const port = await transport.server.listen(depositSnapshotIpcHandler({ journal, integrity: bridge.guard, policy }));
  const journalClient = new ProtectedDepositSnapshotClient({ ipc: transport.client, port, policy });
  const opts = options(peer.root, "reconciliation-progress", "RECONCILIATION", "reconciliation-progress");
  const value = JSON.parse(initialReconciliationProgress(policy, manifest));
  if (retainedIncident) value.incident = { reason: "ECONOMIC_SNAPSHOT_CONTRADICTION", evidenceDigest: h("SYNTHETIC_INCIDENT_ONLY"), affectedOperations: [], affectedReserveAtomic: "0" };
  const bytes = Buffer.from(JSON.stringify(value)), store = WindowsProtectedStore.create(opts, bytes); bytes.fill(0);
  const nativeVerifier = new LocalNativeEvidenceVerifier({ rpc: { async getBlockchainInfo() { throw new Error("TEST_SOURCE_UNAVAILABLE"); } }, executable: path.join(peer.root, "unavailable-native-verifier") });
  const solanaRpc = new LocalDeploymentRpc({ endpoint: "http://127.0.0.1:54321" });
  const open = (nextStore = new WindowsProtectedStore(opts), expectedManifest = manifest) => ProtectedDepositReconciliationMonitor.open({ policy, manifest: expectedManifest,
    journalClient, nativeVerifier, solanaRpc, integrity: peer.guard, store: nextStore });
  const monitor = await open(store); cleanups.get(peer.root).push(() => monitor.close());
  return { global, peer, opts, store, monitor, open, policy, manifest };
}

test("protected reconciliation outage never fabricates deficit or source-health permission", async t => {
  const f = await protectedReconciliationFixture(t);
  assert.equal((await f.monitor.poll()).state, "WAITING_FOR_DEPENDENCY");
  assert.equal(f.global.authority.status().incidentCount, 0); assert.equal(f.global.authority.status().state, "PAUSED_POLICY");
  const saved = f.store.read();
  try { assert.equal(JSON.parse(saved.payload).observedAt, 0); } finally { saved.payload.fill(0); }
  await f.monitor.close(); const reopened = await f.open(); cleanups.get(f.peer.root).push(() => reopened.close());
  assert.equal((await reopened.poll()).state, "WAITING_FOR_DEPENDENCY"); assert.equal(f.global.authority.status().incidentCount, 0);
});
test("protected reconciliation lifetime lease rejects a duplicate process instance", async t => {
  const f = await protectedReconciliationFixture(t);
  await assert.rejects(f.open(), /ReconciliationMonitorUnavailable/u);
  assert.equal(f.global.authority.status().incidentCount, 0);
});
test("protected reconciliation authenticated malformed progress causes a durable global stop", async t => {
  const f = await protectedReconciliationFixture(t), old = f.store.read();
  try { f.store.write(Buffer.from("{"), old.revision); } finally { old.payload.fill(0); }
  assert.equal((await f.monitor.poll()).state, "HARD_STOP_INTEGRITY");
  await f.global.restart(); assert.equal(f.global.authority.status().state, "HARD_STOP_INTEGRITY");
  const saved = f.store.read(); try { assert.equal(saved.payload.toString(), "{"); } finally { saved.payload.fill(0); }
});
test("protected reconciliation retained incident replays after full authority and monitor reopen", async t => {
  const f = await protectedReconciliationFixture(t, true);
  assert.equal((await f.monitor.poll()).state, "HARD_STOP_INTEGRITY");
  await f.monitor.close(); await f.global.restart();
  const reopened = await f.open(); cleanups.get(f.peer.root).push(() => reopened.close());
  assert.equal((await reopened.poll()).state, "HARD_STOP_INTEGRITY"); assert.equal(f.global.authority.status().incidentCount, 1);
});
test("protected reconciliation rejects restored obsolete deployment identity", async t => {
  const f = await protectedReconciliationFixture(t); await f.monitor.close();
  const changed = structuredClone(f.manifest); changed.identityVersion++;
  await assert.rejects(f.open(new WindowsProtectedStore(f.opts), changed), /ReconciliationMonitorUnavailable/u);
  assert.equal(f.global.authority.status().state, "HARD_STOP_INTEGRITY");
});

test("persisted RUNNING requires fresh mutually authenticated source checks after restart", async t => {
  const f = await integrityFixture(t), peers = [];
  for (const role of SOURCE_HEALTH_ROLES) peers.push(await f.peer(role));
  const signer = await f.peer("KINGPEPE_FROST_A");
  assert.equal(f.authority.status().policyState, "RUNNING");
  assert.deepEqual(f.authority.status().missingSources, SOURCE_HEALTH_ROLES);
  await assert.rejects(signer.guard.assertRunning(h("not-ready"), "FROST_SIGN"));
  await assert.rejects(signer.guard.beginSourceCheck(h("impersonated-observer")));
  const finish = async p => {
    const ticket = await p.guard.beginSourceCheck(h("test-observation"));
    await p.guard.finishSourceCheck(ticket, { state: "OBSERVED_MATCH", evidenceDigest: h("SYNTHETIC_ADMISSION_TEST_ONLY") }); return ticket;
  };
  // Distinct source services observe concurrently. Exercise the real TLS paths
  // together so one one-shot fixture result need not outlive all later polls.
  // No synthetic watchdog, renewed old ticket or enlarged freshness window.
  await Promise.all(peers.map(finish));
  try { await signer.guard.assertRunning(h("admission-only-not-a-signature"), "FROST_SIGN"); }
  catch { throw new Error("SourceAdmissionRejected:" + f.authority.status().missingSources.join(",")); }
  const unavailable = await peers[0].guard.beginSourceCheck(h("source-unavailable"));
  await peers[0].guard.finishSourceCheck(unavailable, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: h("unavailable") });
  await assert.rejects(signer.guard.assertRunning(h("source-unavailable"), "FROST_SIGN"));
  const old = await peers[0].guard.beginSourceCheck(h("old-incarnation"));
  await f.restart();
  assert.equal(f.authority.status().policyState, "RUNNING");
  assert.equal(f.authority.status().state, "PAUSED_POLICY");
  assert.deepEqual(f.authority.status().missingSources, SOURCE_HEALTH_ROLES);
  await assert.rejects(peers[0].guard.finishSourceCheck(old, { state: "OBSERVED_MATCH", evidenceDigest: h("old-result") }));
  await assert.rejects(signer.guard.assertRunning(h("after-restart"), "FROST_SIGN"));
});

test("authenticated source admission rejects unauthorized role, token substitution and replay", async t => {
  const f = await integrityFixture(t), native = await f.peer("NATIVE_OBSERVER"), solana = await f.peer("SOLANA_OBSERVER"), relayer = await f.peer("RELAYER");
  const operationId = h("source-binding");
  await assert.rejects(relayer.client.request(relayer.port, { method: "beginSourceCheck", operationId, payload: {} }));
  const ticket = await native.guard.beginSourceCheck(operationId), result = { state: "OBSERVED_MATCH", evidenceDigest: h("TEST_ONLY_SOURCE_FIXTURE") };
  await assert.rejects(solana.guard.finishSourceCheck(ticket, result));
  await assert.rejects(native.guard.finishSourceCheck({ ...ticket }, result));
  await assert.rejects(native.client.request(native.port, { method: "finishSourceCheck", operationId: h("wrong-operation"),
    payload: { ...result, generation: ticket.generation, challenge: ticket.challenge } }));
  await native.guard.finishSourceCheck(ticket, { ...result, state: "WAITING_FOR_DEPENDENCY" });
  await assert.rejects(native.guard.finishSourceCheck(ticket, result));
  assert.equal(f.authority.status().state, "PAUSED_POLICY"); assert.equal(f.authority.status().incidentCount, 0);
  await native.guard.report(operationId, "NATIVE_DEEP_REORG", h("confirmed-test-incident"));
  await native.guard.finishSourceCheck(await native.guard.beginSourceCheck(operationId), result);
  assert.equal(f.authority.status().state, "HARD_STOP_INTEGRITY");
});

for (const role of REQUIRED_FROST_SIGNERS) test("real mutual TLS and protected replay persistence: " + role, async t => {
  const f = fixture(t, role); let calls = 0;
  let port = await f.server.listen(({ peerRole, operationId }) => { assert.equal(peerRole, "COORDINATOR"); calls++; return { operationId }; });
  const id = h("persistent-request");
  assert.equal((await f.client.request(port, request({ requestId: id }))).operationId, h("operation"));
  await assert.rejects(f.client.request(port, request({ requestId: id }))); assert.equal(calls, 1);
  f.server.close();
  const restarted = new ProtectedServiceIpc(new WindowsProtectedStore(f.serverOptions)); t.after(() => restarted.close());
  port = await restarted.listen(() => { calls++; return true; });
  await assert.rejects(f.client.request(port, request({ requestId: id }))); assert.equal(calls, 1);
  assert.equal(await f.client.request(port, request()), true); assert.equal(calls, 2);
});

test("coordinator restart retains identity and cannot bypass server replay", async t => {
  const f = fixture(t); const port = await f.server.listen(() => true), id = h("coordinator-restart-request");
  await f.client.request(port, request({ requestId: id })); f.client.close();
  const client = new ProtectedServiceIpc(new WindowsProtectedStore(f.clientOptions)); t.after(() => client.close());
  await assert.rejects(client.request(port, request({ requestId: id })));
  assert.equal(await client.request(port, request()), true);
});

test("protected incident outbox persists before connect and survives lost acknowledgement and restart", async t => {
  const f = await integrityFixture(t), p = await f.peer("COORDINATOR"), operationId = h("lost-incident-ack");
  const handle = f.authority.handle.bind(f.authority);
  f.authority.handle = input => {
    const result = handle(input);
    if (input.method === "reportContradiction") throw new Error("TEST_LOST_INCIDENT_ACK");
    return result;
  };
  await assert.rejects(p.guard.report(operationId, "COORDINATOR_JOURNAL_INTEGRITY", h("confirmed-incident")), /IpcRequestRejected/u);
  assert.equal(f.authority.status().state, "HARD_STOP_INTEGRITY");
  assert.equal(p.client.retainedIntegrityIncidents().length, 1);
  p.client.close(); await f.restart();
  const ipc = new ProtectedServiceIpc(new WindowsProtectedStore(p.clientOptions)); t.after(() => ipc.close());
  const guard = new RemoteIntegrityGuard({ ipc, port: p.port });
  assert.equal((await guard.status(operationId)).state, "HARD_STOP_INTEGRITY");
  await assert.rejects(guard.assertRunning(operationId, "COORDINATE_SWEEP"), /IntegrityAuthorizationStopped/u);
  await assert.rejects(ipc.request(p.port, { method: "assertRunning", operationId, payload: { action: "COORDINATE_SWEEP" } }), /IpcIntegrityIncidentRetained/u);
  assert.equal(f.authority.status().incidentCount, 1); assert.equal(ipc.retainedIntegrityIncidents().length, 1);
});

test("protected incident persistence failure does not send or acknowledge a global report", async t => {
  const f = await integrityFixture(t), p = await f.peer("COORDINATOR"), original = p.clientStore.write.bind(p.clientStore);
  p.clientStore.write = () => { throw new Error("TEST_PROTECTED_WRITE_UNAVAILABLE"); };
  await assert.rejects(p.guard.report(h("incident"), "COORDINATOR_JOURNAL_INTEGRITY", h("evidence")), /TEST_PROTECTED_WRITE_UNAVAILABLE/u);
  assert.equal(f.authority.status().incidentCount, 0, "NoDurableAcknowledgementWasInvented");
  await assert.rejects(p.guard.assertRunning(h("incident"), "COORDINATE_SWEEP"), /IntegrityAuthorizationStopped/u);
  p.clientStore.write = original;
  await p.guard.report(h("incident"), "COORDINATOR_JOURNAL_INTEGRITY", h("evidence"));
  assert.equal(f.authority.status().state, "HARD_STOP_INTEGRITY");
});

test("protected transport retains the exact incident payload before caller mutation", async t => {
  const f = await integrityFixture(t), p = await f.peer("COORDINATOR"), operationId = h("immutable-incident");
  const payload = { code: "COORDINATOR_JOURNAL_INTEGRITY", evidenceDigest: h("original-evidence") };
  const pending = p.client.request(p.port, { method: "reportContradiction", operationId, payload });
  // The request has reached its first real asynchronous TLS boundary. A local
  // caller must not substitute the bytes already validated/persisted before it.
  payload.code = "SIGNING_TRANSCRIPT_CONFLICT"; payload.evidenceDigest = h("substituted-evidence");
  assert.equal((await pending).state, "HARD_STOP_INTEGRITY");
  const store = new WindowsProtectedStore(f.options), read = store.read();
  try {
    const state = JSON.parse(read.payload.toString("utf8"));
    assert.deepEqual(state.incidents, p.client.retainedIntegrityIncidents(), "DeliveredIncidentMustEqualDurableIntent");
    assert.equal(state.incidents[0].code, "COORDINATOR_JOURNAL_INTEGRITY");
    assert.equal(state.incidents[0].evidenceDigest, h("original-evidence"));
  } finally { read.payload.fill(0); store.close(); }
});

for (const [name, change] of [
  ["legacy enrollment", state => { state.protocol = protocol; delete state.integrityIncidents; }],
  ["unauthorized report role", state => { state.integrityIncidents = [{ role: "SOLANA_OBSERVER", code: "SOLANA_DEPLOYMENT_CHANGED", operationId: h("incident"), evidenceDigest: h("evidence") }]; }],
  ["malformed retained incident", state => { state.integrityIncidents = [{ role: "COORDINATOR" }]; }],
  ["missing retained incident field", state => { delete state.integrityIncidents; }],
]) test("protected authentication state refuses " + name + " without re-enrollment", async t => {
  const f = await integrityFixture(t), p = await f.peer("COORDINATOR"), before = p.clientStore.read();
  let bytes;
  try {
    const state = JSON.parse(before.payload.toString("utf8")); change(state);
    bytes = Buffer.from(JSON.stringify(state)); p.clientStore.write(bytes, before.revision);
  } finally { before.payload.fill(0); bytes?.fill(0); }
  await assert.rejects(p.guard.status(h("status")));
  assert.throws(() => new ProtectedServiceIpc(new WindowsProtectedStore(p.clientOptions)));
  assert.equal(f.authority.status().incidentCount, 0, "CorruptionIsNotFabricatedDelivery");
});

test("wrong credential and signer-role substitution cannot cross endpoints", async t => {
  const a = fixture(t, "KINGPEPE_FROST_A"), b = fixture(t, "KINGPEPE_FROST_B"); let calls = 0;
  const portA = await a.server.listen(() => { calls++; return true; }), portB = await b.server.listen(() => { calls++; return true; });
  await assert.rejects(a.client.request(portB, request())); await assert.rejects(b.client.request(portA, request()));
  assert.throws(() => new ProtectedRemoteFrostPeer({ ipc: a.client, port: portA, signerId: "KINGPEPE_FROST_B" }));
  assert.equal(calls, 0);
});

test("missing client certificate is not authenticated by loopback", async t => {
  const f = fixture(t); let calls = 0; const port = await f.server.listen(() => { calls++; return true; });
  await new Promise(resolve => {
    const s = tls.connect({ host: "127.0.0.1", port, servername: "kingpepe-service.invalid", ca: f.serverCert.certificatePem, minVersion: "TLSv1.3" });
    s.on("error", () => {}); s.on("close", resolve); s.setTimeout(1500, () => s.destroy());
  }); assert.equal(calls, 0);
});

test("malformed oversized and unauthorized method requests do not dispatch", async t => {
  const f = fixture(t); let calls = 0; const port = await f.server.listen(() => { calls++; return true; });
  for (const input of [request({ method: "exportPrivateShare" }), request({ operationId: "bad" }), request({ payload: "x".repeat(262145) })]) await assert.rejects(f.client.request(port, input));
  assert.equal(calls, 0);
});

test("missing corrupt or closed protected authentication state fails closed", async t => {
  const f = fixture(t), port = await f.server.listen(() => true);
  const missing = options(f.root, "missing", "COORDINATOR");
  assert.throws(() => new ProtectedServiceIpc(new WindowsProtectedStore(missing)));
  const file = path.join(f.clientOptions.root, "state.protected"), bytes = readFileSync(file); bytes[bytes.length - 1] ^= 1; writeFileSync(file, bytes);
  await assert.rejects(f.client.request(port, request()));
  assert.throws(() => new ProtectedServiceIpc(new WindowsProtectedStore(f.clientOptions)));
  f.serverStore.close(); await assert.rejects(f.client.request(port, request()));
});

// Raw authenticated peers deliberately violate framing/context; TLS itself is real.
function rawRequest(f, port, change) {
  return new Promise(resolve => {
    const s = tls.connect({ host: "127.0.0.1", port, servername: "kingpepe-service.invalid", ca: f.serverCert.certificatePem,
      key: f.clientCert.privateKeyPem, cert: f.clientCert.certificatePem, minVersion: "TLSv1.3" });
    let input = Buffer.alloc(0), sent = false, gotResponse = false;
    s.on("error", () => {}); s.setTimeout(20000, () => s.destroy()); s.on("close", () => resolve(gotResponse));
    s.on("data", chunk => {
      if (sent) { gotResponse = true; s.destroy(); return; }
      input = Buffer.concat([input, chunk]); if (input.length < 4 || input.length < input.readUInt32BE() + 4) return;
      const hello = JSON.parse(input.subarray(4).toString("utf8"));
      const value = [protocol, "REQUEST", hello[2], "localnet", "COORDINATOR", f.role, hello[6], hello[7], hello[8], h("raw-request"), h("operation"), "verifyNativeEvidence", Date.now() + 9000, Date.now() + 29000, {}];
      const changed = change(value), payload = Buffer.isBuffer(changed) ? changed : Buffer.from(JSON.stringify(changed));
      const header = Buffer.alloc(4); header.writeUInt32BE(payload.length); sent = true; s.write(Buffer.concat([header, payload]));
    });
  });
}
for (const [label, change] of [
  ["stale request", v => { v[12] = Date.now() - 1; return v; }],
  ["excess admission lifetime", v => { v[12] = Date.now() + 20000; return v; }],
  ["excess execution lifetime", v => { v[13] = Date.now() + 60000; return v; }],
  ["expired execution lifetime", v => { v[13] = Date.now() - 1; return v; }],
  ["wrong deployment", v => { v[2] = h("wrong"); return v; }],
  ["wrong environment", v => { v[3] = "mainnet"; return v; }],
  ["wrong role", v => { v[4] = "KINGPEPE_FROST_B"; return v; }],
  ["modified session", v => { v[7] = h("substituted"); return v; }],
  ["modified TLS exporter", v => { v[8] = h("substituted"); return v; }],
  ["stale endpoint generation", v => { v[6] = "0"; return v; }],
  ["malformed JSON", () => Buffer.from("{")],
  ["oversized wire frame", () => Buffer.alloc(262145)],
]) test("authenticated peer rejected: " + label, async t => {
  const f = fixture(t); let calls = 0; const port = await f.server.listen(() => { calls++; return true; });
  assert.equal(await rawRequest(f, port, change), false); assert.equal(calls, 0);
});

test("an admitted request cannot return a late result", async t => {
  const f = fixture(t); let calls = 0;
  const port = await f.server.listen(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 750)); return true; });
  const accepted = await rawRequest(f, port, v => { v[12] = Date.now() + 200; v[13] = Date.now() + 500; return v; });
  assert.equal(accepted, false); assert.equal(calls, 1); assert.equal(f.server.lastRejection, "IpcExpiredResult");
});

test("IPC diagnostics expose fixed codes only and preserve request rejection", async t => {
  const f = fixture(t), privateDiagnostic = path.join(os.tmpdir(), "unpublished-ipc-diagnostic");
  const port = await f.server.listen(() => { throw new Error(privateDiagnostic); });
  await assert.rejects(f.client.request(port, { method: "verifyNativeEvidence", operationId: h("redaction"), payload: {} }), /IpcRequestRejected/u);
  assert.equal(f.server.lastRejection, "IpcRejected");
  assert(["IpcTransportClosed", "IpcTransportRejected"].includes(f.client.lastRejection), "Client diagnostic must remain a fixed transport code");
  assert(!JSON.stringify([f.server.lastRejection, f.client.lastRejection]).includes(privateDiagnostic), "IpcDiagnosticLeakedPrivateContext");
});

async function protectedCoordinatorFixture(t, sweepJobFixture = false) {
  const global = await isolatedIntegrityFixture(t);
  const guards = await Promise.all(REQUIRED_FROST_SIGNERS.map(role => global.peer(role)));
  const coordinatorPeer = await global.peer("COORDINATOR"), coordinatorGuard = coordinatorPeer.guard;
  const f = [fixture(t, "KINGPEPE_FROST_A"), fixture(t, "KINGPEPE_FROST_B")];
  const intent = { protocol: FROST_SIGNING_INTENT_PROTOCOL, mode: FROST_SIGNING_MODE, purpose: "RESERVE_SWEEP", nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: deployment, bridgeProgramId: h("bridge"), transceiverProgramId: h("transceiver"), mint: h("mint"), keyEpoch: 1,
    signingRequestId: h("request"), operationId: h("operation"), withdrawalId: h("deposit"), proofFingerprint: h("proof"), unsignedNativeTransactionId: h("transaction"),
    transactionCommitment: h("commitment"), signingInputIndex: 0, taprootSighashHex: h("sighash"), recipientScriptPubKeyHex: "5120" + h("reserve"), amountAtomic: "1000", feeAtomic: "10",
    changeScriptPubKeyHex: "5120" + h("reserve"), changeAtomic: "100", inputOutpoints: [h("input") + ":0"], outputCommitments: [h("output")], reserveCommitment: h("reserve-commitment"),
    pauseWithdrawals: false, hardStop: false };
  const policy = createNativeSigningPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: deployment, bridgeProgramId: intent.bridgeProgramId, transceiverProgramId: intent.transceiverProgramId, mint: intent.mint, keyEpoch: 1,
    maxAmountAtomic: "10000", maxFeeAtomic: "100", reserveScriptPubKeyHex: intent.changeScriptPubKeyHex, authorizedOperations: [intent] });
  const signers = [], verificationCounts = [0, 0], stateStores = []; let duringEvidence;
  for (const [i, v] of f.entries()) {
    const base = WindowsProtectedFrostStateStore.createLocal(options(v.root, "native-state", v.role, "frost-state"), policy);
    const fenceOptions = options(v.root, "native-fence", v.role, "signer-fence", base.context.instanceId);
    const stateStore = await WindowsFencedFrostStateStore.createLocal({ base, fenceOptions, policy });
    stateStores.push(stateStore);
    cleanups.get(v.root).push(() => stateStore.close());
    signers.push(new NativeFrostSigner({ signerId: v.role, index: i, policy, stateStore,
      nativeEvidenceValidator: async value => { verificationCounts[i]++; await duringEvidence?.(i); return { digestHex: value.proofFingerprint }; } }));
  }
  t.after(() => signers.forEach(s => s.close()));
  const dkg = runTwoPartyDkg(signers, { epoch: 1 });
  if (sweepJobFixture) {
    // The job suite uses a single-output/no-change sweep policy. The legacy
    // crypto fixture above intentionally covers a different economic shape.
    signers.forEach(s => s.close());
    intent.withdrawalId = "00".repeat(32); intent.changeAtomic = "0";
    intent.recipientScriptPubKeyHex = intent.changeScriptPubKeyHex = "5120" + dkg.aggregateTweakedXOnlyPublicKey;
    const updated = createNativeSigningPolicy({ ...policy, maxAmountAtomic: "10000", maxFeeAtomic: "100",
      reserveScriptPubKeyHex: intent.changeScriptPubKeyHex, authorizedOperations: [intent] });
    for (let i = 0; i < 2; i++) signers[i] = new NativeFrostSigner({ signerId: f[i].role, index: i, policy: updated, stateStore: stateStores[i],
      nativeEvidenceValidator: async value => { verificationCounts[i]++; await duringEvidence?.(i); return { digestHex: value.proofFingerprint }; } });
  }
  const ports = [], handlerFaults = [];
  for (let i = 0; i < 2; i++) {
    const handler = nativeFrostIpcHandler(signers[i], guards[i].guard);
    ports.push(await f[i].server.listen(async input => {
      try { return await handler(input); } catch (error) {
        const allowed = ["ProtectedSignerStateIntegrityRejected", "ProtectedSignerFenceRejected", "ProtectedLifetimeLeaseLost",
          "IntegrityStateRejected", "IntegrityResponseRollback", "IntegrityStopRollback", "IntegrityAuthorizationStopped", "IpcRequestRejected",
          "FROST fresh independent Native evidence required"];
        handlerFaults.push(input.method + ":" + (allowed.includes(error?.message) ? error.message : "UNCLASSIFIED"));
        throw error;
      }
    }));
  }
  const peers = f.map((v, i) => new ProtectedRemoteFrostPeer({ ipc: v.client, port: ports[i], signerId: v.role }));
  const journalOptions = options(f[0].root, "coordinator-journal", "COORDINATOR", "coordinator-signing");
  const journalStore = WindowsProtectedStore.create(journalOptions, initialCoordinatorSigningState(dkg));
  cleanups.get(f[0].root).push(() => journalStore.close());
  return { global, guards, coordinatorPeer, coordinatorGuard, f, root: f[0].root, intent, signers, ports, peers, dkg,
    verificationCounts, handlerFaults, journalOptions, journalStore, stateStores,
    setEvidenceHook(fn) { duringEvidence = fn; } };
}

test("signer rechecks durable stop after read-only evidence before nonce reservation", async t => {
  const f = await protectedCoordinatorFixture(t); await f.global.enableTestSources();
  const before = f.stateStores.map(store => store.publicFence());
  let reported = false;
  f.setEvidenceHook(async index => {
    if (!reported) { reported = true; await f.guards[index].guard.report(f.intent.operationId, "SIGNER_ROLLBACK", h("stop-during-evidence")); }
  });
  const request = createNativeFrostSigningRequest(f.intent);
  for (const [i, peer] of f.peers.entries()) {
    await assert.rejects(peer.signingCommitment(request), /IpcRequestRejected/u);
    assert.deepEqual(f.stateStores[i].publicFence(), before[i], "StopMustPreventNonceOrStateMutation");
  }
  assert.deepEqual(f.verificationCounts, [1, 1], "OnlyReadOnlyVerificationMayContinue");
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

async function protectedSweepJobsFixture(t) {
  const f = await protectedCoordinatorFixture(t, true);
  const policy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: deployment,
    solanaGenesis: base58Encode(Buffer.from(h("synthetic local genesis"), "hex")), minimumSolanaSlot: "1", managerProgramId: f.intent.bridgeProgramId,
    transceiverProgramId: f.intent.transceiverProgramId, mint: f.intent.mint, protocolId: 1, nativeNetwork: 8000111, policyEpoch: 1, keyEpoch: 1,
    frostPublicKeyHex: f.dkg.aggregateTweakedXOnlyPublicKey, csvDelayBlocks: 12, minimumConfirmations: 6, maximumAmountAtomic: "10000", maximumFeeAtomic: "100" };
  const journal = await ProtectedCoordinatorSigningJournal.open({ store: f.journalStore, integrity: f.coordinatorGuard, ...f.dkg });
  cleanups.get(f.root).push(() => journal.close());
  const opts = options(f.root, "sweep-jobs", "COORDINATOR", "coordinator-jobs"), bytes = initialSweepJobState(policy);
  const store = WindowsProtectedStore.create(opts, bytes); bytes.fill(0);
  let jobs;
  const open = async current => ProtectedSweepJobs.open({ store: current, integrity: f.coordinatorGuard, policy, ...f.dkg, signers: f.peers, signingJournal: journal });
  jobs = await open(store); cleanups.get(f.root).push(() => jobs.close());
  const transport = fixture(t, "COORDINATOR", "BRIDGE_VALIDATOR");
  const port = await transport.server.listen(input => sweepJobIpcHandler({ jobs, policy, integrity: f.coordinatorGuard })(input));
  const client = new ProtectedSweepJobClient({ ipc: transport.client, port, policy });
  await f.global.enableTestSources();
  return { ...f, policy, opts, store, journal, transport, port, client, get jobs() { return jobs; },
    async reopen() { await jobs.close(); jobs = await open(new WindowsProtectedStore(opts)); } };
}

test("durable sweep dispatch retains acceptance before lost IPC response and reopen", async t => {
  const f = await protectedSweepJobsFixture(t), write = f.store.write.bind(f.store);
  let lost = false;
  f.store.write = (...args) => { const result = write(...args); if (!lost) { lost = true; throw new Error("TEST_ACCEPTED_ACK_LOST"); } return result; };
  await assert.rejects(f.client.enqueue(f.intent), /IpcRequestRejected/u);
  f.store.write = write;
  const accepted = await f.client.enqueue(f.intent); assert.equal(accepted.state, "ACCEPTED");
  assert.equal(f.journal.lookup(f.intent), null); assert.deepEqual(f.verificationCounts, [0, 0], "AcceptanceIsNotSigning");
  await f.reopen(); assert.deepEqual(await f.client.enqueue(f.intent), accepted);
  assert.equal((await f.client.status(f.intent)).state, "WAITING_FOR_DEPENDENCY");
  await assert.rejects(f.client.enqueue({ ...f.intent, amountAtomic: "999" }));
  await assert.rejects(f.transport.client.request(f.port, { method: "enqueueSweepSignature", operationId: h("wrong operation"), payload: { intent: f.intent } }));
  await assert.rejects(f.transport.client.request(f.port, { method: "enqueueSweepSignature", operationId: f.intent.operationId, payload: { intent: f.intent, approved: true } }));
  const probe = new WindowsProtectedStore(f.opts), retained = probe.read();
  try { assert.equal(decodeSweepJobState(retained.payload, f.policy).jobs.length, 1); } finally { retained.payload.fill(0); probe.close(); }
});

test("durable sweep dispatch returns real A+B aggregate without synchronous long IPC and survives lost completion", async t => {
  const f = await protectedSweepJobsFixture(t); await f.client.enqueue(f.intent);
  const write = f.store.write.bind(f.store); let lost = false;
  f.store.write = (bytes, revision) => { const result = write(bytes, revision);
    if (!lost && JSON.parse(bytes.toString("utf8")).jobs[0].completed) { lost = true; throw new Error("TEST_COMPLETED_ACK_LOST"); } return result; };
  const worked = await f.jobs.runOne(); assert.equal(worked.state, "WAITING_FOR_DEPENDENCY"); assert(lost, "CompletionMustHavePersisted");
  f.store.write = write;
  const signed = await f.client.status(f.intent); assert.equal(signed.state, "SIGNED");
  f.journal.assertRetainedResults([f.intent]);
  assert.throws(() => f.journal.assertRetainedResults([{ ...f.intent, amountAtomic: "999" }]), /CoordinatorJournalRequestChanged/u);
  assert(schnorr.verify(Buffer.from(signed.result.signatureHex, "hex"), Buffer.from(f.intent.taprootSighashHex, "hex"), Buffer.from(f.policy.frostPublicKeyHex, "hex")));
  const counts = [...f.verificationCounts]; await f.reopen();
  assert.deepEqual(await f.client.status(f.intent), signed); await f.jobs.runOne(); assert.deepEqual(f.verificationCounts, counts);
  await f.guards[0].guard.report(f.intent.operationId, "SIGNER_ROLLBACK", h("dispatch stop"));
  await assert.rejects(f.client.status(f.intent)); await assert.rejects(f.client.enqueue(f.intent));
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

test("durable sweep dispatch rejects duplicate lifetime and co-restored accepted state", async t => {
  const f = await protectedSweepJobsFixture(t);
  const duplicate = new WindowsProtectedStore(f.opts);
  await assert.rejects(ProtectedSweepJobs.open({ store: duplicate, integrity: f.coordinatorGuard, policy: f.policy, ...f.dkg, signers: f.peers, signingJournal: f.journal }), /SweepJobUnavailable/u);
  const files = [f.opts.root, f.opts.anchorRoot].map(root => path.join(root, "state.protected")), old = files.map(file => readFileSync(file));
  await f.client.enqueue(f.intent); await f.jobs.close();
  files.forEach((file, i) => writeFileSync(file, old[i])); old.forEach(b => b.fill(0));
  await assert.rejects(f.reopen(), /SweepJobUnavailable/u);
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

test("actual protected A+B FROST signing through authenticated endpoints", async t => {
  const { global, guards, coordinatorGuard, f, intent, ports, peers, dkg, verificationCounts, handlerFaults, journalOptions, journalStore } = await protectedCoordinatorFixture(t);
  let signingJournal = await ProtectedCoordinatorSigningJournal.open({ store: journalStore, integrity: coordinatorGuard, ...dkg });
  cleanups.get(f[0].root).push(() => signingJournal.close());
  const createCoordinator = () => new NativeFrostCoordinator({ signers: peers, publicPackage: dkg.publicPackage,
    aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey, integrity: coordinatorGuard, signingJournal });
  const coordinator = createCoordinator();
  await global.enableTestSources();
  let signed;
  try { signed = await coordinator.signAutomaticallyOverIpc(intent); }
  catch { throw new Error("ProtectedFrostIpcFailure:" + f.map(v => v.server.lastRejection ?? "UNREPORTED").join(",") + ":" + handlerFaults.join(",")); }
  assert(schnorr.verify(Buffer.from(signed.signatureHex, "hex"), Buffer.from(intent.taprootSighashHex, "hex"), Buffer.from(dkg.aggregateTweakedXOnlyPublicKey, "hex")), "IpcFrostSignatureRejected");
  assert(verificationCounts.every(count => count >= 3), "FreshEvidenceRequiredAtEverySigningBoundary");
  const countsBefore = [...verificationCounts];
  await signingJournal.close();
  signingJournal = await ProtectedCoordinatorSigningJournal.open({ store: new WindowsProtectedStore(journalOptions), integrity: coordinatorGuard, ...dkg });
  const recoveredCoordinator = createCoordinator();
  assert.deepEqual(await recoveredCoordinator.signAutomaticallyOverIpc(intent), signed, "ExactAggregateMustSurviveCoordinatorReopen");
  assert.deepEqual(verificationCounts, countsBefore, "RetainedResultMustNotCreateNewSigningContexts");
  await assert.rejects(recoveredCoordinator.signAutomaticallyOverIpc(intent, { attempt: 1 }), /ProtectedFrostAttemptManagedDurably/u);
  await assert.rejects(f[0].client.request(ports[0], { method: "verifyNativeEvidence", operationId: h("wrong-operation"), payload: intent }));
  await assert.rejects(recoveredCoordinator.signAutomaticallyOverIpc({ ...intent, amountAtomic: "999" }), /CoordinatorJournalRequestChanged/u);
  await assert.rejects(recoveredCoordinator.signAutomaticallyOverIpc({ ...intent, signingRequestId: h("new-request") }), /CoordinatorJournalInputAlreadyBound/u);
  assert.equal((await global.authority.status()).policyState, "RUNNING", "UncertaintyIsNotConfirmedContradiction");
  await guards[0].guard.report(intent.operationId, "SIGNER_ROLLBACK", h("confirmed-test-rollback"));
  await global.restart();
  await assert.rejects(f[0].client.request(ports[0], { method: "signingCommitment", operationId: intent.operationId, payload: { request: createNativeFrostSigningRequest(intent) } }));
  const restartedCoordinator = createCoordinator();
  await assert.rejects(restartedCoordinator.signAutomaticallyOverIpc(intent));
  assert.equal((await guards[1].guard.status(intent.operationId)).state, "HARD_STOP_INTEGRITY");
});

async function coordinatorActor(f, selectedBoundary = "NONE") {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "coordinator-recovery-actor.mjs")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(), buffered = new Map(); let text = "", closed = false, failure;
  const ended = new Promise(resolve => child.once("close", () => { closed = true; resolve(); }));
  const fail = code => {
    failure = code;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(code)); } pending.clear();
  };
  child.on("error", () => fail("TestCoordinatorActorUnavailable")); child.stdin.on("error", () => fail("TestCoordinatorActorUnavailable"));
  child.on("close", () => fail("TestCoordinatorActorClosed")); child.stderr.on("data", () => fail("TestCoordinatorActorDiagnosticRejected"));
  child.stdout.on("data", bytes => {
    text += bytes.toString("utf8"); if (text.length > 32768) { fail("TestCoordinatorActorOversize"); child.kill(); return; }
    for (;;) {
      const at = text.indexOf("\n"); if (at < 0) break;
      const line = text.slice(0, at); text = text.slice(at + 1);
      try {
        const v = JSON.parse(line); assert(Array.isArray(v) && v.length === 2 && ["READY", "BOUNDARY", "RESULT", "STATS", "CLOSED", "ERROR"].includes(v[0]));
        if (v[0] === "ERROR") {
          const safe = ["CoordinatorJournalUnavailable", "CoordinatorJournalRequestChanged", "FrostCoordinatorAbortIncomplete", "IpcRequestRejected", "IntegrityAuthorizationStopped", "TestCoordinatorActorRejected"];
          const calls = ["INIT", "SUPERVISOR", ...["verifyNativeEvidence", "signingCommitment", "signatureShare", "abortSigningSession"].flatMap(m => [m + "_A", m + "_B"])];
          const transport = ["NONE", "IpcTimeout", "IpcExpiredResult", "IpcTransportClosed", "IpcTransportRejected", "IpcAuthenticationFailed", "IpcStaleRequest", "IpcContextRejected", "IpcReplayRejected", "IpcSizeRejected", "IpcBusy", "IpcStaleEndpoint", "IpcRejected"];
          const d = v[1];
          fail(safe.includes(d?.code) && calls.includes(d.call) && transport.includes(d.transport)
            ? d.code + ":" + d.call + ":" + d.transport + ":SERVERS:" + f.f.map(v => v.server.lastRejection ?? "NONE").join(",") + ":HANDLERS:" + f.handlerFaults.join(",")
            : "TestCoordinatorActorRejected"); continue;
        }
        const p = pending.get(v[0]);
        if (p) { clearTimeout(p.timer); pending.delete(v[0]); p.resolve(v[1]); }
        else { assert(!buffered.has(v[0])); buffered.set(v[0], v[1]); }
      } catch { fail("TestCoordinatorActorMalformed"); child.kill(); }
    }
  });
  const receive = name => {
    if (buffered.has(name)) { const v = buffered.get(name); buffered.delete(name); return Promise.resolve(v); }
    return new Promise((resolve, reject) => {
      if (closed || failure || pending.has(name)) { reject(new Error(failure ?? "TestCoordinatorActorUnavailable")); return; }
      // Test orchestration only. Each actual mTLS request still has its unchanged
      // production-code deadline; a complete multi-request signing can take longer.
      const timer = setTimeout(() => { pending.delete(name); reject(new Error("TestCoordinatorActorTimeout")); }, 240000);
      pending.set(name, { resolve, reject, timer });
    });
  };
  const stop = async () => { if (!closed) child.kill(); await ended; };
  cleanups.get(f.root).unshift(stop); // Kill before closing signer/supervisor dependencies.
  const ready = receive("READY");
  child.stdin.write(JSON.stringify(["INIT", { boundary: selectedBoundary, journalOptions: f.journalOptions,
    key: { publicPackage: f.dkg.publicPackage, aggregateTweakedXOnlyPublicKey: f.dkg.aggregateTweakedXOnlyPublicKey }, intent: f.intent,
    supervisorOptions: f.coordinatorPeer.clientOptions, supervisorPort: f.coordinatorPeer.port,
    signers: f.f.map((v, i) => ({ options: v.clientOptions, port: f.ports[i], signerId: v.role })) }]) + "\n");
  await ready;
  return { receive, stop, startSign() { child.stdin.write('["SIGN",null]\n'); },
    async sign() { const result = receive("RESULT"); this.startSign(); return result; },
    async stats() { const result = receive("STATS"); child.stdin.write('["STATS",null]\n'); return result; } };
}

for (const boundary of ["PREPARED", "COMMITMENT_A", "COMMITMENT_B", "SHARE_A", "SHARE_B", "AGGREGATE_READY", "SIGNED_PERSISTED", "RESULT_READY"]) {
  test("protected coordinator process-kill recovery at " + boundary, async t => {
    const f = await protectedCoordinatorFixture(t);
    f.coordinatorPeer.client.close(); f.f.forEach(v => v.client.close());
    const actor = await coordinatorActor(f, boundary); await f.global.enableTestSources();
    const reached = actor.receive("BOUNDARY"); actor.startSign(); assert.equal(await reached, boundary); await actor.stop();
    const retained = f.journalStore.read(); let before;
    try { before = JSON.parse(retained.payload.toString("utf8")); } finally { retained.payload.fill(0); }
    assert.equal(before.records.length, 1); assert.equal(before.records[0].request.attempt, 1);
    const completed = ["SIGNED_PERSISTED", "RESULT_READY"].includes(boundary);
    assert.equal(before.records[0].state, completed ? "SIGNED" : "PREPARED");
    const restarted = await coordinatorActor(f), result = await restarted.sign();
    assert(schnorr.verify(Buffer.from(result.signatureHex, "hex"), Buffer.from(f.intent.taprootSighashHex, "hex"), Buffer.from(f.dkg.aggregateTweakedXOnlyPublicKey, "hex")));
    assert.deepEqual(await restarted.stats(), completed ? { commitments: 0, shares: 0, aborts: 0 } : { commitments: 2, shares: 2, aborts: 2 });
    const after = f.journalStore.read();
    try {
      const state = JSON.parse(after.payload.toString("utf8")); assert.equal(state.records.length, 1);
      assert.equal(state.records[0].request.attempt, completed ? 1 : 2); assert.deepEqual(state.records[0].result, result);
      if (completed) assert.deepEqual(result, before.records[0].result);
      else assert.notEqual(result.sessionId, before.records[0].request.sessionId, "UncertainNonceSessionMustNeverResurrect");
    } finally { after.payload.fill(0); }
    assert.deepEqual(await restarted.sign(), result, "ExactResultRetryMustNotSignAgain");
    assert.deepEqual(await restarted.stats(), completed ? { commitments: 0, shares: 0, aborts: 0 } : { commitments: 2, shares: 2, aborts: 2 });
  });
}

test("protected coordinator keeps uncertain abort pending and requires A+B receipts on restart", async t => {
  const f = await protectedCoordinatorFixture(t);
  let journal = await ProtectedCoordinatorSigningJournal.open({ store: f.journalStore, integrity: f.coordinatorGuard, ...f.dkg });
  cleanups.get(f.root).push(() => journal.close());
  const create = () => new NativeFrostCoordinator({ signers: f.peers, publicPackage: f.dkg.publicPackage,
    aggregateTweakedXOnlyPublicKey: f.dkg.aggregateTweakedXOnlyPublicKey, integrity: f.coordinatorGuard, signingJournal: journal });
  const coordinator = create(), callA = f.f[0].client.request.bind(f.f[0].client), callB = f.f[1].client.request.bind(f.f[1].client);
  f.f[0].client.request = async (...args) => { const result = await callA(...args); if (args[1].method === "signingCommitment") throw new Error("TEST_COMMITMENT_RESPONSE_LOST"); return result; };
  f.f[1].client.request = async (...args) => { if (args[1].method === "abortSigningSession") throw new Error("TEST_ABORT_UNAVAILABLE"); return callB(...args); };
  await f.global.enableTestSources();
  await assert.rejects(coordinator.signAutomaticallyOverIpc(f.intent), /TEST_COMMITMENT_RESPONSE_LOST/u);
  assert.equal(journal.lookup(f.intent).state, "PREPARED");
  await assert.rejects(coordinator.signAutomaticallyOverIpc(f.intent), /FrostCoordinatorHardStop/u);
  assert.equal((await f.global.authority.status()).policyState, "RUNNING", "MissingResponseIsNotConfirmedContradiction");
  f.f[0].client.request = callA; f.f[1].client.request = callB;
  await journal.close();
  journal = await ProtectedCoordinatorSigningJournal.open({ store: new WindowsProtectedStore(f.journalOptions), integrity: f.coordinatorGuard, ...f.dkg });
  const result = await create().signAutomaticallyOverIpc(f.intent);
  assert.equal(journal.lookup(f.intent).request.attempt, 2); assert.equal(result.state, "SIGNED");
  assert(schnorr.verify(Buffer.from(result.signatureHex, "hex"), Buffer.from(f.intent.taprootSighashHex, "hex"), Buffer.from(f.dkg.aggregateTweakedXOnlyPublicKey, "hex")));
});

test("protected coordinator recovers an exact committed aggregate after lost persistence response", async t => {
  const f = await protectedCoordinatorFixture(t);
  let journal = await ProtectedCoordinatorSigningJournal.open({ store: f.journalStore, integrity: f.coordinatorGuard, ...f.dkg });
  cleanups.get(f.root).push(() => journal.close());
  const create = () => new NativeFrostCoordinator({ signers: f.peers, publicPackage: f.dkg.publicPackage,
    aggregateTweakedXOnlyPublicKey: f.dkg.aggregateTweakedXOnlyPublicKey, integrity: f.coordinatorGuard, signingJournal: journal });
  const persist = f.journalStore.write.bind(f.journalStore);
  f.journalStore.write = (bytes, revision) => {
    const result = persist(bytes, revision);
    if (JSON.parse(Buffer.from(bytes).toString()).records.at(-1).state === "SIGNED") throw new Error("TEST_WRITE_RESPONSE_LOST");
    return result;
  };
  await f.global.enableTestSources(); await assert.rejects(create().signAutomaticallyOverIpc(f.intent), /TEST_WRITE_RESPONSE_LOST/u);
  const before = journal.lookup(f.intent); assert.equal(before.state, "SIGNED");
  const counts = [...f.verificationCounts];
  await journal.close();
  journal = await ProtectedCoordinatorSigningJournal.open({ store: new WindowsProtectedStore(f.journalOptions), integrity: f.coordinatorGuard, ...f.dkg });
  assert.deepEqual(await create().signAutomaticallyOverIpc(f.intent), before.result); assert.deepEqual(f.verificationCounts, counts);
  assert.equal(journal.lookup(f.intent).request.attempt, 1);
});

test("protected coordinator rejects duplicate process and retained-witness rollback with global stop", async t => {
  const f = await protectedCoordinatorFixture(t), files = [path.join(f.journalOptions.root, "state.protected"), path.join(f.journalOptions.anchorRoot, "state.protected")];
  const old = files.map(file => readFileSync(file));
  const journal = await ProtectedCoordinatorSigningJournal.open({ store: f.journalStore, integrity: f.coordinatorGuard, ...f.dkg });
  cleanups.get(f.root).push(() => journal.close());
  // A separate real process cannot activate the same protected journal.
  await assert.rejects(coordinatorActor(f), /CoordinatorJournalUnavailable/u);
  await journal.runExclusive(() => journal.prepare(f.intent)); await journal.close();
  files.forEach((file, index) => { writeFileSync(file, old[index]); old[index].fill(0); });
  await assert.rejects(ProtectedCoordinatorSigningJournal.open({ store: new WindowsProtectedStore(f.journalOptions), integrity: f.coordinatorGuard, ...f.dkg }));
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await f.global.restart(); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

test("protected coordinator rejects authenticated malformed journal and concurrent mutation", async t => {
  const f = await protectedCoordinatorFixture(t);
  const journal = await ProtectedCoordinatorSigningJournal.open({ store: f.journalStore, integrity: f.coordinatorGuard, ...f.dkg });
  cleanups.get(f.root).push(() => journal.close());
  const before = f.journalStore.read();
  try { f.journalStore.write(before.payload, before.revision); } finally { before.payload.fill(0); }
  await assert.rejects(journal.runExclusive(() => journal.lookup(f.intent)), /CoordinatorJournalAuthenticatedStateInvalid/u);
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await journal.close();
  const store = new WindowsProtectedStore(f.journalOptions), current = store.read();
  try { store.write(Buffer.from("{"), current.revision); } finally { current.payload.fill(0); }
  await assert.rejects(ProtectedCoordinatorSigningJournal.open({ store, integrity: f.coordinatorGuard, ...f.dkg }));
  await f.global.restart(); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

test("protected coordinator retains an integrity incident when supervisor reporting is unavailable", async t => {
  const f = await protectedCoordinatorFixture(t);
  const journal = await ProtectedCoordinatorSigningJournal.open({ store: f.journalStore, integrity: f.coordinatorGuard, ...f.dkg });
  cleanups.get(f.root).push(() => journal.close());
  // Real unreachable transport, not a stub of the guard/persistence path.
  f.coordinatorPeer.server.close();
  const before = f.journalStore.read();
  try { f.journalStore.write(before.payload, before.revision); } finally { before.payload.fill(0); }
  await assert.rejects(journal.runExclusive(() => journal.lookup(f.intent)), /IpcRequestRejected/u);
  await journal.close(); f.coordinatorPeer.client.close();
  assert.equal((await f.global.authority.status()).policyState, "RUNNING", "IncidentDeliveryWasActuallyUnavailable");
  const ipc = new ProtectedServiceIpc(new WindowsProtectedStore(f.coordinatorPeer.clientOptions));
  cleanups.get(f.root).push(() => ipc.close());
  assert.equal(ipc.retainedIntegrityIncidents().length, 1);
  const unavailable = new RemoteIntegrityGuard({ ipc, port: f.coordinatorPeer.port });
  await assert.rejects(unavailable.assertRunning(f.intent.operationId, "COORDINATE_SWEEP"));
  assert.equal((await f.global.authority.status()).policyState, "RUNNING", "NoFabricatedGlobalAcknowledgement");
  const guard = new RemoteIntegrityGuard({ ipc, port: await f.global.reopenPeerTransport(f.coordinatorPeer) });
  const reopened = await ProtectedCoordinatorSigningJournal.open({ store: new WindowsProtectedStore(f.journalOptions), integrity: guard, ...f.dkg });
  cleanups.get(f.root).push(() => reopened.close());
  const coordinator = new NativeFrostCoordinator({ signers: f.peers, ...f.dkg, integrity: guard, signingJournal: reopened });
  await assert.rejects(coordinator.signAutomaticallyOverIpc(f.intent), /IntegrityAuthorizationStopped/u);
  assert.deepEqual(f.verificationCounts, [0, 0], "NoSigningAfterUndeliveredIntegrityIncident");
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await f.global.restart();
  assert.equal((await guard.status(f.intent.operationId)).state, "HARD_STOP_INTEGRITY");
  assert.equal((await f.global.authority.status()).incidentCount, 1, "IncidentRedeliveryIsIdempotent");
  assert.equal(ipc.retainedIntegrityIncidents().length, 1, "AcknowledgementDoesNotEraseIncident");
});

test("durable global stop propagates to every service role and survives authority/client restart", async t => {
  const f = await integrityFixture(t), peers = [];
  for (const role of INTEGRITY_ROLES) peers.push(await f.peer(role));
  for (const p of peers) assert.equal((await p.guard.status(h("status"))).state, "PAUSED_POLICY");
  const native = peers.find(p => p.client.role === "NATIVE_OBSERVER");
  await native.guard.report(h("affected-operation"), "NATIVE_DEEP_REORG", h("raw-reorg-evidence"));
  assert.equal(f.authority.status().incidentCount, 1);
  await f.restart();
  for (const p of peers) {
    p.client.close(); const ipc = new ProtectedServiceIpc(new WindowsProtectedStore(p.clientOptions)); t.after(() => ipc.close());
    const guard = new RemoteIntegrityGuard({ ipc, port: p.port });
    assert.equal((await guard.status(h("restart-status"))).state, "HARD_STOP_INTEGRITY");
    const actions = { KINGPEPE_FROST_A: "FROST_SIGN", KINGPEPE_FROST_B: "FROST_SIGN", COORDINATOR: "COORDINATE_SWEEP",
      ATTESTER_A: "ATTEST_MINT_CREDIT", ATTESTER_B: "ATTEST_MINT_CREDIT", BRIDGE_VALIDATOR: "AUTHORIZE_CLAIM", RELAYER: "SUBMIT_CLAIM" };
    if (actions[guard.role]) await assert.rejects(guard.assertRunning(h("new-operation"), actions[guard.role]));
    await assert.rejects(ipc.request(p.port, { method: "clearHardStop", operationId: h("unauthorized-clear"), payload: {} }));
  }
  // Idempotent report preserves the original incident and never clears the stop.
  const reopened = await f.peer("NATIVE_OBSERVER");
  await reopened.guard.report(h("affected-operation"), "NATIVE_DEEP_REORG", h("raw-reorg-evidence"));
  assert.equal(f.authority.status().incidentCount, 1);
});

for (const [role, code] of [["SOLANA_OBSERVER", "SOLANA_DEPLOYMENT_CHANGED"], ["RECONCILIATION", "CONFIRMED_RESERVE_DEFICIT"], ["KINGPEPE_FROST_A", "SIGNER_ROLLBACK"]]) {
  test("protected global integrity report and durable reopen: " + role, async t => {
    const f = await integrityFixture(t), peer = await f.peer(role);
    await assert.rejects(peer.guard.report(h("test"), "SOURCE_UNAVAILABLE", h("not-a-contradiction")));
    assert.equal(f.authority.status().policyState, "RUNNING");
    await peer.guard.report(h("test"), code, h("confirmed-evidence"));
    await f.restart(); assert.equal((await peer.guard.status(h("test"))).state, "HARD_STOP_INTEGRITY");
  });
}

test("integrity role, authority lease, pause, missing and corrupt storage fail closed", async t => {
  const f = await integrityFixture(t, "PAUSED_POLICY"), peer = await f.peer("RELAYER");
  const invalid = options(peer.root, "not-enrolled", "SUPERVISOR", "global-integrity"); invalid.context.environment = "mainnet";
  await assert.rejects(ProtectedIntegrityAuthority.createLocal(invalid, "RUNNING")); assert.equal(existsSync(invalid.root), false);
  await assert.rejects(ProtectedIntegrityAuthority.openLocal(new WindowsProtectedStore(f.options)));
  await assert.rejects(peer.guard.assertRunning(h("operation"), "SUBMIT_CLAIM"));
  await assert.rejects(peer.guard.assertRunning(h("operation"), "FROST_SIGN"));
  await assert.rejects(peer.guard.report(h("operation"), "SOLANA_DEPLOYMENT_CHANGED", h("wrong-role")));
  assert.equal((await peer.guard.status(h("operation"))).state, "PAUSED_POLICY");
  await f.authority.close();
  await assert.rejects(peer.guard.assertRunning(h("operation"), "SUBMIT_CLAIM"));
  const file = path.join(f.options.root, "state.protected"), bytes = readFileSync(file); bytes[bytes.length - 1] ^= 1; writeFileSync(file, bytes);
  await assert.rejects(ProtectedIntegrityAuthority.openLocal(new WindowsProtectedStore(f.options)));
  assert.throws(() => new RemoteIntegrityGuard({ ipc: {}, port: peer.port }));
});

async function protectedAttesterFixture(t, role = "ATTESTER_A") {
  const global = await isolatedIntegrityFixture(t), supervisor = await global.peer(role), guard = supervisor.guard;
  const f = fixture(t, role, "BRIDGE_VALIDATOR"), seed = randomBytes(32);
  const vector = JSON.parse(readFileSync(path.join(repoRoot, "solana/modules/bridge-messages/vectors/canonical-v1.json"))).vectors.find(v => v.name === "deposit-claim-v1");
  const identity = { ...vector.deployment, nativeGenesis: REGTEST_GENESIS, solanaDeployment: deployment };
  const now = BigInt(Math.floor(Date.now() / 1000)), encoded = Buffer.from(encodeCanonicalBridgeMessage({ ...decodeCanonicalBridgeMessage(vector.encodedHex), operationId: undefined,
    deployment: identity, keyEpoch: 1, validFrom: now - 5n, validUntil: now + 600n })).toString("hex"), decoded = decodeCanonicalBridgeMessage(encoded);
  const policy = { role, attesterPublicKeyHex: Buffer.from(ed25519.getPublicKey(seed)).toString("hex"), protocolId: identity.protocolId,
    nativeNetwork: identity.nativeNetwork, nativeGenesisHex: identity.nativeGenesis, solanaDeploymentHex: identity.solanaDeployment,
    managerProgramIdHex: identity.managerProgramId, transceiverProgramIdHex: identity.transceiverProgramId, mintHex: identity.mint,
    keyEpoch: 1, policyEpoch: vector.policyEpoch, acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"], depositsPaused: false, hardStop: false };
  const opts = options(f.root, "attester-seed", role, "attester-seed");
  const store = WindowsProtectedStore.create(opts, seed); seed.fill(0);
  const attester = ProjectAttester.fromWindowsProtectedStore({ store, role, policy });
  cleanups.get(f.root).push(() => { attester.close(); store.close(); });
  const journalOptions = options(f.root, "attester-authorizations", role, "attester-authorizations", opts.context.instanceId);
  const bytes = ProtectedAttesterAuthorizationJournal.initialState(attester);
  const journalStore = WindowsProtectedStore.create(journalOptions, bytes); bytes.fill(0);
  cleanups.get(f.root).push(() => journalStore.close());
  const evidence = { trust: "LOCALLY_VALIDATED_CHAIN_STATE", nativeNetwork: identity.nativeNetwork, nativeGenesisHash: identity.nativeGenesis,
    operationIdHex: decoded.operationIdHex, depositOutpoint: decoded.depositOutpointText, amountAtomic: decoded.amountAtomic.toString(),
    solanaRecipientHex: decoded.destinationHex, evidenceDigestHex: decoded.evidenceDigestHex, reserveAllocationIdHex: h("attester-test-allocation"),
    reserveTransitionState: "CANONICAL_RESERVE", mintCreditState: "AUTHORIZED_UNCONSUMED", finalitySatisfied: true, sweepFinalized: true,
    utxoUnspentAtDeposit: true, noPriorConsumption: true };
  return { ...f, global, guard, supervisor, opts, store, policy, attester, journalOptions, journalStore, evidence, decoded, encoded,
    input: { method: "attestDeposit", operationId: decoded.operationIdHex, payload: { encodedMessageHex: encoded, rawEvidence: {} } } };
}

function attesterFixtureFailure(error) {
  return error?.path !== undefined || error?.dest !== undefined ? new Error("AttesterRecoveryTestFilesystemFailure") : error;
}
test("attester fixture filesystem failure redacts private diagnostic fields", () => {
  const privatePath = path.join(os.tmpdir(), "unpublished-attester-fixture");
  const original = Object.assign(new Error("TEST " + privatePath), { path: privatePath, code: "ENOENT" });
  const safe = attesterFixtureFailure(original);
  assert.equal(safe.message, "AttesterRecoveryTestFilesystemFailure");
  assert.equal(safe.path, undefined); assert.equal(safe.cause, undefined); assert(!safe.stack.includes(privatePath));
});
function attesterRecoveryTest(name, body) {
  test(name, async t => {
    try { await body(t); }
    catch (error) {
      // Unexpected fixture I/O failures must not put a profile/runtime path in
      // a test reporter or artifact. Preserve failure, not its private context.
      throw attesterFixtureFailure(error);
    }
  });
}

for (const role of ["ATTESTER_A", "ATTESTER_B"]) attesterRecoveryTest("real protected attester TLS is gated by durable integrity state: " + role, async t => {
  const f = await protectedAttesterFixture(t, role), { global, guard, attester, evidence, decoded, encoded } = f;
  let journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: f.journalStore });
  cleanups.get(f.root).push(() => journal.close());
  let verifications = 0;
  const verifyNativeDeposit = async () => {
    verifications++; return { operationIdHex: decoded.operationIdHex, messageDigestHex: decoded.messageDigestHex, evidence };
  };
  // Synthetic Native evidence only; DPAPI, mTLS, Ed25519 and durable stop are real.
  let handler = attesterIpcHandler({ attester, integrity: guard, journal, verifyNativeDeposit });
  assert.throws(() => attesterIpcHandler({ attester, integrity: guard, verifyNativeDeposit }), /ProtectedAttesterJournalRequired/u);
  let handlerFailure = "NONE";
  const port = await f.server.listen(async input => {
    try { return await handler(input); } catch (error) {
      const safe = ["AttesterJournalInvalid", "AttesterJournalPolicyRejected", "AttesterJournalAuthenticatedStateInvalid", "AttesterJournalConcurrentMutation",
        "IntegrityAuthorizationStopped", "IpcRequestRejected", "ProtectedLifetimeLeaseLost", "WindowsProtectedStoreRejected"];
      handlerFailure = safe.includes(error?.message) ? error.message : "UNCLASSIFIED"; throw error;
    }
  }), { input } = f;
  await global.enableTestSources();
  let signed;
  try { signed = await f.client.request(port, input); }
  catch { throw new Error("ProtectedAttesterIpcFailure:" + (f.server.lastRejection ?? "UNREPORTED") + ":" + handlerFailure); }
  assert(verifyProjectAttestation(signed, encoded)); assert.equal(verifications, 1);
  const revision = f.journalStore.read().revision;
  assert.deepEqual(await f.client.request(port, input), signed); assert.equal(verifications, 2);
  assert.equal(f.journalStore.read().revision, revision, "Same authorization must not be appended twice");
  await journal.close(); journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: new WindowsProtectedStore(f.journalOptions) });
  handler = attesterIpcHandler({ attester, integrity: guard, journal, verifyNativeDeposit });
  assert.deepEqual(await f.client.request(port, input), signed); assert.equal(verifications, 3);
  evidence.noPriorConsumption = false;
  await assert.rejects(f.client.request(port, input)); assert.equal(verifications, 4);
  evidence.noPriorConsumption = true;
  await guard.report(decoded.operationIdHex, "CONFLICTING_RESERVE_EVIDENCE", h("contradiction"));
  await global.restart();
  // journal.close() above closed its original store handle. Inspect the same
  // existing protected state with a fresh read-only handle, not that closed one.
  const stoppedProbe = new WindowsProtectedStore(f.journalOptions);
  cleanups.get(f.root).push(() => stoppedProbe.close());
  const beforeStopRevision = stoppedProbe.read().revision;
  await assert.rejects(f.client.request(port, input)); assert.equal(verifications, 5, "ReadOnlyEvidenceMayContinueUnderStop");
  assert.equal(stoppedProbe.read().revision, beforeStopRevision, "StoppedRequestCannotCreateOrReplaceAuthorization");
});

attesterRecoveryTest("attester rechecks durable stop after read-only evidence before key use and preparation", async t => {
  const f = await protectedAttesterFixture(t), journal = await ProtectedAttesterAuthorizationJournal.open({ attester: f.attester, integrity: f.guard, store: f.journalStore });
  cleanups.get(f.root).push(() => journal.close());
  const handler = attesterIpcHandler({ attester: f.attester, integrity: f.guard, journal, verifyNativeDeposit: async () => {
    await f.guard.report(f.decoded.operationIdHex, "CONFLICTING_RESERVE_EVIDENCE", h("stop-during-attester-evidence"));
    return { operationIdHex: f.decoded.operationIdHex, messageDigestHex: f.decoded.messageDigestHex, evidence: f.evidence };
  } });
  const port = await f.server.listen(handler), revision = f.journalStore.read().revision;
  const originalRead = f.store.read.bind(f.store); let keyReads = 0;
  f.store.read = () => { keyReads++; return originalRead(); };
  await f.global.enableTestSources();
  await assert.rejects(f.client.request(port, f.input), /IpcRequestRejected/u);
  assert.equal(keyReads, 0, "NoProtectedKeyReadAfterEvidenceIntroducesStop");
  assert.equal(f.journalStore.read().revision, revision, "NoAuthorizationPreparedAfterStop");
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

async function attesterActor(f, selectedBoundary = "NONE") {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "attester-recovery-actor.mjs")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(), buffered = new Map(); let text = "", closed = false;
  const ended = new Promise(resolve => child.once("close", () => { closed = true; resolve(); }));
  const failed = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("TestAttesterActorUnavailable")); } pending.clear(); };
  child.on("error", failed); child.on("close", failed); child.stderr.on("data", failed); child.stdin.on("error", failed);
  child.stdout.on("data", bytes => {
    text += bytes.toString("utf8"); if (text.length > 32768) { failed(); child.kill(); return; }
    for (;;) {
      const at = text.indexOf("\n"); if (at < 0) break;
      const line = text.slice(0, at); text = text.slice(at + 1);
      try {
        const v = JSON.parse(line); assert(Array.isArray(v) && v.length === 2 && ["READY", "BOUNDARY", "STATS", "DIAGNOSTICS", "CLOSED", "ERROR"].includes(v[0]));
        if (v[0] === "ERROR") { failed(); child.kill(); continue; }
        const p = pending.get(v[0]);
        if (p) { clearTimeout(p.timer); pending.delete(v[0]); p.resolve(v[1]); }
        else { assert(!buffered.has(v[0])); buffered.set(v[0], v[1]); }
      } catch { failed(); child.kill(); }
    }
  });
  const receive = name => {
    if (buffered.has(name)) { const v = buffered.get(name); buffered.delete(name); return Promise.resolve(v); }
    return new Promise((resolve, reject) => {
      if (closed || pending.has(name)) { reject(new Error("TestAttesterActorUnavailable")); return; }
      const timer = setTimeout(() => { pending.delete(name); reject(new Error("TestAttesterActorTimeout")); }, 60000);
      pending.set(name, { resolve, reject, timer });
    });
  };
  const stop = async () => { if (!closed) child.kill(); await ended; };
  cleanups.get(f.root).push(stop);
  const ready = receive("READY");
  child.stdin.write(JSON.stringify(["INIT", { role: f.role, boundary: selectedBoundary, seedOptions: f.opts, policy: f.policy,
    journalOptions: f.journalOptions, serverOptions: f.serverOptions, supervisorOptions: f.supervisor.clientOptions,
    supervisorPort: f.supervisor.port, encodedMessageHex: f.encoded, evidence: f.evidence }]) + "\n");
  return { port: await ready, receive, stop, async stats() { const result = receive("STATS"); child.stdin.write('["STATS",null]\n'); return result; },
    async diagnostics() { const result = receive("DIAGNOSTICS"); child.stdin.write('["DIAGNOSTICS",null]\n'); return result; } };
}

for (const boundary of ["PREPARED", "SIGNATURE_CREATED", "SIGNED_PERSISTED", "RESULT_READY"]) {
  attesterRecoveryTest("protected attester process-kill recovery at " + boundary, async t => {
    const f = await protectedAttesterFixture(t);
    const actor = await attesterActor(f, boundary); await f.global.enableTestSources();
    const reached = actor.receive("BOUNDARY");
    const lostResponse = f.client.request(actor.port, f.input).then(() => "UNEXPECTED_SUCCESS", () => "LOST_RESPONSE");
    assert.equal(await reached, boundary); await actor.stop(); assert.equal(await lostResponse, "LOST_RESPONSE");
    const restarted = await attesterActor(f);
    let signed;
    try { signed = await f.client.request(restarted.port, f.input); }
    catch {
      const diagnostic = await restarted.diagnostics();
      throw new Error("TestAttesterResumeRejected:" + f.client.lastRejection + ":" + diagnostic.transportFailure + ":" + diagnostic.handlerFailure);
    }
    assert(verifyProjectAttestation(signed, f.encoded));
    const expectedSigns = ["PREPARED", "SIGNATURE_CREATED"].includes(boundary) ? 1 : 0;
    assert.deepEqual(await restarted.stats(), { verifications: 1, signs: expectedSigns });
    assert.deepEqual(await f.client.request(restarted.port, f.input), signed);
    assert.deepEqual(await restarted.stats(), { verifications: 2, signs: expectedSigns });
    const bytes = f.journalStore.read().payload;
    try {
      const state = JSON.parse(bytes.toString()); assert.equal(state.records.length, 1);
      assert.equal(state.records[0].encodedMessageHex, f.encoded); assert.deepEqual(state.records[0].signature, signed);
    } finally { bytes.fill(0); }
  });
}

attesterRecoveryTest("protected attester rejects duplicate process, changed backing binding and retained conflict after restart", async t => {
  const f = await protectedAttesterFixture(t), { attester, guard } = f;
  const journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: f.journalStore });
  cleanups.get(f.root).push(() => journal.close());
  await assert.rejects(ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: new WindowsProtectedStore(f.journalOptions) }));
  await assert.rejects(attesterActor(f)); // Actual second service process cannot acquire the journal lifetime lease.
  await f.global.enableTestSources();
  let evidence = f.evidence;
  const handler = attesterIpcHandler({ attester, journal, integrity: guard, verifyNativeDeposit: async ({ encodedMessageHex }) => {
    const d = decodeCanonicalBridgeMessage(encodedMessageHex);
    return { operationIdHex: d.operationIdHex, messageDigestHex: d.messageDigestHex, evidence };
  } });
  let handlerFailure = "NONE";
  const port = await f.server.listen(async input => {
    try { return await handler(input); } catch (error) {
      const safe = ["AttesterJournalInvalid", "AttesterJournalPolicyRejected", "AttesterJournalAuthenticatedStateInvalid",
        "AttesterJournalConcurrentMutation", "IntegrityAuthorizationStopped", "IpcRequestRejected", "ProtectedLifetimeLeaseLost", "WindowsProtectedStoreRejected"];
      handlerFailure = safe.includes(error?.message) ? error.message : "UNCLASSIFIED"; throw error;
    }
  });
  let signed;
  try { signed = await f.client.request(port, f.input); }
  catch { throw new Error("TestAttesterConflictSetupRejected:" + f.client.lastRejection + ":" + (f.server.lastRejection ?? "NONE") + ":" + handlerFailure); }
  assert(verifyProjectAttestation(signed, f.encoded));
  const changed = Buffer.from(encodeCanonicalBridgeMessage({ ...f.decoded, operationId: undefined, nonce: h("different-attester-request") })).toString("hex");
  const d = decodeCanonicalBridgeMessage(changed); evidence = { ...evidence, operationIdHex: d.operationIdHex };
  await assert.rejects(f.client.request(port, { ...f.input, operationId: d.operationIdHex, payload: { encodedMessageHex: changed, rawEvidence: {} } }));
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await journal.close(); await f.global.restart();
  await assert.rejects(ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: new WindowsProtectedStore(f.journalOptions) }));
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

attesterRecoveryTest("protected attester file-package rollback is rejected by retained witness and stops authority", async t => {
  const f = await protectedAttesterFixture(t), { attester, guard } = f;
  const image = readFileSync(path.join(f.journalOptions.root, "state.protected"));
  const anchor = readFileSync(path.join(f.journalOptions.anchorRoot, "state.protected"));
  const journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: f.journalStore });
  cleanups.get(f.root).push(() => journal.close()); await f.global.enableTestSources();
  const signed = await journal.authorize({ encodedMessageHex: f.encoded, evidence: f.evidence }); assert(verifyProjectAttestation(signed, f.encoded));
  await journal.close();
  writeFileSync(path.join(f.journalOptions.root, "state.protected"), image); image.fill(0);
  writeFileSync(path.join(f.journalOptions.anchorRoot, "state.protected"), anchor); anchor.fill(0);
  await assert.rejects(ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: new WindowsProtectedStore(f.journalOptions) }));
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await f.global.restart(); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

attesterRecoveryTest("protected attester rejects wrong seed instance and unavailable or corrupt journal without signing", async t => {
  const f = await protectedAttesterFixture(t), { attester, guard } = f;
  for (const patch of [{ instanceId: h("wrong-instance") }, { role: "ATTESTER_B" }, { solanaDeployment: h("wrong-deployment") }, { keyEpoch: 2 }]) {
    const store = new WindowsProtectedStore({ ...f.journalOptions, context: { ...f.journalOptions.context, ...patch } });
    try { await assert.rejects(ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store })); }
    finally { store.close(); }
  }
  const journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: f.journalStore });
  cleanups.get(f.root).push(() => journal.close()); await f.global.enableTestSources();
  let signs = 0; const original = ProjectAttester.prototype.signDepositCredit;
  ProjectAttester.prototype.signDepositCredit = function(...args) { signs++; return original.apply(this, args); };
  t.after(() => { ProjectAttester.prototype.signDepositCredit = original; });
  const file = path.join(f.journalOptions.root, "state.protected"), saved = readFileSync(file), corrupt = Buffer.from(saved);
  corrupt[corrupt.length - 1] ^= 1; writeFileSync(file, corrupt); corrupt.fill(0);
  await assert.rejects(journal.authorize({ encodedMessageHex: f.encoded, evidence: f.evidence })); assert.equal(signs, 0);
  unlinkSync(file);
  await assert.rejects(journal.authorize({ encodedMessageHex: f.encoded, evidence: f.evidence })); assert.equal(signs, 0);
  // Exact current ciphertext restored only in this isolated fault test. No runtime
  // repair path exists and a stale authenticated image remains witness-rejected.
  writeFileSync(file, saved); saved.fill(0);
});

attesterRecoveryTest("authenticated malformed attester journal triggers durable global integrity stop", async t => {
  const f = await protectedAttesterFixture(t), prior = f.journalStore.read();
  let bytes;
  try {
    const state = JSON.parse(prior.payload.toString()); state.identityDigest = h("different-attester-policy");
    bytes = Buffer.from(JSON.stringify(state)); f.journalStore.write(bytes, prior.revision);
  } finally { prior.payload.fill(0); bytes?.fill(0); }
  // Deliberate authenticated bad-payload injection, not a forged DPAPI envelope.
  await assert.rejects(ProtectedAttesterAuthorizationJournal.open({ attester: f.attester, integrity: f.guard, store: f.journalStore }));
  assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
  await f.global.restart(); assert.equal((await f.global.authority.status()).state, "HARD_STOP_INTEGRITY");
});

attesterRecoveryTest("retained attestation rechecks validity after the final asynchronous integrity check", async t => {
  const f = await protectedAttesterFixture(t), { attester, guard } = f;
  const journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity: guard, store: f.journalStore });
  cleanups.get(f.root).push(() => journal.close()); await f.global.enableTestSources();
  const request = { encodedMessageHex: f.encoded, evidence: f.evidence };
  assert(verifyProjectAttestation(await journal.authorize(request), f.encoded));
  const revision = f.journalStore.read().revision;
  const assertRunning = guard.assertRunning.bind(guard), evaluate = ProjectAttester.prototype.evaluateDepositCredit;
  let checks = 0, expired = false;
  // Inject passage of policy time AFTER the real final authenticated check;
  // never change the host clock, transport deadline or chain evidence.
  guard.assertRunning = async (...args) => { await assertRunning(...args); if (++checks === 2) expired = true; };
  ProjectAttester.prototype.evaluateDepositCredit = function(value, now) { return evaluate.call(this, value, expired ? f.decoded.validUntil + 1n : now); };
  t.after(() => { ProjectAttester.prototype.evaluateDepositCredit = evaluate; });
  await assert.rejects(journal.authorize(request), /AttesterJournalPolicyRejected/u);
  assert.equal(checks, 2); assert.equal(f.journalStore.read().revision, revision, "Expired retry must not replace a retained authorization");
});

test("failed incident persistence cannot reopen authorization in the active authority", async t => {
  const f = await integrityFixture(t); await f.authority.close();
  const store = new WindowsProtectedStore(f.options), authority = await ProtectedIntegrityAuthority.openLocal(store);
  cleanups.get(path.dirname(f.options.root)).push(() => authority.close());
  const persist = store.write.bind(store);
  // Fault injection at a real protected store's write boundary, not a claim
  // that the workstation disk was filled or a power-loss test was performed.
  store.write = () => { throw new Error("TEST_PERSISTENCE_UNAVAILABLE"); };
  assert.throws(() => authority.handle({ peerRole: "NATIVE_OBSERVER", method: "reportContradiction", operationId: h("incident"),
    payload: { code: "NATIVE_DEEP_REORG", evidenceDigest: h("verified-incident") } }), /TEST_PERSISTENCE_UNAVAILABLE/u);
  store.write = persist;
  assert.throws(() => authority.handle({ peerRole: "RELAYER", method: "assertRunning", operationId: h("claim"), payload: { action: "SUBMIT_CLAIM" } }), /IntegrityStopRollback/u);
});

test("protected deployment monitor persists progress, detects change and propagates durable stop", async t => {
  // Network bytes here are a parser fixture, NOT a real chain. Independent
  // solana/tests/local-deployment-integrity.mjs runs the real upgrade mutations.
  const f = await integrityFixture(t), peer = await f.peer("SOLANA_OBSERVER"), signer = await f.peer("KINGPEPE_FROST_A");
  const { manifest, snapshot } = deploymentFixture(); let response = snapshot, unavailable = false;
  const server = http.createServer(async (req, res) => {
    let text = ""; for await (const b of req) text += b; const q = JSON.parse(text);
    if (unavailable) { res.writeHead(503); res.end(); return; }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: q.id, result: q.method === "getGenesisHash" ? response.genesis : { context: { slot: response.slot }, value: response.accounts } }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const rpc = new LocalDeploymentRpc({ endpoint: `http://127.0.0.1:${server.address().port}` });
  const opts = options(peer.root, "progress", "SOLANA_OBSERVER", "chain-progress"), initial = ProtectedSolanaDeploymentMonitor.initialProgress(manifest);
  const store = WindowsProtectedStore.create(opts, initial); initial.fill(0);
  let monitor = await ProtectedSolanaDeploymentMonitor.open({ manifest, rpc, integrity: peer.guard, store });
  cleanups.get(peer.root).push(() => monitor.close());
  assert.equal((await monitor.poll()).state, "OBSERVED_MATCH");
  await assert.rejects(ProtectedSolanaDeploymentMonitor.open({ manifest, rpc, integrity: peer.guard, store: new WindowsProtectedStore(opts) }));
  await monitor.close(); monitor = await ProtectedSolanaDeploymentMonitor.open({ manifest, rpc, integrity: peer.guard, store: new WindowsProtectedStore(opts) });
  unavailable = true; assert.equal((await monitor.poll()).state, "WAITING_FOR_DEPENDENCY");
  assert.equal(f.authority.status().state, "PAUSED_POLICY"); assert.equal(f.authority.status().incidentCount, 0); unavailable = false;
  response = { ...snapshot, slot: 9 }; assert.equal((await monitor.poll()).state, "WAITING_FOR_DEPENDENCY");
  assert.equal(f.authority.status().state, "PAUSED_POLICY"); assert.equal(f.authority.status().incidentCount, 0);
  response = structuredClone(snapshot); response.slot = 11;
  const data = Buffer.from(response.accounts[5].data[0], "base64"); data[13] ^= 1; response.accounts[5].data[0] = data.toString("base64");
  assert.equal((await monitor.poll()).state, "HARD_STOP_INTEGRITY");
  await f.restart(); await monitor.close();
  monitor = await ProtectedSolanaDeploymentMonitor.open({ manifest, rpc, integrity: peer.guard, store: new WindowsProtectedStore(opts) });
  response = { ...snapshot, slot: 12 };
  assert.equal((await monitor.poll()).state, "HARD_STOP_INTEGRITY");
  await assert.rejects(signer.guard.assertRunning(h("after-upgrade"), "FROST_SIGN"));
});

test("protected deployment progress rejects a restored manifest identity and reports its integrity failure", async t => {
  const f = await integrityFixture(t), peer = await f.peer("SOLANA_OBSERVER"), { manifest } = deploymentFixture();
  const opts = options(peer.root, "progress", "SOLANA_OBSERVER", "chain-progress"), initial = ProtectedSolanaDeploymentMonitor.initialProgress(manifest);
  const store = WindowsProtectedStore.create(opts, initial); initial.fill(0);
  const obsolete = structuredClone(manifest); obsolete.identityVersion++;
  await assert.rejects(ProtectedSolanaDeploymentMonitor.open({ manifest: obsolete, rpc: new LocalDeploymentRpc({ endpoint: "http://127.0.0.1:54321" }), integrity: peer.guard, store }));
  assert.equal(f.authority.status().state, "HARD_STOP_INTEGRITY");
  await f.restart(); assert.equal((await peer.guard.status(h("after-restore"))).state, "HARD_STOP_INTEGRITY");
});

test("protected Native observer rejects unavailable validation and reports corrupt progress", async t => {
  // Current-user DPAPI/mTLS test, NOT cross-account or real Native execution.
  const f = await integrityFixture(t), peer = await f.peer("NATIVE_OBSERVER"), signer = await f.peer("KINGPEPE_FROST_A");
  const { expectedPolicy, stored } = nativeProgressFixture(), opts = options(peer.root, "native-progress", "NATIVE_OBSERVER", "chain-progress");
  const bytes = Buffer.from(JSON.stringify(stored)), store = WindowsProtectedStore.create(opts, bytes); bytes.fill(0);
  const verifier = new LocalNativeEvidenceVerifier({ rpc: { async getBlockchainInfo() { throw new Error("TEST_SOURCE_UNAVAILABLE"); } }, executable: path.join(peer.root, "unavailable-native-verifier") });
  const monitor = await ProtectedNativeIntegrityMonitor.open({ expectedPolicy, verifier, integrity: peer.guard, store });
  cleanups.get(peer.root).push(() => monitor.close());
  assert.equal((await monitor.poll()).state, "WAITING_FOR_DEPENDENCY"); assert.equal(f.authority.status().state, "PAUSED_POLICY");
  assert.equal(f.authority.status().incidentCount, 0);
  const value = store.read(); value.payload.fill(0); store.write(Buffer.from("invalid-test-progress"), value.revision);
  assert.equal((await monitor.poll()).state, "HARD_STOP_INTEGRITY");
  await f.restart(); await assert.rejects(signer.guard.assertRunning(h("after-native-corruption"), "FROST_SIGN"));
});

test("protected Native incident persists and re-reports after actual authority and observer reopen", async t => {
  // The incident was constructed from policy fixtures. The protected replay is
  // real, but real regtest-fork evidence is tested separately on Linux/WSL.
  const f = await integrityFixture(t), peer = await f.peer("NATIVE_OBSERVER"), fixture = nativeProgressFixture();
  fixture.chain.headerHashes[3] = h("reorg-fixture"); fixture.chain.chainworkHex = "00".repeat(31) + "20";
  const incident = compareNativeProgress(fixture.stored, fixture.chain, fixture.expectedPolicy, fixture.now).progress;
  const opts = options(peer.root, "native-progress", "NATIVE_OBSERVER", "chain-progress"), bytes = Buffer.from(JSON.stringify(incident));
  const store = WindowsProtectedStore.create(opts, bytes); bytes.fill(0);
  const verifier = new LocalNativeEvidenceVerifier({ rpc: {}, executable: path.join(peer.root, "unavailable-native-verifier") });
  let monitor = await ProtectedNativeIntegrityMonitor.open({ expectedPolicy: fixture.expectedPolicy, verifier, integrity: peer.guard, store });
  cleanups.get(peer.root).push(() => monitor.close());
  const result = await monitor.poll(); assert.equal(result.state, "HARD_STOP_INTEGRITY"); assert.equal(result.affectedReserveAtomic, "9007199254740993");
  await monitor.close(); await f.restart();
  monitor = await ProtectedNativeIntegrityMonitor.open({ expectedPolicy: fixture.expectedPolicy, verifier, integrity: peer.guard, store: new WindowsProtectedStore(opts) });
  assert.equal((await monitor.poll()).state, "HARD_STOP_INTEGRITY"); assert.equal(f.authority.status().incidentCount, 1);
});

test("retained progress witness turns co-restored observation files into a durable global stop", async t => {
  // Actual protected files, profile witness and mutually authenticated guard;
  // progress bytes are synthetic and never treated as Native chain proof.
  const f = await integrityFixture(t), peer = await f.peer("NATIVE_OBSERVER"), signer = await f.peer("KINGPEPE_FROST_B");
  const { expectedPolicy, stored } = nativeProgressFixture(), opts = options(peer.root, "witness-progress", "NATIVE_OBSERVER", "chain-progress");
  const bytes = Buffer.from(JSON.stringify(stored)), store = WindowsProtectedStore.create(opts, bytes); bytes.fill(0);
  const files = [path.join(opts.root, "state.protected"), path.join(opts.anchorRoot, "state.protected")], old = files.map(p => readFileSync(p));
  const current = store.read(); store.write(current.payload, current.revision); current.payload.fill(0); store.close();
  files.forEach((p, i) => writeFileSync(p, old[i]));
  const verifier = new LocalNativeEvidenceVerifier({ rpc: {}, executable: path.join(peer.root, "unused-native-verifier") });
  await assert.rejects(ProtectedNativeIntegrityMonitor.open({ expectedPolicy, verifier, integrity: peer.guard, store: new WindowsProtectedStore(opts) }));
  assert.equal(f.authority.status().state, "HARD_STOP_INTEGRITY");
  await f.restart(); await assert.rejects(signer.guard.assertRunning(h("rolled-back-progress"), "FROST_SIGN"));
});
