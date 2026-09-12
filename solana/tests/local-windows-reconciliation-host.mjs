// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Disposable WSL chain harness for a separate actual Windows DPAPI/mTLS reader.
// Files here are TEST CONTROL, not authenticated production service IPC.
import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runLocalProtectedClaimObservation } from "./local-protected-claim-observation.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { validateRuntimeStateRoot, validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
try {
  assert.equal(process.platform, "linux");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  const sourceSha = process.env.KINGPEPE_TEST_SOURCE_SHA; assert.match(sourceSha, /^[0-9a-f]{40}$/u);
  const result = await runLocalProtectedClaimObservation(repoRoot, async f => {
    const { plan, executor, commandPaths } = f.context;
    const manifest = await localDeploymentManifest({ context: { ...f.context, flowConfig: f.flowConfig,
      localSolanaSetupContext: f.setup, nativeSource: f.flow.nativeSource }, authority: "11111111111111111111111111111111", sourceSha });
    const file = name => validateRuntimeFile(path.join(root, name), repoRoot);
    copyFileSync(path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), file("disposable-rpc.cookie"), constants.COPYFILE_EXCL);
    writeFileSync(file("fixture.json"), JSON.stringify({ protocol: "KINGPEPE_WINDOWS_CHAIN_FIXTURE_V1",
      policy: f.policy, manifest, state: f.state, nativeRpcPort: plan.ports.nativeRpcPort, solanaRpcPort: plan.ports.solanaRpcPort }), { flag: "wx", mode: 0o600 });
    const cli = async (command, parameters = [], wallet = undefined) => {
      assert(["getnewaddress", "generateblock", "invalidateblock"].includes(command));
      const result = await executor.runOneShot({ step: "LOCAL_WINDOWS_RECONCILIATION_" + command.toUpperCase(),
        executable: commandPaths.get("kingpepe-cli"), args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir,
          rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
      return String(result.output).trim();
    };
    const address = await cli("getnewaddress", [], f.flowConfig.userWalletName);
    writeFileSync(file("ready"), "LOCAL_CHAINS_READY", { flag: "wx", mode: 0o600 });
    let forked = false, finished = false;
    const deadline = Date.now() + 30 * 60 * 1000;
    for (let sequence = 1; sequence <= 16; sequence++) {
      const request = file("request-" + sequence + ".json");
      while (!existsSync(request)) { assert(Date.now() < deadline, "WindowsChainHarnessTimedOut"); await delay(200); }
      const bytes = readFileSync(request); assert(bytes.length < 256);
      const value = JSON.parse(bytes); assert.deepEqual(Object.keys(value).sort(), ["action", "sequence"]);
      assert.equal(value.sequence, sequence); assert(["ADVANCE", "REORG", "STOP"].includes(value.action));
      if (value.action === "ADVANCE") { assert(!forked); await cli("generateblock", [address, "[]"]); }
      if (value.action === "REORG") {
        assert(!forked); forked = true;
        const old = await f.nativeVerifier.observeChain(), block = f.state.operations[0].finalizedCredit.reserveBasis.sweep;
        await cli("invalidateblock", [block.blockHash]);
        for (let n = 0; n < old.tipHeight - block.height + 3; n++) await cli("generateblock", [address, "[]"]);
      }
      writeFileSync(file("response-" + sequence + ".json"), JSON.stringify(value), { flag: "wx", mode: 0o600 });
      if (value.action === "STOP") { finished = true; break; }
    }
    assert(finished);
  });
  assert.equal(result.pass, 14);
  console.log(JSON.stringify({ state: "COMPLETED", claimPrerequisiteChecks: result.pass, productionReady: false, phase09: "NOT_STARTED" }));
} catch { console.error("LOCAL_WINDOWS_RECONCILIATION_HOST_FAILED"); process.exitCode = 1; }
