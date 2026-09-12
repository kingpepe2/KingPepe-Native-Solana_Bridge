import { bridgeInputDigest } from "../../shared/protocol/bridge-inputs.mjs";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import { findProgramAddress } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";

export const SOLANA_TRUST_LEVELS = Object.freeze([
  "RPC_OBSERVATION",
  "LOCAL_VALIDATION",
  "PROJECT_ATTESTATION",
]);

export const VERIFIED_READY = "VERIFIED_READY";
export const WAITING_FOR_FINALITY = "WAITING_FOR_FINALITY";
export const WAITING_FOR_DEPENDENCY = "WAITING_FOR_DEPENDENCY";
export const REJECTED = "REJECTED";
export const HARD_STOP = "HARD_STOP";
export const GLOBAL_HARD_STOP = "GLOBAL_HARD_STOP";

export function evaluateFinalizedWithdrawalObservation(config, observation) {
  const expected = normalizeObserverConfig(config);
  // No production source is implemented by this observation policy model.
  // A caller-controlled configured=true flag is not activation authority.
  if (expected.environment !== "localnet" || expected.cluster !== "localnet") {
    return observerDecision(HARD_STOP, "PRODUCTION_SOLANA_OBSERVER_BLOCKED");
  }
  if (!SOLANA_TRUST_LEVELS.includes(observation.trust)) {
    return observerDecision(REJECTED, "UNKNOWN_SOLANA_OBSERVATION_TRUST");
  }
  if (!expected.acceptedTrustLevels.includes(observation.trust)) {
    return observerDecision(WAITING_FOR_DEPENDENCY, "SOLANA_TRUST_NOT_ACCEPTED");
  }
  if (observation.cluster !== expected.cluster) {
    return observerDecision(REJECTED, "SOLANA_CLUSTER_MISMATCH");
  }
  if (normalizeHashLike(observation.solanaDeployment, "solanaDeployment") !== expected.solanaDeploymentHex) {
    return observerDecision(REJECTED, "SOLANA_DEPLOYMENT_MISMATCH");
  }

  let identityResult;
  try {
    identityResult = evaluateProgramAndAuthorityIdentity(expected, observation);
  } catch {
    identityResult = { state: HARD_STOP, reason: "PROGRAM_OR_MINT_IDENTITY_INVALID" };
  }
  if (identityResult) {
    return observerDecision(identityResult.state, identityResult.reason);
  }

  if (!observation.transaction || observation.transaction.err !== null) {
    return observerDecision(REJECTED, "SOLANA_TRANSACTION_FAILED_OR_MISSING");
  }
  let slot;
  let rootSlot;
  try { slot = exactSlot(observation.slot); rootSlot = exactSlot(observation.rootSlot); }
  catch { return observerDecision(REJECTED, "SOLANA_SLOT_INVALID"); }
  if (observation.commitment !== "finalized" || rootSlot < slot) {
    return observerDecision(WAITING_FOR_FINALITY, "SOLANA_FINALITY_NOT_REACHED");
  }

  const message = decodeCanonicalBridgeMessage(hexToBytes(observation.encodedWithdrawalMessageHex, "encodedWithdrawalMessageHex"));
  const domainResult = checkWithdrawalMessageDomain(expected, message);
  if (domainResult) {
    return observerDecision(REJECTED, domainResult, message);
  }

  const withdrawal = observation.withdrawalAccount;
  if (!withdrawal) {
    return observerDecision(REJECTED, "WITHDRAWAL_RECORD_MISSING", message);
  }
  const expectedPda = deriveWithdrawalRecordPdaHex(expected.managerProgramIdHex, message.withdrawalIdHex);
  if (normalizeHashLike(withdrawal.accountProgramId, "withdrawal.accountProgramId") !== expected.managerProgramIdHex) {
    return observerDecision(REJECTED, "WITHDRAWAL_ACCOUNT_PROGRAM_MISMATCH", message);
  }
  if (normalizeHashLike(withdrawal.pda, "withdrawal.pda") !== expectedPda) {
    return observerDecision(REJECTED, "WITHDRAWAL_PDA_MISMATCH", message);
  }
  if (normalizeHashLike(withdrawal.withdrawalIdHex, "withdrawal.withdrawalIdHex") !== message.withdrawalIdHex) {
    return observerDecision(REJECTED, "WITHDRAWAL_ID_MISMATCH", message);
  }
  if (normalizeHashLike(withdrawal.operationIdHex, "withdrawal.operationIdHex") !== message.operationIdHex) {
    return observerDecision(REJECTED, "OPERATION_ID_MISMATCH", message);
  }
  if (normalizeHashLike(withdrawal.messageDigestHex, "withdrawal.messageDigestHex") !== message.messageDigestHex) {
    return observerDecision(REJECTED, "MESSAGE_DIGEST_MISMATCH", message);
  }
  if (BigInt(withdrawal.grossAmountAtomic) !== message.amountAtomic) {
    return observerDecision(REJECTED, "WITHDRAWAL_AMOUNT_MISMATCH", message);
  }
  if (BigInt(withdrawal.feeAtomic) !== message.feeAtomic) {
    return observerDecision(REJECTED, "WITHDRAWAL_FEE_MISMATCH", message);
  }
  if (normalizeHex(withdrawal.nativeDestinationHex, "withdrawal.nativeDestinationHex") !== message.destinationHex) {
    return observerDecision(REJECTED, "WITHDRAWAL_DESTINATION_MISMATCH", message);
  }

  const burnResult = checkBurn(expected, message, observation.burn);
  if (burnResult) {
    return observerDecision(REJECTED, burnResult, message);
  }

  return observerDecision(VERIFIED_READY, "ALL_REQUIRED_CHECKS_PASSED", message, {
    evidenceDigestHex: withdrawalObservationEvidenceDigestHex(expected, observation, message),
    withdrawalRecordPdaHex: expectedPda,
    sourceBoundary: observation.trust,
  });
}

