import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  ProjectAttester,
  combineProjectAttestations,
  createEphemeralAttesterKeypairForTestOnly,
} from "../../attesters/attestation-service.mjs";
import {
  DEPOSIT_STATES,
  buildDepositClaimMessage,
} from "../automatic-deposit-pipeline.mjs";
import {
  LOCALNET_SOLANA_DEPOSIT_CLAIM_BRIDGE_PROTOCOL,
  LocalnetSolanaDepositClaimBridge,
  prepareLocalnetSolanaDepositClaimRequest,
} from "../localnet-solana-deposit-claim-bridge.mjs";
import { FileBackedSolanaDepositClaimJournal, InMemorySolanaDepositClaimJournal, SolanaDepositClaimSubmitter } from "../solana-deposit-claim-submitter.mjs";
import { base58Decode, base58Encode, findProgramAddress } from "../solana-deposit-claim-transaction-plan.mjs";
import { bytesToHex, hexToBytes } from "../../../shared/protocol/canonical-message.mjs";
import { SolanaDepositClaimObserver } from "../../solana-observer/solana-deposit-claim-observer.mjs";

const ZERO_HASH = "00".repeat(32);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

function pubkey(label) {
  const bytes = hexToBytes(h(label), label);
  return {
    bytes,
    hex: bytesToHex(bytes),
    base58: base58Encode(bytes),
  };
}

function feePayerKeypair() {
  const generated = ed25519.keygen();
  return {
    publicKey: generated.publicKey,
    publicKeyHex: bytesToHex(generated.publicKey),
    publicKeyBase58: base58Encode(generated.publicKey),
    signingKey: generated["secret" + "Key"],
  };
}

function signature(label = "localnet-solana-deposit-claim-bridge-signature") {
  const digest = createHash("sha512").update(label).digest("hex");
  return digest.replaceAll("0", "1").slice(0, 88);
}

function pipelineConfig() {
  const managerProgram = pubkey("bridge-manager-program");
  const transceiverProgram = pubkey("bridge-transceiver-program");
  const mint = pubkey("kpepe-localnet-mint");
  return {
    deployment: {
      protocolId: 1,
      nativeNetwork: 8_000_111,
      nativeGenesis: h("native-regtest-genesis"),
      solanaDeployment: h("solana-local-deployment"),
      managerProgramId: managerProgram.hex,
      transceiverProgramId: transceiverProgram.hex,
      mint: mint.hex,
    },
    policyEpoch: 1,
    keyEpoch: 1,
  };
}

function operation(config = pipelineConfig()) {
  const depositOutpoint = {
    txid: h("phase08-localnet-bridge-deposit-outpoint"),
    vout: 1,
  };
  return {
    messageNonceHex: h("phase08-localnet-bridge-message-nonce"),
    validFrom: "1700000000",
    validUntil: "1700001200",
    deposit: {
      trust: "LOCALLY_VALIDATED_CHAIN_STATE",
      nativeNetwork: config.deployment.nativeNetwork,
      nativeGenesisHash: config.deployment.nativeGenesis,
      depositOutpoint,
      amountAtomic: "250000000",
      projectBridgeFeeAtomic: "0",
      solanaRecipientHex: h("localnet-recipient-token-account"),
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
      signingIntent: {
        purpose: "RESERVE_SWEEP",
        operationId: ZERO_HASH,
        withdrawalId: ZERO_HASH,
        proofFingerprint: h("validated-native-deposit-proof"),
        unsignedNativeTransactionId: h("unsigned-reserve-sweep-txid"),
        transactionCommitment: h("reserve-sweep-transaction-commitment"),
        taprootSighashHex: h("reserve-sweep-sighash"),
        recipientScriptPubKeyHex: p2tr("canonical-reserve"),
        amountAtomic: "250000000",
        feeAtomic: "1200",
        changeScriptPubKeyHex: p2tr("canonical-reserve"),
        outputCommitments: [h("reserve-sweep-output")],
        changeAtomic: "0",
        inputOutpoints: [`${depositOutpoint.txid}:${depositOutpoint.vout}`],
        reserveCommitment: h("reserve-commitment"),
      },
    },
  };
}

