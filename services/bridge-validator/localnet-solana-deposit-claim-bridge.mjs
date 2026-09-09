import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import { DEPOSIT_STATES } from "./automatic-deposit-pipeline.mjs";
import { SolanaDepositClaimSubmitter } from "./solana-deposit-claim-submitter.mjs";
import {
  prepareSignedLocalnetSolanaDepositClaimBundleTransaction,
  prepareSignedLocalnetSolanaDepositClaimTransaction,
} from "./solana-deposit-claim-transaction-plan.mjs";

export const LOCALNET_SOLANA_DEPOSIT_CLAIM_BRIDGE_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCALNET_SOLANA_DEPOSIT_CLAIM_BRIDGE/V1";

const LOCALNET = "localnet";
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const BASE58_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/u;

export class LocalnetSolanaDepositClaimBridge {
  #config;
  #feePayerSigner;
  #blockhashSource;
  #submitter;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#config = normalizeLocalnetBridgeConfig(value.config);
    this.#feePayerSigner = requireObject(value.feePayerSigner, "feePayerSigner");
    this.#blockhashSource = value.blockhashSource ?? value.rpcClient;
    this.#submitter =
      value.submitter ??
      new SolanaDepositClaimSubmitter({
        config: submitterConfig(this.#config),
        rpcClient: requireObject(value.rpcClient, "rpcClient"),
        claimObserver: value.claimObserver,
        journal: value.journal,
      });
  }

  async submitDepositClaim(request) {
    const normalized = normalizeDepositClaimBridgeRequest(this.#config, request);
    let latestBlockhash;
    try {
      latestBlockhash = await resolveLatestBlockhash(this.#blockhashSource, normalized);
    } catch {
      return bridgeDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_LATEST_BLOCKHASH_UNAVAILABLE", normalized);
    }

    const signedPlan = await prepareSignedLocalnetSolanaDepositClaimBundleTransaction({
      environment: this.#config.environment,
      cluster: this.#config.cluster,
      managerProgramIdHex: this.#config.managerProgramIdHex,
      transceiverProgramIdHex: this.#config.transceiverProgramIdHex,
      mintHex: this.#config.mintHex,
      tokenProgramIdHex: this.#config.tokenProgramIdHex,
      feePayerBase58: this.#config.feePayerBase58,
      feePayerHex: this.#config.feePayerHex,
      recipientTokenAccountHex: normalized.solanaRecipientHex,
      recentBlockhashBase58: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      encodedMessageHex: normalized.encodedMessageHex,
      attestations: normalized.attestations,
      feePayerSigner: this.#feePayerSigner,
    });
    assertPlanMatchesRequest(signedPlan, normalized);

    return this.#submitter.submitDepositClaim({
      ...request,
      operationIdHex: normalized.operationIdHex,
      encodedMessageHex: normalized.encodedMessageHex,
      messageDigestHex: normalized.messageDigestHex,
      amountAtomic: normalized.amountAtomic,
      solanaRecipientHex: normalized.solanaRecipientHex,
      preparedTransactionBase64: signedPlan.preparedTransactionBase64,
      recentBlockhash: signedPlan.recentBlockhashBase58,
      lastValidBlockHeight: signedPlan.lastValidBlockHeight,
      depositClaimAccountBase58: signedPlan.pdas.depositClaim.addressBase58,
      mintAccountBase58: signedPlan.mintBase58,
      maxRetries: normalized.maxRetries,
      transactionPlan: publicTransactionPlan(signedPlan),
    });
  }
}

export async function prepareLocalnetSolanaDepositClaimRequest(config, request, options = {}) {
  const bridgeConfig = normalizeLocalnetBridgeConfig(config);
  const normalized = normalizeDepositClaimBridgeRequest(bridgeConfig, request);
  const latestBlockhash = await resolveLatestBlockhash(options.blockhashSource, normalized);
  const planConfig = {
    environment: bridgeConfig.environment,
    cluster: bridgeConfig.cluster,
    managerProgramIdHex: bridgeConfig.managerProgramIdHex,
    transceiverProgramIdHex: bridgeConfig.transceiverProgramIdHex,
    mintHex: bridgeConfig.mintHex,
    tokenProgramIdHex: bridgeConfig.tokenProgramIdHex,
    feePayerBase58: bridgeConfig.feePayerBase58,
    feePayerHex: bridgeConfig.feePayerHex,
    recipientTokenAccountHex: normalized.solanaRecipientHex,
    recentBlockhashBase58: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    encodedMessageHex: normalized.encodedMessageHex,
    feePayerSigner: requireObject(options.feePayerSigner, "feePayerSigner"),
  };
  const signedPlan = Array.isArray(normalized.attestations)
    ? await prepareSignedLocalnetSolanaDepositClaimBundleTransaction({
      ...planConfig,
      attestations: normalized.attestations,
    })
    : await prepareSignedLocalnetSolanaDepositClaimTransaction(planConfig);
  assertPlanMatchesRequest(signedPlan, normalized);
  return Object.freeze({
    ...request,
    operationIdHex: normalized.operationIdHex,
    encodedMessageHex: normalized.encodedMessageHex,
    messageDigestHex: normalized.messageDigestHex,
    amountAtomic: normalized.amountAtomic,
    solanaRecipientHex: normalized.solanaRecipientHex,
    preparedTransactionBase64: signedPlan.preparedTransactionBase64,
    recentBlockhash: signedPlan.recentBlockhashBase58,
    lastValidBlockHeight: signedPlan.lastValidBlockHeight,
    depositClaimAccountBase58: signedPlan.pdas.depositClaim.addressBase58,
    mintAccountBase58: signedPlan.mintBase58,
    maxRetries: normalized.maxRetries,
    transactionPlan: publicTransactionPlan(signedPlan),
  });
}

