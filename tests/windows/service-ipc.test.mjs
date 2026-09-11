// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import tls from "node:tls";
import path from "node:path";
import os from "node:os";
import { WindowsProtectedStore, windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc, encodeIpcEnrollment } from "../../shared/windows/service-ipc.mjs";
import { nativeFrostIpcHandler, ProtectedRemoteFrostPeer } from "../../native/frost/signer/protected-service.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { NativeFrostSigner, NativeFrostCoordinator, createNativeSigningPolicy, runTwoPartyDkg,
  FROST_SIGNING_INTENT_PROTOCOL, FROST_SIGNING_MODE, REQUIRED_FROST_SIGNERS } from "../../native/frost/index.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { schnorr } from "@noble/curves/secp256k1.js";

if (process.platform !== "win32") throw new Error("WINDOWS_IPC_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../.."), serviceSid = windowsCurrentServiceSid();
const h = v => createHash("sha256").update(v).digest("hex");
const deployment = h("protected-ipc-local-deployment"), protocol = "KINGPEPE_SERVICE_IPC_V1";
function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ipc-test-"));
  t.after(() => {
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
function fixture(t, role = "KINGPEPE_FROST_A") {
  const root = temporary(t), serverCert = certificate(root, "server"), clientCert = certificate(root, "client");
  const serverOptions = options(root, "server-state", role), clientOptions = options(root, "client-state", "COORDINATOR");
  const serverStore = enroll(serverOptions, serverCert, clientCert, "COORDINATOR"), clientStore = enroll(clientOptions, clientCert, serverCert, role);
  const server = new ProtectedServiceIpc(serverStore), client = new ProtectedServiceIpc(clientStore);
  t.after(() => { server.close(); client.close(); serverStore.close(); clientStore.close(); });
  return { root, role, server, client, serverStore, clientStore, serverOptions, clientOptions, serverCert, clientCert };
}
function request(overrides = {}) { return { method: "verifyNativeEvidence", operationId: h("operation"), payload: { bounded: true }, ...overrides }; }

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
      const value = [protocol, "REQUEST", hello[2], "localnet", "COORDINATOR", f.role, hello[6], hello[7], hello[8], h("raw-request"), h("operation"), "verifyNativeEvidence", Date.now() + 9000, {}];
      const changed = change(value), payload = Buffer.isBuffer(changed) ? changed : Buffer.from(JSON.stringify(changed));
      const header = Buffer.alloc(4); header.writeUInt32BE(payload.length); sent = true; s.write(Buffer.concat([header, payload]));
    });
  });
}
for (const [label, change] of [
  ["stale request", v => { v[12] = Date.now() - 1; return v; }],
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

test("actual protected A+B FROST signing through authenticated endpoints", async t => {
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
  const signers = f.map((v, i) => new NativeFrostSigner({ signerId: v.role, index: i, policy,
    stateStore: WindowsProtectedFrostStateStore.createLocal(options(v.root, "native-state", v.role, "frost-state"), policy),
    nativeEvidenceValidator: async value => ({ digestHex: value.proofFingerprint }) }));
  t.after(() => signers.forEach(s => s.close()));
  const dkg = runTwoPartyDkg(signers, { epoch: 1 });
  const ports = [];
  for (let i = 0; i < 2; i++) ports.push(await f[i].server.listen(nativeFrostIpcHandler(signers[i])));
  const peers = f.map((v, i) => new ProtectedRemoteFrostPeer({ ipc: v.client, port: ports[i], signerId: v.role }));
  const coordinator = new NativeFrostCoordinator({ signers: peers, publicPackage: dkg.publicPackage, aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey });
  const signed = await coordinator.signAutomaticallyOverIpc(intent);
  assert(schnorr.verify(Buffer.from(signed.signatureHex, "hex"), Buffer.from(intent.taprootSighashHex, "hex"), Buffer.from(dkg.aggregateTweakedXOnlyPublicKey, "hex")), "IpcFrostSignatureRejected");
  await assert.rejects(f[0].client.request(ports[0], { method: "verifyNativeEvidence", operationId: h("wrong-operation"), payload: intent }));
  await assert.rejects(coordinator.signAutomaticallyOverIpc({ ...intent, amountAtomic: "999" }));
});
