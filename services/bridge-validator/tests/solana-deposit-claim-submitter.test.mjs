import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
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
  FileBackedSolanaDepositClaimJournal,
  InMemorySolanaDepositClaimJournal,
  SolanaDepositClaimSubmitter,
  SolanaLocalRpcClient,
  normalizeSolanaRpcEndpoint,
} from "../solana-deposit-claim-submitter.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ZERO_HASH = "00".repeat(32);

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function p2tr(label) {
  return `5120${h(label)}`;
}

function signature(label = "local-signature") {
  const digest = createHash("sha512").update(label).digest("hex");
  return digest.replaceAll("0", "1").slice(0, 88);
}

function pipelineConfig() {
  return {
    deployment: {
      protocolId: 1,
      nativeNetwork: 8_000_111,
      nativeGenesis: h("native-regtest-genesis"),
      solanaDeployment: h("solana-local-deployment"),
      managerProgramId: h("bridge-program-id"),
      transceiverProgramId: h("transceiver-program-id"),
      mint: h("kpepe-mint"),
    },
    policyEpoch: 1,
    keyEpoch: 1,
  };
}

function submitterConfig(config = pipelineConfig()) {
  return {
    environment: "localnet",
    cluster: "localnet",
    solanaDeploymentHex: config.deployment.solanaDeployment,
    managerProgramIdHex: config.deployment.managerProgramId,
    transceiverProgramIdHex: config.deployment.transceiverProgramId,
    mintHex: config.deployment.mint,
    policyEpoch: config.policyEpoch,
    keyEpoch: config.keyEpoch,
    acceptedObservationTrust: ["LOCAL_VALIDATION"],
  };
}

