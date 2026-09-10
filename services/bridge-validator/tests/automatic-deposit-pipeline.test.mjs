import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
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
  ExactDepositLedger,
  InMemoryDepositJournal,
  FileBackedDepositJournal,
  buildDepositClaimMessage,
} from "../automatic-deposit-pipeline.mjs";
import { bytesToHex, encodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
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
import { base58Decode, base58Encode, findProgramAddress } from "../solana-deposit-claim-transaction-plan.mjs";
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
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";
import { AuthenticatedLocalDepositLedger } from "../local-deposit-ledger.mjs";
import { preserveOperationHardStop, readOperationHardStop } from "../../../shared/operation-hard-stop.mjs";

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
      nativeGenesis: REGTEST_GENESIS,
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
  const auth = operation.reserveSweep.signingIntent;
  const policy = createNativeSigningPolicy({
    environment: "localnet",
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
    stateStore: FileBackedFrostStateStore.createLocal({
      policy,
      signerId: REQUIRED_FROST_SIGNERS[0],
      root: path.join(root, "frost-a"),
      repoRoot: REPO_ROOT,
    }),
  });
  const signerB = new NativeFrostSigner({
    signerId: REQUIRED_FROST_SIGNERS[1],
    index: 1,
    policy,
    stateStore: FileBackedFrostStateStore.createLocal({
      policy,
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
  // Fault injection decorates transport adapters, never the immutable signing
  // objects or their policy/key material. Delegates still perform real signing.
  const attesters = [attesterA, attesterB].map(attester => ({
    signDepositCredit: (...args) => attester.signDepositCredit(...args),
  }));
  const pipeline = new AutomaticNativeToSolanaDepositPipeline({
    config,
    frostCoordinator: frost.coordinator,
    attesters,
    nativeRelayer,
    reserveVerifier,
    solanaBridge,
    journal: overrides.journal,
    ledger: overrides.ledger,
  });
  return { config, operation, frost, attesters, nativeRelayer, reserveVerifier, solanaBridge, pipeline };
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
    tokenProgramIdHex: Buffer.from(base58Decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")).toString("hex"),
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
    this.solanaSignature = base58Encode(Buffer.from(preparedTransactionBase64, "base64").subarray(1, 65));
    this.submittedSignatures.add(this.solanaSignature);
    return this.solanaSignature;
  }

  async getSignatureStatus(solanaSignature) {
    this.statusCalls.push(solanaSignature);
    if (!this.submittedSignatures.has(solanaSignature)) return null;
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
    assert.deepEqual(rpc.statusCalls, [receiptSignature, receiptSignature, rpc.solanaSignature, rpc.solanaSignature]);
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
    assert.deepEqual(solanaRpc.statusCalls, [receiptSignature, receiptSignature, solanaRpc.solanaSignature, solanaRpc.solanaSignature]);
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

for (const asyncAdapters of [false, true]) {
  const mode = asyncAdapters ? "async" : "sync";
  const process = (runtime, now = 1_700_000_600) => asyncAdapters
    ? runtime.pipeline.processDepositAsync(runtime.operation, now)
    : runtime.pipeline.processDeposit(runtime.operation, now);

  test(`${mode} pending mint retries retain one credit and settle it once`, async () => {
    let attempts = 0;
    const runtime = createPipeline({ asyncAdapters, solanaBridge: {
      submitDepositClaim(request) {
        if (++attempts < 3) return { state: DEPOSIT_STATES.WAITING_FOR_DEPENDENCY };
        return { state: DEPOSIT_STATES.COMPLETED, mintedAmountAtomic: request.amountAtomic };
      },
    } });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal((await process(runtime)).state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
        assert.deepEqual(runtime.pipeline.ledgerSnapshot(), {
          canonicalReserve: "250000000", mintedSupply: "0", authorizedUnmintedCredits: "250000000",
          feesAccrued: "0", unsettledOperations: "1", coverageRequired: "250000000", surplus: "0",
        });
      }
      const completed = await process(runtime);
      assert.equal(completed.state, DEPOSIT_STATES.COMPLETED);
      assert.equal(completed.ledger.authorizedUnmintedCredits, "0");
      assert.equal(completed.ledger.mintedSupply, "250000000");
      assert.equal(completed.ledger.unsettledOperations, "0");
      assert.deepEqual(await process(runtime), completed);
      assert.equal(attempts, 3);
    } finally { runtime.frost.cleanup(); }
  });

  test(`${mode} finalized reserve credit survives failed attestation`, async () => {
    const runtime = createPipeline({ asyncAdapters });
    try {
      await assert.rejects(async () => process(runtime, 1_700_001_300), (error) =>
        error.message === "AttestationNotAuthorized:MESSAGE_EXPIRED" &&
        error.decision?.state === DEPOSIT_STATES.REJECTED && error.decision?.reason === "MESSAGE_EXPIRED");
      assert.equal(runtime.solanaBridge.submissions.length, 0);
      assert.equal(runtime.pipeline.ledgerSnapshot().authorizedUnmintedCredits, "250000000");
      assert.equal(runtime.pipeline.ledgerSnapshot().mintedSupply, "0");
    } finally { runtime.frost.cleanup(); }
  });

  test(`${mode} downstream exception preserves credit and retry does not inflate backing`, async () => {
    let attempts = 0;
    const runtime = createPipeline({ asyncAdapters, solanaBridge: {
      submitDepositClaim(request) {
        if (++attempts === 1) throw new Error("TestDependencyUnavailable");
        return { state: DEPOSIT_STATES.COMPLETED, mintedAmountAtomic: request.amountAtomic };
      },
    } });
    try {
      await assert.rejects(async () => process(runtime), /TestDependencyUnavailable/u);
      assert.equal(runtime.pipeline.ledgerSnapshot().authorizedUnmintedCredits, "250000000");
      assert.equal((await process(runtime)).state, DEPOSIT_STATES.COMPLETED);
      assert.equal(runtime.pipeline.ledgerSnapshot().canonicalReserve, "250000000");
      assert.equal(runtime.pipeline.ledgerSnapshot().authorizedUnmintedCredits, "0");
    } finally { runtime.frost.cleanup(); }
  });

  test(`${mode} imprecise mint result hard-stops without discharging the credit`, async () => {
    const runtime = createPipeline({ asyncAdapters, solanaBridge: {
      submitDepositClaim() { return { state: DEPOSIT_STATES.COMPLETED, mintedAmountAtomic: 250000000 }; },
    } });
    try {
      const result = await process(runtime);
      assert.equal(result.state, DEPOSIT_STATES.HARD_STOP);
      assert.equal(result.reason, "SOLANA_MINT_AMOUNT_MISMATCH");
      assert.equal(runtime.pipeline.ledgerSnapshot().authorizedUnmintedCredits, "250000000");
      assert.equal(runtime.pipeline.ledgerSnapshot().mintedSupply, "0");
    } finally { runtime.frost.cleanup(); }
  });

  test(`${mode} a recorded pipeline hard stop blocks retry before FROST or broadcast`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-pipeline-stop-"));
    const journal = new FileBackedDepositJournal({ root, repoRoot: REPO_ROOT });
    let mintCalls = 0;
    const runtime = createPipeline({ asyncAdapters, journal, solanaBridge: {
      submitDepositClaim(request) { mintCalls++; return { state: DEPOSIT_STATES.COMPLETED,
        mintedAmountAtomic: mintCalls === 1 ? 250000000 : request.amountAtomic }; },
    } });
    try {
      const stopped = await process(runtime);
      assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
      runtime.frost.coordinator.signAutomatically = () => { throw new Error("SigningMustNotResumeAfterHardStop"); };
      assert.deepEqual(await process(runtime), stopped);
      assert.equal(runtime.nativeRelayer.broadcasts.length, 1);
      assert.equal(mintCalls, 1);
      const reopened = new FileBackedDepositJournal({ root, repoRoot: REPO_ROOT });
      const id = runtime.operation.reserveSweep.signingIntent.operationId;
      assert.throws(() => reopened.record(id, DEPOSIT_STATES.OBSERVED, "RETRY"), /HardStop/u);
      assert.throws(() => reopened.finish(id, { ...stopped, state: DEPOSIT_STATES.COMPLETED }), /HardStop/u);
      assert.deepEqual(reopened.finish(id, stopped), stopped);
    } finally { runtime.frost.cleanup(); rmSync(root, { recursive: true, force: true }); }
  });

  test(`${mode} a stopped accounting ledger blocks a fresh operation before signing`, async () => {
    const ledger = new ExactDepositLedger();
    ledger.hardStop("ECONOMIC_CONTRADICTION");
    const runtime = createPipeline({ asyncAdapters, ledger });
    try {
      runtime.frost.coordinator.signAutomatically = () => { throw new Error("SigningMustNotStartWithStoppedLedger"); };
      const result = await process(runtime);
      assert.equal(result.state, DEPOSIT_STATES.HARD_STOP);
      assert.equal(runtime.nativeRelayer.broadcasts.length, 0);
      assert.equal(runtime.solanaBridge.submissions.length, 0);
    } finally { runtime.frost.cleanup(); }
  });

  test(`${mode} a Native adapter integrity stop is not downgraded to dependency waiting`, async () => {
    let calls = 0;
    const runtime = createPipeline({ asyncAdapters, nativeRelayer: {
      broadcastReserveSweep() { calls++; return { state: DEPOSIT_STATES.HARD_STOP, reason: "NATIVE_INTEGRITY_STOP" }; },
    } });
    try {
      const stopped = await process(runtime);
      assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
      assert.deepEqual(await process(runtime), stopped);
      assert.equal(calls, 1);
      assert.equal(runtime.solanaBridge.submissions.length, 0);
    } finally { runtime.frost.cleanup(); }
  });

  test(`${mode} a Solana adapter integrity stop retains the credit and blocks all retries`, async () => {
    const ledger = new ExactDepositLedger();
    let calls = 0;
    const runtime = createPipeline({ asyncAdapters, ledger, solanaBridge: {
      submitDepositClaim() { calls++; return { state: DEPOSIT_STATES.HARD_STOP, reason: "SOLANA_INTEGRITY_STOP" }; },
    } });
    try {
      const stopped = await process(runtime);
      assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
      assert.equal(stopped.reason, "SOLANA_INTEGRITY_STOP");
      runtime.frost.coordinator.signAutomatically = () => { throw new Error("SigningMustNotResume"); };
      assert.deepEqual(await process(runtime), stopped);
      assert.equal(calls, 1);
      assert.deepEqual(ledger.status(), { state: DEPOSIT_STATES.HARD_STOP, reason: "SOLANA_INTEGRITY_STOP" });
      assert.equal(ledger.snapshot().authorizedUnmintedCredits, "250000000");
      assert.equal(ledger.snapshot().mintedSupply, "0");
    } finally { runtime.frost.cleanup(); }
  });

  for (const boundary of ["frost", "attester"]) {
    test(`${mode} a stop raised during ${boundary} blocks the next privileged action`, async () => {
      const ledger = new ExactDepositLedger();
      const runtime = createPipeline({ asyncAdapters, ledger });
      try {
        const [target, method] = boundary === "frost" ? [runtime.frost.coordinator, "signAutomatically"] : [runtime.attesters[0], "signDepositCredit"];
        const original = target[method].bind(target);
        target[method] = (...args) => { const result = original(...args); ledger.hardStop("INTEGRITY_STOP_DURING_SIGNING"); return result; };
        runtime.attesters[1].signDepositCredit = () => { throw new Error("SecondAttesterMustNotRun"); };
        const stopped = await process(runtime);
        assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
        assert.equal(stopped.reason, "INTEGRITY_STOP_DURING_SIGNING");
        assert.equal(runtime.nativeRelayer.broadcasts.length, boundary === "frost" ? 0 : 1);
        assert.equal(runtime.solanaBridge.submissions.length, 0);
        assert.deepEqual(await process(runtime), stopped);
      } finally { runtime.frost.cleanup(); }
    });
  }

  test(`${mode} unknown ledger status cannot authorize signing`, async () => {
    const ledger = new ExactDepositLedger();
    ledger.status = () => ({ state: "UNKNOWN" });
    const runtime = createPipeline({ asyncAdapters, ledger });
    try {
      runtime.frost.coordinator.signAutomatically = () => { throw new Error("SigningMustNotStart"); };
      await assert.rejects(async () => process(runtime), /DepositLedgerStatusUnavailable/u);
      assert.equal(runtime.nativeRelayer.broadcasts.length, 0);
      assert.equal(runtime.solanaBridge.submissions.length, 0);
    } finally { runtime.frost.cleanup(); }
  });
}

for (const boundary of ["native", "reserve", "mint"]) {
  test(`async pipeline rechecks a reopened journal after pending ${boundary} response`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-pipeline-late-stop-"));
    const journal = new FileBackedDepositJournal({ root, repoRoot: REPO_ROOT });
    const ledger = new ExactDepositLedger();
    const runtime = createPipeline({ asyncAdapters: true, journal, ledger });
    try {
      const [target, method] = { native: [runtime.nativeRelayer, "broadcastReserveSweep"],
        reserve: [runtime.reserveVerifier, "verifyFinalizedReserveSweep"], mint: [runtime.solanaBridge, "submitDepositClaim"] }[boundary];
      const original = target[method].bind(target);
      const entered = Promise.withResolvers();
      const response = Promise.withResolvers();
      target[method] = async (...args) => { const value = await original(...args); entered.resolve(value); return response.promise; };
      const pending = runtime.pipeline.processDepositAsync(runtime.operation, 1_700_000_600);
      const value = await entered.promise;
      const id = runtime.operation.reserveSweep.signingIntent.operationId;
      const stopped = { state: DEPOSIT_STATES.HARD_STOP, reason: "PIPELINE_INTEGRITY_STOP", operationIdHex: id };
      const writer = new FileBackedDepositJournal({ root, repoRoot: REPO_ROOT });
      writer.finish(id, stopped);
      response.resolve(value);
      assert.deepEqual(await pending, stopped);
      runtime.frost.coordinator.signAutomatically = () => { throw new Error("SigningMustNotResume"); };
      assert.deepEqual(await runtime.pipeline.processDepositAsync(runtime.operation, 1_700_000_600), stopped);
      assert.deepEqual(ledger.status(), { state: DEPOSIT_STATES.HARD_STOP, reason: stopped.reason });
      assert.equal(runtime.solanaBridge.submissions.length, boundary === "mint" ? 1 : 0);
      assert.equal(ledger.snapshot().mintedSupply, "0");
      if (boundary === "mint") assert.equal(ledger.snapshot().authorizedUnmintedCredits, "250000000");
    } finally { runtime.frost.cleanup(); rmSync(root, { recursive: true, force: true }); }
  });
}

test("authenticated ledger stop survives pipeline replacement and blocks another operation", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-pipeline-ledger-stop-"));
  const config = baseConfig();
  config.deployment.nativeGenesis = REGTEST_GENESIS;
  const options = { root, repoRoot: REPO_ROOT, environment: "localnet",
    deploymentHex: ledgerCredit({}, config).encodedMessageHex.slice(24, 360),
    journalIdHex: h("pipeline-stop-journal"), authenticationKey: randomBytes(32) };
  let ledger;
  const runtimes = [];
  try {
    ledger = AuthenticatedLocalDepositLedger.createLocal(options);
    const first = createPipeline({ config, ledger, solanaBridge: {
      submitDepositClaim() { return { state: DEPOSIT_STATES.HARD_STOP, reason: "SOLANA_INTEGRITY_STOP" }; },
    } });
    runtimes.push(first);
    assert.equal(first.pipeline.processDeposit(first.operation, 1_700_000_600).state, DEPOSIT_STATES.HARD_STOP);
    const checkpoint = ledger.checkpoint();
    ledger.close();
    ledger = AuthenticatedLocalDepositLedger.openLocal({ ...options, minimumCheckpoint: checkpoint });
    const second = createPipeline({ config, ledger, operation: { deposit: { depositOutpoint: outpoint("new-operation-after-stop") } } });
    runtimes.push(second);
    second.frost.coordinator.signAutomatically = () => { throw new Error("SigningMustNotStartWithRestoredStop"); };
    const stopped = await second.pipeline.processDepositAsync(second.operation, 1_700_000_600);
    assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
    assert.equal(stopped.reason, "SOLANA_INTEGRITY_STOP");
    assert.equal(second.nativeRelayer.broadcasts.length, 0);
    assert.equal(second.solanaBridge.submissions.length, 0);
    assert.equal(ledger.snapshot().authorizedUnmintedCredits, "250000000");
    assert.equal(ledger.snapshot().mintedSupply, "0");
    assert.deepEqual(ledger.checkpoint(), checkpoint);
  } finally {
    for (const runtime of runtimes) runtime.frost.cleanup();
    ledger?.close(); options.authenticationKey.fill(0); rmSync(root, { recursive: true, force: true });
  }
});

test("ledger hard stop is absorbing, immutable and inherited by a fork without economic changes", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  ledger.recordValidatedDeposit(credit);
  const before = ledger.snapshot();
  ledger.hardStop("ECONOMIC_CONTRADICTION");
  ledger.hardStop("ECONOMIC_CONTRADICTION");
  assert.throws(() => ledger.hardStop("RETRY"), /LedgerHardStop/u);
  assert.throws(() => ledger.recordMint({ ...credit, mintedAmountAtomic: "250000000" }), /LedgerHardStop/u);
  assert.throws(() => ledger.recordValidatedDeposit(credit), /LedgerHardStop/u);
  assert.throws(() => { ledger.status().state = "OPEN_IN_MEMORY_ACCOUNTING_ONLY"; }, TypeError);
  const fork = ledger.fork();
  assert.deepEqual(fork.status(), ledger.status());
  assert.throws(() => fork.recordValidatedDeposit(credit), /LedgerHardStop/u);
  assert.deepEqual(ledger.snapshot(), before);
  assert.deepEqual(fork.snapshot(), before);
});

test("memory pipeline journal returns immutable copies and requires a complete stop decision", () => {
  const journal = new InMemoryDepositJournal();
  const credit = ledgerCredit();
  const { decodedMessage } = buildDepositClaimMessage(baseConfig(), operationWithComputedId(baseConfig()));
  const id = decodedMessage.operationIdHex;
  journal.reserveOperation(id, decodedMessage.depositOutpointText, credit.encodedMessageHex);
  assert.throws(() => journal.record(id, DEPOSIT_STATES.HARD_STOP, "INTEGRITY_STOP"), /HardStopDecisionRequired/u);
  const stopped = { state: DEPOSIT_STATES.HARD_STOP, reason: "INTEGRITY_STOP", operationIdHex: id };
  journal.finish(id, stopped);
  journal.stopped(id).reason = "CHANGED";
  assert.deepEqual(journal.stopped(id), stopped);
  assert.throws(() => journal.record(id, DEPOSIT_STATES.OBSERVED, "RETRY"), /HardStop/u);
  assert.throws(() => journal.finish(id, { ...stopped, reason: "CHANGED" }), /HardStop/u);
  assert.deepEqual(journal.finish(id, stopped), stopped);
});

test("inconsistent hard-stop markers fail closed and cannot be overwritten", () => {
  for (const [state, decision] of [[DEPOSIT_STATES.HARD_STOP, undefined],
    ["SUBMITTED", { state: DEPOSIT_STATES.HARD_STOP, reason: "INTEGRITY_STOP" }],
    [DEPOSIT_STATES.HARD_STOP, { state: DEPOSIT_STATES.HARD_STOP }]]) {
    assert.throws(() => readOperationHardStop(state, decision), /HardStopRecordInvalid/u);
    assert.throws(() => preserveOperationHardStop(state, decision, { state: "COMPLETED" }), /HardStopRecordInvalid/u);
  }
});

test("unapproved project fee is rejected before any Native signing or transfer", () => {
  const runtime = createPipeline({ operation: { deposit: { projectBridgeFeeAtomic: "1" } } });
  try {
    const result = runtime.pipeline.processDeposit(runtime.operation);
    assert.equal(result.reason, "PROJECT_BRIDGE_FEE_MUST_BE_ZERO");
    assert.equal(result.state, DEPOSIT_STATES.REJECTED);
    assert.equal(runtime.nativeRelayer.broadcasts.length, 0);
    assert.equal(runtime.solanaBridge.submissions.length, 0);
    assert.equal(runtime.pipeline.ledgerSnapshot().canonicalReserve, "0");
  } finally { runtime.frost.cleanup(); }
});

function ledgerCredit(overrides = {}, config = baseConfig()) {
  const operation = operationWithComputedId(config, overrides);
  return {
    encodedMessageHex: buildDepositClaimMessage(config, operation).encodedMessageHex,
    reserveAllocationIdHex: operation.reserveSweep.reserveAllocationIdHex,
  };
}

test("ledger binds credit and mint idempotence to the exact canonical operation", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  ledger.recordValidatedDeposit(credit);
  const pending = ledger.snapshot();
  ledger.recordValidatedDeposit(credit);
  assert.deepEqual(ledger.snapshot(), pending);
  ledger.recordMint({ ...credit, mintedAmountAtomic: "250000000" });
  const settled = ledger.snapshot();
  ledger.recordMint({ ...credit, mintedAmountAtomic: 250000000n });
  ledger.recordValidatedDeposit(credit);
  assert.deepEqual(ledger.snapshot(), settled);
  assert.equal(settled.unsettledOperations, "0");
  assert.equal(settled.authorizedUnmintedCredits, "0");
});

