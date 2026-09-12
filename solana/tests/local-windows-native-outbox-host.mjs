// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Disposable live-chain test control. No production RPC or service authority.
import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runLocalProtectedClaimObservation } from "./local-protected-claim-observation.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { validateRuntimeStateRoot, validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../..");
let failureStage = "START";
try {
  assert.equal(process.platform, "linux");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  const file = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const sourceSha = process.env.KINGPEPE_TEST_SOURCE_SHA; assert.match(sourceSha, /^[0-9a-f]{40}$/u);
  const result = await runLocalProtectedClaimObservation(repoRoot, async f => {
    failureStage = "FINAL_MINT";
    assert.equal(f.flow.state, "COMPLETED"); assert.equal(f.flow.reconciliation.state, "RECONCILED");
    writeFileSync(file("completed"), "COMPLETED", { flag: "wx", mode: 0o600 });
  }, async f => {
    failureStage = "BEFORE_BROADCAST";
    const { plan, executor, commandPaths } = f.context;
    const manifest = await localDeploymentManifest({ context: { ...f.context, flowConfig: f.flowConfig,
      localSolanaSetupContext: f.setup, nativeSource: { nativeGenesisHash: f.policy.nativeGenesis } },
      authority: "11111111111111111111111111111111", sourceSha });
    copyFileSync(path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), file("disposable-rpc.cookie"), constants.COPYFILE_EXCL);
    writeFileSync(file("fixture.json"), JSON.stringify({ protocol: "KINGPEPE_NATIVE_OUTBOX_CHAIN_FIXTURE_V1",
      policy: f.policy, manifest, delivery: { plan: f.operationPlan, signedTransactionHex: f.signedTransactionHex },
      nativeRpcPort: plan.ports.nativeRpcPort, solanaRpcPort: plan.ports.solanaRpcPort }), { flag: "wx", mode: 0o600 });
    writeFileSync(file("ready"), "LOCAL_CHAINS_READY", { flag: "wx", mode: 0o600 });
    let completed = false;
    const until = Date.now() + 30 * 60 * 1000;
    for (let sequence = 1; sequence <= 64; sequence++) {
      const request = file("request-" + sequence + ".json");
      while (!existsSync(request)) { assert(Date.now() < until, "WindowsOutboxHarnessTimeout"); await delay(200); }
      const bytes = readFileSync(request); assert(bytes.length < 256);
      const value = JSON.parse(bytes); assert.deepEqual(Object.keys(value).sort(), ["action", "sequence"]);
      assert.equal(value.sequence, sequence); assert(["ADVANCE", "DELIVERED", "ABORT"].includes(value.action));
      if (value.action === "ADVANCE") {
        const cli = async (command, parameters = []) => executor.runOneShot({ step: "LOCAL_OUTBOX_TEST_" + command.toUpperCase(),
          executable: commandPaths.get("kingpepe-cli"), args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir,
            rpcPort: plan.ports.nativeRpcPort, wallet: f.flowConfig.userWalletName, command, parameters }), cwd: repoRoot });
        const address = String((await cli("getnewaddress")).output).trim();
        await cli("generateblock", [address, "[]"]); // Never include a sweep while testing uncertain broadcast.
      }
      writeFileSync(file("response-" + sequence + ".json"), JSON.stringify(value), { flag: "wx", mode: 0o600 });
      assert.notEqual(value.action, "ABORT", "WindowsOutboxProbeFailed");
      if (value.action === "DELIVERED") { completed = true; break; }
    }
    assert(completed); failureStage = "AFTER_REAL_PROTECTED_DELIVERY";
  });
  assert.equal(result.pass, 14);
  console.log(JSON.stringify({ state: "COMPLETED", chainChecks: result.pass, productionReady: false, nativePayout: "NOT_RUN_BY_THIS_TEST" }));
} catch { console.error("LOCAL_WINDOWS_NATIVE_OUTBOX_HOST_FAILED:" + failureStage); process.exitCode = 1; }
