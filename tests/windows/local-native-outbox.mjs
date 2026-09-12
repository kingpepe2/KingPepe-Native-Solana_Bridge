// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real CURRENT-PRINCIPAL DPAPI/mTLS and regtest transaction delivery. The Linux
// fixture supplies real ephemeral A+B signatures. This is not yet a complete
// protected FROST-to-mint controller or distinct-service-account certification.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalSecurityFixture, startActualLocalMonitor } from "./local-security-fixture.mjs";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { ProtectedNativeIntegrityMonitor } from "../../native/node/native-integrity.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { initialDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { ProtectedDepositOperationJournal } from "../../services/bridge-validator/protected-deposit-journal.mjs";
import { depositSnapshotIpcHandler } from "../../services/bridge-validator/protected-deposit-snapshot.mjs";
import { initialReconciliationProgress } from "../../services/reconciliation/protected-deposit-reconciliation.mjs";
import { initialNativeSweepOutbox, decodeNativeSweepOutbox, ProtectedNativeSweepOutbox, validateNativeSweepDelivery } from "../../services/relayer/native-sweep-outbox.mjs";
import { nativeSweepIpcHandler, ProtectedNativeSweepClient } from "../../services/relayer/native-sweep-ipc.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../.."), passed = [], hash = v => createHash("sha256").update(v).digest("hex");
let fixture, command, stage = "SETUP", stopSources, delivered = false;
async function killAfterAccepted(configuration) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "local-native-outbox-actor.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", accepted = false, noBroadcast = false, failed = false;
  const end = new Promise(resolve => child.once("close", resolve));
  const timer = setTimeout(() => { failed = true; child.kill(); }, 120000);
  child.on("error", () => { failed = true; child.kill(); });
  child.stdin.on("error", () => { if (!accepted) failed = true; });
  child.stderr.on("data", () => { failed = true; child.kill(); });
  child.stdout.on("data", bytes => {
    buffer += bytes.toString("utf8");
    if (buffer.length > 4096) { failed = true; child.kill(); return; }
    for (;;) {
      const at = buffer.indexOf("\n"); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        const value = JSON.parse(line);
        assert(["READY", "ACTUAL_NATIVE_BROADCAST_ACCEPTED", "NO_BROADCAST"].includes(value.event));
        if (value.event === "ACTUAL_NATIVE_BROADCAST_ACCEPTED") { assert(!accepted); accepted = true; child.kill(); }
        if (value.event === "NO_BROADCAST") { assert(!accepted); noBroadcast = true; }
      } catch { failed = true; child.kill(); }
    }
  });
  try { child.stdin.write(JSON.stringify(configuration) + "\n"); await end; }
  finally { clearTimeout(timer); child.stdin.destroy(); }
  assert(!failed, "ActualNativeBroadcastActorFailed"); assert(accepted || noBroadcast);
  return accepted;
}
try {
  assert.equal(process.platform, "win32");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  const file = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const readyUntil = Date.now() + 180000;
  while (!existsSync(file("ready"))) { assert(Date.now() < readyUntil, "LocalNativeOutboxChainsNotReady"); await delay(250); }
  assert.equal(readFileSync(file("ready"), "utf8"), "LOCAL_CHAINS_READY");
  const bytes = readFileSync(file("fixture.json")); assert(bytes.length <= 250000);
  const input = JSON.parse(bytes); assert.equal(input.protocol, "KINGPEPE_NATIVE_OUTBOX_CHAIN_FIXTURE_V1");
  const { policy, manifest } = input, delivery = validateNativeSweepDelivery(input.delivery, policy), operationId = delivery.plan.operationId;
  const txid = parseNativeTransactionHex(delivery.signedTransactionHex).txidHex;
  for (const port of [input.nativeRpcPort, input.solanaRpcPort]) assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const executable = validateRuntimeFile(process.env.KINGPEPE_TEST_NATIVE_VERIFIER, repoRoot), executableSha256 = process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256;
  assert.match(executableSha256, /^[0-9a-f]{64}$/u); assert.equal(hash(readFileSync(executable)), executableSha256);
  const rpcOptions = { endpoint: "http://127.0.0.1:" + input.nativeRpcPort, authCookieFile: file("disposable-rpc.cookie"), repoRoot };
  const rpc = new NativeRpcClient(rpcOptions), native = new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient(rpcOptions), executable });
  const solana = new LocalDeploymentRpc({ endpoint: "http://127.0.0.1:" + input.solanaRpcPort });
  assert.equal((await native.observeChain()).genesis, policy.nativeGenesis); assert.equal(await solana.genesis(), policy.solanaGenesis);
  await assert.rejects(rpc.getRawTransaction(txid), error => error.message === "NativeRpcRejected:getrawtransaction:-5");
  passed.push("SIGNED_FROST_SWEEP_IS_NOT_BROADCAST_BEFORE_PROTECTED_OUTBOX");
  let sequence = 0;
  command = async action => {
    const value = { sequence: ++sequence, action }, response = file("response-" + sequence + ".json");
    writeFileSync(file("request-" + sequence + ".json"), JSON.stringify(value), { flag: "wx" });
    const until = Date.now() + 60000;
    while (!existsSync(response)) { assert(Date.now() < until, "OutboxChainControlTimeout"); await delay(100); }
    const reply = readFileSync(response); assert(reply.length < 256); assert.deepEqual(JSON.parse(reply), value);
  };
  fixture = await createLocalSecurityFixture({ repoRoot, policy });
  const bridgeGuard = await fixture.guard("BRIDGE_VALIDATOR"), relayerGuard = await fixture.guard("RELAYER");
  const journalOpts = fixture.options("operations", "BRIDGE_VALIDATOR", "deposit-operations");
  const journal = await ProtectedDepositOperationJournal.open({ policy, integrity: bridgeGuard,
    store: fixture.store(journalOpts, initialDepositOperationState(policy)) }); fixture.onClose(() => journal.close());
  const snapshotTransport = await fixture.pair("BRIDGE_VALIDATOR", "RECONCILIATION", depositSnapshotIpcHandler({ journal, integrity: bridgeGuard, policy }));
  snapshotTransport.client.close();
  const monitorOpts = fixture.options("reconciliation", "RECONCILIATION", "reconciliation-progress");
  fixture.store(monitorOpts, initialReconciliationProgress(policy, manifest)).close();
  const nativePolicy = { environment: "localnet", nativeGenesis: policy.nativeGenesis, solanaDeployment: policy.solanaDeployment,
    keyEpoch: policy.keyEpoch, minimumConfirmations: policy.minimumConfirmations, maximumStallMs: manifest.maximumStallMs };
  const nativeOpts = fixture.options("native-progress", "NATIVE_OBSERVER", "chain-progress");
  fixture.store(nativeOpts, ProtectedNativeIntegrityMonitor.initialPayload(nativePolicy, await native.observeChain())).close();
  const solanaOpts = fixture.options("solana-progress", "SOLANA_OBSERVER", "chain-progress");
  fixture.store(solanaOpts, ProtectedSolanaDeploymentMonitor.initialProgress(manifest)).close();
  const nativeTransport = await fixture.pair("SUPERVISOR", "NATIVE_OBSERVER"); nativeTransport.client.close();
  const solanaTransport = await fixture.pair("SUPERVISOR", "SOLANA_OBSERVER"); solanaTransport.client.close();
  const nativeMonitor = await startActualLocalMonitor({ role: "NATIVE_OBSERVER", policy: nativePolicy, progressOptions: nativeOpts,
    ipcOptions: nativeTransport.clientOptions, port: nativeTransport.port, rpcOptions, executable, executableSha256 });
  fixture.onClose(() => nativeMonitor.close());
  const solanaMonitor = await startActualLocalMonitor({ role: "SOLANA_OBSERVER", manifest, progressOptions: solanaOpts,
    ipcOptions: solanaTransport.clientOptions, port: solanaTransport.port, rpcOptions: { endpoint: "http://127.0.0.1:" + input.solanaRpcPort } });
  fixture.onClose(() => solanaMonitor.close());
  const reconciliationTransport = await fixture.pair("SUPERVISOR", "RECONCILIATION"); reconciliationTransport.client.close();
  const reconciliationMonitor = await startActualLocalMonitor({ role: "RECONCILIATION", policy, manifest, progressOptions: monitorOpts,
    ipcOptions: reconciliationTransport.clientOptions, port: reconciliationTransport.port, rpcOptions, executable, executableSha256,
    journalIpcOptions: snapshotTransport.clientOptions, journalPort: snapshotTransport.port,
    solanaRpcOptions: { endpoint: "http://127.0.0.1:" + input.solanaRpcPort } });
  fixture.onClose(() => reconciliationMonitor.close());
  stopSources = async () => { await reconciliationMonitor.close(); await nativeMonitor.close(); await solanaMonitor.close(); };
  let minedAt = 0;
  const fresh = async () => {
    const until = Date.now() + 180000;
    for (;;) {
      assert(Date.now() < until && !reconciliationMonitor.failed && !nativeMonitor.failed && !solanaMonitor.failed, "OutboxActualSourcesUnavailable");
      if (Date.now() - minedAt >= 20000) { await command("ADVANCE"); minedAt = Date.now(); }
      if ((await fixture.authority.status()).state === "RUNNING" && reconciliationMonitor.latest?.state === "OBSERVED_MATCH") return;
      await delay(250);
    }
  };
  const withFreshAdmission = async action => {
    // A diagnostic healthy status is NOT permission. A concurrent journal or
    // chain update may pause the mandatory guard before the action. Retry only
    // the SAME idempotent request after actual health returns; never a stop.
    for (let attempt = 0; attempt < 16; attempt++) {
      await fresh();
      try { return await action(); }
      catch (error) {
        const status = await fixture.authority.status();
        if (status.state !== "PAUSED_POLICY" || status.policyState !== "RUNNING") throw error;
        await delay(250);
      }
    }
    throw new Error("OutboxAdmissionRetryExhausted");
  };
  stage = "FRESH_SOURCE_ADMISSION"; await fresh();
  stage = "PLAN_RESERVATION";
  await withFreshAdmission(() => journal.reservePlan(delivery.plan));
  stage = "SIGNED_RETENTION";
  await journal.retainSigned(operationId, delivery.signedTransactionHex);
  const outboxOpts = fixture.options("native-outbox", "RELAYER", "native-sweep-outbox");
  let store = fixture.store(outboxOpts, initialNativeSweepOutbox(policy));
  const open = () => ProtectedNativeSweepOutbox.open({ store, integrity: relayerGuard, policy, rpc, nativeVerifier: native });
  let outbox = await open(); fixture.onClose(() => outbox.close());
  const probe = () => { const value = store.read(); try { return { revision: value.revision, state: decodeNativeSweepOutbox(value.payload, policy) }; } finally { value.payload.fill(0); } };
  let loseAck = true;
  const transport = await fixture.pair("RELAYER", "BRIDGE_VALIDATOR", async args => {
    const result = await nativeSweepIpcHandler({ outbox, policy, integrity: relayerGuard })(args);
    if (loseAck) { loseAck = false; throw new Error("TEST_LOST_NATIVE_ENQUEUE_ACK"); } return result;
  });
  const deliveries = new ProtectedNativeSweepClient({ ipc: transport.client, port: transport.port, policy });
  stage = "LOST_ENQUEUE_ACK";
  await withFreshAdmission(async () => {
    try { await deliveries.enqueue(delivery); }
    catch (error) { if (loseAck) throw error; return; }
    throw new Error("ActualEnqueueAckLossNotExercised");
  });
  assert.equal(loseAck, false, "LostResponseInjectedOnlyAfterActualDurableEnqueue");
  const queued = probe(); assert.equal(queued.state.records.length, 1); assert.equal(queued.state.records[0].sendAttempts, 0);
  assert.equal((await withFreshAdmission(() => deliveries.enqueue(delivery))).state, "ACCEPTED"); assert.equal(probe().revision, queued.revision);
  passed.push("DURABLE_ENQUEUE_SURVIVES_LOST_MTLS_RESPONSE_WITH_ONE_EXACT_RECORD");
  await assert.rejects(deliveries.enqueue({ ...delivery, plan: { ...delivery.plan,
    depositIntent: { ...delivery.plan.depositIntent, recipientHex: hash("wrong test recipient") } } }));
  passed.push("SUBSTITUTED_RECIPIENT_REJECTED_BEFORE_DELIVERY");
  const workerTransport = await fixture.pair("SUPERVISOR", "RELAYER"); workerTransport.client.close();
  stage = "ACTUAL_BROADCAST_PROCESS_KILL"; await outbox.close();
  let accepted = false;
  for (let retry = 0; retry < 3 && !accepted; retry++) {
    await fresh();
    accepted = await killAfterAccepted({ outboxOptions: outboxOpts, policy, rpcOptions, executable, executableSha256,
      ipcOptions: workerTransport.clientOptions, port: workerTransport.port });
  }
  assert(accepted, "NativeOutboxDidNotActuallyBroadcast");
  assert.equal(await rpc.getRawTransaction(txid), delivery.signedTransactionHex);
  await stopSources(); stopSources = undefined;
  // Child death releases only its own process lock; retained operations remain.
  await delay(500);
  store = new WindowsProtectedStore(outboxOpts); outbox = await open();
  const before = probe(); assert(before.state.records[0].sendAttempts > 0); assert.equal(before.state.records[0].observed, false);
  passed.push("ACTUAL_NATIVE_ACCEPTANCE_BEFORE_PROCESS_KILL_LEAVES_DURABLE_UNCERTAINTY");
  let sends = 0; const send = rpc.sendRawTransaction.bind(rpc);
  rpc.sendRawTransaction = async raw => { sends++; return send(raw); };
  const write = store.write.bind(store); let losePersistAck = true;
  store.write = (bytes, revision) => { const result = write(bytes, revision);
    if (losePersistAck) { losePersistAck = false; throw new Error("TEST_LOST_OBSERVATION_WRITE_ACK"); } return result; };
  stage = "OBSERVATION_WRITE_RECOVERY";
  assert.equal((await outbox.runOne()).state, "WAITING_FOR_DEPENDENCY");
  assert.equal(probe().state.records[0].observed, true); store.write = write;
  await outbox.close(); store = new WindowsProtectedStore(outboxOpts); outbox = await open();
  assert.equal((await deliveries.status(delivery)).state, "BROADCAST_OBSERVED"); assert.equal(sends, 0);
  passed.push("REOPEN_OBSERVES_EXACT_SPEND_WITHOUT_REBROADCAST_OR_NEW_INPUTS");
  passed.push("LOST_PROTECTED_OBSERVATION_ACK_RECOVERS_COMMITTED_IMAGE");
  const accounting = (await journal.snapshot()).accounting;
  assert.equal(accounting.canonicalReserve, "0"); assert.equal(accounting.authorizedUnmintedCredits, "0");
  assert.equal(accounting.unresolvedSignedSweepAmount, delivery.plan.depositIntent.amountAtomic);
  passed.push("TRANSPORT_OBSERVATION_DOES_NOT_FABRICATE_FINALIZED_CREDIT");
  assert.notEqual((await fixture.authority.status()).state, "HARD_STOP_INTEGRITY");
  await command("DELIVERED"); delivered = true;
  stage = "ACTUAL_MINT_AND_RECONCILIATION";
  const until = Date.now() + 180000;
  while (!existsSync(file("completed"))) { assert(Date.now() < until, "PostOutboxLocalFlowDidNotComplete"); await delay(250); }
  assert.equal(readFileSync(file("completed"), "utf8"), "COMPLETED");
  passed.push("RETAINED_REAL_BROADCAST_CONTINUES_THROUGH_ACTUAL_MINT_AND_RECONCILIATION");
} catch (error) {
  console.error("WINDOWS_NATIVE_OUTBOX_FAILED:" + stage); process.exitCode = 1;
  const failureClass = ["IpcRequestRejected", "IntegrityAuthorizationStopped", "DepositJournalBusy", "DepositJournalUnavailable", "OutboxActualSourcesUnavailable"]
    .find(code => error?.message?.startsWith(code)) ?? "OUTBOX_PROBE_FAILURE";
  console.error(JSON.stringify({ event: "FIXED_FAILURE_CLASS", failureClass }));
  if (fixture) {
    try { const value = await fixture.authority.status();
      console.error(JSON.stringify({ event: "ACTUAL_AUTHORITY_STATUS_AFTER_FAILURE", state: value.state, policyState: value.policyState,
        missingSources: value.missingSources, incidentCount: value.incidentCount }));
    } catch { console.error("ACTUAL_AUTHORITY_STATUS_UNAVAILABLE"); }
  }
  if (fixture) { try { console.error(JSON.stringify({ event: "FIXED_IPC_DIAGNOSTICS", transports: await fixture.diagnostics() })); } catch { /* Fixed failure above. */ } }
} finally {
  try { await stopSources?.(); } catch { console.error("WINDOWS_NATIVE_OUTBOX_SOURCE_STOP_FAILED"); process.exitCode = 1; }
  if (!delivered) { try { await command?.("ABORT"); } catch { console.error("WINDOWS_NATIVE_OUTBOX_CHAIN_ABORT_FAILED"); process.exitCode = 1; } }
  try { await fixture?.close(); } catch { console.error("WINDOWS_NATIVE_OUTBOX_CLEANUP_FAILED"); process.exitCode = 1; }
}
if (!process.exitCode) console.log(JSON.stringify({ pass: passed.length, fail: 0, passed, scope: "CURRENT_PRINCIPAL_REAL_BROADCAST_NOT_FULL_PROTECTED_FLOW",
  productionReady: false, mainnetActivation: "DISABLED", nativePayout: "NOT_RUN_BY_THIS_TEST" }));
