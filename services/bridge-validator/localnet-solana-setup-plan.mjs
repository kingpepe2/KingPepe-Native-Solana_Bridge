import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  bytesToHex,
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import {
  base58Decode,
  base58Encode,
  findProgramAddress,
  shortvecEncode,
} from "./solana-deposit-claim-transaction-plan.mjs";

export const LOCALNET_SOLANA_SETUP_PLAN_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCALNET_SOLANA_SETUP_PLAN/V1";

export const LOCALNET_MANAGER_PROGRAM_ID_BASE58 = "EfoRF4BDDspsi53XYL62mCyhCtf3FceV5LpRkRdwYqKM";
export const LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58 = "AkqLGFTy43D9cLjHRTQGpRGb2uWA8nuVyGb2bJYHKCrN";
export const SPL_TOKEN_PROGRAM_ID_BASE58 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SYSTEM_PROGRAM_ID_BASE58 = "11111111111111111111111111111111";

export const LOCALNET_SOLANA_SETUP_SCOPE = "LOCALNET_MINT_CONFIG_AND_TEST_RECIPIENT_BOOTSTRAP";
export const BRIDGE_INSTRUCTION_INITIALIZE = 1;
export const TRANSCEIVER_INSTRUCTION_INITIALIZE = 1;
export const SYSTEM_INSTRUCTION_CREATE_ACCOUNT = 0;
export const SPL_TOKEN_INSTRUCTION_INITIALIZE_MINT2 = 20;
export const SPL_TOKEN_INSTRUCTION_INITIALIZE_ACCOUNT3 = 18;
export const MINT_ACCOUNT_LENGTH = 82;
export const SPL_TOKEN_ACCOUNT_LENGTH = 165;

const LOCALNET = "localnet";
const BRIDGE_CONFIG_INSTRUCTION_LENGTH = 256;
const TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH = 197;
const BRIDGE_STATE_PDA_SEED_PREFIX = "kingpepe-bridge-state";
const MINT_AUTHORITY_PDA_SEED_PREFIX = "kingpepe-mint-authority";
const TRANSCEIVER_CONFIG_PDA_SEED_PREFIX = "kingpepe-transceiver-config";
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const MAX_U32 = 0xffff_ffffn;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const MAX_U8 = 0xffn;
const ZERO_32 = new Uint8Array(32);