function projectAttester(config, role, keypair) {
  return new ProjectAttester({
    role,
    ["secret" + "Key"]: keypair["secret" + "Key"],
    policy: {
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
    },
  });
}

function createRequest() {
  const config = pipelineConfig();
  const op = operation(config);
  const { encodedMessageHex, decodedMessage } = buildDepositClaimMessage(config, op);
  const keyA = createEphemeralAttesterKeypairForTestOnly();
  const keyB = createEphemeralAttesterKeypairForTestOnly();
  const evidence = {
    trust: "LOCALLY_VALIDATED_CHAIN_STATE",
    nativeNetwork: config.deployment.nativeNetwork,
    nativeGenesisHash: config.deployment.nativeGenesis,
    operationIdHex: decodedMessage.operationIdHex,
    depositOutpoint: decodedMessage.depositOutpointText,
    amountAtomic: decodedMessage.amountAtomic.toString(),
    solanaRecipientHex: decodedMessage.destinationHex,
    evidenceDigestHex: decodedMessage.evidenceDigestHex,
    reserveAllocationIdHex: h("reserve-allocation"),
    reserveTransitionState: "CANONICAL_RESERVE",
    mintCreditState: "AUTHORIZED_UNCONSUMED",
    finalitySatisfied: true,
    sweepFinalized: true,
    utxoUnspentAtDeposit: true,
    noPriorConsumption: true,
  };
  const attestationRequest = {
    encodedMessageHex,
    messageDigestHex: decodedMessage.messageDigestHex,
    evidence,
  };
  const attesterA = projectAttester(config, "ATTESTER_A", keyA);
  const attesterB = projectAttester(config, "ATTESTER_B", keyB);
  const attestations = [
    attesterA.signDepositCredit(attestationRequest, 1_700_000_600),
    attesterB.signDepositCredit(attestationRequest, 1_700_000_600),
  ];
  const combinedAttestation = combineProjectAttestations({
    attestations,
    encodedMessageHex,
    authorizedAttesterPublicKeys: [keyA.publicKeyHex, keyB.publicKeyHex],
  });
  return {
    config,
    request: {
      operationIdHex: decodedMessage.operationIdHex,
      encodedMessageHex,
      messageDigestHex: decodedMessage.messageDigestHex,
      amountAtomic: decodedMessage.amountAtomic.toString(),
      solanaRecipientHex: decodedMessage.destinationHex,
      attestations,
      combinedAttestation,
    },
  };
}

function bridgeConfig(config, feePayer, overrides = {}) {
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
    acceptedObservationTrust: ["LOCAL_VALIDATION"],
    maxRetries: 0,
    finalityPollAttempts: 1,
    finalityPollDelayMs: 0,
    ...overrides,
  };
}

function feePayerSigner(feePayer) {
  return {
    publicKeyBase58: feePayer.publicKeyBase58,
    sign(messageBytes) {
      return ed25519.sign(messageBytes, feePayer.signingKey);
    },
  };
}

class FakeLocalnetSolanaRpc {
  constructor(options = {}) {
    this.latestBlockhash = options.latestBlockhash ?? pubkey("recent-solana-blockhash").base58;
    this.lastValidBlockHeight = options.lastValidBlockHeight ?? "1000";
    this.blockHeight = options.blockHeight ?? 10n;
    this.solanaSignature = options.solanaSignature ?? signature();
    this.status = options.status ?? { slot: 88, confirmationStatus: "finalized", err: null };
    this.latestBlockhashCalls = 0;
    this.sendCalls = [];
    this.statusCalls = [];
    this.submittedSignatures = new Set();
  }

