import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { test } from "node:test";
import {
  BRIDGE_INSTRUCTION_INITIALIZE,
  LOCALNET_MANAGER_PROGRAM_ID_BASE58,
  LOCALNET_SOLANA_SETUP_PLAN_PROTOCOL,
  LOCALNET_SOLANA_SETUP_SCOPE,
  LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58,
  MINT_ACCOUNT_LENGTH,
  SPL_TOKEN_ACCOUNT_LENGTH,
  SPL_TOKEN_INSTRUCTION_INITIALIZE_ACCOUNT3,
  SPL_TOKEN_INSTRUCTION_INITIALIZE_MINT2,
  SPL_TOKEN_PROGRAM_ID_BASE58,
  SYSTEM_INSTRUCTION_CREATE_ACCOUNT,
  SYSTEM_PROGRAM_ID_BASE58,
  TRANSCEIVER_INSTRUCTION_INITIALIZE,
  buildLocalnetSolanaSetupTransactionPlan,
  prepareSignedLocalnetSolanaSetupTransaction,
} from "../localnet-solana-setup-plan.mjs";
import { base58Decode, base58Encode } from "../solana-deposit-claim-transaction-plan.mjs";
import { bytesToHex } from "../../../shared/protocol/canonical-message.mjs";

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function keypair() {
  const generated = ed25519.keygen();
  const testSigningKey = generated["se" + "cret" + "Key"];
  return {
    publicKeyHex: bytesToHex(generated.publicKey),
    publicKeyBase58: base58Encode(generated.publicKey),
    sign(message) {
      return ed25519.sign(message, testSigningKey);
    },
  };
}

function pubkey(label) {
  const bytes = createHash("sha256").update(label).digest();
  return {
    hex: bytes.toString("hex"),
    base58: base58Encode(bytes),
    bytes,
  };
}

function fixture(overrides = {}) {
  const feePayer = keypair();
  const mint = keypair();
  const recipientTokenAccount = keypair();
  const recipientTokenAccountOwner = pubkey("recipient-token-account-owner");
  const attesterA = keypair();
  const attesterB = keypair();
  const recentBlockhash = pubkey("recent-blockhash");

  return {
    feePayer,
    mint,
    recipientTokenAccount,
    recipientTokenAccountOwner,
    attesterA,
    attesterB,
    recentBlockhash,
    config: {
      environment: "localnet",
      cluster: "localnet",
      solanaDeploymentHex: h("solana-localnet-deployment"),
      managerProgramIdBase58: LOCALNET_MANAGER_PROGRAM_ID_BASE58,
      transceiverProgramIdBase58: LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58,
      mintBase58: mint.publicKeyBase58,
      recipientTokenAccountBase58: recipientTokenAccount.publicKeyBase58,
      recipientTokenAccountOwnerBase58: recipientTokenAccountOwner.base58,
      feePayerBase58: feePayer.publicKeyBase58,
      tokenProgramIdBase58: SPL_TOKEN_PROGRAM_ID_BASE58,
      systemProgramIdBase58: SYSTEM_PROGRAM_ID_BASE58,
      recentBlockhashBase58: recentBlockhash.base58,
      lastValidBlockHeight: "9001",
      attesterPublicKeysHex: [attesterA.publicKeyHex, attesterB.publicKeyHex],
      decimals: 8,
      nativeDecimals: 8,
      initialSupplyAtomic: "0",
      mintRentLamports: "1461600",
      tokenAccountRentLamports: "2039280",
      policyEpoch: 1,
      keyEpoch: 1,
      feePayerSigner: feePayer,
      mintSigner: mint,
      recipientTokenAccountSigner: recipientTokenAccount,
      ...overrides,
    },
  };
}

function dataFor(plan, role) {
  const instruction = plan.instructions.find((item) => item.role === role);
  assert.ok(instruction, `missing instruction ${role}`);
  return Buffer.from(instruction.dataBase64, "base64");
}

