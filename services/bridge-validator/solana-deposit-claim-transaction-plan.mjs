import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import {
  ATTESTATION_MODE,
  ATTESTATION_PROTOCOL,
  verifyProjectAttestation,
} from "../attesters/attestation-service.mjs";

export const SOLANA_DEPOSIT_CLAIM_TRANSACTION_PLAN_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/SOLANA_DEPOSIT_CLAIM_TRANSACTION_PLAN/V1";

export const BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM = 2;
export const TRANSCEIVER_INSTRUCTION_VERIFY_MESSAGE_FROM_ED25519 = 2;
export const BRIDGE_STATE_PDA_SEED_PREFIX = "kingpepe-bridge-state";
export const DEPOSIT_CLAIM_PDA_SEED_PREFIX = "kingpepe-deposit-claim";
export const DEPOSIT_BACKING_PDA_SEED_PREFIX = "kingpepe-deposit-backing";
export const MINT_AUTHORITY_PDA_SEED_PREFIX = "kingpepe-mint-authority";
export const TRANSCEIVER_CONFIG_PDA_SEED_PREFIX = "kingpepe-transceiver-config";
export const TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX = "kingpepe-transceiver-receipt";

const LOCALNET = "localnet";
const ED25519_PROGRAM_ID_HEX = "037d46d67c93fbbe12f9428f838d40ff0570744927f48a64fcca704480000000";
const ED25519_INSTRUCTION_HEADER_LENGTH = 16;
const ED25519_SIGNATURE_LENGTH = 64;
const ED25519_PUBLIC_KEY_LENGTH = 32;
const INSTRUCTIONS_SYSVAR_ID_BASE58 = "Sysvar1nstructions1111111111111111111111111";
const SYSTEM_PROGRAM_ID_BASE58 = "11111111111111111111111111111111";
const COMPUTE_BUDGET_PROGRAM_ID_BASE58 = "ComputeBudget111111111111111111111111111111";
export const LOCALNET_DEPOSIT_COMPUTE_UNIT_LIMIT = 600_000;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(Array.from(BASE58_ALPHABET, (character, index) => [character, index]));
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/u;
const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const SOLANA_PDA_MARKER = Buffer.from("ProgramDerivedAddress", "utf8");
export const SOLANA_MAX_TRANSACTION_BYTES = 1232;

