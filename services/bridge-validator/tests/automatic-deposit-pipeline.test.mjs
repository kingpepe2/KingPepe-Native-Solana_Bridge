import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { test } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  ProjectAttester,
  createEphemeralAttesterKeypairForTestOnly,
} from "../../attesters/attestation-service.mjs";
import {
  AutomaticNativeToSolanaDepositPipeline,
  DEPOSIT_STATES,
  FileBackedDepositJournal,
  buildDepositClaimMessage,
} from "../automatic-deposit-pipeline.mjs";
import {
  LocalnetSolanaDepositClaimBridge,
  prepareLocalnetSolanaDepositClaimRequest,
} from "../localnet-solana-deposit-claim-bridge.mjs";
import {
  FileBackedNativeReserveSweepJournal,
  InMemoryNativeReserveSweepJournal,
  NativeReserveSweepRelayer,
  NativeReserveSweepVerifier,
} from "../native-reserve-sweep-adapters.mjs";
import {
  FileBackedSolanaDepositClaimJournal,
  InMemorySolanaDepositClaimJournal,
} from "../solana-deposit-claim-submitter.mjs";
import { base58Encode, findProgramAddress } from "../solana-deposit-claim-transaction-plan.mjs";
import { SolanaDepositClaimObserver } from "../../solana-observer/solana-deposit-claim-observer.mjs";
import {
  FROST_SIGNING_INTENT_PROTOCOL,
  FROST_SIGNING_MODE,
  FileBackedFrostStateStore,
  NativeFrostCoordinator,
  NativeFrostSigner,
  REQUIRED_FROST_SIGNERS,
  createNativeSigningPolicy,
  runTwoPartyDkg,
} from "../../../native/frost/index.mjs";
import { RPC_OBSERVATION, SOURCE_READY } from "../../../native/node/native-rpc-client.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ZERO_HASH = "00".repeat(32);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

function outpoint(label, index = 0) {
  return { txid: h(label), vout: index };
}

function outpointText(value) {
  return `${value.txid}:${value.vout}`;
}

function baseConfig(overrides = {}) {
  return {
    deployment: {
      protocolId: 1,
      nativeNetwork: 8_000_111,
      nativeGenesis: h("kingpepe-regtest-genesis"),
      solanaDeployment: h("solana-local-deployment"),
      managerProgramId: h("bridge-program-id"),
      transceiverProgramId: h("transceiver-program-id"),
      mint: h("kpepe-mint"),
    },
    policyEpoch: 1,
    keyEpoch: 1,
    acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"],
    authorizedAttesterPublicKeys: [],
    depositsPaused: false,
    hardStop: false,
    ...overrides,
  };
}

function baseOperation(config, operationId = ZERO_HASH, overrides = {}) {
  const depositOutpoint = outpoint("phase08-deposit-outpoint", 2);
  const feeFundingOutpoint = outpoint("phase08-reserve-sweep-fee-funding", 0);
  const base = {
    messageNonceHex: h("phase08-message-nonce"),
    validFrom: "1700000000",
    validUntil: "1700001200",
    deposit: {
      trust: "LOCALLY_VALIDATED_CHAIN_STATE",
      nativeNetwork: config.deployment.nativeNetwork,
      nativeGenesisHash: config.deployment.nativeGenesis,
      depositOutpoint,
      amountAtomic: "250000000",
      projectBridgeFeeAtomic: "0",
      solanaRecipientHex: h("solana-recipient"),
      proofFingerprint: h("validated-native-deposit-proof"),
      finalitySatisfied: true,
      utxoUnspentAtDeposit: true,
      noPriorConsumption: true,
    },
    reserveSweep: {
      reserveAllocationIdHex: h("reserve-allocation"),
      nativeSweepTxidHex: h("reserve-sweep-txid"),
      nativeMinerFeeAtomic: "1200",
      canonicalReserveScriptPubKeyHex: p2tr("canonical-reserve"),
      signedNativeTransactionHex: "02000000000100",
      signingIntent: {
        protocol: FROST_SIGNING_INTENT_PROTOCOL,
        mode: FROST_SIGNING_MODE,
        purpose: "RESERVE_SWEEP",
        nativeNetwork: "regtest",
        nativeGenesisHash: config.deployment.nativeGenesis,
        solanaDeployment: config.deployment.solanaDeployment,
        bridgeProgramId: config.deployment.managerProgramId,
        transceiverProgramId: config.deployment.transceiverProgramId,
        mint: config.deployment.mint,
        keyEpoch: config.keyEpoch,
        signingRequestId: h("reserve-sweep-signing-request"),
        operationId,
        withdrawalId: ZERO_HASH,
        proofFingerprint: h("validated-native-deposit-proof"),
        unsignedNativeTransactionId: h("unsigned-reserve-sweep-txid"),
        transactionCommitment: h("reserve-sweep-transaction-commitment"),
        signingInputIndex: 0,
        taprootSighashHex: h("reserve-sweep-sighash"),
        recipientScriptPubKeyHex: p2tr("canonical-reserve"),
        amountAtomic: "250000000",
        feeAtomic: "1200",
        changeScriptPubKeyHex: p2tr("canonical-reserve"),
        changeAtomic: "0",
        inputOutpoints: [outpointText(depositOutpoint), outpointText(feeFundingOutpoint)],
        outputCommitments: [h("reserve-sweep-output")],
        reserveCommitment: h("reserve-commitment"),
        pauseWithdrawals: false,
        hardStop: false,
      },
    },
  };
  return deepMerge(base, overrides);
}

