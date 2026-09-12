// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real Windows DPAPI/mTLS + live WSL regtest/validator. This is a post-mint
// reconciliation/reopen probe, NOT full protected FROST/flow crash certification
// or distinct-service-principal evidence. All input/control files are disposable.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalSecurityFixture, startActualLocalMonitor } from "./local-security-fixture.mjs";
import { validateRuntimeStateRoot, validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { ProtectedNativeIntegrityMonitor } from "../../native/node/native-integrity.mjs";
import { LocalDeploymentRpc, ProtectedSolanaDeploymentMonitor } from "../../services/solana-observer/deployment-integrity.mjs";
import { ProtectedDepositOperationJournal } from "../../services/bridge-validator/protected-deposit-journal.mjs";
import { decodeDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { depositSnapshotIpcHandler, ProtectedDepositSnapshotClient } from "../../services/bridge-validator/protected-deposit-snapshot.mjs";
import { initialReconciliationProgress, ProtectedDepositReconciliationMonitor, decodeReconciliationProgress } from "../../services/reconciliation/protected-deposit-reconciliation.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../.."), passed = [];
let fixture, command, stage = "SETUP", observedState = "NONE", observedReason = "NONE", lastSources = [];
function matched(result) {
  const safe = value => typeof value === "string" && /^[A-Z_]{1,80}$/u.test(value) ? value : "NONE";
  observedState = safe(result?.state); observedReason = safe(result?.reason);
  assert.equal(result.state, "OBSERVED_MATCH"); return result;
}
try {
  assert.equal(process.platform, "win32");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  const file = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const deadline = Date.now() + 180000;
  while (!existsSync(file("ready"))) { assert(Date.now() < deadline, "LocalChainsNotReady"); await delay(250); }
  assert.equal(readFileSync(file("ready"), "utf8"), "LOCAL_CHAINS_READY");
  const bytes = readFileSync(file("fixture.json")); assert(bytes.length <= 1000000);
  const input = JSON.parse(bytes); assert.equal(input.protocol, "KINGPEPE_WINDOWS_CHAIN_FIXTURE_V1");
  const { policy, manifest } = input;
  const state = decodeDepositOperationState(Buffer.from(JSON.stringify(input.state)), policy);
  assert.equal(state.operations.length, 1); assert(state.operations[0].mintReceipt);
  for (const port of [input.nativeRpcPort, input.solanaRpcPort]) assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const verifierFile = validateRuntimeFile(process.env.KINGPEPE_TEST_NATIVE_VERIFIER, repoRoot);
  assert.match(process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(createHash("sha256").update(readFileSync(verifierFile)).digest("hex"), process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256);
  const native = new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient({ endpoint: "http://127.0.0.1:" + input.nativeRpcPort,
    authCookieFile: file("disposable-rpc.cookie"), repoRoot }), executable: verifierFile });
  const solana = new LocalDeploymentRpc({ endpoint: "http://127.0.0.1:" + input.solanaRpcPort });
  // Verify actual endpoints before any test enrollment. Neither an exported
  // fixture nor "finalized" JSON alone supplies Native proof capabilities.
  const firstChain = await native.observeChain();
  assert.equal(firstChain.genesis, policy.nativeGenesis); assert.equal(await solana.genesis(), policy.solanaGenesis);
  let sequence = 0;
  command = async action => {
    const n = ++sequence, value = { sequence: n, action }, response = file("response-" + n + ".json");
    writeFileSync(file("request-" + n + ".json"), JSON.stringify(value), { flag: "wx" });
    const until = Date.now() + 60000;
    while (!existsSync(response)) { assert(Date.now() < until, "ChainControlTimeout"); await delay(100); }
    const bytes = readFileSync(response); assert(bytes.length < 256); assert.deepEqual(JSON.parse(bytes), value);
  };
  fixture = await createLocalSecurityFixture({ repoRoot, policy });
  const bridgeGuard = await fixture.guard("BRIDGE_VALIDATOR"), guard = await fixture.guard("RECONCILIATION");
  const journalOpts = fixture.options("actual-operations", "BRIDGE_VALIDATOR", "deposit-operations");
  let journal = await ProtectedDepositOperationJournal.open({ policy, integrity: bridgeGuard,
    store: fixture.store(journalOpts, Buffer.from(JSON.stringify(state))) });
  fixture.onClose(() => journal.close());
  const transport = await fixture.pair("BRIDGE_VALIDATOR", "RECONCILIATION", async args =>
    depositSnapshotIpcHandler({ journal, integrity: bridgeGuard, policy })(args));
  const client = new ProtectedDepositSnapshotClient({ ipc: transport.client, port: transport.port, policy });
  const opts = fixture.options("progress", "RECONCILIATION", "reconciliation-progress");
  let store = fixture.store(opts, initialReconciliationProgress(policy, manifest));
  const open = () => ProtectedDepositReconciliationMonitor.open({ policy, manifest, journalClient: client,
    nativeVerifier: native, solanaRpc: solana, integrity: guard, store });
  let monitor = await open(); fixture.onClose(() => monitor.close());
  const nativePolicy = { environment: "localnet", nativeGenesis: policy.nativeGenesis, solanaDeployment: policy.solanaDeployment,
    keyEpoch: policy.keyEpoch, minimumConfirmations: policy.minimumConfirmations, maximumStallMs: manifest.maximumStallMs };
  const nativeOpts = fixture.options("native-progress", "NATIVE_OBSERVER", "chain-progress");
  fixture.store(nativeOpts, ProtectedNativeIntegrityMonitor.initialPayload(nativePolicy, await native.observeChain())).close();
  const solanaOpts = fixture.options("solana-progress", "SOLANA_OBSERVER", "chain-progress");
  fixture.store(solanaOpts, ProtectedSolanaDeploymentMonitor.initialProgress(manifest)).close();
  const nativeTransport = await fixture.pair("SUPERVISOR", "NATIVE_OBSERVER"); nativeTransport.client.close();
  const solanaTransport = await fixture.pair("SUPERVISOR", "SOLANA_OBSERVER"); solanaTransport.client.close();
  const nativeMonitor = await startActualLocalMonitor({ role: "NATIVE_OBSERVER", policy: nativePolicy,
    progressOptions: nativeOpts, ipcOptions: nativeTransport.clientOptions, port: nativeTransport.port,
    rpcOptions: { endpoint: "http://127.0.0.1:" + input.nativeRpcPort, authCookieFile: file("disposable-rpc.cookie"), repoRoot },
    executable: verifierFile, executableSha256: process.env.KINGPEPE_TEST_NATIVE_VERIFIER_SHA256 });
  fixture.onClose(() => nativeMonitor.close());
  const solanaMonitor = await startActualLocalMonitor({ role: "SOLANA_OBSERVER", manifest,
    progressOptions: solanaOpts, ipcOptions: solanaTransport.clientOptions, port: solanaTransport.port,
    rpcOptions: { endpoint: "http://127.0.0.1:" + input.solanaRpcPort } });
  fixture.onClose(() => solanaMonitor.close());
  stage = "LIVE_RECONCILIATION";
  await command("ADVANCE");
  stage = "PERIODIC_LIVE_SOURCES";
  // Real services publish periodically, not three one-shot checks followed by
  // a potentially stale combined admission. Every iteration still queries the
  // actual chains and passes the existing protected progress/freshness gates.
  const controller = new AbortController(), failures = []; let latest;
  const running = monitor.run({ signal: controller.signal, intervalMs: 1000,
    onStatus: result => { latest = result; assert.notEqual(result.state, "HARD_STOP_INTEGRITY"); }
  }).catch(error => { failures.push(error); controller.abort(); });
  let observed;
  try {
    const until = Date.now() + 180000; let lastMinedAt = Date.now();
    for (;;) {
      assert(failures.length === 0 && !nativeMonitor.failed && !solanaMonitor.failed, "ActualSourceServiceFailed");
      assert(Date.now() < until, "ActualSourcesNeverBecameJointlyFresh");
      const admission = await fixture.authority.status(); observedState = admission.state;
      lastSources = [nativeMonitor.latest, solanaMonitor.latest, latest].map(v => ({ state: v?.state ?? "NONE", reason: v?.reason ?? "NONE" }));
      assert.notEqual(admission.state, "HARD_STOP_INTEGRITY");
      if (admission.state === "RUNNING" && [nativeMonitor.latest, solanaMonitor.latest, latest].every(v => v?.state === "OBSERVED_MATCH")) {
        observed = matched(latest); break;
      }
      // Keep this explicitly disposable regtest chain moving. No cached health
      // or enlarged stall threshold substitutes for an actual fresh block.
      if (Date.now() - lastMinedAt >= 20000) { await command("ADVANCE"); lastMinedAt = Date.now(); }
      await delay(250);
    }
  } finally { controller.abort(); await running; await nativeMonitor.close(); await solanaMonitor.close(); }
  assert.equal(failures.length, 0, "ActualSourceServiceFailed");
  assert.equal(observed.accounting.canonicalReserve, state.operations[0].plan.depositIntent.amountAtomic);
  assert.equal(observed.accounting.mintedSupply, observed.accounting.canonicalReserve);
  assert.equal(observed.accounting.authorizedUnmintedCredits, "0");
  // The joint RUNNING assertion above was made while the actual services ran.
  // Stopping them cannot grant or prolong a cached authorization afterward.
  passed.push("REAL_WINDOWS_PROTECTED_RECONCILIATION_AND_THREE_LIVE_SOURCE_CHECKS");
  const revision = (await journal.snapshot()).revision;
  await monitor.close(); await journal.close(); await fixture.restartAuthority();
  journal = await ProtectedDepositOperationJournal.open({ policy, integrity: bridgeGuard, store: new WindowsProtectedStore(journalOpts) });
  store = new WindowsProtectedStore(opts); monitor = await open();
  assert.equal((await fixture.authority.status()).state, "PAUSED_POLICY");
  assert.equal((await journal.snapshot()).revision, revision);
  stage = "REOPEN";
  await command("ADVANCE");
  assert.equal((await monitor.poll()).state, "OBSERVED_MATCH");
  assert.equal((await journal.snapshot()).revision, revision);
  passed.push("PROTECTED_REOPEN_REOBSERVES_REAL_CHAINS_WITHOUT_MUTATING_CREDIT_OR_MINT");
  const saved = store.read();
  try { const progress = decodeReconciliationProgress(saved.payload, policy, manifest);
    assert(progress.native.height > firstChain.tipHeight); assert(BigInt(progress.solanaSlot) >= BigInt(state.operations[0].mintReceipt.rootSlot)); }
  finally { saved.payload.fill(0); }
  passed.push("REAL_NETWORK_BOUND_PROGRESS_AND_FINALIZED_SLOT_RETAINED");
  stage = "DEEP_REORG";
  await command("REORG");
  const incident = await monitor.poll();
  assert.equal(incident.state, "HARD_STOP_INTEGRITY"); assert.equal(incident.reason, "ACCEPTED_NATIVE_BASIS_INVALIDATED");
  assert.equal((await fixture.authority.status()).state, "HARD_STOP_INTEGRITY");
  passed.push("REAL_POST_MINT_HIGHER_WORK_FORK_PERSISTS_GLOBAL_STOP");
  const stopped = store.read();
  try { const progress = decodeReconciliationProgress(stopped.payload, policy, manifest);
    assert.equal(progress.incident.affectedReserveAtomic, state.operations[0].plan.depositIntent.amountAtomic);
    assert.deepEqual(progress.incident.affectedOperations, [state.operations[0].plan.operationId]); }
  finally { stopped.payload.fill(0); }
  passed.push("EXACT_IMPACTED_OPERATION_AND_BACKING_RETAINED");
  for (const [role, action] of [["KINGPEPE_FROST_A", "FROST_SIGN"], ["KINGPEPE_FROST_B", "FROST_SIGN"], ["COORDINATOR", "COORDINATE_SWEEP"],
    ["ATTESTER_A", "ATTEST_MINT_CREDIT"], ["ATTESTER_B", "ATTEST_MINT_CREDIT"], ["RELAYER", "SUBMIT_CLAIM"]]) {
    const service = await fixture.guard(role); await assert.rejects(service.assertRunning(state.operations[0].plan.operationId, action));
  }
  await assert.rejects(bridgeGuard.assertRunning(state.operations[0].plan.operationId, "AUTHORIZE_CLAIM"));
  passed.push("ACTUAL_MTLS_STOP_BLOCKS_ALL_ECONOMIC_SERVICE_ROLES");
  stage = "STOP_REOPEN";
  await monitor.close(); await fixture.restartAuthority();
  store = new WindowsProtectedStore(opts); monitor = await open();
  assert.equal((await monitor.poll()).state, "HARD_STOP_INTEGRITY");
  assert.equal((await fixture.authority.status()).state, "HARD_STOP_INTEGRITY");
  assert.equal((await journal.snapshot()).revision, revision);
  passed.push("AUTHORITY_AND_MONITOR_REOPEN_NEVER_CLEAR_REAL_REORG_STOP");
  const live = await solana.snapshot(manifest);
  assert.equal(Buffer.from(live.accounts[2].data[0], "base64").readBigUInt64LE(36).toString(), state.operations[0].plan.depositIntent.amountAtomic);
  passed.push("READ_ONLY_CHAIN_OBSERVATION_CONTINUES_WITH_NO_REMINT_OR_CONFISCATION");
} catch {
  console.error("WINDOWS_LOCAL_RECONCILIATION_FAILED:" + stage + ":" + observedState + ":" + observedReason);
  console.error(JSON.stringify({ event: "LAST_SOURCE_RESULTS", sources: lastSources }));
  if (fixture) { try { console.error(JSON.stringify({ event: "FIXED_IPC_DIAGNOSTICS", transports: await fixture.diagnostics() })); }
    catch { console.error("FIXED_IPC_DIAGNOSTICS_UNAVAILABLE"); } }
  process.exitCode = 1;
}
finally {
  try { await fixture?.close(); } catch { console.error("WINDOWS_LOCAL_RECONCILIATION_CLEANUP_FAILED"); process.exitCode = 1; }
  try { await command?.("STOP"); } catch { console.error("WINDOWS_LOCAL_RECONCILIATION_STOP_FAILED"); process.exitCode = 1; }
}
if (!process.exitCode) console.log(JSON.stringify({ pass: passed.length, fail: 0, passed, scope: "CURRENT_PRINCIPAL_REAL_CHAINS_NOT_FULL_FLOW_OR_CROSS_ACCOUNT",
  productionReady: false, mainnetActivation: "DISABLED", nativePayout: "NOT_RUN_BY_THIS_TEST" }));
