// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real isolated REGTEST + validator: delayed signing/attestation revalidates a
// fixed acceptance basis, never an old UTXO observation or a caller proof flag.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openSync, writeSync, fsyncSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { collectRegtestEvidence, encodeRegtestEvidence, verifiedReserveChain } from "../../native/node/native-raw-evidence.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";

export async function runLocalAcceptanceCheckpoint(repoRoot) {
  const passed = []; let stage = "BOOTSTRAP", failure;
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    try {
      const { plan, executor, commandPaths } = context;
      const setup = createLocalSolanaSetupContext(), flowConfig = createNativeToSolanaFlowConfig({ plan, repoRoot,
        mintHex: setup.mintHex, keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
      const cli = async (command, parameters = [], wallet = undefined) => {
        assert(["getnewaddress", "generateblock", "invalidateblock"].includes(command));
        const r = await executor.runOneShot({ step: "LOCAL_ACCEPTANCE_TEST_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
        return String(r.output).trim();
      };
      const advance = async () => {
        const address = await cli("getnewaddress", [], flowConfig.userWalletName);
        await cli("generateblock", [address, "[]"]);
      };
      let verifier, inputProof, reserveInput, reserveProof, checkedSigning = false;
      stage = "FRESH_FLOW_WITH_ADVANCING_NATIVE_TIP";
      const flow = await executeNativeDepositObservationFlow({ ...context, flowConfig, localSolanaSetupContext: setup,
        nativeEvidenceVerifierFactory: async options => {
          verifier = await createLocalNativeEvidenceVerifier(options);
          return {
            verifyInputs: async input => {
              const r = await verifier.verifyInputs(input); inputProof = r;
              await advance(); return r;
            },
            verifySweepSigning: async input => {
              const r = await verifier.verifySweepSigning(input);
              assert.equal(r.digestHex, inputProof.digestHex); assert(r.currentTipHeight > inputProof.tipHeight);
              if (!checkedSigning) { checkedSigning = true; passed.push("INPUT_PROOF_FIXED_WHILE_CURRENT_NATIVE_CHAIN_ADVANCES"); }
              return r;
            },
            verifyReserve: async input => {
              const r = await verifier.verifyReserve(input);
              if (reserveProof === undefined) {
                reserveInput = structuredClone(input); reserveProof = r; await advance();
              } else { assert.equal(r.digestHex, reserveProof.digestHex); assert(r.currentTipHeight > reserveProof.tipHeight); }
              return r;
            },
          };
        } });
      assert.equal(flow.state, "COMPLETED"); passed.push("REAL_NATIVE_ACCEPTED_FROST_AND_SOLANA_MINT_AFTER_TIP_ADVANCE");
      for (const role of ["ATTESTER_A", "ATTESTER_B"]) {
        const r = flow.nativeRawEvidence.attesters[role]; assert.equal(r.digestHex, reserveProof.digestHex);
        assert(r.currentTipHeight > r.tipHeight); passed.push(role + "_REVALIDATES_IDENTICAL_ACCEPTED_MESSAGE_BASIS");
      }
      assert.equal(flow.depositAccounting.snapshot.authorizedUnmintedCredits, "0");
      assert.equal(flow.depositAccounting.snapshot.mintedSupply, flowConfig.amountAtomic);
      passed.push("ONE_CREDIT_ONE_FINALIZED_MINT_RECONCILED_WITHOUT_TEAM_APPROVAL");
      stage = "ACCEPTED_CHECKPOINT_RECOVERY";
      const acceptedCheckpoint = reserveProof.acceptedCheckpoint;
      const file = validateRuntimeFile(path.join(plan.runRoot, "public-test-acceptance-checkpoint.json"), repoRoot);
      const fd = openSync(file, "wx", 0o600);
      try { writeSync(fd, Buffer.from(JSON.stringify(acceptedCheckpoint))); fsyncSync(fd); } finally { closeSync(fd); }
      const restarted = await createLocalNativeEvidenceVerifier({ plan });
      const r = await restarted.verifyReserve({ ...reserveInput, acceptedCheckpoint: JSON.parse(readFileSync(file, "utf8")) });
      assert.equal(r.digestHex, reserveProof.digestHex); assert(verifiedReserveChain(r).tipHeight > r.tipHeight);
      passed.push("RESTORED_PUBLIC_CHECKPOINT_REVALIDATED_WITH_CURRENT_UTXO_AND_RUST");
      const unpinned = await restarted.verifyReserve(reserveInput);
      assert.notEqual(unpinned.digestHex, r.digestHex); passed.push("ADVANCED_PROOF_CANNOT_SILENTLY_REPLACE_CREDIT_DIGEST");
      for (const [name, patch] of [["WRONG_NETWORK_CHECKPOINT_REJECTED", { genesis: "00".repeat(32) }],
        ["REPLACED_ACCEPTED_BLOCK_REJECTED", { tipHash: "00".repeat(32) }],
        ["REPLACED_ACCEPTED_EVIDENCE_REJECTED", { evidenceDigestHex: "00".repeat(32) }]]) {
        await assert.rejects(restarted.verifyReserve({ ...reserveInput, acceptedCheckpoint: { ...acceptedCheckpoint, ...patch } }), /RAW_NATIVE_ACCEPTANCE_/u); passed.push(name);
      }
      stage = "INDEPENDENT_PREFIX_CHAINWORK_CHECK";
      const rpc = new NativeRpcClient({ endpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`, localOnly: true,
        authCookieFile: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot });
      const bundle = await collectRegtestEvidence({ rpc, transactionIds: [...new Set([reserveInput.deposit.txid, ...reserveInput.feeInputs.map(i => i.txid), reserveInput.sweepTxid])],
        minimumConfirmations: reserveInput.minimumConfirmations });
      const forged = { ...acceptedCheckpoint, chainworkHex: "00".repeat(32) };
      forged.evidenceDigestHex = createHash("sha256").update(encodeRegtestEvidence({ ...bundle, tipHash: forged.tipHash,
        tipHeight: forged.tipHeight, headers: bundle.headers.slice(0, forged.tipHeight), chainworkHex: forged.chainworkHex })).digest("hex");
      await assert.rejects(restarted.verifyReserve({ ...reserveInput, acceptedCheckpoint: forged }), /RAW_NATIVE_VERIFICATION_FAILED/u);
      passed.push("FORGED_PREFIX_WORK_AND_DIGEST_REJECTED_BY_INDEPENDENT_RUST");
      stage = "CURRENT_UTXO_NOT_HISTORICAL_INCLUSION";
      await assert.rejects(restarted.verifyInputs({ inputs: [reserveInput.deposit, ...reserveInput.feeInputs], minimumConfirmations: 1,
        acceptedCheckpoint: inputProof.acceptedCheckpoint }), /RAW_NATIVE_INPUT_NOT_AVAILABLE/u);
      passed.push("HISTORICALLY_INCLUDED_BUT_NOW_SPENT_INPUT_REJECTED");
      stage = "ACCEPTED_BASIS_REORG";
      await cli("invalidateblock", [reserveProof.reserveBasis.sweep.blockHash]);
      await assert.rejects(restarted.verifyReserve({ ...reserveInput, acceptedCheckpoint }), /RAW_NATIVE_/u);
      passed.push("REORGANIZED_ACCEPTED_SWEEP_REJECTED_WITHOUT_NEW_CREDIT");
      return { acceptanceCheckpoint: { pass: passed.length, fail: 0, passed }, fullNativeToSolanaE2e: flow.state };
    } catch (error) {
      failure = { stage, passed: passed.length, testLine: Number(error.stack?.match(/local-acceptance-checkpoint\.mjs:(\d+):/u)?.[1]) || undefined,
        code: /^RAW_NATIVE_[A-Z_]+$/u.test(error.message) ? error.message : "LOCAL_ACCEPTANCE_CHECK_FAILED" };
      throw error;
    }
  });
  return { sourceScope: "NATIVE_TO_SOLANA_CORE", infrastructure: result.state, acceptanceCheckpoint: result.acceptanceCheckpoint,
    fullNativeToSolanaE2e: result.fullNativeToSolanaE2e, failure, nativePayout: "NOT_RUN_BY_THIS_TEST", productionReady: false, mainnetActivation: "DISABLED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLocalAcceptanceCheckpoint(path.resolve(import.meta.dirname, "../.."));
  console.log(JSON.stringify(result)); if (result.acceptanceCheckpoint?.pass !== 13 || result.acceptanceCheckpoint?.fail !== 0) process.exitCode = 1;
}
