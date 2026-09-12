// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual REGTEST + Solana validator flow. Windows DPAPI persistence remains a
// separate gate; rejecting injected callbacks below is not chain proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow, submitLocalnetSolanaDepositClaim, createLocalFrostTaprootCustodyContext, submitLocalnetSolanaSetup } from "../../scripts/local-e2e-native-to-solana.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment } from "../../native/recovery/taproot-deposit.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { requireVerifiedRegtestReserve, REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { initialDepositOperationState, validateDepositOperationPlan, decodeDepositOperationState, depositOperationAccounting } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { SolanaDepositClaimObserver, requireProtectedClaimObservation } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";
import { LocalDeploymentRpc } from "../../services/solana-observer/deployment-integrity.mjs";
import { findProgramAddress, base58Encode, DEPOSIT_CLAIM_PDA_SEED_PREFIX } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";

export async function runLocalProtectedClaimObservation(repoRoot, afterObservation = undefined, beforeNativeBroadcast = undefined, solanaDelivery = undefined) {
  const passed = []; let stage = "BOOTSTRAP", failure;
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    try {
      const setup = createLocalSolanaSetupContext(), flowConfig = createNativeToSolanaFlowConfig({ plan: context.plan, repoRoot,
        mintHex: setup.mintHex, keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
      stage = "FRESH_NATIVE_TO_SOLANA";
      let inputs, inputCheckpoint, recoveryPublicKey, encodedMessageHex, nativeVerifier, testCustody, reserveReceipt, captureSigning = true;
      const verifiedSigningIntents = new Map();
      const flowOptions = {};
      if (beforeNativeBroadcast !== undefined) {
        assert.equal(typeof beforeNativeBroadcast, "function");
        // Real one-time initialization precedes protected-source admission.
        // This is test orchestration, not a runtime bypass or fictitious setup.
        const sourceRpc = new NativeRpcClient({ endpoint: "http://127.0.0.1:" + context.plan.ports.nativeRpcPort,
          authCookieFile: path.join(context.plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot });
        const genesis = (await sourceRpc.call("getblockhash", [0])).result;
        assert.equal(genesis, REGTEST_GENESIS); // Zero-supply setup, not economic validation.
        const initialized = await submitLocalnetSolanaSetup({ plan: context.plan, flowConfig, localSolanaSetupContext: setup,
          nativeSource: { nativeGenesisHash: genesis } });
        assert.equal(initialized.state, "COMPLETED");
        flowOptions.solanaSetup = async () => initialized;
        flowOptions.executor = { runOneShot: async request => {
          if (request.step === "LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP") {
            const c = flowConfig, solanaGenesis = await new LocalDeploymentRpc({ endpoint: "http://127.0.0.1:" + context.plan.ports.solanaRpcPort }).genesis();
            const policy = { environment: "localnet", nativeGenesis: genesis, solanaDeployment: c.solanaDeploymentHex, solanaGenesis,
              minimumSolanaSlot: "1", managerProgramId: c.bridgeProgramIdHex, transceiverProgramId: c.transceiverProgramIdHex, mint: c.mintHex,
              protocolId: c.protocolId, nativeNetwork: c.nativeNetwork, policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch,
              frostPublicKeyHex: testCustody.aggregateTweakedXOnlyPublicKey, csvDelayBlocks: c.recoveryDelayBlocks,
              minimumConfirmations: c.depositFinalityBlocks, maximumAmountAtomic: c.maxAmountAtomic, maximumFeeAtomic: c.maxFeeAtomic };
            const depositIntent = { nativeGenesisHex: genesis, solanaDeploymentHex: c.solanaDeploymentHex,
              managerProgramIdHex: c.bridgeProgramIdHex, transceiverProgramIdHex: c.transceiverProgramIdHex, mintHex: c.mintHex,
              recipientHex: setup.recipientTokenAccountHex, nonceHex: c.depositNonceHex, amountAtomic: c.amountAtomic,
              protocolId: c.protocolId, nativeNetwork: c.nativeNetwork, policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch };
            const at = request.args.indexOf("sendrawtransaction"); assert(at >= 0 && at + 2 === request.args.length);
            const signedTransactionHex = request.args[at + 1], parsed = parseNativeTransactionHex(signedTransactionHex);
            const operationPlan = validateDepositOperationPlan({ operationId: verifiedSigningIntents.get(0).operationId, depositIntent,
              depositPolicy: buildRegtestRecoverableDeposit({ nativeGenesisHex: genesis,
                depositCommitmentHex: deriveRegtestDepositCommitment(depositIntent), frostPublicKeyHex: policy.frostPublicKeyHex,
                userRecoveryPublicKeyHex: recoveryPublicKey, csvDelayBlocks: c.recoveryDelayBlocks }),
              inputs, acceptedCheckpoint: inputCheckpoint, unsignedTransactionHex: parsed.strippedHex,
              signingIntents: inputs.map((_, i) => verifiedSigningIntents.get(i)) }, policy);
            await beforeNativeBroadcast({ context, flowConfig, setup, policy, operationPlan, signedTransactionHex, nativeVerifier });
            // The callback must actually deliver to the node. Never fabricate
            // a broadcast response or invoke the legacy CLI broadcaster too.
            const observed = await context.executor.runOneShot({ ...request, step: "LOCAL_PROTECTED_OUTBOX_VERIFY_DELIVERY",
              args: buildRegtestCliArguments({ datadir: context.plan.paths.nativeDatadir, rpcPort: context.plan.ports.nativeRpcPort,
                command: "getrawtransaction", parameters: [parsed.txidHex, "false"] }) });
            assert.equal(String(observed.output).trim(), signedTransactionHex);
            return { output: parsed.txidHex };
          }
          const result = await context.executor.runOneShot(request);
          if (request.step === "LOCAL_E2E_GET_USER_RECOVERY_PUBLIC_KEY") recoveryPublicKey = JSON.parse(result.output).pubkey.slice(2);
          return result;
        } };
      }
      const flow = await executeNativeDepositObservationFlow({ ...context, ...flowOptions, flowConfig, localSolanaSetupContext: setup,
        custodyFactory: async options => { testCustody = await createLocalFrostTaprootCustodyContext(options); return testCustody; },
        nativeEvidenceVerifierFactory: async options => {
          const verifier = await createLocalNativeEvidenceVerifier(options), verify = verifier.verifyInputs.bind(verifier),
            verifySigning = verifier.verifySweepSigning.bind(verifier), verifyReserve = verifier.verifyReserve.bind(verifier);
          nativeVerifier = verifier;
          verifier.verifyReserve = async request => { const checked = await verifyReserve(request); reserveReceipt = checked; return checked; };
          verifier.verifyInputs = async request => {
            const checked = await verify(request); inputs ??= structuredClone(request.inputs); inputCheckpoint ??= checked.acceptedCheckpoint; return checked;
          };
          verifier.verifySweepSigning = async request => {
            const checked = await verifySigning(request), index = request.intent.signingInputIndex;
            if (captureSigning) {
              if (verifiedSigningIntents.has(index)) assert.deepEqual(verifiedSigningIntents.get(index), request.intent);
              verifiedSigningIntents.set(index, structuredClone(request.intent));
            }
            return checked;
          };
          return verifier;
        },
        solanaDepositClaim: async request => {
          encodedMessageHex = request.depositClaimRequest.request.encodedMessageHex;
          if (solanaDelivery !== undefined) {
            assert.equal(typeof solanaDelivery, "function"); requireVerifiedRegtestReserve(reserveReceipt);
            return solanaDelivery({ request, context, flowConfig, setup, inputs, inputCheckpoint, nativeVerifier, testCustody, reserveReceipt,
              signingIntents: inputs.map((_, i) => structuredClone(verifiedSigningIntents.get(i))) });
          }
          return submitLocalnetSolanaDepositClaim(request);
        },
      });
      // Later adversarial checks may sign a DIFFERENT isolated test operation.
      // Keep validating it, but do not confuse it with this flow's captured intent.
      captureSigning = false;
      assert.equal(flow.state, "COMPLETED"); assert.equal(flow.reconciliation.state, "RECONCILED");
      passed.push("FRESH_NATIVE_ACCEPTED_FROST_MINT_AND_RECONCILIATION");
      const endpoint = "http://127.0.0.1:" + context.plan.ports.solanaRpcPort;
      const genesis = await new LocalDeploymentRpc({ endpoint }).genesis();
      const config = { environment: "localnet", cluster: "localnet", managerProgramIdHex: flowConfig.bridgeProgramIdHex,
        transceiverProgramIdHex: flowConfig.transceiverProgramIdHex, mintHex: flowConfig.mintHex, nativeDecimals: flowConfig.nativeDecimals };
      const claim = flow.depositClaim;
      const request = { operationIdHex: claim.operationIdHex, messageDigestHex: claim.messageDigestHex,
        solanaSignature: flow.solanaDepositClaim.solanaSignature,
        depositClaimAccountBase58: findProgramAddress([Buffer.from(DEPOSIT_CLAIM_PDA_SEED_PREFIX), Buffer.from(claim.operationIdHex, "hex")], Buffer.from(config.managerProgramIdHex, "hex")).base58,
        mintAccountBase58: base58Encode(Buffer.from(config.mintHex, "hex")) };
      stage = "LIVE_GENESIS_BOUND_CLAIM";
      const observer = new SolanaDepositClaimObserver({ endpoint, config });
      const observation = await observer.observeProtectedFinalizedDepositClaim(request, genesis);
      requireProtectedClaimObservation(observation); assert.equal(observation.genesis, genesis);
      assert.equal(observation.depositClaim.mintedAmountAtomic, flowConfig.amountAtomic); assert.equal(observation.transaction.err, null);
      assert(BigInt(observation.rootSlot) >= BigInt(observation.slot)); passed.push("LIVE_GENESIS_FINALITY_AMOUNT_AND_CLAIM_BOUND");
      stage = "ACTUAL_OPERATION_PLAN";
      const policy = { environment: "localnet", nativeGenesis: flow.depositIntent.context.nativeGenesisHex,
        solanaDeployment: flowConfig.solanaDeploymentHex, solanaGenesis: genesis, minimumSolanaSlot: "1",
        managerProgramId: config.managerProgramIdHex, transceiverProgramId: config.transceiverProgramIdHex, mint: config.mintHex,
        protocolId: flowConfig.protocolId, nativeNetwork: flowConfig.nativeNetwork, policyEpoch: flowConfig.policyEpoch,
        keyEpoch: flowConfig.keyEpoch, frostPublicKeyHex: flow.frostCustody.aggregateTweakedXOnlyPublicKey,
        csvDelayBlocks: flowConfig.recoveryDelayBlocks, minimumConfirmations: flowConfig.depositFinalityBlocks,
        maximumAmountAtomic: flowConfig.maxAmountAtomic, maximumFeeAtomic: flowConfig.maxFeeAtomic };
      const operationPlan = validateDepositOperationPlan({ operationId: flow.reserveSweep.operationIdHex,
        depositIntent: flow.depositIntent.context, depositPolicy: flow.depositIntent.policy, inputs,
        acceptedCheckpoint: flow.nativeRawEvidence.inputEvidence.acceptedCheckpoint,
        unsignedTransactionHex: flow.reserveSweep.unsignedNativeTransactionHex,
        signingIntents: inputs.map((_, index) => verifiedSigningIntents.get(index)) }, policy);
      passed.push("OPERATION_PLAN_MATCHES_ACTUAL_NATIVE_ACCEPTED_TRANSACTION");
      stage = "ACTUAL_RESERVE_CODEC";
      requireVerifiedRegtestReserve(flow.nativeRawEvidence.reserveEvidence);
      const state = JSON.parse(initialDepositOperationState(policy)), reserve = flow.nativeRawEvidence.reserveEvidence;
      state.operations.push({ plan: operationPlan, signedTransactionHex: flow.reserveSweep.signedNativeTransactionHex,
        broadcastAttempted: true, broadcastAccepted: true, finalizedCredit: { acceptedCheckpoint: reserve.acceptedCheckpoint,
          reserveBasis: reserve.reserveBasis, encodedMessageHex, reserveAllocationIdHex: flow.depositClaim.reserveAllocationIdHex }, mintReceipt: null });
      const pending = depositOperationAccounting(state, policy);
      assert.equal(pending.canonicalReserve, flowConfig.amountAtomic); assert.equal(pending.authorizedUnmintedCredits, flowConfig.amountAtomic);
      assert.equal(pending.mintedSupply, "0"); assert.equal(pending.surplus, "0");
      passed.push("VERIFIED_FINAL_RESERVE_RECONSTRUCTS_EXACT_PENDING_CREDIT");
      stage = "ACTUAL_MINT_CODEC";
      state.operations[0].mintReceipt = { signature: observation.transaction.signature, slot: observation.slot, rootSlot: observation.rootSlot,
        genesis, operationId: observation.depositClaim.operationIdHex, messageDigest: observation.depositClaim.messageDigestHex,
        amountAtomic: observation.depositClaim.mintedAmountAtomic, recipientHex: observation.depositClaim.solanaRecipientHex, mint: observation.mint.addressHex };
      const reopened = decodeDepositOperationState(Buffer.from(JSON.stringify(state)), policy), settled = depositOperationAccounting(reopened, policy);
      assert.equal(settled.mintedSupply, flowConfig.amountAtomic); assert.equal(settled.authorizedUnmintedCredits, "0"); assert.equal(settled.surplus, "0");
      passed.push("ACTUAL_MINT_FACT_SURVIVES_CODEC_REOPEN_WITHOUT_SECOND_CREDIT");
      // The earlier successful setup transaction is real and finalized, but
      // it did not consume this claim or mint the represented deposit.
      stage = "UNRELATED_FINALIZED_TRANSACTION";
      assert.equal(typeof flow.solanaSetup.solanaSetupSignature, "string");
      await assert.rejects(observer.observeProtectedFinalizedDepositClaim({ ...request,
        solanaSignature: flow.solanaSetup.solanaSetupSignature }, genesis), /SOLANA_CLAIM_EXECUTION_MISMATCH/u);
      passed.push("UNRELATED_FINALIZED_TRANSACTION_CANNOT_DISCHARGE_CREDIT");
      stage = "IDENTITY_NEGATIVES";
      const wrong = createHash("sha256").update("unapproved-local-identity").digest();
      for (const [name, input, expectedGenesis] of [
        ["WRONG_GENESIS_REJECTED", request, base58Encode(wrong)],
        ["WRONG_CLAIM_PDA_REJECTED", { ...request, depositClaimAccountBase58: base58Encode(wrong) }, genesis],
        ["WRONG_MINT_REJECTED", { ...request, mintAccountBase58: base58Encode(wrong) }, genesis],
        ["WRONG_MESSAGE_REJECTED", { ...request, messageDigestHex: wrong.toString("hex") }, genesis],
      ]) { await assert.rejects(observer.observeProtectedFinalizedDepositClaim(input, expectedGenesis)); passed.push(name); }
      assert.throws(() => requireProtectedClaimObservation({ ...observation, depositClaim: { ...observation.depositClaim, mintedAmountAtomic: "1" } }), /ProtectedClaimObservationRequired/u);
      passed.push("COPIED_MUTATED_OBSERVATION_IS_NOT_A_CAPABILITY");
      await assert.rejects(new SolanaDepositClaimObserver({ endpoint, config: { ...config, managerProgramIdHex: wrong.toString("hex") } })
        .observeProtectedFinalizedDepositClaim(request, genesis)); passed.push("WRONG_MANAGER_REJECTED");
      const restarted = await new SolanaDepositClaimObserver({ endpoint, config }).observeProtectedFinalizedDepositClaim(request, genesis);
      requireProtectedClaimObservation(restarted); assert.deepEqual(restarted.depositClaim, observation.depositClaim);
      passed.push("NEW_OBSERVER_REVALIDATES_ALREADY_MINTED_CLAIM_WITHOUT_REMINT");
      await assert.rejects(new SolanaDepositClaimObserver({ config, rpcClient: {} }).observeProtectedFinalizedDepositClaim(request, genesis), /ProtectedClaimLiveRpcRequired/u);
      passed.push("CALLBACK_ADAPTER_NOT_ACCEPTED_AS_LIVE_QUERY");
      if (afterObservation !== undefined) {
        stage = "ADDITIONAL_REAL_CHAIN_ASSERTIONS";
        await afterObservation({ context, flow, flowConfig, setup, policy, state: reopened, nativeVerifier, observation, testCustody });
      }
      return { nativeToSolanaE2e: { state: flow.state }, localProtectedClaimObservation: { pass: passed.length, fail: 0, passed } };
    } catch (error) {
      const codes = new Map([["DepositOperationRejected", "INVALID_OPERATION"],
        ["DepositSweepReplacementDisabled", "REPLACEMENT_DISABLED"], ["DepositSigningPlanSubstituted", "SIGNING_PLAN_SUBSTITUTED"],
        ["DepositInputEvidenceCapacity", "INPUT_CAPACITY"], ["DepositOperationLocalnetOnly", "WRONG_ENVIRONMENT"]]);
      failure = stage + (codes.has(error?.message) ? "_" + codes.get(error.message) : "");
      throw new Error("LOCAL_PROTECTED_CLAIM_OBSERVATION_FAILED");
    }
  });
  if (failure || passed.length !== 14) throw new Error("LOCAL_PROTECTED_CLAIM_OBSERVATION_FAILED:" + (failure ?? stage));
  return { protocol: "KINGPEPE_LOCAL_PROTECTED_CLAIM_OBSERVATION_V1", state: "COMPLETED", pass: passed.length, fail: 0,
    passed, infrastructureState: result.state, productionReady: false, mainnetActivation: "DISABLED",
    scope: "Actual local-chain finalized claim/genesis queries; not Windows storage or independent Solana consensus." };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runLocalProtectedClaimObservation(path.resolve(import.meta.dirname, "../..")))); }
  catch (error) { console.error(/^LOCAL_PROTECTED_CLAIM_OBSERVATION_FAILED(?::[A-Z_]+)?$/u.test(error?.message) ? error.message : "LOCAL_PROTECTED_CLAIM_OBSERVATION_FAILED"); process.exitCode = 1; }
}
