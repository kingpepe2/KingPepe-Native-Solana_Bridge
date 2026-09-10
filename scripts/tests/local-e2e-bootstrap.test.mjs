import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BLOCKED_LOCAL_E2E_VERSION_MISMATCH,
  BLOCKED_PROGRAM_ARTIFACT_MISSING,
  LOCAL_E2E_BOOTSTRAP_BLOCKED,
  LOCAL_E2E_BOOTSTRAP_FAILED,
  LOCAL_E2E_BOOTSTRAP_READY,
  LOCAL_E2E_FLOW_FAILED,
  runLocalE2eBootstrap,
  withLocalE2eInfrastructure,
} from "../local-e2e-bootstrap.mjs";
import { createLocalE2ePlan } from "../local-e2e-orchestrator.mjs";
import { REQUIRED_LOCAL_E2E_EXECUTABLES } from "../local-e2e-readiness.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

test("bootstrap exits blocked before executing commands when readiness is blocked", async () => {
  const executor = new FakeExecutor();
  const result = await runLocalE2eBootstrap({
    repoRoot: REPO_ROOT,
    runRoot: path.join(os.tmpdir(), "kingpepe-bootstrap-blocked"),
    envPath: "",
    platform: "linux",
    executor,
  });
  assert.equal(result.state, LOCAL_E2E_BOOTSTRAP_BLOCKED);
  assert.equal(result.reason, "READINESS_BLOCKED");
  assert.equal(result.productionReady, false);
  assert.equal(result.mainnetActivation, "DISABLED");
  assert.deepEqual(executor.calls, []);
});

test("bootstrap runs build and service health checks with fake complete toolchain", async () => {
  const executor = new FakeExecutor();
  const plan = readyPlan();
  const result = await runLocalE2eBootstrap({
    plan,
    executor,
    programArtifactExists: () => true,
    healthAttempts: 1,
  });
  assert.equal(result.state, LOCAL_E2E_BOOTSTRAP_READY);
  assert.equal(result.reason, "LOCAL_INFRASTRUCTURE_BOOTSTRAPPED");
  assert.equal(result.fullNativeToSolanaE2e, "NOT_RUN_BY_BOOTSTRAP");
  assert.deepEqual(result.commandsStarted, ["START_SOLANA_LOCAL_VALIDATOR", "START_KINGPEPE_REGTEST"]);
  assert.deepEqual(executor.started, ["START_SOLANA_LOCAL_VALIDATOR", "START_KINGPEPE_REGTEST"]);
  assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
  assert(executor.calls.includes("BUILD_SBF_KINGPEPE_TRANSCEIVER"));
  assert(executor.calls.includes("BUILD_SBF_KINGPEPE_BRIDGE"));
  assert(executor.calls.includes("CHECK_SOLANA_LOCAL_VALIDATOR_HEALTH"));
  assert(executor.calls.includes("CHECK_KINGPEPE_REGTEST_HEALTH"));
  assert.equal(result.plan.repoRoot, "${REPO_ROOT}");
  assert.equal(result.plan.runRoot, "${LOCAL_E2E_RUN_ROOT}");
});

test("infrastructure harness keeps services active while an injected local E2E flow runs", async () => {
  const executor = new FakeExecutor();
  const result = await withLocalE2eInfrastructure(
    {
      plan: readyPlan(),
      executor,
      programArtifactExists: () => true,
      healthAttempts: 1,
    },
    async ({ commandPaths, services }) => {
      executor.calls.push("RUN_NATIVE_TO_SOLANA_FLOW");
      assert.equal(commandPaths.get("kingpeped"), "/fake/bin/kingpeped");
      assert.deepEqual(services.map((service) => service.step), [
        "START_SOLANA_LOCAL_VALIDATOR",
        "START_KINGPEPE_REGTEST",
      ]);
      return {
        fullNativeToSolanaE2e: "FLOW_CALLBACK_EXECUTED_BY_TEST",
        nativeToSolanaFlowState: "READY_FOR_REAL_DAEMON_FLOW",
        state: "MUST_NOT_OVERRIDE_BOOTSTRAP_STATE",
      };
    },
  );

  assert.equal(result.state, LOCAL_E2E_BOOTSTRAP_READY);
  assert.equal(result.reason, "LOCAL_INFRASTRUCTURE_BOOTSTRAPPED");
  assert.equal(result.fullNativeToSolanaE2e, "FLOW_CALLBACK_EXECUTED_BY_TEST");
  assert.equal(result.nativeToSolanaFlowState, "READY_FOR_REAL_DAEMON_FLOW");
  assert.deepEqual(result.commandsStarted, ["START_SOLANA_LOCAL_VALIDATOR", "START_KINGPEPE_REGTEST"]);
  assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
  assert(executor.calls.indexOf("CHECK_KINGPEPE_REGTEST_HEALTH") < executor.calls.indexOf("RUN_NATIVE_TO_SOLANA_FLOW"));
});

