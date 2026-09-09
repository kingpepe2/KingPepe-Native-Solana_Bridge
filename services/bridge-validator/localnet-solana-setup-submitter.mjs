import { createHash } from "node:crypto";
import {
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import { base58Encode } from "./solana-deposit-claim-transaction-plan.mjs";
import {
  LOCALNET_MANAGER_PROGRAM_ID_BASE58,
  LOCALNET_SOLANA_SETUP_PLAN_PROTOCOL,
  LOCALNET_SOLANA_SETUP_SCOPE,
  LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58,
  MINT_ACCOUNT_LENGTH,
  SPL_TOKEN_ACCOUNT_LENGTH,
  SPL_TOKEN_PROGRAM_ID_BASE58,
  SYSTEM_PROGRAM_ID_BASE58,
  prepareSignedLocalnetSolanaSetupTransaction,
} from "./localnet-solana-setup-plan.mjs";
import { SolanaLocalRpcClient } from "./solana-deposit-claim-submitter.mjs";

export const LOCALNET_SOLANA_SETUP_SUBMITTER_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCALNET_SOLANA_SETUP_SUBMITTER/V1";

export const LOCALNET_SOLANA_SETUP_COMPLETED = "COMPLETED";
export const LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY = "WAITING_FOR_DEPENDENCY";
export const LOCALNET_SOLANA_SETUP_REJECTED = "REJECTED";
export const LOCALNET_SOLANA_SETUP_HARD_STOP = "HARD_STOP";

const LOCALNET = "localnet";
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const BASE58_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/u;
const DEFAULT_LOCALNET_AIRDROP_LAMPORTS = "5000000000";
const DEFAULT_MAX_RETRIES = 0;

export class LocalnetSolanaSetupSubmitter {
  #config;
  #rpcClient;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#config = normalizeSetupSubmitterConfig(value.config);
    this.#rpcClient =
      value.rpcClient ??
      new SolanaLocalRpcClient({
        endpoint: `http://127.0.0.1:${this.#config.solanaRpcPort}`,
        fetchImpl: value.fetchImpl,
      });
  }

  async submitSetup(request) {
    const normalized = normalizeSetupRequest(this.#config, request);

    let mintRentLamports;
    let tokenAccountRentLamports;
    try {
      mintRentLamports = (await this.#rpcClient.getMinimumBalanceForRentExemption(MINT_ACCOUNT_LENGTH)).toString();
      tokenAccountRentLamports = (await this.#rpcClient.getMinimumBalanceForRentExemption(SPL_TOKEN_ACCOUNT_LENGTH)).toString();
    } catch {
      return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_RENT_EXEMPTION_UNAVAILABLE", {
        request: normalized,
      });
    }

    let latestBlockhash;
    try {
      latestBlockhash = await this.#rpcClient.getLatestBlockhash();
    } catch {
      return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_BLOCKHASH_UNAVAILABLE", {
        request: normalized,
      });
    }

    let signedPlan;
    try {
      signedPlan = await prepareSignedLocalnetSolanaSetupTransaction({
        ...normalized,
        mintRentLamports,
        tokenAccountRentLamports,
        recentBlockhashBase58: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });
    } catch (error) {
      return setupDecision(LOCALNET_SOLANA_SETUP_REJECTED, "LOCALNET_SOLANA_SETUP_TRANSACTION_INVALID", {
        request: normalized,
        error: redactedError(error),
      });
    }

    let existingAccounts;
    try {
      existingAccounts = await observeSetupAccounts(this.#rpcClient, signedPlan);
    } catch {
      return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_SETUP_ACCOUNT_PREFLIGHT_UNAVAILABLE", {
        request: normalized,
        transactionPlan: publicSetupPlan(signedPlan),
      });
    }
    if (allSetupAccountsReady(existingAccounts)) {
      return setupDecision(LOCALNET_SOLANA_SETUP_COMPLETED, "LOCALNET_SOLANA_SETUP_ALREADY_PRESENT", {
        request: normalized,
        transactionPlan: publicSetupPlan(signedPlan),
        accounts: existingAccounts,
      });
    }
    if (existingAccounts.some((entry) => entry.state !== "MISSING")) {
      return setupDecision(LOCALNET_SOLANA_SETUP_HARD_STOP, "LOCALNET_SOLANA_SETUP_PARTIAL_OR_CONFLICTING_ACCOUNTS", {
        request: normalized,
        transactionPlan: publicSetupPlan(signedPlan),
        accounts: existingAccounts,
      });
    }

    let airdropSignature;
    try {
      airdropSignature = await this.#rpcClient.requestAirdrop(normalized.feePayerBase58, normalized.feePayerAirdropLamports);
    } catch {
      return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_AIRDROP_UNAVAILABLE", {
        request: normalized,
        transactionPlan: publicSetupPlan(signedPlan),
      });
    }

    const airdropStatus = await finalizedSignatureStatusOrDependency(this.#rpcClient, airdropSignature, normalized);
    if (airdropStatus.state !== LOCALNET_SOLANA_SETUP_COMPLETED) {
      return setupDecision(airdropStatus.state, airdropStatus.reason, {
        request: normalized,
        airdropSignature,
        transactionPlan: publicSetupPlan(signedPlan),
      });
    }

    let setupSignature;
    try {
      setupSignature = await this.#rpcClient.sendTransaction(signedPlan.preparedTransactionBase64, {
        encoding: "base64",
        maxRetries: normalized.maxRetries,
        skipPreflight: false,
      });
    } catch {
      return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_SETUP_SEND_FAILED", {
        request: normalized,
        airdropSignature,
        transactionPlan: publicSetupPlan(signedPlan),
      });
    }

    const setupStatus = await finalizedSignatureStatusOrDependency(this.#rpcClient, setupSignature, normalized);
    if (setupStatus.state !== LOCALNET_SOLANA_SETUP_COMPLETED) {
      return setupDecision(setupStatus.state, setupStatus.reason, {
        request: normalized,
        airdropSignature,
        solanaSetupSignature: setupSignature,
        transactionPlan: publicSetupPlan(signedPlan),
      });
    }

    let verifiedAccounts;
    try {
      verifiedAccounts = await observeSetupAccounts(this.#rpcClient, signedPlan);
    } catch {
      return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_SETUP_ACCOUNT_VERIFICATION_UNAVAILABLE", {
        request: normalized,
        airdropSignature,
        solanaSetupSignature: setupSignature,
        transactionPlan: publicSetupPlan(signedPlan),
      });
    }
    if (!allSetupAccountsReady(verifiedAccounts)) {
      return setupDecision(LOCALNET_SOLANA_SETUP_HARD_STOP, "LOCALNET_SOLANA_SETUP_ACCOUNT_VERIFICATION_FAILED", {
        request: normalized,
        airdropSignature,
        solanaSetupSignature: setupSignature,
        transactionPlan: publicSetupPlan(signedPlan),
        accounts: verifiedAccounts,
      });
    }

    return setupDecision(LOCALNET_SOLANA_SETUP_COMPLETED, "LOCALNET_SOLANA_SETUP_FINALIZED", {
      request: normalized,
      airdropSignature,
      solanaSetupSignature: setupSignature,
      transactionPlan: publicSetupPlan(signedPlan),
      accounts: verifiedAccounts,
    });
  }
}

