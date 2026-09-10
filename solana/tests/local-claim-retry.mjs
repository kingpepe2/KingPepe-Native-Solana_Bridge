// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual local-validator claim, abrupt worker exits and journal reopen. Workers
// receive only the already-signed packet/public attestations, never signer keys.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { FileBackedSolanaDepositClaimJournal, SolanaDepositClaimSubmitter, SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SolanaDepositClaimObserver, decodeSplMintAccountBase64 } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";

const WORKER_PATH = fileURLToPath(import.meta.url);
const BEFORE_SEND_EXIT = 86;
const AFTER_SEND_EXIT = 87;

export async function testLocalClaimProcessRetry(context) {
  const { flowConfig: config, plan } = context;
  assert.equal(config.nativeChainName, "regtest");
  assert.equal(context.nativeSource.nativeGenesisHash, REGTEST_GENESIS);
  const endpoint = `http://127.0.0.1:${plan.ports.solanaRpcPort}`;
  const rpc = new SolanaLocalRpcClient({ endpoint });
  const journalRoot = path.join(config.stateRoot, "solana-claim-journal");
  const journal = () => new FileBackedSolanaDepositClaimJournal({ root: journalRoot, repoRoot: plan.repoRoot });
  const passed = [];
  const claimSubmitter = { submitDepositClaim: async (prepared) => {
    const operationId = prepared.operationIdHex;
    assert.equal(journal().get(operationId).state, "PREPARED");
    // Explicit allowlist: do not serialize the runtime setup/signer context.
    const request = Object.fromEntries(["operationIdHex", "messageDigestHex", "encodedMessageHex", "amountAtomic",
      "solanaRecipientHex", "attestations", "combinedAttestation", "preparedTransactionBase64", "recentBlockhash",
      "lastValidBlockHeight", "depositClaimAccountBase58", "mintAccountBase58", "maxRetries"].map((field) => [field, prepared[field]]));
    const input = { endpoint, journalRoot, repoRoot: plan.repoRoot, request, nativeGenesis: REGTEST_GENESIS,
      config: { environment: "localnet", cluster: "localnet", solanaDeploymentHex: config.solanaDeploymentHex,
        managerProgramIdHex: config.bridgeProgramIdHex, transceiverProgramIdHex: config.transceiverProgramIdHex,
        mintHex: config.mintHex, nativeDecimals: config.nativeDecimals, policyEpoch: config.policyEpoch,
        keyEpoch: config.keyEpoch, acceptedObservationTrust: ["RPC_OBSERVATION"] } };
    const signature = base58Encode(Buffer.from(request.preparedTransactionBase64, "base64").subarray(1, 65));
    const before = await runWorker("before-send", input);
    assert.equal(before.code, BEFORE_SEND_EXIT, "CLAIM_WORKER_DID_NOT_EXIT_BEFORE_SEND");
    const saved = journal().get(operationId);
    assert.equal(saved.prepared.submittedSignature, signature);
    assert.equal(saved.prepared.preparedTransactionBase64, request.preparedTransactionBase64);
    assert.equal(await rpc.getSignatureStatus(signature), null);
    assert.equal(await rpc.getAccountInfo(request.depositClaimAccountBase58), null);
    passed.push("CLAIM_IDENTITY_PERSISTED_BEFORE_PROCESS_EXIT_AND_NETWORK_SEND");

    const after = await runWorker("after-send", input);
    assert.equal(after.code, AFTER_SEND_EXIT, "CLAIM_WORKER_DID_NOT_EXIT_AFTER_SEND");
    const sent = journal().get(operationId);
    assert.deepEqual(sent.prepared, saved.prepared, "RESTART_CHANGED_SIGNED_CLAIM_PACKET");
    assert.equal(sent.state, "SUBMITTED");
    assert.equal(sent.result, undefined);
    passed.push("RESTART_REBROADCASTS_IDENTICAL_PACKET_AFTER_PRE_SEND_EXIT");
    passed.push("PROCESS_EXITS_AFTER_REAL_VALIDATOR_ACCEPTANCE_BEFORE_COMPLETION_RECORD");

    let expiredAndFinalized = false;
    for (let attempt = 0; attempt < 720; attempt += 1) {
      const status = await rpc.getSignatureStatus(signature);
      if (await rpc.getBlockHeight() > BigInt(request.lastValidBlockHeight) && status?.confirmationStatus === "finalized") {
        assert.equal(status.err, null);
        expiredAndFinalized = true;
        break;
      }
      await delay(250);
    }
    assert.equal(expiredAndFinalized, true, "REAL_CLAIM_EXPIRY_AND_FINALITY_TIMEOUT");
    const resumed = await runWorker("resume", input);
    assert.equal(resumed.code, 0, "CLAIM_RESUME_WORKER_FAILED");
    const completed = JSON.parse(resumed.output);
    assert.equal(completed.state, "COMPLETED");
    assert.equal(completed.solanaSignature, signature);
    assert.equal(completed.mintedAmountAtomic, request.amountAtomic);
    assert.equal(journal().completed(operationId).result.solanaSignature, signature);
    passed.push("FINALIZED_CLAIM_OBSERVED_AFTER_REAL_BLOCKHASH_EXPIRY_WITHOUT_RESEND");
    const reopened = await runWorker("resume", input);
    assert.equal(reopened.code, 0);
    assert.deepEqual(JSON.parse(reopened.output), completed);
    const account = await rpc.getAccountInfo(request.mintAccountBase58);
    assert.equal(account.data[1], "base64");
    assert.equal(decodeSplMintAccountBase64(account.data[0]).supplyAtomic, request.amountAtomic);
    passed.push("COMPLETED_PROCESS_REOPEN_HAS_NO_SECOND_MINT");
    return completed;
  } };
  const completed = await submitLocalnetSolanaDepositClaim({ ...context, claimSubmitter });
  assert.equal(completed.state, "COMPLETED");
  assert.equal(passed.length, 5);
  return { completed, evidence: { pass: passed.length, fail: 0, passed,
    scope: "REGTEST/local-validator signed claim worker crashes and real blockhash expiry; not full service/power-loss recovery or authenticated storage." } };
}