test("ledger rejects coercible, negative, zero, inexact and mismatched mint values without mutation", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  ledger.recordValidatedDeposit(credit);
  const before = ledger.snapshot();
  for (const amount of [-1n, 0n, 1n << 64n, null, undefined, true, false, NaN, Infinity,
    250000000, Number.MAX_SAFE_INTEGER + 1, "-1", "0", "01", " 250000000", "2.5e8", "250000000.0",
    {}, { toString: () => "250000000" }, "250000001", "249999999", "1".repeat(21)]) {
    assert.throws(() => ledger.recordMint({ ...credit, mintedAmountAtomic: amount }), /Ledger/u);
    assert.deepEqual(ledger.snapshot(), before);
  }
  ledger.recordMint({ ...credit, mintedAmountAtomic: "250000000" });
  assert.equal(ledger.snapshot().mintedSupply, "250000000");
});

test("ledger cannot use another operation's pending credit or alter its allocation", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  ledger.recordValidatedDeposit(credit);
  const before = ledger.snapshot();
  const unknown = ledgerCredit({ messageNonceHex: h("different-credit-nonce") });
  assert.throws(() => ledger.recordMint({ ...unknown, mintedAmountAtomic: "250000000" }), /LedgerUnknownCredit/u);
  const altered = { ...credit, reserveAllocationIdHex: h("altered-allocation") };
  assert.throws(() => ledger.recordValidatedDeposit(altered), /LedgerCreditReplayAltered/u);
  assert.throws(() => ledger.recordMint({ ...altered, mintedAmountAtomic: "250000000" }), /LedgerCreditReplayAltered/u);
  assert.deepEqual(ledger.snapshot(), before);
});