test("infrastructure harness stops services and does not report E2E pass when injected flow fails", async () => {
  const executor = new FakeExecutor();
  const result = await withLocalE2eInfrastructure(
    {
      plan: readyPlan(),
      executor,
      programArtifactExists: () => true,
      healthAttempts: 1,
    },
    async () => {
      throw new Error("synthetic Native to Solana flow failure");
    },
  );

  assert.equal(result.state, LOCAL_E2E_BOOTSTRAP_FAILED);
  assert.equal(result.reason, LOCAL_E2E_FLOW_FAILED);
  assert.equal(result.fullNativeToSolanaE2e, "FAILED");
  assert.equal(result.error, "Local economic flow failed");
  assert(!JSON.stringify(result).includes("synthetic Native to Solana flow failure"));
  assert.deepEqual(result.commandsStarted, ["START_SOLANA_LOCAL_VALIDATOR", "START_KINGPEPE_REGTEST"]);
  assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
});

test("bootstrap blocks mismatched KingPepe REGTEST versions before starting services", async () => {
  const executor = new FakeExecutor({
    outputs: new Map([["CHECK_KINGPEPED_VERSION", "KingPepe Core version v0.0.0"]]),
  });
  const result = await runLocalE2eBootstrap({
    plan: readyPlan(),
    executor,
    programArtifactExists: () => true,
  });
  assert.equal(result.state, LOCAL_E2E_BOOTSTRAP_FAILED);
  assert.equal(result.reason, BLOCKED_LOCAL_E2E_VERSION_MISMATCH);
  assert.deepEqual(executor.started, []);
});

test("bootstrap requires SBF build artifacts before starting validators", async () => {
  const executor = new FakeExecutor();
  const result = await runLocalE2eBootstrap({
    plan: readyPlan(),
    executor,
    programArtifactExists: () => false,
  });
  assert.equal(result.state, BLOCKED_PROGRAM_ARTIFACT_MISSING);
  assert.equal(result.reason, "SBF_BUILD_ARTIFACT_MISSING");
  assert.deepEqual(executor.started, []);
});

test("bootstrap rejects SDK and validator version substitutions before building", async () => {
  for (const step of ["CHECK_SOLANA_VERSION", "CHECK_SOLANA_TEST_VALIDATOR_VERSION", "CHECK_CARGO_BUILD_SBF_VERSION"]) {
    const executor = new FakeExecutor({ outputs: new Map([[step, "Solana 1.18.260"]]) });
    const result = await runLocalE2eBootstrap({ plan: readyPlan(), executor });
    assert.equal(result.reason, BLOCKED_LOCAL_E2E_VERSION_MISMATCH);
    assert(!executor.calls.some((entry) => entry.startsWith("BUILD_SBF_")));
    assert.deepEqual(executor.started, []);
  }
});

test("bootstrap stops started services if a health check fails", async () => {
  const executor = new FakeExecutor({
    failures: new Set(["CHECK_SOLANA_LOCAL_VALIDATOR_HEALTH"]),
  });
  const result = await runLocalE2eBootstrap({
    plan: readyPlan(),
    executor,
    programArtifactExists: () => true,
    healthAttempts: 1,
  });
  assert.equal(result.state, LOCAL_E2E_BOOTSTRAP_FAILED);
  assert.deepEqual(executor.started, ["START_SOLANA_LOCAL_VALIDATOR", "START_KINGPEPE_REGTEST"]);
  assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
});

function readyPlan() {
  return createLocalE2ePlan({
    repoRoot: REPO_ROOT,
    runRoot: path.join(os.tmpdir(), "kingpepe-bootstrap-ready"),
    readiness: {
      protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_E2E_READINESS/V1",
      state: "READY",
      requiredExecutables: REQUIRED_LOCAL_E2E_EXECUTABLES.map((command) => ({
        command,
        state: "FOUND",
        path: `/fake/bin/${command}`,
      })),
      solanaPrograms: [],
      anchorConfig: { state: "READY", reason: "LOCALNET_PROGRAM_IDS_CONFIGURED" },
      blockers: [],
      canRunRealLocalE2e: true,
    },
  });
}

class FakeExecutor {
  constructor(options = {}) {
    this.outputs = options.outputs ?? new Map();
    this.failures = options.failures ?? new Set();
    this.calls = [];
    this.started = [];
    this.stopped = [];
  }

  async runOneShot(command) {
    this.calls.push(command.step);
    if (this.failures.has(command.step)) {
      throw new Error(`${command.step} rejected by fake executor`);
    }
    return {
      step: command.step,
      output: this.outputs.get(command.step) ?? defaultOutput(command.step),
    };
  }

  startLongRunning(command) {
    this.started.push(command.step);
    return {
      step: command.step,
      stop: async () => {
        this.stopped.push(command.step);
      },
    };
  }
}

function defaultOutput(step) {
  if (step === "CHECK_KINGPEPED_VERSION" || step === "CHECK_KINGPEPE_CLI_VERSION") {
    return "KingPepe Core version v31.1.0";
  }
  if (["CHECK_SOLANA_VERSION", "CHECK_SOLANA_TEST_VALIDATOR_VERSION", "CHECK_CARGO_BUILD_SBF_VERSION"].includes(step)) {
    return "Solana 1.18.26";
  }
  return `${step} ok`;
}
