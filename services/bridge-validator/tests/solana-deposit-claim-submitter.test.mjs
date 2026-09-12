import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58Encode, buildLocalnetSolanaDepositClaimTransactionPlan } from "../solana-deposit-claim-transaction-plan.mjs";
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

for (const method of ["getBlockHeight", "sendTransaction"]) {
  test("Solana local RPC rejects redirected " + method + " before contacting another endpoint", async () => {
    let redirectedRequests = 0;
    const destination = createServer((request, response) => {
      redirectedRequests++;
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: "kingpepe-solana-local-rpc", result: 1 }));
    });
    await new Promise(resolve => destination.listen(0, "127.0.0.1", resolve));
    const redirect = createServer((request, response) => {
      request.resume();
      response.writeHead(307, { location: "http://127.0.0.1:" + destination.address().port });
      response.end();
    });
    await new Promise(resolve => redirect.listen(0, "127.0.0.1", resolve));
    try {
      const client = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:" + redirect.address().port });
      // HTTP transport only: neither isolated server is a blockchain node.
      await assert.rejects(client.call(method, method === "sendTransaction" ? ["PUBLIC_TEST_PACKET"] : []));
      assert.equal(redirectedRequests, 0);
    } finally {
      for (const server of [redirect, destination]) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
  });
}

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

for (const [name, makeBody] of [
  ["wrong response identity", () => JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: 1 })],
  ["missing result", id => JSON.stringify({ jsonrpc: "2.0", id })],
  ["null error without result", id => JSON.stringify({ jsonrpc: "2.0", id, error: null })],
  ["oversized response", id => JSON.stringify({ jsonrpc: "2.0", id, result: "x".repeat(2_097_153) })],
  ["invalid UTF8", id => Buffer.concat([Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result: "" }).slice(0, -2)), Buffer.from([0xff]), Buffer.from('"}')])],
]) test("Solana local RPC rejects " + name, async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { id } = JSON.parse(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(makeBody(id));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:" + server.address().port });
    await assert.rejects(client.call("getHealth"));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("Solana local RPC rejects malformed error codes without reflecting provider text", async () => {
  const marker = "PUBLIC_TEST_UNTRUSTED_PROVIDER_TEXT";
  for (const code of [marker, { privateText: marker }, null, 0.5, 0x8000_0000, -0x8000_0001]) {
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body).id, error: { code, message: marker } }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const client = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:" + server.address().port });
      await assert.rejects(client.call("getHealth"), error =>
        error.message === "SolanaRpcInvalidEnvelope:getHealth" && !JSON.stringify(error).includes(marker));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test("Solana local RPC bounds request size before contacting a server", async () => {
  let contacted = false;
  const client = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:8899", fetchImpl: async () => {
    contacted = true; return new Response(JSON.stringify({ jsonrpc: "2.0", id: "kingpepe-solana-local-rpc", result: "ok" }));
  } });
  await assert.rejects(client.call("sendTransaction", ["x".repeat(65_537)]));
  assert.equal(contacted, false);
});

