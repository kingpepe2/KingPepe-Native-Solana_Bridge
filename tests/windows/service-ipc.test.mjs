// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
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
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { deploymentFixture } from "../integration/deployment-fixture.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { ProtectedNativeIntegrityMonitor, compareNativeProgress } from "../../native/node/native-integrity.mjs";
import { nativeProgressFixture } from "../integration/native-progress-fixture.mjs";

if (process.platform !== "win32") throw new Error("WINDOWS_IPC_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../.."), serviceSid = windowsCurrentServiceSid();
const h = v => createHash("sha256").update(v).digest("hex");
const deployment = h("protected-ipc-local-deployment"), protocol = "KINGPEPE_SERVICE_IPC_V2";
const cleanups = new Map();
function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ipc-test-"));
  cleanups.set(root, []);
  t.after(async () => {
    for (const fn of cleanups.get(root)) await fn();
    cleanups.delete(root);
    assert(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-ipc-test-"), "UnsafeTestCleanup");
    try { rmSync(root, { recursive: true }); } catch { throw new Error("IpcTestCleanupFailed"); }
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
function options(root, name, role, purpose = "service-auth") {
  return { root: path.join(root, name), anchorRoot: path.join(root, name + "-anchor"), repoRoot,
    context: { role, purpose, serviceSid, environment: "localnet", nativeGenesis: REGTEST_GENESIS,
      solanaDeployment: deployment, instanceId: h(name), keyEpoch: 1 } };
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
  t.after(() => { server.close(); client.close(); serverStore.close(); clientStore.close(); });
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

test("actual protected A+B FROST signing through authenticated endpoints", async t => {
  const global = await integrityFixture(t);
  const guards = await Promise.all(REQUIRED_FROST_SIGNERS.map(role => global.peer(role)));
  const coordinatorGuard = (await global.peer("COORDINATOR")).guard;
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
  const signers = [], verificationCounts = [0, 0];
  for (const [i, v] of f.entries()) {
    const base = WindowsProtectedFrostStateStore.createLocal(options(v.root, "native-state", v.role, "frost-state"), policy);
    const fenceOptions = options(v.root, "native-fence", v.role, "signer-fence"); fenceOptions.context.instanceId = base.context.instanceId;
    const stateStore = await WindowsFencedFrostStateStore.createLocal({ base, fenceOptions, policy });
    cleanups.get(v.root).push(() => stateStore.close());
    signers.push(new NativeFrostSigner({ signerId: v.role, index: i, policy, stateStore,
      nativeEvidenceValidator: async value => { verificationCounts[i]++; return { digestHex: value.proofFingerprint }; } }));
  }
  t.after(() => signers.forEach(s => s.close()));
  const dkg = runTwoPartyDkg(signers, { epoch: 1 });
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
  const coordinator = new NativeFrostCoordinator({ signers: peers, publicPackage: dkg.publicPackage, aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey, integrity: coordinatorGuard });
  let signed;
  try { signed = await coordinator.signAutomaticallyOverIpc(intent); }
  catch { throw new Error("ProtectedFrostIpcFailure:" + f.map(v => v.server.lastRejection ?? "UNREPORTED").join(",") + ":" + handlerFaults.join(",")); }
  assert(schnorr.verify(Buffer.from(signed.signatureHex, "hex"), Buffer.from(intent.taprootSighashHex, "hex"), Buffer.from(dkg.aggregateTweakedXOnlyPublicKey, "hex")), "IpcFrostSignatureRejected");
  assert(verificationCounts.every(count => count >= 3), "FreshEvidenceRequiredAtEverySigningBoundary");
  await assert.rejects(f[0].client.request(ports[0], { method: "verifyNativeEvidence", operationId: h("wrong-operation"), payload: intent }));
  await assert.rejects(coordinator.signAutomaticallyOverIpc({ ...intent, amountAtomic: "999" }));
  assert.equal(global.authority.status().state, "RUNNING", "UncertaintyIsNotConfirmedContradiction");
  await guards[0].guard.report(intent.operationId, "SIGNER_ROLLBACK", h("confirmed-test-rollback"));
  await global.restart();
  await assert.rejects(f[0].client.request(ports[0], { method: "signingCommitment", operationId: intent.operationId, payload: { request: createNativeFrostSigningRequest(intent) } }));
  const restartedCoordinator = new NativeFrostCoordinator({ signers: peers, publicPackage: dkg.publicPackage,
    aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey, integrity: coordinatorGuard });
  await assert.rejects(restartedCoordinator.signAutomaticallyOverIpc(intent));
  assert.equal((await guards[1].guard.status(intent.operationId)).state, "HARD_STOP_INTEGRITY");
});

test("durable global stop propagates to every service role and survives authority/client restart", async t => {
  const f = await integrityFixture(t), peers = [];
  for (const role of INTEGRITY_ROLES) peers.push(await f.peer(role));
  for (const p of peers) assert.equal((await p.guard.status(h("status"))).state, "RUNNING");
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
    assert.equal(f.authority.status().state, "RUNNING");
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

for (const role of ["ATTESTER_A", "ATTESTER_B"]) test("real protected attester TLS is gated by durable integrity state: " + role, async t => {
  const global = await integrityFixture(t), guard = (await global.peer(role)).guard;
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
  const attester = ProjectAttester.fromWindowsProtectedStore({ store, role, policy }); t.after(() => { attester.close(); store.close(); });
  let verifications = 0;
  const evidence = { trust: "LOCALLY_VALIDATED_CHAIN_STATE", nativeNetwork: identity.nativeNetwork, nativeGenesisHash: identity.nativeGenesis,
    operationIdHex: decoded.operationIdHex, depositOutpoint: decoded.depositOutpointText, amountAtomic: decoded.amountAtomic.toString(),
    solanaRecipientHex: decoded.destinationHex, evidenceDigestHex: decoded.evidenceDigestHex, reserveAllocationIdHex: h("attester-test-allocation"),
    reserveTransitionState: "CANONICAL_RESERVE", mintCreditState: "AUTHORIZED_UNCONSUMED", finalitySatisfied: true, sweepFinalized: true,
    utxoUnspentAtDeposit: true, noPriorConsumption: true };
  // Policy/evidence fixture, not a chain-validation claim. TLS/DPAPI/signature/stop are real.
  const handler = attesterIpcHandler({ attester, integrity: guard, verifyNativeDeposit: async () => {
    verifications++; return { operationIdHex: decoded.operationIdHex, messageDigestHex: decoded.messageDigestHex, evidence };
  } });
  const port = await f.server.listen(handler), input = { method: "attestDeposit", operationId: decoded.operationIdHex,
    payload: { encodedMessageHex: encoded, rawEvidence: {} } };
  const signed = await f.client.request(port, input); assert(verifyProjectAttestation(signed, encoded)); assert.equal(verifications, 1);
  await guard.report(decoded.operationIdHex, "CONFLICTING_RESERVE_EVIDENCE", h("contradiction"));
  await global.restart(); await assert.rejects(f.client.request(port, input)); assert.equal(verifications, 1);
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
  assert.equal(f.authority.status().state, "RUNNING"); unavailable = false;
  response = { ...snapshot, slot: 9 }; assert.equal((await monitor.poll()).state, "WAITING_FOR_DEPENDENCY");
  assert.equal(f.authority.status().state, "RUNNING");
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
  assert.equal((await monitor.poll()).state, "WAITING_FOR_DEPENDENCY"); assert.equal(f.authority.status().state, "RUNNING");
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
