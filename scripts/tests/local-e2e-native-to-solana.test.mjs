import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  LOCAL_NATIVE_TO_SOLANA_BLOCKED,
  LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
  LOCAL_NATIVE_TO_SOLANA_TAPROOT_SIGHASHES_VALIDATED,
  LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
  createLocalFrostTaprootCustodyContext,
  createNativeToSolanaFlowConfig,
  draftLocalReserveSweep,
  executeNativeDepositObservationFlow,
  findDepositOutput,
  p2trScriptPubKeyHex,
  taprootAddressFromXOnlyPublicKey,
  validateLocalNativeSourceSnapshot,
  validateRawDepositTransaction,
  runLocalNativeToSolanaE2e,
  validateDepositUtxo,
} from "../local-e2e-native-to-solana.mjs";
import { createLocalE2ePlan } from "../local-e2e-orchestrator.mjs";
import { REQUIRED_LOCAL_E2E_EXECUTABLES } from "../local-e2e-readiness.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const DEPOSIT_TXID = h("phase08-real-daemon-deposit-txid");
const FEE_FUNDING_TXID = h("phase08-reserve-sweep-fee-funding-txid");
const FROST_AGGREGATE_XONLY_HEX = h("phase08-local-frost-aggregate-xonly");
const SCRIPT_HEX = p2trScriptPubKeyHex(FROST_AGGREGATE_XONLY_HEX);
const FEE_FUNDING_SCRIPT_HEX = SCRIPT_HEX;
const FROST_TAPROOT_ADDRESS = taprootAddressFromXOnlyPublicKey(FROST_AGGREGATE_XONLY_HEX, "rkpepe");
const REGTEST_GENESIS_HASH = h("kingpepe-regtest-genesis");
const REGTEST_BEST_BLOCK_HASH = h("kingpepe-regtest-best-block");
const UNSIGNED_SWEEP_HEX = buildUnsignedSweepHex();

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
      custodyFactory: fakeCustodyFactory,
      flowConfig: {
        runId: "test-run",
        amountNative: "1.00000000",
      },
    });

    assert.equal(result.state, LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY);
    assert.equal(result.reason, "FROST_RESERVE_SWEEP_SIGNATURES_PENDING");
    assert.equal(result.fullNativeToSolanaE2e, "NOT_RUN_FULL_FLOW_NATIVE_RESERVE_SWEEP_PENDING");
    assert.equal(result.nativeToSolanaE2e.completedStage, LOCAL_NATIVE_TO_SOLANA_TAPROOT_SIGHASHES_VALIDATED);
    assert.equal(result.nativeToSolanaE2e.noPerTransferKingPepeTeamApprovalState, true);
    assert.equal(result.nativeToSolanaE2e.deposit.txidHex, DEPOSIT_TXID);
    assert.equal(result.nativeToSolanaE2e.deposit.vout, 1);
    assert.equal(result.nativeToSolanaE2e.deposit.amountAtomic, "100000000");
    assert.equal(result.nativeToSolanaE2e.deposit.nativeNetwork, "regtest");
    assert.equal(result.nativeToSolanaE2e.deposit.nativeGenesisHash, REGTEST_GENESIS_HASH);
    assert.equal(result.nativeToSolanaE2e.deposit.sourceBestBlockHash, REGTEST_BEST_BLOCK_HASH);
    assert.equal(result.nativeToSolanaE2e.deposit.sourceBestHeight, 26);
    assert.equal(result.nativeToSolanaE2e.deposit.scriptPubKeyHex, SCRIPT_HEX);
    assert.match(result.nativeToSolanaE2e.deposit.proofFingerprintHex, /^[0-9a-f]{64}$/u);
    assert.equal(result.nativeToSolanaE2e.depositIntent.address, FROST_TAPROOT_ADDRESS);
    assert.equal(result.nativeToSolanaE2e.depositIntent.scriptPubKeyHex, SCRIPT_HEX);
    assert.equal(result.nativeToSolanaE2e.depositIntent.custody, "LOCAL_EPHEMERAL_FROST_TAPROOT");
    assert.equal(result.nativeToSolanaE2e.frostCustody.aggregateTweakedXOnlyPublicKey, FROST_AGGREGATE_XONLY_HEX);
    assert.equal(result.nativeToSolanaE2e.frostCustody.depositAddress, FROST_TAPROOT_ADDRESS);
    assert.equal(result.nativeToSolanaE2e.frostCustody.canonicalReserveAddress, FROST_TAPROOT_ADDRESS);
    assert.equal(result.nativeToSolanaE2e.nativeSource.trust, "RPC_OBSERVATION");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.state, "UNSIGNED_DRAFT_ONLY");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.reserveAmountAtomic, "100000000");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.nativeMinerFeeAtomic, "1000");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.reserveAmountNative, "1.00000000");
    assert.deepEqual(result.nativeToSolanaE2e.reserveSweep.feeFundingOutpoints, [`${FEE_FUNDING_TXID}:0`]);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.signed, false);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.broadcast, false);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionHex, UNSIGNED_SWEEP_HEX);
    assert.match(result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionFingerprintHex, /^[0-9a-f]{64}$/u);
    assert.match(result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionId, /^[0-9a-f]{64}$/u);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.taprootSighashEvidences.length, 2);
    assert.deepEqual(
      result.nativeToSolanaE2e.reserveSweep.taprootSighashEvidences.map((entry) => entry.signingInputIndex),
      [0, 1],
    );
    for (const evidence of result.nativeToSolanaE2e.reserveSweep.taprootSighashEvidences) {
      assert.equal(evidence.state, "LOCALLY_VALIDATED_NATIVE_SIGHASH");
      assert.equal(evidence.unsignedNativeTransactionFingerprintHex, result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionFingerprintHex);
      assert.equal(evidence.nativeSweepTxidHex, result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionId);
      assert.equal(evidence.recipientScriptPubKeyHex, SCRIPT_HEX);
      assert.equal(evidence.nativeMinerFeeAtomic, "1000");
      assert.match(evidence.taprootSighashHex, /^[0-9a-f]{64}$/u);
      assert.match(evidence.taprootSigMsgWithEpochHex, /^00/u);
    }
    assert.match(result.nativeToSolanaE2e.stateRoot, /^\$\{LOCAL_E2E_RUN_ROOT\}/u);
    assert.equal(result.nativeToSolanaE2e.stateRoot.includes(runRoot), false);
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_INITIALIZE_EPHEMERAL_FROST_CUSTODY"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_CREATE_FROST_TAPROOT_DEPOSIT_INTENT"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_SELECT_FROST_CANONICAL_RESERVE"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_COMPUTE_VALIDATED_TAPROOT_SIGHASHES"));
    assert.equal(
      result.nativeToSolanaE2e.nextRequiredImplementation.includes(
        "COMPUTE_VALIDATED_TAPROOT_SIGHASHES_FOR_EACH_FROST_CONTROLLED_INPUT",
      ),
      false,
    );
    const prohibitedApprovalState = "WAITING_FOR_" + "ADMIN_APPROVAL";
    assert.equal(JSON.stringify(result).includes(prohibitedApprovalState), false);
    assert.deepEqual(
      executor.calls.filter((step) => step.startsWith("LOCAL_E2E_")),
      [
        "LOCAL_E2E_CREATE_USER_WALLET",
        "LOCAL_E2E_GET_USER_MINING_ADDRESS",
        "LOCAL_E2E_MINE_USER_FUNDS",
        "LOCAL_E2E_SEND_NATIVE_DEPOSIT",
        "LOCAL_E2E_MINE_DEPOSIT_FINALITY",
        "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT",
        "LOCAL_E2E_OBSERVE_NATIVE_GENESIS_HASH",
        "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
        "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT",
        "LOCAL_E2E_FUND_RESERVE_SWEEP_FEE_INPUT",
        "LOCAL_E2E_MINE_RESERVE_SWEEP_FEE_FUNDING_FINALITY",
        "LOCAL_E2E_OBSERVE_RESERVE_SWEEP_FEE_FUNDING_TRANSACTION",
        "LOCAL_E2E_VERIFY_RESERVE_SWEEP_FEE_UTXO_UNSPENT",
        "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP",
      ],
    );
    assert(executor.commandArgs.some((args) => args.includes("sendtoaddress")));
    assert(executor.commandArgs.some((args) => args.includes("createrawtransaction")));
    assert(!executor.commandArgs.some((args) => args.includes("signrawtransactionwithwallet")));
    assert(!executor.commandArgs.some((args) => args.includes("sendrawtransaction")));
    assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("local FROST Taproot custody context derives disposable rkpepe P2TR custody outside the repository", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-frost-custody-"));
  try {
    const plan = readyPlan(runRoot);
    const config = createNativeToSolanaFlowConfig({
      plan,
      repoRoot: REPO_ROOT,
      runId: "frost-custody",
    });
    const custody = await createLocalFrostTaprootCustodyContext({
      plan,
      flowConfig: config,
    });

    assert.equal(custody.state, "READY");
    assert.equal(custody.localOnly, true);
    assert.deepEqual(custody.signerIds, ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]);
    assert.equal(custody.keyEpoch, 1);
    assert.match(custody.aggregateTweakedXOnlyPublicKey, /^[0-9a-f]{64}$/u);
    assert.equal(custody.taprootScriptPubKeyHex, p2trScriptPubKeyHex(custody.aggregateTweakedXOnlyPublicKey));
    assert.match(custody.taprootAddress, /^rkpepe1p[ac-hj-np-z02-9]+$/u);
    assert.equal(custody.taprootAddress.includes(String(REPO_ROOT)), false);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("Taproot address helper matches the BIP350 v1 witness address vector", () => {
  assert.equal(
    taprootAddressFromXOnlyPublicKey(
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      "bc",
    ),
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
  );
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
      findDepositOutput({
        rawTransaction: {
          vout: [
            {
              n: 0,
              value: "1.00000000",
              scriptPubKey: { hex: `5120${h("wrong-frost-script")}`, address: FROST_TAPROOT_ADDRESS },
            },
          ],
        },
        depositAddress: FROST_TAPROOT_ADDRESS,
        expectedScriptPubKeyHex: SCRIPT_HEX,
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

  assert.throws(
    () =>
      validateLocalNativeSourceSnapshot({
        blockchainInfo: {
          chain: "main",
          blocks: 107,
          headers: 107,
          bestblockhash: REGTEST_BEST_BLOCK_HASH,
          chainwork: "01",
          initialblockdownload: false,
        },
        genesisHash: REGTEST_GENESIS_HASH,
        expectedChain: "regtest",
      }),
    /LocalNativeSourceWrongNetwork/u,
  );

  assert.throws(
    () =>
      validateRawDepositTransaction({
        rawTransaction: {
          txid: h("different-deposit-txid"),
          vout: [],
        },
        expectedTxidHex: DEPOSIT_TXID,
      }),
    /LocalNativeDepositTxidMismatch/u,
  );
});

test("unsigned reserve sweep draft preserves credited reserve and requires explicit fee funding", async () => {
  const calls = [];
  const draft = await draftLocalReserveSweep({
    cli: async (request) => {
      calls.push(request);
      return UNSIGNED_SWEEP_HEX;
    },
    depositTxidHex: DEPOSIT_TXID,
    depositVout: 1,
    depositAmountAtomic: "100000000",
    nativeMinerFeeAtomic: "1000",
    nativeDecimals: 8,
    canonicalReserveAddress: FROST_TAPROOT_ADDRESS,
    feeFundingInputs: [{ txidHex: FEE_FUNDING_TXID, vout: 0 }],
    proofFingerprintHex: h("proof-fingerprint"),
  });

  assert.equal(draft.depositOutpoint, `${DEPOSIT_TXID}:1`);
  assert.equal(draft.reserveAmountAtomic, "100000000");
  assert.equal(draft.nativeMinerFeeAtomic, "1000");
  assert.equal(draft.reserveAmountNative, "1.00000000");
  assert.deepEqual(draft.feeFundingOutpoints, [`${FEE_FUNDING_TXID}:0`]);
  assert.equal(draft.unsignedNativeTransactionHex, UNSIGNED_SWEEP_HEX);
  assert.match(draft.unsignedNativeTransactionId, /^[0-9a-f]{64}$/u);
  assert.equal(draft.signed, false);
  assert.equal(draft.broadcast, false);
  assert.deepEqual(calls[0], {
    step: "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP",
    command: "createrawtransaction",
    parameters: [
      JSON.stringify([
        { txid: DEPOSIT_TXID, vout: 1 },
        { txid: FEE_FUNDING_TXID, vout: 0 },
      ]),
      JSON.stringify({ [FROST_TAPROOT_ADDRESS]: "1.00000000" }),
    ],
  });

  await assert.rejects(
    () =>
      draftLocalReserveSweep({
        cli: async () => UNSIGNED_SWEEP_HEX,
        depositTxidHex: DEPOSIT_TXID,
        depositVout: 1,
        depositAmountAtomic: "1000",
        nativeMinerFeeAtomic: "1000",
        nativeDecimals: 8,
        canonicalReserveAddress: FROST_TAPROOT_ADDRESS,
        proofFingerprintHex: h("proof-fingerprint"),
      }),
    /LocalNativeReserveSweepFeeFundingInputRequired/u,
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
          custodyFactory: fakeCustodyFactory,
        }),
      /LocalNativeDepositOutputNotUnique/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("deposit observation flow rejects wrong local Native source before reserve sweep construction", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-wrong-source-"));
  try {
    const plan = readyPlan(runRoot);
    const executor = new FakeExecutor({
      outputs: new Map([
        [
          "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT",
          JSON.stringify({
            chain: "main",
            blocks: 107,
            headers: 107,
            bestblockhash: REGTEST_BEST_BLOCK_HASH,
            chainwork: "01",
            initialblockdownload: false,
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
            runId: "wrong-source",
          }),
          custodyFactory: fakeCustodyFactory,
        }),
      /LocalNativeSourceWrongNetwork/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("deposit observation flow rejects raw transaction txid mismatch", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-wrong-txid-"));
  try {
    const plan = readyPlan(runRoot);
    const executor = new FakeExecutor({
      outputs: new Map([
        [
          "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
          JSON.stringify({
            txid: h("wrong-observed-deposit-txid"),
            vout: [
              {
                n: 1,
                value: "1.00000000",
                scriptPubKey: {
                  hex: SCRIPT_HEX,
                  address: FROST_TAPROOT_ADDRESS,
                },
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
            runId: "wrong-txid",
          }),
          custodyFactory: fakeCustodyFactory,
        }),
      /LocalNativeDepositTxidMismatch/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

function buildUnsignedSweepHex() {
  return buildUnsignedTransactionHex({
    inputs: [
      { txid: DEPOSIT_TXID, vout: 1 },
      { txid: FEE_FUNDING_TXID, vout: 0 },
    ],
    outputs: [{ amountAtomic: "100000000", scriptPubKeyHex: SCRIPT_HEX }],
  });
}

function buildUnsignedTransactionHex({ inputs, outputs }) {
  return [
    "02000000",
    varintHex(inputs.length),
    ...inputs.map((input) => `${reverse32(input.txid)}${uint32Hex(input.vout)}00ffffffff`),
    varintHex(outputs.length),
    ...outputs.map(
      (output) =>
        `${uint64Hex(BigInt(output.amountAtomic))}${varintHex(output.scriptPubKeyHex.length / 2)}${output.scriptPubKeyHex}`,
    ),
    "00000000",
  ].join("");
}

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

async function fakeCustodyFactory() {
  return {
    state: "READY",
    localOnly: true,
    keyEpoch: 1,
    signerIds: ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"],
    aggregateTweakedXOnlyPublicKey: FROST_AGGREGATE_XONLY_HEX,
    taprootScriptPubKeyHex: SCRIPT_HEX,
    taprootAddress: FROST_TAPROOT_ADDRESS,
  };
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
  if (step === "LOCAL_E2E_SEND_NATIVE_DEPOSIT") return DEPOSIT_TXID;
  if (step === "LOCAL_E2E_FUND_RESERVE_SWEEP_FEE_INPUT") return FEE_FUNDING_TXID;
  if (step === "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP") return UNSIGNED_SWEEP_HEX;
  if (step === "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT") {
    return JSON.stringify({
      chain: "regtest",
      blocks: 26,
      headers: 26,
      bestblockhash: REGTEST_BEST_BLOCK_HASH,
      chainwork: "01",
      initialblockdownload: false,
    });
  }
  if (step === "LOCAL_E2E_OBSERVE_NATIVE_GENESIS_HASH") return REGTEST_GENESIS_HASH;
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
            address: FROST_TAPROOT_ADDRESS,
          },
        },
      ],
    });
  }
  if (step === "LOCAL_E2E_OBSERVE_RESERVE_SWEEP_FEE_FUNDING_TRANSACTION") {
    return JSON.stringify({
      txid: FEE_FUNDING_TXID,
      vout: [
        {
          n: 0,
          value: "0.00001000",
          scriptPubKey: {
            hex: FEE_FUNDING_SCRIPT_HEX,
            address: FROST_TAPROOT_ADDRESS,
          },
        },
      ],
    });
  }
  if (step === "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT") {
    return JSON.stringify({
      value: "1.00000000",
      scriptPubKey: { hex: SCRIPT_HEX },
      bestblock: REGTEST_BEST_BLOCK_HASH,
      confirmations: 6,
      coinbase: false,
    });
  }
  if (step === "LOCAL_E2E_VERIFY_RESERVE_SWEEP_FEE_UTXO_UNSPENT") {
    return JSON.stringify({
      value: "0.00001000",
      scriptPubKey: { hex: FEE_FUNDING_SCRIPT_HEX },
      bestblock: REGTEST_BEST_BLOCK_HASH,
      confirmations: 6,
      coinbase: false,
    });
  }
  return `${step} ok`;
}

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function reverse32(hex) {
  assert.match(hex, /^[0-9a-f]{64}$/u);
  return Buffer.from(hex, "hex").reverse().toString("hex");
}

function varintHex(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value < 0xfd);
  return value.toString(16).padStart(2, "0");
}

function uint32Hex(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out.toString("hex");
}

function uint64Hex(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out.toString("hex");
}