export function createLocalnetSolanaSetupSubmitter(options) {
  return new LocalnetSolanaSetupSubmitter(options);
}

async function finalizedSignatureStatusOrDependency(rpcClient, signature, request) {
  let status;
  try {
    status = await rpcClient.getSignatureStatus(signature);
  } catch {
    return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_SIGNATURE_STATUS_UNAVAILABLE", {
      request,
    });
  }
  if (status === null || status === undefined) {
    return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_SIGNATURE_WAITING_FOR_FINALITY", {
      request,
    });
  }
  if (status.err !== null && status.err !== undefined) {
    return setupDecision(LOCALNET_SOLANA_SETUP_REJECTED, "LOCALNET_SOLANA_TRANSACTION_REJECTED", {
      request,
      solanaError: "REDACTED",
    });
  }
  if (status.confirmationStatus !== "finalized") {
    return setupDecision(LOCALNET_SOLANA_SETUP_WAITING_FOR_DEPENDENCY, "LOCALNET_SOLANA_SIGNATURE_WAITING_FOR_FINALITY", {
      request,
      confirmationStatus: status.confirmationStatus ?? "unknown",
    });
  }
  return setupDecision(LOCALNET_SOLANA_SETUP_COMPLETED, "LOCALNET_SOLANA_SIGNATURE_FINALIZED", {
    request,
    slot: String(status.slot ?? "0"),
  });
}

