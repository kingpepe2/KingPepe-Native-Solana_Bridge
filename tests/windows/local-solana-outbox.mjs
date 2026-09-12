// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// CURRENT-PRINCIPAL DPAPI/mTLS with actual Native/validator sources. Pending
// credit is imported as explicit TEST initialization; this is not a complete
// protected deposit controller or cross-service-account certification.
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
import { ProtectedNativeIntegrityMonitor } from "../../native/node/native-integrity.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { decodeDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { ProtectedDepositOperationJournal } from "../../services/bridge-validator/protected-deposit-journal.mjs";
import { depositSnapshotIpcHandler } from "../../services/bridge-validator/protected-deposit-snapshot.mjs";
import { initialReconciliationProgress } from "../../services/reconciliation/protected-deposit-reconciliation.mjs";
import { initialSolanaDepositOutbox, decodeSolanaDepositOutbox, validateSolanaDepositDelivery } from "../../services/relayer/solana-deposit-delivery.mjs";
import { ProtectedSolanaDepositOutbox } from "../../services/relayer/protected-solana-deposit-outbox.mjs";
import { solanaDepositIpcHandler, ProtectedSolanaDepositClient } from "../../services/relayer/solana-deposit-ipc.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimObserver } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../.."), passed = [], hash = v => createHash("sha256").update(v).digest("hex");
let fixture, file, stage = "SETUP", stopSources, done = false;
async function killAfterAccepted(configuration) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "local-solana-outbox-actor.mjs")],
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
        const v = JSON.parse(line); assert(["READY", "ACTUAL_SOLANA_BROADCAST_ACCEPTED", "NO_BROADCAST"].includes(v.event));
        if (v.event === "ACTUAL_SOLANA_BROADCAST_ACCEPTED") { assert(!accepted); accepted = true; child.kill(); }
        if (v.event === "NO_BROADCAST") { assert(!accepted); noBroadcast = true; }
      } catch { failed = true; child.kill(); }
    }
  });
  try { child.stdin.write(JSON.stringify(configuration) + "\n"); await end; }
  finally { clearTimeout(timer); child.stdin.destroy(); }
  assert(!failed, "ActualSolanaBroadcastActorFailed"); assert(accepted || noBroadcast); return accepted;
}
try {
  assert.equal(process.platform, "win32");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  file = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const wait = async (name, timeout = 240000) => {
    const until = Date.now() + timeout;
    while (!existsSync(file(name))) { assert(Date.now() < until, "LocalSolanaOutboxChainsNotReady"); await delay(200); }
  };
  await wait("ready"); assert.equal(readFileSync(file("ready"), "utf8"), "LOCAL_CHAINS_READY");
  const bytes = readFileSync(file("fixture.json")); assert(bytes.length <= 250000);
  const input = JSON.parse(bytes); assert.equal(input.protocol, "KINGPEPE_SOLANA_OUTBOX_CHAIN_FIXTURE_V1");
  const { policy, manifest, deliveryPolicy } = input, state = decodeDepositOperationState(Buffer.from(JSON.stringify(input.state)), policy);
  assert.equal(state.operations.length, 1); assert.equal(state.operations[0].mintReceipt, null);
  assert(state.operations[0].finalizedCredit); const operationId = state.operations[0].plan.operationId;
  for (const port of [input.nativeRpcPort, input.solanaRpcPort]) assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const executable = validateRuntimeFile(process.env.KINGPEPE_TEST_NATIVE_VERIFIER, repoRoot), executableSha256 = process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256;
  assert.match(executableSha256, /^[0-9a-f]{64}$/u); assert.equal(hash(readFileSync(executable)), executableSha256);
  const rpcOptions = { endpoint: "http://127.0.0.1:" + input.nativeRpcPort, authCookieFile: file("disposable-rpc.cookie"), repoRoot };
  const native = new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient(rpcOptions), executable });
  const endpoint = "http://127.0.0.1:" + input.solanaRpcPort, solana = new LocalDeploymentRpc({ endpoint });
  assert.equal((await native.observeChain()).genesis, policy.nativeGenesis); assert.equal(await solana.genesis(), policy.solanaGenesis);
  fixture = await createLocalSecurityFixture({ repoRoot, policy });
  const bridgeGuard = await fixture.guard("BRIDGE_VALIDATOR"), relayerGuard = await fixture.guard("RELAYER");
  const journalOpts = fixture.options("operations", "BRIDGE_VALIDATOR", "deposit-operations");
  const journal = await ProtectedDepositOperationJournal.open({ policy, integrity: bridgeGuard,
    store: fixture.store(journalOpts, Buffer.from(JSON.stringify(state))) }); fixture.onClose(() => journal.close());
  const snapshotTransport = await fixture.pair("BRIDGE_VALIDATOR", "RECONCILIATION", depositSnapshotIpcHandler({ journal, integrity: bridgeGuard, policy }));
  snapshotTransport.client.close();
  const progress = fixture.options("reconciliation", "RECONCILIATION", "reconciliation-progress");
  fixture.store(progress, initialReconciliationProgress(policy, manifest)).close();
  const nativePolicy = { environment: "localnet", nativeGenesis: policy.nativeGenesis, solanaDeployment: policy.solanaDeployment,
    keyEpoch: policy.keyEpoch, minimumConfirmations: policy.minimumConfirmations, maximumStallMs: manifest.maximumStallMs };
  const nativeOpts = fixture.options("native-progress", "NATIVE_OBSERVER", "chain-progress");
  fixture.store(nativeOpts, ProtectedNativeIntegrityMonitor.initialPayload(nativePolicy, await native.observeChain())).close();
  const solanaOpts = fixture.options("solana-progress", "SOLANA_OBSERVER", "chain-progress");
  fixture.store(solanaOpts, ProtectedSolanaDeploymentMonitor.initialProgress(manifest)).close();
  const nt = await fixture.pair("SUPERVISOR", "NATIVE_OBSERVER"); nt.client.close();
  const st = await fixture.pair("SUPERVISOR", "SOLANA_OBSERVER"); st.client.close();
  const rt = await fixture.pair("SUPERVISOR", "RECONCILIATION"); rt.client.close();
  const nm = await startActualLocalMonitor({ role: "NATIVE_OBSERVER", policy: nativePolicy, progressOptions: nativeOpts,
    ipcOptions: nt.clientOptions, port: nt.port, rpcOptions, executable, executableSha256 }); fixture.onClose(() => nm.close());
  const sm = await startActualLocalMonitor({ role: "SOLANA_OBSERVER", manifest, progressOptions: solanaOpts,
    ipcOptions: st.clientOptions, port: st.port, rpcOptions: { endpoint } }); fixture.onClose(() => sm.close());
  const rm = await startActualLocalMonitor({ role: "RECONCILIATION", policy, manifest, progressOptions: progress,
    ipcOptions: rt.clientOptions, port: rt.port, rpcOptions, executable, executableSha256,
    journalIpcOptions: snapshotTransport.clientOptions, journalPort: snapshotTransport.port, solanaRpcOptions: { endpoint } }); fixture.onClose(() => rm.close());
  stopSources = async () => { await rm.close(); await nm.close(); await sm.close(); };
  const fresh = async () => {
    const until = Date.now() + 180000;
    for (;;) {
      assert(Date.now() < until && !nm.failed && !sm.failed && !rm.failed, "SolanaOutboxActualSourcesUnavailable");
      const status = await fixture.authority.status(); assert.notEqual(status.state, "HARD_STOP_INTEGRITY");
      if (status.state === "RUNNING" && rm.latest?.state === "OBSERVED_MATCH") return;
      await delay(250);
    }
  };
  const admit = async action => {
    for (let attempt = 0; attempt < 16; attempt++) {
      await fresh();
      try { return await action(); }
      catch (error) { const s = await fixture.authority.status(); if (s.state !== "PAUSED_POLICY" || s.policyState !== "RUNNING") throw error; }
    }
    throw new Error("SolanaOutboxAdmissionRetryExhausted");
  };
  stage = "ACTUAL_SOURCES"; await fresh();
  const outboxOpts = fixture.options("solana-outbox", "RELAYER", "solana-deposit-outbox");
  let store = fixture.store(outboxOpts, initialSolanaDepositOutbox(deliveryPolicy)), outbox;
  const open = () => ProtectedSolanaDepositOutbox.open({ store, integrity: relayerGuard, policy: deliveryPolicy, endpoint });
  outbox = await open(); fixture.onClose(() => outbox.close());
  const probe = () => { const v = store.read(); try { return { revision: v.revision, state: decodeSolanaDepositOutbox(v.payload, deliveryPolicy) }; } finally { v.payload.fill(0); } };
  let loseAck = true;
  const transport = await fixture.pair("RELAYER", "BRIDGE_VALIDATOR", async args => {
    const result = await solanaDepositIpcHandler({ outbox, policy: deliveryPolicy, integrity: relayerGuard })(args);
    if (loseAck && args.method === "enqueueSolanaDeposit") { loseAck = false; throw new Error("TEST_LOST_SOLANA_ENQUEUE_ACK"); }
    return result;
  });
  const client = new ProtectedSolanaDepositClient({ ipc: transport.client, port: transport.port, policy: deliveryPolicy });
  const worker = await fixture.pair("SUPERVISOR", "RELAYER"); worker.client.close();
  writeFileSync(file("windows-ready"), "ACTUAL_SOURCES_READY", { flag: "wx" });
  let mintDelivery;
  for (let sequence = 1; sequence <= 2; sequence++) {
    const kind = sequence === 1 ? "RECEIPT" : "CLAIM"; stage = kind + "_PACKET";
    await wait("packet-" + sequence + ".json");
    const raw = readFileSync(file("packet-" + sequence + ".json")); assert(raw.length <= 12000);
    const delivery = JSON.parse(raw), checked = validateSolanaDepositDelivery(delivery, deliveryPolicy);
    assert.equal(delivery.kind, kind); assert.equal(delivery.operationId, operationId);
    await admit(async () => { try { await client.enqueue(delivery); } catch (error) { if (loseAck || sequence !== 1) throw error; } });
    assert(!loseAck);
    const before = probe(); assert.equal(before.state.records.length, sequence); assert.equal(before.state.records.at(-1).sendAttempts, 0);
    await admit(() => client.enqueue(delivery)); assert.equal(probe().revision, before.revision);
    passed.push(kind + "_DURABLE_ENQUEUE_NO_DUPLICATE");
    if (sequence === 1) {
      await assert.rejects(client.enqueue({ ...delivery, operationId: hash("wrong local operation") }));
      passed.push("SUBSTITUTED_OPERATION_WITH_SAME_BACKING_REJECTED");
    }
    stage = kind + "_KILL_AFTER_SEND"; await outbox.close();
    let killed = false;
    for (let attempt = 0; attempt < 8 && !killed; attempt++) {
      await fresh();
      killed = await killAfterAccepted({ policy: deliveryPolicy, endpoint, outboxOptions: outboxOpts,
        ipcOptions: worker.clientOptions, port: worker.port });
    }
    assert(killed, "SolanaOutboxNeverReachedActualBroadcast");
    store = new WindowsProtectedStore(outboxOpts); outbox = await open();
    const attempted = probe().state.records.at(-1); assert(attempted.sendAttempts > 0); assert.equal(attempted.outcome, "UNRESOLVED");
    passed.push(kind + "_PROCESS_KILLED_AFTER_ACTUAL_VALIDATOR_ACCEPTANCE");
    // Assert restart never calls send again while querying the real validator.
    let sends = 0; const send = SolanaLocalRpcClient.prototype.sendTransaction;
    SolanaLocalRpcClient.prototype.sendTransaction = async function (...args) { sends++; return send.apply(this, args); };
    let loseWrite = true, write = store.write.bind(store);
    store.write = (...args) => { const result = write(...args); if (loseWrite) { loseWrite = false; throw new Error("TEST_LOST_SOLANA_OUTCOME_ACK"); } return result; };
    try {
      const until = Date.now() + 180000;
      while (probe().state.records.at(-1).outcome !== "FINALIZED_ACCOUNT") {
        assert(Date.now() < until); await outbox.runOne(); await delay(300);
      }
      assert(!loseWrite); assert.equal(sends, 0);
    } finally { store.write = write; SolanaLocalRpcClient.prototype.sendTransaction = send; }
    await outbox.close(); store = new WindowsProtectedStore(outboxOpts); outbox = await open();
    assert.equal((await client.status(delivery)).state, "FINALIZED_ACCOUNT");
    passed.push(kind + "_REOPEN_RESOLVES_LOST_OUTCOME_ACK_WITHOUT_RESEND");
    writeFileSync(file("delivered-" + sequence), "FINALIZED_ACCOUNT", { flag: "wx" });
    if (sequence === 2) mintDelivery = checked;
  }
  stage = "MINT_CATCHUP";
  assert.equal((await journal.snapshot()).accounting.authorizedUnmintedCredits, state.operations[0].plan.depositIntent.amountAtomic);
  const observer = new SolanaDepositClaimObserver({ endpoint, config: { environment: "localnet", cluster: "localnet",
    managerProgramIdHex: policy.managerProgramId, transceiverProgramIdHex: policy.transceiverProgramId, mintHex: policy.mint, nativeDecimals: manifest.mint.decimals } });
  const observation = await observer.observeProtectedFinalizedDepositClaim({ operationIdHex: mintDelivery.message.operationIdHex,
    messageDigestHex: mintDelivery.message.messageDigestHex, solanaSignature: mintDelivery.signature,
    depositClaimAccountBase58: mintDelivery.claimAddress, mintAccountBase58: manifest.mint.id }, policy.solanaGenesis);
  await journal.retainFinalizedMint(operationId, observation);
  await journal.retainFinalizedMint(operationId, observation);
  const accounting = (await journal.snapshot()).accounting;
  assert.equal(accounting.authorizedUnmintedCredits, "0"); assert.equal(accounting.mintedSupply, state.operations[0].plan.depositIntent.amountAtomic);
  await fresh(); passed.push("ACTUAL_FINALIZED_MINT_CATCHUP_RECONCILES_WITHOUT_SECOND_CREDIT");
  await wait("completed"); assert.equal(readFileSync(file("completed"), "utf8"), "COMPLETED");
  passed.push("ACTUAL_NATIVE_FROST_ATTESTATION_SOLANA_FLOW_COMPLETED");
  assert.equal(passed.length, 9);
  writeFileSync(file("windows-done"), "WINDOWS_CHECKS_COMPLETED", { flag: "wx" }); done = true;
} catch {
  console.error("WINDOWS_SOLANA_OUTBOX_FAILED:" + stage); process.exitCode = 1;
  if (fixture) {
    try { const s = await fixture.authority.status(); console.error(JSON.stringify({ state: s.state, policyState: s.policyState,
      missingSources: s.missingSources, incidentCount: s.incidentCount })); } catch { console.error("ACTUAL_AUTHORITY_STATUS_UNAVAILABLE"); }
    try { console.error(JSON.stringify({ diagnostics: await fixture.diagnostics() })); } catch { /* Fixed error above. */ }
  }
} finally {
  try { await stopSources?.(); } catch { console.error("WINDOWS_SOLANA_OUTBOX_SOURCE_STOP_FAILED"); process.exitCode = 1; }
  if (!done && file) { try { writeFileSync(file("abort"), "ABORT", { flag: "wx" }); } catch { /* Preserve first failure. */ } }
  try { await fixture?.close(); } catch { console.error("WINDOWS_SOLANA_OUTBOX_FIXTURE_CLEANUP_FAILED"); process.exitCode = 1; }
}
if (done && process.exitCode !== 1) console.log(JSON.stringify({ pass: passed.length, fail: 0, passed, phase09: "NOT_STARTED", productionReady: false,
  scope: "Actual CurrentUser DPAPI/mTLS and validator delivery; test-initialized pending credit, not full protected controller or cross-SID certification." }));