export function evaluateProgramAndAuthorityIdentity(expected, observation) {
  const programs = observation.programs;
  if (!programs?.manager || !programs?.transceiver) {
    return { state: HARD_STOP, reason: "PROGRAM_IDENTITY_MISSING" };
  }
  const manager = normalizeProgramIdentity(programs.manager, "manager");
  const transceiver = normalizeProgramIdentity(programs.transceiver, "transceiver");
  if (manager.programIdHex !== expected.managerProgramIdHex || transceiver.programIdHex !== expected.transceiverProgramIdHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_PROGRAM_ID_CHANGE" };
  }
  if (manager.programDataAddressHex !== expected.managerProgramDataAddressHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_MANAGER_PROGRAMDATA_CHANGE" };
  }
  if (transceiver.programDataAddressHex !== expected.transceiverProgramDataAddressHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_TRANSCEIVER_PROGRAMDATA_CHANGE" };
  }
  if (manager.upgradeAuthorityHex !== expected.upgradeAuthorityHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_MANAGER_UPGRADE_AUTHORITY_CHANGE" };
  }
  if (transceiver.upgradeAuthorityHex !== expected.upgradeAuthorityHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_TRANSCEIVER_UPGRADE_AUTHORITY_CHANGE" };
  }

  const mint = normalizeMintIdentity(observation.mint);
  if (mint.addressHex !== expected.mintHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_MINT_CHANGE" };
  }
  if (mint.tokenProgramIdHex !== expected.tokenProgramIdHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_TOKEN_PROGRAM_CHANGE" };
  }
  if (mint.decimals !== expected.decimals) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_MINT_DECIMALS_CHANGE" };
  }
  if (mint.mintAuthorityHex !== expected.mintAuthorityPdaHex) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_MINT_AUTHORITY_CHANGE" };
  }
  if (mint.freezeAuthorityHex !== null) {
    return { state: HARD_STOP, reason: "UNAUTHORIZED_FREEZE_AUTHORITY_SET" };
  }
  return null;
}

export function deriveWithdrawalRecordPdaHex(managerProgramIdHex, withdrawalIdHex) {
  const managerProgramId = hexToBytes(managerProgramIdHex, "managerProgramIdHex");
  const withdrawalId = hexToBytes(withdrawalIdHex, "withdrawalIdHex");
  return findProgramAddress([Buffer.from("kingpepe-withdrawal-record"), withdrawalId], managerProgramId).hex;
}

export function withdrawalObservationEvidenceDigestHex(expected, observation, message) {
  return bridgeInputDigest("WithdrawalObservation", {
    protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/SOLANA_WITHDRAWAL_OBSERVATION/V1",
    cluster: expected.cluster,
    solanaDeploymentHex: expected.solanaDeploymentHex,
    transactionSignature: observation.transaction.signature,
    slot: observation.slot,
    rootSlot: observation.rootSlot,
    commitment: observation.commitment,
    operationIdHex: message.operationIdHex,
    withdrawalIdHex: message.withdrawalIdHex,
    messageDigestHex: message.messageDigestHex,
    grossAmountAtomic: message.amountAtomic.toString(),
    feeAtomic: message.feeAtomic.toString(),
    nativeDestinationHex: message.destinationHex,
    trust: observation.trust,
  });
}

function normalizeObserverConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("MissingSolanaObserverConfig");
  }
  return {
    environment: config.environment,
    cluster: config.cluster,
    solanaDeploymentHex: normalizeHashLike(config.solanaDeploymentHex, "solanaDeploymentHex"),
    nativeGenesisHex: normalizeHashLike(config.nativeGenesisHex, "nativeGenesisHex"),
    protocolId: config.protocolId,
    nativeNetwork: config.nativeNetwork,
    managerProgramIdHex: normalizeHashLike(config.managerProgramIdHex, "managerProgramIdHex"),
    transceiverProgramIdHex: normalizeHashLike(config.transceiverProgramIdHex, "transceiverProgramIdHex"),
    managerProgramDataAddressHex: normalizeHashLike(config.managerProgramDataAddressHex, "managerProgramDataAddressHex"),
    transceiverProgramDataAddressHex: normalizeHashLike(
      config.transceiverProgramDataAddressHex,
      "transceiverProgramDataAddressHex",
    ),
    upgradeAuthorityHex: normalizeHashLike(config.upgradeAuthorityHex, "upgradeAuthorityHex"),
    mintHex: normalizeHashLike(config.mintHex, "mintHex"),
    tokenProgramIdHex: normalizeHashLike(config.tokenProgramIdHex, "tokenProgramIdHex"),
    mintAuthorityPdaHex: normalizeHashLike(config.mintAuthorityPdaHex, "mintAuthorityPdaHex"),
    decimals: config.decimals,
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedTrustLevels: config.acceptedTrustLevels ?? ["LOCAL_VALIDATION"],
    productionObserverConfigured: config.productionObserverConfigured === true,
  };
}

