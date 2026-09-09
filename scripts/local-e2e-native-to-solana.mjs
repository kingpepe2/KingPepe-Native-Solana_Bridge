import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hashJson } from "../shared/protocol/canonical-message.mjs";
import {
  buildRegtestCliArguments,
  sanitizePlanForReport,
} from "./local-e2e-orchestrator.mjs";
import {
  LOCAL_E2E_BOOTSTRAP_BLOCKED,
  LOCAL_E2E_BOOTSTRAP_FAILED,
  LOCAL_E2E_BOOTSTRAP_READY,
  withLocalE2eInfrastructure,
} from "./local-e2e-bootstrap.mjs";
import {
  RPC_OBSERVATION,
  decimalCoinsToAtomic,
} from "../native/node/native-rpc-client.mjs";

export const LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_NATIVE_TO_SOLANA_E2E/V1";
export const LOCAL_NATIVE_TO_SOLANA_COMPLETED = "COMPLETED";
export const LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY = "WAITING_FOR_DEPENDENCY";
export const LOCAL_NATIVE_TO_SOLANA_BLOCKED = "BLOCKED_LOCAL_INFRASTRUCTURE_MISSING";
export const LOCAL_NATIVE_TO_SOLANA_FAILED = "LOCAL_NATIVE_TO_SOLANA_E2E_FAILED";
export const LOCAL_NATIVE_TO_SOLANA_DEPOSIT_OBSERVED = "LOCAL_NATIVE_DEPOSIT_OBSERVED";
export const LOCAL_NATIVE_TO_SOLANA_DEPOSIT_EVIDENCE_VALIDATED =
  "LOCAL_NATIVE_DEPOSIT_EVIDENCE_VALIDATED";

const DEFAULT_AMOUNT_NATIVE = "1.00000000";
const DEFAULT_NATIVE_DECIMALS = 8;
const DEFAULT_NATIVE_CHAIN_NAME = "regtest";
const DEFAULT_COINBASE_MATURITY_BLOCKS = 101;
const DEFAULT_DEPOSIT_FINALITY_BLOCKS = 6;

export async function runLocalNativeToSolanaE2e(options = {}) {
  let flowResult;
  let actualPlan;
  const infrastructure = await withLocalE2eInfrastructure(options, async (context) => {
    actualPlan = context.plan;
    flowResult = await executeNativeDepositObservationFlow({
      ...context,
      flowConfig: createNativeToSolanaFlowConfig({
        plan: context.plan,
        repoRoot: context.plan.repoRoot,
        ...options.flowConfig,
      }),
    });
    return {
      fullNativeToSolanaE2e:
        flowResult.state === LOCAL_NATIVE_TO_SOLANA_COMPLETED
          ? "PASS"
          : "NOT_RUN_FULL_FLOW_NATIVE_RESERVE_SWEEP_PENDING",
      nativeToSolanaE2e: sanitizeFlowForReport(flowResult, context.plan),
    };
  });

  if (infrastructure.state === LOCAL_E2E_BOOTSTRAP_BLOCKED) {
    return localE2eResult(LOCAL_NATIVE_TO_SOLANA_BLOCKED, infrastructure.reason, {
      infrastructure,
      fullNativeToSolanaE2e: "NOT_RUN_INFRASTRUCTURE_BLOCKED",
    });
  }
  if (infrastructure.state === LOCAL_E2E_BOOTSTRAP_FAILED) {
    return localE2eResult(LOCAL_NATIVE_TO_SOLANA_FAILED, infrastructure.reason, {
      infrastructure,
      fullNativeToSolanaE2e: infrastructure.fullNativeToSolanaE2e ?? "FAILED",
    });
  }

  const flow = flowResult ?? infrastructure.nativeToSolanaE2e;
  if (flow?.state === LOCAL_NATIVE_TO_SOLANA_COMPLETED) {
    return localE2eResult(LOCAL_NATIVE_TO_SOLANA_COMPLETED, "ALL_REQUIRED_CHECKS_PASSED", {
      infrastructure,
      nativeToSolanaE2e: sanitizeFlowForReport(flow, actualPlan ?? infrastructure.plan),
      fullNativeToSolanaE2e: "PASS",
    });
  }

  return localE2eResult(flow?.state ?? LOCAL_NATIVE_TO_SOLANA_FAILED, flow?.reason ?? infrastructure.reason, {
    infrastructure,
    nativeToSolanaE2e: sanitizeFlowForReport(flow, actualPlan ?? infrastructure.plan),
    fullNativeToSolanaE2e:
      infrastructure.fullNativeToSolanaE2e ?? "NOT_RUN_FULL_FLOW_NATIVE_RESERVE_SWEEP_PENDING",
  });
}