export function buildLocalnetSolanaSetupTransactionPlan(config) {
  const normalized = normalizeSetupConfig(config);
  const mintAuthority = findProgramAddress(
    [utf8(MINT_AUTHORITY_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.managerProgram.bytes,
  );
  const bridgeState = findProgramAddress(
    [utf8(BRIDGE_STATE_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.managerProgram.bytes,
  );
  const transceiverConfig = findProgramAddress(
    [utf8(TRANSCEIVER_CONFIG_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.transceiverProgram.bytes,
  );

  const accountKeys = [
    accountMeta("feePayer", normalized.feePayer, true, true),
    accountMeta("mint", normalized.mint, true, true),
    accountMeta("recipientTokenAccount", normalized.recipientTokenAccount, true, true),
    accountMeta("bridgeState", bridgeState, false, true),
    accountMeta("transceiverConfig", transceiverConfig, false, true),
    accountMeta("mintAuthorityPda", mintAuthority, false, false),
    accountMeta("tokenProgram", normalized.tokenProgram, false, false),
    accountMeta("systemProgram", normalized.systemProgram, false, false),
    accountMeta("transceiverProgram", normalized.transceiverProgram, false, false),
    accountMeta("managerProgram", normalized.managerProgram, false, false),
  ];
  requireUniqueAccountKeys(accountKeys);

  const instructions = Object.freeze([
    compiledInstruction(
      "systemCreateMint",
      7,
      [0, 1],
      encodeSystemCreateAccount({
        lamports: normalized.mintRentLamports,
        space: MINT_ACCOUNT_LENGTH,
        program: normalized.tokenProgram,
      }),
    ),
    compiledInstruction(
      "splInitializeMint2",
      6,
      [1],
      encodeInitializeMint2({
        decimals: normalized.decimals,
        mintAuthority,
      }),
    ),
    compiledInstruction(
      "systemCreateRecipientTokenAccount",
      7,
      [0, 2],
      encodeSystemCreateAccount({
        lamports: normalized.tokenAccountRentLamports,
        space: SPL_TOKEN_ACCOUNT_LENGTH,
        program: normalized.tokenProgram,
      }),
    ),
    compiledInstruction(
      "splInitializeRecipientTokenAccount3",
      6,
      [2, 1],
      encodeInitializeAccount3({
        tokenAccountOwner: normalized.recipientTokenAccountOwner,
      }),
    ),
    compiledInstruction(
      "transceiverInitialize",
      8,
      [4, 0, 7],
      encodeTransceiverInitialize({
        transceiverProgram: normalized.transceiverProgram,
        managerProgram: normalized.managerProgram,
        mint: normalized.mint,
        solanaDeployment: normalized.solanaDeployment,
        attesters: normalized.attesters,
        active: normalized.transceiverActive,
        keyEpoch: normalized.keyEpoch,
      }),
    ),
    compiledInstruction(
      "bridgeInitialize",
      9,
      [3, 1, 6, 0, 7],
      encodeBridgeInitialize({
        managerProgram: normalized.managerProgram,
        transceiverProgram: normalized.transceiverProgram,
        solanaDeployment: normalized.solanaDeployment,
        mint: normalized.mint,
        tokenProgram: normalized.tokenProgram,
        mintAuthority,
        decimals: normalized.decimals,
        nativeDecimals: normalized.nativeDecimals,
        initialSupply: normalized.initialSupply,
        policyEpoch: normalized.policyEpoch,
        keyEpoch: normalized.keyEpoch,
        depositsPaused: normalized.depositsPaused,
        withdrawalsPaused: normalized.withdrawalsPaused,
        hardStop: normalized.hardStop,
        mainnetActivationEnabled: false,
      }),
    ),
  ]);
  const messageBytes = encodeLegacyMessageWithInstructions({
    accountKeys: accountKeys.map((account) => account.bytes),
    recentBlockhash: normalized.recentBlockhash.bytes,
    readonlyUnsignedAccounts: 5,
    compiledInstructions: instructions,
  });

  return Object.freeze({
    protocol: LOCALNET_SOLANA_SETUP_PLAN_PROTOCOL,
    setupScope: LOCALNET_SOLANA_SETUP_SCOPE,
    environment: LOCALNET,
    cluster: LOCALNET,
    mainnetActivation: "DISABLED",
    productionReady: false,
    solanaDeploymentHex: normalized.solanaDeployment.hex,
    managerProgramIdBase58: normalized.managerProgram.base58,
    transceiverProgramIdBase58: normalized.transceiverProgram.base58,
    mintBase58: normalized.mint.base58,
    recipientTokenAccountBase58: normalized.recipientTokenAccount.base58,
    recipientTokenAccountOwnerBase58: normalized.recipientTokenAccountOwner.base58,
    feePayerBase58: normalized.feePayer.base58,
    tokenProgramIdBase58: normalized.tokenProgram.base58,
    systemProgramIdBase58: normalized.systemProgram.base58,
    decimals: normalized.decimals,
    nativeDecimals: normalized.nativeDecimals,
    initialSupplyAtomic: normalized.initialSupply,
    freezeAuthority: null,
    mintRentLamports: normalized.mintRentLamports,
    tokenAccountRentLamports: normalized.tokenAccountRentLamports,
    recentBlockhashBase58: normalized.recentBlockhash.base58,
    lastValidBlockHeight: normalized.lastValidBlockHeight,
    policyEpoch: normalized.policyEpoch,
    keyEpoch: normalized.keyEpoch,
    transceiverActive: normalized.transceiverActive,
    depositsPaused: normalized.depositsPaused,
    withdrawalsPaused: normalized.withdrawalsPaused,
    hardStop: normalized.hardStop,
    attesterPublicKeysHex: Object.freeze(normalized.attesters.map((attester) => attester.hex)),
    accounts: Object.freeze(accountKeys.map(publicAccountMeta)),
    pdas: Object.freeze({
      bridgeState: publicPda(bridgeState),
      transceiverConfig: publicPda(transceiverConfig),
      mintAuthority: publicPda(mintAuthority),
    }),
    accountLengths: Object.freeze({
      mint: MINT_ACCOUNT_LENGTH,
      recipientTokenAccount: SPL_TOKEN_ACCOUNT_LENGTH,
    }),
    instructions,
    messageBase64: Buffer.from(messageBytes).toString("base64"),
    messageFingerprintHex: sha256Hex(messageBytes),
    preparedTransactionBase64: undefined,
    preparedTransactionFingerprintHex: undefined,
  });
}

export async function prepareSignedLocalnetSolanaSetupTransaction(config) {
  const plan = buildLocalnetSolanaSetupTransactionPlan(config);
  const signers = [
    ["feePayer", plan.feePayerBase58, requireObject(config?.feePayerSigner, "feePayerSigner")],
    ["mint", plan.mintBase58, requireObject(config?.mintSigner, "mintSigner")],
    [
      "recipientTokenAccount",
      plan.recipientTokenAccountBase58,
      requireObject(config?.recipientTokenAccountSigner, "recipientTokenAccountSigner"),
    ],
  ];
  const messageBytes = Buffer.from(plan.messageBase64, "base64");
  const signatures = [];

  for (const [role, expectedBase58, signer] of signers) {
    const signerPublicKey = normalizeSignerPublicKey(signer);
    if (signerPublicKey.base58 !== expectedBase58) {
      throw new Error(`LocalnetSolanaSetupSignerMismatch:${role}`);
    }
    if (typeof signer.sign !== "function") {
      throw new Error(`LocalnetSolanaSetupSignerMissingSignFunction:${role}`);
    }
    const signature = asBytes(await signer.sign(messageBytes), `${role}Signature`);
    if (signature.length !== 64) {
      throw new Error(`LocalnetSolanaSetupSignatureLengthInvalid:${role}`);
    }
    if (!ed25519.verify(signature, messageBytes, signerPublicKey.bytes)) {
      throw new Error(`LocalnetSolanaSetupSignatureVerificationFailed:${role}`);
    }
    signatures.push(
      Object.freeze({
        role,
        publicKeyBase58: expectedBase58,
        signatureBase58: base58Encode(signature),
      }),
    );
  }

  const transactionBytes = concatBytes([
    shortvecEncode(signatures.length),
    ...signatures.map((item) => base58Decode(item.signatureBase58, `${item.role}.signatureBase58`)),
    messageBytes,
  ]);
  return Object.freeze({
    ...plan,
    signatures: Object.freeze(signatures),
    preparedTransactionBase64: Buffer.from(transactionBytes).toString("base64"),
    preparedTransactionFingerprintHex: sha256Hex(transactionBytes),
  });
}

function normalizeSetupConfig(config) {
  const value = requireObject(config, "config");
  const environment = value.environment ?? LOCALNET;
  const cluster = value.cluster ?? LOCALNET;
  if (environment !== LOCALNET || cluster !== LOCALNET) {
    throw new Error("LocalnetSolanaSetupPlanLocalnetOnly");
  }

  const managerProgram = normalizePubkeyPair(value, "managerProgramIdBase58", "managerProgramIdHex", {
    defaultBase58: LOCALNET_MANAGER_PROGRAM_ID_BASE58,
  });
  const transceiverProgram = normalizePubkeyPair(value, "transceiverProgramIdBase58", "transceiverProgramIdHex", {
    defaultBase58: LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58,
  });
  const tokenProgram = normalizePubkeyPair(value, "tokenProgramIdBase58", "tokenProgramIdHex", {
    defaultBase58: SPL_TOKEN_PROGRAM_ID_BASE58,
  });
  const systemProgram = normalizePubkeyPair(value, "systemProgramIdBase58", "systemProgramIdHex", {
    defaultBase58: SYSTEM_PROGRAM_ID_BASE58,
  });
  if (tokenProgram.base58 !== SPL_TOKEN_PROGRAM_ID_BASE58) {
    throw new Error("LocalnetSolanaSetupPlanRequiresTraditionalSplTokenProgram");
  }
  if (systemProgram.base58 !== SYSTEM_PROGRAM_ID_BASE58) {
    throw new Error("LocalnetSolanaSetupPlanRequiresSystemProgram");
  }

  const mint = normalizePubkeyPair(value, "mintBase58", "mintHex");
  const recipientTokenAccount = normalizePubkeyPair(value, "recipientTokenAccountBase58", "recipientTokenAccountHex");
  const recipientTokenAccountOwner = normalizePubkeyPair(
    value,
    "recipientTokenAccountOwnerBase58",
    "recipientTokenAccountOwnerHex",
  );
  const feePayer = normalizePubkeyPair(value, "feePayerBase58", "feePayerHex");
  const recentBlockhash = normalizePubkeyPair(value, "recentBlockhashBase58", "recentBlockhashHex");
  const solanaDeployment = normalizeHash(value.solanaDeploymentHex, "solanaDeploymentHex");
  const attesters = normalizeAttesters(value.attesterPublicKeysHex);
  const decimals = checkedU8(value.decimals, "decimals");
  const nativeDecimals = checkedU8(value.nativeDecimals, "nativeDecimals");
  if (decimals !== nativeDecimals) {
    throw new Error("LocalnetSolanaSetupPlanDecimalsMismatch");
  }
  const initialSupply = normalizeU128Zero(value.initialSupplyAtomic ?? "0", "initialSupplyAtomic");
  const mintRentLamports = normalizeU64Decimal(value.mintRentLamports, "mintRentLamports");
  const tokenAccountRentLamports = normalizeU64Decimal(value.tokenAccountRentLamports, "tokenAccountRentLamports");
  const policyEpoch = checkedU32(value.policyEpoch, "policyEpoch");
  const keyEpoch = checkedU32(value.keyEpoch, "keyEpoch");
  if (policyEpoch === 0 || keyEpoch === 0) {
    throw new Error("LocalnetSolanaSetupPlanEpochMustBeNonZero");
  }
  const depositsPaused = checkedBoolean(value.depositsPaused ?? false, "depositsPaused");
  const withdrawalsPaused = checkedBoolean(value.withdrawalsPaused ?? false, "withdrawalsPaused");
  const hardStop = checkedBoolean(value.hardStop ?? false, "hardStop");
  if (depositsPaused || withdrawalsPaused || hardStop) {
    throw new Error("LocalnetSolanaSetupPlanMustStartOperationalForLocalE2e");
  }
  if (checkedBoolean(value.mainnetActivationEnabled ?? false, "mainnetActivationEnabled")) {
    throw new Error("LocalnetSolanaSetupPlanMainnetActivationDisabled");
  }
  const transceiverActive = checkedBoolean(value.transceiverActive ?? true, "transceiverActive");
  if (!transceiverActive) {
    throw new Error("LocalnetSolanaSetupPlanTransceiverMustStartActive");
  }
  if (value.freezeAuthorityBase58 !== undefined || value.freezeAuthorityHex !== undefined) {
    throw new Error("LocalnetSolanaSetupPlanFreezeAuthorityMustBeNone");
  }

  for (const [label, item] of [
    ["managerProgram", managerProgram],
    ["transceiverProgram", transceiverProgram],
    ["mint", mint],
    ["recipientTokenAccount", recipientTokenAccount],
    ["recipientTokenAccountOwner", recipientTokenAccountOwner],
    ["feePayer", feePayer],
    ["solanaDeployment", solanaDeployment],
    ["attester0", attesters[0]],
    ["attester1", attesters[1]],
  ]) {
    if (isZeroBytes(item.bytes)) {
      throw new Error(`LocalnetSolanaSetupPlanZeroPubkey:${label}`);
    }
  }

  return Object.freeze({
    environment,
    cluster,
    managerProgram,
    transceiverProgram,
    tokenProgram,
    systemProgram,
    mint,
    recipientTokenAccount,
    recipientTokenAccountOwner,
    feePayer,
    recentBlockhash,
    solanaDeployment,
    attesters,
    decimals,
    nativeDecimals,
    initialSupply,
    mintRentLamports,
    tokenAccountRentLamports,
    lastValidBlockHeight: normalizeU64Decimal(value.lastValidBlockHeight, "lastValidBlockHeight"),
    policyEpoch,
    keyEpoch,
    depositsPaused,
    withdrawalsPaused,
    hardStop,
    transceiverActive,
  });
}

function normalizeAttesters(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("LocalnetSolanaSetupPlanExactlyTwoAttestersRequired");
  }
  const normalized = value.map((item, index) => {
    const bytes = hexToBytes(normalizeHashLike(item, `attesterPublicKeysHex[${index}]`), `attesterPublicKeysHex[${index}]`);
    return pubkeyFromBytes(bytes, `attesterPublicKeysHex[${index}]`);
  });
  if (normalized[0].hex === normalized[1].hex) {
    throw new Error("LocalnetSolanaSetupPlanDuplicateAttester");
  }
  return Object.freeze(normalized);
}

function encodeSystemCreateAccount({ lamports, space, program }) {
  return concatBytes([
    u32Le(SYSTEM_INSTRUCTION_CREATE_ACCOUNT),
    u64Le(lamports),
    u64Le(BigInt(space)),
    program.bytes,
  ]);
}

function encodeInitializeMint2({ decimals, mintAuthority }) {
  const out = concatBytes([
    Uint8Array.of(SPL_TOKEN_INSTRUCTION_INITIALIZE_MINT2, decimals),
    mintAuthority.bytes,
    Uint8Array.of(0),
  ]);
  if (out.length !== 35) {
    throw new Error("LocalnetSolanaSetupInitializeMint2LengthInvalid");
  }
  return out;
}

function encodeInitializeAccount3({ tokenAccountOwner }) {
  const out = concatBytes([Uint8Array.of(SPL_TOKEN_INSTRUCTION_INITIALIZE_ACCOUNT3), tokenAccountOwner.bytes]);
  if (out.length !== 33) {
    throw new Error("LocalnetSolanaSetupInitializeAccount3LengthInvalid");
  }
  return out;
}

function encodeTransceiverInitialize({
  transceiverProgram,
  managerProgram,
  mint,
  solanaDeployment,
  attesters,
  active,
  keyEpoch,
}) {
  const data = concatBytes([
    Uint8Array.of(TRANSCEIVER_INSTRUCTION_INITIALIZE),
    transceiverProgram.bytes,
    managerProgram.bytes,
    mint.bytes,
    solanaDeployment.bytes,
    attesters[0].bytes,
    attesters[1].bytes,
    Uint8Array.of(active ? 1 : 0),
    u32Le(keyEpoch),
  ]);
  if (data.length !== 1 + TRANSCEIVER_CONFIG_INSTRUCTION_LENGTH) {
    throw new Error("LocalnetSolanaSetupTransceiverConfigLengthInvalid");
  }
  return data;
}

function encodeBridgeInitialize({
  managerProgram,
  transceiverProgram,
  solanaDeployment,
  mint,
  tokenProgram,
  mintAuthority,
  decimals,
  nativeDecimals,
  initialSupply,
  policyEpoch,
  keyEpoch,
  depositsPaused,
  withdrawalsPaused,
  hardStop,
  mainnetActivationEnabled,
}) {
  const data = concatBytes([
    Uint8Array.of(BRIDGE_INSTRUCTION_INITIALIZE, 0),
    managerProgram.bytes,
    transceiverProgram.bytes,
    solanaDeployment.bytes,
    mint.bytes,
    tokenProgram.bytes,
    mintAuthority.bytes,
    Uint8Array.of(decimals, nativeDecimals, 0),
    ZERO_32,
    u128Le(initialSupply),
    u32Le(policyEpoch),
    u32Le(keyEpoch),
    Uint8Array.of(
      depositsPaused ? 1 : 0,
      withdrawalsPaused ? 1 : 0,
      hardStop ? 1 : 0,
      mainnetActivationEnabled ? 1 : 0,
    ),
  ]);
  if (data.length !== 1 + BRIDGE_CONFIG_INSTRUCTION_LENGTH) {
    throw new Error("LocalnetSolanaSetupBridgeConfigLengthInvalid");
  }
  return data;
}

function encodeLegacyMessageWithInstructions({
  accountKeys,
  recentBlockhash,
  readonlyUnsignedAccounts,
  compiledInstructions,
}) {
  return concatBytes([
    Uint8Array.of(3, 0, checkedU8Number(readonlyUnsignedAccounts, "readonlyUnsignedAccounts")),
    shortvecEncode(accountKeys.length),
    ...accountKeys,
    recentBlockhash,
    shortvecEncode(compiledInstructions.length),
    ...compiledInstructions.map(encodeCompiledInstruction),
  ]);
}

function compiledInstruction(role, programIdIndex, accountIndexes, data) {
  return Object.freeze({
    role,
    programIdIndex: checkedU8Number(programIdIndex, `${role}.programIdIndex`),
    accountIndexes: Object.freeze(accountIndexes.map((index) => checkedU8Number(index, `${role}.accountIndex`))),
    dataBase64: Buffer.from(data).toString("base64"),
    dataHex: bytesToHex(data),
    dataLength: data.length,
  });
}

function encodeCompiledInstruction(instruction) {
  const data = Buffer.from(instruction.dataBase64, "base64");
  return concatBytes([
    Uint8Array.of(checkedU8Number(instruction.programIdIndex, "instruction.programIdIndex")),
    shortvecEncode(instruction.accountIndexes.length),
    Uint8Array.from(instruction.accountIndexes.map((index) => checkedU8Number(index, "instruction.accountIndex"))),
    shortvecEncode(data.length),
    data,
  ]);
}

function normalizePubkeyPair(config, base58Field, hexField, options = {}) {
  const fromBase58 =
    config[base58Field] === undefined
      ? undefined
      : asPubkeyBytes(base58Decode(config[base58Field], base58Field), base58Field);
  const fromHex =
    config[hexField] === undefined
      ? undefined
      : asPubkeyBytes(hexToBytes(normalizeHashLike(config[hexField], hexField), hexField), hexField);
  const fromDefault =
    options.defaultBase58 === undefined
      ? undefined
      : asPubkeyBytes(base58Decode(options.defaultBase58, `${base58Field}.default`), `${base58Field}.default`);
  const bytes = fromBase58 ?? fromHex ?? fromDefault;
  if (bytes === undefined) {
    throw new Error(`${base58Field}:MissingPubkey`);
  }
  if (fromBase58 !== undefined && fromHex !== undefined && bytesToHex(fromBase58) !== bytesToHex(fromHex)) {
    throw new Error(`${base58Field}:HexBase58Mismatch`);
  }
  return pubkeyFromBytes(bytes, base58Field);
}

function normalizeSignerPublicKey(signer) {
  return normalizePubkeyPair(
    {
      publicKeyBase58: signer.publicKeyBase58,
      publicKeyHex: signer.publicKeyHex,
    },
    "publicKeyBase58",
    "publicKeyHex",
  );
}

function accountMeta(role, publicKey, isSigner, isWritable) {
  return Object.freeze({
    role,
    bytes: publicKey.bytes,
    addressHex: publicKey.hex,
    addressBase58: publicKey.base58,
    isSigner,
    isWritable,
  });
}

function publicAccountMeta(account) {
  return Object.freeze({
    role: account.role,
    addressBase58: account.addressBase58,
    addressHex: account.addressHex,
    isSigner: account.isSigner,
    isWritable: account.isWritable,
  });
}

function publicPda(pda) {
  return Object.freeze({
    addressBase58: pda.base58,
    addressHex: pda.hex,
    bump: pda.bump,
  });
}

function pubkeyFromBytes(bytes, label) {
  const normalized = asPubkeyBytes(bytes, label);
  return Object.freeze({
    bytes: normalized,
    hex: bytesToHex(normalized),
    base58: base58Encode(normalized),
  });
}

function requireUniqueAccountKeys(accounts) {
  const seen = new Set();
  for (const account of accounts) {
    if (seen.has(account.addressBase58)) {
      throw new Error(`LocalnetSolanaSetupAccountKeyCollision:${account.role}`);
    }
    seen.add(account.addressBase58);
  }
}

function normalizeHash(value, label) {
  const bytes = hexToBytes(normalizeHashLike(value, label), label);
  return Object.freeze({
    bytes,
    hex: bytesToHex(bytes),
  });
}

function normalizeHashLike(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function normalizeU128Zero(value, label) {
  const bigint = decimalToBigInt(value, label);
  if (bigint !== 0n) {
    throw new Error("LocalnetSolanaSetupPlanInitialSupplyMustBeZero");
  }
  return "0";
}

function normalizeU64Decimal(value, label) {
  const bigint = decimalToBigInt(value, label);
  if (bigint < 0n || bigint > MAX_U64) {
    throw new Error(`${label}:ExpectedU64Decimal`);
  }
  return bigint.toString();
}

function decimalToBigInt(value, label) {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}:ExpectedExactUnsignedInteger`);
    }
    return BigInt(value);
  }
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedDecimalString`);
  }
  return BigInt(value);
}

function checkedU32(value, label) {
  const bigint = decimalToBigInt(value, label);
  if (bigint < 0n || bigint > MAX_U32) {
    throw new Error(`${label}:ExpectedU32`);
  }
  return Number(bigint);
}

function checkedU8(value, label) {
  const bigint = decimalToBigInt(value, label);
  if (bigint < 0n || bigint > MAX_U8) {
    throw new Error(`${label}:ExpectedU8`);
  }
  return Number(bigint);
}

function checkedU8Number(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`${label}:ExpectedU8`);
  }
  return value;
}

function checkedBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label}:ExpectedBoolean`);
  }
  return value;
}

function u32Le(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(Number(checkedU32(value, "u32")), 0);
  return out;
}

function u64Le(value) {
  const bigint = typeof value === "string" ? BigInt(value) : value;
  if (bigint < 0n || bigint > MAX_U64) {
    throw new Error("u64:ExpectedU64");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(bigint, 0);
  return out;
}

function u128Le(value) {
  let bigint = decimalToBigInt(value, "u128");
  const out = Buffer.alloc(16);
  for (let index = 0; index < 16; index += 1) {
    out[index] = Number(bigint & 0xffn);
    bigint >>= 8n;
  }
  if (bigint !== 0n) {
    throw new Error("u128:Overflow");
  }
  return out;
}

function isZeroBytes(value) {
  return value.every((byte) => byte === 0);
}

function asPubkeyBytes(input, label) {
  const bytes = asBytes(input, label);
  if (bytes.length !== 32) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return bytes;
}

function asBytes(input, label) {
  if (input instanceof Uint8Array) {
    return input;
  }
  throw new Error(`${label}:ExpectedBytes`);
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function sha256Hex(bytes) {
  return bytesToHex(new Uint8Array(createHash("sha256").update(bytes).digest()));
}

function utf8(value) {
  return Buffer.from(value, "utf8");
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}