test("ledger retains backing markers across recipients, amounts, messages and epochs after mint", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  ledger.recordValidatedDeposit(credit);
  ledger.recordMint({ ...credit, mintedAmountAtomic: "250000000" });
  const before = ledger.snapshot();
  const changed = [
    ledgerCredit({ messageNonceHex: h("new-nonce") }),
    ledgerCredit({ deposit: { solanaRecipientHex: h("new-recipient") } }),
    ledgerCredit({ deposit: { amountAtomic: "250000001" } }),
    ledgerCredit({}, baseConfig({ policyEpoch: 2 })),
    ledgerCredit({}, baseConfig({ keyEpoch: 2 })),
    ledgerCredit({ reserveSweep: { nativeSweepTxidHex: h("another-sweep"), reserveAllocationIdHex: h("another-allocation") } }),
  ];
  for (const input of changed) {
    assert.throws(() => ledger.recordValidatedDeposit(input), /LedgerBackingAlreadyAllocated/u);
    assert.deepEqual(ledger.snapshot(), before);
  }
});

test("ledger rejects allocation reuse by another outpoint without poisoning a valid later credit", () => {
  const ledger = new ExactDepositLedger();
  ledger.recordValidatedDeposit(ledgerCredit());
  const before = ledger.snapshot();
  const another = ledgerCredit({ deposit: { depositOutpoint: outpoint("another-backing") } });
  assert.throws(() => ledger.recordValidatedDeposit(another), /LedgerReserveAllocationReused/u);
  assert.deepEqual(ledger.snapshot(), before);
  ledger.recordValidatedDeposit({ ...another, reserveAllocationIdHex: h("unique-allocation") });
  assert.equal(ledger.snapshot().authorizedUnmintedCredits, "500000000");
});

