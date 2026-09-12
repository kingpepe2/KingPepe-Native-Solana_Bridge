// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual CurrentUser DPAPI, lifetime fence, supervisor IPC and service process.
// Synthetic plan only: startup must fail before any Native chain request.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { createLocalSecurityFixture } from "./local-security-fixture.mjs";
import { depositOperationFixture } from "../integration/deposit-operation-fixture.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { createLocalNativeDkgPolicy } from "../../native/frost/index.mjs";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { WindowsFencedFrostStateStore } from "../../native/frost/state/windows-fenced-state-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";

if (process.platform !== "win32") throw new Error("WINDOWS_SIGNER_STARTUP_TEST_REQUIRES_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../.."), h = s => createHash("sha256").update(s).digest("hex");
async function startRejected(configuration) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "local-deposit-service-actor.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const events = []; let buffer = "", rejected = false;
  child.on("error", () => { rejected = true; });
  child.stderr.on("data", () => { rejected = true; });
  child.stdout.on("data", bytes => {
    buffer += bytes.toString("utf8");
    if (buffer.length > 16384) { rejected = true; child.kill(); return; }
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      try { events.push(JSON.parse(buffer.slice(0, at))); } catch { rejected = true; }
      buffer = buffer.slice(at + 1);
    }
  });
  const finished = new Promise(resolve => child.once("close", resolve));
  const timer = setTimeout(() => { rejected = true; child.kill(); }, 45000);
  child.stdin.on("error", () => { rejected = true; });
  child.stdin.end(JSON.stringify(["INIT", configuration]) + "\n");
  try {
    assert.equal(await finished, 1, "RestoredSignerMustRejectStartup");
    assert(!rejected, "StartupTestTransportFailed");
    assert(events.some(v => v.event === "FAILED"), "StartupFailureNotReported");
    assert(!events.some(v => v.event === "READY"), "UnsafeSignerBecameReady");
    return events.filter(v => v.event === "FAILED").map(v => /^[A-Za-z0-9_: -]{1,100}$/u.test(v.reason) ? v.reason : "REDACTED").join(",");
  } finally { clearTimeout(timer); }
}

for (const role of ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"])
for (const mode of ["RESTORED_STATE", "RESTORED_FENCE", "RESTORED_STATE_REPORT_UNAVAILABLE", "AUTHENTICATED_MALFORMED_STATE", "AUTHENTICATED_NONCE_CONTRADICTION", "UNAVAILABLE_STATE", "DUPLICATE_INSTANCE"])
test("actual signer startup " + role + " / " + mode, async t => {
  const initial = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: h("startup-local-deployment"), keyEpoch: 1 };
  const f = await createLocalSecurityFixture({ repoRoot, policy: initial }); t.after(() => f.close());
  const operation = await depositOperationFixture({ root: path.join(f.root, "synthetic-plan"), repoRoot, solanaDeployment: initial.solanaDeployment });
  const p = operation.policy, mustStop = !["UNAVAILABLE_STATE", "DUPLICATE_INSTANCE"].includes(mode);
  const dkgPolicy = createLocalNativeDkgPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: p.nativeGenesis,
    solanaDeployment: p.solanaDeployment, bridgeProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint, keyEpoch: p.keyEpoch });
  const stateOptions = f.options("startup-state", role, "frost-state"), fenceOptions = f.options("startup-fence", role, "signer-fence", stateOptions.context.instanceId);
  const base = WindowsProtectedFrostStateStore.createLocal(stateOptions, dkgPolicy);
  const state = await WindowsFencedFrostStateStore.createLocal({ base, fenceOptions, policy: dkgPolicy });
  f.onClose(() => state.close());
  const selected = mode === "RESTORED_FENCE" ? fenceOptions : stateOptions;
  const files = [selected.root, selected.anchorRoot].map(root => path.join(root, "state.protected"));
  const prior = files.map(file => readFileSync(file));
  const live = state.load();
  if (mode === "AUTHENTICATED_NONCE_CONTRADICTION") live.signing = { invalid: {} };
  state.save(live);
  if (mode !== "DUPLICATE_INSTANCE") await state.close();
  if (mode.startsWith("RESTORED_")) {
    files.forEach((file, i) => writeFileSync(file, prior[i]));
    const verify = new WindowsProtectedStore(selected);
    try { assert.throws(() => verify.read(), { message: "ProtectedStateRollbackDetected" }); } finally { verify.close(); }
  } else if (mode === "AUTHENTICATED_MALFORMED_STATE") {
    const value = new WindowsProtectedStore(stateOptions), current = value.read();
    try { value.write(Buffer.from("{"), current.revision); } finally { current.payload.fill(0); value.close(); }
  } else if (mode === "UNAVAILABLE_STATE") unlinkSync(path.join(stateOptions.root, "state.protected"));
  prior.forEach(bytes => bytes.fill(0));
  const supervisor = await f.pair("SUPERVISOR", role); supervisor.client.close();
  const endpoint = await f.deferredPair(role, "COORDINATOR");
  let chainCalls = 0;
  const rpc = createServer((request, response) => { chainCalls++; request.resume(); response.writeHead(503); response.end(); });
  await new Promise(resolve => rpc.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => rpc.close(resolve)));
  let supervisorPort = supervisor.port;
  if (mode === "RESTORED_STATE_REPORT_UNAVAILABLE") {
    const unavailable = createServer();
    await new Promise(resolve => unavailable.listen(0, "127.0.0.1", resolve));
    supervisorPort = unavailable.address().port;
    await new Promise(resolve => unavailable.close(resolve));
  }
  assert.notEqual((await f.authority.status()).state, "HARD_STOP_INTEGRITY");
  const startupReason = await startRejected({ role, policy: p, operationPlan: operation.plan, stateOptions, fenceOptions,
    supervisorOptions: supervisor.clientOptions, supervisorPort, serverOptions: endpoint.serverOptions,
    executable: process.env.KINGPEPE_TEST_NATIVE_VERIFIER, executableSha256: process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256,
    rpcOptions: { endpoint: "http://127.0.0.1:" + rpc.address().port, repoRoot } });
  assert.equal(chainCalls, 0, "StartupMustNotInventOrRequestChainEvidence");
  assert.equal(startupReason, "ProtectedSignerStartupRejected", "UnexpectedStartupFailureBoundary");
  if (mode === "RESTORED_STATE_REPORT_UNAVAILABLE") {
    assert.equal((await f.authority.status()).state, "PAUSED_POLICY", "UnavailableReportMustNotFakeAcknowledgement");
    // A NEW process/transport lifetime reads the existing protected incident
    // outbox. No synthetic report or replacement authentication state is supplied.
    const ipc = new ProtectedServiceIpc(new WindowsProtectedStore(supervisor.clientOptions));
    try {
      const guard = new RemoteIntegrityGuard({ ipc, port: supervisor.port });
      assert.equal((await guard.status(h("startup-redelivery-probe"))).state, "HARD_STOP_INTEGRITY");
    } finally { ipc.close(); }
  }
  const expected = mustStop ? "HARD_STOP_INTEGRITY" : "PAUSED_POLICY";
  assert.equal((await f.authority.status()).state, expected, "SignerStartupIncidentClassification:" + mode);
  await f.restartAuthorityProcess();
  assert.equal((await f.authority.status()).state, expected, "RestartMustNotChangeStartupIncident");
});