export function createNativeToSolanaFlowConfig(options) {
  const value = requireObject(options, "options");
  const plan = requireObject(value.plan, "plan");
  const repoRoot = path.resolve(value.repoRoot ?? plan.repoRoot);
  const runId = sanitizeRunId(value.runId ?? randomUUID().slice(0, 12));
  const stateRoot = validateStateRoot({
    stateRoot: value.stateRoot ?? path.join(plan.runRoot, "native-to-solana", runId),
    repoRoot,
    runRoot: plan.runRoot,
  });
  const amountNative = validateNativeDecimal(value.amountNative ?? DEFAULT_AMOUNT_NATIVE, "amountNative");
  const nativeDecimals = checkedInteger(value.nativeDecimals ?? DEFAULT_NATIVE_DECIMALS, "nativeDecimals", 0, 18);
  const amountAtomic = decimalCoinsToAtomic(amountNative, nativeDecimals);
  if (amountAtomic <= 0n) {
    throw new Error("LocalNativeToSolanaAmountMustBePositive");
  }

  return Object.freeze({
    protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
    runId,
    stateRoot,
    userWalletName: sanitizeWalletName(value.userWalletName ?? `kingpepe-e2e-user-${runId}`),
    depositWalletName: sanitizeWalletName(value.depositWalletName ?? `kingpepe-e2e-deposit-${runId}`),
    amountNative,
    amountAtomic: amountAtomic.toString(),
    nativeDecimals,
    nativeChainName: sanitizeNetworkName(value.nativeChainName ?? DEFAULT_NATIVE_CHAIN_NAME),
    coinbaseMaturityBlocks: checkedInteger(
      value.coinbaseMaturityBlocks ?? DEFAULT_COINBASE_MATURITY_BLOCKS,
      "coinbaseMaturityBlocks",
      1,
      1000,
    ),
    depositFinalityBlocks: checkedInteger(
      value.depositFinalityBlocks ?? DEFAULT_DEPOSIT_FINALITY_BLOCKS,
      "depositFinalityBlocks",
      1,
      1000,
    ),
  });
}

