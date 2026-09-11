// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TEST ONLY: independent coordinator process under the current test principal.
// Actual protected journal, mTLS and threshold signing; synthetic chain evidence.
import { writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { ProtectedRemoteFrostPeer } from "../../native/frost/signer/protected-service.mjs";
import { NativeFrostCoordinator } from "../../native/frost/coordinator/native-frost-coordinator.mjs";
import { ProtectedCoordinatorSigningJournal } from "../../native/frost/coordinator/protected-signing-journal.mjs";

let buffer = "", initialized = false, journal, supervisor, coordinator, intent;
let lastCall = "INIT", lastTransport = "NONE";
const channels = [], counts = { commitments: 0, shares: 0, aborts: 0 };
const send = value => writeSync(1, JSON.stringify(value) + "\n");
function check(ok) { if (!ok) throw new Error("TestCoordinatorActorRejected"); }
function store(options) {
  check(process.platform === "win32" && options?.context?.environment === "localnet");
  for (const leaf of [options.root, options.anchorRoot]) {
    const root = path.dirname(path.resolve(leaf));
    check(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-ipc-test-"));
  }
  return new WindowsProtectedStore(options);
}
function boundary(name, selected) {
  if (name !== selected) return;
  send(["BOUNDARY", name]);
  // Parent kills this actual OS process; no graceful shutdown/finally.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
async function close() { for (const ipc of channels) ipc.close(); supervisor?.close(); await journal?.close(); }
async function init(c) {
  check(!initialized); initialized = true;
  check(["NONE", "PREPARED", "COMMITMENT_A", "COMMITMENT_B", "SHARE_A", "SHARE_B", "AGGREGATE_READY", "SIGNED_PERSISTED", "RESULT_READY"].includes(c.boundary));
  supervisor = new ProtectedServiceIpc(store(c.supervisorOptions));
  const supervision = supervisor.request.bind(supervisor);
  supervisor.request = async (...args) => {
    try { return await supervision(...args); }
    catch (error) { lastCall = "SUPERVISOR"; lastTransport = supervisor.lastRejection ?? "NONE"; throw error; }
  };
  const integrity = new RemoteIntegrityGuard({ ipc: supervisor, port: c.supervisorPort });
  const protectedStore = store(c.journalOptions);
  journal = await ProtectedCoordinatorSigningJournal.open({ store: protectedStore, integrity, ...c.key });
  const persist = protectedStore.write.bind(protectedStore);
  protectedStore.write = (bytes, revision) => {
    const state = JSON.parse(Buffer.from(bytes).toString("utf8")), last = state.records.at(-1);
    if (last.state === "SIGNED") boundary("AGGREGATE_READY", c.boundary);
    const result = persist(bytes, revision);
    if (last.state === "PREPARED") boundary("PREPARED", c.boundary);
    if (last.state === "SIGNED") boundary("SIGNED_PERSISTED", c.boundary);
    return result;
  };
  check(Array.isArray(c.signers) && c.signers.length === 2);
  const signers = c.signers.map((s, index) => {
    const ipc = new ProtectedServiceIpc(store(s.options)); channels.push(ipc);
    const peer = new ProtectedRemoteFrostPeer({ ipc, port: s.port, signerId: s.signerId });
    // Keep the runtime peer frozen. Observe completed authenticated transport
    // calls in this test process instead of mutating signer identity/methods.
    const call = ipc.request.bind(ipc);
    ipc.request = async (...args) => {
      let result;
      try { result = await call(...args); }
      catch (error) { lastCall = args[1].method + (index === 0 ? "_A" : "_B"); lastTransport = ipc.lastRejection ?? "NONE"; throw error; }
      const event = { signingCommitment: ["commitments", "COMMITMENT"], signatureShare: ["shares", "SHARE"], abortSigningSession: ["aborts", "ABORT"] }[args[1].method];
      if (event) { counts[event[0]]++; boundary(event[1] + (index === 0 ? "_A" : "_B"), c.boundary); }
      return result;
    };
    return peer;
  });
  coordinator = new NativeFrostCoordinator({ signers, ...c.key, integrity, signingJournal: journal }); intent = c.intent;
  coordinator.testBoundary = c.boundary; send(["READY", true]);
}
let queue = Promise.resolve(), queued = 0;
process.stdin.on("data", data => {
  buffer += data.toString("utf8");
  if (buffer.length > 65536) { process.exitCode = 2; process.stdin.destroy(); void close(); return; }
  for (;;) {
    const at = buffer.indexOf("\n"); if (at < 0) break;
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    if (++queued > 4) { process.exitCode = 2; process.stdin.destroy(); void close(); return; }
    queue = queue.then(async () => {
      try {
        const v = JSON.parse(line); check(Array.isArray(v) && v.length === 2);
        if (v[0] === "INIT") await init(v[1]);
        else if (v[0] === "SIGN") { const result = await coordinator.signAutomaticallyOverIpc(intent); boundary("RESULT_READY", coordinator.testBoundary); send(["RESULT", result]); }
        else if (v[0] === "STATS") send(["STATS", counts]);
        else if (v[0] === "CLOSE") { await close(); send(["CLOSED", true]); }
        else check(false);
      } catch (error) {
        const codes = ["CoordinatorJournalUnavailable", "CoordinatorJournalRequestChanged", "FrostCoordinatorAbortIncomplete", "IpcRequestRejected", "IntegrityAuthorizationStopped"];
        send(["ERROR", { code: codes.includes(error?.message) ? error.message : "TestCoordinatorActorRejected", call: lastCall, transport: lastTransport }]);
      } finally { queued--; }
    });
  }
});
process.stdin.on("end", () => { void queue.finally(close); });
process.stdin.on("error", () => { void queue.finally(close); });
