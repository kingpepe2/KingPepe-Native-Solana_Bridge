// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TEST ONLY: distinct process, same test principal. Synthetic Native evidence;
// real DPAPI, mTLS, journal and Ed25519. No production enrollment or fallback.
import { writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { ProjectAttester } from "../../services/attesters/attestation-service.mjs";
import { ProtectedAttesterAuthorizationJournal } from "../../services/attesters/authorization-journal.mjs";
import { attesterIpcHandler } from "../../services/attesters/protected-service.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";

let seedStore, journal, server, supervisor, attester, initialized = false, buffer = "", verifications = 0, signs = 0;
let handlerFailure = "NONE";
const requireValue = ok => { if (!ok) throw new Error("TEST_ATTESTER_ACTOR_REJECTED"); };
const send = value => writeSync(1, JSON.stringify(value) + "\n");
function boundStore(options) {
  requireValue(options?.context?.environment === "localnet");
  for (const leaf of [options.root]) {
    const root = path.dirname(path.resolve(leaf));
    requireValue(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-ipc-test-"));
  }
  return new WindowsProtectedStore(options);
}
function boundary(name, selected) {
  if (name !== selected) return;
  send(["BOUNDARY", name]);
  // The parent must terminate this OS process. No graceful close/finally runs.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
async function close() { server?.close(); supervisor?.close(); await journal?.close(); attester?.close(); seedStore?.close(); }
async function init(c) {
  requireValue(process.platform === "win32" && !initialized); initialized = true;
  requireValue(["NONE", "PREPARED", "SIGNATURE_CREATED", "SIGNED_PERSISTED", "RESULT_READY"].includes(c.boundary));
  seedStore = boundStore(c.seedOptions); attester = ProjectAttester.fromWindowsProtectedStore({ store: seedStore, role: c.role, policy: c.policy });
  supervisor = new ProtectedServiceIpc(boundStore(c.supervisorOptions));
  const integrity = new RemoteIntegrityGuard({ ipc: supervisor, port: c.supervisorPort }), store = boundStore(c.journalOptions);
  journal = await ProtectedAttesterAuthorizationJournal.open({ attester, integrity, store });
  const persist = store.write.bind(store); let writes = 0;
  store.write = (bytes, revision) => {
    writes++;
    if (writes === 2) boundary("SIGNATURE_CREATED", c.boundary);
    const result = persist(bytes, revision);
    if (writes === 1) boundary("PREPARED", c.boundary);
    if (writes === 2) boundary("SIGNED_PERSISTED", c.boundary);
    return result;
  };
  const sign = ProjectAttester.prototype.signDepositCredit;
  ProjectAttester.prototype.signDepositCredit = function(...args) { signs++; return sign.apply(this, args); };
  const decoded = decodeCanonicalBridgeMessage(c.encodedMessageHex);
  const handler = attesterIpcHandler({ attester, integrity, journal, verifyNativeDeposit: async request => {
    requireValue(request.encodedMessageHex === c.encodedMessageHex); verifications++;
    return { operationIdHex: decoded.operationIdHex, messageDigestHex: decoded.messageDigestHex, evidence: structuredClone(c.evidence) };
  } });
  server = new ProtectedServiceIpc(boundStore(c.serverOptions));
  const port = await server.listen(async input => {
    try { const result = await handler(input); boundary("RESULT_READY", c.boundary); return result; }
    catch (error) {
      const safe = ["AttesterJournalInvalid", "AttesterJournalPolicyRejected", "AttesterJournalAuthenticatedStateInvalid",
        "AttesterJournalConcurrentMutation", "IntegrityAuthorizationStopped", "IpcRequestRejected", "ProtectedProcessLeaseLost", "WindowsProtectedStoreRejected"];
      handlerFailure = safe.includes(error?.message) ? error.message : "UNCLASSIFIED"; throw error;
    }
  });
  send(["READY", port]);
}
let queue = Promise.resolve(), queued = 0;
process.stdin.on("data", bytes => {
  buffer += bytes.toString("utf8");
  if (buffer.length > 32768) { process.exitCode = 2; process.stdin.destroy(); void close(); return; }
  for (;;) {
    const at = buffer.indexOf("\n"); if (at < 0) break;
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    if (++queued > 4) { process.exitCode = 2; process.stdin.destroy(); void close(); return; }
    queue = queue.then(async () => {
      try {
        const v = JSON.parse(line); requireValue(Array.isArray(v) && v.length === 2);
        if (v[0] === "INIT") await init(v[1]);
        else if (v[0] === "STATS") send(["STATS", { verifications, signs }]);
        else if (v[0] === "DIAGNOSTICS") send(["DIAGNOSTICS", { handlerFailure, transportFailure: server?.lastRejection ?? "NONE" }]);
        else if (v[0] === "CLOSE") { await close(); send(["CLOSED", true]); }
        else throw new Error("TEST_ATTESTER_ACTOR_REJECTED");
      } catch { send(["ERROR", "TEST_ATTESTER_ACTOR_REJECTED"]); }
      finally { queued--; }
    });
  }
});
process.stdin.on("end", () => { void queue.finally(close); });
process.stdin.on("error", () => { void queue.finally(close); });