export async function executeNativeDepositObservationFlow({
  plan,
  executor,
  commandPaths,
  flowConfig,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  mkdirSync(config.stateRoot, { recursive: true });
  const stages = [];
  const cli = async ({ step, wallet, command, parameters = [], parseJson = false }) => {
    const result = await executor.runOneShot({
      step,
      executable: commandPaths.get("kingpepe-cli"),
      args: buildRegtestCliArguments({
        datadir: plan.paths.nativeDatadir,
        rpcPort: plan.ports.nativeRpcPort,
        wallet,
        command,
        parameters,
      }),
      cwd: plan.repoRoot,
    });
    stages.push(step);
    return parseJson ? parseJsonOutput(result.output, step) : String(result.output ?? "").trim();
  };

  await cli({
    step: "LOCAL_E2E_CREATE_USER_WALLET",
    command: "createwallet",
    parameters: [config.userWalletName],
  });
  await cli({
    step: "LOCAL_E2E_CREATE_DEPOSIT_WALLET",
    command: "createwallet",
    parameters: [config.depositWalletName],
  });
  const miningAddress = requireNonEmptyText(
    await cli({
      step: "LOCAL_E2E_GET_USER_MINING_ADDRESS",
      wallet: config.userWalletName,
      command: "getnewaddress",
    }),
    "miningAddress",
  );
  await cli({
    step: "LOCAL_E2E_MINE_USER_FUNDS",
    wallet: config.userWalletName,
    command: "generatetoaddress",
    parameters: [String(config.coinbaseMaturityBlocks), miningAddress],
  });
  const depositAddress = requireNonEmptyText(
    await cli({
      step: "LOCAL_E2E_CREATE_NATIVE_DEPOSIT_INTENT",
      wallet: config.depositWalletName,
      command: "getnewaddress",
    }),
    "depositAddress",
  );
  const depositTxidHex = normalizeHash32(
    await cli({
      step: "LOCAL_E2E_SEND_NATIVE_DEPOSIT",
      wallet: config.userWalletName,
      command: "sendtoaddress",
      parameters: [depositAddress, config.amountNative],
    }),
    "depositTxidHex",
  );
  await cli({
    step: "LOCAL_E2E_MINE_DEPOSIT_FINALITY",
    wallet: config.userWalletName,
    command: "generatetoaddress",
    parameters: [String(config.depositFinalityBlocks), miningAddress],
  });
  const blockchainInfo = await cli({
    step: "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT",
    command: "getblockchaininfo",
    parseJson: true,
  });
  const nativeGenesisHash = normalizeHash32(
    await cli({
      step: "LOCAL_E2E_OBSERVE_NATIVE_GENESIS_HASH",
      command: "getblockhash",
      parameters: ["0"],
    }),
    "nativeGenesisHash",
  );
  const nativeSource = validateLocalNativeSourceSnapshot({
    blockchainInfo,
    genesisHash: nativeGenesisHash,
    expectedChain: config.nativeChainName,
    minimumBlocks: config.coinbaseMaturityBlocks + config.depositFinalityBlocks,
  });
  const rawTransaction = await cli({
    step: "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
    command: "getrawtransaction",
    parameters: [depositTxidHex, "true"],
    parseJson: true,
  });
  validateRawDepositTransaction({ rawTransaction, expectedTxidHex: depositTxidHex });
  const depositOutput = findDepositOutput({
    rawTransaction,
    depositAddress,
    amountAtomic: config.amountAtomic,
    nativeDecimals: config.nativeDecimals,
  });
  const utxo = await cli({
    step: "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT",
    command: "gettxout",
    parameters: [depositTxidHex, String(depositOutput.vout), "false"],
    parseJson: true,
  });
  const depositUtxo = validateDepositUtxo({
    utxo,
    output: depositOutput,
    expectedConfirmations: config.depositFinalityBlocks,
    nativeDecimals: config.nativeDecimals,
  });
  const proofFingerprintHex = localDepositProofFingerprintHex({
    nativeSource,
    depositTxidHex,
    depositOutput,
    depositUtxo,
  });

  return Object.freeze({
    protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
    state: LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
    reason: "NATIVE_RESERVE_SWEEP_CONSTRUCTION_PENDING",
    completedStage: LOCAL_NATIVE_TO_SOLANA_DEPOSIT_EVIDENCE_VALIDATED,
    productionReady: false,
    mainnetActivation: "DISABLED",
    noPerTransferKingPepeTeamApprovalState: true,
    trustBoundary: RPC_OBSERVATION,
    stages,
    nativeSource,
    stateRoot: config.stateRoot,
    deposit: Object.freeze({
      txidHex: depositTxidHex,
      vout: depositOutput.vout,
      amountAtomic: config.amountAtomic,
      scriptPubKeyHex: depositOutput.scriptPubKeyHex,
      finalityBlocks: config.depositFinalityBlocks,
      finalitySatisfied: depositUtxo.finalitySatisfied,
      utxoUnspent: true,
      nativeNetwork: nativeSource.nativeNetwork,
      nativeGenesisHash: nativeSource.nativeGenesisHash,
      sourceBestBlockHash: nativeSource.bestBlockHash,
      sourceBestHeight: nativeSource.bestHeight,
      proofFingerprintHex,
    }),
    nextRequiredImplementation: Object.freeze([
      "CONSTRUCT_CANONICAL_RESERVE_SWEEP_WITH_NATIVE_RULES",
      "SIGN_RESERVE_SWEEP_WITH_REAL_NATIVE_COMPATIBLE_FROST_A_B",
      "BROADCAST_AND_FINALIZE_RESERVE_SWEEP",
      "SUBMIT_AND_OBSERVE_SOLANA_MINT",
      "RECONCILE_RESERVE_SUPPLY_AND_LIABILITIES",
    ]),
  });
}

export function validateLocalNativeSourceSnapshot({
  blockchainInfo,
  genesisHash,
  expectedChain = DEFAULT_NATIVE_CHAIN_NAME,
  minimumBlocks = 0,
}) {
  const info = requireObject(blockchainInfo, "blockchainInfo");
  const chain = checkedNetworkName(info.chain, "blockchainInfo.chain");
  const expected = checkedNetworkName(expectedChain, "expectedChain");
  const blocks = checkedInteger(info.blocks, "blockchainInfo.blocks", 0, 10_000_000);
  const headers = checkedInteger(info.headers ?? blocks, "blockchainInfo.headers", 0, 10_000_000);
  const minimum = checkedInteger(minimumBlocks, "minimumBlocks", 0, 10_000_000);
  const bestBlockHash = normalizeHash32(info.bestblockhash, "blockchainInfo.bestblockhash");
  const normalizedGenesisHash = normalizeHash32(genesisHash, "genesisHash");
  const chainworkHex = normalizeNonEmptyHexText(info.chainwork, "blockchainInfo.chainwork");
  const inInitialBlockDownload = info.initialblockdownload === true;

  if (chain !== expected) {
    throw new Error("LocalNativeSourceWrongNetwork");
  }
  if (inInitialBlockDownload) {
    throw new Error("LocalNativeSourceInInitialBlockDownload");
  }
  if (headers < blocks) {
    throw new Error("LocalNativeSourceHeadersBehindBlocks");
  }
  if (blocks < minimum) {
    throw new Error("LocalNativeSourceHeightInsufficient");
  }

  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/NATIVE_SOURCE_SNAPSHOT`,
    trust: RPC_OBSERVATION,
    state: "READY",
    nativeNetwork: chain,
    nativeGenesisHash: normalizedGenesisHash,
    bestBlockHash,
    bestHeight: blocks,
    headers,
    chainworkHex,
    inInitialBlockDownload,
  });
}

export function validateRawDepositTransaction({ rawTransaction, expectedTxidHex }) {
  const tx = requireObject(rawTransaction, "rawTransaction");
  const observedTxidHex = normalizeHash32(tx.txid, "rawTransaction.txid");
  const expected = normalizeHash32(expectedTxidHex, "expectedTxidHex");
  if (observedTxidHex !== expected) {
    throw new Error("LocalNativeDepositTxidMismatch");
  }
  return Object.freeze({
    txidHex: observedTxidHex,
  });
}

export function findDepositOutput({ rawTransaction, depositAddress, amountAtomic, nativeDecimals }) {
  const tx = requireObject(rawTransaction, "rawTransaction");
  if (!Array.isArray(tx.vout)) {
    throw new Error("LocalNativeDepositTransactionMissingOutputs");
  }
  const expectedAmountAtomic = canonicalUintDecimal(amountAtomic, "amountAtomic");
  const matches = tx.vout
    .map((output, index) => normalizeDepositOutput(output, index, nativeDecimals))
    .filter(
      (output) =>
        output.amountAtomic === expectedAmountAtomic &&
        output.addresses.includes(depositAddress),
    );
  if (matches.length !== 1) {
    throw new Error("LocalNativeDepositOutputNotUnique");
  }
  return matches[0];
}

export function validateDepositUtxo({ utxo, output, expectedConfirmations, nativeDecimals }) {
  const value = requireObject(utxo, "utxo");
  const normalizedOutput = requireObject(output, "output");
  const actualAmountAtomic =
    value.valueAtomic === undefined
      ? decimalCoinsToAtomic(String(value.value), nativeDecimals).toString()
      : canonicalUintDecimal(value.valueAtomic, "utxo.valueAtomic");
  if (actualAmountAtomic !== normalizedOutput.amountAtomic) {
    throw new Error("LocalNativeDepositUtxoAmountMismatch");
  }
  const scriptPubKeyHex = normalizeHexText(value.scriptPubKey?.hex, "utxo.scriptPubKey.hex");
  if (scriptPubKeyHex !== normalizedOutput.scriptPubKeyHex) {
    throw new Error("LocalNativeDepositUtxoScriptMismatch");
  }
  const confirmations = checkedInteger(value.confirmations, "utxo.confirmations", 0, 10_000_000);
  if (confirmations < expectedConfirmations) {
    throw new Error("LocalNativeDepositUtxoFinalityInsufficient");
  }
  if (value.coinbase === true) {
    throw new Error("LocalNativeDepositUtxoCoinbaseRejected");
  }
  return Object.freeze({
    unspent: true,
    amountAtomic: actualAmountAtomic,
    scriptPubKeyHex,
    confirmations,
    finalitySatisfied: true,
    bestBlockHash:
      value.bestblock === undefined ? undefined : normalizeHash32(value.bestblock, "utxo.bestblock"),
    coinbase: value.coinbase === true,
  });
}

export function localDepositProofFingerprintHex({
  nativeSource,
  depositTxidHex,
  depositOutput,
  depositUtxo,
}) {
  const source = requireObject(nativeSource, "nativeSource");
  const output = requireObject(depositOutput, "depositOutput");
  const utxo = requireObject(depositUtxo, "depositUtxo");
  return hashJson({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/DEPOSIT_PROOF_FINGERPRINT`,
    trust: source.trust,
    nativeNetwork: source.nativeNetwork,
    nativeGenesisHash: source.nativeGenesisHash,
    bestBlockHash: source.bestBlockHash,
    bestHeight: source.bestHeight,
    depositTxidHex: normalizeHash32(depositTxidHex, "depositTxidHex"),
    depositVout: checkedInteger(output.vout, "depositOutput.vout", 0, 10_000_000),
    amountAtomic: canonicalUintDecimal(output.amountAtomic, "depositOutput.amountAtomic"),
    scriptPubKeyHex: normalizeHexText(output.scriptPubKeyHex, "depositOutput.scriptPubKeyHex"),
    utxoConfirmations: checkedInteger(utxo.confirmations, "depositUtxo.confirmations", 0, 10_000_000),
    utxoBestBlockHash: utxo.bestBlockHash ?? null,
    finalitySatisfied: utxo.finalitySatisfied === true,
    noPriorConsumption: utxo.unspent === true,
  });
}