test("ledger rejects alternate domains, non-deposit messages, nonzero fees and malformed canonical bytes", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  ledger.recordValidatedDeposit(credit);
  const before = ledger.snapshot();
  for (const field of ["nativeGenesis", "solanaDeployment", "managerProgramId", "transceiverProgramId", "mint"]) {
    const config = baseConfig();
    config.deployment[field] = h(`different-${field}`);
    assert.throws(() => ledger.recordValidatedDeposit(ledgerCredit({}, config)), /LedgerDeploymentMismatch/u);
  }
  for (const field of ["protocolId", "nativeNetwork"]) {
    const config = baseConfig();
    config.deployment[field] += 1;
    assert.throws(() => ledger.recordValidatedDeposit(ledgerCredit({}, config)), /LedgerDeploymentMismatch/u);
  }
  const message = buildDepositClaimMessage(baseConfig(), operationWithComputedId(baseConfig())).decodedMessage;
  const withdrawal = bytesToHex(encodeCanonicalBridgeMessage({
    ...message, operationId: undefined, action: "WithdrawalRequest", direction: "SolanaToNative",
    withdrawalId: h("withdrawal-not-deposit"), depositOutpoint: { txid: ZERO_HASH, vout: 0 },
  }));
  assert.throws(() => ledger.recordValidatedDeposit({ ...credit, encodedMessageHex: withdrawal }), /LedgerDepositClaimRequired/u);
  assert.throws(() => ledger.recordValidatedDeposit(ledgerCredit({ deposit: { projectBridgeFeeAtomic: "1" } })), /LedgerProjectBridgeFeeMustBeZero/u);
  for (const input of [undefined, 100n, {}, { ...credit, reserveAllocationIdHex: ZERO_HASH },
    { ...credit, encodedMessageHex: `${credit.encodedMessageHex}00` },
    { ...credit, encodedMessageHex: credit.encodedMessageHex.slice(2) },
    { ...credit, encodedMessageHex: `00${credit.encodedMessageHex.slice(2)}` }]) {
    assert.throws(() => ledger.recordValidatedDeposit(input));
  }
  assert.deepEqual(ledger.snapshot(), before);
});

