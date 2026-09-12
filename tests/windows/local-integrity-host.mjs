// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Test-only actual authority and TLS endpoints in one independent process.
// NO synthetic source health, production enrollment or plaintext credential IPC.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { ProtectedIntegrityAuthority } from "../../services/supervisor/protected-integrity.mjs";

let authority, options, input = "", queue = Promise.resolve(), queued = 0, closed = false;
const endpoints = [], handlerDiagnostics = new Map();
function approved(value, purpose) {
  assert.equal(value.context.role, "SUPERVISOR"); assert.equal(value.context.purpose, purpose);
  assert.equal(value.context.environment, "localnet");
  const root = path.dirname(path.resolve(value.root));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-ipc-test-"));
  return value;
}
async function close() {
  if (closed) return; closed = true;
  for (const endpoint of endpoints) endpoint.close(); await authority?.close();
}
async function execute(method, payload) {
  assert(!closed);
  if (method === "INIT" || method === "OPEN") {
    assert.equal(process.platform, "win32"); assert(!authority); options = approved(payload, "global-integrity");
    authority = method === "INIT" ? await ProtectedIntegrityAuthority.createLocal(options, "RUNNING") :
      await ProtectedIntegrityAuthority.openLocal(new WindowsProtectedStore(options)); return authority.status();
  }
  assert(authority);
  if (method === "STATUS") return authority.status();
  if (method === "LISTEN") {
    assert(endpoints.length < 12);
    const ipc = new ProtectedServiceIpc(new WindowsProtectedStore(approved(payload, "service-auth")));
    endpoints.push(ipc); return ipc.listen(value => {
      try { return authority.handle(value); }
      catch (error) {
        const codes = ["SourceHealthExpired", "SourceHealthChallengeRejected", "IntegrityAuthorizationStopped", "IntegrityClockRollback"];
        handlerDiagnostics.set(ipc, codes.includes(error?.message) ? error.message : "LOCAL_AUTHORITY_REJECTED"); throw error;
      }
    });
  }
  if (method === "DIAGNOSTICS") return endpoints.map(ipc => ({ serverRole: ipc.role, clientRole: ipc.peerRole,
    server: ipc.lastRejection ?? "NONE", handler: handlerDiagnostics.get(ipc) ?? "NONE" }));
  if (method === "REOPEN") { await authority.close(); authority = await ProtectedIntegrityAuthority.openLocal(new WindowsProtectedStore(options)); return authority.status(); }
  assert.equal(method, "CLOSE"); await close(); return true;
}
process.stdin.on("data", bytes => {
  input += bytes.toString("utf8");
  if (input.length > 16384) { process.stdin.destroy(); void close(); process.exitCode = 1; return; }
  for (;;) {
    const at = input.indexOf("\n"); if (at < 0) break;
    const line = input.slice(0, at); input = input.slice(at + 1);
    if (++queued > 8) { process.stdin.destroy(); void close(); process.exitCode = 1; return; }
    queue = queue.then(async () => {
      let id;
      try {
        const value = JSON.parse(line); assert(Array.isArray(value) && value.length === 3);
        [id] = value; assert(Number.isSafeInteger(id) && id > 0 && id <= 1000000);
        const result = await execute(value[1], value[2]); process.stdout.write(JSON.stringify([id, true, result]) + "\n");
      } catch { process.stdout.write(JSON.stringify([id ?? 0, false, "LOCAL_AUTHORITY_REJECTED"]) + "\n"); }
      finally { queued--; }
    });
  }
});
process.stdin.on("end", () => { void queue.finally(close); });
process.stdin.on("error", () => { void queue.finally(close); });
