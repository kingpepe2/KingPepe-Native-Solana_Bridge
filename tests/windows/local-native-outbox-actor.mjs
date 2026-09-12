// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Isolated test actor. The parent kills only this child after an ACTUAL node
// acknowledgement, before the protected delivery journal records that outcome.
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { ProtectedNativeSweepOutbox } from "../../services/relayer/native-sweep-outbox.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
let buffer = "", initialized = false, outbox, ipc;
process.stdin.on("data", async bytes => {
  buffer += bytes.toString("utf8");
  if (buffer.length > 32000 || initialized) { process.exitCode = 1; process.stdin.destroy(); return; }
  if (!buffer.endsWith("\n")) return;
  initialized = true;
  try {
    assert.equal(process.platform, "win32");
    const c = JSON.parse(buffer), repoRoot = path.resolve(import.meta.dirname, "../.."); buffer = "";
    assert.deepEqual(Object.keys(c).sort(), ["executable", "executableSha256", "ipcOptions", "outboxOptions", "policy", "port", "rpcOptions"]);
    const executable = validateRuntimeFile(c.executable, repoRoot);
    assert.equal(createHash("sha256").update(readFileSync(executable)).digest("hex"), c.executableSha256);
    ipc = new ProtectedServiceIpc(new WindowsProtectedStore(c.ipcOptions));
    const guard = new RemoteIntegrityGuard({ ipc, port: c.port }), rpc = new NativeRpcClient(c.rpcOptions);
    const verifier = new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient(c.rpcOptions), executable });
    outbox = await ProtectedNativeSweepOutbox.open({ policy: c.policy, integrity: guard,
      store: new WindowsProtectedStore(c.outboxOptions), rpc, nativeVerifier: verifier });
    const send = rpc.sendRawTransaction.bind(rpc);
    rpc.sendRawTransaction = async raw => {
      await send(raw); // Never announce this boundary without actual acceptance.
      process.stdout.write(JSON.stringify({ event: "ACTUAL_NATIVE_BROADCAST_ACCEPTED" }) + "\n");
      await new Promise(() => {}); // Parent owns/kills this disposable process.
    };
    process.stdout.write(JSON.stringify({ event: "READY" }) + "\n");
    const result = await outbox.runOne();
    process.stdout.write(JSON.stringify({ event: "NO_BROADCAST", state: result.state }) + "\n");
    await outbox.close(); await ipc.close(); process.stdin.destroy();
  } catch {
    console.error("LOCAL_NATIVE_OUTBOX_ACTOR_FAILED"); process.exitCode = 1;
    try { await outbox?.close(); await ipc?.close(); } catch { /* Fixed failure only. */ }
    process.stdin.destroy();
  }
});
