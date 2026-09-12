// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit disposable CURRENT-PRINCIPAL integration fixture, not a service
// installer, production ceremony or evidence of distinct Windows identities.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { WindowsProtectedStore, windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc, encodeIpcEnrollment } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";

export async function createLocalSecurityFixture({ repoRoot, policy }) {
  assert.equal(process.platform, "win32"); assert.equal(policy.environment, "localnet"); assert.equal(policy.nativeGenesis, REGTEST_GENESIS);
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ipc-test-"));
  validateRuntimeStateRoot(root, repoRoot);
  const sid = windowsCurrentServiceSid(), closers = [], ids = new Set();
  function options(name, role, purpose, instanceId = randomBytes(32).toString("hex")) {
    assert.match(name, /^[a-z0-9-]{1,60}$/u); assert(!ids.has(name)); ids.add(name);
    assert.match(instanceId, /^[0-9a-f]{64}$/u);
    const value = { root: path.join(root, name), repoRoot,
      context: { role, purpose, serviceSid: sid, environment: "localnet", nativeGenesis: policy.nativeGenesis,
        solanaDeployment: policy.solanaDeployment, keyEpoch: policy.keyEpoch, instanceId } };
    return value;
  }
  function store(opts, payload) {
    try { const value = WindowsProtectedStore.create(opts, payload); closers.push(() => value.close()); return value; }
    finally { payload.fill(0); }
  }
  function certificate(name) {
    const key = path.join(root, name + ".key"), cert = path.join(root, name + ".crt");
    const result = spawnSync(process.env.KINGPEPE_TEST_OPENSSL ?? "openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-nodes", "-days", "1", "-subj", "/CN=kingpepe-service.invalid", "-addext", "subjectAltName=DNS:kingpepe-service.invalid",
      "-keyout", key, "-out", cert], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, "AuthoritativeTestOpenSslRequired");
    const privateKeyPem = readFileSync(key, "utf8"), certificatePem = readFileSync(cert, "utf8");
    unlinkSync(key); return { privateKeyPem, certificatePem };
  }
  let connection = 0; const transports = [], supervisorEndpoints = [];
  async function pair(serverRole, clientRole, handler, deferred = false) {
    const n = ++connection, serverCert = certificate("server-" + n), clientCert = certificate("client-" + n);
    const serverOptions = options("server-" + n, serverRole, "service-auth");
    const clientOptions = options("client-" + n, clientRole, "service-auth");
    const serverStore = store(serverOptions,
      encodeIpcEnrollment({ ...serverCert, peerCertificatePem: clientCert.certificatePem, peerRole: clientRole }));
    const clientStore = store(clientOptions,
      encodeIpcEnrollment({ ...clientCert, peerCertificatePem: serverCert.certificatePem, peerRole: serverRole }));
    if (deferred) {
      assert.notEqual(serverRole, "SUPERVISOR"); serverStore.close(); clientStore.close();
      return { serverOptions, clientOptions };
    }
    const client = new ProtectedServiceIpc(clientStore);
    if (serverRole === "SUPERVISOR") {
      serverStore.close();
      const port = await authority.listen(serverOptions);
      supervisorEndpoints.push({ serverOptions, port });
      transports.push({ serverRole, clientRole, client }); closers.push(() => client.close());
      return { client, port, clientOptions };
    }
    const server = new ProtectedServiceIpc(serverStore);
    transports.push({ serverRole, clientRole, server, client });
    closers.push(() => server.close(), () => client.close());
    return { server, client, port: await server.listen(handler), clientOptions };
  }
  const authorityOptions = options("authority", "SUPERVISOR", "global-integrity");
  let authority;
  try { authority = await actualTestAuthority(authorityOptions); }
  catch { await close(); throw new Error("LocalSecurityFixtureUnavailable"); }
  closers.push(() => authority.close());
  async function close() {
    let failed = false;
    for (const fn of [...closers].reverse()) { try { await fn(); } catch { failed = true; } }
    assert(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-ipc-test-"));
    validateRuntimeStateRoot(root, repoRoot);
    try { rmSync(root, { recursive: true }); } catch { failed = true; }
    if (failed) throw new Error("LocalSecurityFixtureCleanupFailed");
  }
  return {
    root, options, store, pair, deferredPair: (serverRole, clientRole) => pair(serverRole, clientRole, undefined, true),
    close, onClose(fn) { closers.push(fn); }, get authority() { return authority; },
    async diagnostics() { return [...await authority.diagnostics(), ...transports.map(v => ({ serverRole: v.serverRole, clientRole: v.clientRole,
      server: v.server?.lastRejection ?? "NONE", client: v.client.lastRejection ?? "NONE" }))]; },
    async restartAuthority() { await authority.reopen(); },
    async restartAuthorityProcess() {
      // TEST lifecycle only: reopen the EXISTING protected authority, never
      // re-enroll policy or recreate RUNNING state after an integrity incident.
      await authority.close(); authority = await actualTestAuthority(authorityOptions, true);
      const ports = new Map();
      for (const endpoint of supervisorEndpoints) {
        const old = endpoint.port; endpoint.port = await authority.listen(endpoint.serverOptions); ports.set(old, endpoint.port);
      }
      return ports;
    },
    async guard(role) { const p = await pair("SUPERVISOR", role); return new RemoteIntegrityGuard({ ipc: p.client, port: p.port }); },
  };
}