for (const bodyStarted of [false, true]) test("Solana local RPC times out an actual " + (bodyStarted ? "response body" : "response header") + " stall", { timeout: 20000 }, async () => {
  const server = createServer((request, response) => {
    request.resume();
    if (bodyStarted) { response.writeHead(200, { "content-type": "application/json" }); response.write('{"jsonrpc":'); }
    // Deliberately no response completion; the client's fixed deadline must
    // abort the real socket. No shortened test-only runtime deadline is used.
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const client = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:" + server.address().port });
    await assert.rejects(client.getBlockHeight(), /SolanaRpcTransportUnavailable|SolanaRpcInvalidJson/u);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

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
  const payer = ed25519.keygen();
  const recentBlockhash = base58Encode(Buffer.from(h("signed-claim-blockhash"), "hex"));
  const plan = buildLocalnetSolanaDepositClaimTransactionPlan({
    ...submitConfig, encodedMessageHex, feePayerHex: Buffer.from(payer.publicKey).toString("hex"),
    tokenProgramIdBase58: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    recipientTokenAccountHex: decodedMessage.destinationHex,
    recentBlockhashBase58: recentBlockhash, lastValidBlockHeight: "1000",
  });
  const messageBytes = Buffer.from(plan.messageBase64, "base64");
  const signed = ed25519.sign(messageBytes, payer["secret" + "Key"]);
  payer["secret" + "Key"].fill(0);
  const preparedTransactionBase64 = Buffer.concat([Buffer.from([1]), signed, messageBytes]).toString("base64");
  const request = {
    operationIdHex: decodedMessage.operationIdHex,
    encodedMessageHex,
    messageDigestHex: decodedMessage.messageDigestHex,
    amountAtomic: decodedMessage.amountAtomic.toString(),
    solanaRecipientHex: decodedMessage.destinationHex,
    attestations,
    combinedAttestation,
    preparedTransactionBase64,
    recentBlockhash,
    lastValidBlockHeight: "1000",
    maxRetries: 0,
  };
  return {
    config,
    submitConfig,
    op,
    request,
    solanaSignature: base58Encode(signed),
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
    if (this.sendCalls.length === 0) return null;
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

for (const fileBacked of [false, true]) {
  for (const boundary of ["status", "height", "send", "observer"]) {
    for (const rejectResponse of [false, true]) {
      test(`${fileBacked ? "file" : "memory"} claim ${boundary} late ${rejectResponse ? "failure" : "success"} cannot clear a stop`, async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-claim-late-stop-"));
        try {
          const fixture = createFixture();
          const journal = fileBacked ? new FileBackedSolanaDepositClaimJournal({ root, repoRoot: REPO_ROOT }) : new InMemorySolanaDepositClaimJournal();
          const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature,
            status: boundary === "observer" ? { slot: 88, confirmationStatus: "finalized", err: null } : null });
          const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
          const entered = Promise.withResolvers();
          const response = Promise.withResolvers();
          const [target, method] = boundary === "observer" ? [observer, "observeFinalizedDepositClaim"] :
            [rpc, { status: "getSignatureStatus", height: "getBlockHeight", send: "sendTransaction" }[boundary]];
          const original = target[method].bind(target);
          target[method] = async (...args) => {
            const value = await original(...args);
            entered.resolve(value);
            return response.promise;
          };
          const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, claimObserver: observer, journal });
          const pending = submitter.submitDepositClaim(fixture.request);
          const value = await entered.promise;
          const writer = fileBacked ? new FileBackedSolanaDepositClaimJournal({ root, repoRoot: REPO_ROOT }) : journal;
          const stopped = { state: DEPOSIT_STATES.HARD_STOP, reason: "SOLANA_INTEGRITY_STOP", operationIdHex: fixture.request.operationIdHex };
          writer.recordTerminal(fixture.request.operationIdHex, stopped);
          const sendsAtStop = rpc.sendCalls.length;
          if (rejectResponse) response.reject(new Error("TestDependencyUnavailable"));
          else response.resolve(value);
          assert.deepEqual(await pending, stopped);
          assert.deepEqual(await submitter.submitDepositClaim(fixture.request), stopped);
          assert.deepEqual(journal.get(fixture.request.operationIdHex).result, stopped);
          assert.equal(rpc.sendCalls.length, sendsAtStop);
          // This fixture observes the claim only after one send; that earlier
          // send is not undone by a stop raised during observation.
          assert.equal(rpc.sendCalls.length, ["send", "observer"].includes(boundary) ? 1 : 0);
          assert.equal(observer.calls.length, boundary === "observer" ? 1 : 0);
        } finally { rmSync(root, { recursive: true, force: true }); }
      });
    }
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

test("RPC failure diagnostics never echo arbitrary provider or adapter error fields", async () => {
  const fixture = createFixture();
  for (const safe of [false, true]) {
    const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
    rpc.sendTransaction = async () => {
      const error = new Error("private-test-diagnostic");
      error.code = -32002;
      error.executionFault = safe ? "SBF_COMPUTE_BUDGET_EXCEEDED" : "private-test-diagnostic";
      error.instructionFailure = { index: 0, reason: safe ? "ProgramFailedToComplete" : "private-test-diagnostic", extra: "private-test-diagnostic" };
      throw error;
    };
    const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
    const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, claimObserver: observer });
    const result = await submitter.submitDepositClaim(fixture.request);
    assert.equal(result.state, DEPOSIT_STATES.WAITING_FOR_DEPENDENCY);
    assert.equal(result.rpcCode, -32002);
    assert.equal(JSON.stringify(result).includes("private-test-diagnostic"), false);
    if (safe) assert.deepEqual(result.instructionFailure, { index: 0, reason: "ProgramFailedToComplete" });
    else assert.equal(result.instructionFailure, undefined);
    assert.equal(observer.calls.length, 0);
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
          : envelope.method === "getLatestBlockhash"
            ? { value: { blockhash: "H".repeat(44), lastValidBlockHeight: 1234 } }
          : envelope.method === "getMinimumBalanceForRentExemption"
            ? 1_461_600
          : envelope.method === "requestAirdrop"
            ? signature("airdrop")
          : envelope.method === "getAccountInfo"
            ? { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: ["", "base64"] } }
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
    assert.deepEqual(await client.getLatestBlockhash(), {
      blockhash: "H".repeat(44),
      lastValidBlockHeight: "1234",
    });
    assert.equal(await client.getMinimumBalanceForRentExemption(82), 1_461_600n);
    assert.equal(await client.requestAirdrop("A".repeat(32), "5000000000"), signature("airdrop"));
    assert.deepEqual(await client.getAccountInfo("A".repeat(32)), {
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: ["", "base64"],
    });
    assert.equal(await client.sendTransaction(Buffer.from("tx").toString("base64")), signature("rpc-client"));
    assert.deepEqual(await client.getSignatureStatus(signature("rpc-client")), {
      slot: 9,
      confirmationStatus: "finalized",
      err: null,
    });
    await assert.rejects(() => client.call("getEpochInfo"), /SolanaRpcMethodNotAllowed:getEpochInfo/u);
    assert.deepEqual(observedMethods, [
      "getBlockHeight",
      "getLatestBlockhash",
      "getMinimumBalanceForRentExemption",
      "requestAirdrop",
      "getAccountInfo",
      "sendTransaction",
      "getSignatureStatuses",
    ]);
    assert.throws(() => normalizeSolanaRpcEndpoint("https://127.0.0.1:8899"), /SolanaRpcEndpointProtocolRejected/u);
    const credentialedEndpoint = `http://${["test-user", "test-pass"].join(":")}@127.0.0.1:8899`;
    assert.throws(
      () => normalizeSolanaRpcEndpoint(credentialedEndpoint),
      /SolanaRpcEndpointCredentialsRejected/u,
    );
    assert.throws(() => normalizeSolanaRpcEndpoint("http://192.0.2.10:8899"), /SolanaRpcEndpointMustBeLoopback/u);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("claim submitter rejects altered signed packets, accounts and blockhash metadata before RPC", async () => {
  const fixture = createFixture();
  const original = Buffer.from(fixture.request.preparedTransactionBase64, "base64");
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc });
  const resign = (packet) => {
    const payer = ed25519.keygen();
    packet.set(payer.publicKey, 69);
    packet.set(ed25519.sign(packet.subarray(65), payer["secret" + "Key"]), 1);
    payer["secret" + "Key"].fill(0);
    return packet.toString("base64");
  };
  for (const offset of [69 + 2 * 32, 69 + 3 * 32, 69 + 4 * 32, 69 + 8 * 32, original.length - 1]) {
    const altered = Buffer.from(original); altered[offset] ^= 1;
    await assert.rejects(() => submitter.submitDepositClaim({ ...fixture.request,
      preparedTransactionBase64: resign(altered) }), /SolanaClaimPacketMessageMismatch/u);
  }
  for (const altered of [Buffer.concat([original, Buffer.from([0])]),
    Buffer.concat([Buffer.from([0x81, 0]), original.subarray(1)]), original.subarray(0, 100)]) {
    await assert.rejects(() => submitter.submitDepositClaim({ ...fixture.request,
      preparedTransactionBase64: altered.toString("base64") }), /SolanaClaimPacket(?:Invalid|MessageMismatch)/u);
  }
  const wrongSignature = Buffer.from(original); wrongSignature[1] ^= 1;
  await assert.rejects(() => submitter.submitDepositClaim({ ...fixture.request,
    preparedTransactionBase64: wrongSignature.toString("base64") }), /SolanaClaimPacketSignatureInvalid/u);
  await assert.rejects(() => submitter.submitDepositClaim({ ...fixture.request,
    recentBlockhash: base58Encode(Buffer.from(h("another-blockhash"), "hex")) }), /SolanaClaimPacketMessageMismatch/u);
  await assert.rejects(() => submitter.submitDepositClaim({ ...fixture.request,
    mintAccountBase58: base58Encode(Buffer.from(h("another-mint"), "hex")) }), /SolanaClaimPacketAccountMismatch/u);
  assert.equal(rpc.sendCalls.length, 0);
  assert.equal(rpc.statusCalls.length, 0);
});

