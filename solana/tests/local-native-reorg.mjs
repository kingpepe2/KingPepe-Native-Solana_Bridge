// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Regtest-only actual deep-fork response. No automatic repair or Phase 09.
import assert from "node:assert/strict";
import { readFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { initialNativeProgress, retainVerifiedReserveBasis, compareNativeProgress } from "../../native/node/native-integrity.mjs";
import { verifiedReserveChain } from "../../native/node/native-raw-evidence.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";

// This restart checks policy replay in a separate actual process. The file is
// PUBLIC TEST EVIDENCE ONLY, not the protected Windows operational store. Its
// successful replay must not be described as cross-service/DPAPI certification.
async function restartedComparison(repoRoot, stateFile, observed, expectedPolicy) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--resume-test-incident"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const input = Buffer.from(JSON.stringify({ repoRoot, stateFile, observed, expectedPolicy }));
  try {
    return await new Promise((resolve, reject) => {
      let output = "", size = 0; const timer = setTimeout(() => { child.kill(); reject(new Error("NATIVE_REORG_RESTART_TIMEOUT")); }, 10000);
      child.on("error", () => { clearTimeout(timer); reject(new Error("NATIVE_REORG_RESTART_FAILED")); });
      child.stdin.on("error", () => {});
      child.stderr.on("data", () => { child.kill(); });
      child.stdout.on("data", b => { size += b.length; if (size > 1024) child.kill(); else output += b.toString("utf8"); });
      child.on("close", code => { clearTimeout(timer); if (code !== 0) reject(new Error("NATIVE_REORG_RESTART_FAILED"));
        else { try { resolve(JSON.parse(output)); } catch { reject(new Error("NATIVE_REORG_RESTART_FAILED")); } } });
      child.stdin.end(input);
    });
  } finally { input.fill(0); }
}