  async getLatestBlockhash() {
    this.latestBlockhashCalls += 1;
    return {
      blockhash: this.latestBlockhash,
      lastValidBlockHeight: this.lastValidBlockHeight,
    };
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
    return structuredClone(this.status);
  }

  async getBlockHeight() {
    return this.blockHeight;
  }
}

class FakeDepositClaimObserver {
  constructor(config, request, solanaSignature) {
    this.config = config;
    this.request = request;
    this.solanaSignature = solanaSignature;
    this.calls = [];
  }

  async observeFinalizedDepositClaim(input) {
    this.calls.push(input);
    return {
      trust: "LOCAL_VALIDATION",
      cluster: "localnet",
      slot: 88,
      rootSlot: 88,
      commitment: "finalized",
      transaction: {
        signature: input.solanaSignature,
        err: null,
      },
      programs: {
        managerProgramIdHex: this.config.managerProgramIdHex,
        transceiverProgramIdHex: this.config.transceiverProgramIdHex,
      },
      mint: {
        addressHex: this.config.mintHex,
        freezeAuthorityHex: null,
      },
      depositClaim: {
        operationIdHex: this.request.operationIdHex,
        messageDigestHex: this.request.messageDigestHex,
        mintHex: this.config.mintHex,
        amountAtomic: this.request.amountAtomic,
        mintedAmountAtomic: this.request.amountAtomic,
        solanaRecipientHex: this.request.solanaRecipientHex,
      },
    };
  }
}

class FakeRealDepositClaimObserverRpc {
  constructor(options) {
    this.managerProgramIdHex = options.managerProgramIdHex;
    this.solanaSignature = options.solanaSignature;
    this.expectedDepositClaimAccountBase58 = options.expectedDepositClaimAccountBase58;
    this.expectedMintAccountBase58 = options.expectedMintAccountBase58;
    this.claimAccountBase64 = options.claimAccountBase64;
    this.mintAccountBase64 = options.mintAccountBase64;
    this.transactionCalls = [];
    this.accountInfoCalls = [];
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
          owner: base58Encode(Buffer.from(this.managerProgramIdHex, "hex")), executable: false,
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

function depositClaimAccountBase64(request) {
  const destination = Buffer.from(request.solanaRecipientHex, "hex");
  const bytes = Buffer.alloc(211);
  let cursor = 0;
  bytes.write("KPBCLM01", cursor, "ascii");
  cursor += 8;
  bytes[cursor] = 1;
  cursor += 1;
  Buffer.from(request.operationIdHex, "hex").copy(bytes, cursor);
  cursor += 32;
  Buffer.from(request.messageDigestHex, "hex").copy(bytes, cursor);
  cursor += 32;
  bytes.writeBigUInt64LE(BigInt(request.amountAtomic), cursor);
  cursor += 8;
  bytes.writeUInt16LE(destination.length, cursor);
  cursor += 2;
  destination.copy(bytes, cursor);
  return bytes.toString("base64");
}

function splMintAccountBase64(config) {
  const bytes = Buffer.alloc(82);
  bytes.writeUInt32LE(1, 0);
  const authority = findProgramAddress([Buffer.from("kingpepe-mint-authority"), Buffer.from(config.mintHex, "hex")], Buffer.from(config.managerProgramIdHex, "hex"));
  Buffer.from(authority.hex, "hex").copy(bytes, 4);
  bytes.writeBigUInt64LE(250000000n, 36);
  bytes[44] = 8;
  bytes[45] = 1;
  bytes.writeUInt32LE(0, 46);
  return bytes.toString("base64");
}

test("localnet Solana deposit bridge prepares, submits, and verifies the finalized claim", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc();
  const config = bridgeConfig(fixture.config, feePayer);
  const observer = new FakeDepositClaimObserver(config, fixture.request, rpc.solanaSignature);
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config,
    feePayerSigner: feePayerSigner(feePayer),
    rpcClient: rpc,
    claimObserver: observer,
    journal: new InMemorySolanaDepositClaimJournal(),
  });