export function buildLocalnetSolanaDepositClaimTransactionPlan(config) {
  const normalized = normalizePlanConfig(config);
  const decodedMessage = decodeCanonicalBridgeMessage(normalized.encodedMessageBytes);
  validateDepositClaimMessageDomain(normalized, decodedMessage);

  const bridgeState = findProgramAddress(
    [utf8(BRIDGE_STATE_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.managerProgram.bytes,
  );
  const depositClaim = findProgramAddress(
    [utf8(DEPOSIT_CLAIM_PDA_SEED_PREFIX), hexToBytes(decodedMessage.operationIdHex, "operationIdHex")],
    normalized.managerProgram.bytes,
  );
  const mintAuthority = findProgramAddress(
    [utf8(MINT_AUTHORITY_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.managerProgram.bytes,
  );
  const outputIndex = Buffer.alloc(4);
  outputIndex.writeUInt32LE(decodedMessage.depositOutpoint.vout);
  const depositBacking = findProgramAddress(
    [utf8(DEPOSIT_BACKING_PDA_SEED_PREFIX), normalized.mint.bytes,
      decodedMessage.deployment.nativeGenesis, decodedMessage.depositOutpoint.txid, outputIndex],
    normalized.managerProgram.bytes,
  );
  const verifiedReceipt = findProgramAddress(
    [utf8(TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX), hexToBytes(decodedMessage.messageDigestHex, "messageDigestHex")],
    normalized.transceiverProgram.bytes,
  );

  const accountKeys = [
    accountMeta("feePayer", normalized.feePayer, true, true),
    accountMeta("bridgeState", bridgeState, false, true),
    accountMeta("depositClaim", depositClaim, false, true),
    accountMeta("mint", normalized.mint, false, true),
    accountMeta("recipientTokenAccount", normalized.recipientTokenAccount, false, true),
    accountMeta("depositBacking", depositBacking, false, true),
    accountMeta("verifiedReceipt", verifiedReceipt, false, false),
    accountMeta("mintAuthorityPda", mintAuthority, false, false),
    accountMeta("tokenProgram", normalized.tokenProgram, false, false),
    accountMeta("transceiverProgram", normalized.transceiverProgram, false, false),
    accountMeta("managerProgram", normalized.managerProgram, false, false),
    accountMeta("systemProgram", pubkeyFromBytes(base58Decode(SYSTEM_PROGRAM_ID_BASE58), "systemProgram"), false, false),
    accountMeta("computeBudgetProgram", pubkeyFromBytes(base58Decode(COMPUTE_BUDGET_PROGRAM_ID_BASE58), "computeBudgetProgram"), false, false),
  ];
  requireUniqueAccountKeys(accountKeys);

  const instructionData = concatBytes([
    Uint8Array.of(BRIDGE_INSTRUCTION_ACCEPT_DEPOSIT_CLAIM),
    normalized.encodedMessageBytes,
  ]);
  const compiledInstruction = Object.freeze({
    programIdIndex: 10,
    accountIndexes: Object.freeze([1, 2, 6, 3, 4, 7, 8, 9, 5, 0, 11]),
    dataBase64: Buffer.from(instructionData).toString("base64"),
    dataHex: bytesToHex(instructionData),
  });
  const messageBytes = encodeLegacyMessage({
    accountKeys: accountKeys.map((account) => account.bytes),
    recentBlockhash: normalized.recentBlockhash.bytes,
    compiledInstruction,
  });

  return Object.freeze({
    protocol: SOLANA_DEPOSIT_CLAIM_TRANSACTION_PLAN_PROTOCOL,
    environment: LOCALNET,
    cluster: LOCALNET,
    operationIdHex: decodedMessage.operationIdHex,
    messageDigestHex: decodedMessage.messageDigestHex,
    amountAtomic: decodedMessage.amountAtomic.toString(),
    solanaRecipientHex: decodedMessage.destinationHex,
    recentBlockhashBase58: normalized.recentBlockhash.base58,
    lastValidBlockHeight: normalized.lastValidBlockHeight,
    managerProgramIdBase58: normalized.managerProgram.base58,
    transceiverProgramIdBase58: normalized.transceiverProgram.base58,
    mintBase58: normalized.mint.base58,
    feePayerBase58: normalized.feePayer.base58,
    accounts: Object.freeze(accountKeys.map(publicAccountMeta)),
    pdas: Object.freeze({
      bridgeState: publicPda(bridgeState),
      depositClaim: publicPda(depositClaim),
      depositBacking: publicPda(depositBacking),
      mintAuthority: publicPda(mintAuthority),
      verifiedReceipt: publicPda(verifiedReceipt),
    }),
    instruction: compiledInstruction,
    messageBase64: Buffer.from(messageBytes).toString("base64"),
    messageFingerprintHex: sha256Hex(messageBytes),
    preparedTransactionBase64: undefined,
    preparedTransactionFingerprintHex: undefined,
  });
}

export function buildLocalnetSolanaDepositReceiptTransactionPlan(config) {
  const normalized = normalizePlanConfig(config);
  const decodedMessage = decodeCanonicalBridgeMessage(normalized.encodedMessageBytes);
  validateDepositClaimMessageDomain(normalized, decodedMessage);
  const attestations = normalizeBundleAttestations(config?.attestations, normalized.encodedMessageBytes, decodedMessage);

  const bridgeState = findProgramAddress(
    [utf8(BRIDGE_STATE_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.managerProgram.bytes,
  );
  const depositClaim = findProgramAddress(
    [utf8(DEPOSIT_CLAIM_PDA_SEED_PREFIX), hexToBytes(decodedMessage.operationIdHex, "operationIdHex")],
    normalized.managerProgram.bytes,
  );
  const mintAuthority = findProgramAddress(
    [utf8(MINT_AUTHORITY_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.managerProgram.bytes,
  );
  const transceiverConfig = findProgramAddress(
    [utf8(TRANSCEIVER_CONFIG_PDA_SEED_PREFIX), normalized.mint.bytes],
    normalized.transceiverProgram.bytes,
  );
  const verifiedReceipt = findProgramAddress(
    [utf8(TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX), hexToBytes(decodedMessage.messageDigestHex, "messageDigestHex")],
    normalized.transceiverProgram.bytes,
  );
  const instructionsSysvar = normalizePubkeyPair(
    { instructionsSysvarBase58: INSTRUCTIONS_SYSVAR_ID_BASE58 },
    "instructionsSysvarBase58",
    "instructionsSysvarHex",
  );
  const systemProgram = normalizePubkeyPair(
    { systemProgramBase58: SYSTEM_PROGRAM_ID_BASE58 },
    "systemProgramBase58",
    "systemProgramHex",
  );
  const ed25519Program = pubkeyFromBytes(hexToBytes(ED25519_PROGRAM_ID_HEX, "ed25519ProgramId"), "ed25519Program");

  const accountKeys = [
    accountMeta("feePayer", normalized.feePayer, true, true),
    accountMeta("verifiedReceipt", verifiedReceipt, false, true),
    accountMeta("transceiverConfig", transceiverConfig, false, false),
    accountMeta("instructionsSysvar", instructionsSysvar, false, false),
    accountMeta("systemProgram", systemProgram, false, false),
    accountMeta("ed25519Program", ed25519Program, false, false),
    accountMeta("transceiverProgram", normalized.transceiverProgram, false, false),
    accountMeta("computeBudgetProgram", pubkeyFromBytes(base58Decode(COMPUTE_BUDGET_PROGRAM_ID_BASE58), "computeBudgetProgram"), false, false),
  ];
  requireUniqueAccountKeys(accountKeys);

  const attestationInstructions = attestations.map((attestation, index) =>
    Object.freeze({
      role: `ed25519Attestation${index + 1}`,
      programIdIndex: 5,
      accountIndexes: Object.freeze([]),
      dataBase64: Buffer.from(
        encodeEd25519VerifierInstruction({
          instructionIndex: index,
          signatureHex: attestation.signatureHex,
          publicKeyHex: attestation.attesterPublicKeyHex,
          messageBytes: normalized.encodedMessageBytes,
        }),
      ).toString("base64"),
      dataHex: bytesToHex(
        encodeEd25519VerifierInstruction({
          instructionIndex: index,
          signatureHex: attestation.signatureHex,
          publicKeyHex: attestation.attesterPublicKeyHex,
          messageBytes: normalized.encodedMessageBytes,
        }),
      ),
      attesterPublicKeyHex: attestation.attesterPublicKeyHex,
      instructionIndex: index,
    }),
  );
  const transceiverInstructionData = concatBytes([
    Uint8Array.of(TRANSCEIVER_INSTRUCTION_VERIFY_MESSAGE_FROM_ED25519),
    normalized.encodedMessageBytes,
    u16Le(0),
    u16Le(1),
  ]);
  const transceiverInstruction = Object.freeze({
    role: "transceiverVerifyMessageFromEd25519",
    programIdIndex: 6,
    accountIndexes: Object.freeze([2, 1, 3, 0, 4]),
    dataBase64: Buffer.from(transceiverInstructionData).toString("base64"),
    dataHex: bytesToHex(transceiverInstructionData),
  });
  const compiledInstructions = Object.freeze([
    ...attestationInstructions,
    transceiverInstruction,
    computeBudgetInstruction(7),
  ]);
  const messageBytes = encodeLegacyMessageWithInstructions({
    accountKeys: accountKeys.map((account) => account.bytes),
    recentBlockhash: normalized.recentBlockhash.bytes,
    readonlyUnsignedAccounts: 6,
    compiledInstructions,
  });

  return Object.freeze({
    protocol: SOLANA_DEPOSIT_CLAIM_TRANSACTION_PLAN_PROTOCOL,
    environment: LOCALNET,
    cluster: LOCALNET,
    bundle: "ED25519_ATTESTATIONS_TRANSCEIVER_RECEIPT",
    operationIdHex: decodedMessage.operationIdHex,
    messageDigestHex: decodedMessage.messageDigestHex,
    amountAtomic: decodedMessage.amountAtomic.toString(),
    solanaRecipientHex: decodedMessage.destinationHex,
    recentBlockhashBase58: normalized.recentBlockhash.base58,
    lastValidBlockHeight: normalized.lastValidBlockHeight,
    managerProgramIdBase58: normalized.managerProgram.base58,
    transceiverProgramIdBase58: normalized.transceiverProgram.base58,
    mintBase58: normalized.mint.base58,
    feePayerBase58: normalized.feePayer.base58,
    accounts: Object.freeze(accountKeys.map(publicAccountMeta)),
    pdas: Object.freeze({
      bridgeState: publicPda(bridgeState),
      depositClaim: publicPda(depositClaim),
      mintAuthority: publicPda(mintAuthority),
      transceiverConfig: publicPda(transceiverConfig),
      verifiedReceipt: publicPda(verifiedReceipt),
    }),
    instructions: compiledInstructions,
    instruction: transceiverInstruction,
    messageBase64: Buffer.from(messageBytes).toString("base64"),
    messageFingerprintHex: sha256Hex(messageBytes),
    preparedTransactionBase64: undefined,
    preparedTransactionFingerprintHex: undefined,
  });
}

export async function prepareSignedLocalnetSolanaDepositClaimTransaction(config) {
  return signTransactionPlan(buildLocalnetSolanaDepositClaimTransactionPlan(config), config);
}

export async function prepareSignedLocalnetSolanaDepositReceiptTransaction(config) {
  return signTransactionPlan(buildLocalnetSolanaDepositReceiptTransactionPlan(config), config);
}

async function signTransactionPlan(plan, config) {
  const signer = requireObject(config?.feePayerSigner, "feePayerSigner");
  const signerPublicKey = normalizePubkeyPair(
    {
      feePayerSignerPublicKeyBase58: signer.publicKeyBase58,
      feePayerSignerPublicKeyHex: signer.publicKeyHex,
    },
    "feePayerSignerPublicKeyBase58",
    "feePayerSignerPublicKeyHex",
  );
  if (signerPublicKey.base58 !== plan.feePayerBase58) {
    throw new Error("SolanaDepositClaimFeePayerSignerMismatch");
  }
  if (typeof signer.sign !== "function") {
    throw new Error("SolanaDepositClaimSignerMissingSignFunction");
  }

  const messageBytes = Buffer.from(plan.messageBase64, "base64");
  // Include shortvec signature count and the one fee-payer signature before
  // invoking the signer. Oversized packets must never reach the RPC transport.
  if (1 + ED25519_SIGNATURE_LENGTH + messageBytes.length > SOLANA_MAX_TRANSACTION_BYTES) {
    throw new Error("SolanaTransactionPacketLimitExceeded");
  }
  const signature = asBytes(await signer.sign(messageBytes), "feePayerSignature");
  if (signature.length !== 64) {
    throw new Error("SolanaDepositClaimSignatureLengthInvalid");
  }
  if (!ed25519.verify(signature, messageBytes, signerPublicKey.bytes)) {
    throw new Error("SolanaDepositClaimSignatureVerificationFailed");
  }

  const transactionBytes = concatBytes([shortvecEncode(1), signature, messageBytes]);
  return Object.freeze({
    ...plan,
    signatures: Object.freeze([
      Object.freeze({
        publicKeyBase58: plan.feePayerBase58,
        signatureBase58: base58Encode(signature),
      }),
    ]),
    preparedTransactionBase64: Buffer.from(transactionBytes).toString("base64"),
    preparedTransactionFingerprintHex: sha256Hex(transactionBytes),
  });
}
export function findProgramAddress(seeds, programIdBytes) {
  const programId = asPubkeyBytes(programIdBytes, "programId");
  for (let bump = 255; bump >= 0; bump -= 1) {
    const seedBytes = [...seeds.map((seed, index) => normalizeSeed(seed, `seed${index}`)), Uint8Array.of(bump)];
    const candidate = createProgramAddress(seedBytes, programId);
    if (candidate !== null) {
      return Object.freeze({
        bytes: candidate,
        hex: bytesToHex(candidate),
        base58: base58Encode(candidate),
        bump,
      });
    }
  }
  throw new Error("SolanaProgramAddressNotFound");
}

export function createProgramAddress(seeds, programIdBytes) {
  const programId = asPubkeyBytes(programIdBytes, "programId");
  const seedBytes = seeds.map((seed, index) => normalizeSeed(seed, `seed${index}`));
  const candidate = sha256Bytes(concatBytes([...seedBytes, programId, SOLANA_PDA_MARKER]));
  return isEd25519Point(candidate) ? null : candidate;
}

export function base58Encode(input) {
  const bytes = asBytes(input, "base58Input");
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) {
    zeroes += 1;
  }
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }
  return "1".repeat(zeroes) + encoded;
}

export function base58Decode(value, label = "base58") {
  if (typeof value !== "string" || !BASE58_PATTERN.test(value)) {
    throw new Error(`${label}:InvalidBase58`);
  }
  let zeroes = 0;
  while (zeroes < value.length && value[zeroes] === "1") {
    zeroes += 1;
  }
  let decoded = 0n;
  for (const character of value) {
    const index = BASE58_INDEX.get(character);
    if (index === undefined) {
      throw new Error(`${label}:InvalidBase58`);
    }
    decoded = decoded * 58n + BigInt(index);
  }
  const bytes = [];
  while (decoded > 0n) {
    bytes.unshift(Number(decoded & 0xffn));
    decoded >>= 8n;
  }
  return Uint8Array.from([...Array.from({ length: zeroes }, () => 0), ...bytes]);
}

export function shortvecEncode(length) {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new Error("ShortvecLengthInvalid");
  }
  const out = [];
  let remaining = length;
  for (;;) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    byte |= 0x80;
    out.push(byte);
  }
}

function normalizePlanConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("MissingSolanaDepositClaimTransactionPlanConfig");
  }
  if ((config.environment ?? LOCALNET) !== LOCALNET || (config.cluster ?? LOCALNET) !== LOCALNET) {
    throw new Error("SolanaDepositClaimTransactionPlanLocalnetOnly");
  }
  const managerProgram = normalizePubkeyPair(config, "managerProgramIdBase58", "managerProgramIdHex");
  const transceiverProgram = normalizePubkeyPair(config, "transceiverProgramIdBase58", "transceiverProgramIdHex");
  const mint = normalizePubkeyPair(config, "mintBase58", "mintHex");
  const tokenProgram = normalizePubkeyPair(config, "tokenProgramIdBase58", "tokenProgramIdHex");
  const feePayer = normalizePubkeyPair(config, "feePayerBase58", "feePayerHex");
  const recipientTokenAccount = normalizePubkeyPair(
    config,
    "recipientTokenAccountBase58",
    "recipientTokenAccountHex",
  );
  const recentBlockhash = normalizePubkeyPair(config, "recentBlockhashBase58", "recentBlockhashHex");
  return Object.freeze({
    managerProgram,
    transceiverProgram,
    mint,
    tokenProgram,
    feePayer,
    recipientTokenAccount,
    recentBlockhash,
    encodedMessageBytes: hexToBytes(normalizeHexBytes(config.encodedMessageHex, "encodedMessageHex"), "encodedMessageHex"),
    lastValidBlockHeight: normalizeDecimal(config.lastValidBlockHeight, "lastValidBlockHeight"),
  });
}

function validateDepositClaimMessageDomain(config, message) {
  if (message.action !== "DepositClaim" || message.direction !== "NativeToSolana") {
    throw new Error("SolanaDepositClaimWrongMessageKind");
  }
  const managerProgramIdHex = bytesToHex(message.deployment.managerProgramId);
  const transceiverProgramIdHex = bytesToHex(message.deployment.transceiverProgramId);
  const mintHex = bytesToHex(message.deployment.mint);
  if (managerProgramIdHex !== config.managerProgram.hex) {
    throw new Error("SolanaDepositClaimManagerProgramMismatch");
  }
  if (transceiverProgramIdHex !== config.transceiverProgram.hex) {
    throw new Error("SolanaDepositClaimTransceiverProgramMismatch");
  }
  if (mintHex !== config.mint.hex) {
    throw new Error("SolanaDepositClaimMintMismatch");
  }
  if (message.destinationHex !== config.recipientTokenAccount.hex) {
    throw new Error("SolanaDepositClaimRecipientMismatch");
  }
}

function encodeLegacyMessage({ accountKeys, recentBlockhash, compiledInstruction }) {
  return encodeLegacyMessageWithInstructions({
    accountKeys,
    recentBlockhash,
    readonlyUnsignedAccounts: 7,
    compiledInstructions: [compiledInstruction, computeBudgetInstruction(12)],
  });
}

function encodeLegacyMessageWithInstructions({
  accountKeys,
  recentBlockhash,
  readonlyUnsignedAccounts,
  compiledInstructions,
}) {
  return concatBytes([
    Uint8Array.of(1, 0, checkedU8(readonlyUnsignedAccounts, "readonlyUnsignedAccounts")),
    shortvecEncode(accountKeys.length),
    ...accountKeys,
    recentBlockhash,
    shortvecEncode(compiledInstructions.length),
    ...compiledInstructions.map(encodeCompiledInstruction),
  ]);
}

function computeBudgetInstruction(programIdIndex) {
  const data = Buffer.alloc(5);
  data[0] = 2; // Compute Budget: SetComputeUnitLimit, little-endian u32.
  data.writeUInt32LE(LOCALNET_DEPOSIT_COMPUTE_UNIT_LIMIT, 1);
  return Object.freeze({
    role: "localnetComputeUnitLimit", programIdIndex, accountIndexes: Object.freeze([]),
    dataBase64: data.toString("base64"), dataHex: data.toString("hex"),
  });
}

function encodeCompiledInstruction(instruction) {
  const data = Buffer.from(instruction.dataBase64, "base64");
  return concatBytes([
    Uint8Array.of(checkedU8(instruction.programIdIndex, "instruction.programIdIndex")),
    shortvecEncode(instruction.accountIndexes.length),
    Uint8Array.from(instruction.accountIndexes.map((index) => checkedU8(index, "instruction.accountIndex"))),
    shortvecEncode(data.length),
    data,
  ]);
}

function normalizePubkeyPair(config, base58Field, hexField) {
  const fromBase58 =
    config[base58Field] === undefined ? undefined : asPubkeyBytes(base58Decode(config[base58Field], base58Field), base58Field);
  const fromHex =
    config[hexField] === undefined ? undefined : asPubkeyBytes(hexToBytes(normalizeHashLike(config[hexField], hexField), hexField), hexField);
  const bytes = fromBase58 ?? fromHex;
  if (bytes === undefined) {
    throw new Error(`${base58Field}:MissingPubkey`);
  }
  if (fromBase58 !== undefined && fromHex !== undefined && bytesToHex(fromBase58) !== bytesToHex(fromHex)) {
    throw new Error(`${base58Field}:HexBase58Mismatch`);
  }
  return Object.freeze({
    bytes,
    hex: bytesToHex(bytes),
    base58: base58Encode(bytes),
  });
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
      throw new Error(`SolanaDepositClaimAccountKeyCollision:${account.role}`);
    }
    seen.add(account.addressBase58);
  }
}