function normalizeLocalnetBridgeConfig(config) {
  const value = requireObject(config, "config");
  const environment = value.environment ?? LOCALNET;
  const cluster = value.cluster ?? LOCALNET;
  if (environment !== LOCALNET || cluster !== LOCALNET) {
    throw new Error("LocalnetSolanaDepositClaimBridgeLocalnetOnly");
  }
  return Object.freeze({
    environment,
    cluster,
    solanaDeploymentHex: normalizeHash32(value.solanaDeploymentHex, "solanaDeploymentHex"),
    managerProgramIdHex: normalizeHash32(value.managerProgramIdHex, "managerProgramIdHex"),
    transceiverProgramIdHex: normalizeHash32(value.transceiverProgramIdHex, "transceiverProgramIdHex"),
    mintHex: normalizeHash32(value.mintHex, "mintHex"),
    tokenProgramIdHex: normalizeHash32(value.tokenProgramIdHex, "tokenProgramIdHex"),
    feePayerBase58: value.feePayerBase58 === undefined ? undefined : normalizeBase58Like(value.feePayerBase58, "feePayerBase58"),
    feePayerHex: value.feePayerHex === undefined ? undefined : normalizeHash32(value.feePayerHex, "feePayerHex"),
    policyEpoch: checkedU32(value.policyEpoch, "policyEpoch"),
    keyEpoch: checkedU32(value.keyEpoch, "keyEpoch"),
    acceptedObservationTrust: value.acceptedObservationTrust ?? ["LOCAL_VALIDATION"],
    maxRetries: checkedSmallInteger(value.maxRetries ?? 0, "maxRetries"),
  });
}

function submitterConfig(config) {
  return Object.freeze({
    environment: config.environment,
    cluster: config.cluster,
    solanaDeploymentHex: config.solanaDeploymentHex,
    managerProgramIdHex: config.managerProgramIdHex,
    transceiverProgramIdHex: config.transceiverProgramIdHex,
    mintHex: config.mintHex,
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedObservationTrust: config.acceptedObservationTrust,
  });
}

function normalizeDepositClaimBridgeRequest(config, request) {
  const value = requireObject(request, "request");
  const encodedMessageHex = normalizeHex(value.encodedMessageHex, "encodedMessageHex");
  const message = decodeCanonicalBridgeMessage(hexToBytes(encodedMessageHex, "encodedMessageHex"));
  if (message.action !== "DepositClaim" || message.direction !== "NativeToSolana") {
    throw new Error("LocalnetSolanaDepositClaimBridgeWrongMessageKind");
  }
  checkMessageDomain(config, message);
  const operationIdHex = normalizeHash32(value.operationIdHex ?? message.operationIdHex, "operationIdHex");
  const messageDigestHex = normalizeHash32(value.messageDigestHex ?? message.messageDigestHex, "messageDigestHex");
  const amountAtomic = canonicalUintDecimal(value.amountAtomic ?? message.amountAtomic.toString(), "amountAtomic");
  const solanaRecipientHex = normalizeHash32(value.solanaRecipientHex ?? message.destinationHex, "solanaRecipientHex");
  if (
    operationIdHex !== message.operationIdHex ||
    messageDigestHex !== message.messageDigestHex ||
    BigInt(amountAtomic) !== message.amountAtomic ||
    solanaRecipientHex !== message.destinationHex
  ) {
    throw new Error("LocalnetSolanaDepositClaimBridgeRequestMessageMismatch");
  }
  return Object.freeze({
    ...value,
    operationIdHex,
    messageDigestHex,
    encodedMessageHex,
    amountAtomic,
    solanaRecipientHex,
    maxRetries: checkedSmallInteger(value.maxRetries ?? config.maxRetries, "maxRetries"),
    recentBlockhash:
      value.recentBlockhash === undefined ? undefined : normalizeBase58Like(value.recentBlockhash, "recentBlockhash"),
    lastValidBlockHeight:
      value.lastValidBlockHeight === undefined
        ? undefined
        : canonicalUintDecimalLike(value.lastValidBlockHeight, "lastValidBlockHeight"),
  });
}