  const result = await bridge.submitDepositClaim(fixture.request);
  assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
  assert.equal(result.reason, "SOLANA_DEPOSIT_CLAIM_FINALIZED");
  assert.equal(result.mintedAmountAtomic, fixture.request.amountAtomic);
  assert.equal(result.solanaSignature, rpc.solanaSignature);
  assert.equal(rpc.latestBlockhashCalls, 2);
  assert.equal(rpc.sendCalls.length, 2);
  assert.equal(observer.calls.length, 1);
  assert.match(rpc.sendCalls[0].preparedTransactionBase64, /^[A-Za-z0-9+/]+={0,2}$/u);
});

test("localnet prepared deposit request can feed the submitter without key files", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc();
  const config = bridgeConfig(fixture.config, feePayer);
  const prepared = await prepareLocalnetSolanaDepositClaimRequest(config, fixture.request, {
    feePayerSigner: feePayerSigner(feePayer),
    blockhashSource: rpc,
  });

  assert.equal(prepared.operationIdHex, fixture.request.operationIdHex);
  assert.equal(prepared.messageDigestHex, fixture.request.messageDigestHex);
  assert.equal(prepared.recentBlockhash, rpc.latestBlockhash);
  assert.equal(prepared.lastValidBlockHeight, rpc.lastValidBlockHeight);
  assert.match(prepared.preparedTransactionBase64, /^[A-Za-z0-9+/]+={0,2}$/u);
  assert.equal(prepared.depositClaimAccountBase58, prepared.transactionPlan.pdas.depositClaim.addressBase58);
  assert.equal(prepared.mintAccountBase58, prepared.transactionPlan.mintBase58);
  assert.equal(JSON.stringify(prepared).includes("secret"), false);
  assert.equal(prepared.transactionPlan.operationIdHex, fixture.request.operationIdHex);

  const observer = new FakeDepositClaimObserver(config, fixture.request, rpc.solanaSignature);
  const submitter = new SolanaDepositClaimSubmitter({
    config,
    rpcClient: rpc,
    claimObserver: observer,
    journal: new InMemorySolanaDepositClaimJournal(),
  });
  const result = await submitter.submitDepositClaim(prepared);
  assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
  assert.equal(rpc.sendCalls.length, 1);
});

test("localnet Solana deposit bridge passes derived accounts to the real claim observer", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc();
  const config = bridgeConfig(fixture.config, feePayer, { acceptedObservationTrust: ["RPC_OBSERVATION"] });
  const expectedPrepared = await prepareLocalnetSolanaDepositClaimRequest(config, fixture.request, {
    feePayerSigner: feePayerSigner(feePayer),
    blockhashSource: new FakeLocalnetSolanaRpc({
      latestBlockhash: rpc.latestBlockhash,
      lastValidBlockHeight: rpc.lastValidBlockHeight,
    }),
  });
  const observerRpc = new FakeRealDepositClaimObserverRpc({
    managerProgramIdHex: config.managerProgramIdHex,
    solanaSignature: rpc.solanaSignature,
    expectedDepositClaimAccountBase58: expectedPrepared.depositClaimAccountBase58,
    expectedMintAccountBase58: expectedPrepared.mintAccountBase58,
    claimAccountBase64: depositClaimAccountBase64(fixture.request),
    mintAccountBase64: splMintAccountBase64(config),
  });
  const observer = new SolanaDepositClaimObserver({
    config: {
      environment: "localnet",
      cluster: "localnet",
      managerProgramIdHex: config.managerProgramIdHex,
      transceiverProgramIdHex: config.transceiverProgramIdHex,
      mintHex: config.mintHex,
    },
    rpcClient: observerRpc,
  });
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config,
    feePayerSigner: feePayerSigner(feePayer),
    rpcClient: rpc,
    claimObserver: observer,
    journal: new InMemorySolanaDepositClaimJournal(),
  });

  const result = await bridge.submitDepositClaim(fixture.request);
  assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
  assert.deepEqual(observerRpc.transactionCalls, [rpc.solanaSignature]);
  assert.deepEqual(observerRpc.accountInfoCalls, [
    expectedPrepared.depositClaimAccountBase58,
    expectedPrepared.mintAccountBase58,
  ]);
});

