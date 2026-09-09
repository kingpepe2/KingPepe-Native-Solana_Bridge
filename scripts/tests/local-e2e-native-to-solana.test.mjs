import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  LOCAL_NATIVE_TO_SOLANA_BLOCKED,
  LOCAL_NATIVE_TO_SOLANA_DEPOSIT_OBSERVED,
  LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
  LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
  createNativeToSolanaFlowConfig,
  executeNativeDepositObservationFlow,
  findDepositOutput,
  runLocalNativeToSolanaE2e,
  validateDepositUtxo,
} from "../local-e2e-native-to-solana.mjs";
import { createLocalE2ePlan } from "../local-e2e-orchestrator.mjs";
import { REQUIRED_LOCAL_E2E_EXECUTABLES } from "../local-e2e-readiness.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const DEPOSIT_TXID = h("phase08-real-daemon-deposit-txid");
const SCRIPT_HEX = `5120${h("phase08-local-deposit-script")}`;

test("native-to-solana runner blocks before executing deposit flow when local infrastructure is missing", async () => {
  const executor = new FakeExecutor();
  const result = await runLocalNativeToSolanaE2e({
    repoRoot: REPO_ROOT,
    runRoot: path.join(os.tmpdir(), "kingpepe-native-to-solana-blocked"),
    envPath: "",
    platform: "linux",
    executor,
  });

  assert.equal(result.protocol, LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL);
  assert.equal(result.state, LOCAL_NATIVE_TO_SOLANA_BLOCKED);
  assert.equal(result.reason, "READINESS_BLOCKED");
  assert.equal(result.productionReady, false);
  assert.equal(result.mainnetActivation, "DISABLED");
  assert.equal(result.fullNativeToSolanaE2e, "NOT_RUN_INFRASTRUCTURE_BLOCKED");
  assert.deepEqual(executor.calls, []);
});