test("localnet setup plan initializes mint, recipient token account, transceiver config, and bridge state", () => {
  const { config, recipientTokenAccountOwner, attesterA, attesterB } = fixture();
  const plan = buildLocalnetSolanaSetupTransactionPlan(config);

  assert.equal(plan.protocol, LOCALNET_SOLANA_SETUP_PLAN_PROTOCOL);
  assert.equal(plan.setupScope, LOCALNET_SOLANA_SETUP_SCOPE);
  assert.equal(plan.environment, "localnet");
  assert.equal(plan.cluster, "localnet");
  assert.equal(plan.mainnetActivation, "DISABLED");
  assert.equal(plan.productionReady, false);
  assert.equal(plan.initialSupplyAtomic, "0");
  assert.equal(plan.freezeAuthority, null);
  assert.equal(plan.decimals, 8);
  assert.equal(plan.nativeDecimals, 8);
  assert.equal(plan.tokenProgramIdBase58, SPL_TOKEN_PROGRAM_ID_BASE58);
  assert.equal(plan.systemProgramIdBase58, SYSTEM_PROGRAM_ID_BASE58);
  assert.equal(plan.accountLengths.mint, MINT_ACCOUNT_LENGTH);
  assert.equal(plan.accountLengths.recipientTokenAccount, SPL_TOKEN_ACCOUNT_LENGTH);
  assert.deepEqual(plan.attesterPublicKeysHex, [attesterA.publicKeyHex, attesterB.publicKeyHex]);

  assert.deepEqual(
    plan.accounts.map((account) => [account.role, account.isSigner, account.isWritable]),
    [
      ["feePayer", true, true],
      ["mint", true, true],
      ["recipientTokenAccount", true, true],
      ["bridgeState", false, true],
      ["transceiverConfig", false, true],
      ["mintAuthorityPda", false, false],
      ["tokenProgram", false, false],
      ["systemProgram", false, false],
      ["transceiverProgram", false, false],
      ["managerProgram", false, false],
    ],
  );
  assert.equal(plan.instructions.length, 6);
  assert.deepEqual(
    plan.instructions.map((instruction) => [instruction.role, instruction.programIdIndex, instruction.accountIndexes]),
    [
      ["systemCreateMint", 7, [0, 1]],
      ["splInitializeMint2", 6, [1]],
      ["systemCreateRecipientTokenAccount", 7, [0, 2]],
      ["splInitializeRecipientTokenAccount3", 6, [2, 1]],
      ["transceiverInitialize", 8, [4, 0, 7]],
      ["bridgeInitialize", 9, [3, 1, 6, 0, 7]],
    ],
  );

  const message = Buffer.from(plan.messageBase64, "base64");
  assert.deepEqual([...message.subarray(0, 3)], [3, 0, 5]);
  assert.equal(plan.messageFingerprintHex.length, 64);

  const createMint = dataFor(plan, "systemCreateMint");
  assert.equal(createMint.readUInt32LE(0), SYSTEM_INSTRUCTION_CREATE_ACCOUNT);
  assert.equal(createMint.readBigUInt64LE(4), 1_461_600n);
  assert.equal(createMint.readBigUInt64LE(12), 82n);
  assert.equal(base58Encode(createMint.subarray(20, 52)), SPL_TOKEN_PROGRAM_ID_BASE58);

  const initializeMint = dataFor(plan, "splInitializeMint2");
  assert.equal(initializeMint.length, 35);
  assert.equal(initializeMint[0], SPL_TOKEN_INSTRUCTION_INITIALIZE_MINT2);
  assert.equal(initializeMint[1], 8);
  assert.equal(bytesToHex(initializeMint.subarray(2, 34)), plan.pdas.mintAuthority.addressHex);
  assert.equal(initializeMint[34], 0);

  const createTokenAccount = dataFor(plan, "systemCreateRecipientTokenAccount");
  assert.equal(createTokenAccount.readUInt32LE(0), SYSTEM_INSTRUCTION_CREATE_ACCOUNT);
  assert.equal(createTokenAccount.readBigUInt64LE(4), 2_039_280n);
  assert.equal(createTokenAccount.readBigUInt64LE(12), 165n);
  assert.equal(base58Encode(createTokenAccount.subarray(20, 52)), SPL_TOKEN_PROGRAM_ID_BASE58);

  const initializeAccount = dataFor(plan, "splInitializeRecipientTokenAccount3");
  assert.equal(initializeAccount.length, 33);
  assert.equal(initializeAccount[0], SPL_TOKEN_INSTRUCTION_INITIALIZE_ACCOUNT3);
  assert.equal(bytesToHex(initializeAccount.subarray(1)), recipientTokenAccountOwner.hex);

  const transceiver = dataFor(plan, "transceiverInitialize");
  assert.equal(transceiver.length, 198);
  assert.equal(transceiver[0], TRANSCEIVER_INSTRUCTION_INITIALIZE);
  assert.equal(base58Encode(transceiver.subarray(1, 33)), LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58);
  assert.equal(base58Encode(transceiver.subarray(33, 65)), LOCALNET_MANAGER_PROGRAM_ID_BASE58);
  assert.equal(base58Encode(transceiver.subarray(65, 97)), config.mintBase58);
  assert.equal(bytesToHex(transceiver.subarray(97, 129)), config.solanaDeploymentHex);
  assert.equal(bytesToHex(transceiver.subarray(129, 161)), attesterA.publicKeyHex);
  assert.equal(bytesToHex(transceiver.subarray(161, 193)), attesterB.publicKeyHex);
  assert.equal(transceiver[193], 1);
  assert.equal(transceiver.readUInt32LE(194), 1);

  const bridge = dataFor(plan, "bridgeInitialize");
  assert.equal(bridge.length, 257);
  assert.equal(bridge[0], BRIDGE_INSTRUCTION_INITIALIZE);
  assert.equal(bridge[1], 0);
  assert.equal(base58Encode(bridge.subarray(2, 34)), LOCALNET_MANAGER_PROGRAM_ID_BASE58);
  assert.equal(base58Encode(bridge.subarray(34, 66)), LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58);
  assert.equal(bytesToHex(bridge.subarray(66, 98)), config.solanaDeploymentHex);
  assert.equal(base58Encode(bridge.subarray(98, 130)), config.mintBase58);
  assert.equal(base58Encode(bridge.subarray(130, 162)), SPL_TOKEN_PROGRAM_ID_BASE58);
  assert.equal(bytesToHex(bridge.subarray(162, 194)), plan.pdas.mintAuthority.addressHex);
  assert.equal(bridge[194], 8);
  assert.equal(bridge[195], 8);
  assert.equal(bridge[196], 0);
  assert.equal(bytesToHex(bridge.subarray(197, 229)), "00".repeat(32));
  assert.equal(bridge.readBigUInt64LE(229), 0n);
  assert.equal(bridge.readBigUInt64LE(237), 0n);
  assert.equal(bridge.readUInt32LE(245), 1);
  assert.equal(bridge.readUInt32LE(249), 1);
  assert.deepEqual([...bridge.subarray(253, 257)], [0, 0, 0, 0]);
});