// Real independent process for the authority, so synchronous Windows protection
// in an observer cannot starve its network/health clock or TLS listeners. This
// actor has no synthetic health command. Reports must come from actual peers.
async function actualTestAuthority(options, reopen = false) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "local-integrity-host.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let sequence = 0, buffer = "", failed = false, closed = false;
  const pending = new Map(), ended = new Promise(resolve => child.once("close", resolve));
  const fail = () => { failed = true; for (const item of pending.values()) {
    clearTimeout(item.timer); item.reject(new Error("LocalAuthorityUnavailable"));
  } pending.clear(); };
  child.on("error", fail); child.on("close", fail); child.stdin.on("error", fail); child.stderr.on("data", fail);
  child.stdout.on("data", bytes => {
    buffer += bytes.toString("utf8"); if (buffer.length > 16384) { fail(); child.kill(); return; }
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line); assert(Array.isArray(value) && value.length === 3);
        const [id, ok, result] = value, item = pending.get(id); assert(item);
        clearTimeout(item.timer); pending.delete(id);
        if (ok === true) item.resolve(result); else item.reject(new Error("LocalAuthorityRejected"));
      } catch { fail(); child.kill(); }
    }
  });
  const call = (method, payload = {}) => new Promise((resolve, reject) => {
    assert(["INIT", "OPEN", "LISTEN", "DIAGNOSTICS", "STATUS", "REOPEN", "CLOSE"].includes(method));
    if (failed || closed || pending.size >= 8) { reject(new Error("LocalAuthorityUnavailable")); return; }
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error("LocalAuthorityTimeout")); }, 15000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify([id, method, payload]) + "\n");
  });
  const close = async () => {
    if (closed) return;
    try { await call("CLOSE"); }
    finally { closed = true; child.stdin.end(); const timer = setTimeout(() => child.kill(), 10000);
      try { await ended; } finally { clearTimeout(timer); } }
  };
  try { await call(reopen ? "OPEN" : "INIT", options); }
  catch { await close(); throw new Error("LocalAuthorityUnavailable"); }
  return { status: () => call("STATUS"), listen: value => call("LISTEN", value),
    diagnostics: () => call("DIAGNOSTICS"), reopen: () => call("REOPEN"), close };
}

export async function startActualLocalMonitor(configuration) {
  assert(["NATIVE_OBSERVER", "SOLANA_OBSERVER", "RECONCILIATION"].includes(configuration.role));
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "local-monitor-actor.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", latest, failed = false, closed = false, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const ended = new Promise(resolve => child.once("close", resolve));
  const fail = () => { failed = true; readyReject(new Error("ActualLocalMonitorUnavailable")); };
  child.on("error", fail); child.stdin.on("error", fail); child.stderr.on("data", fail);
  child.on("close", () => { if (!closed) fail(); });
  child.stdout.on("data", bytes => {
    buffer += bytes.toString("utf8"); if (buffer.length > 16384) { fail(); child.kill(); return; }
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line); assert(["READY", "OBSERVATION", "CLOSED", "FAILED"].includes(value.event));
        if (value.event === "FAILED") fail();
        else if (value.event === "READY") { assert.equal(value.role, configuration.role); readyResolve(); }
        else if (value.event === "OBSERVATION") {
          assert.equal(value.role, configuration.role); assert.match(value.state, /^[A-Z_]{1,80}$/u);
          assert.match(value.reason, /^[A-Z_]{1,80}$/u); latest = value;
        }
      } catch { fail(); child.kill(); }
    }
  });
  const close = async () => {
    if (closed) return; closed = true;
    if (!child.stdin.destroyed) child.stdin.end(JSON.stringify(["STOP", {}]) + "\n");
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
    try { const code = await ended; assert.equal(code, 0, "ActualLocalMonitorFailed"); assert(!timedOut, "ActualLocalMonitorStopTimeout"); }
    finally { clearTimeout(timer); }
  };
  const timer = setTimeout(() => readyReject(new Error("ActualLocalMonitorStartTimeout")), 60000);
  try { child.stdin.write(JSON.stringify(["INIT", configuration]) + "\n"); await ready; }
  catch (error) { try { await close(); } catch { /* Original fixed failure retained. */ } throw error; }
  finally { clearTimeout(timer); }
  return { get latest() { return latest; }, get failed() { return failed; }, close };
}
