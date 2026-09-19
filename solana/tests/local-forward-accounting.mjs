// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual isolated-chain forward accounting, including ordinary SPL owner burn.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig,
  createLocalFrostTaprootCustodyContext, executeNativeDepositObservationFlow,
  openLocalnetDepositCreditLedger, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { base58Decode, base58Encode, prepareSignedLocalnetSolanaDepositClaimTransaction } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN, SYSTEM_PROGRAM_ID_BASE58 as SYSTEM } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { compareDepositAccounting } from "../../services/reconciliation/deposit-reconciliation.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot } from "../../services/solana-observer/deployment-integrity.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { requireVerifiedRegtestReserve, verifiedReserveChain } from "../../native/node/native-raw-evidence.mjs";
import { packet } from "./local-transaction-packet.mjs";

function ephemeralUser() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  return { publicKeyBase58: base58Encode(bytes), publicKeyHex: bytes.toString("hex"),
    sign: bytesToSign => sign(null, bytesToSign, privateKey) };
}
async function ordinaryOwnerBurn(context, user) {
  const setup = context.localSolanaSetupContext;
  const rpc = new SolanaLocalRpcClient({ endpoint: `http://127.0.0.1:${context.plan.ports.solanaRpcPort}` });
  const mint = base58Encode(Buffer.from(setup.mintHex, "hex"));
  const source = base58Encode(Buffer.from(context.depositClaimRequest.request.solanaRecipientHex, "hex"));
  const before = await rpc.getAccountInfo(mint), latest = await rpc.getLatestBlockhash();
  const amount = Buffer.alloc(8); amount.writeBigUInt64LE(1n);
  // Standard SPL owner action, no Bridge instruction or reserve authorization.
  const encoded = await packet(setup.feePayerSigner, [user], latest.blockhash, [{ program: TOKEN,
    accounts: [{ key: source, writable: true }, { key: mint, writable: true }, { key: user.publicKeyBase58, signer: true }],
    data: Buffer.concat([Buffer.from([15]), amount, Buffer.from([8])]) }]);
  const signature = await rpc.sendTransaction(encoded, { encoding: "base64", skipPreflight: false, maxRetries: 0 });
  let finalized = false;
  for (let n = 0; n < 240; n++) {
    const status = await rpc.getSignatureStatus(signature);
    if (status?.confirmationStatus === "finalized") { assert.equal(status.err, null); finalized = true; break; }
    await delay(250);
  }
  assert(finalized, "OWNER_BURN_FINALITY_REQUIRED");
  const after = await rpc.getAccountInfo(mint);
  assert.equal(Buffer.from(before.data[0], "base64").readBigUInt64LE(36) - Buffer.from(after.data[0], "base64").readBigUInt64LE(36), 1n);
}