function localE2eResult(state, reason, extra = {}) {
  return Object.freeze({
    protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
    state,
    reason,
    productionReady: false,
    mainnetActivation: "DISABLED",
    ...extra,
  });
}

function normalizeDepositOutput(output, index, nativeDecimals) {
  const value = requireObject(output, `rawTransaction.vout[${index}]`);
  const amountAtomic =
    value.valueAtomic === undefined
      ? decimalCoinsToAtomic(String(value.value), nativeDecimals).toString()
      : canonicalUintDecimal(value.valueAtomic, `rawTransaction.vout[${index}].valueAtomic`);
  const scriptPubKey = requireObject(value.scriptPubKey, `rawTransaction.vout[${index}].scriptPubKey`);
  return Object.freeze({
    vout: checkedInteger(value.n ?? index, `rawTransaction.vout[${index}].n`, 0, 10_000_000),
    amountAtomic,
    scriptPubKeyHex: normalizeHexText(scriptPubKey.hex, `rawTransaction.vout[${index}].scriptPubKey.hex`),
    addresses: extractOutputAddresses(scriptPubKey),
  });
}

function extractOutputAddresses(scriptPubKey) {
  const addresses = new Set();
  if (typeof scriptPubKey.address === "string" && scriptPubKey.address.length > 0) {
    addresses.add(scriptPubKey.address);
  }
  if (Array.isArray(scriptPubKey.addresses)) {
    for (const address of scriptPubKey.addresses) {
      if (typeof address === "string" && address.length > 0) {
        addresses.add(address);
      }
    }
  }
  return [...addresses];
}

