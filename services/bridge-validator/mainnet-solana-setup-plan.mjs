// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public-data transaction preparation only. No key, RPC, signer or sender.
// The deployment operator must independently verify the live cluster/programs
// and the authorized deployment scope before signing/submitting these bytes.
import { createHash } from "node:crypto";
import { assertMainnetDeploymentFields, SOLANA_MAINNET_GENESIS } from "../../shared/network-identity.mjs";
import { encodeBridgeAbi } from "../../shared/protocol/solana-bridge-abi.mjs";
import { base58Decode, base58Encode, findProgramAddress, shortvecEncode,
  BRIDGE_STATE_PDA_SEED_PREFIX, TRANSCEIVER_CONFIG_PDA_SEED_PREFIX, MINT_AUTHORITY_PDA_SEED_PREFIX } from "./solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58, SYSTEM_PROGRAM_ID_BASE58, MINT_ACCOUNT_LENGTH } from "./localnet-solana-setup-plan.mjs";

const check = (value, code = "MainnetSetupPlanRejected") => { if (!value) throw Error(code); };
const fields = (value, names) => check(value && !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...names].sort().join());
const IDENTITY_FIELDS = ["environment", "cluster", "solanaGenesis", "protocolId", "nativeNetwork", "nativeGenesisHex",
  "solanaDeploymentHex", "managerProgramIdBase58", "transceiverProgramIdBase58", "mintBase58", "feePayerBase58",
  "recentBlockhashBase58", "lastValidBlockHeight"];
const key = value => {
  check(typeof value === "string"); const bytes = Buffer.from(base58Decode(value));
  check(bytes.length === 32 && base58Encode(bytes) === value && bytes.some(byte => byte !== 0)); return bytes;
};
const uint = value => {
  check(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value));
  const n = BigInt(value); check(n <= 0xffff_ffff_ffff_ffffn); return n;
};
const epoch = value => { check(Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff); return value; };
const hash = value => createHash("sha256").update(value).digest("hex");
function identity(c) {
  check(c.environment === "mainnet" && c.cluster === "mainnet" && c.solanaGenesis === SOLANA_MAINNET_GENESIS,
    "MainnetSetupClusterRequired");
  const manager = key(c.managerProgramIdBase58), transceiver = key(c.transceiverProgramIdBase58), mint = key(c.mintBase58), payer = key(c.feePayerBase58);
  check(new Set([manager, transceiver, mint, payer].map(k => k.toString("hex"))).size === 4);
  assertMainnetDeploymentFields({ protocolId: c.protocolId, nativeNetwork: c.nativeNetwork, nativeGenesis: c.nativeGenesisHex,
    solanaDeployment: c.solanaDeploymentHex, managerProgramId: manager.toString("hex"), transceiverProgramId: transceiver.toString("hex"), mint: mint.toString("hex") });
  const blockhash = key(c.recentBlockhashBase58); check(uint(c.lastValidBlockHeight) > 0n);
  const pda = (seed, program) => findProgramAddress([Buffer.from(seed), mint], program).base58;
  return { manager, transceiver, mint, payer, blockhash, pdas: {
    bridgeState: pda(BRIDGE_STATE_PDA_SEED_PREFIX, manager),
    transceiverConfig: pda(TRANSCEIVER_CONFIG_PDA_SEED_PREFIX, transceiver),
    mintAuthority: pda(MINT_AUTHORITY_PDA_SEED_PREFIX, manager) } };
}
const instruction = (role, programIdIndex, accountIndexes, data) => Object.freeze({ role, programIdIndex,
  accountIndexes: Object.freeze(accountIndexes), dataBase64: Buffer.from(data).toString("base64") });
function message(c, accountKeys, readonlySigned, readonlyUnsigned, instructions) {
  check(new Set(accountKeys).size === accountKeys.length);
  const bytes = Buffer.concat([Buffer.from([2, readonlySigned, readonlyUnsigned]), Buffer.from(shortvecEncode(accountKeys.length)),
    ...accountKeys.map(k => Buffer.from(base58Decode(k))), key(c.recentBlockhashBase58), Buffer.from(shortvecEncode(instructions.length)),
    ...instructions.map(i => {
      const data = Buffer.from(i.dataBase64, "base64");
      return Buffer.concat([Buffer.from([i.programIdIndex]), Buffer.from(shortvecEncode(i.accountIndexes.length)),
        Buffer.from(i.accountIndexes), Buffer.from(shortvecEncode(data.length)), data]);
    })]);
  check(1 + 2 * 64 + bytes.length <= 1232, "MainnetSetupPacketTooLarge");
  return { accountKeys: Object.freeze(accountKeys), requiredSigners: Object.freeze([c.feePayerBase58, c.mintBase58]),
    recentBlockhashBase58: c.recentBlockhashBase58, lastValidBlockHeight: c.lastValidBlockHeight,
    instructions: Object.freeze(instructions), messageBase64: bytes.toString("base64"), messageFingerprintHex: hash(bytes) };
}