async function testMintAfterDirectBurn({ context, firstClaim, firstFlow, custodyFactory, nativeEvidenceVerifierFactory,
  reserveInputs, getVerifier, onCheck, sourceSha }) {
  const passed = [], { plan } = context, setup = firstClaim.localSolanaSetupContext;
  // The shared manifest helper has no dependency on an executing test entrypoint.
  const { localDeploymentManifest } = await import("./local-deployment-integrity.mjs");
  const manifest = await localDeploymentManifest({ context: firstClaim, authority: SYSTEM, sourceSha });
  const rpc = new LocalDeploymentRpc({ endpoint: `http://127.0.0.1:${plan.ports.solanaRpcPort}` });
  const before = verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest));
  assert.equal(BigInt(before.managerMintedAtomic) - BigInt(before.mintSupplyAtomic), 1n);
  const flowConfig = createNativeToSolanaFlowConfig({ plan, repoRoot: plan.repoRoot, mintHex: setup.mintHex,
    keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
  let nextClaim;
  onCheck("SECOND_NATIVE_SWEEP_VERIFIED_WITH_CREDIT_RETAINED");
  const second = await executeNativeDepositObservationFlow({ ...context, flowConfig, localSolanaSetupContext: setup,
    custodyFactory, nativeEvidenceVerifierFactory,
    solanaSetup: async () => {
      // Reuse only the actually initialized and freshly verified deployment.
      // Never reinitialize, synthesize a proof receipt or bypass Native checks.
      verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest, before.slot));
      return firstClaim.localnetSolanaSetup;
    },
    solanaDepositClaim: async input => {
      nextClaim = input;
      return { state: "WAITING_FOR_DEPENDENCY", reason: "LOCAL_TEST_SECOND_CREDIT_HELD_FOR_COUNTER_PROBE" };
    } });
  assert.equal(second.state, "WAITING_FOR_DEPENDENCY");
  assert.ok(nextClaim);
  requireVerifiedRegtestReserve(second.nativeRawEvidence.reserveEvidence);
  assert.equal(second.depositAccounting.snapshot.authorizedUnmintedCredits, flowConfig.amountAtomic);
  assert.notEqual(nextClaim.operationIdHex, firstClaim.operationIdHex);
  assert.equal(reserveInputs.size, 2);
  passed.push("SECOND_NATIVE_SWEEP_VERIFIED_WITH_CREDIT_RETAINED");

  // This second operation deliberately pauses before the single-deposit
  // harness's reconciliation. Exercise the genuine claim submitter here, then
  // reconcile both finalized reserves together below.
  onCheck("DIRECT_BURN_DIFFERENCE_SURVIVES_VERIFIED_MINT");
  const minted = await submitLocalnetSolanaDepositClaim(nextClaim);
  assert.equal(minted.state, "COMPLETED");
  const after = verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest, before.slot));
  const amount = BigInt(flowConfig.amountAtomic);
  assert.equal(BigInt(after.managerMintedAtomic), BigInt(before.managerMintedAtomic) + amount);
  assert.equal(BigInt(after.mintSupplyAtomic), BigInt(before.mintSupplyAtomic) + amount);
  assert.equal(BigInt(after.managerMintedAtomic) - BigInt(after.mintSupplyAtomic), 1n);
  const creditFor = input => ({ encodedMessageHex: input.depositClaimRequest.request.encodedMessageHex,
    reserveAllocationIdHex: input.depositClaimRequest.publicRequest.reserveAllocationIdHex });
  const secondCredit = creditFor(nextClaim);
  let secondLedger = openLocalnetDepositCreditLedger({ plan, flowConfig, credit: secondCredit,
    minimumCheckpoint: second.depositAccounting.checkpoint });
  let settledCheckpoint, secondSnapshot;
  try {
    secondLedger.recordMint({ ...secondCredit, mintedAmountAtomic: minted.mintedAmountAtomic });
    settledCheckpoint = secondLedger.checkpoint();
  } finally { secondLedger.close(); }
  secondLedger = openLocalnetDepositCreditLedger({ plan, flowConfig, credit: secondCredit, minimumCheckpoint: settledCheckpoint });
  try { secondSnapshot = secondLedger.snapshot(); }
  finally { secondLedger.close(); }
  assert.equal(secondSnapshot.authorizedUnmintedCredits, "0");
  assert.equal(secondSnapshot.mintedSupply, minted.mintedAmountAtomic);
  passed.push("DIRECT_BURN_DIFFERENCE_SURVIVES_VERIFIED_MINT");

  onCheck("TWO_FINALIZED_RESERVES_RECONCILE_EXACT_ISSUANCE");
  const verifier = getVerifier(), chain = await verifier.observeChain();
  let reserve = 0n;
  for (const input of [...reserveInputs.values()]) {
    const receipt = await verifier.verifyReserve(input);
    requireVerifiedRegtestReserve(receipt);
    assert.equal(verifiedReserveChain(receipt).tipHash, chain.tipHash);
    reserve += BigInt(receipt.reserveBasis.amountAtomic);
  }
  const snapshot = verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest, after.slot));
  assert.equal((await verifier.observeChain()).tipHash, chain.tipHash);
  const firstLedger = openLocalnetDepositCreditLedger({ plan, flowConfig: firstClaim.flowConfig, credit: creditFor(firstClaim),
    minimumCheckpoint: firstFlow.depositAccounting.checkpoint });
  let firstSnapshot;
  try { firstSnapshot = firstLedger.snapshot(); } finally { firstLedger.close(); }
  const journal = Object.fromEntries(["canonicalReserve", "authorizedUnmintedCredits", "mintedSupply"]
    .map(key => [key, (BigInt(firstSnapshot[key]) + BigInt(secondSnapshot[key])).toString()]));
  const totals = compareDepositAccounting(journal, { canonicalReserve: reserve.toString(), ...snapshot });
  assert.equal(totals.unclaimedDirectBurnDifference, "1");
  assert.equal(totals.reserveReleaseAuthorized, false);
  passed.push("TWO_FINALIZED_RESERVES_RECONCILE_EXACT_ISSUANCE");

  onCheck("REOPENED_POST_DIRECT_BURN_MINT_DOES_NOT_MINT_AGAIN");
  const resumed = await submitLocalnetSolanaDepositClaim(nextClaim);
  assert.equal(resumed.state, "COMPLETED");
  const replayBefore = await rpc.snapshot(manifest);
  assert.equal(verifyDeploymentSnapshot(manifest, replayBefore).managerMintedAtomic, after.managerMintedAtomic);
  passed.push("REOPENED_POST_DIRECT_BURN_MINT_DOES_NOT_MINT_AGAIN");

  onCheck("POST_DIRECT_BURN_NEW_TRANSACTION_CLAIM_REPLAY_REJECTED");
  const transport = new SolanaLocalRpcClient({ endpoint: `http://127.0.0.1:${plan.ports.solanaRpcPort}` });
  const latest = await transport.getLatestBlockhash(), c = flowConfig, request = nextClaim.depositClaimRequest.request;
  const prepared = await prepareSignedLocalnetSolanaDepositClaimTransaction({
    environment: "localnet", cluster: "localnet", solanaDeploymentHex: c.solanaDeploymentHex,
    managerProgramIdHex: c.bridgeProgramIdHex, transceiverProgramIdHex: c.transceiverProgramIdHex, mintHex: c.mintHex,
    tokenProgramIdHex: Buffer.from(base58Decode(TOKEN)).toString("hex"), feePayerBase58: setup.feePayerBase58, feePayerHex: setup.feePayerHex,
    policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch, recipientTokenAccountHex: request.solanaRecipientHex,
    recentBlockhashBase58: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight,
    encodedMessageHex: request.encodedMessageHex, attestations: request.attestations, feePayerSigner: setup.feePayerSigner });
  const signature = await transport.sendTransaction(prepared.preparedTransactionBase64, { encoding: "base64", skipPreflight: true, maxRetries: 0 });
  assert.notEqual(signature, minted.solanaSignature, "CLAIM_REPLAY_REQUIRES_NEW_TRANSACTION_ID");
  let failed;
  for (let n = 0; n < 240; n++) {
    const status = await transport.getSignatureStatus(signature);
    if (status?.confirmationStatus === "finalized") { failed = status; break; }
    await delay(250);
  }
  assert.ok(failed?.err, "DUPLICATE_CLAIM_DID_NOT_FAIL_ON_CHAIN");
  assert.deepEqual((await rpc.snapshot(manifest)).accounts, replayBefore.accounts);
  passed.push("POST_DIRECT_BURN_NEW_TRANSACTION_CLAIM_REPLAY_REJECTED");
  return { pass: passed.length, fail: 0, passed,
    scope: "Two actual Native deposits, retained credit, subsequent Solana mint and aggregate accounting." };
}

