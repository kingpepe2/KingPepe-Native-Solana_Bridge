import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  ProjectAttester,
  createEphemeralAttesterKeypairForTestOnly,
} from "../../attesters/attestation-service.mjs";
import {
  AutomaticNativeToSolanaDepositPipeline,
  DEPOSIT_STATES,
  buildDepositClaimMessage,
} from "../automatic-deposit-pipeline.mjs";
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
        inputOutpoints: [outpointText(depositOutpoint)],
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
  });
  return { config, operation, frost, nativeRelayer, reserveVerifier, solanaBridge, pipeline };
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
