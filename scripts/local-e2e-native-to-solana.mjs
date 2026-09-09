import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  FileBackedFrostStateStore,
  NativeFrostSigner,
  REQUIRED_FROST_SIGNERS,
  runTwoPartyDkg,
} from "../native/frost/index.mjs";
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
export const LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_DRAFTED =
  "LOCAL_NATIVE_RESERVE_SWEEP_DRAFTED";

const DEFAULT_AMOUNT_NATIVE = "1.00000000";
const DEFAULT_NATIVE_DECIMALS = 8;
const DEFAULT_NATIVE_CHAIN_NAME = "regtest";
const DEFAULT_NATIVE_BECH32_HRP = "rkpepe";
const DEFAULT_RESERVE_MINER_FEE_NATIVE = "0.00001000";
const DEFAULT_COINBASE_MATURITY_BLOCKS = 20;
const DEFAULT_DEPOSIT_FINALITY_BLOCKS = 6;
const MAX_UNSIGNED_SWEEP_BYTES = 400_000;
const BECH32M_CONST = 0x2bc830a3;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export async function runLocalNativeToSolanaE2e(options = {}) {
  let flowResult;
  let actualPlan;
  const infrastructure = await withLocalE2eInfrastructure(options, async (context) => {
    actualPlan = context.plan;
    flowResult = await executeNativeDepositObservationFlow({
      ...context,
      custodyFactory: options.custodyFactory,
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
  const reserveMinerFeeNative = validateNativeDecimal(
    value.reserveMinerFeeNative ?? DEFAULT_RESERVE_MINER_FEE_NATIVE,
    "reserveMinerFeeNative",
  );

  return Object.freeze({
    protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
    runId,
    stateRoot,
    userWalletName: sanitizeWalletName(value.userWalletName ?? `kingpepe-e2e-user-${runId}`),
    amountNative,
    amountAtomic: amountAtomic.toString(),
    nativeDecimals,
    nativeChainName: sanitizeNetworkName(value.nativeChainName ?? DEFAULT_NATIVE_CHAIN_NAME),
    nativeBech32Hrp: sanitizeBech32Hrp(value.nativeBech32Hrp ?? DEFAULT_NATIVE_BECH32_HRP),
    reserveMinerFeeNative,
    reserveMinerFeeAtomic: decimalCoinsToAtomic(reserveMinerFeeNative, nativeDecimals).toString(),
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
  custodyFactory = createLocalFrostTaprootCustodyContext,
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

  const frostCustody = await custodyFactory({
    plan,
    flowConfig: config,
  });
  const depositAddress = requireNonEmptyText(frostCustody.taprootAddress, "frostCustody.taprootAddress");
  const custodyScriptPubKeyHex = validateP2trScriptPubKeyHex(
    frostCustody.taprootScriptPubKeyHex,
    "frostCustody.taprootScriptPubKeyHex",
  );
  stages.push("LOCAL_E2E_INITIALIZE_EPHEMERAL_FROST_CUSTODY");
  stages.push("LOCAL_E2E_CREATE_FROST_TAPROOT_DEPOSIT_INTENT");

  await cli({
    step: "LOCAL_E2E_CREATE_USER_WALLET",
    command: "createwallet",
    parameters: [config.userWalletName],
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
    expectedScriptPubKeyHex: custodyScriptPubKeyHex,
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
  const canonicalReserveAddress = depositAddress;
  stages.push("LOCAL_E2E_SELECT_FROST_CANONICAL_RESERVE");
  const feeFundingInputs = await prepareLocalReserveSweepFeeFundingInputs({
    cli,
    config,
    miningAddress,
    feeFundingAddress: depositAddress,
    expectedFeeFundingScriptPubKeyHex: custodyScriptPubKeyHex,
  });
  const reserveSweepDraft = await draftLocalReserveSweep({
    cli,
    depositTxidHex,
    depositVout: depositOutput.vout,
    depositAmountAtomic: config.amountAtomic,
    nativeMinerFeeAtomic: config.reserveMinerFeeAtomic,
    nativeDecimals: config.nativeDecimals,
    canonicalReserveAddress,
    feeFundingInputs,
    proofFingerprintHex,
  });

  return Object.freeze({
    protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
    state: LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
    reason: "FROST_RESERVE_SWEEP_SIGNING_PENDING",
    completedStage: LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_DRAFTED,
    productionReady: false,
    mainnetActivation: "DISABLED",
    noPerTransferKingPepeTeamApprovalState: true,
    trustBoundary: RPC_OBSERVATION,
    stages,
    frostCustody: Object.freeze({
      protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_FROST_TAPROOT_CUSTODY/V1`,
      state: "READY",
      localOnly: true,
      signerIds: frostCustody.signerIds,
      keyEpoch: frostCustody.keyEpoch,
      aggregateTweakedXOnlyPublicKey: frostCustody.aggregateTweakedXOnlyPublicKey,
      taprootScriptPubKeyHex: custodyScriptPubKeyHex,
      depositAddress,
      feeFundingAddress: depositAddress,
      canonicalReserveAddress,
    }),
    nativeSource,
    stateRoot: config.stateRoot,
    depositIntent: Object.freeze({
      address: depositAddress,
      scriptPubKeyHex: custodyScriptPubKeyHex,
      custody: "LOCAL_EPHEMERAL_FROST_TAPROOT",
      recoverable: false,
    }),
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
    reserveSweep: reserveSweepDraft,
    nextRequiredImplementation: Object.freeze([
      "COMPUTE_VALIDATED_TAPROOT_SIGHASHES_FOR_EACH_FROST_CONTROLLED_INPUT",
      "SIGN_EACH_RESERVE_SWEEP_INPUT_WITH_REAL_NATIVE_COMPATIBLE_FROST_A_B",
      "ATTACH_FROST_SIGNATURE_WITNESSES_TO_NATIVE_TRANSACTION",
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

export function findDepositOutput({
  rawTransaction,
  depositAddress,
  expectedScriptPubKeyHex,
  amountAtomic,
  nativeDecimals,
}) {
  const tx = requireObject(rawTransaction, "rawTransaction");
  if (!Array.isArray(tx.vout)) {
    throw new Error("LocalNativeDepositTransactionMissingOutputs");
  }
  const expectedAmountAtomic = canonicalUintDecimal(amountAtomic, "amountAtomic");
  const expectedScript =
    expectedScriptPubKeyHex === undefined
      ? undefined
      : normalizeHexText(expectedScriptPubKeyHex, "expectedScriptPubKeyHex");
  const matches = tx.vout
    .map((output, index) => normalizeDepositOutput(output, index, nativeDecimals))
    .filter(
      (output) =>
        output.amountAtomic === expectedAmountAtomic &&
        output.addresses.includes(depositAddress) &&
        (expectedScript === undefined || output.scriptPubKeyHex === expectedScript),
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

export async function draftLocalReserveSweep({
  cli,
  depositTxidHex,
  depositVout,
  depositAmountAtomic,
  nativeMinerFeeAtomic,
  nativeDecimals,
  canonicalReserveAddress,
  feeFundingInputs = [],
  proofFingerprintHex,
}) {
  const txid = normalizeHash32(depositTxidHex, "depositTxidHex");
  const vout = checkedInteger(depositVout, "depositVout", 0, 10_000_000);
  const amount = canonicalUintDecimal(depositAmountAtomic, "depositAmountAtomic");
  const fee = canonicalUintDecimal(nativeMinerFeeAtomic, "nativeMinerFeeAtomic");
  if (BigInt(amount) === 0n) {
    throw new Error("LocalNativeReserveSweepReserveAmountMustBePositive");
  }
  const normalizedFeeFundingInputs = normalizeFeeFundingInputs(feeFundingInputs);
  if (BigInt(fee) > 0n && normalizedFeeFundingInputs.length === 0) {
    throw new Error("LocalNativeReserveSweepFeeFundingInputRequired");
  }
  const reserveAmountAtomic = amount;
  const reserveAmountNative = atomicToFixedDecimalCoins(reserveAmountAtomic, nativeDecimals);
  const reserveAddress = requireNonEmptyText(canonicalReserveAddress, "canonicalReserveAddress");
  const inputOutpoints = [`${txid}:${vout}`, ...normalizedFeeFundingInputs.map((input) => `${input.txidHex}:${input.vout}`)];
  if (new Set(inputOutpoints).size !== inputOutpoints.length) {
    throw new Error("LocalNativeReserveSweepDuplicateInputOutpoint");
  }
  const transactionInputs = [{ txid, vout }, ...normalizedFeeFundingInputs.map((input) => ({ txid: input.txidHex, vout: input.vout }))];
  const unsignedNativeTransactionHex = normalizeRawTransactionHex(
    await cli({
      step: "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP",
      command: "createrawtransaction",
      parameters: [
        JSON.stringify(transactionInputs),
        JSON.stringify({ [reserveAddress]: reserveAmountNative }),
      ],
    }),
    "unsignedNativeTransactionHex",
  );

  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/UNSIGNED_RESERVE_SWEEP_DRAFT`,
    state: "UNSIGNED_DRAFT_ONLY",
    depositOutpoint: `${txid}:${vout}`,
    feeFundingOutpoints: Object.freeze(inputOutpoints.slice(1)),
    reserveAmountAtomic,
    nativeMinerFeeAtomic: fee,
    reserveAmountNative,
    unsignedNativeTransactionFingerprintHex: sha256Hex(Buffer.from(unsignedNativeTransactionHex, "hex")),
    proofFingerprintHex: normalizeHash32(proofFingerprintHex, "proofFingerprintHex"),
    signed: false,
    broadcast: false,
  });
}

async function prepareLocalReserveSweepFeeFundingInputs({
  cli,
  config,
  miningAddress,
  feeFundingAddress,
  expectedFeeFundingScriptPubKeyHex,
}) {
  if (BigInt(config.reserveMinerFeeAtomic) === 0n) return Object.freeze([]);
  const address = requireNonEmptyText(feeFundingAddress, "feeFundingAddress");
  const scriptPubKeyHex = validateP2trScriptPubKeyHex(expectedFeeFundingScriptPubKeyHex, "expectedFeeFundingScriptPubKeyHex");
  const feeFundingTxidHex = normalizeHash32(
    await cli({
      step: "LOCAL_E2E_FUND_RESERVE_SWEEP_FEE_INPUT",
      wallet: config.userWalletName,
      command: "sendtoaddress",
      parameters: [address, config.reserveMinerFeeNative],
    }),
    "feeFundingTxidHex",
  );
  await cli({
    step: "LOCAL_E2E_MINE_RESERVE_SWEEP_FEE_FUNDING_FINALITY",
    wallet: config.userWalletName,
    command: "generatetoaddress",
    parameters: [String(config.depositFinalityBlocks), miningAddress],
  });
  const rawFundingTransaction = await cli({
    step: "LOCAL_E2E_OBSERVE_RESERVE_SWEEP_FEE_FUNDING_TRANSACTION",
    command: "getrawtransaction",
    parameters: [feeFundingTxidHex, "true"],
    parseJson: true,
  });
  validateRawDepositTransaction({ rawTransaction: rawFundingTransaction, expectedTxidHex: feeFundingTxidHex });
  const feeOutput = findDepositOutput({
    rawTransaction: rawFundingTransaction,
    depositAddress: address,
    expectedScriptPubKeyHex: scriptPubKeyHex,
    amountAtomic: config.reserveMinerFeeAtomic,
    nativeDecimals: config.nativeDecimals,
  });
  const feeUtxo = await cli({
    step: "LOCAL_E2E_VERIFY_RESERVE_SWEEP_FEE_UTXO_UNSPENT",
    command: "gettxout",
    parameters: [feeFundingTxidHex, String(feeOutput.vout), "false"],
    parseJson: true,
  });
  validateDepositUtxo({
    utxo: feeUtxo,
    output: feeOutput,
    expectedConfirmations: config.depositFinalityBlocks,
    nativeDecimals: config.nativeDecimals,
  });
  return Object.freeze([{ txidHex: feeFundingTxidHex, vout: feeOutput.vout }]);
}

export async function createLocalFrostTaprootCustodyContext({ plan, flowConfig }) {
  const config = requireObject(flowConfig, "flowConfig");
  const repoRoot = path.resolve(plan.repoRoot);
  const frostRoot = validateStateRoot({
    stateRoot: path.join(config.stateRoot, "ephemeral-frost-custody"),
    repoRoot,
    runRoot: plan.runRoot,
  });
  const signerA = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[0],
    index: 0,
    policy: undefined,
    stateStore: new FileBackedFrostStateStore({
      signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(frostRoot, "frost-a"),
      repoRoot,
    }),
  });
  const signerB = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[1],
    index: 1,
    policy: undefined,
    stateStore: new FileBackedFrostStateStore({
      signerId: REQUIRED_FROST_SIGNERS[1],
      root: path.join(frostRoot, "frost-b"),
      repoRoot,
    }),
  });
  const keyEpoch = 1;
  const epoch = runTwoPartyDkg([signerA, signerB], { epoch: keyEpoch });
  const xOnly = normalizeHash32(epoch.aggregateTweakedXOnlyPublicKey, "aggregateTweakedXOnlyPublicKey");
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_FROST_TAPROOT_CUSTODY/V1`,
    state: "READY",
    localOnly: true,
    keyEpoch,
    signerIds: Object.freeze([...REQUIRED_FROST_SIGNERS]),
    aggregateTweakedXOnlyPublicKey: xOnly,
    taprootScriptPubKeyHex: p2trScriptPubKeyHex(xOnly),
    taprootAddress: taprootAddressFromXOnlyPublicKey(xOnly, config.nativeBech32Hrp),
  });
}

export function p2trScriptPubKeyHex(xOnlyPublicKeyHex) {
  return `5120${normalizeHash32(xOnlyPublicKeyHex, "xOnlyPublicKeyHex")}`;
}

export function validateP2trScriptPubKeyHex(scriptPubKeyHex, label = "scriptPubKeyHex") {
  const normalized = normalizeHexText(scriptPubKeyHex, label);
  if (!/^5120[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${label}:ExpectedP2trScriptPubKey`);
  }
  return normalized;
}

export function taprootAddressFromXOnlyPublicKey(xOnlyPublicKeyHex, hrp = DEFAULT_NATIVE_BECH32_HRP) {
  const program = Buffer.from(normalizeHash32(xOnlyPublicKeyHex, "xOnlyPublicKeyHex"), "hex");
  const data = [1, ...convertBits([...program], 8, 5, true)];
  return bech32Encode(sanitizeBech32Hrp(hrp), data, BECH32M_CONST);
}

function normalizeFeeFundingInputs(value) {
  if (!Array.isArray(value)) {
    throw new Error("LocalNativeReserveSweepFeeFundingInputsMustBeArray");
  }
  return Object.freeze(
    value.map((input, index) => {
      const entry = requireObject(input, `feeFundingInputs[${index}]`);
      return Object.freeze({
        txidHex: normalizeHash32(entry.txidHex ?? entry.txid, `feeFundingInputs[${index}].txidHex`),
        vout: checkedInteger(entry.vout, `feeFundingInputs[${index}].vout`, 0, 10_000_000),
      });
    }),
  );
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

function bech32Encode(hrp, data, checksumConstant) {
  const values = [...data];
  if (values.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 31)) {
    throw new Error("Bech32 data value outside 5-bit range");
  }
  const checksum = bech32CreateChecksum(hrp, values, checksumConstant);
  return `${hrp}1${[...values, ...checksum].map((entry) => BECH32_CHARSET[entry]).join("")}`;
}

function bech32CreateChecksum(hrp, data, checksumConstant) {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ checksumConstant;
  return [0, 1, 2, 3, 4, 5].map((index) => (polymod >> (5 * (5 - index))) & 31);
}

function bech32HrpExpand(hrp) {
  return [...hrp].map((char) => char.charCodeAt(0) >> 5).concat([0], [...hrp].map((char) => char.charCodeAt(0) & 31));
}

function bech32Polymod(values) {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generator.length; index += 1) {
      if (((top >> index) & 1) !== 0) {
        checksum ^= generator[index];
      }
    }
  }
  return checksum;
}

function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0;
  let bits = 0;
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  const result = [];
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new Error("invalid value while converting Bech32 groups");
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    throw new Error("invalid padding while converting Bech32 groups");
  }
  return result;
}

function sanitizeBech32Hrp(value) {
  if (typeof value !== "string" || !/^[a-z0-9]{1,83}$/u.test(value)) {
    throw new Error("Native Bech32 HRP is invalid");
  }
  return value;
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

function atomicToFixedDecimalCoins(value, nativeDecimals) {
  const atomic = BigInt(canonicalUintDecimal(value, "atomicAmount"));
  const decimals = checkedInteger(nativeDecimals, "nativeDecimals", 0, 18);
  if (decimals === 0) return atomic.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

function normalizeRawTransactionHex(value, label) {
  const normalized = normalizeNonEmptyHexText(String(value ?? "").trim(), label);
  if (normalized.length > MAX_UNSIGNED_SWEEP_BYTES * 2) {
    throw new Error(`${label}:TooLarge`);
  }
  return normalized;
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

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