async function observeSetupAccounts(rpcClient, plan) {
  const expected = [
    {
      role: "mint",
      addressBase58: plan.mintBase58,
      expectedOwnerBase58: plan.tokenProgramIdBase58,
      expectedDataLength: MINT_ACCOUNT_LENGTH,
    },
    {
      role: "recipientTokenAccount",
      addressBase58: plan.recipientTokenAccountBase58,
      expectedOwnerBase58: plan.tokenProgramIdBase58,
      expectedDataLength: SPL_TOKEN_ACCOUNT_LENGTH,
    },
    {
      role: "bridgeState",
      addressBase58: plan.pdas.bridgeState.addressBase58,
      expectedOwnerBase58: plan.managerProgramIdBase58,
    },
    {
      role: "transceiverConfig",
      addressBase58: plan.pdas.transceiverConfig.addressBase58,
      expectedOwnerBase58: plan.transceiverProgramIdBase58,
    },
  ];
  return Object.freeze(
    await Promise.all(
      expected.map(async (entry) => normalizeObservedSetupAccount(entry, await rpcClient.getAccountInfo(entry.addressBase58))),
    ),
  );
}

function normalizeObservedSetupAccount(expected, accountInfo) {
  if (accountInfo === null) {
    return Object.freeze({
      role: expected.role,
      addressBase58: expected.addressBase58,
      state: "MISSING",
    });
  }
  const ownerBase58 = normalizeBase58Like(accountInfo.owner, `${expected.role}.owner`);
  const dataLength = base64AccountDataLength(accountInfo.data, expected.role);
  const ownerMatches = ownerBase58 === expected.expectedOwnerBase58;
  const dataLengthMatches =
    expected.expectedDataLength === undefined || dataLength === expected.expectedDataLength;
  return Object.freeze({
    role: expected.role,
    addressBase58: expected.addressBase58,
    state: ownerMatches && dataLengthMatches ? "READY" : "CONFLICT",
    ownerBase58,
    expectedOwnerBase58: expected.expectedOwnerBase58,
    dataLength,
    expectedDataLength: expected.expectedDataLength,
  });
}

function allSetupAccountsReady(accounts) {
  return accounts.length > 0 && accounts.every((entry) => entry.state === "READY");
}

function base64AccountDataLength(value, role) {
  if (Array.isArray(value)) {
    if (typeof value[0] !== "string" || value[1] !== "base64") {
      throw new Error(`LocalnetSolanaSetupAccountDataEncodingInvalid:${role}`);
    }
    return Buffer.from(value[0], "base64").length;
  }
  if (typeof value === "string") {
    return Buffer.from(value, "base64").length;
  }
  throw new Error(`LocalnetSolanaSetupAccountDataMissing:${role}`);
}

function publicSetupPlan(plan) {
  return Object.freeze({
    protocol: LOCALNET_SOLANA_SETUP_PLAN_PROTOCOL,
    setupScope: LOCALNET_SOLANA_SETUP_SCOPE,
    environment: plan.environment,
    cluster: plan.cluster,
    mainnetActivation: plan.mainnetActivation,
    productionReady: plan.productionReady,
    solanaDeploymentHex: plan.solanaDeploymentHex,
    managerProgramIdBase58: plan.managerProgramIdBase58,
    transceiverProgramIdBase58: plan.transceiverProgramIdBase58,
    mintBase58: plan.mintBase58,
    recipientTokenAccountBase58: plan.recipientTokenAccountBase58,
    recipientTokenAccountOwnerBase58: plan.recipientTokenAccountOwnerBase58,
    feePayerBase58: plan.feePayerBase58,
    tokenProgramIdBase58: plan.tokenProgramIdBase58,
    systemProgramIdBase58: plan.systemProgramIdBase58,
    decimals: plan.decimals,
    nativeDecimals: plan.nativeDecimals,
    initialSupplyAtomic: plan.initialSupplyAtomic,
    freezeAuthority: plan.freezeAuthority,
    mintRentLamports: plan.mintRentLamports,
    tokenAccountRentLamports: plan.tokenAccountRentLamports,
    recentBlockhashBase58: plan.recentBlockhashBase58,
    lastValidBlockHeight: plan.lastValidBlockHeight,
    policyEpoch: plan.policyEpoch,
    keyEpoch: plan.keyEpoch,
    attesterPublicKeysHex: plan.attesterPublicKeysHex,
    accounts: plan.accounts,
    pdas: plan.pdas,
    accountLengths: plan.accountLengths,
    instructions: plan.instructions,
    messageFingerprintHex: plan.messageFingerprintHex,
    preparedTransactionFingerprintHex: plan.preparedTransactionFingerprintHex,
  });
}

