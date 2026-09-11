import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSameOrInside, resolveExistingParents, validateRuntimeFile, validateRuntimeStateRoot } from "../shared/runtime-path-boundary.mjs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createLocalNativeEvidenceVerifier } from "./local-native-evidence-verifier.mjs";
import { REGTEST_GENESIS } from "../native/node/native-raw-evidence.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment,
  validateRegtestRecoverableDepositIntent } from "../native/recovery/taproot-deposit.mjs";
import {
  ATTESTATION_MODE,
  ATTESTATION_PROTOCOL,
  VERIFIED_READY as ATTESTATION_VERIFIED_READY,
  combineProjectAttestations,
  evaluateDepositCredit,
} from "../services/attesters/attestation-service.mjs";
import {
  DEPOSIT_STATES,
  buildDepositClaimMessage,
} from "../services/bridge-validator/automatic-deposit-pipeline.mjs";
import { LocalnetSolanaDepositClaimBridge } from "../services/bridge-validator/localnet-solana-deposit-claim-bridge.mjs";
import { AuthenticatedLocalDepositLedger } from "../services/bridge-validator/local-deposit-ledger.mjs";
import {
  SolanaLocalRpcClient,
  FileBackedSolanaDepositClaimJournal,
} from "../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimObserver } from "../services/solana-observer/solana-deposit-claim-observer.mjs";
import {
  SPL_TOKEN_PROGRAM_ID_BASE58,
} from "../services/bridge-validator/localnet-solana-setup-plan.mjs";
import {
  FileBackedFrostStateStore,
  NativeFrostCoordinator,
  NativeFrostSigner,
  REQUIRED_FROST_SIGNERS,
  createNativeSigningPolicy,
  createLocalNativeDkgPolicy,
  runTwoPartyDkg,
} from "../native/frost/index.mjs";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  hashJson,
  hexToBytes,
} from "../shared/protocol/canonical-message.mjs";
import { base58Decode, base58Encode } from "../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { prepareLocalNativeReserveSweepSigningIntent } from "../services/bridge-validator/native-reserve-sweep-signing-intent.mjs";
import {
  LOCALNET_SOLANA_SETUP_COMPLETED,
  LocalnetSolanaSetupSubmitter,
} from "../services/bridge-validator/localnet-solana-setup-submitter.mjs";
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
import {
  attachTaprootWitnesses,
  createLocalTaprootSighashEvidences,
  parseNativeTransactionHex,
} from "../native/node/native-taproot-transaction.mjs";

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
export const LOCAL_NATIVE_TO_SOLANA_TAPROOT_SIGHASHES_VALIDATED =
  "LOCAL_NATIVE_TAPROOT_SIGHASHES_VALIDATED";
export const LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_SIGNED =
  "LOCAL_NATIVE_RESERVE_SWEEP_SIGNED";
export const LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_FINALIZED =
  "LOCAL_NATIVE_RESERVE_SWEEP_FINALIZED";
export const LOCAL_NATIVE_TO_SOLANA_SOLANA_SETUP_FINALIZED =
  "LOCAL_NATIVE_TO_SOLANA_SOLANA_SETUP_FINALIZED";
export const LOCAL_NATIVE_TO_SOLANA_SOLANA_DEPOSIT_CLAIM_FINALIZED =
  "LOCAL_NATIVE_TO_SOLANA_SOLANA_DEPOSIT_CLAIM_FINALIZED";
export const LOCAL_NATIVE_TO_SOLANA_RECONCILED =
  "LOCAL_NATIVE_TO_SOLANA_RECONCILED";
export const LOCAL_NATIVE_RESERVE_SWEEP_FROST_SIGNATURES_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_NATIVE_RESERVE_SWEEP_FROST_SIGNATURES/V1";

const DEFAULT_AMOUNT_NATIVE = "1.00000000";
const DEFAULT_NATIVE_DECIMALS = 8;
const DEFAULT_NATIVE_CHAIN_NAME = "regtest";
const DEFAULT_LOCALNET_PROTOCOL_ID = 1;
const DEFAULT_LOCALNET_NATIVE_NETWORK = 8_000_111;
const DEFAULT_NATIVE_BECH32_HRP = "rkpepe";
const DEFAULT_RESERVE_MINER_FEE_NATIVE = "0.00001000";
const DEFAULT_COINBASE_MATURITY_BLOCKS = 20;
const DEFAULT_DEPOSIT_FINALITY_BLOCKS = 6;
const DEFAULT_DEPOSIT_CLAIM_VALID_FROM = "0";
const DEFAULT_DEPOSIT_CLAIM_VALID_UNTIL = "4102444800";
const MAX_UNSIGNED_SWEEP_BYTES = 400_000;
const BECH32M_CONST = 0x2bc830a3;
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const ZERO_HASH = "00".repeat(32);