export function buildMainnetSolanaSetupTransactionPlan(input) {
  return buildInitialization(input,true);
}
// The official Mint can exist before program deployment. This path contains
// no system-create-Mint or SPL initialize-Mint instruction, so restart cannot
// recreate or replace the already verified official identity/metadata.
export function buildMainnetExistingMintInitializationPlan(input) {
  return buildInitialization(input,false);
}
function buildInitialization(input,createMintAccount) {
  const c = structuredClone(input);
  fields(c, [...IDENTITY_FIELDS, "attesterPublicKeysHex", "decimals", "nativeDecimals", "policyEpoch", "keyEpoch", ...(createMintAccount?["mintRentLamports"]:[])]);
  const i = identity(c);
  check(c.decimals === 8 && c.nativeDecimals === 8, "MainnetSetupDecimalsRequired");
  epoch(c.policyEpoch); epoch(c.keyEpoch); if(createMintAccount)check(uint(c.mintRentLamports) > 0n);
  check(Array.isArray(c.attesterPublicKeysHex) && c.attesterPublicKeysHex.length === 2 &&
    c.attesterPublicKeysHex.every(v => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v) && !/^0+$/u.test(v)));
  const attesters = c.attesterPublicKeysHex.map(v => Buffer.from(v, "hex"));
  check(new Set([...attesters, i.manager, i.transceiver, i.mint, i.payer].map(k => k.toString("hex"))).size === 6);
  const token = Buffer.from(base58Decode(SPL_TOKEN_PROGRAM_ID_BASE58));
  const createMint = Buffer.alloc(52); if(createMintAccount)createMint.writeBigUInt64LE(uint(c.mintRentLamports), 4);
  createMint.writeBigUInt64LE(BigInt(MINT_ACCOUNT_LENGTH), 12); token.copy(createMint, 20);
  const mintAuthority = Buffer.from(base58Decode(i.pdas.mintAuthority));
  const accounts = [c.feePayerBase58, c.mintBase58, i.pdas.bridgeState, i.pdas.transceiverConfig, i.pdas.mintAuthority,
    SPL_TOKEN_PROGRAM_ID_BASE58, SYSTEM_PROGRAM_ID_BASE58, c.transceiverProgramIdBase58, c.managerProgramIdBase58];
  const instructions = [
    ...(createMintAccount?[
    instruction("systemCreateMint", 6, [0, 1], createMint),
    instruction("splInitializeMint2", 5, [1], Buffer.concat([Buffer.from([20, 8]), mintAuthority, Buffer.from([0])])),
    ]:[]),
    instruction("transceiverInitialize", 7, [3, 1, 0, 6], encodeBridgeAbi("TransceiverInitialize", { tag: 1,
      config: { transceiverProgramId: i.transceiver, managerProgramId: i.manager, mint: i.mint,
        solanaDeployment: Buffer.from(c.solanaDeploymentHex, "hex"), protocolId: c.protocolId, nativeNetwork: c.nativeNetwork,
        nativeGenesis: Buffer.from(c.nativeGenesisHex, "hex"), authorizedAttesters: attesters, active: true, keyEpoch: c.keyEpoch } })),
    instruction("bridgeInitialize", 8, [2, 1, 5, 0, 6], encodeBridgeAbi("BridgeInitialize", { tag: 1,
      binding: { environment: 2, managerProgramId: i.manager, transceiverProgramId: i.transceiver,
        solanaDeployment: Buffer.from(c.solanaDeploymentHex, "hex"), mint: i.mint, tokenProgramId: token,
        mintAuthorityPda: mintAuthority, decimals: 8, nativeDecimals: 8 },
      policy: { policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch, depositsPaused: true, hardStop: false, mainnetActivationEnabled: false } })),
  ];
  return Object.freeze({ protocol: createMintAccount?"KINGPEPE_MAINNET_ZERO_SUPPLY_SETUP_V1":"KINGPEPE_MAINNET_EXISTING_MINT_INITIALIZATION_V1", scope: "UNSIGNED_MAINNET_PREPARATION",
    environment: "mainnet", initialSupplyAtomic: "0", decimals: 8, freezeAuthority: null, pdas: Object.freeze(i.pdas),
    mintAuthority: i.pdas.mintAuthority, depositsPaused: true, productionReady: false, mainnetActivation: "DISABLED",
    ...message(c, accounts, 0, 5, instructions) });
}

// The existing on-chain enrollment identity is the Mint account signer; it is
// distinct from SPL mint authority (the Bridge PDA) and the upgrade authority.
// Creating unsigned mode bytes grants no activation permission.
export function buildMainnetModeTransactionPlan(input) {
  const c = structuredClone(input); fields(c, [...IDENTITY_FIELDS, "mode"]); const i = identity(c);
  check(["PAUSED", "CONTROLLED", "ACTIVE"].includes(c.mode), "MainnetModeRejected");
  const accounts = [c.feePayerBase58, c.mintBase58, i.pdas.bridgeState, c.managerProgramIdBase58];
  return Object.freeze({ protocol: "KINGPEPE_MAINNET_MODE_PLAN_V1", scope: "UNSIGNED_MAINNET_PREPARATION", environment: "mainnet",
    requestedMode: c.mode, enrollmentAuthority: c.mintBase58, bridgeState: i.pdas.bridgeState,
    ...message(c, accounts, 1, 1, [instruction("setMainnetMode", 3, [2, 1],
      encodeBridgeAbi("MainnetMode", { tag: 4, mode: ["PAUSED", "CONTROLLED", "ACTIVE"].indexOf(c.mode) }))]) });
}
