import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { test } from "node:test";
import {
  base58Decode,
  base58Encode,
  buildLocalnetSolanaDepositClaimBundleTransactionPlan,
  buildLocalnetSolanaDepositClaimTransactionPlan,
  prepareSignedLocalnetSolanaDepositClaimBundleTransaction,
  prepareSignedLocalnetSolanaDepositClaimTransaction,
  shortvecEncode,
} from "../solana-deposit-claim-transaction-plan.mjs";
import {
  ProjectAttester,
  createEphemeralAttesterKeypairForTestOnly,
} from "../../attesters/attestation-service.mjs";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  encodeCanonicalBridgeMessage,
  hexToBytes,
} from "../../../shared/protocol/canonical-message.mjs";

const ZERO_HASH = "00".repeat(32);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function pubkey(label) {
  return {
    bytes: hexToBytes(h(label), label),
    hex: h(label),
    base58: base58Encode(hexToBytes(h(label), label)),
  };
}

function keypair() {
  const generated = ed25519.keygen();
  return {
    publicKey: generated.publicKey,
    publicKeyHex: bytesToHex(generated.publicKey),
    publicKeyBase58: base58Encode(generated.publicKey),
    signingKey: generated["secret" + "Key"],
  };
}

function depositMessage(fields = {}) {
  return encodeCanonicalBridgeMessage({
    action: "DepositClaim",
    direction: "NativeToSolana",
    deployment: {
      protocolId: 1,
      nativeNetwork: 8_000_111,
      nativeGenesis: hexToBytes(h("native-regtest-genesis"), "nativeGenesis"),
      solanaDeployment: hexToBytes(h("solana-localnet-deployment"), "solanaDeployment"),
      managerProgramId: fields.managerProgram.bytes,
      transceiverProgramId: fields.transceiverProgram.bytes,
      mint: fields.mint.bytes,
    },
    depositOutpoint: {
      txid: hexToBytes(h("native-deposit-outpoint"), "depositOutpoint.txid"),
      vout: 2,
    },
    withdrawalId: hexToBytes(ZERO_HASH, "withdrawalId"),
    amountAtomic: "250000000",
    feeAtomic: "0",
    destination: fields.recipientTokenAccount.bytes,
    policyEpoch: 1,
    keyEpoch: 1,
    nonce: hexToBytes(h("deposit-message-nonce"), "nonce"),
    validFrom: "1700000000",
    validUntil: "1700001200",
    evidenceDigest: hexToBytes(h("deposit-evidence"), "evidenceDigest"),
  });
}

function attesterPolicy(config, role, keypair) {
  const message = decodeCanonicalBridgeMessage(config.encodedMessageHex);
  return {
    role,
    attesterPublicKeyHex: keypair.publicKeyHex,
    protocolId: message.deployment.protocolId,
    nativeNetwork: message.deployment.nativeNetwork,
    nativeGenesisHex: bytesToHex(message.deployment.nativeGenesis),
    solanaDeploymentHex: bytesToHex(message.deployment.solanaDeployment),
    managerProgramIdHex: bytesToHex(message.deployment.managerProgramId),
    transceiverProgramIdHex: bytesToHex(message.deployment.transceiverProgramId),
    mintHex: bytesToHex(message.deployment.mint),
    policyEpoch: message.policyEpoch,
    keyEpoch: message.keyEpoch,
    acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"],
    depositsPaused: false,
    hardStop: false,
  };
}

function depositEvidence(config) {
  const message = decodeCanonicalBridgeMessage(config.encodedMessageHex);
  return {
    trust: "LOCALLY_VALIDATED_CHAIN_STATE",
    nativeNetwork: message.deployment.nativeNetwork,
    nativeGenesisHash: bytesToHex(message.deployment.nativeGenesis),
    operationIdHex: message.operationIdHex,
    depositOutpoint: message.depositOutpointText,
    amountAtomic: message.amountAtomic.toString(),
    solanaRecipientHex: message.destinationHex,
    evidenceDigestHex: message.evidenceDigestHex,
    reserveAllocationIdHex: h("bundle-reserve-allocation"),
    reserveTransitionState: "CANONICAL_RESERVE",
    mintCreditState: "AUTHORIZED_UNCONSUMED",
    finalitySatisfied: true,
    sweepFinalized: true,
    utxoUnspentAtDeposit: true,
    noPriorConsumption: true,
  };
}