function normalizeSetupSubmitterConfig(config) {
  const value = requireObject(config, "config");
  const environment = value.environment ?? LOCALNET;
  const cluster = value.cluster ?? LOCALNET;
  if (environment !== LOCALNET || cluster !== LOCALNET) {
    throw new Error("LocalnetSolanaSetupSubmitterLocalnetOnly");
  }
  return Object.freeze({
    environment,
    cluster,
    solanaDeploymentHex: normalizeHash32(value.solanaDeploymentHex, "solanaDeploymentHex"),
    managerProgramIdBase58: normalizeBase58Like(
      value.managerProgramIdBase58 ?? pubkeyHexToBase58(value.managerProgramIdHex ?? undefined, LOCALNET_MANAGER_PROGRAM_ID_BASE58),
      "managerProgramIdBase58",
    ),
    transceiverProgramIdBase58: normalizeBase58Like(
      value.transceiverProgramIdBase58 ??
        pubkeyHexToBase58(value.transceiverProgramIdHex ?? undefined, LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58),
      "transceiverProgramIdBase58",
    ),
    tokenProgramIdBase58: normalizeBase58Like(value.tokenProgramIdBase58 ?? SPL_TOKEN_PROGRAM_ID_BASE58, "tokenProgramIdBase58"),
    systemProgramIdBase58: normalizeBase58Like(value.systemProgramIdBase58 ?? SYSTEM_PROGRAM_ID_BASE58, "systemProgramIdBase58"),
    decimals: checkedU8(value.decimals, "decimals"),
    nativeDecimals: checkedU8(value.nativeDecimals, "nativeDecimals"),
    policyEpoch: checkedU32(value.policyEpoch, "policyEpoch"),
    keyEpoch: checkedU32(value.keyEpoch, "keyEpoch"),
    solanaRpcPort: checkedPort(value.solanaRpcPort ?? 8899, "solanaRpcPort"),
    feePayerAirdropLamports: normalizeU64Decimal(
      value.feePayerAirdropLamports ?? DEFAULT_LOCALNET_AIRDROP_LAMPORTS,
      "feePayerAirdropLamports",
    ),
    maxRetries: checkedSmallInteger(value.maxRetries ?? DEFAULT_MAX_RETRIES, "maxRetries"),
  });
}

function normalizeSetupRequest(config, request) {
  const value = requireObject(request, "request");
  const normalized = Object.freeze({
    environment: config.environment,
    cluster: config.cluster,
    solanaDeploymentHex: config.solanaDeploymentHex,
    managerProgramIdBase58: config.managerProgramIdBase58,
    transceiverProgramIdBase58: config.transceiverProgramIdBase58,
    tokenProgramIdBase58: config.tokenProgramIdBase58,
    systemProgramIdBase58: config.systemProgramIdBase58,
    decimals: config.decimals,
    nativeDecimals: config.nativeDecimals,
    initialSupplyAtomic: "0",
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    depositsPaused: false,
    withdrawalsPaused: false,
    hardStop: false,
    transceiverActive: true,
    mainnetActivationEnabled: false,
    mintBase58: normalizeBase58Like(value.mintBase58, "mintBase58"),
    mintHex: normalizeHash32(value.mintHex, "mintHex"),
    recipientTokenAccountBase58: normalizeBase58Like(value.recipientTokenAccountBase58, "recipientTokenAccountBase58"),
    recipientTokenAccountHex: normalizeHash32(value.recipientTokenAccountHex, "recipientTokenAccountHex"),
    recipientTokenAccountOwnerBase58: normalizeBase58Like(
      value.recipientTokenAccountOwnerBase58,
      "recipientTokenAccountOwnerBase58",
    ),
    recipientTokenAccountOwnerHex: normalizeHash32(value.recipientTokenAccountOwnerHex, "recipientTokenAccountOwnerHex"),
    feePayerBase58: normalizeBase58Like(value.feePayerBase58, "feePayerBase58"),
    feePayerHex: normalizeHash32(value.feePayerHex, "feePayerHex"),
    attesterPublicKeysHex: normalizeTwoPubkeyHexes(value.attesterPublicKeysHex),
    feePayerAirdropLamports: normalizeU64Decimal(
      value.feePayerAirdropLamports ?? config.feePayerAirdropLamports,
      "feePayerAirdropLamports",
    ),
    maxRetries: checkedSmallInteger(value.maxRetries ?? config.maxRetries, "maxRetries"),
    feePayerSigner: requireObject(value.feePayerSigner, "feePayerSigner"),
    mintSigner: requireObject(value.mintSigner, "mintSigner"),
    recipientTokenAccountSigner: requireObject(value.recipientTokenAccountSigner, "recipientTokenAccountSigner"),
  });
  assertHexBase58Match(normalized.mintHex, normalized.mintBase58, "mint");
  assertHexBase58Match(normalized.recipientTokenAccountHex, normalized.recipientTokenAccountBase58, "recipientTokenAccount");
  assertHexBase58Match(normalized.recipientTokenAccountOwnerHex, normalized.recipientTokenAccountOwnerBase58, "recipientTokenAccountOwner");
  assertHexBase58Match(normalized.feePayerHex, normalized.feePayerBase58, "feePayer");
  return normalized;
}