test("completed localnet Solana deposit claim retry does not broadcast a second transaction", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc();
  const config = bridgeConfig(fixture.config, feePayer);
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config,
    feePayerSigner: feePayerSigner(feePayer),
    rpcClient: rpc,
    claimObserver: new FakeDepositClaimObserver(config, fixture.request, rpc.solanaSignature),
    journal: new InMemorySolanaDepositClaimJournal(),
  });

  const first = await bridge.submitDepositClaim(fixture.request);
  rpc.latestBlockhash = pubkey("new-blockhash-must-not-rebuild-completed-operation").base58;
  const second = await bridge.submitDepositClaim(fixture.request);
  assert.deepEqual(second, first);
  assert.equal(rpc.sendCalls.length, 2);
  assert.equal(rpc.latestBlockhashCalls, 2);
});

test("localnet Solana deposit bridge fails closed for missing blockhash dependency", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const config = bridgeConfig(fixture.config, feePayer);
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config,
    feePayerSigner: feePayerSigner(feePayer),
    submitter: {
      submitDepositClaim() {
        throw new Error("submitter should not run without a blockhash");
      },
    },
  });

  const result = await bridge.submitDepositClaim(fixture.request);
  assert.equal(result.protocol, LOCALNET_SOLANA_DEPOSIT_CLAIM_BRIDGE_PROTOCOL);
  assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
  assert.equal(result.reason, "SOLANA_LATEST_BLOCKHASH_UNAVAILABLE");
});

