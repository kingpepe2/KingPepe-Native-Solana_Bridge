// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Disposable CURRENT-PRINCIPAL real-chain observer process. The inherited test
// control pipe carries configuration references only, never service credentials.
// Healthy reports use actual role-pinned mTLS and actual chain observations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier, REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { ProtectedNativeIntegrityMonitor } from "../../native/node/native-integrity.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { ProtectedDepositSnapshotClient } from "../../services/bridge-validator/protected-deposit-snapshot.mjs";
import { ProtectedDepositReconciliationMonitor } from "../../services/reconciliation/protected-deposit-reconciliation.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";

let monitor, ipc, journalIpc, controller, running, ready = false, input = "", closing = false, requestCount = 0;
const safe = value => typeof value === "string" && /^[A-Z_]{1,80}$/u.test(value) ? value : "NONE";
function send(value) { process.stdout.write(JSON.stringify(value) + "\n"); }
function options(value, role, purpose) {
  assert.equal(value.context.role, role); assert.equal(value.context.purpose, purpose);
  assert.equal(value.context.environment, "localnet"); assert.equal(value.context.nativeGenesis, REGTEST_GENESIS);
  const root = path.dirname(path.resolve(value.root));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-ipc-test-"));
  return value;
}
async function start(p) {
  assert.equal(process.platform, "win32"); assert(!ready && !monitor && !closing);
  assert(["NATIVE_OBSERVER", "SOLANA_OBSERVER", "RECONCILIATION"].includes(p.role));
  assert(Number.isInteger(p.port) && p.port > 0 && p.port <= 65535);
  ipc = new ProtectedServiceIpc(new WindowsProtectedStore(options(p.ipcOptions, p.role, "service-auth")));
  const integrity = new RemoteIntegrityGuard({ ipc, port: p.port });
  const store = new WindowsProtectedStore(options(p.progressOptions, p.role, p.role === "RECONCILIATION" ? "reconciliation-progress" : "chain-progress"));
  if (p.role === "NATIVE_OBSERVER" || p.role === "RECONCILIATION") {
    assert.equal(p.policy.nativeGenesis, REGTEST_GENESIS);
    const exe = validateRuntimeFile(p.executable, p.progressOptions.repoRoot);
    assert.match(p.executableSha256, /^[0-9a-f]{64}$/u);
    assert.equal(createHash("sha256").update(readFileSync(exe)).digest("hex"), p.executableSha256);
    const verifier = new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient(p.rpcOptions), executable: exe });
    assert.equal((await verifier.observeChain()).genesis, REGTEST_GENESIS);
    if (p.role === "NATIVE_OBSERVER") monitor = await ProtectedNativeIntegrityMonitor.open({ store, expectedPolicy: p.policy, verifier, integrity });
    else {
      journalIpc = new ProtectedServiceIpc(new WindowsProtectedStore(options(p.journalIpcOptions, "RECONCILIATION", "service-auth")));
      const journalClient = new ProtectedDepositSnapshotClient({ ipc: journalIpc, port: p.journalPort, policy: p.policy });
      const solanaRpc = new LocalDeploymentRpc(p.solanaRpcOptions);
      assert.equal(await solanaRpc.genesis(), p.policy.solanaGenesis);
      monitor = await ProtectedDepositReconciliationMonitor.open({ store, policy: p.policy, manifest: p.manifest,
        journalClient, nativeVerifier: verifier, solanaRpc, integrity });
    }
  } else {
    const rpc = new LocalDeploymentRpc(p.rpcOptions);
    assert.equal(await rpc.genesis(), p.manifest.solanaGenesis);
    monitor = await ProtectedSolanaDeploymentMonitor.open({ store, manifest: p.manifest, rpc, integrity });
  }
  ready = true; controller = new AbortController(); send({ event: "READY", role: p.role });
  running = monitor.run({ signal: controller.signal, intervalMs: 1000, onStatus(result) {
    send({ event: "OBSERVATION", role: p.role, state: safe(result.state), reason: safe(result.reason),
      transport: ipc.lastRejection ?? "NONE" });
  } }).catch(() => { send({ event: "FAILED", role: p.role }); process.exitCode = 1; });
}
async function close() {
  if (closing) return; closing = true; controller?.abort(); await running;
  await monitor?.close(); ipc?.close(); journalIpc?.close(); send({ event: "CLOSED" });
}
let queue = Promise.resolve();
process.stdin.on("data", bytes => {
  input += bytes.toString("utf8");
  if (input.length > 32768) { process.stdin.destroy(); void close(); process.exitCode = 1; return; }
  for (;;) {
    const end = input.indexOf("\n"); if (end < 0) break;
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (++requestCount > 2) { process.stdin.destroy(); void close(); process.exitCode = 1; return; }
    queue = queue.then(async () => {
      const value = JSON.parse(line); assert(Array.isArray(value) && value.length === 2);
      if (value[0] === "INIT") await start(value[1]);
      else { assert.equal(value[0], "STOP"); assert.deepEqual(value[1], {}); await close(); }
    }).catch(async () => { process.exitCode = 1; send({ event: "FAILED" }); await close(); });
  }
});
process.stdin.on("end", () => { void queue.finally(close); });
process.stdin.on("error", () => { void queue.finally(close); });
