// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TEST-ONLY current-principal supervisor actor. Synthetic source health here
// is not chain evidence, a runtime fallback or cross-service SID certification.
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { ProtectedIntegrityAuthority } from "../../services/supervisor/protected-integrity.mjs";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { SOURCE_HEALTH_ROLES } from "../../shared/source-health-window.mjs";

let authority, options, timer, input = Buffer.alloc(0), queued = 0, queue = Promise.resolve();
const hash = text => createHash("sha256").update(text).digest("hex");
const check = v => { if (!v) throw new Error("TEST_AUTHORITY_REJECTED"); };
function pulse() {
  for (const peerRole of SOURCE_HEALTH_ROLES) {
    const operationId = hash("synthetic-health-" + peerRole);
    const { check: ticket } = authority.handle({ peerRole, operationId, method: "beginSourceCheck", payload: {} });
    authority.handle({ peerRole, operationId, method: "finishSourceCheck", payload: { generation: ticket.generation,
      challenge: ticket.challenge, state: "OBSERVED_MATCH", evidenceDigest: hash("TEST_ONLY_SOURCE_FIXTURE") } });
  }
}
async function close() { clearInterval(timer); timer = undefined; await authority?.close(); }
async function execute(method, payload) {
  if (method === "INIT") {
    check(process.platform === "win32" && authority === undefined && payload?.context?.environment === "localnet");
    const root = path.dirname(path.resolve(payload.root));
    check(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-ipc-test-") && path.dirname(path.resolve(payload.anchorRoot)) === root);
    options = structuredClone(payload); authority = await ProtectedIntegrityAuthority.createLocal(options, "RUNNING"); return authority.status();
  }
  check(authority);
  if (method === "HANDLE") return authority.handle(payload);
  if (method === "STATUS") return authority.status();
  if (method === "WATCH_TEST_SOURCES") {
    check(timer === undefined); pulse(); timer = setInterval(() => { try { pulse(); } catch { clearInterval(timer); timer = undefined; } }, 10000); return true;
  }
  if (method === "REOPEN") { await close(); authority = await ProtectedIntegrityAuthority.openLocal(new WindowsProtectedStore(options)); return authority.status(); }
  if (method === "CLOSE") { await close(); return true; }
  throw new Error("TEST_AUTHORITY_REJECTED");
}
process.stdin.on("data", bytes => {
  if (input.length + bytes.length > 16384) { process.stdin.destroy(); void close().finally(() => { process.exitCode = 2; }); return; }
  input = Buffer.concat([input, bytes]);
  for (;;) {
    const end = input.indexOf(10); if (end < 0) break;
    const frame = input.subarray(0, end); input = input.subarray(end + 1);
    if (++queued > 8) { process.stdin.destroy(); void close().finally(() => { process.exitCode = 2; }); return; }
    queue = queue.then(async () => {
      let id;
      try {
        const request = JSON.parse(frame.toString("utf8")); check(Array.isArray(request) && request.length === 3);
        [id] = request; check(Number.isSafeInteger(id) && id > 0 && id <= 1000000);
        const result = await execute(request[1], request[2]); process.stdout.write(JSON.stringify([id, true, result]) + "\n");
      } catch { process.stdout.write(JSON.stringify([id ?? 0, false, "TEST_AUTHORITY_REJECTED"]) + "\n"); }
      finally { queued--; frame.fill(0); }
    });
  }
});
process.stdin.on("end", () => { void queue.finally(close).catch(() => { process.exitCode = 2; }); });
process.stdin.on("error", () => { void queue.finally(close).catch(() => { process.exitCode = 2; }); });