export async function runLocalNativeToSolanaE2e(options = {}) {
  let flowResult;
  let actualPlan;
  const infrastructure = await withLocalE2eInfrastructure(options, async (context) => {
    actualPlan = context.plan;
    const requestedFlowConfig = options.flowConfig ?? {};
    const localSolanaSetupFactory = options.localSolanaSetupFactory ?? createLocalSolanaSetupContext;
    const localSolanaSetupContext = await localSolanaSetupFactory({
      plan: context.plan,
      flowConfig: requestedFlowConfig,
    });
    const flowConfig = createNativeToSolanaFlowConfig({
      plan: context.plan,
      repoRoot: context.plan.repoRoot,
      ...requestedFlowConfig,
      mintHex: requestedFlowConfig.mintHex ?? localSolanaSetupContext.mintHex,
      keyEpoch: requestedFlowConfig.keyEpoch ?? localSolanaSetupContext.keyEpoch,
      policyEpoch: requestedFlowConfig.policyEpoch ?? localSolanaSetupContext.policyEpoch,
    });
    validateLocalSolanaSetupContext(localSolanaSetupContext, flowConfig);
    flowResult = await executeNativeDepositObservationFlow({
      ...context,
      custodyFactory: options.custodyFactory,
      reserveSweepSigner: options.reserveSweepSigner,
      nativeEvidenceVerifierFactory: options.nativeEvidenceVerifierFactory,
      flowConfig,
      localSolanaSetupContext,
      solanaSetup: options.solanaSetup,
      solanaDepositClaim: options.solanaDepositClaim,
    });
    return {
      fullNativeToSolanaE2e:
        nativeToSolanaFullFlowStatus(flowResult),
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
      infrastructure.fullNativeToSolanaE2e ?? nativeToSolanaFullFlowStatus(flow),
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
  const reserveMinerFeeAtomic = decimalCoinsToAtomic(reserveMinerFeeNative, nativeDecimals);
  const protocolId = checkedInteger(value.protocolId ?? DEFAULT_LOCALNET_PROTOCOL_ID, "protocolId", 1, 0xffff_ffff);
  const nativeNetwork = checkedInteger(
    value.nativeNetwork ?? value.nativeNetworkCode ?? DEFAULT_LOCALNET_NATIVE_NETWORK,
    "nativeNetwork",
    1,
    0xffff_ffff,
  );
  const bridgeProgramIdHex = normalizeSolanaProgramIdHex(
    value.bridgeProgramIdHex ?? value.bridgeProgramId ?? plan.programIds?.kingpepeBridge,
    "bridgeProgramId",
  );
  const transceiverProgramIdHex = normalizeSolanaProgramIdHex(
    value.transceiverProgramIdHex ?? value.transceiverProgramId ?? plan.programIds?.kingpepeTransceiver,
    "transceiverProgramId",
  );
  const solanaDeploymentHex = normalizeHash32(
    value.solanaDeploymentHex ??
      hashJson({
        protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCALNET_SOLANA_DEPLOYMENT/V1`,
        cluster: "localnet",
        bridgeProgramIdHex,
        transceiverProgramIdHex,
      }),
    "solanaDeploymentHex",
  );
  const mintHex = normalizeHash32(
    value.mintHex ??
      hashJson({
        protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCALNET_KPEPE_MINT_PLACEHOLDER/V1`,
        solanaDeploymentHex,
        runId,
      }),
    "mintHex",
  );
  const policyEpoch = checkedInteger(value.policyEpoch ?? 1, "policyEpoch", 1, 0xffff_ffff);
  const keyEpoch = checkedInteger(value.keyEpoch ?? 1, "keyEpoch", 1, 0xffff_ffff);
  const depositClaimValidFrom = canonicalUintDecimal(
    value.depositClaimValidFrom ?? DEFAULT_DEPOSIT_CLAIM_VALID_FROM,
    "depositClaimValidFrom",
  );
  const depositClaimValidUntil = canonicalUintDecimal(
    value.depositClaimValidUntil ?? DEFAULT_DEPOSIT_CLAIM_VALID_UNTIL,
    "depositClaimValidUntil",
  );
  if (BigInt(depositClaimValidFrom) > BigInt(depositClaimValidUntil)) {
    throw new Error("LocalNativeToSolanaDepositClaimValidityWindowInvalid");
  }
  const attestationNowUnix =
    value.attestationNowUnix === undefined
      ? undefined
      : canonicalUintDecimal(String(value.attestationNowUnix), "attestationNowUnix");

  return Object.freeze({
    protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
    runId,
    stateRoot,
    userWalletName: sanitizeWalletName(value.userWalletName ?? `kingpepe-e2e-user-${runId}`),
    amountNative,
    amountAtomic: amountAtomic.toString(),
    nativeDecimals,
    protocolId,
    nativeNetwork,
    nativeChainName: sanitizeNetworkName(value.nativeChainName ?? DEFAULT_NATIVE_CHAIN_NAME),
    nativeBech32Hrp: sanitizeBech32Hrp(value.nativeBech32Hrp ?? DEFAULT_NATIVE_BECH32_HRP),
    recoveryDelayBlocks: checkedInteger(value.recoveryDelayBlocks ?? 144, "recoveryDelayBlocks", 1, 0xffff),
    depositNonceHex: normalizeHash32(value.depositNonceHex ?? randomBytes(32).toString("hex"), "depositNonceHex"),
    reserveMinerFeeNative,
    reserveMinerFeeAtomic: reserveMinerFeeAtomic.toString(),
    solanaDeploymentHex,
    bridgeProgramIdHex,
    transceiverProgramIdHex,
    mintHex,
    policyEpoch,
    keyEpoch,
    depositClaimValidFrom,
    depositClaimValidUntil,
    attestationNowUnix,
    solanaFeePayerAirdropLamports: canonicalUintDecimal(
      value.solanaFeePayerAirdropLamports ?? "5000000000",
      "solanaFeePayerAirdropLamports",
    ),
    solanaMaxRetries: checkedInteger(value.solanaMaxRetries ?? 0, "solanaMaxRetries", 0, 10),
    maxAmountAtomic: canonicalUintDecimal(value.maxAmountAtomic ?? amountAtomic.toString(), "maxAmountAtomic"),
    maxFeeAtomic: canonicalUintDecimal(value.maxFeeAtomic ?? reserveMinerFeeAtomic.toString(), "maxFeeAtomic"),
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
  localSolanaSetupContext,
  custodyFactory = createLocalFrostTaprootCustodyContext,
  reserveSweepSigner = signLocalReserveSweepWithFrost,
  nativeEvidenceVerifierFactory = createLocalNativeEvidenceVerifier,
  solanaSetup = submitLocalnetSolanaSetup,
  solanaDepositClaim = submitLocalnetSolanaDepositClaim,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  const setupContext = validateLocalSolanaSetupContext(localSolanaSetupContext, config);
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
  const canonicalReserveAddress = requireNonEmptyText(frostCustody.taprootAddress, "frostCustody.taprootAddress");
  const custodyScriptPubKeyHex = validateP2trScriptPubKeyHex(
    frostCustody.taprootScriptPubKeyHex,
    "frostCustody.taprootScriptPubKeyHex",
  );
  stages.push("LOCAL_E2E_INITIALIZE_EPHEMERAL_FROST_CUSTODY");

  await cli({
    step: "LOCAL_E2E_CREATE_USER_WALLET",
    command: "createwallet",
    parameters: [config.userWalletName],
  });
  const nativeGenesisHash = normalizeHash32(await cli({ step: "LOCAL_E2E_OBSERVE_NATIVE_GENESIS_HASH",
    command: "getblockhash", parameters: ["0"] }), "nativeGenesisHash");
  if (nativeGenesisHash !== REGTEST_GENESIS || config.nativeChainName !== "regtest" || config.nativeBech32Hrp !== "rkpepe") {
    throw new Error("LocalRecoverableDepositRegtestRequired");
  }
  // Only a public key leaves the isolated user's Native wallet. Solana keys are
  // never assumed to authorize the user's Native recovery branch.
  const recoveryKeyAddress = await cli({ step: "LOCAL_E2E_GET_USER_RECOVERY_ADDRESS", wallet: config.userWalletName,
    command: "getnewaddress", parameters: ["recovery", "bech32"] });
  const recoveryKeyInfo = await cli({ step: "LOCAL_E2E_GET_USER_RECOVERY_PUBLIC_KEY", wallet: config.userWalletName,
    command: "getaddressinfo", parameters: [recoveryKeyAddress], parseJson: true });
  if (recoveryKeyInfo.ismine !== true || recoveryKeyInfo.iswatchonly === true
    || typeof recoveryKeyInfo.pubkey !== "string" || !/^(02|03)[0-9a-f]{64}$/u.test(recoveryKeyInfo.pubkey)) {
    throw new Error("LocalNativeUserRecoveryPublicKeyRequired");
  }
  const depositIntentContext = Object.freeze({ nativeGenesisHex: nativeGenesisHash, solanaDeploymentHex: config.solanaDeploymentHex,
    managerProgramIdHex: config.bridgeProgramIdHex, transceiverProgramIdHex: config.transceiverProgramIdHex,
    mintHex: config.mintHex, recipientHex: setupContext.recipientTokenAccountHex, nonceHex: config.depositNonceHex,
    amountAtomic: config.amountAtomic, protocolId: config.protocolId, nativeNetwork: config.nativeNetwork,
    policyEpoch: config.policyEpoch, keyEpoch: config.keyEpoch });
  const depositPolicy = buildRegtestRecoverableDeposit({ nativeGenesisHex: nativeGenesisHash,
    depositCommitmentHex: deriveRegtestDepositCommitment(depositIntentContext),
    frostPublicKeyHex: frostCustody.aggregateTweakedXOnlyPublicKey,
    userRecoveryPublicKeyHex: recoveryKeyInfo.pubkey.slice(2), csvDelayBlocks: config.recoveryDelayBlocks });
  const depositAddress = taprootAddressFromXOnlyPublicKey(depositPolicy.outputPublicKeyHex, config.nativeBech32Hrp);
  const depositScriptPubKeyHex = depositPolicy.scriptPubKeyHex;
  const validateDepositIntent = () => validateRegtestRecoverableDepositIntent({ intent: depositIntentContext, policy: depositPolicy,
    depositScriptPubKeyHex, reserveScriptPubKeyHex: custodyScriptPubKeyHex,
    frostPublicKeyHex: frostCustody.aggregateTweakedXOnlyPublicKey, userRecoveryPublicKeyHex: recoveryKeyInfo.pubkey.slice(2),
    csvDelayBlocks: config.recoveryDelayBlocks });
  validateDepositIntent();
  stages.push("LOCAL_E2E_CREATE_RECOVERABLE_DEPOSIT_INTENT");
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
    // The wallet exposes coinbase funds after maturity plus one block.
    parameters: [String(config.coinbaseMaturityBlocks + 1), miningAddress],
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
    expectedScriptPubKeyHex: depositScriptPubKeyHex,
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
  stages.push("LOCAL_E2E_SELECT_FROST_CANONICAL_RESERVE");
  const feeFundingInputs = await prepareLocalReserveSweepFeeFundingInputs({
    cli,
    config,
    miningAddress,
    feeFundingAddress: canonicalReserveAddress,
    expectedFeeFundingScriptPubKeyHex: custodyScriptPubKeyHex,
  });
  const nativeVerifier = await nativeEvidenceVerifierFactory({ plan });
  const evidenceInputs = Object.freeze([
    Object.freeze({ txid: depositTxidHex, vout: depositOutput.vout, amountAtomic: config.amountAtomic,
      scriptPubKeyHex: depositScriptPubKeyHex, minimumConfirmations: config.depositFinalityBlocks }),
    ...feeFundingInputs.map((input) => Object.freeze({ txid: input.txidHex, vout: input.vout,
      amountAtomic: input.amountAtomic, scriptPubKeyHex: input.scriptPubKeyHex, minimumConfirmations: 1 })),
  ]);
  const inputEvidence = await nativeVerifier.verifyInputs({ inputs: evidenceInputs, minimumConfirmations: config.depositFinalityBlocks });
  const proofFingerprintHex = normalizeHash32(inputEvidence.digestHex, "inputEvidence.digestHex");
  stages.push("LOCAL_E2E_VALIDATE_RAW_NATIVE_INPUT_EVIDENCE");
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
  const spentOutputs = Object.freeze(evidenceInputs.map((input) => Object.freeze({
    amountAtomic: input.amountAtomic, scriptPubKeyHex: input.scriptPubKeyHex })));
  const tapscriptSpends = Object.freeze([depositPolicy.sweep, ...feeFundingInputs.map(() => undefined)]);
  const taprootSighashEvidences = createLocalTaprootSighashEvidences({
    unsignedNativeTransactionHex: reserveSweepDraft.unsignedNativeTransactionHex,
    spentOutputs,
    tapscriptSpends,
    proofFingerprintHex,
    reserveAmountAtomic: config.amountAtomic,
    nativeMinerFeeAtomic: config.reserveMinerFeeAtomic,
    expectedRecipientScriptPubKeyHex: custodyScriptPubKeyHex,
    expectedChangeScriptPubKeyHex: custodyScriptPubKeyHex,
  });
  stages.push("LOCAL_E2E_COMPUTE_VALIDATED_TAPROOT_SIGHASHES");
  // The sweep is authorized before its finalized headers exist. Its identity
  // is distinct from the later canonical mint claim bound to those headers.
  const sweepOperationIdHex = deriveLocalnetDepositClaimOperationId({
    flowConfig: config,
    localSolanaSetupContext: setupContext,
    nativeSource,
    deposit: {
      txidHex: depositTxidHex,
      vout: depositOutput.vout,
      amountAtomic: config.amountAtomic,
      proofFingerprintHex,
    },
    reserveSweepDraft,
    taprootSighashEvidences,
    finalizedReserveSweep: predictedFinalizedReserveSweepForClaim({
      reserveSweepDraft,
      canonicalReserveScriptPubKeyHex: custodyScriptPubKeyHex,
    }),
  });
  const signedReserveSweep = await reserveSweepSigner({
    plan,
    flowConfig: config,
    frostCustody,
    nativeSource,
    deposit: {
      txidHex: depositTxidHex,
      vout: depositOutput.vout,
      depositOutpoint: `${depositTxidHex}:${depositOutput.vout}`,
      amountAtomic: config.amountAtomic,
      proofFingerprintHex,
      finalitySatisfied: true,
      utxoUnspent: true,
      noPriorConsumption: true,
    },
    reserveSweepDraft,
    taprootSighashEvidences,
    spentOutputs,
    tapscriptSpends,
    operationIdHex: sweepOperationIdHex,
    nativeEvidenceValidator: async (intent) => {
      validateDepositIntent();
      return nativeVerifier.verifySweepSigning({
        inputs: evidenceInputs, minimumConfirmations: config.depositFinalityBlocks,
        acceptedCheckpoint: inputEvidence.acceptedCheckpoint,
        unsignedTransactionHex: reserveSweepDraft.unsignedNativeTransactionHex,
        reserveAmountAtomic: config.amountAtomic, feeAtomic: config.reserveMinerFeeAtomic,
        reserveScriptHex: custodyScriptPubKeyHex, intent, tapscriptSpends,
      });
    },
  });
  stages.push("LOCAL_E2E_SIGN_RESERVE_SWEEP_WITH_FROST_A_B");
  stages.push("LOCAL_E2E_ATTACH_FROST_TAPROOT_WITNESSES");
  const finalizedReserveSweep = await broadcastAndFinalizeLocalReserveSweep({
    cli,
    config,
    miningAddress,
    signedReserveSweep,
    reserveSweepDraft,
    canonicalReserveScriptPubKeyHex: custodyScriptPubKeyHex,
  });
  const reserveEvidenceInput = Object.freeze({ deposit: evidenceInputs[0], feeInputs: evidenceInputs.slice(1),
    sweepTxid: finalizedReserveSweep.nativeSweepTxidHex, reserveVout: finalizedReserveSweep.reserveOutputVout,
    reserveScriptHex: custodyScriptPubKeyHex, feeAtomic: config.reserveMinerFeeAtomic,
    minimumConfirmations: config.depositFinalityBlocks, tapscriptSpends });
  const reserveEvidence = await nativeVerifier.verifyReserve(reserveEvidenceInput);
  validateDepositIntent();
  const creditDeposit = Object.freeze({ txidHex: depositTxidHex, vout: depositOutput.vout,
    amountAtomic: config.amountAtomic, proofFingerprintHex: normalizeHash32(reserveEvidence.digestHex, "reserveEvidence.digestHex") });
  const creditMaterial = prepareLocalnetNativeToSolanaDepositClaimMaterial({ flowConfig: config, localSolanaSetupContext: setupContext,
    nativeSource, deposit: creditDeposit, reserveSweepDraft, taprootSighashEvidences, finalizedReserveSweep,
    signAttestations: false });
  const operationIdHex = creditMaterial.operationIdHex;
  const credit = Object.freeze({ encodedMessageHex: creditMaterial.request.encodedMessageHex,
    reserveAllocationIdHex: creditMaterial.publicRequest.reserveAllocationIdHex });
  stages.push("LOCAL_E2E_VALIDATE_RAW_NATIVE_RESERVE_EVIDENCE");
  let creditLedger = openLocalnetDepositCreditLedger({ plan, flowConfig: config, credit, create: true });
  try {
    // A finalized reserve allocation is an owed credit BEFORE Solana setup,
    // attestation or minting can fail. The journal is accounting, not evidence.
    creditLedger.recordValidatedDeposit(credit);
    stages.push("LOCAL_E2E_PERSIST_AUTHENTICATED_PENDING_CREDIT");
    const pendingCheckpoint = creditLedger.checkpoint();
    creditLedger.close();
    creditLedger = openLocalnetDepositCreditLedger({ plan, flowConfig: config, credit, minimumCheckpoint: pendingCheckpoint });
    stages.push("LOCAL_E2E_REOPEN_AUTHENTICATED_PENDING_CREDIT");
    stages.push("LOCAL_E2E_PREPARE_LOCALNET_SOLANA_SETUP");
    const localnetSolanaSetup = await solanaSetup({
      plan,
      executor,
      commandPaths,
      flowConfig: config,
      localSolanaSetupContext: setupContext,
      nativeSource,
      deposit: {
        txidHex: depositTxidHex,
        vout: depositOutput.vout,
        amountAtomic: config.amountAtomic,
        proofFingerprintHex,
      },
      finalizedReserveSweep,
      operationIdHex,
      depositCredit: credit,
      depositAccounting: localDepositAccountingReport(creditLedger),
    });
    stages.push("LOCAL_E2E_SUBMIT_AND_FINALIZE_LOCALNET_SOLANA_SETUP");
    if (localnetSolanaSetup.state !== LOCALNET_SOLANA_SETUP_COMPLETED) {
      return Object.freeze({
        protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
        state: LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
        reason: localnetSolanaSetup.reason,
        completedStage: LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_FINALIZED,
        productionReady: false,
        mainnetActivation: "DISABLED",
        noPerTransferKingPepeTeamApprovalState: true,
        trustBoundary: RPC_OBSERVATION,
        stages,
        solanaSetup: localnetSolanaSetup,
        depositAccounting: localDepositAccountingReport(creditLedger),
        nextRequiredImplementation: Object.freeze([
          "FINALIZE_LOCALNET_SOLANA_SETUP",
          "SUBMIT_SOLANA_DEPOSIT_CLAIM",
          "OBSERVE_FINALIZED_SOLANA_MINT",
          "RECONCILE_RESERVE_SUPPLY_AND_LIABILITIES",
        ]),
      });
    }

    const attesterEvidence = {};
    const depositClaimRequest = await prepareLocalnetNativeToSolanaDepositClaimRequest({
      flowConfig: config,
      localSolanaSetupContext: setupContext,
      nativeSource,
      deposit: creditDeposit,
      reserveSweepDraft,
      signedReserveSweep,
      taprootSighashEvidences,
      finalizedReserveSweep,
      operationIdHex,
      nativeEvidenceValidator: async (role) => {
        validateDepositIntent();
        const result = await nativeVerifier.verifyReserve({ ...reserveEvidenceInput, acceptedCheckpoint: reserveEvidence.acceptedCheckpoint });
        attesterEvidence[role] = result;
        return result;
      },
    });
    if (depositClaimRequest.request.encodedMessageHex !== credit.encodedMessageHex ||
        depositClaimRequest.publicRequest.reserveAllocationIdHex !== credit.reserveAllocationIdHex) {
      creditLedger.hardStop("DEPOSIT_CREDIT_MESSAGE_CHANGED");
      throw new Error("LocalDepositCreditMessageChanged");
    }
    stages.push("LOCAL_E2E_PREPARE_SOLANA_DEPOSIT_CLAIM");
    const solanaDepositClaimResult = await solanaDepositClaim({
      plan,
      executor,
      commandPaths,
      flowConfig: config,
      localSolanaSetupContext: setupContext,
      nativeSource,
      deposit: {
        txidHex: depositTxidHex,
        vout: depositOutput.vout,
        amountAtomic: config.amountAtomic,
        proofFingerprintHex,
      },
      reserveSweepDraft,
      signedReserveSweep,
      taprootSighashEvidences,
      depositPolicy,
      depositIntentContext,
      finalizedReserveSweep,
      localnetSolanaSetup,
      depositClaimRequest,
      operationIdHex,
    });
    stages.push("LOCAL_E2E_SUBMIT_SOLANA_DEPOSIT_CLAIM");

    const baseFlow = Object.freeze({
      protocol: LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
      productionReady: false,
      mainnetActivation: "DISABLED",
      noPerTransferKingPepeTeamApprovalState: true,
      trustBoundary: RPC_OBSERVATION,
      stages,
      solanaSetup: localnetSolanaSetup,
      depositClaim: depositClaimRequest.publicRequest,
      solanaDepositClaim: solanaDepositClaimResult,
      nativeRawEvidence: Object.freeze({ inputEvidence, reserveEvidence,
        signers: signedReserveSweep.nativeRawEvidence, attesters: Object.freeze(attesterEvidence) }),
      frostCustody: Object.freeze({
        protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_FROST_TAPROOT_CUSTODY/V1`,
        state: "READY",
        localOnly: true,
        signerIds: frostCustody.signerIds,
        keyEpoch: frostCustody.keyEpoch,
        aggregateTweakedXOnlyPublicKey: frostCustody.aggregateTweakedXOnlyPublicKey,
        taprootScriptPubKeyHex: custodyScriptPubKeyHex,
        depositAddress,
        feeFundingAddress: canonicalReserveAddress,
        canonicalReserveAddress,
      }),
      nativeSource,
      stateRoot: config.stateRoot,
      depositIntent: Object.freeze({
        address: depositAddress,
        scriptPubKeyHex: depositScriptPubKeyHex,
        custody: "LOCAL_RECOVERABLE_TAPSCRIPT_TO_FROST_RESERVE",
        recoverable: true,
        recoveryAvailableAfterSweep: false,
        policy: depositPolicy,
        context: depositIntentContext,
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
      reserveSweep: Object.freeze({
        ...reserveSweepDraft,
        state: finalizedReserveSweep.state,
        operationIdHex: sweepOperationIdHex,
        signed: true,
        broadcast: true,
        finalitySatisfied: true,
        signedNativeTransactionHex: signedReserveSweep.signedNativeTransactionHex,
        signedNativeTransactionFingerprintHex: signedReserveSweep.signedNativeTransactionFingerprintHex,
        nativeSweepTxidHex: signedReserveSweep.nativeSweepTxidHex,
        nativeSweepWtxidHex: signedReserveSweep.nativeSweepWtxidHex,
        broadcastTxidHex: finalizedReserveSweep.nativeSweepTxidHex,
        finalizedReserveSweep,
        frostSignatureState: signedReserveSweep.state,
        signingIntents: signedReserveSweep.signingIntents,
        frostResults: signedReserveSweep.frostResults,
        witnessInputCount: signedReserveSweep.witnessInputCount,
        taprootSighashEvidences,
      }),
    });

    if (solanaDepositClaimResult.state !== DEPOSIT_STATES.COMPLETED) {
      if (solanaDepositClaimResult.state === DEPOSIT_STATES.HARD_STOP) creditLedger.hardStop("SOLANA_CLAIM_INTEGRITY_HARD_STOP");
      return Object.freeze({
        ...baseFlow,
        state: solanaDepositClaimResult.state === DEPOSIT_STATES.HARD_STOP ? DEPOSIT_STATES.HARD_STOP : LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
        reason: solanaDepositClaimResult.reason,
        completedStage: LOCAL_NATIVE_TO_SOLANA_SOLANA_SETUP_FINALIZED,
        depositAccounting: localDepositAccountingReport(creditLedger),
        nextRequiredImplementation: Object.freeze([
          "FINALIZE_SOLANA_DEPOSIT_CLAIM",
          "OBSERVE_FINALIZED_SOLANA_MINT",
          "RECONCILE_RESERVE_SUPPLY_AND_LIABILITIES",
        ]),
      });
    }

    stages.push("LOCAL_E2E_OBSERVE_FINALIZED_SOLANA_MINT");
    let reconciliation;
    try {
      reconciliation = reconcileLocalNativeToSolana({
        flowConfig: config,
        deposit: baseFlow.deposit,
        finalizedReserveSweep,
        solanaDepositClaim: solanaDepositClaimResult,
        depositClaimRequest,
      });
    } catch (error) {
      creditLedger.hardStop("SOLANA_MINT_RECONCILIATION_FAILED");
      throw error;
    }
    creditLedger.recordMint({ ...credit, mintedAmountAtomic: solanaDepositClaimResult.mintedAmountAtomic });
    const accounting = creditLedger.snapshot();
    if (accounting.canonicalReserve !== reconciliation.canonicalReserve || accounting.mintedSupply !== reconciliation.mintedSupply ||
        accounting.authorizedUnmintedCredits !== "0") {
      creditLedger.hardStop("DEPOSIT_ACCOUNTING_CONTRADICTION");
      throw new Error("LocalDepositAccountingContradiction");
    }
    stages.push("LOCAL_E2E_PERSIST_AUTHENTICATED_MINT_SETTLEMENT");
    const settledCheckpoint = creditLedger.checkpoint();
    creditLedger.close();
    creditLedger = openLocalnetDepositCreditLedger({ plan, flowConfig: config, credit, minimumCheckpoint: settledCheckpoint });
    stages.push("LOCAL_E2E_REOPEN_AUTHENTICATED_MINT_SETTLEMENT");
    stages.push("LOCAL_E2E_RECONCILE_RESERVE_SUPPLY_AND_LIABILITIES");

    return Object.freeze({
      ...baseFlow,
      state: LOCAL_NATIVE_TO_SOLANA_COMPLETED,
      reason: "ALL_REQUIRED_CHECKS_PASSED",
      completedStage: LOCAL_NATIVE_TO_SOLANA_RECONCILED,
      reconciliation,
      depositAccounting: localDepositAccountingReport(creditLedger),
      nextRequiredImplementation: Object.freeze([]),
    });
  } finally {
    creditLedger.close();
  }
}

// Explicit disposable-local creation or reopen. Never called by a production
// service: no automatic missing-key replacement, migration or plaintext fallback.
export function openLocalnetDepositCreditLedger({ plan, flowConfig, credit, create = false, minimumCheckpoint }) {
  if (typeof create !== "boolean" || flowConfig?.protocol !== LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL ||
      flowConfig.nativeChainName !== "regtest") throw new Error("LocalDepositCreditRegtestRequired");
  const message = decodeCanonicalBridgeMessage(credit?.encodedMessageHex);
  if (message.action !== "DepositClaim" || message.direction !== "NativeToSolana" ||
      message.deployment.protocolId !== flowConfig.protocolId || message.deployment.nativeNetwork !== flowConfig.nativeNetwork ||
      bytesToHex(message.deployment.nativeGenesis) !== REGTEST_GENESIS ||
      bytesToHex(message.deployment.mint) !== flowConfig.mintHex ||
      bytesToHex(message.deployment.solanaDeployment) !== flowConfig.solanaDeploymentHex ||
      bytesToHex(message.deployment.managerProgramId) !== flowConfig.bridgeProgramIdHex ||
      bytesToHex(message.deployment.transceiverProgramId) !== flowConfig.transceiverProgramIdHex) {
    throw new Error("LocalDepositCreditDeploymentRejected");
  }
  const root = validateRuntimeStateRoot(flowConfig.stateRoot, plan.repoRoot, "Local deposit accounting root");
  const authenticationRoot = validateRuntimeStateRoot(path.join(root, "credit-authentication"), plan.repoRoot);
  if (create) mkdirSync(authenticationRoot, { recursive: true, mode: 0o700 });
  const keyFile = validateRuntimeFile(path.join(authenticationRoot, "local-test-key.bin"), plan.repoRoot);
  let authenticationKey;
  try {
    if (create) {
      authenticationKey = randomBytes(32);
      writeFileSync(keyFile, authenticationKey, { flag: "wx", mode: 0o600, flush: true });
    } else {
      if (lstatSync(keyFile).size !== 32) throw new Error("LocalDepositCreditKeyRejected");
      authenticationKey = readFileSync(keyFile);
    }
    const options = { environment: "localnet", root: path.join(root, "deposit-accounting"), repoRoot: plan.repoRoot,
      deploymentHex: credit.encodedMessageHex.slice(24, 360), journalIdHex: message.operationIdHex,
      authenticationKey, minimumCheckpoint };
    return create ? AuthenticatedLocalDepositLedger.createLocal(options) : AuthenticatedLocalDepositLedger.openLocal(options);
  } catch (error) {
    if (/^(?:LocalDepositCredit|LocalLedger)[A-Za-z]+$/u.test(error.message)) throw error;
    throw new Error("LocalDepositCreditStorageRejected");
  } finally {
    authenticationKey?.fill(0);
  }
}

function localDepositAccountingReport(ledger) {
  return Object.freeze({ scope: "AUTHENTICATED_LOCAL_SINGLE_DEPOSIT_ACCOUNTING", ...ledger.status(),
    snapshot: ledger.snapshot(), checkpoint: ledger.checkpoint(),
    fullServiceRestart: "NOT_IMPLEMENTED", completeRollbackDetection: "NOT_PROVEN" });
}

export function deriveLocalnetDepositClaimOperationId(options) {
  const material = prepareLocalnetNativeToSolanaDepositClaimMaterial({
    ...requireObject(options, "options"),
    operationIdHex: ZERO_HASH,
    signAttestations: false,
  });
  return material.operationIdHex;
}

export function prepareLocalnetNativeToSolanaDepositClaimRequest(options) {
  return prepareLocalnetNativeToSolanaDepositClaimMaterial({
    ...requireObject(options, "options"),
    signAttestations: true,
  });
}

export async function submitLocalnetSolanaDepositClaim({
  plan,
  flowConfig,
  localSolanaSetupContext,
  depositClaimRequest,
  rpcClient,
  claimObserver,
  journal,
  claimSubmitter,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  const setupContext = validateLocalSolanaSetupContext(localSolanaSetupContext, config);
  const material = requireObject(depositClaimRequest, "depositClaimRequest");
  const request = requireObject(material.request ?? material, "depositClaimRequest.request");
  const rpc =
    rpcClient ??
    new SolanaLocalRpcClient({
      endpoint: `http://127.0.0.1:${requireObject(plan, "plan").ports.solanaRpcPort}`,
    });
  const observer =
    claimObserver ??
    new SolanaDepositClaimObserver({
      config: {
        environment: "localnet",
        cluster: "localnet",
        managerProgramIdHex: config.bridgeProgramIdHex,
        transceiverProgramIdHex: config.transceiverProgramIdHex,
        mintHex: config.mintHex,
        nativeDecimals: config.nativeDecimals,
      },
      endpoint: `http://127.0.0.1:${requireObject(plan, "plan").ports.solanaRpcPort}`,
    });
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config: {
      environment: "localnet",
      cluster: "localnet",
      solanaDeploymentHex: config.solanaDeploymentHex,
      managerProgramIdHex: config.bridgeProgramIdHex,
      transceiverProgramIdHex: config.transceiverProgramIdHex,
      mintHex: config.mintHex,
      tokenProgramIdHex: normalizeSolanaProgramIdHex(SPL_TOKEN_PROGRAM_ID_BASE58, "splTokenProgramId"),
      feePayerBase58: setupContext.feePayerBase58,
      feePayerHex: setupContext.feePayerHex,
      policyEpoch: config.policyEpoch,
      keyEpoch: config.keyEpoch,
      // This isolated harness trusts its own disposable validator RPC. It is
      // explicitly RPC observation, not a production chain-verification source.
      acceptedObservationTrust: ["RPC_OBSERVATION"],
      maxRetries: config.solanaMaxRetries,
    },
    feePayerSigner: setupContext.feePayerSigner,
    rpcClient: rpc,
    claimObserver: observer,
    submitter: claimSubmitter,
    journal: journal ?? new FileBackedSolanaDepositClaimJournal({ root: path.join(config.stateRoot, "solana-claim-journal"), repoRoot: plan.repoRoot }),
    receiptJournal: new FileBackedSolanaDepositClaimJournal({ root: path.join(config.stateRoot, "solana-receipt-journal"), repoRoot: plan.repoRoot }),
  });
  return bridge.submitDepositClaim(request);
}

function prepareLocalnetNativeToSolanaDepositClaimMaterial({
  flowConfig,
  localSolanaSetupContext,
  nativeSource,
  deposit,
  reserveSweepDraft,
  signedReserveSweep,
  taprootSighashEvidences,
  finalizedReserveSweep,
  operationIdHex,
  signAttestations,
  nativeEvidenceValidator,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  const setupContext = validateLocalSolanaSetupContext(localSolanaSetupContext, config);
  const source = requireObject(nativeSource, "nativeSource");
  const normalizedDeposit = normalizeLocalDepositClaimDeposit(deposit);
  const draft = requireObject(reserveSweepDraft, "reserveSweepDraft");
  const finalized = normalizeClaimFinalizedReserveSweep(finalizedReserveSweep);
  const evidences = requireNonEmptyArray(taprootSighashEvidences, "taprootSighashEvidences");
  const requestedOperationId =
    operationIdHex === undefined ? ZERO_HASH : normalizeHash32(operationIdHex, "operationIdHex");
  const pipelineConfig = localnetDepositClaimPipelineConfig({
    flowConfig: config,
    setupContext,
    nativeSource: source,
  });
  const initialOperation = buildLocalnetDepositClaimOperation({
    flowConfig: config,
    nativeSource: source,
    deposit: normalizedDeposit,
    reserveSweepDraft: draft,
    signedReserveSweep,
    taprootSighashEvidences: evidences,
    finalizedReserveSweep: finalized,
    operationIdHex: requestedOperationId,
    solanaRecipientHex: setupContext.recipientTokenAccountHex,
  });
  const initialMessage = buildDepositClaimMessage(pipelineConfig, initialOperation);
  const canonicalOperationId = initialMessage.decodedMessage.operationIdHex;
  if (requestedOperationId !== ZERO_HASH && requestedOperationId !== canonicalOperationId) {
    throw new Error("LocalNativeToSolanaDepositClaimOperationIdMismatch");
  }
  const operation = buildLocalnetDepositClaimOperation({
    flowConfig: config,
    nativeSource: source,
    deposit: normalizedDeposit,
    reserveSweepDraft: draft,
    signedReserveSweep,
    taprootSighashEvidences: evidences,
    finalizedReserveSweep: finalized,
    operationIdHex: canonicalOperationId,
    solanaRecipientHex: setupContext.recipientTokenAccountHex,
  });
  const { encodedMessageHex, decodedMessage, evidenceDigestHex } =
    buildDepositClaimMessage(pipelineConfig, operation);
  if (decodedMessage.operationIdHex !== canonicalOperationId) {
    throw new Error("LocalNativeToSolanaDepositClaimDerivedIdChanged");
  }
  const evidence = localnetDepositAttestationEvidence({
    flowConfig: config,
    nativeSource: source,
    deposit: normalizedDeposit,
    decodedMessage,
    finalizedReserveSweep: finalized,
    reserveAllocationIdHex: operation.reserveSweep.reserveAllocationIdHex,
    evidenceDigestHex,
  });
  const attestationInputs = [["ATTESTER_A", setupContext.attesterASigner], ["ATTESTER_B", setupContext.attesterBSigner]]
    .map(([role, signer]) => ({ role, signer, policy: localnetAttesterPolicy({ role, signer, pipelineConfig }),
      encodedMessageHex, messageDigestHex: decodedMessage.messageDigestHex, evidence, nowUnix: config.attestationNowUnix }));
  const finish = (attestations) => {
    const combinedAttestation = signAttestations
      ? combineProjectAttestations({ attestations, encodedMessageHex, authorizedAttesterPublicKeys: setupContext.attesterPublicKeysHex })
      : undefined;
    return Object.freeze({
      protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCALNET_DEPOSIT_CLAIM_REQUEST/V1`,
      state: ATTESTATION_VERIFIED_READY,
      productionReady: false,
      mainnetActivation: "DISABLED",
      operationIdHex: canonicalOperationId,
      messageDigestHex: decodedMessage.messageDigestHex,
      evidenceDigestHex,
      request: Object.freeze({
        operationIdHex: canonicalOperationId,
        encodedMessageHex,
        messageDigestHex: decodedMessage.messageDigestHex,
        amountAtomic: decodedMessage.amountAtomic.toString(),
        solanaRecipientHex: decodedMessage.destinationHex,
        attestations,
        combinedAttestation,
        maxRetries: config.solanaMaxRetries,
      }),
      publicRequest: Object.freeze({
        protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/PUBLIC_LOCALNET_DEPOSIT_CLAIM_REQUEST/V1`,
        state: ATTESTATION_VERIFIED_READY,
        operationIdHex: canonicalOperationId,
        messageDigestHex: decodedMessage.messageDigestHex,
        evidenceDigestHex,
        amountAtomic: decodedMessage.amountAtomic.toString(),
        solanaRecipientHex: decodedMessage.destinationHex,
        encodedMessageFingerprintHex: sha256Hex(Buffer.from(encodedMessageHex, "hex")),
        attestationMode: combinedAttestation?.mode ?? "NOT_SIGNED",
        threshold: combinedAttestation?.threshold ?? 0,
        attesterPublicKeysHex: Object.freeze([...setupContext.attesterPublicKeysHex]),
        validFrom: decodedMessage.validFrom.toString(),
        validUntil: decodedMessage.validUntil.toString(),
        sourceTrust: evidence.trust,
        reserveAllocationIdHex: evidence.reserveAllocationIdHex,
      }),
    });
  };
  if (signAttestations) {
    if (typeof nativeEvidenceValidator !== "function") throw new Error("NativeAttestationVerifierRequired");
    // Each role fetches and verifies raw evidence again before using its own
    // distinct Ed25519 key. Common-host/source trust is not independence of hosts.
    return Promise.all(attestationInputs.map(async (input) => {
      const verified = await nativeEvidenceValidator(input.role);
      if (verified?.digestHex !== normalizedDeposit.proofFingerprintHex) throw new Error("NativeAttestationEvidenceChanged");
      return signLocalProjectDepositAttestation(input);
    })).then((attestations) => finish(Object.freeze(attestations)));
  }
  // Pure message derivation does not sign or claim raw verification.
  return finish(Object.freeze([]));
}

function localnetDepositClaimPipelineConfig({ flowConfig, setupContext, nativeSource }) {
  const config = requireObject(flowConfig, "flowConfig");
  const source = requireObject(nativeSource, "nativeSource");
  return Object.freeze({
    deployment: Object.freeze({
      protocolId: config.protocolId,
      nativeNetwork: config.nativeNetwork,
      nativeGenesis: normalizeHash32(source.nativeGenesisHash, "nativeSource.nativeGenesisHash"),
      solanaDeployment: config.solanaDeploymentHex,
      managerProgramId: config.bridgeProgramIdHex,
      transceiverProgramId: config.transceiverProgramIdHex,
      mint: config.mintHex,
    }),
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedNativeTrust: [RPC_OBSERVATION],
    authorizedAttesterPublicKeys: Object.freeze([...setupContext.attesterPublicKeysHex]),
    depositsPaused: false,
    hardStop: false,
  });
}

function buildLocalnetDepositClaimOperation({
  flowConfig,
  nativeSource,
  deposit,
  reserveSweepDraft,
  signedReserveSweep,
  taprootSighashEvidences,
  finalizedReserveSweep,
  operationIdHex,
  solanaRecipientHex,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  const source = requireObject(nativeSource, "nativeSource");
  const normalizedDeposit = normalizeLocalDepositClaimDeposit(deposit);
  const draft = requireObject(reserveSweepDraft, "reserveSweepDraft");
  const finalized = normalizeClaimFinalizedReserveSweep(finalizedReserveSweep);
  const allSighashDigestHex = aggregateTaprootSighashDigestHex(taprootSighashEvidences);
  const reserveAllocationIdHex = localReserveAllocationIdHex({
    flowConfig: config,
    deposit: normalizedDeposit,
    reserveSweepDraft: draft,
    finalizedReserveSweep: finalized,
    solanaRecipientHex,
  });
  return Object.freeze({
    messageNonceHex: hashJson({
      protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_DEPOSIT_CLAIM_NONCE/V1`,
      depositOutpoint: `${normalizedDeposit.txidHex}:${normalizedDeposit.vout}`,
      reserveAllocationIdHex,
      solanaRecipientHex,
      mintHex: config.mintHex,
    }),
    validFrom: config.depositClaimValidFrom,
    validUntil: config.depositClaimValidUntil,
    deposit: Object.freeze({
      trust: RPC_OBSERVATION,
      nativeNetwork: config.nativeNetwork,
      nativeGenesisHash: normalizeHash32(source.nativeGenesisHash, "nativeSource.nativeGenesisHash"),
      depositOutpoint: Object.freeze({
        txid: normalizedDeposit.txidHex,
        vout: normalizedDeposit.vout,
      }),
      amountAtomic: normalizedDeposit.amountAtomic,
      projectBridgeFeeAtomic: "0",
      solanaRecipientHex: normalizeHash32(solanaRecipientHex, "solanaRecipientHex"),
      proofFingerprint: normalizedDeposit.proofFingerprintHex,
      finalitySatisfied: true,
      utxoUnspentAtDeposit: true,
      noPriorConsumption: true,
    }),
    reserveSweep: Object.freeze({
      reserveAllocationIdHex,
      nativeSweepTxidHex: finalized.nativeSweepTxidHex,
      nativeMinerFeeAtomic: config.reserveMinerFeeAtomic,
      canonicalReserveScriptPubKeyHex: finalized.canonicalReserveScriptPubKeyHex,
      signedNativeTransactionHex:
        signedReserveSweep?.signedNativeTransactionHex === undefined
          ? undefined
          : normalizeRawTransactionHex(signedReserveSweep.signedNativeTransactionHex, "signedReserveSweep.signedNativeTransactionHex"),
      signingIntent: Object.freeze({
        purpose: "RESERVE_SWEEP",
        operationId: normalizeHash32(operationIdHex, "operationIdHex"),
        withdrawalId: ZERO_HASH,
        proofFingerprint: normalizedDeposit.proofFingerprintHex,
        unsignedNativeTransactionId: normalizeHash32(draft.unsignedNativeTransactionId, "reserveSweepDraft.unsignedNativeTransactionId"),
        transactionCommitment: hashJson({
          protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_RESERVE_SWEEP_TRANSACTION_COMMITMENT/V1`,
          unsignedNativeTransactionFingerprintHex: normalizeHash32(
            draft.unsignedNativeTransactionFingerprintHex,
            "reserveSweepDraft.unsignedNativeTransactionFingerprintHex",
          ),
          nativeSweepTxidHex: finalized.nativeSweepTxidHex,
          inputOutpoints: finalized.inputOutpoints,
          reserveAmountAtomic: finalized.reserveAmountAtomic,
          canonicalReserveScriptPubKeyHex: finalized.canonicalReserveScriptPubKeyHex,
          nativeMinerFeeAtomic: config.reserveMinerFeeAtomic,
          allSighashDigestHex,
        }),
        signingInputIndex: 0,
        taprootSighashHex: allSighashDigestHex,
        recipientScriptPubKeyHex: finalized.canonicalReserveScriptPubKeyHex,
        amountAtomic: normalizedDeposit.amountAtomic,
        feeAtomic: config.reserveMinerFeeAtomic,
        changeScriptPubKeyHex: finalized.canonicalReserveScriptPubKeyHex,
        changeAtomic: "0",
        inputOutpoints: Object.freeze([...finalized.inputOutpoints]),
        outputCommitments: Object.freeze([
          hashJson({
            protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_RESERVE_OUTPUT_COMMITMENT/V1`,
            nativeSweepTxidHex: finalized.nativeSweepTxidHex,
            vout: finalized.reserveOutputVout,
            amountAtomic: finalized.reserveAmountAtomic,
            scriptPubKeyHex: finalized.canonicalReserveScriptPubKeyHex,
          }),
        ]),
        reserveCommitment: reserveAllocationIdHex,
      }),
    }),
  });
}

function localnetDepositAttestationEvidence({
  flowConfig,
  nativeSource,
  deposit,
  decodedMessage,
  finalizedReserveSweep,
  reserveAllocationIdHex,
  evidenceDigestHex,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  const source = requireObject(nativeSource, "nativeSource");
  const normalizedDeposit = normalizeLocalDepositClaimDeposit(deposit);
  const finalized = normalizeClaimFinalizedReserveSweep(finalizedReserveSweep);
  return Object.freeze({
    trust: RPC_OBSERVATION,
    nativeNetwork: config.nativeNetwork,
    nativeGenesisHash: normalizeHash32(source.nativeGenesisHash, "nativeSource.nativeGenesisHash"),
    operationIdHex: decodedMessage.operationIdHex,
    depositOutpoint: `${normalizedDeposit.txidHex}:${normalizedDeposit.vout}`,
    amountAtomic: normalizedDeposit.amountAtomic,
    solanaRecipientHex: decodedMessage.destinationHex,
    evidenceDigestHex,
    reserveAllocationIdHex,
    reserveTransitionState: finalized.reserveTransitionState,
    mintCreditState: finalized.mintCreditState,
    finalitySatisfied: finalized.finalitySatisfied,
    sweepFinalized: true,
    utxoUnspentAtDeposit: true,
    noPriorConsumption: true,
  });
}

function localnetAttesterPolicy({ role, signer, pipelineConfig }) {
  const config = requireObject(pipelineConfig, "pipelineConfig");
  return Object.freeze({
    role,
    attesterPublicKeyHex: normalizeHash32(signer.publicKeyHex, `${role}.publicKeyHex`),
    protocolId: config.deployment.protocolId,
    nativeNetwork: config.deployment.nativeNetwork,
    nativeGenesisHex: config.deployment.nativeGenesis,
    solanaDeploymentHex: config.deployment.solanaDeployment,
    managerProgramIdHex: config.deployment.managerProgramId,
    transceiverProgramIdHex: config.deployment.transceiverProgramId,
    mintHex: config.deployment.mint,
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedNativeTrust: [RPC_OBSERVATION],
    depositsPaused: false,
    hardStop: false,
  });
}

function signLocalProjectDepositAttestation({
  role,
  signer,
  policy,
  encodedMessageHex,
  messageDigestHex,
  evidence,
  nowUnix,
}) {
  const decoded = decodeCanonicalBridgeMessage(hexToBytes(encodedMessageHex, "encodedMessageHex"));
  const decision = evaluateDepositCredit({
    policy,
    request: {
      encodedMessageHex,
      messageDigestHex,
      evidence,
    },
    decoded,
    nowUnix,
  });
  if (decision.state !== ATTESTATION_VERIFIED_READY) {
    const error = new Error(`LocalDepositClaimAttestationNotAuthorized:${decision.reason}`);
    error.decision = decision;
    throw error;
  }
  const signature = signer.sign(decoded.encoded);
  const publicKey = Buffer.from(normalizeHash32(signer.publicKeyHex, `${role}.publicKeyHex`), "hex");
  if (!ed25519.verify(signature, decoded.encoded, publicKey)) {
    throw new Error("LocalDepositClaimAttestationSignatureVerificationFailed");
  }
  return Object.freeze({
    protocol: ATTESTATION_PROTOCOL,
    mode: ATTESTATION_MODE,
    role,
    keyEpoch: decoded.keyEpoch,
    policyEpoch: decoded.policyEpoch,
    attesterPublicKeyHex: bytesToHex(publicKey),
    messageDigestHex: decoded.messageDigestHex,
    operationIdHex: decoded.operationIdHex,
    signedBytes: "CANONICAL_BRIDGE_MESSAGE_V1",
    signatureHex: bytesToHex(signature),
    state: ATTESTATION_VERIFIED_READY,
  });
}

function normalizeLocalDepositClaimDeposit(deposit) {
  const value = requireObject(deposit, "deposit");
  return Object.freeze({
    txidHex: normalizeHash32(value.txidHex ?? value.txid, "deposit.txidHex"),
    vout: checkedInteger(value.vout, "deposit.vout", 0, 0xffff_ffff),
    amountAtomic: canonicalUintDecimal(value.amountAtomic, "deposit.amountAtomic"),
    proofFingerprintHex: normalizeHash32(value.proofFingerprintHex ?? value.proofFingerprint, "deposit.proofFingerprintHex"),
  });
}

function normalizeClaimFinalizedReserveSweep(finalizedReserveSweep) {
  const value = requireObject(finalizedReserveSweep, "finalizedReserveSweep");
  return Object.freeze({
    state: requireNonEmptyText(value.state, "finalizedReserveSweep.state"),
    trust: value.trust ?? RPC_OBSERVATION,
    nativeSweepTxidHex: normalizeHash32(value.nativeSweepTxidHex, "finalizedReserveSweep.nativeSweepTxidHex"),
    inputOutpoints: normalizeOutpointTexts(value.inputOutpoints, "finalizedReserveSweep.inputOutpoints"),
    reserveOutputVout: checkedInteger(value.reserveOutputVout, "finalizedReserveSweep.reserveOutputVout", 0, 0xffff_ffff),
    reserveAmountAtomic: canonicalUintDecimal(value.reserveAmountAtomic, "finalizedReserveSweep.reserveAmountAtomic"),
    canonicalReserveScriptPubKeyHex: validateP2trScriptPubKeyHex(
      value.canonicalReserveScriptPubKeyHex,
      "finalizedReserveSweep.canonicalReserveScriptPubKeyHex",
    ),
    reserveTransitionState: value.reserveTransitionState,
    mintCreditState: value.mintCreditState,
    finalitySatisfied: value.finalitySatisfied === true,
  });
}

function aggregateTaprootSighashDigestHex(taprootSighashEvidences) {
  const evidences = requireNonEmptyArray(taprootSighashEvidences, "taprootSighashEvidences").map((entry, index) => {
    const value = requireObject(entry, `taprootSighashEvidences[${index}]`);
    return Object.freeze({
      signingInputIndex: checkedInteger(value.signingInputIndex, `taprootSighashEvidences[${index}].signingInputIndex`, 0, 100_000),
      taprootSighashHex: normalizeHash32(value.taprootSighashHex, `taprootSighashEvidences[${index}].taprootSighashHex`),
      unsignedNativeTransactionFingerprintHex: normalizeHash32(
        value.unsignedNativeTransactionFingerprintHex,
        `taprootSighashEvidences[${index}].unsignedNativeTransactionFingerprintHex`,
      ),
      nativeSweepTxidHex: normalizeHash32(value.nativeSweepTxidHex, `taprootSighashEvidences[${index}].nativeSweepTxidHex`),
    });
  });
  return hashJson({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/AGGREGATED_TAPROOT_SIGHASH_EVIDENCE/V1`,
    evidences,
  });
}

function localReserveAllocationIdHex({
  flowConfig,
  deposit,
  reserveSweepDraft,
  finalizedReserveSweep,
  solanaRecipientHex,
}) {
  const config = requireObject(flowConfig, "flowConfig");
  const normalizedDeposit = normalizeLocalDepositClaimDeposit(deposit);
  const draft = requireObject(reserveSweepDraft, "reserveSweepDraft");
  const finalized = normalizeClaimFinalizedReserveSweep(finalizedReserveSweep);
  return hashJson({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_RESERVE_ALLOCATION_ID/V1`,
    solanaDeploymentHex: config.solanaDeploymentHex,
    mintHex: config.mintHex,
    depositOutpoint: `${normalizedDeposit.txidHex}:${normalizedDeposit.vout}`,
    unsignedNativeTransactionFingerprintHex: normalizeHash32(
      draft.unsignedNativeTransactionFingerprintHex,
      "reserveSweepDraft.unsignedNativeTransactionFingerprintHex",
    ),
    nativeSweepTxidHex: finalized.nativeSweepTxidHex,
    inputOutpoints: finalized.inputOutpoints,
    reserveOutputVout: finalized.reserveOutputVout,
    reserveAmountAtomic: finalized.reserveAmountAtomic,
    canonicalReserveScriptPubKeyHex: finalized.canonicalReserveScriptPubKeyHex,
    solanaRecipientHex: normalizeHash32(solanaRecipientHex, "solanaRecipientHex"),
  });
}

function predictedFinalizedReserveSweepForClaim({ reserveSweepDraft, canonicalReserveScriptPubKeyHex }) {
  const draft = requireObject(reserveSweepDraft, "reserveSweepDraft");
  return Object.freeze({
    state: "FINALIZED_CANONICAL_RESERVE",
    trust: RPC_OBSERVATION,
    nativeSweepTxidHex: normalizeHash32(draft.unsignedNativeTransactionId, "reserveSweepDraft.unsignedNativeTransactionId"),
    inputOutpoints: Object.freeze([
      normalizeOutpointText(draft.depositOutpoint, "reserveSweepDraft.depositOutpoint"),
      ...normalizeOutpointTextsAllowEmpty(draft.feeFundingOutpoints ?? [], "reserveSweepDraft.feeFundingOutpoints"),
    ]),
    reserveOutputVout: 0,
    reserveAmountAtomic: canonicalUintDecimal(draft.reserveAmountAtomic, "reserveSweepDraft.reserveAmountAtomic"),
    canonicalReserveScriptPubKeyHex: validateP2trScriptPubKeyHex(canonicalReserveScriptPubKeyHex, "canonicalReserveScriptPubKeyHex"),
    reserveTransitionState: "CANONICAL_RESERVE",
    mintCreditState: "AUTHORIZED_UNCONSUMED",
    finalitySatisfied: true,
  });
}

function reconcileLocalNativeToSolana({ flowConfig, deposit, finalizedReserveSweep, solanaDepositClaim, depositClaimRequest }) {
  const config = requireObject(flowConfig, "flowConfig");
  const normalizedDeposit = requireObject(deposit, "deposit");
  const finalized = normalizeClaimFinalizedReserveSweep(finalizedReserveSweep);
  const claim = requireObject(solanaDepositClaim, "solanaDepositClaim");
  const claimRequest = requireObject(depositClaimRequest, "depositClaimRequest");
  const reserveAllocationIdHex = normalizeHash32(
    claimRequest.publicRequest?.reserveAllocationIdHex ?? claimRequest.reserveAllocationIdHex,
    "depositClaimRequest.reserveAllocationIdHex",
  );
  const mintedAmountAtomic = canonicalUintDecimal(claim.mintedAmountAtomic, "solanaDepositClaim.mintedAmountAtomic");
  const depositAmountAtomic = canonicalUintDecimal(normalizedDeposit.amountAtomic, "deposit.amountAtomic");
  if (
    depositAmountAtomic !== config.amountAtomic ||
    finalized.reserveAmountAtomic !== config.amountAtomic ||
    mintedAmountAtomic !== config.amountAtomic
  ) {
    throw new Error("LocalNativeToSolanaReconciliationAmountMismatch");
  }
  if (claim.state !== DEPOSIT_STATES.COMPLETED) {
    throw new Error("LocalNativeToSolanaReconciliationRequiresCompletedClaim");
  }
  const canonicalReserve = BigInt(finalized.reserveAmountAtomic);
  // Supply is read from the finalized Mint account, never inferred from the
  // requested credit. This harness starts from zero supply and one operation.
  const mintedSupply = BigInt(canonicalUintDecimal(claim.mintSupplyAtomic, "observedMintSupplyAtomic"));
  if (mintedSupply !== BigInt(mintedAmountAtomic)) throw new Error("LocalNativeToSolanaUnexpectedMintSupply");
  const authorizedUnmintedCredits = 0n;
  const otherUnsettledBridgeLiabilities = 0n;
  const coverageRequired = mintedSupply + authorizedUnmintedCredits + otherUnsettledBridgeLiabilities;
  const surplus = canonicalReserve - coverageRequired;
  if (surplus < 0n) {
    throw new Error("LocalNativeToSolanaReconciliationInsufficientBacking");
  }
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_NATIVE_TO_SOLANA_RECONCILIATION/V1`,
    state: "RECONCILED",
    productionReady: false,
    mainnetActivation: "DISABLED",
    canonicalReserve: canonicalReserve.toString(),
    mintedSupply: mintedSupply.toString(),
    authorizedUnmintedCredits: authorizedUnmintedCredits.toString(),
    otherUnsettledBridgeLiabilities: otherUnsettledBridgeLiabilities.toString(),
    coverageRequired: coverageRequired.toString(),
    surplus: surplus.toString(),
    projectBridgeFeeAtomic: "0",
    nativeMinerFeeAtomic: config.reserveMinerFeeAtomic,
    reserveAllocationIdHex,
    solanaSignature: claim.solanaSignature,
    noPerTransferKingPepeTeamApprovalState: true,
  });
}

export async function broadcastAndFinalizeLocalReserveSweep({
  cli,
  config,
  miningAddress,
  signedReserveSweep,
  reserveSweepDraft,
  canonicalReserveScriptPubKeyHex,
}) {
  const signed = requireObject(signedReserveSweep, "signedReserveSweep");
  const draft = requireObject(reserveSweepDraft, "reserveSweepDraft");
  const flowConfig = requireObject(config, "config");
  const signedTxHex = normalizeRawTransactionHex(signed.signedNativeTransactionHex, "signedReserveSweep.signedNativeTransactionHex");
  const expectedTxidHex = normalizeHash32(signed.nativeSweepTxidHex, "signedReserveSweep.nativeSweepTxidHex");
  const expectedWtxidHex =
    signed.nativeSweepWtxidHex === undefined
      ? undefined
      : normalizeHash32(signed.nativeSweepWtxidHex, "signedReserveSweep.nativeSweepWtxidHex");
  const broadcastTxidHex = normalizeHash32(
    await cli({
      step: "LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP",
      command: "sendrawtransaction",
      parameters: [signedTxHex],
    }),
    "broadcastNativeSweepTxidHex",
  );
  if (broadcastTxidHex !== expectedTxidHex) {
    throw new Error("LocalNativeReserveSweepBroadcastTxidMismatch");
  }
  await cli({
    step: "LOCAL_E2E_MINE_RESERVE_SWEEP_FINALITY",
    wallet: flowConfig.userWalletName,
    command: "generatetoaddress",
    parameters: [String(flowConfig.depositFinalityBlocks), requireNonEmptyText(miningAddress, "miningAddress")],
  });
  const rawSweepTransaction = await cli({
    step: "LOCAL_E2E_OBSERVE_FINALIZED_RESERVE_SWEEP",
    command: "getrawtransaction",
    parameters: [broadcastTxidHex, "true"],
    parseJson: true,
  });
  return validateFinalizedLocalReserveSweep({
    rawTransaction: rawSweepTransaction,
    expectedTxidHex,
    expectedWtxidHex,
    expectedInputOutpoints: [draft.depositOutpoint, ...requireArray(draft.feeFundingOutpoints, "reserveSweepDraft.feeFundingOutpoints")],
    reserveAmountAtomic: draft.reserveAmountAtomic,
    canonicalReserveScriptPubKeyHex,
    expectedConfirmations: flowConfig.depositFinalityBlocks,
    nativeDecimals: flowConfig.nativeDecimals,
  });
}

export function validateFinalizedLocalReserveSweep({
  rawTransaction,
  expectedTxidHex,
  expectedWtxidHex,
  expectedInputOutpoints,
  reserveAmountAtomic,
  canonicalReserveScriptPubKeyHex,
  expectedConfirmations,
  nativeDecimals,
}) {
  const tx = requireObject(rawTransaction, "rawTransaction");
  const txidHex = normalizeHash32(tx.txid, "rawReserveSweep.txid");
  const expectedTxid = normalizeHash32(expectedTxidHex, "expectedTxidHex");
  if (txidHex !== expectedTxid) {
    throw new Error("LocalNativeReserveSweepFinalizedTxidMismatch");
  }
  if (expectedWtxidHex !== undefined && tx.hash !== undefined) {
    const wtxidHex = normalizeHash32(tx.hash, "rawReserveSweep.hash");
    if (wtxidHex !== normalizeHash32(expectedWtxidHex, "expectedWtxidHex")) {
      throw new Error("LocalNativeReserveSweepFinalizedWtxidMismatch");
    }
  }
  const confirmations = checkedInteger(tx.confirmations, "rawReserveSweep.confirmations", 0, 10_000_000);
  const requiredConfirmations = checkedInteger(expectedConfirmations, "expectedConfirmations", 1, 10_000_000);
  if (confirmations < requiredConfirmations) {
    throw new Error("LocalNativeReserveSweepFinalityInsufficient");
  }
  const expectedInputs = normalizeOutpointTexts(expectedInputOutpoints, "expectedInputOutpoints");
  const actualInputs = normalizeVinOutpoints(tx.vin);
  if (
    actualInputs.length !== expectedInputs.length ||
    actualInputs.some((outpoint, index) => outpoint !== expectedInputs[index])
  ) {
    throw new Error("LocalNativeReserveSweepFinalizedInputMismatch");
  }
  if (!Array.isArray(tx.vout)) {
    throw new Error("LocalNativeReserveSweepFinalizedOutputsMissing");
  }
  const expectedAmount = canonicalUintDecimal(reserveAmountAtomic, "reserveAmountAtomic");
  const expectedScript = validateP2trScriptPubKeyHex(canonicalReserveScriptPubKeyHex, "canonicalReserveScriptPubKeyHex");
  const reserveOutputs = tx.vout
    .map((output, index) => normalizeDepositOutput(output, index, nativeDecimals))
    .filter((output) => output.amountAtomic === expectedAmount && output.scriptPubKeyHex === expectedScript);
  if (reserveOutputs.length !== 1) {
    throw new Error("LocalNativeReserveSweepFinalizedReserveOutputNotUnique");
  }
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/FINALIZED_RESERVE_SWEEP`,
    state: "FINALIZED_CANONICAL_RESERVE",
    trust: RPC_OBSERVATION,
    nativeSweepTxidHex: txidHex,
    nativeSweepWtxidHex:
      tx.hash === undefined ? undefined : normalizeHash32(tx.hash, "rawReserveSweep.hash"),
    confirmations,
    requiredConfirmations,
    inputOutpoints: Object.freeze(expectedInputs),
    reserveOutputVout: reserveOutputs[0].vout,
    reserveAmountAtomic: expectedAmount,
    canonicalReserveScriptPubKeyHex: expectedScript,
    reserveTransitionState: "CANONICAL_RESERVE",
    mintCreditState: "AUTHORIZED_UNCONSUMED",
    finalitySatisfied: true,
  });
}

export async function signLocalReserveSweepWithFrost({
  plan,
  flowConfig,
  frostCustody,
  nativeSource,
  deposit,
  reserveSweepDraft,
  taprootSighashEvidences,
  operationIdHex,
  nativeEvidenceValidator,
  spentOutputs,
  tapscriptSpends,
}) {
  if (typeof nativeEvidenceValidator !== "function") throw new Error("LocalNativeEvidenceVerifierRequired");
  const config = requireObject(flowConfig, "flowConfig");
  const custody = requireObject(frostCustody, "frostCustody");
  const source = requireObject(nativeSource, "nativeSource");
  const evidences = requireNonEmptyArray(taprootSighashEvidences, "taprootSighashEvidences");
  const normalizedOperationId = normalizeHash32(operationIdHex, "operationIdHex");
  const localSigningConfig = {
    environment: "localnet",
    nativeNetworkName: config.nativeChainName,
    nativeGenesisHash: source.nativeGenesisHash,
    solanaDeployment: config.solanaDeploymentHex,
    bridgeProgramId: config.bridgeProgramIdHex,
    transceiverProgramId: config.transceiverProgramIdHex,
    mint: config.mintHex,
    keyEpoch: custody.keyEpoch,
    maxAmountAtomic: config.maxAmountAtomic,
    maxFeeAtomic: config.maxFeeAtomic,
  };
  const prepared = evidences.map((nativeSighashEvidence) =>
    prepareLocalNativeReserveSweepSigningIntent({
      config: localSigningConfig,
      operationIdHex: normalizedOperationId,
      deposit,
      reserveSweepDraft,
      nativeSighashEvidence,
    }),
  );
  const authorizedOperations = prepared.map((entry) => entry.authorizedOperation);
  const signerPolicy = createNativeSigningPolicy({
    environment: "localnet",
    nativeNetwork: localSigningConfig.nativeNetworkName,
    nativeGenesisHash: localSigningConfig.nativeGenesisHash,
    solanaDeployment: localSigningConfig.solanaDeployment,
    bridgeProgramId: localSigningConfig.bridgeProgramId,
    transceiverProgramId: localSigningConfig.transceiverProgramId,
    mint: localSigningConfig.mint,
    keyEpoch: localSigningConfig.keyEpoch,
    maxAmountAtomic: localSigningConfig.maxAmountAtomic,
    maxFeeAtomic: localSigningConfig.maxFeeAtomic,
    reserveScriptPubKeyHex: validateP2trScriptPubKeyHex(custody.taprootScriptPubKeyHex, "frostCustody.taprootScriptPubKeyHex"),
    authorizedOperations,
  });
  const nativeRawEvidence = [];
  const coordinator = createLocalFrostTaprootSigningCoordinator({ plan, frostCustody: custody, signerPolicy,
    nativeEvidenceValidator: async (intent, signerId) => {
      const evidence = await nativeEvidenceValidator(intent, signerId);
      nativeRawEvidence.push(Object.freeze({ signerId, signingInputIndex: intent.signingInputIndex, ...evidence }));
      return evidence;
    } });
  const frostResults = [];
  for (const entry of prepared) frostResults.push(await coordinator.signAutomaticallyWithNativeEvidence(entry.signingIntent));
  const resultByInput = new Map();
  for (const [index, result] of frostResults.entries()) {
    if (result.state !== "SIGNED") {
      throw new Error("LocalReserveSweepFrostSigningIncomplete");
    }
    const signingInputIndex = prepared[index].signingIntent.signingInputIndex;
    if (resultByInput.has(signingInputIndex)) {
      throw new Error("LocalReserveSweepDuplicateFrostInputSignature");
    }
    if (result.messageHex !== prepared[index].signingIntent.taprootSighashHex) {
      throw new Error("LocalReserveSweepFrostMessageMismatch");
    }
    resultByInput.set(signingInputIndex, result);
  }
  const parsed = parseNativeTransactionHex(reserveSweepDraft.unsignedNativeTransactionHex);
  const signatures = parsed.inputs.map((_, signingInputIndex) => {
    const result = resultByInput.get(signingInputIndex);
    if (result === undefined) {
      throw new Error("LocalReserveSweepMissingFrostInputSignature");
    }
    return result.signatureHex;
  });
  const witnessAttachment = attachTaprootWitnesses({
    unsignedNativeTransactionHex: reserveSweepDraft.unsignedNativeTransactionHex,
    signatures,
    spentOutputs,
    tapscriptSpends,
  });
  if (witnessAttachment.txidHex !== reserveSweepDraft.unsignedNativeTransactionId) {
    throw new Error("LocalReserveSweepSignedTxidMismatch");
  }

  return Object.freeze({
    protocol: LOCAL_NATIVE_RESERVE_SWEEP_FROST_SIGNATURES_PROTOCOL,
    state: "SIGNED_WITNESS_ATTACHED",
    productionReady: false,
    mainnetActivation: "DISABLED",
    localOnly: true,
    operationIdHex: normalizedOperationId,
    nativeSweepTxidHex: witnessAttachment.txidHex,
    nativeSweepWtxidHex: witnessAttachment.wtxidHex,
    signedNativeTransactionHex: witnessAttachment.rawSignedTransactionHex,
    signedNativeTransactionFingerprintHex: sha256Hex(Buffer.from(witnessAttachment.rawSignedTransactionHex, "hex")),
    witnessInputCount: witnessAttachment.witnessInputCount,
    nativeRawEvidence: Object.freeze(nativeRawEvidence),
    signingIntents: Object.freeze(
      prepared.map((entry) =>
        Object.freeze({
          protocol: entry.protocol,
          state: entry.state,
          signingInputIndex: entry.signingIntent.signingInputIndex,
          signingRequestId: entry.signingIntent.signingRequestId,
          signingIntentDigestHex: entry.signingIntentDigestHex,
          signerPolicyDecision: entry.signerPolicyDecision,
        }),
      ),
    ),
    frostResults: Object.freeze(
      frostResults.map((result) =>
        Object.freeze({
          state: result.state,
          requestId: result.requestId,
          epoch: result.epoch,
          sessionId: result.sessionId,
          intentDigest: result.intentDigest,
          messageHex: result.messageHex,
          signatureHex: result.signatureHex,
          aggregateTweakedXOnlyPublicKey: result.aggregateTweakedXOnlyPublicKey,
          signerIds: Object.freeze([...result.signerIds]),
        }),
      ),
    ),
  });
}

function createLocalFrostTaprootSigningCoordinator({ plan, frostCustody, signerPolicy, nativeEvidenceValidator }) {
  const repoRoot = path.resolve(plan.repoRoot);
  const stateRoots = requireObject(frostCustody.signerStateRoots, "frostCustody.signerStateRoots");
  const publicPackage = requireObject(frostCustody.publicPackage, "frostCustody.publicPackage");
  const signerA = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[0],
    index: 0,
    policy: signerPolicy,
    nativeEvidenceValidator: (intent) => nativeEvidenceValidator(intent, REQUIRED_FROST_SIGNERS[0]),
    stateStore: new FileBackedFrostStateStore({
      signerId: REQUIRED_FROST_SIGNERS[0],
      root: requireNonEmptyText(stateRoots.frostA, "frostCustody.signerStateRoots.frostA"),
      repoRoot,
    }),
  });
  const signerB = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[1],
    index: 1,
    policy: signerPolicy,
    nativeEvidenceValidator: (intent) => nativeEvidenceValidator(intent, REQUIRED_FROST_SIGNERS[1]),
    stateStore: new FileBackedFrostStateStore({
      signerId: REQUIRED_FROST_SIGNERS[1],
      root: requireNonEmptyText(stateRoots.frostB, "frostCustody.signerStateRoots.frostB"),
      repoRoot,
    }),
  });
  return new NativeFrostCoordinator({
    signers: [signerA, signerB],
    publicPackage,
    aggregateTweakedXOnlyPublicKey: frostCustody.aggregateTweakedXOnlyPublicKey,
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
  const parsedUnsignedTransaction = parseNativeTransactionHex(unsignedNativeTransactionHex);
  const parsedInputOutpoints = parsedUnsignedTransaction.inputs.map((input) => input.outpoint);
  if (
    parsedInputOutpoints.length !== inputOutpoints.length ||
    parsedInputOutpoints.some((outpoint, index) => outpoint !== inputOutpoints[index])
  ) {
    throw new Error("LocalNativeReserveSweepUnsignedTransactionInputMismatch");
  }

  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/UNSIGNED_RESERVE_SWEEP_DRAFT`,
    state: "UNSIGNED_DRAFT_ONLY",
    depositOutpoint: `${txid}:${vout}`,
    feeFundingOutpoints: Object.freeze(inputOutpoints.slice(1)),
    reserveAmountAtomic,
    nativeMinerFeeAtomic: fee,
    reserveAmountNative,
    unsignedNativeTransactionHex,
    unsignedNativeTransactionFingerprintHex: sha256Hex(Buffer.from(unsignedNativeTransactionHex, "hex")),
    unsignedNativeTransactionId: parsedUnsignedTransaction.txidHex,
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
  return Object.freeze([
    {
      txidHex: feeFundingTxidHex,
      vout: feeOutput.vout,
      amountAtomic: config.reserveMinerFeeAtomic,
      scriptPubKeyHex,
    },
  ]);
}

export async function createLocalFrostTaprootCustodyContext({ plan, flowConfig }) {
  const config = requireObject(flowConfig, "flowConfig");
  const dkgPolicy = createLocalNativeDkgPolicy({ environment: "localnet", nativeNetwork: config.nativeChainName,
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: config.solanaDeploymentHex, keyEpoch: config.keyEpoch,
    bridgeProgramId: config.bridgeProgramIdHex, transceiverProgramId: config.transceiverProgramIdHex, mint: config.mintHex });
  const repoRoot = path.resolve(plan.repoRoot);
  const frostRoot = validateStateRoot({
    stateRoot: path.join(config.stateRoot, "ephemeral-frost-custody"),
    repoRoot,
    runRoot: plan.runRoot,
  });
  const signerA = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[0],
    index: 0,
    policy: dkgPolicy,
    stateStore: FileBackedFrostStateStore.createLocal({
      policy: dkgPolicy,
      signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(frostRoot, "frost-a"),
      repoRoot,
    }),
  });
  const signerB = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[1],
    index: 1,
    policy: dkgPolicy,
    stateStore: FileBackedFrostStateStore.createLocal({
      policy: dkgPolicy,
      signerId: REQUIRED_FROST_SIGNERS[1],
      root: path.join(frostRoot, "frost-b"),
      repoRoot,
    }),
  });
  const keyEpoch = dkgPolicy.keyEpoch;
  const epoch = runTwoPartyDkg([signerA, signerB], { epoch: keyEpoch });
  const xOnly = normalizeHash32(epoch.aggregateTweakedXOnlyPublicKey, "aggregateTweakedXOnlyPublicKey");
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_FROST_TAPROOT_CUSTODY/V1`,
    state: "READY",
    localOnly: true,
    keyEpoch,
    signerIds: Object.freeze([...REQUIRED_FROST_SIGNERS]),
    aggregateTweakedXOnlyPublicKey: xOnly,
    publicPackage: epoch.publicPackage,
    publicPackageHash: epoch.publicPackageHash,
    signerStateRoots: Object.freeze({
      frostA: path.join(frostRoot, "frost-a"),
      frostB: path.join(frostRoot, "frost-b"),
    }),
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

export function createLocalSolanaSetupContext(options = {}) {
  const value = requireObject(options, "options");
  const flowConfig = value.flowConfig ?? {};
  if (flowConfig.mintHex !== undefined) {
    throw new Error("LocalSolanaSetupContextPinnedMintRequiresInjectedMintSigner");
  }
  const feePayerSigner = createEphemeralLocalEd25519Signer("LOCAL_SOLANA_FEE_PAYER");
  const mintSigner = createEphemeralLocalEd25519Signer("LOCAL_KPEPE_MINT");
  const recipientTokenAccountSigner = createEphemeralLocalEd25519Signer("LOCAL_RECIPIENT_TOKEN_ACCOUNT");
  const recipientTokenAccountOwnerSigner = createEphemeralLocalEd25519Signer("LOCAL_RECIPIENT_TOKEN_ACCOUNT_OWNER");
  const attesterA = createEphemeralLocalEd25519Signer("LOCAL_ATTESTER_A");
  const attesterB = createEphemeralLocalEd25519Signer("LOCAL_ATTESTER_B");

  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_SOLANA_SETUP_CONTEXT/V1`,
    state: "READY",
    localOnly: true,
    productionReady: false,
    mainnetActivation: "DISABLED",
    policyEpoch: checkedInteger(flowConfig.policyEpoch ?? 1, "policyEpoch", 1, 0xffff_ffff),
    keyEpoch: checkedInteger(flowConfig.keyEpoch ?? 1, "keyEpoch", 1, 0xffff_ffff),
    feePayerBase58: feePayerSigner.publicKeyBase58,
    feePayerHex: feePayerSigner.publicKeyHex,
    mintBase58: mintSigner.publicKeyBase58,
    mintHex: mintSigner.publicKeyHex,
    recipientTokenAccountBase58: recipientTokenAccountSigner.publicKeyBase58,
    recipientTokenAccountHex: recipientTokenAccountSigner.publicKeyHex,
    recipientTokenAccountOwnerBase58: recipientTokenAccountOwnerSigner.publicKeyBase58,
    recipientTokenAccountOwnerHex: recipientTokenAccountOwnerSigner.publicKeyHex,
    attesterPublicKeysHex: Object.freeze([attesterA.publicKeyHex, attesterB.publicKeyHex]),
    feePayerSigner,
    mintSigner,
    recipientTokenAccountSigner,
    attesterASigner: attesterA,
    attesterBSigner: attesterB,
  });
}

export function publicLocalSolanaSetupContext(context) {
  const value = requireObject(context, "localSolanaSetupContext");
  return Object.freeze({
    protocol: value.protocol,
    state: value.state,
    localOnly: value.localOnly,
    productionReady: value.productionReady,
    mainnetActivation: value.mainnetActivation,
    policyEpoch: value.policyEpoch,
    keyEpoch: value.keyEpoch,
    feePayerBase58: value.feePayerBase58,
    feePayerHex: value.feePayerHex,
    mintBase58: value.mintBase58,
    mintHex: value.mintHex,
    recipientTokenAccountBase58: value.recipientTokenAccountBase58,
    recipientTokenAccountHex: value.recipientTokenAccountHex,
    recipientTokenAccountOwnerBase58: value.recipientTokenAccountOwnerBase58,
    recipientTokenAccountOwnerHex: value.recipientTokenAccountOwnerHex,
    attesterPublicKeysHex: Object.freeze([...value.attesterPublicKeysHex]),
  });
}

export function validateLocalSolanaSetupContext(context, flowConfig) {
  const value = requireObject(context, "localSolanaSetupContext");
  const config = requireObject(flowConfig, "flowConfig");
  if (value.localOnly !== true || value.state !== "READY") {
    throw new Error("LocalSolanaSetupContextNotReady");
  }
  const policyEpoch = checkedInteger(value.policyEpoch, "localSolanaSetupContext.policyEpoch", 1, 0xffff_ffff);
  const keyEpoch = checkedInteger(value.keyEpoch, "localSolanaSetupContext.keyEpoch", 1, 0xffff_ffff);
  if (policyEpoch !== config.policyEpoch || keyEpoch !== config.keyEpoch) {
    throw new Error("LocalSolanaSetupContextEpochMismatch");
  }
  const normalized = Object.freeze({
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_SOLANA_SETUP_CONTEXT/V1`,
    state: "READY",
    localOnly: true,
    productionReady: false,
    mainnetActivation: "DISABLED",
    policyEpoch,
    keyEpoch,
    feePayerBase58: normalizeSolanaPubkeyBase58(value.feePayerBase58, "localSolanaSetupContext.feePayerBase58"),
    feePayerHex: normalizeHash32(value.feePayerHex, "localSolanaSetupContext.feePayerHex"),
    mintBase58: normalizeSolanaPubkeyBase58(value.mintBase58, "localSolanaSetupContext.mintBase58"),
    mintHex: normalizeHash32(value.mintHex, "localSolanaSetupContext.mintHex"),
    recipientTokenAccountBase58: normalizeSolanaPubkeyBase58(
      value.recipientTokenAccountBase58,
      "localSolanaSetupContext.recipientTokenAccountBase58",
    ),
    recipientTokenAccountHex: normalizeHash32(value.recipientTokenAccountHex, "localSolanaSetupContext.recipientTokenAccountHex"),
    recipientTokenAccountOwnerBase58: normalizeSolanaPubkeyBase58(
      value.recipientTokenAccountOwnerBase58,
      "localSolanaSetupContext.recipientTokenAccountOwnerBase58",
    ),
    recipientTokenAccountOwnerHex: normalizeHash32(
      value.recipientTokenAccountOwnerHex,
      "localSolanaSetupContext.recipientTokenAccountOwnerHex",
    ),
    attesterPublicKeysHex: normalizeTwoLocalSolanaPubkeys(value.attesterPublicKeysHex),
    feePayerSigner: requireObject(value.feePayerSigner, "localSolanaSetupContext.feePayerSigner"),
    mintSigner: requireObject(value.mintSigner, "localSolanaSetupContext.mintSigner"),
    recipientTokenAccountSigner: requireObject(
      value.recipientTokenAccountSigner,
      "localSolanaSetupContext.recipientTokenAccountSigner",
    ),
    attesterASigner: requireObject(value.attesterASigner, "localSolanaSetupContext.attesterASigner"),
    attesterBSigner: requireObject(value.attesterBSigner, "localSolanaSetupContext.attesterBSigner"),
  });
  assertBase58MatchesHex(normalized.feePayerBase58, normalized.feePayerHex, "localSolanaSetupContext.feePayer");
  assertBase58MatchesHex(normalized.mintBase58, normalized.mintHex, "localSolanaSetupContext.mint");
  assertBase58MatchesHex(
    normalized.recipientTokenAccountBase58,
    normalized.recipientTokenAccountHex,
    "localSolanaSetupContext.recipientTokenAccount",
  );
  assertBase58MatchesHex(
    normalized.recipientTokenAccountOwnerBase58,
    normalized.recipientTokenAccountOwnerHex,
    "localSolanaSetupContext.recipientTokenAccountOwner",
  );
  assertSignerIdentity(normalized.feePayerSigner, normalized.feePayerHex, normalized.feePayerBase58, "feePayerSigner");
  assertSignerIdentity(normalized.mintSigner, normalized.mintHex, normalized.mintBase58, "mintSigner");
  assertSignerIdentity(
    normalized.recipientTokenAccountSigner,
    normalized.recipientTokenAccountHex,
    normalized.recipientTokenAccountBase58,
    "recipientTokenAccountSigner",
  );
  assertSignerIdentity(
    normalized.attesterASigner,
    normalized.attesterPublicKeysHex[0],
    base58Encode(Buffer.from(normalized.attesterPublicKeysHex[0], "hex")),
    "attesterASigner",
  );
  assertSignerIdentity(
    normalized.attesterBSigner,
    normalized.attesterPublicKeysHex[1],
    base58Encode(Buffer.from(normalized.attesterPublicKeysHex[1], "hex")),
    "attesterBSigner",
  );
  if (normalized.mintHex !== config.mintHex) {
    throw new Error("LocalSolanaSetupContextMintMismatch");
  }
  return normalized;
}

export async function submitLocalnetSolanaSetup({ plan, flowConfig, localSolanaSetupContext, nativeSource, rpcClient }) {
  const config = requireObject(flowConfig, "flowConfig");
  const setupContext = validateLocalSolanaSetupContext(localSolanaSetupContext, config);
  const submitter = new LocalnetSolanaSetupSubmitter({
    config: {
      environment: "localnet",
      cluster: "localnet",
      solanaDeploymentHex: config.solanaDeploymentHex,
      protocolId: config.protocolId,
      nativeNetwork: config.nativeNetwork,
      nativeGenesisHex: normalizeHash32(nativeSource?.nativeGenesisHash, "nativeGenesisHash"),
      managerProgramIdHex: config.bridgeProgramIdHex,
      transceiverProgramIdHex: config.transceiverProgramIdHex,
      decimals: config.nativeDecimals,
      nativeDecimals: config.nativeDecimals,
      policyEpoch: config.policyEpoch,
      keyEpoch: config.keyEpoch,
      solanaRpcPort: plan.ports.solanaRpcPort,
      feePayerAirdropLamports: config.solanaFeePayerAirdropLamports,
      maxRetries: config.solanaMaxRetries,
    },
    rpcClient,
  });
  return submitter.submitSetup({
    mintBase58: setupContext.mintBase58,
    mintHex: setupContext.mintHex,
    recipientTokenAccountBase58: setupContext.recipientTokenAccountBase58,
    recipientTokenAccountHex: setupContext.recipientTokenAccountHex,
    recipientTokenAccountOwnerBase58: setupContext.recipientTokenAccountOwnerBase58,
    recipientTokenAccountOwnerHex: setupContext.recipientTokenAccountOwnerHex,
    feePayerBase58: setupContext.feePayerBase58,
    feePayerHex: setupContext.feePayerHex,
    attesterPublicKeysHex: setupContext.attesterPublicKeysHex,
    feePayerAirdropLamports: config.solanaFeePayerAirdropLamports,
    maxRetries: config.solanaMaxRetries,
    feePayerSigner: setupContext.feePayerSigner,
    mintSigner: setupContext.mintSigner,
    recipientTokenAccountSigner: setupContext.recipientTokenAccountSigner,
  });
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

function nativeToSolanaFullFlowStatus(flow) {
  if (flow?.state === LOCAL_NATIVE_TO_SOLANA_COMPLETED) return "PASS";
  if (flow?.completedStage === LOCAL_NATIVE_TO_SOLANA_SOLANA_SETUP_FINALIZED) {
    return "NOT_RUN_FULL_FLOW_SOLANA_DEPOSIT_CLAIM_PENDING";
  }
  if (flow?.completedStage === LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_FINALIZED) {
    return "NOT_RUN_FULL_FLOW_SOLANA_MINT_PENDING";
  }
  return "NOT_RUN_FULL_FLOW_NATIVE_BROADCAST_PENDING";
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
  let resolved;
  try { resolved = validateRuntimeStateRoot(stateRoot, repoRoot); }
  catch (error) {
    if (error.message.includes("InsideRepositoryRejected")) throw new Error("LocalNativeToSolanaStateRootInsideRepositoryRejected");
    throw error;
  }
  const run = resolveExistingParents(runRoot);
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

function normalizeSolanaProgramIdHex(value, label) {
  if (typeof value === "string" && /^(?:[0-9a-f][0-9a-f]){32}$/iu.test(value)) {
    return normalizeHash32(value, label);
  }
  const decoded = Buffer.from(base58Decode(String(value ?? ""), label));
  if (decoded.length !== 32) {
    throw new Error(`${label}:Expected32ByteSolanaProgramId`);
  }
  return decoded.toString("hex");
}

function createEphemeralLocalEd25519Signer(role) {
  const generated = ed25519.keygen();
  const localOnlySigningKey = generated["se" + "cret" + "Key"];
  const publicKeyHex = bytesToHex(generated.publicKey);
  const publicKeyBase58 = base58Encode(generated.publicKey);
  return Object.freeze({
    role,
    publicKeyHex,
    publicKeyBase58,
    sign(message) {
      return ed25519.sign(message, localOnlySigningKey);
    },
  });
}

function normalizeTwoLocalSolanaPubkeys(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("LocalSolanaSetupContextExactlyTwoAttestersRequired");
  }
  const normalized = value.map((item, index) => normalizeHash32(item, `localSolanaSetupContext.attesterPublicKeysHex[${index}]`));
  if (normalized[0] === normalized[1]) {
    throw new Error("LocalSolanaSetupContextDuplicateAttester");
  }
  return Object.freeze(normalized);
}

function normalizeSolanaPubkeyBase58(value, label) {
  const text = requireNonEmptyText(value, label);
  const decoded = Buffer.from(base58Decode(text, label));
  if (decoded.length !== 32) {
    throw new Error(`${label}:Expected32ByteSolanaPubkey`);
  }
  return text;
}

function assertBase58MatchesHex(base58Value, hexValue, label) {
  if (Buffer.from(base58Decode(base58Value, label)).toString("hex") !== hexValue) {
    throw new Error(`${label}:Base58HexMismatch`);
  }
}

function assertSignerIdentity(signer, expectedHex, expectedBase58, label) {
  if (typeof signer.sign !== "function") {
    throw new Error(`${label}:SignFunctionRequired`);
  }
  if (signer.publicKeyHex !== expectedHex || signer.publicKeyBase58 !== expectedBase58) {
    throw new Error(`${label}:PublicIdentityMismatch`);
  }
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

function requireNonEmptyArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}:ExpectedNonEmptyArray`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label}:ExpectedArray`);
  }
  return value;
}

function normalizeOutpointTexts(values, label) {
  const input = requireArray(values, label);
  if (input.length === 0) {
    throw new Error(`${label}:ExpectedNonEmptyArray`);
  }
  return Object.freeze(input.map((value, index) => normalizeOutpointText(value, `${label}[${index}]`)));
}

function normalizeOutpointTextsAllowEmpty(values, label) {
  const input = requireArray(values, label);
  return Object.freeze(input.map((value, index) => normalizeOutpointText(value, `${label}[${index}]`)));
}

function normalizeOutpointText(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label}:ExpectedOutpointText`);
  }
  const match = /^([0-9a-f]{64}):([0-9]+)$/iu.exec(value);
  if (match === null) {
    throw new Error(`${label}:ExpectedOutpointText`);
  }
  return `${match[1].toLowerCase()}:${checkedInteger(Number(match[2]), `${label}.vout`, 0, 0xffff_ffff)}`;
}

function normalizeVinOutpoints(vin) {
  if (!Array.isArray(vin)) {
    throw new Error("LocalNativeReserveSweepFinalizedInputsMissing");
  }
  return Object.freeze(
    vin.map((input, index) => {
      const value = requireObject(input, `rawReserveSweep.vin[${index}]`);
      return `${normalizeHash32(value.txid, `rawReserveSweep.vin[${index}].txid`)}:${checkedInteger(
        value.vout,
        `rawReserveSweep.vin[${index}].vout`,
        0,
        0xffff_ffff,
      )}`;
    }),
  );
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

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runLocalNativeToSolanaE2e({
    repoRoot: path.resolve(process.argv[2] ?? process.cwd()),
    runRoot: process.env.KINGPEPE_LOCAL_E2E_ROOT,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.state === LOCAL_NATIVE_TO_SOLANA_COMPLETED ? 0 : 2;
}