function checkWithdrawalMessageDomain(expected, message) {
  if (message.action !== "WithdrawalRequest" || message.direction !== "SolanaToNative") {
    return "WRONG_MESSAGE_KIND";
  }
  if (message.deployment.protocolId !== expected.protocolId) return "MESSAGE_PROTOCOL_MISMATCH";
  if (message.deployment.nativeNetwork !== expected.nativeNetwork) return "MESSAGE_NATIVE_NETWORK_MISMATCH";
  if (bytesToHex(message.deployment.nativeGenesis) !== expected.nativeGenesisHex) return "MESSAGE_NATIVE_GENESIS_MISMATCH";
  if (bytesToHex(message.deployment.solanaDeployment) !== expected.solanaDeploymentHex) {
    return "MESSAGE_SOLANA_DEPLOYMENT_MISMATCH";
  }
  if (bytesToHex(message.deployment.managerProgramId) !== expected.managerProgramIdHex) {
    return "MESSAGE_MANAGER_PROGRAM_MISMATCH";
  }
  if (bytesToHex(message.deployment.transceiverProgramId) !== expected.transceiverProgramIdHex) {
    return "MESSAGE_TRANSCEIVER_PROGRAM_MISMATCH";
  }
  if (bytesToHex(message.deployment.mint) !== expected.mintHex) {
    return "MESSAGE_MINT_MISMATCH";
  }
  if (message.policyEpoch !== expected.policyEpoch) {
    return "MESSAGE_POLICY_EPOCH_MISMATCH";
  }
  if (message.keyEpoch !== expected.keyEpoch) {
    return "MESSAGE_KEY_EPOCH_MISMATCH";
  }
  return null;
}

function checkBurn(expected, message, burn) {
  if (!burn) {
    return "BURN_MISSING";
  }
  if (normalizeHashLike(burn.tokenProgramId, "burn.tokenProgramId") !== expected.tokenProgramIdHex) {
    return "BURN_TOKEN_PROGRAM_MISMATCH";
  }
  if (normalizeHashLike(burn.mint, "burn.mint") !== expected.mintHex) {
    return "BURN_MINT_MISMATCH";
  }
  if (BigInt(burn.amountAtomic) !== message.amountAtomic) {
    return "BURN_AMOUNT_MISMATCH";
  }
  if (burn.decimals !== expected.decimals) {
    return "BURN_DECIMALS_MISMATCH";
  }
  if (burn.userAuthorized !== true) {
    return "BURN_USER_AUTHORIZATION_MISSING";
  }
  return null;
}

function normalizeProgramIdentity(program, label) {
  return {
    programIdHex: normalizeHashLike(program.programId, `${label}.programId`),
    programDataAddressHex: normalizeHashLike(program.programDataAddress, `${label}.programDataAddress`),
    upgradeAuthorityHex: normalizeHashLike(program.upgradeAuthority, `${label}.upgradeAuthority`),
  };
}

function normalizeMintIdentity(mint) {
  if (!mint) {
    throw new Error("MissingMintIdentity");
  }
  const freezeAuthorityHex = mint.freezeAuthority === null ? null : normalizeHashLike(mint.freezeAuthority, "mint.freezeAuthority");
  return {
    addressHex: normalizeHashLike(mint.address, "mint.address"),
    tokenProgramIdHex: normalizeHashLike(mint.tokenProgramId, "mint.tokenProgramId"),
    decimals: mint.decimals,
    mintAuthorityHex: normalizeHashLike(mint.mintAuthority, "mint.mintAuthority"),
    freezeAuthorityHex,
  };
}

function observerDecision(state, reason, message = undefined, extra = {}) {
  return {
    state,
    reason,
    operationIdHex: message?.operationIdHex,
    messageDigestHex: message?.messageDigestHex,
    ...extra,
  };
}

function normalizeHashLike(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function exactSlot(value) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new Error("SOLANA_SLOT_INVALID");
  if (!["number", "string", "bigint"].includes(typeof value) || !/^(0|[1-9][0-9]*)$/u.test(String(value))) throw new Error("SOLANA_SLOT_INVALID");
  const parsed = BigInt(value);
  if (parsed > 0xffff_ffff_ffff_ffffn) throw new Error("SOLANA_SLOT_INVALID");
  return parsed;
}