function normalizeBundleAttestations(attestations, encodedMessageBytes, message) {
  if (!Array.isArray(attestations) || attestations.length !== 2) {
    throw new Error("SolanaDepositClaimBundleExactlyTwoAttestationsRequired");
  }
  const encodedMessageHex = bytesToHex(encodedMessageBytes);
  const seen = new Set();
  return Object.freeze(
    attestations.map((attestation, index) => {
      const value = requireObject(attestation, `attestations[${index}]`);
      const publicKeyHex = normalizeHashLike(value.attesterPublicKeyHex, `attestations[${index}].attesterPublicKeyHex`);
      const signatureHex = normalizeFixedHex(value.signatureHex, `attestations[${index}].signatureHex`, ED25519_SIGNATURE_LENGTH);
      if (seen.has(publicKeyHex)) {
        throw new Error("SolanaDepositClaimBundleDuplicateAttester");
      }
      if (
        value.protocol !== ATTESTATION_PROTOCOL ||
        value.mode !== ATTESTATION_MODE ||
        value.operationIdHex !== message.operationIdHex ||
        value.messageDigestHex !== message.messageDigestHex ||
        value.keyEpoch !== message.keyEpoch ||
        value.policyEpoch !== message.policyEpoch ||
        !verifyProjectAttestation(value, encodedMessageHex)
      ) {
        throw new Error("SolanaDepositClaimBundleInvalidAttestation");
      }
      seen.add(publicKeyHex);
      return Object.freeze({
        attesterPublicKeyHex: publicKeyHex,
        signatureHex,
      });
    }),
  );
}

