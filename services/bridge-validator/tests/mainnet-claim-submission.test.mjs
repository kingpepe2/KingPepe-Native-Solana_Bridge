// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic packets/transport only. No Mainnet transaction or credential.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { solanaDeliveryFixture } from "../../../tests/integration/solana-delivery-fixture.mjs";
import { combineProjectAttestations } from "../../attesters/attestation-service.mjs";
import { SolanaDepositClaimObserver } from "../../solana-observer/solana-deposit-claim-observer.mjs";
import { SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS } from "../../../shared/network-identity.mjs";
import { SolanaDepositClaimSubmitter, SolanaLocalRpcClient, FileBackedSolanaDepositClaimJournal,
  InMemorySolanaDepositClaimJournal } from "../solana-deposit-claim-submitter.mjs";
import { base58Encode, verifySignedLocalnetSolanaDepositClaimTransaction } from "../solana-deposit-claim-transaction-plan.mjs";
import { verifyDepositMintExecution } from "../../solana-observer/deposit-mint-execution.mjs";

const endpoint = "https://mainnet.example.invalid/";
async function setup(t) {
  const f = await solanaDeliveryFixture({ mainnet: true }), p = f.policy.operationPolicy;
  const config = { environment: "mainnet", cluster: "mainnet", solanaGenesis: p.solanaGenesis,
    protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, nativeGenesis: p.nativeGenesis,
    solanaDeployment: p.solanaDeployment, solanaDeploymentHex: p.solanaDeployment,
    managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
    policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch, acceptedObservationTrust: ["RPC_OBSERVATION"] };
  const packet = await f.delivery("CLAIM");
  const request = { ...packet, combinedAttestation: combineProjectAttestations({ attestations: packet.attestations,
    encodedMessageHex: packet.encodedMessageHex, authorizedAttesterPublicKeys: packet.attestations.map(a => a.attesterPublicKeyHex) }) };
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-mainnet-claim-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const journal = new FileBackedSolanaDepositClaimJournal({ root, repoRoot: path.resolve(import.meta.dirname, "../../..") });
  const admission = [], sends = [], calls = []; let allowed = true, genesis = SOLANA_MAINNET_GENESIS, landed = false, loseResponse = false, finalized = false;
  const signature = base58Encode(Buffer.from(packet.preparedTransactionBase64, "base64").subarray(1, 65));
  const identity = verifySignedLocalnetSolanaDepositClaimTransaction({ ...config, ...packet,
    recentBlockhashBase58: packet.recentBlockhash, recipientTokenAccountHex: f.message.destinationHex });
  const instruction = Buffer.alloc(10); instruction[0] = 14; instruction.writeBigUInt64LE(100n, 1); instruction[9] = 8;
  const tokenBalance = amount => ({ accountIndex: 4, mint: f.policy.manifest.mint.id,
    programId: f.policy.manifest.mint.tokenProgram, uiTokenAmount: { amount, decimals: 8 } });
  const execution = { version: "legacy", slot: 88, transaction: [packet.preparedTransactionBase64, "base64"], meta: { err: null,
    innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 8, accounts: [3, 4, 7], data: base58Encode(instruction), stackHeight: 2 }] }],
    preTokenBalances: [tokenBalance("0")], postTokenBalances: [tokenBalance("100")] } };
  const accounts = f.accounts({ receipt: true, claim: true });
  const mintData = Buffer.from(accounts.accounts[2].data[0], "base64"); mintData.writeBigUInt64LE(100n, 36);
  accounts.accounts[2].data[0] = mintData.toString("base64");
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body); calls.push(method);
    let result;
    if (method === "getGenesisHash") result = genesis;
    else if (method === "getBlockHeight") result = 10;
    else if (method === "getSignatureStatuses") result = { value: [landed ? { confirmationStatus: finalized ? "finalized" : "confirmed", slot: 88, err: null } : null] };
    else if (method === "getSlot") result = 88;
    else if (method === "getTransaction") result = execution;
    else if (method === "getAccountInfo") {
      const value = params[0] === identity.depositClaimAccountBase58 ? accounts.accounts.at(-1) :
        params[0] === identity.mintAccountBase58 ? accounts.accounts[2] : null;
      result = { context: { slot: 88 }, value };
    }
    else if (method === "sendTransaction") {
      assert.equal(params[0], packet.preparedTransactionBase64);
      assert.equal(params[1].skipPreflight, false); assert.equal(params[1].preflightCommitment, "finalized");
      assert.equal(journal.get(f.message.operationIdHex).submittedSignature, signature);
      sends.push(params[0]); landed = true; if (loseResponse) throw Error("synthetic lost response"); result = signature;
    } else throw Error("UNEXPECTED_TEST_RPC");
    return Response.json({ jsonrpc: "2.0", id, result });
  });
  const rpcClient = SolanaLocalRpcClient.createMainnet({ endpoint, expectedGenesis: SOLANA_MAINNET_GENESIS, productionBroadcastAuthorized: true });
  const claimObserver = SolanaDepositClaimObserver.createMainnet({ endpoint, config: { ...config, nativeDecimals: 8 } });
  const options = { config, rpcClient, claimObserver, journal, productionBroadcastAuthorized: true,
    beforeBroadcast: async value => { admission.push(value); return allowed; } };
  return { f, config, request, options, journal, calls, sends, admission, execution, identity,
    finalize: () => { finalized = true; landed = true; },
    allow: value => { allowed = value; }, cluster: value => { genesis = value; }, loseResponse: () => { loseResponse = true; } };
}