test("localnet setup planner signs with fee payer, mint, and recipient token account signers in account order", async () => {
  const { config } = fixture();
  const plan = await prepareSignedLocalnetSolanaSetupTransaction(config);
  const message = Buffer.from(plan.messageBase64, "base64");
  const transaction = Buffer.from(plan.preparedTransactionBase64, "base64");

  assert.equal(plan.signatures.length, 3);
  assert.deepEqual(
    plan.signatures.map((signature) => signature.role),
    ["feePayer", "mint", "recipientTokenAccount"],
  );
  assert.equal(transaction[0], 3);
  assert.equal(bytesToHex(transaction.subarray(1 + 64 * 3)), bytesToHex(message));
  for (let index = 0; index < plan.signatures.length; index += 1) {
    const signature = base58Decode(plan.signatures[index].signatureBase58);
    const publicKey = base58Decode(plan.signatures[index].publicKeyBase58);
    assert.ok(ed25519.verify(signature, message, publicKey));
  }
});

test("localnet setup plan rejects non-localnet environments and disabled automatic local setup", () => {
  assert.throws(() => buildLocalnetSolanaSetupTransactionPlan(fixture({ environment: "mainnet" }).config), /LocalnetOnly/u);
  assert.throws(() => buildLocalnetSolanaSetupTransactionPlan(fixture({ cluster: "devnet" }).config), /LocalnetOnly/u);
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ mainnetActivationEnabled: true }).config),
    /MainnetActivationDisabled/u,
  );
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ hardStop: true }).config),
    /MustStartOperational/u,
  );
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ depositsPaused: true }).config),
    /MustStartOperational/u,
  );
});

test("localnet setup plan enforces zero premine, no freeze authority, SPL Token Program, and matching decimals", () => {
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ initialSupplyAtomic: "1" }).config),
    /InitialSupplyMustBeZero/u,
  );
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ freezeAuthorityBase58: pubkey("freeze").base58 }).config),
    /FreezeAuthorityMustBeNone/u,
  );
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ tokenProgramIdBase58: pubkey("fake-token").base58 }).config),
    /TraditionalSplTokenProgram/u,
  );
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ nativeDecimals: 9 }).config),
    /DecimalsMismatch/u,
  );
});

test("localnet setup plan rejects duplicate attesters, missing rent inputs, and signer mismatch", async () => {
  const sameAttester = h("same-attester");
  assert.throws(
    () => buildLocalnetSolanaSetupTransactionPlan(fixture({ attesterPublicKeysHex: [sameAttester, sameAttester] }).config),
    /DuplicateAttester/u,
  );
  const missingRent = fixture().config;
  delete missingRent.mintRentLamports;
  assert.throws(() => buildLocalnetSolanaSetupTransactionPlan(missingRent), /mintRentLamports/u);

  const { config } = fixture();
  await assert.rejects(
    prepareSignedLocalnetSolanaSetupTransaction({
      ...config,
      mintSigner: keypair(),
    }),
    /SignerMismatch:mint/u,
  );
});
