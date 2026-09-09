import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});

test("orchestrator refuses runtime roots inside the source repository", () => {
  assert.throws(
    () => validateLocalE2eRunRoot(path.join(REPO_ROOT, "tmp-local-e2e"), REPO_ROOT),
    /outside the source repository/u,
  );
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
      envPath: bin,
      platform: "linux",
    });
    assert.equal(plan.state, READY_TO_RUN_LOCAL_E2E);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.commands[0].step, "BUILD_SOLANA_PROGRAMS");
    assert.equal(plan.commands[1].step, "START_SOLANA_LOCAL_VALIDATOR");
    assert.equal(plan.commands[2].step, "START_KINGPEPE_REGTEST");
    assert(plan.commands[1].args.includes("--bpf-program"));
    assert(plan.commands[2].args.includes("-listen=0"));

    const report = sanitizePlanForReport(plan);
    assert.equal(report.repoRoot, "${REPO_ROOT}");
    assert.equal(report.runRoot, "${LOCAL_E2E_RUN_ROOT}");
    assert.match(report.paths.nativeDatadir, /^\$\{LOCAL_E2E_RUN_ROOT\}[\\/]/u);
    assert.match(report.commands[0].cwd, /^\$\{REPO_ROOT\}[\\/]/u);
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