test("ledger preserves u64 operation and u128 aggregate precision without Number conversions", () => {
  const ledger = new ExactDepositLedger();
  const maximum = (1n << 64n) - 1n;
  const credits = [maximum, 3n].map((amount, index) => ledgerCredit({
    deposit: { amountAtomic: amount.toString(), depositOutpoint: outpoint(`precision-${index}`) },
    reserveSweep: { reserveAllocationIdHex: h(`precision-allocation-${index}`) },
  }));
  for (const credit of credits) ledger.recordValidatedDeposit(credit);
  assert.equal(ledger.snapshot().canonicalReserve, (maximum + 3n).toString());
  ledger.recordMint({ ...credits[1], mintedAmountAtomic: 3n });
  ledger.recordMint({ ...credits[0], mintedAmountAtomic: maximum });
  assert.equal(ledger.snapshot().mintedSupply, (maximum + 3n).toString());
  assert.equal(ledger.snapshot().surplus, "0");
});

test("ledger snapshots and accepted credit data cannot be mutated by the caller", () => {
  const ledger = new ExactDepositLedger();
  const credit = ledgerCredit();
  const saved = { ...credit };
  ledger.recordValidatedDeposit(credit);
  credit.reserveAllocationIdHex = h("post-validation-mutation");
  credit.encodedMessageHex = "00";
  const snapshot = ledger.snapshot();
  assert.throws(() => { snapshot.authorizedUnmintedCredits = "0"; }, TypeError);
  assert.equal(ledger.snapshot().authorizedUnmintedCredits, "250000000");
  ledger.recordMint({ ...saved, mintedAmountAtomic: "250000000" });
  assert.equal(ledger.snapshot().authorizedUnmintedCredits, "0");
});

