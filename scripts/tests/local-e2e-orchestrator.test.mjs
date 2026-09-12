import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BLOCKED_LOCAL_E2E,
  READY_TO_RUN_LOCAL_E2E,
  buildRegtestCliArguments,
  buildRegtestDaemonArguments,
  buildSolanaValidatorArguments,
  createLocalE2ePlan,
  initializeLocalE2eRunRoot,
  sanitizePlanForReport,
  validateLocalE2eRunRoot,
} from "../local-e2e-orchestrator.mjs";
import { REQUIRED_LOCAL_E2E_EXECUTABLES } from "../local-e2e-readiness.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

test("regtest command builders stay loopback-only and allowlist CLI commands", () => {
  const datadir = path.join(os.tmpdir(), "kingpepe-orchestrator-command-test");
  const daemonArgs = buildRegtestDaemonArguments({
    datadir,
    rpcPort: 18_443,
    p2pPort: 18_444,
  });
  assert.deepEqual(daemonArgs, [
    "-regtest=1",
    `-datadir=${path.resolve(datadir)}`,
    "-server=1",
    "-listen=0",
    "-connect=0",
    "-dnsseed=0",
    "-txindex=1",
    "-fallbackfee=0.00001000",
    "-rpcport=18443",
    "-rpcbind=127.0.0.1",
    "-rpcallowip=127.0.0.1",
    "-port=18444",
  ]);

  const cliArgs = buildRegtestCliArguments({
    datadir,
    rpcPort: 18_443,
    command: "getblockchaininfo",
  });
  assert.deepEqual(cliArgs, ["-regtest=1", `-datadir=${path.resolve(datadir)}`, "-rpcport=18443", "getblockchaininfo"]);
  assert.throws(
    () =>
      buildRegtestCliArguments({
        datadir,
        rpcPort: 18_443,
        command: "dumpprivkey",
      }),
    /allowlisted/u,
  );
  assert.throws(
    () =>
      buildRegtestCliArguments({
        datadir,
        rpcPort: 18_443,
        command: "signrawtransactionwithwallet",
      }),
    /allowlisted/u,
  );
  const broadcastArgs = buildRegtestCliArguments({
    datadir,
    rpcPort: 18_443,
    command: "sendrawtransaction",
    parameters: ["00"],
  });
  assert.deepEqual(broadcastArgs, [
    "-regtest=1",
    `-datadir=${path.resolve(datadir)}`,
    "-rpcport=18443",
    "sendrawtransaction",
    "00",
  ]);
});

test("orchestrator refuses runtime roots inside the source repository", () => {
  assert.throws(
    () => validateLocalE2eRunRoot(path.join(REPO_ROOT, "tmp-local-e2e"), REPO_ROOT),
    /outside the source repository/u,
  );
});

test("forced-fork test commands retain explicit REGTEST and isolated datadir arguments", () => {
  const datadir = path.join(os.tmpdir(), "kingpepe-forced-fork-command-test");
  for (const command of ["generateblock", "invalidateblock", "reconsiderblock"]) {
    const args = buildRegtestCliArguments({ datadir, rpcPort: 18443, command, parameters: [] });
    assert.deepEqual(args, ["-regtest=1", `-datadir=${path.resolve(datadir)}`, "-rpcport=18443", command]);
    assert.throws(() => buildRegtestCliArguments({ datadir, rpcPort: 18443, command: command + " -chain=main" }), /allowlisted/u);
  }
});

test("current environment plan remains blocked without local E2E executables", () => {
  const plan = createLocalE2ePlan({
    repoRoot: REPO_ROOT,
    runRoot: path.join(os.tmpdir(), "kingpepe-local-e2e-plan-blocked"),
    envPath: "",
    platform: "linux",
  });
  assert.equal(plan.state, BLOCKED_LOCAL_E2E);
  assert.equal(plan.productionReady, false);
  assert.equal(plan.mainnetActivation, "DISABLED");
  assert(plan.safetyAssertions.includes("NO_PER_TRANSFER_KINGPEPE_TEAM_APPROVAL"));
  for (const command of REQUIRED_LOCAL_E2E_EXECUTABLES) {
    assert(plan.blockers.includes(`MISSING_EXECUTABLE:${command}`));
  }
});