function runWorker(mode, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH, "--claim-retry-worker", mode], {
      cwd: input.repoRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLAIM_RETRY_WORKER_TIMEOUT")); }, 45_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      output += data;
      if (output.length > 8192) { child.kill(); reject(new Error("CLAIM_RETRY_WORKER_OUTPUT_LIMIT")); }
    });
    // Never relay arbitrary child diagnostics or private local paths.
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("CLAIM_RETRY_WORKER_START_FAILED")); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.on("error", () => { child.kill(); reject(new Error("CLAIM_RETRY_WORKER_INPUT_FAILED")); });
    child.stdin.end(JSON.stringify(input));
  });
}

async function worker(mode) {
  if (!["before-send", "after-send", "resume"].includes(mode)) throw new Error("CLAIM_RETRY_MODE_REJECTED");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 32_768) throw new Error("CLAIM_RETRY_INPUT_LIMIT");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(input.nativeGenesis, REGTEST_GENESIS);
  assert.equal(input.config.environment, "localnet");
  assert.equal(input.config.cluster, "localnet");
  const journal = new FileBackedSolanaDepositClaimJournal({ root: input.journalRoot, repoRoot: input.repoRoot });
  const rpc = new SolanaLocalRpcClient({ endpoint: input.endpoint });
  const send = rpc.sendTransaction.bind(rpc);
  rpc.sendTransaction = async (packet, options) => {
    if (mode === "resume") throw new Error("CLAIM_RESUME_MUST_NOT_SEND");
    const saved = journal.get(input.request.operationIdHex);
    assert.equal(saved.prepared.preparedTransactionBase64, packet);
    assert.equal(saved.prepared.submittedSignature, base58Encode(Buffer.from(packet, "base64").subarray(1, 65)));
    if (mode === "before-send") process.exit(BEFORE_SEND_EXIT);
    const signature = await send(packet, options);
    assert.equal(signature, saved.prepared.submittedSignature);
    process.exit(AFTER_SEND_EXIT);
  };
  const submitter = new SolanaDepositClaimSubmitter({ config: input.config, rpcClient: rpc, journal,
    claimObserver: new SolanaDepositClaimObserver({ config: input.config, endpoint: input.endpoint }) });
  const result = await submitter.submitDepositClaim(input.request);
  assert.equal(result.state, "COMPLETED");
  process.stdout.write(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === WORKER_PATH) {
  try {
    if (process.argv[2] !== "--claim-retry-worker") throw new Error("CLAIM_RETRY_WORKER_ONLY");
    await worker(process.argv[3]);
  } catch { process.stderr.write("LOCAL_CLAIM_RETRY_WORKER_FAILED\n"); process.exitCode = 1; }
}