function operation(config = pipelineConfig()) {
  const depositOutpoint = {
    txid: h("phase08-solana-submitter-deposit-outpoint"),
    vout: 1,
  };
  return {
    messageNonceHex: h("phase08-solana-submitter-message-nonce"),
    validFrom: "1700000000",
    validUntil: "1700001200",
    deposit: {
      trust: "LOCALLY_VALIDATED_CHAIN_STATE",
      nativeNetwork: config.deployment.nativeNetwork,
      nativeGenesisHash: config.deployment.nativeGenesis,
      depositOutpoint,
      amountAtomic: "250000000",
      projectBridgeFeeAtomic: "0",
      solanaRecipientHex: h("solana-recipient-token-account"),
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

function createFixture() {
  const config = pipelineConfig();
  const submitConfig = submitterConfig(config);
  const op = operation(config);
  const { encodedMessageHex, decodedMessage } = buildDepositClaimMessage(config, op);
  const keyA = createEphemeralAttesterKeypairForTestOnly();
  const keyB = createEphemeralAttesterKeypairForTestOnly();
  const attesterA = projectAttester(config, "ATTESTER_A", keyA);
  const attesterB = projectAttester(config, "ATTESTER_B", keyB);
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
  const attestations = [
    attesterA.signDepositCredit(attestationRequest, 1_700_000_600),
    attesterB.signDepositCredit(attestationRequest, 1_700_000_600),
  ];
  const combinedAttestation = combineProjectAttestations({
    attestations,
    encodedMessageHex,
    authorizedAttesterPublicKeys: [keyA.publicKeyHex, keyB.publicKeyHex],
  });
  const preparedTransactionBase64 = Buffer.from("serialized-localnet-deposit-claim-transaction").toString("base64");
  const request = {
    operationIdHex: decodedMessage.operationIdHex,
    encodedMessageHex,
    messageDigestHex: decodedMessage.messageDigestHex,
    amountAtomic: decodedMessage.amountAtomic.toString(),
    solanaRecipientHex: decodedMessage.destinationHex,
    attestations,
    combinedAttestation,
    preparedTransactionBase64,
    recentBlockhash: "H".repeat(44),
    lastValidBlockHeight: "1000",
    maxRetries: 0,
  };
  return {
    config,
    submitConfig,
    op,
    request,
    solanaSignature: signature(),
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

class FakeSolanaRpc {
  constructor(options = {}) {
    this.blockHeight = options.blockHeight ?? 10n;
    this.status = Object.hasOwn(options, "status") ? options.status : { slot: 88, confirmationStatus: "finalized", err: null };
    this.solanaSignature = options.solanaSignature ?? signature();
    this.sendCalls = [];
    this.statusCalls = [];
  }

  async sendTransaction(preparedTransactionBase64, options) {
    this.sendCalls.push({ preparedTransactionBase64, options });
    return this.solanaSignature;
  }

  async getSignatureStatus(solanaSignature) {
    this.statusCalls.push(solanaSignature);
    return typeof this.status === "function" ? this.status(solanaSignature) : structuredClone(this.status);
  }

  async getBlockHeight() {
    return this.blockHeight;
  }
}

class FakeDepositClaimObserver {
  constructor(config, request, solanaSignature, overrides = {}) {
    this.config = config;
    this.request = request;
    this.solanaSignature = solanaSignature;
    this.overrides = overrides;
    this.calls = [];
  }

  async observeFinalizedDepositClaim(input) {
    this.calls.push(input);
    return deepMerge(
      {
        trust: "LOCAL_VALIDATION",
        cluster: "localnet",
        slot: 88,
        rootSlot: 88,
        commitment: "finalized",
        transaction: {
          signature: this.solanaSignature,
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
      },
      this.overrides,
    );
  }
}

test("Solana deposit submitter finalizes a localnet claim after two attestations and claim observation", async () => {
  const fixture = createFixture();
  const stateRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-solana-claim-journal-"));
  const journal = new FileBackedSolanaDepositClaimJournal({ root: stateRoot, repoRoot: REPO_ROOT });
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const submitter = new SolanaDepositClaimSubmitter({
    config: fixture.submitConfig,
    rpcClient: rpc,
    claimObserver: observer,
    journal,
  });
  try {
    const result = await submitter.submitDepositClaim(fixture.request);
    assert.equal(result.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(result.reason, "SOLANA_DEPOSIT_CLAIM_FINALIZED");
    assert.equal(result.mintedAmountAtomic, fixture.request.amountAtomic);
    assert.equal(result.solanaSignature, fixture.solanaSignature);
    assert.equal(rpc.sendCalls.length, 1);
    assert.equal(observer.calls.length, 1);
    const persisted = journal.completed(fixture.request.operationIdHex);
    assert.equal(persisted.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(persisted.prepared.operationIdHex, fixture.request.operationIdHex);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("completed Solana deposit claim retry does not resubmit transaction bytes", async () => {
  const fixture = createFixture();
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const submitter = new SolanaDepositClaimSubmitter({
    config: fixture.submitConfig,
    rpcClient: rpc,
    claimObserver: observer,
    journal: new InMemorySolanaDepositClaimJournal(),
  });

  const first = await submitter.submitDepositClaim(fixture.request);
  const second = await submitter.submitDepositClaim(fixture.request);
  assert.deepEqual(second, first);
  assert.equal(rpc.sendCalls.length, 1);
  assert.equal(observer.calls.length, 1);
});

test("invalid project attestation threshold is rejected before Solana RPC send", async () => {
  const fixture = createFixture();
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const submitter = new SolanaDepositClaimSubmitter({
    config: fixture.submitConfig,
    rpcClient: rpc,
    claimObserver: observer,
  });

  await assert.rejects(
    () =>
      submitter.submitDepositClaim({
        ...fixture.request,
        combinedAttestation: {
          ...fixture.request.combinedAttestation,
          threshold: 1,
        },
      }),
    /SolanaDepositSubmitterAttestationThresholdInvalid/u,
  );
  assert.equal(rpc.sendCalls.length, 0);
});

test("unfinalized Solana transaction status waits and does not report mint completion", async () => {
  const fixture = createFixture();
  const rpc = new FakeSolanaRpc({
    solanaSignature: fixture.solanaSignature,
    status: { slot: 88, confirmationStatus: "confirmed", err: null },
  });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const submitter = new SolanaDepositClaimSubmitter({
    config: fixture.submitConfig,
    rpcClient: rpc,
    claimObserver: observer,
  });

  const result = await submitter.submitDepositClaim(fixture.request);
  assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_FINALITY);
  assert.equal(result.reason, "SOLANA_MINT_WAITING_FOR_FINALITY");
  assert.equal(observer.calls.length, 0);
});

test("expired unresolved submitted Solana transaction is not rebuilt as a new economic operation", async () => {
  const fixture = createFixture();
  const rpc = new FakeSolanaRpc({
    solanaSignature: fixture.solanaSignature,
    status: null,
    blockHeight: 10n,
  });
  const journal = new InMemorySolanaDepositClaimJournal();
  const submitter = new SolanaDepositClaimSubmitter({
    config: fixture.submitConfig,
    rpcClient: rpc,
    claimObserver: new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature),
    journal,
  });

  const waiting = await submitter.submitDepositClaim(fixture.request);
  assert.equal(waiting.state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
  assert.equal(waiting.reason, "SOLANA_MINT_WAITING_FOR_FINALITY");
  assert.equal(rpc.sendCalls.length, 1);

  rpc.blockHeight = 1001n;
  const expired = await submitter.submitDepositClaim(fixture.request);
  assert.equal(expired.state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
  assert.equal(expired.reason, "SOLANA_SUBMITTED_TRANSACTION_OUTCOME_UNKNOWN_AFTER_BLOCKHASH_EXPIRY");
  assert.equal(rpc.sendCalls.length, 1);
});

test("finalized Solana claim observation mismatch hard-stops before ledger mint accounting", async () => {
  const fixture = createFixture();
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature, {
    depositClaim: {
      mintedAmountAtomic: "250000001",
    },
  });
  const submitter = new SolanaDepositClaimSubmitter({
    config: fixture.submitConfig,
    rpcClient: rpc,
    claimObserver: observer,
  });

  const result = await submitter.submitDepositClaim(fixture.request);
  assert.equal(result.state, DEPOSIT_STATES.HARD_STOP);
  assert.equal(result.reason, "SOLANA_MINT_AMOUNT_MISMATCH");
});

test("Solana local RPC client uses loopback JSON-RPC and rejects unsafe endpoints or methods", async () => {
  const observedMethods = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const envelope = JSON.parse(body);
      observedMethods.push(envelope.method);
      const result =
        envelope.method === "getBlockHeight"
          ? 44
          : envelope.method === "sendTransaction"
            ? signature("rpc-client")
            : { value: [{ slot: 9, confirmationStatus: "finalized", err: null }] };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: envelope.id, result }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const client = new SolanaLocalRpcClient({ endpoint: `http://127.0.0.1:${port}` });
  try {
    assert.equal(await client.getBlockHeight(), 44n);
    assert.equal(await client.sendTransaction(Buffer.from("tx").toString("base64")), signature("rpc-client"));
    assert.deepEqual(await client.getSignatureStatus(signature("rpc-client")), {
      slot: 9,
      confirmationStatus: "finalized",
      err: null,
    });
    await assert.rejects(() => client.call("requestAirdrop"), /SolanaRpcMethodNotAllowed:requestAirdrop/u);
    assert.deepEqual(observedMethods, ["getBlockHeight", "sendTransaction", "getSignatureStatuses"]);
    assert.throws(() => normalizeSolanaRpcEndpoint("https://127.0.0.1:8899"), /SolanaRpcEndpointProtocolRejected/u);
    assert.throws(
      () => normalizeSolanaRpcEndpoint("http://user:pass@127.0.0.1:8899"),
      /SolanaRpcEndpointCredentialsRejected/u,
    );
    assert.throws(() => normalizeSolanaRpcEndpoint("http://192.0.2.10:8899"), /SolanaRpcEndpointMustBeLoopback/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
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
