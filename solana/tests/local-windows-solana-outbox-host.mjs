// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual disposable Native + validator fixture. Ephemeral fee-payer/attester
// private keys remain in this Linux test process, NEVER in Windows IPC or Git.
import assert from "node:assert/strict";
import { constants, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runLocalProtectedClaimObservation } from "./local-protected-claim-observation.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { initialDepositOperationState, validateDepositOperationPlan, decodeDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { validateSolanaDepositDelivery } from "../../services/relayer/solana-deposit-delivery.mjs";
import { validateRuntimeStateRoot, validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../..");
let stage = "START", timer, mining = Promise.resolve(), miningFailed = false;
try {
  assert.equal(process.platform, "linux");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  const file = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const sourceSha = process.env.KINGPEPE_TEST_SOURCE_SHA; assert.match(sourceSha, /^[0-9a-f]{40}$/u);
  const wait = async (name, expected, timeout = 600000) => {
    const until = Date.now() + timeout;
    while (!existsSync(file(name))) { assert(!miningFailed && !existsSync(file("abort")) && Date.now() < until, "SolanaOutboxControlUnavailable"); await delay(200); }
    assert.equal(readFileSync(file(name), "utf8"), expected);
  };
  const result = await runLocalProtectedClaimObservation(repoRoot, async f => {
    stage = "FINAL_MINT"; assert.equal(f.flow.state, "COMPLETED"); assert.equal(f.flow.reconciliation.state, "RECONCILED");
    writeFileSync(file("completed"), "COMPLETED", { flag: "wx", mode: 0o600 });
    await wait("windows-done", "WINDOWS_CHECKS_COMPLETED");
  }, undefined, async f => {
    stage = "PENDING_CREDIT_FIXTURE";
    const r = f.request, c = f.flowConfig, { plan, executor, commandPaths } = f.context;
    const manifest = await localDeploymentManifest({ context: { ...f.context, flowConfig: c, localSolanaSetupContext: f.setup, nativeSource: r.nativeSource },
      authority: "11111111111111111111111111111111", sourceSha });
    const policy = { environment: "localnet", nativeGenesis: r.nativeSource.nativeGenesisHash, solanaDeployment: c.solanaDeploymentHex,
      solanaGenesis: manifest.solanaGenesis, minimumSolanaSlot: "1", managerProgramId: c.bridgeProgramIdHex, transceiverProgramId: c.transceiverProgramIdHex,
      mint: c.mintHex, protocolId: c.protocolId, nativeNetwork: c.nativeNetwork, policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch,
      frostPublicKeyHex: f.testCustody.aggregateTweakedXOnlyPublicKey, csvDelayBlocks: c.recoveryDelayBlocks,
      minimumConfirmations: c.depositFinalityBlocks, maximumAmountAtomic: c.maxAmountAtomic, maximumFeeAtomic: c.maxFeeAtomic };
    const operationPlan = validateDepositOperationPlan({ operationId: f.signingIntents[0].operationId, depositIntent: r.depositIntentContext,
      depositPolicy: r.depositPolicy, inputs: f.inputs, acceptedCheckpoint: f.inputCheckpoint,
      unsignedTransactionHex: r.reserveSweepDraft.unsignedNativeTransactionHex, signingIntents: f.signingIntents }, policy);
    const state = JSON.parse(initialDepositOperationState(policy));
    state.operations.push({ plan: operationPlan, signedTransactionHex: r.signedReserveSweep.signedNativeTransactionHex,
      broadcastAttempted: true, broadcastAccepted: true, finalizedCredit: { acceptedCheckpoint: f.reserveReceipt.acceptedCheckpoint,
        reserveBasis: f.reserveReceipt.reserveBasis, encodedMessageHex: r.depositClaimRequest.request.encodedMessageHex,
        reserveAllocationIdHex: r.depositClaimRequest.publicRequest.reserveAllocationIdHex }, mintReceipt: null });
    decodeDepositOperationState(Buffer.from(JSON.stringify(state)), policy);
    const deliveryPolicy = { operationPolicy: policy, manifest, feePayerPublicKey: f.setup.feePayerBase58 };
    copyFileSync(path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), file("disposable-rpc.cookie"), constants.COPYFILE_EXCL);
    writeFileSync(file("fixture.json"), JSON.stringify({ protocol: "KINGPEPE_SOLANA_OUTBOX_CHAIN_FIXTURE_V1", policy, manifest, state, deliveryPolicy,
      nativeRpcPort: plan.ports.nativeRpcPort, solanaRpcPort: plan.ports.solanaRpcPort }), { flag: "wx", mode: 0o600 });
    // Mining empty REGTEST blocks maintains ACTUAL chain freshness; no synthetic
    // healthy report is accepted by the Windows supervisor.
    const cli = async (command, parameters) => executor.runOneShot({ step: "LOCAL_SOLANA_OUTBOX_TEST_" + command.toUpperCase(),
      executable: commandPaths.get("kingpepe-cli"), args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir,
        rpcPort: plan.ports.nativeRpcPort, wallet: c.userWalletName, command, parameters }), cwd: repoRoot });
    const address = String((await cli("getnewaddress", [])).output).trim();
    const advance = () => { mining = mining.then(() => cli("generateblock", [address, "[]"])).catch(() => { miningFailed = true; }); };
    advance(); timer = setInterval(advance, 15000);
    writeFileSync(file("ready"), "LOCAL_CHAINS_READY", { flag: "wx", mode: 0o600 });
    stage = "WINDOWS_INITIALIZATION"; await wait("windows-ready", "ACTUAL_SOURCES_READY");
    const rpc = new SolanaLocalRpcClient({ endpoint: "http://127.0.0.1:" + plan.ports.solanaRpcPort });
    let latest, sequence = 0;
    const getHash = rpc.getLatestBlockhash.bind(rpc);
    rpc.getLatestBlockhash = async () => { latest = await getHash(); return latest; };
    rpc.sendTransaction = async packet => {
      stage = "ACTUAL_WINDOWS_DELIVERY_" + (++sequence); assert(sequence <= 2 && latest);
      const delivery = { operationId: operationPlan.operationId, kind: sequence === 1 ? "RECEIPT" : "CLAIM",
        encodedMessageHex: r.depositClaimRequest.request.encodedMessageHex, attestations: r.depositClaimRequest.request.attestations,
        preparedTransactionBase64: packet, recentBlockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, minimumSlot: policy.minimumSolanaSlot };
      const checked = validateSolanaDepositDelivery(delivery, deliveryPolicy);
      writeFileSync(file("packet-" + sequence + ".json"), JSON.stringify(delivery), { flag: "wx", mode: 0o600 });
      await wait("delivered-" + sequence, "FINALIZED_ACCOUNT");
      const status = await rpc.getSignatureStatus(checked.signature);
      assert.equal(status?.err, null); assert.equal(status?.confirmationStatus, "finalized");
      // Only the actual signed transaction's finalized status permits returning
      // its signature. The Linux legacy broadcaster is never called.
      return checked.signature;
    };
    const outcome = await submitLocalnetSolanaDepositClaim({ ...r, rpcClient: rpc });
    assert.equal(sequence, 2); return outcome;
  });
  assert.equal(result.pass, 14);
  console.log(JSON.stringify({ state: "COMPLETED", chainChecks: result.pass, productionReady: false, nativePayout: "NOT_RUN_BY_THIS_TEST" }));
} catch { console.error("LOCAL_WINDOWS_SOLANA_OUTBOX_HOST_FAILED:" + stage); process.exitCode = 1; }
finally { clearInterval(timer); await mining; if (miningFailed) { console.error("LOCAL_SOLANA_OUTBOX_MINING_FAILED"); process.exitCode = 1; } }
