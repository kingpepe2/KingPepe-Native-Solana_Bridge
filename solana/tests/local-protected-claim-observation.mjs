// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual REGTEST + Solana validator flow. Windows DPAPI persistence remains a
// separate gate; rejecting injected callbacks below is not chain proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { requireVerifiedRegtestReserve } from "../../native/node/native-raw-evidence.mjs";
import { initialDepositOperationState, validateDepositOperationPlan, decodeDepositOperationState, depositOperationAccounting } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { SolanaDepositClaimObserver, requireProtectedClaimObservation } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";
import { LocalDeploymentRpc } from "../../services/solana-observer/deployment-integrity.mjs";
import { findProgramAddress, base58Encode, DEPOSIT_CLAIM_PDA_SEED_PREFIX } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";

export async function runLocalProtectedClaimObservation(repoRoot) {
  const passed = []; let stage = "BOOTSTRAP", failure;
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    try {
      const setup = createLocalSolanaSetupContext(), flowConfig = createNativeToSolanaFlowConfig({ plan: context.plan, repoRoot,
        mintHex: setup.mintHex, keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
      stage = "FRESH_NATIVE_TO_SOLANA";
      let inputs, encodedMessageHex;
      const verifiedSigningIntents = new Map();
      const flow = await executeNativeDepositObservationFlow({ ...context, flowConfig, localSolanaSetupContext: setup,
        nativeEvidenceVerifierFactory: async options => {
          const verifier = await createLocalNativeEvidenceVerifier(options), verify = verifier.verifyInputs.bind(verifier),
            verifySigning = verifier.verifySweepSigning.bind(verifier);
          verifier.verifyInputs = async request => {
            const checked = await verify(request); inputs ??= structuredClone(request.inputs); return checked;
          };
          verifier.verifySweepSigning = async request => {
            const checked = await verifySigning(request), index = request.intent.signingInputIndex;
            if (verifiedSigningIntents.has(index)) assert.deepEqual(verifiedSigningIntents.get(index), request.intent);
            verifiedSigningIntents.set(index, structuredClone(request.intent)); return checked;
          };
          return verifier;
        },
        solanaDepositClaim: async request => {
          encodedMessageHex = request.depositClaimRequest.request.encodedMessageHex;
          return submitLocalnetSolanaDepositClaim(request);
        },
      });
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