export async function runLocalForwardAccountingRegression(repoRoot, { onCheck = () => {} } = {}) {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  if (process.env.KINGPEPE_TEST_SOURCE_SHA) assert.equal(process.env.KINGPEPE_TEST_SOURCE_SHA, sourceSha);
  let counterEvidence;
  let failure;
  let check;
  const mark = label => { check = label; onCheck(label); };
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    mark("FRESH_NATIVE_DEPOSIT_PREREQUISITE");
    const user = ephemeralUser();
    const setup = createLocalSolanaSetupContext();
    const localSolanaSetupContext = { ...setup, recipientTokenAccountOwnerBase58: user.publicKeyBase58,
      recipientTokenAccountOwnerHex: user.publicKeyHex };
    const flowConfig = createNativeToSolanaFlowConfig({ plan: context.plan, repoRoot, mintHex: setup.mintHex,
      keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
    let claimContext;
    let custody, verifier;
    const reserveInputs = new Map();
    const custodyFactory = async input => custody ??= await createLocalFrostTaprootCustodyContext(input);
    const nativeEvidenceVerifierFactory = async input => {
      verifier = await createLocalNativeEvidenceVerifier(input);
      const original = verifier.verifyReserve.bind(verifier);
      verifier.verifyReserve = async request => {
        const receipt = await original(request);
        reserveInputs.set(request.sweepTxid, structuredClone(request));
        return receipt;
      };
      return verifier;
    };
    const flow = await executeNativeDepositObservationFlow({ ...context, flowConfig, localSolanaSetupContext,
      custodyFactory, nativeEvidenceVerifierFactory,
      solanaDepositClaim: async input => { claimContext = input; return submitLocalnetSolanaDepositClaim(input); } });
    assert.equal(flow.state, "COMPLETED", "FRESH_DEPOSIT_PREREQUISITE_FAILED");
    // The first deposit has fully reconciled before this isolated owner burn.
    try {
      mark("DIRECT_OWNER_BURN_REDUCES_SUPPLY_ONLY"); await ordinaryOwnerBurn(claimContext, user);
      counterEvidence = await testMintAfterDirectBurn({ context, firstClaim: claimContext, firstFlow: flow, custodyFactory,
        nativeEvidenceVerifierFactory, reserveInputs, getVerifier: () => verifier, onCheck: mark, sourceSha });
    }
    catch (error) {
      // Emit only symbolic validation errors, never assertions containing keys,
      // account bytes, command output, exception stacks or private paths.
      failure = { check, code: /^[A-Z_]+$/u.test(error.message) ? error.message : "REGRESSION_ASSERTION_FAILED",
        testLine: Number(error.stack?.match(/local-forward-accounting\.mjs:(\d+):/u)?.[1]) || undefined,
        instructionError: error.cause?.InstructionError, diagnostic: error.cause?.diagnostic,
        computeUnitsConsumed: error.cause?.computeUnitsConsumed };
      throw error;
    }
    return { forwardAccounting: counterEvidence };
  });
  if (!counterEvidence) throw new Error("FORWARD_ACCOUNTING_NOT_COMPLETED", { cause: failure ?? { code: "LOCAL_INFRASTRUCTURE_OR_DEPOSIT_FAILED" } });
  return { sourceScope: "FORWARD_ACCOUNTING", infrastructure: result.state,
    sourceSha,
    worktreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim() !== "",
    forwardAccounting: { pass: counterEvidence.pass + 1, fail: 0,
      passed: ["DIRECT_OWNER_BURN_REDUCES_SUPPLY_ONLY", ...counterEvidence.passed] },
    productionReady: false, mainnetActivation: "DISABLED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await runLocalForwardAccountingRegression(process.argv[2] ?? path.resolve(import.meta.dirname, "../.."), {
      onCheck: label => process.stderr.write(`CHECK ${label}\n`),
    })));
  } catch (error) {
    console.error(JSON.stringify({ error: "LOCAL_FORWARD_ACCOUNTING_FAILED", detail: error.cause }));
    process.exitCode = 1;
  }
}