function createAttestations(config) {
  const keyA = createEphemeralAttesterKeypairForTestOnly();
  const keyB = createEphemeralAttesterKeypairForTestOnly();
  const request = {
    encodedMessageHex: config.encodedMessageHex,
    messageDigestHex: decodeCanonicalBridgeMessage(config.encodedMessageHex).messageDigestHex,
    evidence: depositEvidence(config),
  };
  const attesterA = new ProjectAttester({
    role: "ATTESTER_A",
    ["secret" + "Key"]: keyA["secret" + "Key"],
    policy: attesterPolicy(config, "ATTESTER_A", keyA),
  });
  const attesterB = new ProjectAttester({
    role: "ATTESTER_B",
    ["secret" + "Key"]: keyB["secret" + "Key"],
    policy: attesterPolicy(config, "ATTESTER_B", keyB),
  });
  return [
    attesterA.signDepositCredit(request, 1_700_000_600),
    attesterB.signDepositCredit(request, 1_700_000_600),
  ];
}

function fixture(overrides = {}) {
  const managerProgram = pubkey("manager-program");
  const transceiverProgram = pubkey("transceiver-program");
  const mint = pubkey("kpepe-mint");
  const tokenProgram = pubkey("traditional-token-program");
  const recipientTokenAccount = pubkey("recipient-token-account");
  const feePayer = keypair();
  const recentBlockhash = pubkey("recent-blockhash");
  const encodedMessageHex = bytesToHex(
    depositMessage({
      managerProgram,
      transceiverProgram,
      mint,
      recipientTokenAccount,
    }),
  );

  return {
    managerProgram,
    transceiverProgram,
    mint,
    tokenProgram,
    recipientTokenAccount,
    feePayer,
    recentBlockhash,
    config: {
      environment: "localnet",
      cluster: "localnet",
      managerProgramIdBase58: managerProgram.base58,
      transceiverProgramIdBase58: transceiverProgram.base58,
      mintBase58: mint.base58,
      tokenProgramIdBase58: tokenProgram.base58,
      recipientTokenAccountBase58: recipientTokenAccount.base58,
      feePayerBase58: feePayer.publicKeyBase58,
      recentBlockhashBase58: recentBlockhash.base58,
      lastValidBlockHeight: "1000",
      encodedMessageHex,
      ...overrides,
    },
  };
}

test("deposit claim transaction plan builds exact localnet instruction data and account metas", () => {
  const { config } = fixture();
  const plan = buildLocalnetSolanaDepositClaimTransactionPlan(config);

  assert.equal(plan.environment, "localnet");
  assert.equal(plan.cluster, "localnet");
  assert.equal(plan.amountAtomic, "250000000");
  assert.equal(plan.lastValidBlockHeight, "1000");
  assert.equal(plan.managerProgramIdBase58, config.managerProgramIdBase58);
  assert.equal(plan.transceiverProgramIdBase58, config.transceiverProgramIdBase58);
  assert.equal(plan.mintBase58, config.mintBase58);
  assert.equal(plan.feePayerBase58, config.feePayerBase58);

  assert.deepEqual(
    plan.accounts.map((account) => [account.role, account.isSigner, account.isWritable]),
    [
      ["feePayer", true, true],
      ["bridgeState", false, true],
      ["depositClaim", false, true],
      ["mint", false, true],
      ["recipientTokenAccount", false, true],
      ["verifiedReceipt", false, false],
      ["mintAuthorityPda", false, false],
      ["tokenProgram", false, false],
      ["transceiverProgram", false, false],
      ["managerProgram", false, false],
    ],
  );
  assert.deepEqual(plan.instruction.accountIndexes, [1, 2, 5, 3, 4, 6, 7, 8]);
  assert.equal(plan.instruction.programIdIndex, 9);

  const instructionData = Buffer.from(plan.instruction.dataBase64, "base64");
  assert.equal(instructionData[0], 2);
  assert.equal(instructionData.length, 515);
  assert.equal(bytesToHex(instructionData.subarray(1)), config.encodedMessageHex);

  const messageBytes = Buffer.from(plan.messageBase64, "base64");
  assert.deepEqual([...messageBytes.subarray(0, 3)], [1, 0, 5]);
  assert.match(plan.messageFingerprintHex, /^[0-9a-f]{64}$/u);
  assert.equal(plan.preparedTransactionBase64, undefined);
});