test("fake complete toolchain produces a ready local-only execution plan", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-local-e2e-orchestrator-"));
  const bin = path.join(root, "bin");
  const runRoot = path.join(root, "run");
  try {
    mkdirSync(bin, { recursive: true });
    for (const command of REQUIRED_LOCAL_E2E_EXECUTABLES) {
      const commandPath = path.join(bin, command);
      writeFileSync(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      chmodSync(commandPath, 0o700);
    }

    const plan = createLocalE2ePlan({
      repoRoot: REPO_ROOT,
      runRoot,
      // This fixture asserts its own target location, independently of the
      // developer's legitimate external build-cache environment override.
      buildRoot: path.join(runRoot, "cargo-target"),
      envPath: bin,
      platform: "linux",
    });
    assert.equal(plan.state, READY_TO_RUN_LOCAL_E2E);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.commands[0].step, "BUILD_SBF_KINGPEPE_TRANSCEIVER");
    assert.equal(plan.commands[1].step, "BUILD_SBF_KINGPEPE_BRIDGE");
    assert.equal(plan.commands[2].step, "START_SOLANA_LOCAL_VALIDATOR");
    assert.equal(plan.commands[3].step, "START_KINGPEPE_REGTEST");
    for (const build of plan.commands.slice(0, 2)) {
      assert.equal(build.executable, "cargo-build-sbf");
      assert(build.args.includes("--locked"));
      assert.equal(build.args[build.args.indexOf("--sbf-out-dir") + 1], plan.paths.sbfOutDir);
      const physicalRunRoot = path.join(realpathSync.native(root), "run");
      assert(build.args[build.args.indexOf("--target-dir") + 1].startsWith(physicalRunRoot + path.sep));
    }
    assert.notEqual(plan.commands[0].args.at(-1), plan.commands[1].args.at(-1));
    assert(plan.commands[2].args.includes("--bpf-program"));
    assert(!plan.commands[2].args.includes("--reset"));
    assert(plan.commands[3].args.includes("-listen=0"));

    const report = sanitizePlanForReport(plan);
    assert.equal(report.repoRoot, "${REPO_ROOT}");
    assert.equal(report.runRoot, "${LOCAL_E2E_RUN_ROOT}");
    assert.match(report.paths.nativeDatadir, /^\$\{LOCAL_E2E_RUN_ROOT\}[\\/]/u);
    assert.match(report.commands[0].cwd, /^\$\{REPO_ROOT\}[\\/]/u);
    assert(!JSON.stringify(report).includes(bin));
    assert.match(report.paths.bridgeProgramSo, /^\$\{LOCAL_E2E_RUN_ROOT\}[\\/]/u);
    initializeLocalE2eRunRoot(plan);
    assert(existsSync(plan.paths.nativeDatadir));
    assert(existsSync(plan.paths.sbfOutDir));
    assert.throws(() => initializeLocalE2eRunRoot(plan), /EEXIST/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run root validation rejects source ancestors and symlink or junction aliases", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-root-boundary-"));
  try {
    const repo = path.join(root, "repo");
    const alias = path.join(root, "alias");
    mkdirSync(repo);
    symlinkSync(repo, alias, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => validateLocalE2eRunRoot(root, repo), /outside the source repository/u);
    assert.throws(() => validateLocalE2eRunRoot(path.join(alias, "new-run"), repo), /outside the source repository/u);
    assert.throws(() => validateLocalE2eRunRoot(path.parse(root).root, repo), /outside|dedicated/u);
    assert(!existsSync(path.join(repo, "new-run")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("solana validator arguments reject malformed identities and privileged ports", () => {
  const ledgerDir = path.join(os.tmpdir(), "kingpepe-ledger-test");
  const programSo = path.join(os.tmpdir(), "kingpepe_bridge.so");
  const transceiverSo = path.join(os.tmpdir(), "kingpepe_transceiver.so");
  assert.throws(
    () =>
      buildSolanaValidatorArguments({
        ledgerDir,
        bridgeProgramId: "not-a-program-id",
        bridgeProgramSo: programSo,
        transceiverProgramId: "AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN",
        transceiverProgramSo: transceiverSo,
      }),
    /Solana base58/u,
  );
  assert.throws(
    () =>
      buildSolanaValidatorArguments({
        ledgerDir,
        bridgeProgramId: "EfoRF4BDDspsi53XYL62mCyhCtf3FceV5LpRkRdwYqKM",
        bridgeProgramSo: programSo,
        transceiverProgramId: "AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN",
        transceiverProgramSo: transceiverSo,
        rpcPort: 80,
      }),
    /non-privileged/u,
  );
});