function parseJsonOutput(output, step) {
  try {
    return JSON.parse(String(output ?? "").trim());
  } catch {
    throw new Error(`${step}:InvalidJsonOutput`);
  }
}

function sanitizeFlowForReport(flow, plan) {
  if (flow === undefined || flow === null) return undefined;
  const report = structuredClone(flow);
  if (typeof report.stateRoot === "string") {
    const runRoot = plan?.runRoot ?? "${LOCAL_E2E_RUN_ROOT}";
    report.stateRoot = report.stateRoot.replace(path.resolve(runRoot), "${LOCAL_E2E_RUN_ROOT}");
  }
  if (report.plan !== undefined) {
    report.plan = sanitizePlanForReport(report.plan);
  }
  return report;
}

function validateStateRoot({ stateRoot, repoRoot, runRoot }) {
  const resolved = path.resolve(stateRoot);
  const repo = path.resolve(repoRoot);
  const run = path.resolve(runRoot);
  if (isSameOrInside(repo, resolved)) {
    throw new Error("LocalNativeToSolanaStateRootInsideRepositoryRejected");
  }
  if (!isSameOrInside(run, resolved)) {
    throw new Error("LocalNativeToSolanaStateRootOutsideRunRootRejected");
  }
  return resolved;
}

function sanitizeRunId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,32}$/u.test(value)) {
    throw new Error("LocalNativeToSolanaRunIdInvalid");
  }
  return value;
}