test("interleaved multi-credit retries conserve reserve and liabilities at every transition", () => {
  const ledger = new ExactDepositLedger();
  let total = 0n;
  let minted = 0n;
  const credits = Array.from({ length: 64 }, (_, index) => {
    const amount = (1n << 53n) + BigInt(index + 1);
    const credit = ledgerCredit({
      deposit: { amountAtomic: amount.toString(), depositOutpoint: outpoint(`multi-credit-${index}`) },
      reserveSweep: { reserveAllocationIdHex: h(`multi-allocation-${index}`) },
    });
    ledger.recordValidatedDeposit(credit);
    ledger.recordValidatedDeposit(credit);
    total += amount;
    assert.equal(ledger.snapshot().authorizedUnmintedCredits, total.toString());
    return { ...credit, mintedAmountAtomic: amount };
  });
  for (const credit of credits.reverse()) {
    ledger.recordMint(credit);
    ledger.recordMint(credit);
    ledger.recordValidatedDeposit(credit);
    minted += credit.mintedAmountAtomic;
    const snapshot = ledger.snapshot();
    assert.equal(snapshot.canonicalReserve, total.toString());
    assert.equal(snapshot.mintedSupply, minted.toString());
    assert.equal(snapshot.authorizedUnmintedCredits, (total - minted).toString());
    assert.equal(snapshot.coverageRequired, total.toString());
    assert.equal(snapshot.surplus, "0");
  }
  assert.equal(ledger.snapshot().unsettledOperations, "0");
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