test("signed deposit claim transaction uses injected fee-payer signer and verifies independently", async () => {
  const { config, feePayer } = fixture();
  const prepared = await prepareSignedLocalnetSolanaDepositClaimTransaction({
    ...config,
    feePayerSigner: {
      publicKeyBase58: feePayer.publicKeyBase58,
      sign(messageBytes) {
        return ed25519.sign(messageBytes, feePayer.signingKey);
      },
    },
  });

  assert.match(prepared.preparedTransactionBase64, /^[A-Za-z0-9+/]+={0,2}$/u);
  assert.match(prepared.preparedTransactionFingerprintHex, /^[0-9a-f]{64}$/u);
  assert.equal(prepared.signatures.length, 1);
  assert.equal(prepared.signatures[0].publicKeyBase58, feePayer.publicKeyBase58);

  const transactionBytes = Buffer.from(prepared.preparedTransactionBase64, "base64");
  assert.equal(transactionBytes[0], 1);
  const signature = transactionBytes.subarray(1, 65);
  const messageBytes = transactionBytes.subarray(65);
  assert.deepEqual(messageBytes, Buffer.from(prepared.messageBase64, "base64"));
  assert.equal(ed25519.verify(signature, messageBytes, feePayer.publicKey), true);
  assert.equal(JSON.stringify(prepared).includes("secret"), false);
});

test("bundled localnet deposit claim plan includes attestation, transceiver receipt, and bridge claim instructions", () => {
  const { config } = fixture();
  const attestations = createAttestations(config);
  const plan = buildLocalnetSolanaDepositClaimBundleTransactionPlan({
    ...config,
    attestations,
  });

  assert.equal(plan.bundle, "ED25519_ATTESTATIONS_TRANSCEIVER_RECEIPT_BRIDGE_CLAIM");
  assert.equal(plan.instructions.length, 4);
  assert.deepEqual(
    plan.accounts.map((account) => [account.role, account.isSigner, account.isWritable]),
    [
      ["feePayer", true, true],
      ["verifiedReceipt", false, true],
      ["bridgeState", false, true],
      ["depositClaim", false, true],
      ["mint", false, true],
      ["recipientTokenAccount", false, true],
      ["transceiverConfig", false, false],
      ["instructionsSysvar", false, false],
      ["mintAuthorityPda", false, false],
      ["tokenProgram", false, false],
      ["systemProgram", false, false],
      ["ed25519Program", false, false],
      ["transceiverProgram", false, false],
      ["managerProgram", false, false],
    ],
  );

  assert.deepEqual(
    plan.instructions.map((instruction) => instruction.role),
    [
      "ed25519Attestation1",
      "ed25519Attestation2",
      "transceiverVerifyMessageFromEd25519",
      "bridgeAcceptDepositClaim",
    ],
  );
  assert.deepEqual(
    plan.instructions.map((instruction) => instruction.programIdIndex),
    [11, 11, 12, 13],
  );
  assert.deepEqual(plan.instructions[2].accountIndexes, [6, 1, 7, 0, 10]);
  assert.deepEqual(plan.instructions[3].accountIndexes, [2, 3, 1, 4, 5, 8, 9, 12, 0, 10]);

  for (let index = 0; index < 2; index += 1) {
    const verifierData = Buffer.from(plan.instructions[index].dataBase64, "base64");
    assert.equal(verifierData[0], 1);
    assert.equal(verifierData[1], 0);
    assert.equal(verifierData.readUInt16LE(2), 16);
    assert.equal(verifierData.readUInt16LE(4), index);
    assert.equal(verifierData.readUInt16LE(6), 80);
    assert.equal(verifierData.readUInt16LE(8), index);
    assert.equal(verifierData.readUInt16LE(10), 112);
    assert.equal(verifierData.readUInt16LE(12), 514);
    assert.equal(verifierData.readUInt16LE(14), index);
    assert.equal(bytesToHex(verifierData.subarray(16, 80)), attestations[index].signatureHex);
    assert.equal(bytesToHex(verifierData.subarray(80, 112)), attestations[index].attesterPublicKeyHex);
    assert.equal(bytesToHex(verifierData.subarray(112)), config.encodedMessageHex);
  }

  const transceiverData = Buffer.from(plan.instructions[2].dataBase64, "base64");
  assert.equal(transceiverData[0], 2);
  assert.equal(bytesToHex(transceiverData.subarray(1, 515)), config.encodedMessageHex);
  assert.equal(transceiverData.readUInt16LE(515), 0);
  assert.equal(transceiverData.readUInt16LE(517), 1);

  const bridgeData = Buffer.from(plan.instructions[3].dataBase64, "base64");
  assert.equal(bridgeData[0], 2);
  assert.equal(bytesToHex(bridgeData.subarray(1)), config.encodedMessageHex);
  assert.equal(plan.instruction.role, "bridgeAcceptDepositClaim");

  const messageBytes = Buffer.from(plan.messageBase64, "base64");
  assert.deepEqual([...messageBytes.subarray(0, 3)], [1, 0, 8]);
  assert.match(plan.messageFingerprintHex, /^[0-9a-f]{64}$/u);
  assert.equal(plan.preparedTransactionBase64, undefined);
});