export async function runLocalNativeReorg(repoRoot) {
  const passed = []; let stage = "BOOTSTRAP", failure;
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    try {
      const { plan, executor, commandPaths } = context;
      const setup = createLocalSolanaSetupContext(), flowConfig = createNativeToSolanaFlowConfig({ plan, repoRoot, mintHex: setup.mintHex,
        keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
      let verifier;
      stage = "FRESH_DEPOSIT";
      const flow = await executeNativeDepositObservationFlow({ ...context, flowConfig, localSolanaSetupContext: setup,
        nativeEvidenceVerifierFactory: async input => { verifier = await createLocalNativeEvidenceVerifier(input); return verifier; } });
      assert.equal(flow.state, "COMPLETED"); passed.push("FRESH_NATIVE_FROST_ATTESTATION_MINT_RECONCILED");
      const receipt = flow.nativeRawEvidence.reserveEvidence;
      const expectedPolicy = { environment: "localnet", nativeGenesis: flow.nativeSource.nativeGenesisHash,
        solanaDeployment: flowConfig.solanaDeploymentHex, keyEpoch: flowConfig.keyEpoch, minimumConfirmations: flowConfig.depositFinalityBlocks, maximumStallMs: 300000 };
      let stored = retainVerifiedReserveBasis(initialNativeProgress(expectedPolicy, verifiedReserveChain(receipt)), receipt, flow.depositClaim.operationIdHex, expectedPolicy);
      assert.equal(stored.bases.length, 1); assert.equal(stored.bases[0].amountAtomic, flowConfig.amountAtomic);
      const duplicate = retainVerifiedReserveBasis(stored, receipt, flow.depositClaim.operationIdHex, expectedPolicy);
      assert.equal(duplicate.bases.length, 1); passed.push("VERIFIED_RESERVE_BASIS_RETAINED_WITHOUT_DUPLICATE_ALLOCATION");
      const cli = async (command, parameters = [], wallet = undefined) => {
        assert(["getnewaddress", "invalidateblock", "reconsiderblock", "generateblock", "getblockhash"].includes(command));
        const result = await executor.runOneShot({ step: "LOCAL_NATIVE_REORG_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
        return String(result.output).trim();
      };
      const address = await cli("getnewaddress", [], flowConfig.userWalletName);
      const generateEmpty = async n => { for (let i = 0; i < n; i++) await cli("generateblock", [address, "[]"]); };
      const supply = async () => {
        const response = await fetch(`http://127.0.0.1:${plan.ports.solanaRpcPort}`, { method: "POST", signal: AbortSignal.timeout(10000),
          headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [setup.mintBase58, { commitment: "finalized" }] }) });
        const v = await response.json(); assert.equal(v.error, undefined); assert.equal(v.id, 1);
        assert.match(v.result.value.amount, /^(0|[1-9][0-9]*)$/u); return v.result.value.amount;
      };
      const mintedSupply = await supply(); assert.equal(mintedSupply, flowConfig.amountAtomic);
      stage = "SHALLOW_REORG";
      let observed = await verifier.observeChain(); assert(observed.tipHeight > receipt.reserveBasis.sweep.height);
      await cli("invalidateblock", [observed.tipHash]);
      const shorter = await verifier.observeChain();
      assert.equal(compareNativeProgress(stored, shorter, expectedPolicy).state, "WAITING_FOR_DEPENDENCY");
      passed.push("REAL_LOWER_WORK_OBSERVATION_SUSPENDS_NOT_DEFICIT");
      await generateEmpty(2); observed = await verifier.observeChain();
      let decision = compareNativeProgress(stored, observed, expectedPolicy);
      assert.equal(decision.state, "OBSERVED_MATCH"); stored = decision.progress;
      passed.push("REAL_HIGHER_WORK_SHALLOW_REORG_PRESERVES_ACCEPTED_BASIS");
      stage = "POST_MINT_DEEP_REORG";
      const originalSweepBlock = receipt.reserveBasis.sweep.blockHash, sweepHeight = receipt.reserveBasis.sweep.height;
      await cli("invalidateblock", [originalSweepBlock]);
      // Exclude all mempool transactions, so the old sweep is not automatically
      // re-mined into the competing branch. This is an isolated regtest control.
      await generateEmpty(stored.tipHeight - sweepHeight + 3);
      observed = await verifier.observeChain();
      const competingBlock = observed.headerHashes[sweepHeight]; assert.notEqual(competingBlock, originalSweepBlock);
      decision = compareNativeProgress(stored, observed, expectedPolicy);
      assert.equal(decision.state, "HARD_STOP_INTEGRITY"); assert.equal(decision.incident.affectedReserveAtomic, flowConfig.amountAtomic);
      assert.deepEqual(decision.incident.affected, [flow.depositClaim.operationIdHex]);
      assert.deepEqual(decision.progress.bases, stored.bases); passed.push("REAL_POST_MINT_HIGHER_WORK_FORK_IDENTIFIES_EXACT_BACKING_INCIDENT");
      assert.equal(await supply(), mintedSupply); passed.push("NO_REMINT_CONFISCATION_OR_AUTOMATIC_SUPPLY_REPAIR");
      stage = "INCIDENT_PROCESS_RESTART";
      const stateFile = validateRuntimeFile(path.join(plan.runRoot, "public-test-reorg-incident.json"), repoRoot);
      const fd = openSync(stateFile, "wx", 0o600); try { const bytes = Buffer.from(JSON.stringify(decision.progress)); writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
      const restarted = await restartedComparison(repoRoot, stateFile, observed, expectedPolicy);
      assert.equal(restarted.state, "HARD_STOP_INTEGRITY"); assert.equal(restarted.affectedReserveAtomic, flowConfig.amountAtomic);
      passed.push("ACTUAL_PROCESS_RESTART_REPLAYS_INCIDENT_POLICY_TEST_EVIDENCE");
      stage = "CHAIN_RECOVERY_DOES_NOT_CLEAR_STOP";
      await cli("invalidateblock", [competingBlock]);
      stage = "RECONSIDER_ACCEPTED_SWEEP"; await cli("reconsiderblock", [originalSweepBlock]);
      stage = "EXTEND_RECONSIDERED_CHAIN"; await generateEmpty(3);
      stage = "VERIFY_RECOVERED_CHAIN"; const healthy = await verifier.observeChain();
      assert.equal(healthy.headerHashes[sweepHeight], originalSweepBlock);
      stage = "RESTART_WITH_HEALTHY_CHAIN";
      assert.equal((await restartedComparison(repoRoot, stateFile, healthy, expectedPolicy)).state, "HARD_STOP_INTEGRITY");
      assert.equal(await supply(), mintedSupply); passed.push("REAL_CHAIN_RECOVERY_CANNOT_AUTOMATICALLY_CLEAR_INCIDENT");
      return { nativeReorg: { pass: passed.length, fail: 0, passed,
        scope: "Actual regtest forks after real Solana mint; independent Rust headers and policy incident replay. Protected Windows/global-stop chain integration is separately required." },
        fullNativeToSolanaE2e: flow.state };
    } catch (error) {
      failure = { stage, passed: passed.length, testLine: Number(error.stack?.match(/local-native-reorg\.mjs:(\d+):/u)?.[1]) || undefined,
        code: /^(?:RAW_NATIVE_[A-Z_]+|Native[A-Za-z]+|NATIVE_REORG_[A-Z_]+)$/u.test(error.message) ? error.message : "LOCAL_NATIVE_REORG_CHECK_FAILED" };
      throw error;
    }
  });
  return { sourceScope: "PHASE_08_5", infrastructure: result.state, nativeReorg: result.nativeReorg,
    fullNativeToSolanaE2e: result.fullNativeToSolanaE2e, failure, phase09: "NOT_STARTED", productionReady: false, mainnetActivation: "DISABLED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--resume-test-incident") {
    try {
      const chunks = []; let size = 0;
      for await (const b of process.stdin) { size += b.length; if (size > 1_048_576) throw new Error("TEST_INPUT_LIMIT"); chunks.push(b); }
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8")), file = validateRuntimeFile(input.stateFile, input.repoRoot);
      const saved = readFileSync(file); if (saved.length > 1_048_576) throw new Error("TEST_STATE_LIMIT");
      const r = compareNativeProgress(JSON.parse(saved), input.observed, input.expectedPolicy);
      console.log(JSON.stringify({ state: r.state, affectedReserveAtomic: r.incident?.affectedReserveAtomic }));
    } catch { process.exitCode = 1; }
  } else {
    const result = await runLocalNativeReorg(path.resolve(import.meta.dirname, "../.."));
    console.log(JSON.stringify(result)); if (result.nativeReorg?.pass !== 8 || result.nativeReorg?.fail !== 0) process.exitCode = 1;
  }
}