function operationWithComputedId(config, overrides = {}) {
  const placeholder = baseOperation(config, ZERO_HASH, overrides);
  const { decodedMessage } = buildDepositClaimMessage(config, placeholder);
  return baseOperation(config, decodedMessage.operationIdHex, overrides);
}

function attesterPolicy(config, role, keypair, overrides = {}) {
  return {
    role,
    attesterPublicKeyHex: keypair.publicKeyHex,
    protocolId: config.deployment.protocolId,
    nativeNetwork: config.deployment.nativeNetwork,
    nativeGenesisHex: config.deployment.nativeGenesis,
    solanaDeploymentHex: config.deployment.solanaDeployment,
    managerProgramIdHex: config.deployment.managerProgramId,
    transceiverProgramIdHex: config.deployment.transceiverProgramId,
    mintHex: config.deployment.mint,
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"],
    depositsPaused: false,
    hardStop: false,
    ...overrides,
  };
}

function createFrostRuntime(config, operation) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-phase08-frost-"));
  const auth = {
    signingRequestId: operation.reserveSweep.signingIntent.signingRequestId,
    operationId: operation.reserveSweep.signingIntent.operationId,
    withdrawalId: operation.reserveSweep.signingIntent.withdrawalId,
    taprootSighashHex: operation.reserveSweep.signingIntent.taprootSighashHex,
    transactionCommitment: operation.reserveSweep.signingIntent.transactionCommitment,
    signingInputIndex: operation.reserveSweep.signingIntent.signingInputIndex,
    recipientScriptPubKeyHex: operation.reserveSweep.signingIntent.recipientScriptPubKeyHex,
    amountAtomic: operation.reserveSweep.signingIntent.amountAtomic,
    feeAtomic: operation.reserveSweep.signingIntent.feeAtomic,
    changeScriptPubKeyHex: operation.reserveSweep.signingIntent.changeScriptPubKeyHex,
    changeAtomic: operation.reserveSweep.signingIntent.changeAtomic,
    inputOutpoints: operation.reserveSweep.signingIntent.inputOutpoints,
    outputCommitments: operation.reserveSweep.signingIntent.outputCommitments,
    reserveCommitment: operation.reserveSweep.signingIntent.reserveCommitment,
  };
  const policy = createNativeSigningPolicy({
    nativeNetwork: "regtest",
    nativeGenesisHash: config.deployment.nativeGenesis,
    solanaDeployment: config.deployment.solanaDeployment,
    bridgeProgramId: config.deployment.managerProgramId,
    transceiverProgramId: config.deployment.transceiverProgramId,
    mint: config.deployment.mint,
    keyEpoch: config.keyEpoch,
    maxAmountAtomic: "10000000000",
    maxFeeAtomic: "100000",
    reserveScriptPubKeyHex: operation.reserveSweep.canonicalReserveScriptPubKeyHex,
    authorizedOperations: [auth],
  });
  const signerA = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[0],
    index: 0,
    policy,
    stateStore: new FileBackedFrostStateStore({
      signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(root, "frost-a"),
      repoRoot: REPO_ROOT,
    }),
  });
  const signerB = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[1],
    index: 1,
    policy,
    stateStore: new FileBackedFrostStateStore({
      signerId: REQUIRED_FROST_SIGNERS[1],
      root: path.join(root, "frost-b"),
      repoRoot: REPO_ROOT,
    }),
  });
  const dkg = runTwoPartyDkg([signerA, signerB], { epoch: config.keyEpoch });
  const coordinator = new NativeFrostCoordinator({
    signers: [signerA, signerB],
    publicPackage: dkg.publicPackage,
    aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey,
  });
  return {
    coordinator,
    signerA,
    signerB,
    aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createPipeline(overrides = {}) {
  const configWithoutKeys = baseConfig(overrides.config);
  const operation = operationWithComputedId(configWithoutKeys, overrides.operation);
  const frost = createFrostRuntime(configWithoutKeys, operation);
  const keyA = createEphemeralAttesterKeypairForTestOnly();
  const keyB = createEphemeralAttesterKeypairForTestOnly();
  const config = baseConfig({
    ...overrides.config,
    authorizedAttesterPublicKeys: [keyA.publicKeyHex, keyB.publicKeyHex],
  });
  const attesterA = new ProjectAttester({
    role: "ATTESTER_A",
    secretKey: keyA.secretKey,
    policy: attesterPolicy(config, "ATTESTER_A", keyA),
  });
  const attesterB = new ProjectAttester({
    role: "ATTESTER_B",
    secretKey: keyB.secretKey,
    policy: attesterPolicy(config, "ATTESTER_B", keyB),
  });
  let nativeRelayer = overrides.nativeRelayer ?? {
    broadcasts: [],
    broadcastReserveSweep(request) {
      this.broadcasts.push(request);
      assert.equal(request.operationIdHex, operation.reserveSweep.signingIntent.operationId);
      assert.equal(request.reserveSweep.nativeSweepTxidHex, operation.reserveSweep.nativeSweepTxidHex);
      assert.equal(request.signedNativeTransactionHex, operation.reserveSweep.signedNativeTransactionHex);
      assert.equal(
        schnorr.verify(
          Uint8Array.from(Buffer.from(request.frostResult.signatureHex, "hex")),
          Uint8Array.from(Buffer.from(request.frostResult.messageHex, "hex")),
          Uint8Array.from(Buffer.from(frost.aggregateTweakedXOnlyPublicKey, "hex")),
        ),
        true,
      );
      return {
        state: DEPOSIT_STATES.BROADCAST,
        nativeSweepTxidHex: operation.reserveSweep.nativeSweepTxidHex,
      };
    },
  };
  let reserveVerifier = overrides.reserveVerifier ?? {
    verifyFinalizedReserveSweep(request) {
      return {
        trust: "LOCALLY_VALIDATED_CHAIN_STATE",
        nativeNetwork: config.deployment.nativeNetwork,
        nativeGenesisHash: config.deployment.nativeGenesis,
        operationIdHex: request.operationIdHex,
        depositOutpoint: outpointText(operation.deposit.depositOutpoint),
        amountAtomic: operation.deposit.amountAtomic,
        solanaRecipientHex: operation.deposit.solanaRecipientHex,
        evidenceDigestHex: request.evidenceDigestHex,
        reserveAllocationIdHex: operation.reserveSweep.reserveAllocationIdHex,
        reserveTransitionState: "CANONICAL_RESERVE",
        mintCreditState: "AUTHORIZED_UNCONSUMED",
        finalitySatisfied: true,
        sweepFinalized: true,
        utxoUnspentAtDeposit: true,
        noPriorConsumption: true,
        nativeSweepTxidHex: operation.reserveSweep.nativeSweepTxidHex,
      };
    },
  };
  let solanaBridge = overrides.solanaBridge ?? {
    submissions: [],
    submitDepositClaim(request) {
      this.submissions.push(request);
      assert.equal(request.attestations.length, 2);
      assert.equal(request.combinedAttestation.threshold, 2);
      return {
        state: DEPOSIT_STATES.COMPLETED,
        mintedAmountAtomic: request.amountAtomic,
        solanaSignature: h("local-solana-mint-signature"),
      };
    },
  };
  if (overrides.asyncAdapters === true) {
    const syncNativeRelayer = nativeRelayer;
    nativeRelayer = {
      broadcasts: syncNativeRelayer.broadcasts,
      async broadcastReserveSweep(request) {
        await Promise.resolve();
        return syncNativeRelayer.broadcastReserveSweep(request);
      },
    };
    const syncReserveVerifier = reserveVerifier;
    reserveVerifier = {
      async verifyFinalizedReserveSweep(request) {
        await Promise.resolve();
        return syncReserveVerifier.verifyFinalizedReserveSweep(request);
      },
    };
    const syncSolanaBridge = solanaBridge;
    solanaBridge = {
      submissions: syncSolanaBridge.submissions,
      async submitDepositClaim(request) {
        await Promise.resolve();
        return syncSolanaBridge.submitDepositClaim(request);
      },
    };
  }
  const pipeline = new AutomaticNativeToSolanaDepositPipeline({
    config,
    frostCoordinator: frost.coordinator,
    attesters: [attesterA, attesterB],
    nativeRelayer,
    reserveVerifier,
    solanaBridge,
    journal: overrides.journal,
  });
  return { config, operation, frost, nativeRelayer, reserveVerifier, solanaBridge, pipeline };
}

function feePayerKeypairForPipelineTest() {
  const generated = ed25519.keygen();
  return {
    publicKeyBase58: base58Encode(generated.publicKey),
    signingKey: generated["secret" + "Key"],
  };
}

function feePayerSignerForPipelineTest(feePayer) {
  return {
    publicKeyBase58: feePayer.publicKeyBase58,
    sign(messageBytes) {
      return ed25519.sign(messageBytes, feePayer.signingKey);
    },
  };
}

function localnetBridgeConfigForPipeline(config, feePayer) {
  return {
    environment: "localnet",
    cluster: "localnet",
    solanaDeploymentHex: config.deployment.solanaDeployment,
    managerProgramIdHex: config.deployment.managerProgramId,
    transceiverProgramIdHex: config.deployment.transceiverProgramId,
    mintHex: config.deployment.mint,
    tokenProgramIdHex: h("traditional-spl-token-program"),
    feePayerBase58: feePayer.publicKeyBase58,
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedObservationTrust: ["RPC_OBSERVATION"],
    maxRetries: 0,
  };
}

function depositClaimAccountBase64ForMessage(message) {
  const destination = Buffer.from(message.destinationHex, "hex");
  const bytes = Buffer.alloc(211);
  let cursor = 0;
  bytes.write("KPBCLM01", cursor, "ascii");
  cursor += 8;
  bytes[cursor] = 1;
  cursor += 1;
  Buffer.from(message.operationIdHex, "hex").copy(bytes, cursor);
  cursor += 32;
  Buffer.from(message.messageDigestHex, "hex").copy(bytes, cursor);
  cursor += 32;
  bytes.writeBigUInt64LE(message.amountAtomic, cursor);
  cursor += 8;
  bytes.writeUInt16LE(destination.length, cursor);
  cursor += 2;
  destination.copy(bytes, cursor);
  return bytes.toString("base64");
}

function splMintAccountWithoutFreezeBase64() {
  const bytes = Buffer.alloc(82);
  const config = baseConfig();
  const authority = findProgramAddress([Buffer.from("kingpepe-mint-authority"), Buffer.from(config.deployment.mint, "hex")], Buffer.from(config.deployment.managerProgramId, "hex"));
  bytes.writeUInt32LE(1, 0);
  Buffer.from(authority.hex, "hex").copy(bytes, 4);
  bytes.writeBigUInt64LE(250000000n, 36);
  bytes[44] = 8;
  bytes[45] = 1;
  bytes.writeUInt32LE(0, 46);
  return bytes.toString("base64");
}

function solanaSignatureForPipeline(label = "automatic-pipeline-localnet-solana-claim") {
  return createHash("sha512").update(label).digest("hex").replaceAll("0", "1").slice(0, 88);
}

class FakeIntegratedLocalnetSolanaRpc {
  constructor(options = {}) {
    this.latestBlockhash = options.latestBlockhash ?? base58Encode(Buffer.from(h("automatic-pipeline-blockhash"), "hex"));
    this.lastValidBlockHeight = options.lastValidBlockHeight ?? "1000";
    this.blockHeight = options.blockHeight ?? 10n;
    this.solanaSignature = options.solanaSignature ?? solanaSignatureForPipeline();
    this.claimAccountBase64 = options.claimAccountBase64;
    this.mintAccountBase64 = options.mintAccountBase64 ?? splMintAccountWithoutFreezeBase64();
    this.expectedDepositClaimAccountBase58 = undefined;
    this.expectedMintAccountBase58 = undefined;
    this.latestBlockhashCalls = 0;
    this.sendCalls = [];
    this.statusCalls = [];
    this.submittedSignatures = new Set();
    this.transactionCalls = [];
    this.accountInfoCalls = [];
  }

  expectAccounts({ depositClaimAccountBase58, mintAccountBase58 }) {
    this.expectedDepositClaimAccountBase58 = depositClaimAccountBase58;
    this.expectedMintAccountBase58 = mintAccountBase58;
  }

  async getLatestBlockhash() {
    this.latestBlockhashCalls += 1;
    return {
      blockhash: this.latestBlockhash,
      lastValidBlockHeight: this.lastValidBlockHeight,
    };
  }

  async getBlockHeight() {
    return this.blockHeight;
  }

  async sendTransaction(preparedTransactionBase64, options) {
    this.sendCalls.push({ preparedTransactionBase64, options });
    this.submittedSignatures.add(base58Encode(Buffer.from(preparedTransactionBase64, "base64").subarray(1, 65)));
    return this.solanaSignature;
  }

  async getSignatureStatus(solanaSignature) {
    this.statusCalls.push(solanaSignature);
    if (!this.submittedSignatures.has(solanaSignature) &&
        !(solanaSignature === this.solanaSignature && this.sendCalls.length > 0)) return null;
    return {
      slot: 88,
      confirmationStatus: "finalized",
      err: null,
    };
  }

  async getTransaction(solanaSignature) {
    this.transactionCalls.push(solanaSignature);
    return {
      slot: 88,
      meta: {
        err: null,
      },
    };
  }

  async getFinalizedSlot() {
    return 88;
  }

  async getAccountInfo(addressBase58) {
    this.accountInfoCalls.push(addressBase58);
    if (addressBase58 === this.expectedDepositClaimAccountBase58) {
      return {
        context: { slot: 88 },
        value: {
          owner: base58Encode(Buffer.from(baseConfig().deployment.managerProgramId, "hex")), executable: false,
          data: [this.claimAccountBase64, "base64"],
        },
      };
    }
    if (addressBase58 === this.expectedMintAccountBase58) {
      return {
        context: { slot: 88 },
        value: {
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", executable: false,
          data: [this.mintAccountBase64, "base64"],
        },
      };
    }
    throw new Error("unexpected account address");
  }
}

class FakeIntegratedNativeReserveRpc {
  constructor(operation, options = {}) {
    this.operation = operation;
    this.sendResults = options.sendResults ?? [operation.reserveSweep.nativeSweepTxidHex];
    this.sourceState = options.sourceState ?? SOURCE_READY;
    this.sourceTrust = options.sourceTrust ?? RPC_OBSERVATION;
    this.confirmations = options.confirmations ?? 8;
    this.reserveValueAtomic = options.reserveValueAtomic ?? operation.deposit.amountAtomic;
    this.reserveScriptPubKeyHex = options.reserveScriptPubKeyHex ?? operation.reserveSweep.canonicalReserveScriptPubKeyHex;
    this.includeDepositInput = options.includeDepositInput !== false;
    this.sendCalls = [];
    this.sourceSnapshotCalls = [];
    this.rawTransactionCalls = [];
  }

  async sendRawTransaction(rawTransactionHex) {
    this.sendCalls.push(rawTransactionHex);
    assert.equal(rawTransactionHex, this.operation.reserveSweep.signedNativeTransactionHex);
    return this.sendResults[Math.min(this.sendCalls.length - 1, this.sendResults.length - 1)];
  }

  async getSourceSnapshot(request) {
    this.sourceSnapshotCalls.push(request);
    return {
      trust: this.sourceTrust,
      state: this.sourceState,
      network: "regtest",
      genesisHash: this.operation.deposit.nativeGenesisHash,
    };
  }

  async getRawTransaction(txid, verbose) {
    this.rawTransactionCalls.push({ txid, verbose });
    return {
      txid,
      confirmations: this.confirmations,
      vin: this.includeDepositInput
        ? [
            {
              txid: this.operation.deposit.depositOutpoint.txid,
              vout: this.operation.deposit.depositOutpoint.vout,
            },
          ]
        : [],
      vout: [
        {
          n: 0,
          valueAtomic: this.reserveValueAtomic,
          scriptPubKey: {
            hex: this.reserveScriptPubKeyHex,
          },
        },
      ],
    };
  }
}

test("async Native to Solana pipeline awaits promise-based adapters without a per-transfer approval state", async () => {
  const runtime = createPipeline({ asyncAdapters: true });
  try {
    const result = await runtime.pipeline.processDepositAsync(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(result.reason, "ALL_REQUIRED_CHECKS_PASSED");
    assert.equal(result.threshold, 2);
    assert.deepEqual(result.signerIds, REQUIRED_FROST_SIGNERS);
    assert.equal(runtime.nativeRelayer.broadcasts.length, 1);
    assert.equal(runtime.solanaBridge.submissions.length, 1);
  } finally {
    runtime.frost.cleanup();
  }
});

test("automatic Native to Solana pipeline submits through localnet Solana bridge and observer", async () => {
  const config = baseConfig();
  const operation = operationWithComputedId(config);
  const { encodedMessageHex, decodedMessage } = buildDepositClaimMessage(config, operation);
  const feePayer = feePayerKeypairForPipelineTest();
  const feePayerSigner = feePayerSignerForPipelineTest(feePayer);
  const solanaBridgeConfig = localnetBridgeConfigForPipeline(config, feePayer);
  const rpc = new FakeIntegratedLocalnetSolanaRpc({
    claimAccountBase64: depositClaimAccountBase64ForMessage(decodedMessage),
  });
  const expectedPrepared = await prepareLocalnetSolanaDepositClaimRequest(
    solanaBridgeConfig,
    {
      operationIdHex: decodedMessage.operationIdHex,
      encodedMessageHex,
      messageDigestHex: decodedMessage.messageDigestHex,
      amountAtomic: decodedMessage.amountAtomic.toString(),
      solanaRecipientHex: decodedMessage.destinationHex,
    },
    {
      feePayerSigner,
      blockhashSource: rpc,
    },
  );
  rpc.expectAccounts({
    depositClaimAccountBase58: expectedPrepared.depositClaimAccountBase58,
    mintAccountBase58: expectedPrepared.mintAccountBase58,
  });
  const claimObserver = new SolanaDepositClaimObserver({
    config: {
      environment: "localnet",
      cluster: "localnet",
      managerProgramIdHex: config.deployment.managerProgramId,
      transceiverProgramIdHex: config.deployment.transceiverProgramId,
      mintHex: config.deployment.mint,
    },
    rpcClient: rpc,
  });
  const solanaBridge = new LocalnetSolanaDepositClaimBridge({
    config: solanaBridgeConfig,
    feePayerSigner,
    rpcClient: rpc,
    claimObserver,
    journal: new InMemorySolanaDepositClaimJournal(),
  });
  const runtime = createPipeline({ solanaBridge });
  try {
    const result = await runtime.pipeline.processDepositAsync(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(result.reason, "ALL_REQUIRED_CHECKS_PASSED");
    assert.equal(result.solanaSignature, rpc.solanaSignature);
    assert.equal(result.mintedAmountAtomic, "250000000");
    assert.equal(runtime.pipeline.ledgerSnapshot().mintedSupply, "250000000");
    assert.equal(rpc.sendCalls.length, 2);
    const receiptSignature = base58Encode(Buffer.from(rpc.sendCalls[0].preparedTransactionBase64, "base64").subarray(1, 65));
    assert.deepEqual(rpc.statusCalls, [receiptSignature, receiptSignature, rpc.solanaSignature]);
    assert.deepEqual(rpc.transactionCalls, [rpc.solanaSignature]);
    assert.deepEqual(rpc.accountInfoCalls, [
      expectedPrepared.depositClaimAccountBase58,
      expectedPrepared.mintAccountBase58,
    ]);
    assert.doesNotMatch(JSON.stringify(result), /WAITING_FOR_ADMIN_APPROVAL/u);
  } finally {
    runtime.frost.cleanup();
  }
});

test("automatic Native to Solana pipeline uses Native reserve sweep adapters and localnet Solana claim adapters", async () => {
  const config = baseConfig();
  const operation = operationWithComputedId(config);
  const { encodedMessageHex, decodedMessage } = buildDepositClaimMessage(config, operation);
  const nativeRpc = new FakeIntegratedNativeReserveRpc(operation);
  const nativeRelayer = new NativeReserveSweepRelayer({
    config: {
      environment: "localnet",
    },
    rpcClient: nativeRpc,
    journal: new InMemoryNativeReserveSweepJournal(),
  });
  const reserveVerifier = new NativeReserveSweepVerifier({
    config: {
      trust: "LOCALLY_VALIDATED_CHAIN_STATE",
      expectedSourceNetwork: "regtest",
      requiredConfirmations: 6,
      nativeDecimals: 8,
    },
    rpcClient: nativeRpc,
  });
  const feePayer = feePayerKeypairForPipelineTest();
  const feePayerSigner = feePayerSignerForPipelineTest(feePayer);
  const solanaBridgeConfig = localnetBridgeConfigForPipeline(config, feePayer);
  const solanaRpc = new FakeIntegratedLocalnetSolanaRpc({
    claimAccountBase64: depositClaimAccountBase64ForMessage(decodedMessage),
  });
  const expectedPrepared = await prepareLocalnetSolanaDepositClaimRequest(
    solanaBridgeConfig,
    {
      operationIdHex: decodedMessage.operationIdHex,
      encodedMessageHex,
      messageDigestHex: decodedMessage.messageDigestHex,
      amountAtomic: decodedMessage.amountAtomic.toString(),
      solanaRecipientHex: decodedMessage.destinationHex,
    },
    {
      feePayerSigner,
      blockhashSource: solanaRpc,
    },
  );
  solanaRpc.expectAccounts({
    depositClaimAccountBase58: expectedPrepared.depositClaimAccountBase58,
    mintAccountBase58: expectedPrepared.mintAccountBase58,
  });
  const claimObserver = new SolanaDepositClaimObserver({
    config: {
      environment: "localnet",
      cluster: "localnet",
      managerProgramIdHex: config.deployment.managerProgramId,
      transceiverProgramIdHex: config.deployment.transceiverProgramId,
      mintHex: config.deployment.mint,
    },
    rpcClient: solanaRpc,
  });
  const solanaBridge = new LocalnetSolanaDepositClaimBridge({
    config: solanaBridgeConfig,
    feePayerSigner,
    rpcClient: solanaRpc,
    claimObserver,
    journal: new InMemorySolanaDepositClaimJournal(),
  });
  const runtime = createPipeline({
    nativeRelayer,
    reserveVerifier,
    solanaBridge,
  });
  try {
    const result = await runtime.pipeline.processDepositAsync(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(result.reason, "ALL_REQUIRED_CHECKS_PASSED");
    assert.equal(result.threshold, 2);
    assert.deepEqual(result.signerIds, REQUIRED_FROST_SIGNERS);
    assert.equal(result.nativeSweepTxidHex, operation.reserveSweep.nativeSweepTxidHex);
    assert.equal(result.reserveAllocationIdHex, operation.reserveSweep.reserveAllocationIdHex);
    assert.equal(result.solanaSignature, solanaRpc.solanaSignature);
    assert.equal(result.mintedAmountAtomic, operation.deposit.amountAtomic);
    assert.equal(runtime.pipeline.ledgerSnapshot().canonicalReserve, operation.deposit.amountAtomic);
    assert.equal(runtime.pipeline.ledgerSnapshot().mintedSupply, operation.deposit.amountAtomic);
    assert.deepEqual(nativeRpc.sendCalls, [operation.reserveSweep.signedNativeTransactionHex]);
    assert.deepEqual(nativeRpc.sourceSnapshotCalls, [
      {
        expectedNetwork: "regtest",
        expectedGenesisHash: config.deployment.nativeGenesis,
      },
    ]);
    assert.deepEqual(nativeRpc.rawTransactionCalls, [
      {
        txid: operation.reserveSweep.nativeSweepTxidHex,
        verbose: true,
      },
    ]);
    assert.equal(solanaRpc.sendCalls.length, 2);
    const receiptSignature = base58Encode(Buffer.from(solanaRpc.sendCalls[0].preparedTransactionBase64, "base64").subarray(1, 65));
    assert.deepEqual(solanaRpc.statusCalls, [receiptSignature, receiptSignature, solanaRpc.solanaSignature]);
    assert.deepEqual(solanaRpc.transactionCalls, [solanaRpc.solanaSignature]);
    assert.deepEqual(solanaRpc.accountInfoCalls, [
      expectedPrepared.depositClaimAccountBase58,
      expectedPrepared.mintAccountBase58,
    ]);
    assert.doesNotMatch(JSON.stringify(result), /WAITING_FOR_ADMIN_APPROVAL/u);
  } finally {
    runtime.frost.cleanup();
  }
});

test("restart after Native sweep broadcast resumes without duplicate broadcast or mint", async () => {
  const stateRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-phase08-restart-after-sweep-"));
  const depositJournalRoot = path.join(stateRoot, "deposit-journal");
  const nativeJournalRoot = path.join(stateRoot, "native-sweep-journal");
  const solanaJournalRoot = path.join(stateRoot, "solana-claim-journal");
  const config = baseConfig();
  const operation = operationWithComputedId(config);
  const depositJournalOptions = {
    root: depositJournalRoot,
    repoRoot: REPO_ROOT,
  };
  const nativeJournalOptions = {
    root: nativeJournalRoot,
    repoRoot: REPO_ROOT,
  };
  const solanaJournalOptions = {
    root: solanaJournalRoot,
    repoRoot: REPO_ROOT,
  };

  try {
    const firstNativeRpc = new FakeIntegratedNativeReserveRpc(operation, {
      confirmations: 2,
    });
    const firstNativeRelayer = new NativeReserveSweepRelayer({
      config: {
        environment: "localnet",
      },
      rpcClient: firstNativeRpc,
      journal: new FileBackedNativeReserveSweepJournal(nativeJournalOptions),
    });
    const firstReserveVerifier = new NativeReserveSweepVerifier({
      config: {
        trust: "LOCALLY_VALIDATED_CHAIN_STATE",
        expectedSourceNetwork: "regtest",
        requiredConfirmations: 6,
        nativeDecimals: 8,
      },
      rpcClient: firstNativeRpc,
    });
    const firstRuntime = createPipeline({
      operation,
      nativeRelayer: firstNativeRelayer,
      reserveVerifier: firstReserveVerifier,
      solanaBridge: {
        submitDepositClaim() {
          throw new Error("Solana claim must not submit before reserve finality");
        },
      },
      journal: new FileBackedDepositJournal(depositJournalOptions),
    });
    try {
      const firstResult = await firstRuntime.pipeline.processDepositAsync(operation, 1_700_000_600);
      assert.equal(firstResult.state, DEPOSIT_STATES.WAITING_FOR_FINALITY);
      assert.equal(firstResult.reason, "RESERVE_SWEEP_FINALITY_NOT_SATISFIED");
      assert.deepEqual(firstNativeRpc.sendCalls, [operation.reserveSweep.signedNativeTransactionHex]);
    } finally {
      firstRuntime.frost.cleanup();
    }

    const { encodedMessageHex, decodedMessage } = buildDepositClaimMessage(config, operation);
    const secondNativeRpc = new FakeIntegratedNativeReserveRpc(operation, {
      confirmations: 8,
    });
    const secondNativeRelayer = new NativeReserveSweepRelayer({
      config: {
        environment: "localnet",
      },
      rpcClient: secondNativeRpc,
      journal: new FileBackedNativeReserveSweepJournal(nativeJournalOptions),
    });
    const secondReserveVerifier = new NativeReserveSweepVerifier({
      config: {
        trust: "LOCALLY_VALIDATED_CHAIN_STATE",
        expectedSourceNetwork: "regtest",
        requiredConfirmations: 6,
        nativeDecimals: 8,
      },
      rpcClient: secondNativeRpc,
    });
    const feePayer = feePayerKeypairForPipelineTest();
    const feePayerSigner = feePayerSignerForPipelineTest(feePayer);
    const solanaBridgeConfig = localnetBridgeConfigForPipeline(config, feePayer);
    const solanaRpc = new FakeIntegratedLocalnetSolanaRpc({
      claimAccountBase64: depositClaimAccountBase64ForMessage(decodedMessage),
    });
    const expectedPrepared = await prepareLocalnetSolanaDepositClaimRequest(
      solanaBridgeConfig,
      {
        operationIdHex: decodedMessage.operationIdHex,
        encodedMessageHex,
        messageDigestHex: decodedMessage.messageDigestHex,
        amountAtomic: decodedMessage.amountAtomic.toString(),
        solanaRecipientHex: decodedMessage.destinationHex,
      },
      {
        feePayerSigner,
        blockhashSource: solanaRpc,
      },
    );
    solanaRpc.expectAccounts({
      depositClaimAccountBase58: expectedPrepared.depositClaimAccountBase58,
      mintAccountBase58: expectedPrepared.mintAccountBase58,
    });
    const claimObserver = new SolanaDepositClaimObserver({
      config: {
        environment: "localnet",
        cluster: "localnet",
        managerProgramIdHex: config.deployment.managerProgramId,
        transceiverProgramIdHex: config.deployment.transceiverProgramId,
        mintHex: config.deployment.mint,
      },
      rpcClient: solanaRpc,
    });
    const solanaBridge = new LocalnetSolanaDepositClaimBridge({
      config: solanaBridgeConfig,
      feePayerSigner,
      rpcClient: solanaRpc,
      claimObserver,
      journal: new FileBackedSolanaDepositClaimJournal(solanaJournalOptions),
    });
    const secondRuntime = createPipeline({
      operation,
      nativeRelayer: secondNativeRelayer,
      reserveVerifier: secondReserveVerifier,
      solanaBridge,
      journal: new FileBackedDepositJournal(depositJournalOptions),
    });
    try {
      const secondResult = await secondRuntime.pipeline.processDepositAsync(operation, 1_700_000_700);
      assert.equal(secondResult.state, DEPOSIT_STATES.COMPLETED);
      assert.equal(secondResult.reason, "ALL_REQUIRED_CHECKS_PASSED");
      assert.equal(secondResult.mintedAmountAtomic, operation.deposit.amountAtomic);
      assert.deepEqual(secondNativeRpc.sendCalls, []);
      assert.equal(solanaRpc.sendCalls.length, 2);
      assert.equal(secondRuntime.pipeline.ledgerSnapshot().mintedSupply, operation.deposit.amountAtomic);
      assert.doesNotMatch(JSON.stringify(secondResult), /WAITING_FOR_ADMIN_APPROVAL/u);
    } finally {
      secondRuntime.frost.cleanup();
    }
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("automatic Native to Solana pipeline completes without a per-transfer KingPepe Team approval state", () => {
  const runtime = createPipeline();
  try {
    const result = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(result.reason, "ALL_REQUIRED_CHECKS_PASSED");
    assert.equal(result.threshold, 2);
    assert.deepEqual(result.signerIds, REQUIRED_FROST_SIGNERS);
    assert.equal(result.ledger.canonicalReserve, "250000000");
    assert.equal(result.ledger.mintedSupply, "250000000");
    assert.equal(result.ledger.authorizedUnmintedCredits, "0");
    assert.equal(result.ledger.coverageRequired, "250000000");
    assert.equal(runtime.nativeRelayer.broadcasts.length, 1);
    assert.equal(runtime.solanaBridge.submissions.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /WAITING_FOR_ADMIN_APPROVAL/u);
  } finally {
    runtime.frost.cleanup();
  }
});

test("completed deposit retry is idempotent and does not mint or broadcast twice", () => {
  const runtime = createPipeline();
  try {
    const first = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    const second = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    assert.deepEqual(second, first);
    assert.equal(runtime.nativeRelayer.broadcasts.length, 1);
    assert.equal(runtime.solanaBridge.submissions.length, 1);
    assert.equal(runtime.pipeline.ledgerSnapshot().mintedSupply, "250000000");
  } finally {
    runtime.frost.cleanup();
  }
});

test("file-backed deposit journal survives restart and does not rebroadcast completed deposits", () => {
  const journalRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-deposit-journal-"));
  const first = createPipeline({
    journal: new FileBackedDepositJournal({
      root: journalRoot,
      repoRoot: REPO_ROOT,
    }),
  });
  let firstResult;
  try {
    firstResult = first.pipeline.processDeposit(first.operation, 1_700_000_600);
    assert.equal(firstResult.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(first.nativeRelayer.broadcasts.length, 1);
    assert.equal(first.solanaBridge.submissions.length, 1);
  } finally {
    first.frost.cleanup();
  }

  const restarted = createPipeline({
    journal: new FileBackedDepositJournal({
      root: journalRoot,
      repoRoot: REPO_ROOT,
    }),
  });
  try {
    const replay = restarted.pipeline.processDeposit(restarted.operation, 1_700_000_700);
    assert.deepEqual(replay, firstResult);
    assert.equal(restarted.nativeRelayer.broadcasts.length, 0);
    assert.equal(restarted.solanaBridge.submissions.length, 0);
  } finally {
    restarted.frost.cleanup();
    rmSync(journalRoot, { recursive: true, force: true });
  }
});

test("file-backed deposit journal persists outpoint reservations across restarts", () => {
  const journalRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-deposit-outpoint-journal-"));
  const pending = createPipeline({
    journal: new FileBackedDepositJournal({
      root: journalRoot,
      repoRoot: REPO_ROOT,
    }),
    operation: {
      deposit: {
        finalitySatisfied: false,
      },
    },
  });
  try {
    const result = pending.pipeline.processDeposit(pending.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_FINALITY);
  } finally {
    pending.frost.cleanup();
  }

  const conflicting = createPipeline({
    journal: new FileBackedDepositJournal({
      root: journalRoot,
      repoRoot: REPO_ROOT,
    }),
    operation: {
      deposit: {
        solanaRecipientHex: h("different-recipient"),
      },
    },
  });
  try {
    assert.throws(
      () => conflicting.pipeline.processDeposit(conflicting.operation, 1_700_000_700),
      /DepositOutpointAlreadyReserved/u,
    );
  } finally {
    conflicting.frost.cleanup();
    rmSync(journalRoot, { recursive: true, force: true });
  }
});

test("file-backed deposit journal rejects roots inside the source tree", () => {
  assert.throws(
    () =>
      new FileBackedDepositJournal({
        root: path.join(REPO_ROOT, "tmp-deposit-journal"),
        repoRoot: REPO_ROOT,
      }),
    /InsideRepositoryRejected/u,
  );
});

test("recoverable deposit observation cannot mint before canonical reserve transition finality", () => {
  const runtime = createPipeline({
    reserveVerifier: {
      verifyFinalizedReserveSweep(request) {
        return {
          trust: "LOCALLY_VALIDATED_CHAIN_STATE",
          nativeNetwork: runtime.config.deployment.nativeNetwork,
          nativeGenesisHash: runtime.config.deployment.nativeGenesis,
          operationIdHex: request.operationIdHex,
          depositOutpoint: outpointText(runtime.operation.deposit.depositOutpoint),
          amountAtomic: runtime.operation.deposit.amountAtomic,
          solanaRecipientHex: runtime.operation.deposit.solanaRecipientHex,
          evidenceDigestHex: request.evidenceDigestHex,
          reserveAllocationIdHex: runtime.operation.reserveSweep.reserveAllocationIdHex,
          reserveTransitionState: "TEMPORARY_RECOVERABLE",
          mintCreditState: "AUTHORIZED_UNCONSUMED",
          finalitySatisfied: true,
          sweepFinalized: false,
          utxoUnspentAtDeposit: true,
          noPriorConsumption: true,
          nativeSweepTxidHex: runtime.operation.reserveSweep.nativeSweepTxidHex,
        };
      },
    },
  });
  try {
    const result = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_FINALITY);
    assert.equal(result.reason, "RESERVE_SWEEP_FINALITY_NOT_SATISFIED");
    assert.equal(runtime.solanaBridge.submissions.length, 0);
    assert.equal(runtime.pipeline.ledgerSnapshot().mintedSupply, "0");
  } finally {
    runtime.frost.cleanup();
  }
});

test("invalid Native evidence blocks automatic FROST signing and minting", () => {
  const runtime = createPipeline({
    operation: {
      deposit: {
        trust: "RPC_OBSERVATION",
      },
    },
  });
  try {
    const result = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
    assert.equal(result.reason, "NATIVE_TRUST_NOT_ACCEPTED");
    assert.equal(runtime.nativeRelayer.broadcasts.length, 0);
    assert.equal(runtime.solanaBridge.submissions.length, 0);
  } finally {
    runtime.frost.cleanup();
  }
});

test("FROST signer unavailability does not fall back to one signer", () => {
  const runtime = createPipeline();
  try {
    runtime.frost.signerB.setAvailableForTestOnly(false);
    const result = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
    assert.equal(result.reason, "FROST_A_B_NOT_AVAILABLE");
    assert.equal(result.frostState, "WAITING_FOR_QUORUM");
    assert.equal(runtime.nativeRelayer.broadcasts.length, 0);
    assert.equal(runtime.solanaBridge.submissions.length, 0);
  } finally {
    runtime.frost.cleanup();
  }
});

test("altered reserve evidence rejects before project attestations and minting", () => {
  const runtime = createPipeline({
    reserveVerifier: {
      verifyFinalizedReserveSweep(request) {
        return {
          trust: "LOCALLY_VALIDATED_CHAIN_STATE",
          nativeNetwork: runtime.config.deployment.nativeNetwork,
          nativeGenesisHash: runtime.config.deployment.nativeGenesis,
          operationIdHex: request.operationIdHex,
          depositOutpoint: outpointText(runtime.operation.deposit.depositOutpoint),
          amountAtomic: "250000001",
          solanaRecipientHex: runtime.operation.deposit.solanaRecipientHex,
          evidenceDigestHex: request.evidenceDigestHex,
          reserveAllocationIdHex: runtime.operation.reserveSweep.reserveAllocationIdHex,
          reserveTransitionState: "CANONICAL_RESERVE",
          mintCreditState: "AUTHORIZED_UNCONSUMED",
          finalitySatisfied: true,
          sweepFinalized: true,
          utxoUnspentAtDeposit: true,
          noPriorConsumption: true,
          nativeSweepTxidHex: runtime.operation.reserveSweep.nativeSweepTxidHex,
        };
      },
    },
  });
  try {
    const result = runtime.pipeline.processDeposit(runtime.operation, 1_700_000_600);
    assert.equal(result.state, DEPOSIT_STATES.REJECTED);
    assert.equal(result.reason, "RESERVE_EVIDENCE_MISMATCH");
    assert.equal(runtime.solanaBridge.submissions.length, 0);
  } finally {
    runtime.frost.cleanup();
  }
});

function deepMerge(base, override) {
  if (override === undefined) return structuredClone(base);
  if (base === null || typeof base !== "object" || Array.isArray(base)) {
    return structuredClone(override);
  }
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value) && merged[key] && typeof merged[key] === "object") {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}