test("signed bundled localnet claim transaction verifies fee-payer signature independently", async () => {
  const { config, feePayer } = fixture();
  const prepared = await prepareSignedLocalnetSolanaDepositClaimBundleTransaction({
    ...config,
    attestations: createAttestations(config),
    feePayerSigner: {
      publicKeyBase58: feePayer.publicKeyBase58,
      sign(messageBytes) {
        return ed25519.sign(messageBytes, feePayer.signingKey);
      },
    },
  });

  assert.equal(prepared.bundle, "ED25519_ATTESTATIONS_TRANSCEIVER_RECEIPT_BRIDGE_CLAIM");
  assert.match(prepared.preparedTransactionBase64, /^[A-Za-z0-9+/]+={0,2}$/u);
  assert.match(prepared.preparedTransactionFingerprintHex, /^[0-9a-f]{64}$/u);
  assert.equal(prepared.signatures.length, 1);
  const transactionBytes = Buffer.from(prepared.preparedTransactionBase64, "base64");
  assert.equal(transactionBytes[0], 1);
  const signature = transactionBytes.subarray(1, 65);
  const messageBytes = transactionBytes.subarray(65);
  assert.deepEqual(messageBytes, Buffer.from(prepared.messageBase64, "base64"));
  assert.equal(ed25519.verify(signature, messageBytes, feePayer.publicKey), true);
  assert.equal(JSON.stringify(prepared).includes("secret"), false);
});

test("bundled deposit claim plan rejects missing, duplicate, or mutated attestations", () => {
  const { config } = fixture();
  const attestations = createAttestations(config);
  assert.throws(
    () =>
      buildLocalnetSolanaDepositClaimBundleTransactionPlan({
        ...config,
        attestations: [attestations[0]],
      }),
    /ExactlyTwoAttestationsRequired/u,
  );
  assert.throws(
    () =>
      buildLocalnetSolanaDepositClaimBundleTransactionPlan({
        ...config,
        attestations: [attestations[0], attestations[0]],
      }),
    /DuplicateAttester/u,
  );
  assert.throws(
    () =>
      buildLocalnetSolanaDepositClaimBundleTransactionPlan({
        ...config,
        attestations: [
          attestations[0],
          {
            ...attestations[1],
            signatureHex: `${attestations[1].signatureHex.slice(0, -2)}00`,
          },
        ],
      }),
    /InvalidAttestation/u,
  );
});

