// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual read-only reconciliation on regtest + validator. Windows protected
// progress/IPC, and complete service crash recovery, are separate gates.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLocalProtectedClaimObservation } from "./local-protected-claim-observation.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot } from "../../services/solana-observer/deployment-integrity.mjs";
import { readDepositReconciliation } from "../../services/reconciliation/deposit-reconciliation.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { draftLocalReserveSweep, signLocalReserveSweepWithFrost } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalTaprootSighashEvidences, parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";

export async function runLocalReconciliation(repoRoot, sourceSha) {
  assert.match(sourceSha, /^[0-9a-f]{40}$/u); const passed = []; let failure;
  const claims = await runLocalProtectedClaimObservation(repoRoot, async f => {
    let stage = "PINNED_IMMUTABLE_DEPLOYMENT";
    try {
      const { plan, executor, commandPaths } = f.context;
      assert(plan.commands.find(c => c.step === "START_SOLANA_LOCAL_VALIDATOR").args.includes("--bpf-program"));
      // Agave v4.2.2 --bpf-program uses the upgradeable loader and serializes
      // Some(Pubkey::default()), not None. Verify those exact genesis bytes.
      // This disposable local-test identity is not a production authority.
      const manifest = await localDeploymentManifest({ context: { ...f.context, flowConfig: f.flowConfig, localSolanaSetupContext: f.setup, nativeSource: f.flow.nativeSource },
        authority: "11111111111111111111111111111111", sourceSha });
      const solanaRpc = new LocalDeploymentRpc({ endpoint: "http://127.0.0.1:" + plan.ports.solanaRpcPort });
      const input = { policy: f.policy, manifest, operations: f.state.operations, nativeVerifier: f.nativeVerifier, solanaRpc };
      stage = "LIVE_RECONCILIATION";
      const result = await readDepositReconciliation(input);
      assert.equal(result.state, "OBSERVED_MATCH"); assert.equal(result.accounting.canonicalReserve, f.flowConfig.amountAtomic);
      assert.equal(result.accounting.mintedSupply, f.flowConfig.amountAtomic); assert.equal(result.accounting.coverageRequired, f.flowConfig.amountAtomic);
      assert.equal(result.accounting.authorizedUnmintedCredits, "0"); assert.equal(result.accounting.operatorWithdrawalAuthorized, false);
      passed.push("ACTUAL_NATIVE_UTXOS_AND_ONE_BANK_MINT_JOURNAL_RECONCILE");
      stage = "MINT_RESPONSE_LOST";
      const pending = structuredClone(f.state.operations); pending[0].mintReceipt = null;
      const catchup = await readDepositReconciliation({ ...input, operations: pending });
      assert.equal(catchup.state, "WAITING_FOR_DEPENDENCY"); assert.equal(catchup.reason, "FINALIZED_MINT_JOURNAL_CATCHUP_REQUIRED");
      passed.push("ACTUAL_MINT_WITH_LOST_JOURNAL_ACK_WAITS_WITHOUT_DUPLICATE_CREDIT");
      stage = "RESTARTED_READER";
      assert.deepEqual((await readDepositReconciliation({ ...input, operations: structuredClone(f.state.operations) })).accounting, result.accounting);
      passed.push("REOPENED_RECORDS_RECONCILE_WITHOUT_SENDING_TRANSACTIONS");
      stage = "DEPLOYMENT";
      const wrong = structuredClone(manifest); wrong.manager.deploymentSlot = "18446744073709551615";
      await assert.rejects(readDepositReconciliation({ ...input, manifest: wrong }), e => e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED");
      passed.push("ACTUAL_DEPLOYMENT_SLOT_NOT_REPLACED_BY_LOCAL_EXPECTATION");
      stage = "GENESIS";
      const other = "11111111111111111111111111111111";
      // The operation journal rejects cross-genesis reuse before any RPC. This
      // separate adapter check specifically requires an actual genesis read.
      const otherManifest = { ...manifest, solanaGenesis: other }, actualSnapshot = await solanaRpc.snapshot(otherManifest);
      assert.throws(() => verifyDeploymentSnapshot(otherManifest, actualSnapshot), e => e.integrityCode === "SOLANA_GENESIS_CHANGED");
      passed.push("ACTUAL_CLUSTER_GENESIS_SUBSTITUTION_DETECTED");
      const cli = async (command, parameters = [], wallet = undefined) => {
        assert(["getnewaddress", "invalidateblock", "reconsiderblock", "generateblock", "sendtoaddress", "generatetoaddress", "getrawtransaction", "createrawtransaction", "sendrawtransaction"].includes(command));
        const value = await executor.runOneShot({ step: "LOCAL_RECONCILIATION_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
        return String(value.output).trim();
      };
      const address = await cli("getnewaddress", [], f.flowConfig.userWalletName);
      // Attack fixture: both disposable test signers deliberately receive a new
      // policy for an unregistered INTERNAL reserve move. There is no SPL burn,
      // payout entitlement, user payout or Phase 09 implementation. Reconciliation
      // must not credit the new output or silently forget the original backing.
      stage = "UNAUTHORIZED_RESERVE_MOVE";
      const op = f.state.operations[0], amount = op.plan.depositIntent.amountAtomic;
      const feeId = await cli("sendtoaddress", [f.testCustody.taprootAddress, "0.00001000"], f.flowConfig.userWalletName);
      await cli("generatetoaddress", ["6", address], f.flowConfig.userWalletName);
      const feeRaw = parseNativeTransactionHex(await cli("getrawtransaction", [feeId, "false"]));
      const feeVout = feeRaw.outputs.findIndex(o => o.amountAtomic === "1000" && o.scriptPubKeyHex === f.testCustody.taprootScriptPubKeyHex);
      assert(feeVout >= 0);
      stage = "INTERNAL_MOVE_PROOF";
      const inputs = [{ txid: op.finalizedCredit.reserveBasis.sweep.txid, vout: 0, amountAtomic: amount,
        scriptPubKeyHex: f.testCustody.taprootScriptPubKeyHex }, { txid: feeId, vout: feeVout, amountAtomic: "1000", scriptPubKeyHex: f.testCustody.taprootScriptPubKeyHex }];
      const proof = await f.nativeVerifier.verifyInputs({ inputs, minimumConfirmations: 6 });
      stage = "INTERNAL_MOVE_DRAFT";
      const draft = await draftLocalReserveSweep({ cli: async args => {
        const out = await cli(args.command, args.parameters, args.wallet); return args.json ? JSON.parse(out) : out;
      }, depositTxidHex: inputs[0].txid, depositVout: 0, depositAmountAtomic: amount, nativeMinerFeeAtomic: "1000", nativeDecimals: 8,
        canonicalReserveAddress: f.testCustody.taprootAddress, proofFingerprintHex: proof.digestHex,
        feeFundingInputs: [{ txidHex: feeId, vout: feeVout, amountAtomic: "1000" }] });
      const spentOutputs = inputs.map(({ amountAtomic, scriptPubKeyHex }) => ({ amountAtomic, scriptPubKeyHex }));
      const evidences = createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: draft.unsignedNativeTransactionHex, spentOutputs,
        proofFingerprintHex: proof.digestHex, reserveAmountAtomic: amount, nativeMinerFeeAtomic: "1000",
        expectedRecipientScriptPubKeyHex: f.testCustody.taprootScriptPubKeyHex, expectedChangeScriptPubKeyHex: f.testCustody.taprootScriptPubKeyHex });
      stage = "INTERNAL_MOVE_SIGNING";
      const signed = await signLocalReserveSweepWithFrost({ plan, flowConfig: f.flowConfig, frostCustody: f.testCustody,
        nativeSource: f.flow.nativeSource, reserveSweepDraft: draft, taprootSighashEvidences: evidences, operationIdHex: "79".repeat(32), spentOutputs,
        deposit: { txidHex: inputs[0].txid, vout: 0, amountAtomic: amount, proofFingerprintHex: proof.digestHex, finalitySatisfied: true, utxoUnspent: true, noPriorConsumption: true },
        nativeEvidenceValidator: intent => f.nativeVerifier.verifySweepSigning({ inputs, minimumConfirmations: 6,
          unsignedTransactionHex: draft.unsignedNativeTransactionHex, reserveAmountAtomic: amount, feeAtomic: "1000", reserveScriptHex: f.testCustody.taprootScriptPubKeyHex, intent }) });
      stage = "INTERNAL_MOVE_MEMPOOL";
      assert.equal(await cli("sendrawtransaction", [signed.signedNativeTransactionHex]), signed.nativeSweepTxidHex);
      await assert.rejects(readDepositReconciliation(input), /RAW_NATIVE_RESERVE_NOT_AVAILABLE/u);
      passed.push("MEMPOOL_RESERVE_SPEND_SUSPENDS_NOT_CONFIRMED_CHAIN_DEFICIT");
      stage = "INTERNAL_MOVE_CANONICAL";
      await cli("generatetoaddress", ["6", address], f.flowConfig.userWalletName);
      await assert.rejects(readDepositReconciliation(input), e => e.incident?.reason === "CANONICAL_RESERVE_SPENT_WITHOUT_SETTLEMENT" &&
        e.incident.affectedReserveAtomic === amount && e.incident.affectedOperations[0] === op.plan.operationId);
      passed.push("CONFIRMED_UNREGISTERED_RESERVE_MOVE_IS_EXACT_INTEGRITY_INCIDENT");
      const old = await f.nativeVerifier.observeChain();
      const block = f.state.operations[0].finalizedCredit.reserveBasis.sweep;
      stage = "UNRESOLVED_DEEP_BRANCH";
      await cli("invalidateblock", [block.blockHash]);
      await assert.rejects(readDepositReconciliation(input), /ReconciliationNativeChainChoiceUnresolved/u);
      passed.push("LOWER_WORK_BRANCH_IS_UNRESOLVED_NOT_FABRICATED_DEFICIT");
      stage = "HIGHER_WORK_DEEP_BRANCH";
      for (let i = 0; i < old.tipHeight - block.height + 3; i++) await cli("generateblock", [address, "[]"]);
      await assert.rejects(readDepositReconciliation(input), e => e.incident?.reason === "ACCEPTED_NATIVE_BASIS_INVALIDATED" &&
        e.incident.affectedReserveAtomic === f.flowConfig.amountAtomic && e.incident.affectedOperations.length === 1 && e.incident.affectedOperations[0] === f.state.operations[0].plan.operationId);
      passed.push("HIGHER_WORK_POST_MINT_REORG_IDENTIFIES_EXACT_AFFECTED_BACKING");
      const observed = await solanaRpc.snapshot(manifest);
      assert.equal(Buffer.from(observed.accounts[2].data[0], "base64").readBigUInt64LE(36).toString(), f.flowConfig.amountAtomic);
      passed.push("REORG_DETECTION_DOES_NOT_REMINT_BURN_OR_CONFISCATE");
    } catch (error) {
      const diagnostic = ["PROGRAM_ABSENT", "PROGRAM_EXECUTABLE_OR_LOADER", "PROGRAMDATA_BINDING", "PROGRAMDATA_ABSENT", "PROGRAMDATA_LAYOUT",
        "UPGRADE_AUTHORITY_OR_SLOT", "PROGRAM_LENGTH", "BYTECODE_IDENTITY", "MISSING_MINT", "CONFIGURATION_ABSENT", "BRIDGE_CONFIGURATION", "TRANSCEIVER_CONFIGURATION"].includes(error.violation) ? error.violation : undefined;
      failure = { stage, code: diagnostic ?? (/^(?:Reconciliation[A-Za-z]+|Deployment[A-Za-z]+|Local[A-Za-z]+|RAW_NATIVE_[A-Z_]+|SOLANA_[A-Z_]+)$/u.test(error.message) ? error.message : "LOCAL_RECONCILIATION_CHECK_FAILED") };
      throw error;
    }
  }).catch(() => { throw new Error("LOCAL_RECONCILIATION_FAILED:" + (failure ? failure.stage + ":" + failure.code : "CLAIM_PREREQUISITE")); });
  return { protocol: "KINGPEPE_LOCAL_RECONCILIATION_V1", claimChecks: claims.pass, pass: passed.length, fail: 0, passed,
    state: "COMPLETED", nativePayout: "NOT_RUN_BY_THIS_TEST", productionReady: false, mainnetActivation: "DISABLED",
    scope: "Real Native/validator read-only reconciliation and deep-fork detection, not protected Windows stop propagation or service certification." };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runLocalReconciliation(path.resolve(import.meta.dirname, "../.."), process.env.KINGPEPE_TEST_SOURCE_SHA);
    console.log(JSON.stringify(result)); if (result.pass !== 10 || result.fail !== 0) process.exitCode = 1;
  } catch (error) { console.error(/^LOCAL_RECONCILIATION_FAILED(?::[A-Za-z_]+){1,2}$/u.test(error.message) ? error.message : "LOCAL_RECONCILIATION_FAILED"); process.exitCode = 1; }
}
