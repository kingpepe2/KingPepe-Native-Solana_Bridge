// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real isolated chains/user transaction; all economic signing and delivery after
// preparation must occur in the separately protected Windows services.
import assert from "node:assert/strict";
import { constants, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow,
  submitLocalnetSolanaSetup, taprootAddressFromXOnlyPublicKey } from "../../scripts/local-e2e-native-to-solana.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { validateDepositOperationPlan } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { prepareLocalNativeReserveSweepSigningIntent } from "../../services/bridge-validator/native-reserve-sweep-signing-intent.mjs";
import { nativeReserveCreditEvidenceInput } from "../../services/bridge-validator/native-reserve-credit.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot } from "../../services/solana-observer/deployment-integrity.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimObserver } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { base58Encode, findProgramAddress, DEPOSIT_CLAIM_PDA_SEED_PREFIX } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { validateRuntimeStateRoot, validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../.."); let stage = "BOOTSTRAP", mining = Promise.resolve(), timer, failedMining = false;
try {
  assert.equal(process.platform, "linux");
  const root = validateRuntimeStateRoot(process.env.KINGPEPE_LOCAL_WINDOWS_CHAIN_ROOT, repoRoot);
  const file = name => validateRuntimeFile(path.join(root, name), repoRoot);
  const put = (name, value) => writeFileSync(file(name), JSON.stringify(value), { flag: "wx", mode: 0o600 });
  const wait = async (name, timeout = 1200000) => {
    const until = Date.now() + timeout;
    while (!existsSync(file(name))) { assert(Date.now() < until && !failedMining && !existsSync(file("abort")), "ProtectedControllerHostWaitFailed"); await delay(200); }
    const bytes = readFileSync(file(name)); assert(bytes.length <= 250000); return JSON.parse(bytes);
  };
  const sourceSha = process.env.KINGPEPE_TEST_SOURCE_SHA; assert.match(sourceSha, /^[0-9a-f]{40}$/u);
  const postMintReorg = process.env.KINGPEPE_TEST_CONTROLLER_POST_MINT_REORG === "1";
  assert([undefined, "1"].includes(process.env.KINGPEPE_TEST_CONTROLLER_POST_MINT_REORG), "UnknownDisposableReorgMode");
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    const { plan, executor, commandPaths } = context, generated = createLocalSolanaSetupContext();
    const c = createNativeToSolanaFlowConfig({ plan, repoRoot, mintHex: generated.mintHex, policyEpoch: generated.policyEpoch, keyEpoch: generated.keyEpoch });
    const endpoint = "http://127.0.0.1:" + plan.ports.solanaRpcPort, rpc = new SolanaLocalRpcClient({ endpoint }), chain = new LocalDeploymentRpc({ endpoint });
    const genesis = await chain.genesis();
    const initialPolicy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: c.solanaDeploymentHex, solanaGenesis: genesis,
      minimumSolanaSlot: "1", managerProgramId: c.bridgeProgramIdHex, transceiverProgramId: c.transceiverProgramIdHex, mint: c.mintHex,
      protocolId: c.protocolId, nativeNetwork: c.nativeNetwork, policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch,
      csvDelayBlocks: c.recoveryDelayBlocks, minimumConfirmations: c.depositFinalityBlocks, maximumAmountAtomic: c.maxAmountAtomic, maximumFeeAtomic: c.maxFeeAtomic };
    copyFileSync(path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), file("disposable-rpc.cookie"), constants.COPYFILE_EXCL);
    put("bootstrap.json", { protocol: "KINGPEPE_PROTECTED_DEPOSIT_BOOTSTRAP_V1", policy: initialPolicy,
      nativeRpcPort: plan.ports.nativeRpcPort, solanaRpcPort: plan.ports.solanaRpcPort });
    stage = "PROTECTED_PUBLIC_IDENTITIES"; const identities = await wait("identities.json");
    assert.equal(identities.protocol, "KINGPEPE_DISPOSABLE_PROTECTED_IDENTITIES_V1");
    assert.match(identities.frostPublicKeyHex, /^[0-9a-f]{64}$/u);
    assert(Array.isArray(identities.attesterPublicKeysHex) && identities.attesterPublicKeysHex.length === 2);
    identities.attesterPublicKeysHex.forEach(v => assert.match(v, /^[0-9a-f]{64}$/u));
    assert.notEqual(identities.attesterPublicKeysHex[0], identities.attesterPublicKeysHex[1]);
    const policy = { ...initialPolicy, frostPublicKeyHex: identities.frostPublicKeyHex };
    // No authorized attester key exists in this Linux host. These public-only
    // identities deliberately reject any accidental legacy signing invocation.
    const publicOnly = hex => ({ publicKeyHex: hex, publicKeyBase58: base58Encode(Buffer.from(hex, "hex")),
      sign() { throw new Error("ProtectedWindowsAttesterRequired"); } });
    const setup = { ...generated, attesterPublicKeysHex: identities.attesterPublicKeysHex,
      attesterASigner: publicOnly(identities.attesterPublicKeysHex[0]), attesterBSigner: publicOnly(identities.attesterPublicKeysHex[1]) };
    stage = "ZERO_SUPPLY_SETUP";
    assert.equal((await submitLocalnetSolanaSetup({ plan, flowConfig: c, localSolanaSetupContext: setup,
      nativeSource: { nativeGenesisHash: REGTEST_GENESIS } })).state, "COMPLETED");
    const payerFunding = await rpc.requestAirdrop(identities.feePayerPublicKey, 1000000000);
    let funded = false; for (let i = 0; i < 150; i++) { const s = await rpc.getSignatureStatus(payerFunding); if (s?.confirmationStatus === "finalized" && s.err === null) { funded = true; break; } await delay(200); } assert(funded);
    const manifest = await localDeploymentManifest({ context: { ...context, flowConfig: c, localSolanaSetupContext: setup, nativeSource: { nativeGenesisHash: REGTEST_GENESIS } },
      authority: "11111111111111111111111111111111", sourceSha });
    assert.equal(verifyDeploymentSnapshot(manifest, await chain.snapshot(manifest)).mintSupplyAtomic, "0");
    const custody = { aggregateTweakedXOnlyPublicKey: policy.frostPublicKeyHex, taprootScriptPubKeyHex: "5120" + policy.frostPublicKeyHex,
      taprootAddress: taprootAddressFromXOnlyPublicKey(policy.frostPublicKeyHex, "rkpepe") };
    const prepared = await executeNativeDepositObservationFlow({ ...context, flowConfig: c, localSolanaSetupContext: setup,
      custodyFactory: async () => custody,
      reserveSweepSigner: async () => { throw new Error("LegacySigningForbidden"); },
      protectedDepositPreparation: async f => {
        stage = "REAL_DEPOSIT_PREPARED";
        const signingIntents = f.taprootSighashEvidences.map(nativeSighashEvidence => prepareLocalNativeReserveSweepSigningIntent({
          operationIdHex: f.operationIdHex, config: { environment: "localnet", nativeNetworkName: "regtest", nativeGenesisHash: REGTEST_GENESIS,
            solanaDeployment: c.solanaDeploymentHex, bridgeProgramId: c.bridgeProgramIdHex, transceiverProgramId: c.transceiverProgramIdHex,
            mint: c.mintHex, keyEpoch: c.keyEpoch, maxAmountAtomic: c.maxAmountAtomic, maxFeeAtomic: c.maxFeeAtomic },
          deposit: { depositOutpoint: f.inputs[0].txid + ":" + f.inputs[0].vout, amountAtomic: c.amountAtomic, proofFingerprintHex: f.inputEvidence.digestHex,
            finalitySatisfied: true, utxoUnspent: true }, reserveSweepDraft: f.reserveSweepDraft, nativeSighashEvidence }).signingIntent);
        const operationPlan = validateDepositOperationPlan({ operationId: f.operationIdHex, depositIntent: f.depositIntentContext,
          depositPolicy: f.depositPolicy, inputs: f.inputs, acceptedCheckpoint: f.inputEvidence.acceptedCheckpoint,
          unsignedTransactionHex: f.reserveSweepDraft.unsignedNativeTransactionHex, signingIntents }, policy);
        const deliveryPolicy = { operationPolicy: policy, manifest, feePayerPublicKey: identities.feePayerPublicKey };
        put("prepared.json", { protocol: "KINGPEPE_REAL_PROTECTED_DEPOSIT_PREPARED_V1", policy, manifest, operationPlan, deliveryPolicy });
        // Real regtest mining, never a synthetic source-health assertion.
        const cli = () => executor.runOneShot({ step: "LOCAL_PROTECTED_CONTROLLER_MINE", executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort,
            wallet: c.userWalletName, command: "generatetoaddress", parameters: ["1", f.miningAddress] }), cwd: repoRoot });
        timer = setInterval(() => { mining = mining.then(cli).catch(() => { failedMining = true; }); }, 15000);
        stage = "HOST_WAIT_COMPLETION"; const completion = await wait("controller-completed.json");
        stage = "HOST_COMPLETION_SHAPE";
        assert.equal(completion.state, "COMPLETED"); assert.equal(completion.operationId, operationPlan.operationId);
        assert.equal(completion.book.plan.operationId, operationPlan.operationId); assert(completion.book.finalizedCredit && completion.book.mintReceipt);
        stage = "HOST_NATIVE_VERIFIER_SETUP"; const native = await createLocalNativeEvidenceVerifier({ plan });
        stage = "HOST_NATIVE_RESERVE_RECHECK";
        const reserve = await native.verifyReserve(nativeReserveCreditEvidenceInput(operationPlan, policy, completion.book.finalizedCredit.acceptedCheckpoint));
        stage = "HOST_NATIVE_RESERVE_AMOUNT"; assert.equal(reserve.reserveBasis.amountAtomic, c.amountAtomic);
        const m = decodeCanonicalBridgeMessage(Buffer.from(completion.book.finalizedCredit.encodedMessageHex, "hex"));
        const claim = findProgramAddress([Buffer.from(DEPOSIT_CLAIM_PDA_SEED_PREFIX), Buffer.from(m.operationIdHex, "hex")], Buffer.from(policy.managerProgramId, "hex"));
        const observer = new SolanaDepositClaimObserver({ endpoint, config: { environment: "localnet", cluster: "localnet",
          managerProgramIdHex: policy.managerProgramId, transceiverProgramIdHex: policy.transceiverProgramId, mintHex: policy.mint, nativeDecimals: 8 } });
        stage = "HOST_FINALIZED_MINT_RECHECK";
        const observed = await observer.observeProtectedFinalizedDepositClaim({ solanaSignature: completion.book.mintReceipt.signature,
          operationIdHex: m.operationIdHex, messageDigestHex: m.messageDigestHex, depositClaimAccountBase58: claim.base58, mintAccountBase58: manifest.mint.id }, genesis);
        stage = "HOST_FINALIZED_MINT_AMOUNT"; assert.equal(observed.depositClaim.mintedAmountAtomic, c.amountAtomic);
        stage = "HOST_FINALIZED_SUPPLY_RECHECK"; const bank = verifyDeploymentSnapshot(manifest, await chain.snapshot(manifest));
        assert.equal(bank.mintSupplyAtomic, c.amountAtomic); assert.equal(bank.managerMintedAtomic, c.amountAtomic);
        stage = "HOST_PUBLISH_RECHECK";
        put("host-verified.json", { state: "COMPLETED", reserveAtomic: c.amountAtomic, mintedAtomic: c.amountAtomic });
        if (postMintReorg) {
          assert.equal((await wait("reorg-request.json")).action, "REGTEST_HIGHER_WORK_POST_MINT_REORG");
          clearInterval(timer); await mining; stage = "REAL_POST_MINT_HIGHER_WORK_FORK";
          const old = await native.observeChain(), sweep = completion.book.finalizedCredit.reserveBasis.sweep;
          assert(old.tipHeight >= sweep.height && old.tipHeight - sweep.height < 1000);
          const command = async (command, parameters) => {
            assert(["invalidateblock", "reconsiderblock", "generateblock", "generatetoaddress"].includes(command));
            return executor.runOneShot({ step: "LOCAL_PROTECTED_REORG_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
              args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort,
                wallet: c.userWalletName, command, parameters }), cwd: repoRoot });
          };
          await command("invalidateblock", [sweep.blockHash]);
          // Mine genuine empty competing blocks, excluding the old mempool
          // sweep; otherwise ordinary mining may immediately reinclude it.
          for (let i = 0; i < old.tipHeight - sweep.height + 3; i++) await command("generateblock", [f.miningAddress, "[]"]);
          const fork = await native.observeChain();
          assert(BigInt("0x" + fork.chainworkHex) > BigInt("0x" + old.chainworkHex));
          put("reorg-completed.json", { action: "REGTEST_HIGHER_WORK_POST_MINT_REORG" });
          assert.equal((await wait("chain-recovery-request.json")).action, "REGTEST_CHAIN_HEALTH_RECOVERY");
          await command("reconsiderblock", [sweep.blockHash]);
          await command("generatetoaddress", [String(c.depositFinalityBlocks + 1), f.miningAddress]);
          const recovered = await native.observeChain(); assert.equal(recovered.genesis, REGTEST_GENESIS);
          assert.equal(verifyDeploymentSnapshot(manifest, await chain.snapshot(manifest)).mintSupplyAtomic, c.amountAtomic);
          put("chain-recovered.json", { action: "REGTEST_CHAIN_HEALTH_RECOVERY" });
        }
        stage = "HOST_WINDOWS_DONE"; assert.equal((await wait("windows-done.json")).state, "COMPLETED");
        clearInterval(timer); await mining;
      } });
    assert.equal(prepared.state, "LOCAL_PROTECTED_DEPOSIT_PREPARED");
    assert.equal(prepared.signed, false); assert.equal(prepared.broadcast, false); assert.equal(prepared.minted, false);
    return { state: "COMPLETED", scope: "ACTUAL_WINDOWS_PROTECTED_SERVICES_WITH_INDEPENDENT_LINUX_CHAIN_RECHECK",
      productionReady: false, mainnetActivation: "DISABLED", phase09: "NOT_STARTED" };
  });
  assert.equal(result.state, "LOCAL_E2E_BOOTSTRAP_READY"); // Bootstrap owns lifecycle; callback result is retained below.
  console.log(JSON.stringify({ state: "COMPLETED", productionReady: false, mainnetActivation: "DISABLED", phase09: "NOT_STARTED" }));
} catch (error) {
  const codes = ["RAW_NATIVE_SOURCE_CHANGED", "RAW_NATIVE_RESERVE_NOT_AVAILABLE", "RAW_NATIVE_ACCEPTANCE_DIGEST_CHANGED",
    "RAW_NATIVE_ACCEPTANCE_CHECKPOINT_REJECTED", "RAW_NATIVE_SWEEP_SIGNATURE_INVALID", "ProtectedControllerHostWaitFailed"];
  console.error("LOCAL_PROTECTED_CONTROLLER_HOST_FAILED:" + JSON.stringify({ stage,
    errorType: ["Error", "TypeError", "SyntaxError", "AssertionError"].includes(error?.name) ? error.name : "REDACTED",
    code: codes.includes(error?.message) ? error.message : "REDACTED" })); process.exitCode = 1;
}
finally { clearInterval(timer); await mining; if (failedMining) { console.error("LOCAL_PROTECTED_CONTROLLER_MINING_FAILED"); process.exitCode = 1; } }