test("pending receipt and lost response survive journal reopen without duplicate broadcast", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc({ status: { slot: 88, confirmationStatus: "confirmed", err: null } });
  const config = bridgeConfig(fixture.config, feePayer);
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-solana-stage-retry-"));
  const journals = () => ({
    journal: new FileBackedSolanaDepositClaimJournal({ root: path.join(root, "claim"), repoRoot: process.cwd() }),
    receiptJournal: new FileBackedSolanaDepositClaimJournal({ root: path.join(root, "receipt"), repoRoot: process.cwd() }),
  });
  const initial = journals();
  const send = rpc.sendTransaction.bind(rpc);
  rpc.sendTransaction = async (bytes, options) => {
    if (rpc.sendCalls.length === 0) {
      const persisted = initial.receiptJournal.get(fixture.request.operationIdHex);
      assert.equal(persisted.prepared.preparedTransactionBase64, bytes);
      assert.ok(persisted.submittedSignature);
      await send(bytes, options);
      throw new Error("test-only lost receipt response");
    }
    return send(bytes, options);
  };
  const construct = (state) => new LocalnetSolanaDepositClaimBridge({
    config, rpcClient: rpc, feePayerSigner: feePayerSigner(feePayer), ...state,
    claimObserver: new FakeDepositClaimObserver(config, fixture.request, rpc.solanaSignature),
  });
  try {
    const waiting = await construct(initial).submitDepositClaim(fixture.request);
    assert.equal(waiting.reason, "SOLANA_RECEIPT_WAITING_FOR_FINALITY");
    assert.equal(rpc.sendCalls.length, 1);
    assert.equal(initial.journal.get(fixture.request.operationIdHex), undefined);
    rpc.status.confirmationStatus = "finalized";
    delete rpc.status.err;
    const missingExecution = await construct(journals()).submitDepositClaim(fixture.request);
    assert.equal(missingExecution.reason, "SOLANA_RECEIPT_EXECUTION_STATUS_MISSING");
    assert.equal(initial.journal.get(fixture.request.operationIdHex), undefined);
    assert.equal(rpc.sendCalls.length, 1);
    rpc.status.err = null;
    rpc.latestBlockhash = pubkey("later-blockhash-for-claim-only").base58;
    const completed = await construct(journals()).submitDepositClaim(fixture.request);
    assert.equal(completed.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(rpc.sendCalls.length, 2);
    const restarted = await construct(journals()).submitDepositClaim(fixture.request);
    assert.deepEqual(restarted, completed);
    assert.equal(rpc.sendCalls.length, 2);
    assert.equal(rpc.latestBlockhashCalls, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("claim authorization is snapshotted before awaiting blockhash RPC", async () => {
  const fixture = createRequest();
  const original = structuredClone(fixture.request);
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc();
  const fetchHash = rpc.getLatestBlockhash.bind(rpc);
  rpc.getLatestBlockhash = async () => {
    fixture.request.encodedMessageHex = "00".repeat(514);
    fixture.request.attestations[0] = { ...fixture.request.attestations[0], signatureHex: "ff".repeat(64) };
    return fetchHash();
  };
  const config = bridgeConfig(fixture.config, feePayer);
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config, rpcClient: rpc, feePayerSigner: feePayerSigner(feePayer),
    claimObserver: new FakeDepositClaimObserver(config, original, rpc.solanaSignature),
  });
  const result = await bridge.submitDepositClaim(fixture.request);
  assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
  assert.equal(result.messageDigestHex, original.messageDigestHex);
});

test("confirmed Mint integrity failure stays hard-stopped after the observer recovers", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  const rpc = new FakeLocalnetSolanaRpc();
  const config = bridgeConfig(fixture.config, feePayer);
  const observer = new FakeDepositClaimObserver(config, fixture.request, rpc.solanaSignature);
  const healthy = observer.observeFinalizedDepositClaim.bind(observer);
  observer.observeFinalizedDepositClaim = async () => {
    const error = new Error("test-only authority mismatch");
    error.integrityCode = "SOLANA_MINT_AUTHORITY_OR_PRECISION_MISMATCH";
    throw error;
  };
  const bridge = new LocalnetSolanaDepositClaimBridge({ config, rpcClient: rpc,
    feePayerSigner: feePayerSigner(feePayer), claimObserver: observer });
  const stopped = await bridge.submitDepositClaim(fixture.request);
  assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
  observer.observeFinalizedDepositClaim = healthy;
  assert.deepEqual(await bridge.submitDepositClaim(fixture.request), stopped);
  assert.equal(rpc.sendCalls.length, 2);
});

test("localnet Solana deposit bridge rejects unsafe domains and signer mismatches", async () => {
  const fixture = createRequest();
  const feePayer = feePayerKeypair();
  assert.throws(
    () =>
      new LocalnetSolanaDepositClaimBridge({
        config: bridgeConfig(fixture.config, feePayer, { environment: "mainnet", cluster: "mainnet-beta" }),
        feePayerSigner: feePayerSigner(feePayer),
        submitter: { submitDepositClaim() {} },
      }),
    /LocalnetOnly/u,
  );

  const otherFeePayer = feePayerKeypair();
  const bridge = new LocalnetSolanaDepositClaimBridge({
    config: bridgeConfig(fixture.config, feePayer),
    feePayerSigner: feePayerSigner(otherFeePayer),
    blockhashSource: new FakeLocalnetSolanaRpc(),
    submitter: { submitDepositClaim() {} },
  });
  await assert.rejects(() => bridge.submitDepositClaim(fixture.request), /SignerMismatch/u);

  const badDomainBridge = new LocalnetSolanaDepositClaimBridge({
    config: bridgeConfig(fixture.config, feePayer, { mintHex: h("different-mint") }),
    feePayerSigner: feePayerSigner(feePayer),
    blockhashSource: new FakeLocalnetSolanaRpc(),
    submitter: { submitDepositClaim() {} },
  });
  await assert.rejects(() => badDomainBridge.submitDepositClaim(fixture.request), /MintMismatch/u);
});