test("Mainnet claim transport requires explicit bound observer, durable journal and broadcast admission", async t => {
  const f = await setup(t);
  for (const change of [{ productionBroadcastAuthorized: false }, { beforeBroadcast: undefined }, { journal: undefined },
    { journal: new InMemorySolanaDepositClaimJournal() }, { claimObserver: {} },
    { rpcClient: SolanaLocalRpcClient.createMainnet({ endpoint, expectedGenesis: SOLANA_MAINNET_GENESIS }) }])
    assert.throws(() => SolanaDepositClaimSubmitter.createMainnet({ ...f.options, ...change }));
  for (const change of [{ environment: "devnet" }, { cluster: "devnet" }, { solanaGenesis: SOLANA_DEVNET_GENESIS },
    { nativeNetwork: 8000111 }, { nativeGenesis: "01".repeat(32) }, { mintHex: "02".repeat(32) }])
    assert.throws(() => SolanaDepositClaimSubmitter.createMainnet({ ...f.options, config: { ...f.config, ...change } }));
  SolanaDepositClaimSubmitter.createMainnet(f.options);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.sends, []);
});

test("Mainnet live admission prevents submission and does not mark a denied packet submitted", async t => {
  const f = await setup(t), service = SolanaDepositClaimSubmitter.createMainnet(f.options);
  f.allow(false); await assert.rejects(service.submitDepositClaim(f.request), /MainnetClaimBroadcastNotAdmitted/);
  assert.equal(f.sends.length, 0); assert.equal(f.admission.length, 1);
  assert.equal(f.admission[0].operationIdHex, f.f.message.operationIdHex);
  assert.equal(f.admission[0].encodedMessageHex, f.request.encodedMessageHex);
  assert.equal(f.journal.get(f.f.message.operationIdHex).submittedSignature, undefined);
  f.allow(true); assert.equal((await service.submitDepositClaim(f.request)).state, "WAITING_FOR_FINALITY");
  assert.equal(f.sends.length, 1);
});

test("Mainnet lost response resumes the same persisted signature without another send", async t => {
  const f = await setup(t); f.loseResponse();
  assert.equal((await SolanaDepositClaimSubmitter.createMainnet(f.options).submitDepositClaim(f.request)).state, "WAITING_FOR_DEPENDENCY");
  const restarted = SolanaDepositClaimSubmitter.createMainnet(f.options);
  assert.equal((await restarted.submitDepositClaim(f.request)).state, "WAITING_FOR_FINALITY");
  assert.equal(f.sends.length, 1); assert.equal(f.admission.length, 1);
});

test("Mainnet wrong cluster and modified prepared packet cannot reach send", async t => {
  const f = await setup(t), service = SolanaDepositClaimSubmitter.createMainnet(f.options);
  const mutated = Buffer.from(f.request.preparedTransactionBase64, "base64"); mutated[110] ^= 1;
  await assert.rejects(service.submitDepositClaim({ ...f.request, preparedTransactionBase64: mutated.toString("base64") }));
  assert.equal(f.calls.length, 0);
  f.cluster(SOLANA_DEVNET_GENESIS);
  assert.equal((await service.submitDepositClaim(f.request)).state, "WAITING_FOR_DEPENDENCY");
  assert.equal(f.sends.length, 0); assert.equal(f.admission.length, 0);
});

test("Mainnet finalized execution keeps the complete domain through observation and restart", async t => {
  const f = await setup(t); f.finalize();
  const input = { operationIdHex: f.f.message.operationIdHex, messageDigestHex: f.f.message.messageDigestHex,
    solanaSignature: f.identity.solanaSignature, depositClaimAccountBase58: f.identity.depositClaimAccountBase58,
    mintAccountBase58: f.identity.mintAccountBase58 };
  const observed = await f.options.claimObserver.observeProtectedFinalizedDepositClaim(input, SOLANA_MAINNET_GENESIS);
  assert.equal(observed.genesis, SOLANA_MAINNET_GENESIS); assert.equal(observed.depositClaim.mintedAmountAtomic, "100");
  assert.throws(() => verifyDepositMintExecution(f.execution, observed, { ...f.config, nativeDecimals: 8, nativeNetwork: 8000111 }), /EXECUTION_MISMATCH/);
  const first = await SolanaDepositClaimSubmitter.createMainnet(f.options).submitDepositClaim(f.request);
  assert.equal(first.state, "COMPLETED");
  assert.deepEqual(await SolanaDepositClaimSubmitter.createMainnet(f.options).submitDepositClaim(f.request), first);
  assert.equal(f.sends.length, 0); assert.equal(f.admission.length, 0);
});

test("Mainnet terminal state recorded during admission cannot be overwritten by a late send", async t => {
  const f = await setup(t), terminal = { state: "HARD_STOP", reason: "TEST_RECONCILIATION_CONTRADICTION" };
  const service = SolanaDepositClaimSubmitter.createMainnet({ ...f.options, beforeBroadcast: async () => {
    f.journal.recordTerminal(f.f.message.operationIdHex, terminal); return true;
  } });
  assert.deepEqual(await service.submitDepositClaim(f.request), terminal);
  assert.equal(f.sends.length, 0); assert.equal(f.journal.get(f.f.message.operationIdHex).state, "HARD_STOP");
});