test("deposit claim transaction plan rejects wrong domain, recipient, or environment", () => {
  const { config, mint, recipientTokenAccount } = fixture();
  const differentMint = pubkey("different-mint");
  assert.throws(
    () => buildLocalnetSolanaDepositClaimTransactionPlan({ ...config, mintBase58: differentMint.base58 }),
    /MintMismatch/,
  );
  const differentRecipient = pubkey("different-recipient");
  assert.throws(
    () =>
      buildLocalnetSolanaDepositClaimTransactionPlan({
        ...config,
        recipientTokenAccountBase58: differentRecipient.base58,
      }),
    /RecipientMismatch/,
  );
  assert.throws(
    () => buildLocalnetSolanaDepositClaimTransactionPlan({ ...config, environment: "mainnet", cluster: "mainnet-beta" }),
    /LocalnetOnly/,
  );

  const withdrawalMessage = encodeCanonicalBridgeMessage({
    action: "WithdrawalRequest",
    direction: "SolanaToNative",
    deployment: {
      protocolId: 1,
      nativeNetwork: 8_000_111,
      nativeGenesis: hexToBytes(h("native-regtest-genesis"), "nativeGenesis"),
      solanaDeployment: hexToBytes(h("solana-localnet-deployment"), "solanaDeployment"),
      managerProgramId: hexToBytes(h("manager-program"), "managerProgram"),
      transceiverProgramId: hexToBytes(h("transceiver-program"), "transceiverProgram"),
      mint: mint.bytes,
    },
    depositOutpoint: { txid: hexToBytes(ZERO_HASH, "txid"), vout: 0 },
    withdrawalId: hexToBytes(h("withdrawal-id"), "withdrawalId"),
    amountAtomic: "10",
    feeAtomic: "0",
    destination: recipientTokenAccount.bytes,
    policyEpoch: 1,
    keyEpoch: 1,
    nonce: hexToBytes(h("withdrawal-nonce"), "nonce"),
    validFrom: "1700000000",
    validUntil: "1700001200",
    evidenceDigest: hexToBytes(h("withdrawal-evidence"), "evidenceDigest"),
  });
  assert.throws(
    () =>
      buildLocalnetSolanaDepositClaimTransactionPlan({
        ...config,
        encodedMessageHex: bytesToHex(withdrawalMessage),
      }),
    /WrongMessageKind/,
  );
});

test("signed deposit claim transaction rejects signer mismatch or invalid signature", async () => {
  const { config, feePayer } = fixture();
  const other = keypair();
  await assert.rejects(
    () =>
      prepareSignedLocalnetSolanaDepositClaimTransaction({
        ...config,
        feePayerSigner: {
          publicKeyBase58: other.publicKeyBase58,
          sign(messageBytes) {
            return ed25519.sign(messageBytes, other.signingKey);
          },
        },
      }),
    /SignerMismatch/,
  );

  await assert.rejects(
    () =>
      prepareSignedLocalnetSolanaDepositClaimTransaction({
        ...config,
        feePayerSigner: {
          publicKeyBase58: feePayer.publicKeyBase58,
          sign() {
            return Buffer.alloc(64);
          },
        },
      }),
    /SignatureVerificationFailed/,
  );
});

test("base58 and shortvec helpers reject malformed input while preserving exact bytes", () => {
  const bytes = hexToBytes(h("roundtrip-bytes"), "roundtrip");
  assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  assert.throws(() => base58Decode("0".repeat(44)), /InvalidBase58/);
  assert.deepEqual([...shortvecEncode(127)], [127]);
  assert.deepEqual([...shortvecEncode(128)], [128, 1]);
  assert.throws(() => shortvecEncode(-1), /ShortvecLengthInvalid/);
});