function sanitizeWalletName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/u.test(value)) {
    throw new Error("LocalNativeToSolanaWalletNameInvalid");
  }
  return value;
}

function checkedNetworkName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,32}$/iu.test(value)) {
    throw new Error(`${label}:InvalidNetworkName`);
  }
  return value.toLowerCase();
}

function sanitizeNetworkName(value) {
  return checkedNetworkName(value, "nativeChainName");
}

function validateNativeDecimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalDecimal`);
  }
  return value;
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function normalizeHash32(value, label) {
  const normalized = normalizeHexText(String(value ?? "").trim(), label);
  if (normalized.length !== 64) {
    throw new Error(`${label}:Expected32ByteHex`);
  }
  return normalized;
}

function normalizeHexText(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f][0-9a-f])*$/iu.test(value)) {
    throw new Error(`${label}:ExpectedHex`);
  }
  return value.toLowerCase();
}

function normalizeNonEmptyHexText(value, label) {
  const normalized = normalizeHexText(value, label);
  if (normalized.length === 0) {
    throw new Error(`${label}:ExpectedNonEmptyHex`);
  }
  return normalized;
}

function requireNonEmptyText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}:ExpectedNonEmptyText`);
  }
  return value;
}

function checkedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}:ExpectedInteger`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}

function isSameOrInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runLocalNativeToSolanaE2e({
    repoRoot: path.resolve(process.argv[2] ?? process.cwd()),
    runRoot: process.env.KINGPEPE_LOCAL_E2E_ROOT,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.state === LOCAL_NATIVE_TO_SOLANA_COMPLETED ? 0 : 2;
}