function encodeEd25519VerifierInstruction({
  instructionIndex,
  signatureHex,
  publicKeyHex,
  messageBytes,
}) {
  const signature = hexToBytes(normalizeFixedHex(signatureHex, "signatureHex", ED25519_SIGNATURE_LENGTH), "signatureHex");
  const publicKey = hexToBytes(normalizeFixedHex(publicKeyHex, "publicKeyHex", ED25519_PUBLIC_KEY_LENGTH), "publicKeyHex");
  const message = asBytes(messageBytes, "messageBytes");
  const signatureOffset = ED25519_INSTRUCTION_HEADER_LENGTH;
  const publicKeyOffset = signatureOffset + ED25519_SIGNATURE_LENGTH;
  // Both verifiers sign the exact canonical bytes starting after the tag of
  // transceiver instruction 2. Do not duplicate the 514-byte message per key.
  const messageOffset = 1;
  return concatBytes([
    Uint8Array.of(1, 0),
    u16Le(signatureOffset),
    u16Le(instructionIndex),
    u16Le(publicKeyOffset),
    u16Le(instructionIndex),
    u16Le(messageOffset),
    u16Le(message.length),
    u16Le(2),
    signature,
    publicKey,
  ]);
}

function u16Le(value) {
  const checked = checkedInteger(value, "u16", 0, 0xffff);
  const out = Buffer.alloc(2);
  out.writeUInt16LE(checked, 0);
  return out;
}

function isEd25519Point(bytes) {
  try {
    ed25519.Point.fromHex(bytesToHex(bytes));
    return true;
  } catch {
    return false;
  }
}

function normalizeSeed(seed, label) {
  const bytes = asBytes(seed, label);
  if (bytes.length > 32) {
    throw new Error(`${label}:SeedTooLong`);
  }
  return bytes;
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

function normalizeHashLike(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function normalizeFixedHex(value, label, byteLength) {
  const normalized = normalizeHex(value, label);
  if (normalized.length !== byteLength * 2) {
    throw new Error(`${label}:Expected${byteLength}Bytes`);
  }
  return normalized;
}

function normalizeHexBytes(value, label) {
  return normalizeHex(value, label);
}

function normalizeDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedDecimalString`);
  }
  return value;
}

function checkedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}:ExpectedInteger`);
  }
  return value;
}

function checkedU8(value, label) {
  return checkedInteger(value, label, 0, 0xff);
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

function sha256Bytes(bytes) {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function sha256Hex(bytes) {
  return bytesToHex(sha256Bytes(bytes));
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