test("native-to-solana runner executes daemon deposit observation sequence without an admin approval state", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-runner-"));
  const executor = new FakeExecutor();
  try {
    const result = await runLocalNativeToSolanaE2e({
      plan: readyPlan(runRoot),
      executor,
      programArtifactExists: () => true,
      healthAttempts: 1,
      flowConfig: {
        runId: "test-run",
        amountNative: "1.00000000",
      },
    });

    assert.equal(result.state, LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY);
    assert.equal(result.reason, "NATIVE_RESERVE_SWEEP_CONSTRUCTION_PENDING");
    assert.equal(result.fullNativeToSolanaE2e, "NOT_RUN_FULL_FLOW_NATIVE_RESERVE_SWEEP_PENDING");
    assert.equal(result.nativeToSolanaE2e.completedStage, LOCAL_NATIVE_TO_SOLANA_DEPOSIT_OBSERVED);
    assert.equal(result.nativeToSolanaE2e.noPerTransferKingPepeTeamApprovalState, true);
    assert.equal(result.nativeToSolanaE2e.deposit.txidHex, DEPOSIT_TXID);
    assert.equal(result.nativeToSolanaE2e.deposit.vout, 1);
    assert.equal(result.nativeToSolanaE2e.deposit.amountAtomic, "100000000");
    assert.match(result.nativeToSolanaE2e.stateRoot, /^\$\{LOCAL_E2E_RUN_ROOT\}/u);
    assert.equal(result.nativeToSolanaE2e.stateRoot.includes(runRoot), false);
    assert.doesNotMatch(JSON.stringify(result), /WAITING_FOR_ADMIN_APPROVAL/u);
    assert.deepEqual(
      executor.calls.filter((step) => step.startsWith("LOCAL_E2E_")),
      [
        "LOCAL_E2E_CREATE_USER_WALLET",
        "LOCAL_E2E_CREATE_DEPOSIT_WALLET",
        "LOCAL_E2E_GET_USER_MINING_ADDRESS",
        "LOCAL_E2E_MINE_USER_FUNDS",
        "LOCAL_E2E_CREATE_NATIVE_DEPOSIT_INTENT",
        "LOCAL_E2E_SEND_NATIVE_DEPOSIT",
        "LOCAL_E2E_MINE_DEPOSIT_FINALITY",
        "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
        "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT",
      ],
    );
    assert(executor.commandArgs.some((args) => args.includes("sendtoaddress")));
    assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("flow config keeps local runtime state under the local E2E run root and outside the repository", () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-config-"));
  try {
    const plan = readyPlan(runRoot);
    const config = createNativeToSolanaFlowConfig({
      plan,
      repoRoot: REPO_ROOT,
      runId: "config-test",
    });
    assert.equal(config.amountAtomic, "100000000");
    assert.equal(path.relative(runRoot, config.stateRoot).startsWith(".."), false);
    assert.throws(
      () =>
        createNativeToSolanaFlowConfig({
          plan,
          repoRoot: REPO_ROOT,
          stateRoot: path.join(REPO_ROOT, "local-private-state"),
        }),
      /StateRootInsideRepositoryRejected/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("deposit output and UTXO validation reject ambiguous or unsafe observations", () => {
  assert.throws(
    () =>
      findDepositOutput({
        rawTransaction: {
          vout: [
            {
              n: 0,
              value: "1.00000000",
              scriptPubKey: { hex: SCRIPT_HEX, address: "bcrt1deposit" },
            },
            {
              n: 1,
              value: "1.00000000",
              scriptPubKey: { hex: SCRIPT_HEX, address: "bcrt1deposit" },
            },
          ],
        },
        depositAddress: "bcrt1deposit",
        amountAtomic: "100000000",
        nativeDecimals: 8,
      }),
    /LocalNativeDepositOutputNotUnique/u,
  );

  assert.throws(
    () =>
      validateDepositUtxo({
        utxo: {
          value: "1.00000000",
          scriptPubKey: { hex: SCRIPT_HEX },
          confirmations: 5,
        },
        output: {
          amountAtomic: "100000000",
          scriptPubKeyHex: SCRIPT_HEX,
        },
        expectedConfirmations: 6,
        nativeDecimals: 8,
      }),
    /LocalNativeDepositUtxoFinalityInsufficient/u,
  );
});

test("deposit observation flow rejects missing deposit output before claiming E2E completion", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-missing-output-"));
  try {
    const plan = readyPlan(runRoot);
    const executor = new FakeExecutor({
      outputs: new Map([
        [
          "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
          JSON.stringify({
            txid: DEPOSIT_TXID,
            vout: [
              {
                n: 0,
                value: "1.00000000",
                scriptPubKey: { hex: SCRIPT_HEX, address: "bcrt1other" },
              },
            ],
          }),
        ],
      ]),
    });
    await assert.rejects(
      () =>
        executeNativeDepositObservationFlow({
          plan,
          executor,
          commandPaths: commandPathMap(),
          flowConfig: createNativeToSolanaFlowConfig({
            plan,
            repoRoot: REPO_ROOT,
            runId: "missing-output",
          }),
        }),
      /LocalNativeDepositOutputNotUnique/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

function readyPlan(runRoot) {
  return createLocalE2ePlan({
    repoRoot: REPO_ROOT,
    runRoot,
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

function commandPathMap() {
  return new Map(REQUIRED_LOCAL_E2E_EXECUTABLES.map((command) => [command, `/fake/bin/${command}`]));
}

class FakeExecutor {
  constructor(options = {}) {
    this.outputs = options.outputs ?? new Map();
    this.failures = options.failures ?? new Set();
    this.calls = [];
    this.commandArgs = [];
    this.started = [];
    this.stopped = [];
  }

  async runOneShot(command) {
    this.calls.push(command.step);
    this.commandArgs.push(command.args ?? []);
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
  if (step === "LOCAL_E2E_GET_USER_MINING_ADDRESS") return "bcrt1qkingpepeminingaddress";
  if (step === "LOCAL_E2E_CREATE_NATIVE_DEPOSIT_INTENT") return "bcrt1qkingpepedepositaddress";
  if (step === "LOCAL_E2E_SEND_NATIVE_DEPOSIT") return DEPOSIT_TXID;
  if (step === "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION") {
    return JSON.stringify({
      txid: DEPOSIT_TXID,
      vout: [
        {
          n: 0,
          value: "0.25000000",
          scriptPubKey: { hex: `5120${h("change-script")}`, address: "bcrt1change" },
        },
        {
          n: 1,
          value: "1.00000000",
          scriptPubKey: {
            hex: SCRIPT_HEX,
            address: "bcrt1qkingpepedepositaddress",
          },
        },
      ],
    });
  }
  if (step === "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT") {
    return JSON.stringify({
      value: "1.00000000",
      scriptPubKey: { hex: SCRIPT_HEX },
      confirmations: 6,
    });
  }
  return `${step} ok`;
}

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}