test("lost claim response retains the signed identity and reopens after blockhash expiry without resending", async () => {
  const fixture = createFixture();
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-claim-lost-response-"));
  const journals = () => new FileBackedSolanaDepositClaimJournal({ root, repoRoot: REPO_ROOT });
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const construct = () => new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc,
    claimObserver: observer, journal: journals() });
  const send = rpc.sendTransaction.bind(rpc);
  rpc.sendTransaction = async (bytes, options) => {
    const persisted = journals().get(fixture.request.operationIdHex);
    assert.equal(persisted.prepared.submittedSignature, fixture.solanaSignature);
    assert.equal(persisted.prepared.preparedTransactionBase64, bytes);
    await send(bytes, options);
    throw new Error("test-only response lost after acceptance");
  };
  try {
    const waiting = await construct().submitDepositClaim(fixture.request);
    assert.equal(waiting.reason, "SOLANA_RPC_SEND_FAILED");
    assert.equal(waiting.solanaSignature, fixture.solanaSignature);
    rpc.blockHeight = 1001n;
    const completed = await construct().submitDepositClaim(fixture.request);
    assert.equal(completed.state, DEPOSIT_STATES.COMPLETED);
    assert.equal(rpc.sendCalls.length, 1);
    assert.equal(observer.calls.length, 1);
    await assert.rejects(() => construct().submitDepositClaim({ ...fixture.request,
      lastValidBlockHeight: "2000" }), /SolanaDepositClaimJournalConflict/u);
    assert.equal(rpc.sendCalls.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("interruption before network send retries only the identical saved claim packet", async () => {
  const fixture = createFixture();
  const journal = new InMemorySolanaDepositClaimJournal();
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const construct = () => new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, journal, claimObserver: observer });
  const send = rpc.sendTransaction.bind(rpc);
  rpc.sendTransaction = async () => { throw new Error("test-only interrupted before send"); };
  assert.equal((await construct().submitDepositClaim(fixture.request)).reason, "SOLANA_RPC_SEND_FAILED");
  assert.equal(journal.get(fixture.request.operationIdHex).prepared.submittedSignature, fixture.solanaSignature);
  assert.equal(rpc.sendCalls.length, 0);
  rpc.sendTransaction = send;
  assert.equal((await construct().submitDepositClaim(fixture.request)).state, DEPOSIT_STATES.COMPLETED);
  assert.equal(rpc.sendCalls.length, 1);
  assert.equal(rpc.sendCalls[0].preparedTransactionBase64, fixture.request.preparedTransactionBase64);
});