function setupDecision(state, reason, extra = {}) {
  const sanitizedExtra = { ...extra };
  if (sanitizedExtra.request !== undefined) {
    sanitizedExtra.request = publicSetupRequest(sanitizedExtra.request);
  }
  return Object.freeze({
    protocol: LOCALNET_SOLANA_SETUP_SUBMITTER_PROTOCOL,
    state,
    reason,
    productionReady: false,
    mainnetActivation: "DISABLED",
    ...sanitizedExtra,
  });
}

function publicSetupRequest(request) {
  return Object.freeze({
    environment: request.environment,
    cluster: request.cluster,
    solanaDeploymentHex: request.solanaDeploymentHex,
    managerProgramIdBase58: request.managerProgramIdBase58,
    transceiverProgramIdBase58: request.transceiverProgramIdBase58,
    tokenProgramIdBase58: request.tokenProgramIdBase58,
    systemProgramIdBase58: request.systemProgramIdBase58,
    decimals: request.decimals,
    nativeDecimals: request.nativeDecimals,
    initialSupplyAtomic: request.initialSupplyAtomic,
    policyEpoch: request.policyEpoch,
    keyEpoch: request.keyEpoch,
    mintBase58: request.mintBase58,
    mintHex: request.mintHex,
    recipientTokenAccountBase58: request.recipientTokenAccountBase58,
    recipientTokenAccountHex: request.recipientTokenAccountHex,
    recipientTokenAccountOwnerBase58: request.recipientTokenAccountOwnerBase58,
    recipientTokenAccountOwnerHex: request.recipientTokenAccountOwnerHex,
    feePayerBase58: request.feePayerBase58,
    feePayerHex: request.feePayerHex,
    attesterPublicKeysHex: request.attesterPublicKeysHex,
    feePayerAirdropLamports: request.feePayerAirdropLamports,
    maxRetries: request.maxRetries,
  });
}

function assertHexBase58Match(hexValue, base58Value, label) {
  if (pubkeyHexToBase58(hexValue) !== base58Value) {
    throw new Error(`LocalnetSolanaSetupSubmitterHexBase58Mismatch:${label}`);
  }
}

function normalizeTwoPubkeyHexes(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("LocalnetSolanaSetupSubmitterExactlyTwoAttestersRequired");
  }
  const normalized = value.map((item, index) => normalizeHash32(item, `attesterPublicKeysHex[${index}]`));
  if (normalized[0] === normalized[1]) {
    throw new Error("LocalnetSolanaSetupSubmitterDuplicateAttester");
  }
  return Object.freeze(normalized);
}

function pubkeyHexToBase58(value, fallback = undefined) {
  if (value === undefined) return fallback;
  return base58Encode(hexToBytes(normalizeHash32(value, "pubkeyHex"), "pubkeyHex"));
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function normalizeBase58Like(value, label) {
  if (typeof value !== "string" || !BASE58_LIKE.test(value)) {
    throw new Error(`${label}:InvalidBase58`);
  }
  return value;
}

function normalizeU64Decimal(value, label) {
  const normalized = canonicalUintDecimalLike(value, label);
  const integer = BigInt(normalized);
  if (integer < 0n || integer > 0xffff_ffff_ffff_ffffn) {
    throw new Error(`${label}:ExpectedU64`);
  }
  return normalized;
}

function canonicalUintDecimalLike(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
    return String(value);
  }
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function checkedU8(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label}:ExpectedU8`);
  }
  return value;
}

function checkedU32(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
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

function checkedPort(value, label) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${label}:ExpectedNonPrivilegedPort`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}

function redactedError(error) {
  return createHash("sha256").update(String(error?.message ?? error)).digest("hex");
}
