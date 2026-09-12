// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Test-only child: kill AFTER actual validator acknowledgement. The receipt and
// claim use the real outbox; no simulated RPC result or released secret share.
import assert from "node:assert/strict";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { ProtectedSolanaDepositOutbox } from "../../services/relayer/protected-solana-deposit-outbox.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
let buffer = "", initialized = false, outbox, ipc;
process.stdin.on("data", async bytes => {
  buffer += bytes.toString("utf8");
  if (buffer.length > 40000 || initialized) { process.exitCode = 1; process.stdin.destroy(); return; }
  if (!buffer.endsWith("\n")) return; initialized = true;
  try {
    assert.equal(process.platform, "win32");
    const c = JSON.parse(buffer); buffer = "";
    assert.deepEqual(Object.keys(c).sort(), ["endpoint", "ipcOptions", "outboxOptions", "policy", "port"]);
    ipc = new ProtectedServiceIpc(new WindowsProtectedStore(c.ipcOptions));
    const guard = new RemoteIntegrityGuard({ ipc, port: c.port });
    const send = SolanaLocalRpcClient.prototype.sendTransaction;
    SolanaLocalRpcClient.prototype.sendTransaction = async function (...args) {
      await send.apply(this, args);
      process.stdout.write(JSON.stringify({ event: "ACTUAL_SOLANA_BROADCAST_ACCEPTED" }) + "\n");
      await new Promise(() => {}); // Disposable child is killed by its parent.
    };
    outbox = await ProtectedSolanaDepositOutbox.open({ policy: c.policy, integrity: guard, endpoint: c.endpoint,
      store: new WindowsProtectedStore(c.outboxOptions) });
    process.stdout.write(JSON.stringify({ event: "READY" }) + "\n");
    const result = await outbox.runOne();
    process.stdout.write(JSON.stringify({ event: "NO_BROADCAST", state: result.state }) + "\n");
    await outbox.close(); await ipc.close(); process.stdin.destroy();
  } catch {
    console.error("LOCAL_SOLANA_OUTBOX_ACTOR_FAILED"); process.exitCode = 1;
    try { await outbox?.close(); await ipc?.close(); } catch { /* Fixed failure only. */ }
    process.stdin.destroy();
  }
});