test("RPC signature substitution causes a persistent claim hard stop", async () => {
  const fixture = createFixture();
  const journal = new InMemorySolanaDepositClaimJournal();
  const rpc = new FakeSolanaRpc({ solanaSignature: signature("substituted-response") });
  const observer = new FakeDepositClaimObserver(fixture.submitConfig, fixture.request, fixture.solanaSignature);
  const construct = () => new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, journal, claimObserver: observer });
  const stopped = await construct().submitDepositClaim(fixture.request);
  assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
  assert.equal(stopped.reason, "SOLANA_RPC_SUBMITTED_SIGNATURE_MISMATCH");
  rpc.solanaSignature = fixture.solanaSignature;
  assert.deepEqual(await construct().submitDepositClaim(fixture.request), stopped);
  assert.equal(rpc.sendCalls.length, 1);
  assert.equal(observer.calls.length, 0);
});

for (const persistent of [false, true]) {
  test(`${persistent ? "file" : "memory"} claim journal never overwrites an integrity stop with a late result`, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-claim-stop-"));
    try {
      const fixture = createFixture();
      let journal = persistent ? new FileBackedSolanaDepositClaimJournal({ root, repoRoot: REPO_ROOT }) : new InMemorySolanaDepositClaimJournal();
      const rpc = new FakeSolanaRpc({ solanaSignature: signature("substituted-response") });
      const stopped = await new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, journal }).submitDepositClaim(fixture.request);
      assert.equal(stopped.state, DEPOSIT_STATES.HARD_STOP);
      if (persistent) journal = new FileBackedSolanaDepositClaimJournal({ root, repoRoot: REPO_ROOT });
      const id = fixture.request.operationIdHex;
      assert.throws(() => journal.recordSubmitted(id, fixture.solanaSignature), /HardStop/u);
      assert.throws(() => journal.recordCompleted(id, { ...stopped, state: DEPOSIT_STATES.COMPLETED }), /HardStop/u);
      assert.throws(() => journal.recordTerminal(id, { ...stopped, state: DEPOSIT_STATES.WAITING_FOR_DEPENDENCY }), /Terminal|HardStop/u);
      journal.recordTerminal(id, stopped);
      assert.deepEqual(journal.get(id).result, stopped);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("unavailable or malformed prior execution status never authorizes a send or completion", async () => {
  const fixture = createFixture();
  for (const status of [undefined, [], {}, { slot: 1, confirmationStatus: "finalized" },
    { slot: -1, confirmationStatus: "finalized", err: null },
    { slot: 1, confirmationStatus: "provider-private-text", err: null }]) {
    const rpc = new FakeSolanaRpc();
    rpc.getSignatureStatus = async () => status;
    const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc });
    const result = await submitter.submitDepositClaim(fixture.request);
    assert.equal(result.reason, "SOLANA_EXECUTION_STATUS_MALFORMED");
    assert.equal(rpc.sendCalls.length, 0);
    assert.equal(JSON.stringify(result).includes("provider-private-text"), false);
  }
  const rpc = new FakeSolanaRpc();
  rpc.getSignatureStatus = async () => { throw new Error("test-only unavailable"); };
  const result = await new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc }).submitDepositClaim(fixture.request);
  assert.equal(result.reason, "SOLANA_RPC_STATUS_UNAVAILABLE");
  assert.equal(rpc.sendCalls.length, 0);
});