function checkMessageDomain(config, message) {
  if (bytesToHex(message.deployment.solanaDeployment) !== config.solanaDeploymentHex) {
    throw new Error("LocalnetSolanaDepositClaimBridgeDeploymentMismatch");
  }
  if (bytesToHex(message.deployment.managerProgramId) !== config.managerProgramIdHex) {
    throw new Error("LocalnetSolanaDepositClaimBridgeManagerProgramMismatch");
  }
  if (bytesToHex(message.deployment.transceiverProgramId) !== config.transceiverProgramIdHex) {
    throw new Error("LocalnetSolanaDepositClaimBridgeTransceiverProgramMismatch");
  }
  if (bytesToHex(message.deployment.mint) !== config.mintHex) {
    throw new Error("LocalnetSolanaDepositClaimBridgeMintMismatch");
  }
  if (message.policyEpoch !== config.policyEpoch) {
    throw new Error("LocalnetSolanaDepositClaimBridgePolicyEpochMismatch");
  }
  if (message.keyEpoch !== config.keyEpoch) {
    throw new Error("LocalnetSolanaDepositClaimBridgeKeyEpochMismatch");
  }
}

async function resolveLatestBlockhash(blockhashSource, request) {
  if (request.recentBlockhash !== undefined && request.lastValidBlockHeight !== undefined) {
    return Object.freeze({
      blockhash: request.recentBlockhash,
      lastValidBlockHeight: request.lastValidBlockHeight,
    });
  }
  const source = requireObject(blockhashSource, "blockhashSource");
  if (typeof source.getLatestBlockhash !== "function") {
    throw new Error("SolanaLatestBlockhashProviderMissing");
  }
  const result = await source.getLatestBlockhash();
  const value = result?.value === undefined ? result : result.value;
  const normalized = requireObject(value, "latestBlockhash");
  return Object.freeze({
    blockhash: normalizeBase58Like(normalized.blockhashBase58 ?? normalized.blockhash, "latestBlockhash.blockhash"),
    lastValidBlockHeight: canonicalUintDecimalLike(normalized.lastValidBlockHeight, "latestBlockhash.lastValidBlockHeight"),
  });
}

function assertPlanMatchesRequest(plan, request) {
  if (
    plan.operationIdHex !== request.operationIdHex ||
    plan.messageDigestHex !== request.messageDigestHex ||
    plan.amountAtomic !== request.amountAtomic ||
    plan.solanaRecipientHex !== request.solanaRecipientHex ||
    typeof plan.preparedTransactionBase64 !== "string"
  ) {
    throw new Error("LocalnetSolanaDepositClaimTransactionPlanMismatch");
  }
}

function publicTransactionPlan(plan) {
  return Object.freeze({
    protocol: plan.protocol,
    operationIdHex: plan.operationIdHex,
    messageDigestHex: plan.messageDigestHex,
    recentBlockhashBase58: plan.recentBlockhashBase58,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    managerProgramIdBase58: plan.managerProgramIdBase58,
    transceiverProgramIdBase58: plan.transceiverProgramIdBase58,
    mintBase58: plan.mintBase58,
    feePayerBase58: plan.feePayerBase58,
    accounts: plan.accounts,
    pdas: plan.pdas,
    bundle: plan.bundle,
    instructions: plan.instructions,
    instruction: plan.instruction,
    messageFingerprintHex: plan.messageFingerprintHex,
    preparedTransactionFingerprintHex: plan.preparedTransactionFingerprintHex,
  });
}

function bridgeDecision(state, reason, normalized, extra = {}) {
  return Object.freeze({
    protocol: LOCALNET_SOLANA_DEPOSIT_CLAIM_BRIDGE_PROTOCOL,
    state,
    reason,
    operationIdHex: normalized.operationIdHex,
    messageDigestHex: normalized.messageDigestHex,
    amountAtomic: normalized.amountAtomic,
    solanaRecipientHex: normalized.solanaRecipientHex,
    ...extra,
  });
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function canonicalUintDecimalLike(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
    }
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
    }
    return String(value);
  }
  return canonicalUintDecimal(value, label);
}

function normalizeBase58Like(value, label) {
  if (typeof value !== "string" || !BASE58_LIKE.test(value)) {
    throw new Error(`${label}:InvalidBase58`);
  }
  return value;
}

function checkedU32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${label}:ExpectedU32`);
  }
  return value;
}

function checkedSmallInteger(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error(`${label}:ExpectedSmallInteger`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}