test("a failed claim execution is terminal only after finalized observation", async () => {
  const fixture = createFixture();
  const rpc = new FakeSolanaRpc({ solanaSignature: fixture.solanaSignature,
    status: { slot: 88, confirmationStatus: "confirmed", err: { InstructionError: [0, "InvalidAccountData"] } } });
  const journal = new InMemorySolanaDepositClaimJournal();
  const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, journal });
  assert.equal((await submitter.submitDepositClaim(fixture.request)).state, DEPOSIT_STATES.WAITING_FOR_FINALITY);
  assert.equal(journal.get(fixture.request.operationIdHex).state, "SUBMITTED");
  rpc.status.confirmationStatus = "finalized";
  assert.equal((await submitter.submitDepositClaim(fixture.request)).state, DEPOSIT_STATES.REJECTED);
  assert.equal(rpc.sendCalls.length, 1);
});

test("failure to persist the claim broadcast identity prevents network send", async () => {
  const fixture = createFixture();
  const journal = new InMemorySolanaDepositClaimJournal();
  journal.recordSubmitted = () => { throw new Error("TEST_STORAGE_WRITE_FAILED"); };
  const rpc = new FakeSolanaRpc();
  const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc, journal });
  await assert.rejects(() => submitter.submitDepositClaim(fixture.request), /TEST_STORAGE_WRITE_FAILED/u);
  assert.equal(rpc.sendCalls.length, 0);
});

test("missing, negative and inexact block heights cannot authorize claim broadcasting", async () => {
  const fixture = createFixture();
  for (const height of [null, undefined, -1, Number.MAX_SAFE_INTEGER + 1, NaN, "", "01"]) {
    const rpc = new FakeSolanaRpc();
    rpc.getBlockHeight = async () => height;
    const submitter = new SolanaDepositClaimSubmitter({ config: fixture.submitConfig, rpcClient: rpc });
    assert.equal((await submitter.submitDepositClaim(fixture.request)).reason, "SOLANA_RPC_BLOCK_HEIGHT_UNAVAILABLE");
    assert.equal(rpc.sendCalls.length, 0);
    const client = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:8899",
      fetchImpl: async (_url, options) => new Response(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(options.body).id, result: height })) });
    await assert.rejects(() => client.getBlockHeight());
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
