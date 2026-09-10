// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real REGTEST/local-validator checks. No production keys, RPCs or deployment.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLocalNativeToSolanaE2e, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { testLocalNativeRecovery } from "./local-native-recovery.mjs";
import { testRecoveryPsbtWithNativeWallet } from "./local-recovery-psbt.mjs";
import { verifyRegtestSweepSignatures } from "../../native/node/native-raw-evidence.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { combineProjectAttestations } from "../../services/attesters/attestation-service.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { prepareSignedLocalnetSolanaDepositReceiptTransaction } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { decodeSplMintAccountBase64 } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";
import { bytesToHex, decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";

export async function runLocalDepositSecurityE2e(repoRoot) {
  const passed = [];
  let recovery;
  let recoveryPsbt;
  let reserveVerificationInput;
  const result = await runLocalNativeToSolanaE2e({
    repoRoot,
    nativeEvidenceVerifierFactory: async (options) => {
      const verifier = await createLocalNativeEvidenceVerifier(options);
      let testedInputs = false;
      let testedSigning = false;
      let testedReserve = false;
      return {
        verifyInputs: async (input) => {
          if (!testedInputs) {
            testedInputs = true;
            for (const [label, patch] of [["NATIVE_INPUT_AMOUNT_SUBSTITUTION_REJECTED", { amountAtomic: "1" }],
              ["NATIVE_INPUT_SCRIPT_SUBSTITUTION_REJECTED", { scriptPubKeyHex: "51" }]]) {
              const wrong = structuredClone(input); Object.assign(wrong.inputs[0], patch);
              await assert.rejects(() => verifier.verifyInputs(wrong), /RAW_NATIVE_INPUT_SUBSTITUTED/u);
              passed.push(label);
            }
            await assert.rejects(() => verifier.verifyReserve({ deposit: input.inputs[0], feeInputs: input.inputs.slice(1),
              sweepTxid: input.inputs[0].txid, reserveVout: input.inputs[0].vout,
              reserveScriptHex: input.inputs[1].scriptPubKeyHex, feeAtomic: input.inputs[1].amountAtomic,
              minimumConfirmations: 1 }), /RAW_NATIVE_SWEEP_SUBSTITUTED/u);
            passed.push("UNSWEPT_TEMPORARY_DEPOSIT_NOT_MINT_ELIGIBLE");
          }
          return verifier.verifyInputs(input);
        },
        verifySweepSigning: async (input) => {
          if (!testedSigning) {
            testedSigning = true;
            for (const [label, patch] of [
              ["NATIVE_SIGNING_TXID_SUBSTITUTION_REJECTED", { unsignedNativeTransactionId: "ff".repeat(32) }],
              ["NATIVE_SIGNING_SIGHASH_SUBSTITUTION_REJECTED", { taprootSighashHex: "ff".repeat(32) }],
              ["NATIVE_SIGNING_RECIPIENT_SUBSTITUTION_REJECTED", { recipientScriptPubKeyHex: "51" }],
              ["NATIVE_SIGNING_AMOUNT_SUBSTITUTION_REJECTED", { amountAtomic: "1" }],
              ["NATIVE_SIGNING_FEE_SUBSTITUTION_REJECTED", { feeAtomic: "0" }],
              ["NATIVE_SIGNING_CHANGE_SUBSTITUTION_REJECTED", { changeAtomic: "1" }],
            ]) {
              const wrong = structuredClone(input); Object.assign(wrong.intent, patch);
              await assert.rejects(() => verifier.verifySweepSigning(wrong), /RAW_NATIVE_SIGNING_INTENT_SUBSTITUTED/u);
              passed.push(label);
            }
            await assert.rejects(() => verifier.verifySweepSigning({ ...input, tapscriptSpends: undefined }), /RAW_NATIVE_SIGNING_INTENT_SUBSTITUTED/u);
            passed.push("SWEEP_SCRIPT_PATH_DOWNGRADE_REJECTED");
            const wrongControl = structuredClone(input);
            const controlBytes = Buffer.from(wrongControl.tapscriptSpends[0].controlBlockHex, "hex");
            controlBytes[0] ^= 1;
            wrongControl.tapscriptSpends[0].controlBlockHex = controlBytes.toString("hex");
            await assert.rejects(() => verifier.verifySweepSigning(wrongControl), /NativeTaprootControlBlockMismatch/u);
            passed.push("SWEEP_CONTROL_BLOCK_SUBSTITUTION_REJECTED");
          }
          return verifier.verifySweepSigning(input);
        },
        verifyReserve: async (input) => {
          if (!testedReserve) {
            testedReserve = true;
            reserveVerificationInput = structuredClone(input);
            await assert.rejects(() => verifier.verifyInputs({ inputs: [input.deposit], minimumConfirmations: 1 }), /RAW_NATIVE_INPUT_NOT_AVAILABLE/u);
            passed.push("SPENT_TEMPORARY_DEPOSIT_NOT_REUSABLE");
            await assert.rejects(() => verifier.verifyReserve({ ...input, feeAtomic: "0" }), /RAW_NATIVE_SWEEP_VALUE_MISMATCH/u);
            passed.push("NATIVE_RESERVE_FEE_SUBSTITUTION_REJECTED");
          }
          return verifier.verifyReserve(input);
        },
      };
    },
    solanaDepositClaim: async (context) => {
      const sweep = parseNativeTransactionHex(context.signedReserveSweep.signedNativeTransactionHex);
      const changed = structuredClone(sweep); changed.inputs[0].witness[0][0] ^= 1;
      assert.equal(changed.txidHex, sweep.txidHex);
      assert.throws(() => verifyRegtestSweepSignatures({ sweep: changed,
        inputs: [reserveVerificationInput.deposit, ...reserveVerificationInput.feeInputs],
        tapscriptSpends: reserveVerificationInput.tapscriptSpends, reserveScriptHex: reserveVerificationInput.reserveScriptHex }),
      /RAW_NATIVE_SWEEP_SIGNATURE_INVALID/u);
      passed.push("FINALIZED_WITNESS_TAMPERING_REJECTED");
      const completed = await submitLocalnetSolanaDepositClaim(context);
      if (completed.state !== "COMPLETED") return completed;
      const retry = await submitLocalnetSolanaDepositClaim(context);
      assert.equal(retry.state, "COMPLETED", "COMPLETED_RETRY_STATE_CHANGED");
      assert.equal(retry.solanaSignature, completed.solanaSignature, "COMPLETED_RETRY_SIGNATURE_CHANGED");
      passed.push("COMPLETED_OPERATION_RETRY_IDEMPOTENT");

      const request = context.depositClaimRequest.request;
      const decoded = decodeCanonicalBridgeMessage(request.encodedMessageHex);
      const nextNonce = Uint8Array.from(decoded.nonce);
      nextNonce[0] ^= 1;
      const encoded = encodeCanonicalBridgeMessage({ ...decoded, operationId: undefined, nonce: nextNonce });
      const replayMessage = decodeCanonicalBridgeMessage(encoded);
      assert.notEqual(replayMessage.operationIdHex, decoded.operationIdHex);
      const setup = context.localSolanaSetupContext;
      const signers = [setup.attesterASigner, setup.attesterBSigner];
      // Adversarial test only: deliberately create another valid pair of
      // signatures for ALREADY CONSUMED backing. These are disposable local
      // attestation identities; normal transfer policy does not take this path.
      const attestations = request.attestations.map((attestation, index) => ({
        ...attestation,
        operationIdHex: replayMessage.operationIdHex,
        messageDigestHex: replayMessage.messageDigestHex,
        signatureHex: bytesToHex(signers[index].sign(encoded)),
      }));
      const encodedMessageHex = bytesToHex(encoded);
      const replayRequest = {
        ...request,
        operationIdHex: replayMessage.operationIdHex,
        encodedMessageHex,
        messageDigestHex: replayMessage.messageDigestHex,
        attestations,
        combinedAttestation: combineProjectAttestations({
          attestations, encodedMessageHex, authorizedAttesterPublicKeys: setup.attesterPublicKeysHex,
        }),
      };
      const rejected = await submitLocalnetSolanaDepositClaim({ ...context, depositClaimRequest: { request: replayRequest } });
      // This is actual validator preflight execution, not a claimed finalized
      // failed transaction. The new receipt is valid; the manager rejects reuse.
      assert.equal(rejected.reason, "SOLANA_RPC_SEND_FAILED", "REPLAY_NOT_REJECTED_BY_VALIDATOR");
      assert.deepEqual(rejected.instructionFailure, { index: 0, reason: "InvalidAccountData" }, "REPLAY_FAILED_FOR_UNEXPECTED_REASON");
      passed.push("NEW_NONCE_SAME_OUTPOINT_PREFLIGHT_REJECTED");

      const rpc = new SolanaLocalRpcClient({ endpoint: `http://127.0.0.1:${context.plan.ports.solanaRpcPort}` });
      for (const [label, deployment] of [
        ["WRONG_PROTOCOL_PREFLIGHT_REJECTED", { ...decoded.deployment, protocolId: decoded.deployment.protocolId + 1 }],
        ["WRONG_NATIVE_NETWORK_PREFLIGHT_REJECTED", { ...decoded.deployment, nativeNetwork: decoded.deployment.nativeNetwork + 1 }],
        ["WRONG_NATIVE_GENESIS_PREFLIGHT_REJECTED", { ...decoded.deployment, nativeGenesis: new Uint8Array(32).fill(99) }],
      ]) {
        const wrongBytes = encodeCanonicalBridgeMessage({ ...decoded, operationId: undefined, deployment });
        const wrongMessage = decodeCanonicalBridgeMessage(wrongBytes);
        const wrongAttestations = request.attestations.map((attestation, index) => ({
          ...attestation,
          operationIdHex: wrongMessage.operationIdHex,
          messageDigestHex: wrongMessage.messageDigestHex,
          signatureHex: bytesToHex(signers[index].sign(wrongBytes)),
        }));
        const blockhash = await rpc.getLatestBlockhash();
        // Deliberately bypass off-chain policy in this adversarial test to
        // exercise the actual Transceiver with two cryptographically valid
        // signatures over a forbidden domain. This path is not a live service.
        const prepared = await prepareSignedLocalnetSolanaDepositReceiptTransaction({
          environment: "localnet", cluster: "localnet",
          managerProgramIdHex: context.flowConfig.bridgeProgramIdHex,
          transceiverProgramIdHex: context.flowConfig.transceiverProgramIdHex,
          mintBase58: setup.mintBase58,
          tokenProgramIdBase58: SPL_TOKEN_PROGRAM_ID_BASE58,
          feePayerBase58: setup.feePayerBase58,
          recipientTokenAccountBase58: setup.recipientTokenAccountBase58,
          recentBlockhashBase58: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
          encodedMessageHex: bytesToHex(wrongBytes), attestations: wrongAttestations,
          feePayerSigner: setup.feePayerSigner,
        });
        await assert.rejects(
          () => rpc.sendTransaction(prepared.preparedTransactionBase64, { skipPreflight: false, maxRetries: 0 }),
          (error) => {
            assert.deepEqual(error.instructionFailure, { index: 2, reason: "InvalidAccountData" }, "DOMAIN_FAILED_FOR_UNEXPECTED_REASON");
            return true;
          },
        );
        assert.equal(await rpc.getAccountInfo(prepared.pdas.verifiedReceipt.addressBase58), null, "FORBIDDEN_DOMAIN_CREATED_RECEIPT");
        passed.push(label);
      }
      const account = await rpc.getAccountInfo(setup.mintBase58);
      assert.ok(account && Array.isArray(account.data), "MINT_ACCOUNT_MISSING_AFTER_REPLAY");
      assert.equal(account.data[1], "base64", "MINT_ACCOUNT_ENCODING_CHANGED");
      const mint = decodeSplMintAccountBase64(account.data[0]);
      assert.equal(mint.supplyAtomic, completed.mintSupplyAtomic, "SUPPLY_CHANGED_AFTER_REPLAY");
      assert.equal(mint.freezeAuthorityHex, null, "FREEZE_AUTHORITY_CHANGED");
      passed.push("MINT_SUPPLY_UNCHANGED_AFTER_REPLAY");
      recovery = await testLocalNativeRecovery(context);
      recoveryPsbt = await testRecoveryPsbtWithNativeWallet(context);
      return completed;
    },
  });
  if (result.state === "COMPLETED") {
    const raw = result.nativeToSolanaE2e.nativeRawEvidence;
    assert.equal(raw.signers.length, 4);
    for (const entry of raw.signers) {
      assert.equal(entry.status, "RAW_HEADERS_AND_MERKLE_VALIDATED");
      assert.equal(entry.digestHex, raw.inputEvidence.digestHex);
      assert.equal(entry.transactions, 2);
    }
    assert.deepEqual(raw.signers.map((entry) => `${entry.signerId}:${entry.signingInputIndex}`),
      ["KINGPEPE_FROST_A:0", "KINGPEPE_FROST_B:0", "KINGPEPE_FROST_A:1", "KINGPEPE_FROST_B:1"]);
    for (const role of ["ATTESTER_A", "ATTESTER_B"]) {
      assert.equal(raw.attesters[role].status, "RAW_HEADERS_AND_MERKLE_VALIDATED");
      assert.equal(raw.attesters[role].digestHex, raw.reserveEvidence.digestHex);
      assert.equal(raw.attesters[role].transactions, 3);
      assert.equal(raw.attesters[role].utxoTrust, "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION");
    }
    passed.push("BOTH_SIGNERS_AND_ATTESTERS_VALIDATE_RAW_EVIDENCE");
    const intent = result.nativeToSolanaE2e.depositIntent;
    assert.equal(intent.recoverable, true);
    assert.equal(intent.recoveryAvailableAfterSweep, false);
    assert.notEqual(intent.scriptPubKeyHex, result.nativeToSolanaE2e.frostCustody.taprootScriptPubKeyHex);
    for (const evidence of [raw.reserveEvidence, raw.attesters.ATTESTER_A, raw.attesters.ATTESTER_B]) {
      assert.deepEqual(evidence.witnessSignatures, { scriptPathInputs: 1, keyPathInputs: 1 });
    }
    passed.push("RECOVERABLE_DEPOSIT_TO_DISTINCT_RESERVE_VERIFIED");
  }
  return { ...result, localRecovery: recovery, localRecoveryPsbt: recoveryPsbt, localSecurity: { passed, pass: passed.length, fail: result.state === "COMPLETED" && passed.length === 22 ? 0 : 1,
    scope: "Real raw Native evidence/policy rejection, local-validator deposit, idempotent retry, backing replay and domain checks; not complete adversarial coverage." } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLocalDepositSecurityE2e(process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
    console.log(JSON.stringify(result));
    if (result.state !== "COMPLETED" || result.localSecurity.fail !== 0) process.exitCode = 1;
  } catch {
    console.error("LOCAL_DEPOSIT_SECURITY_RUN_FAILED");
    process.exitCode = 1;
  }
}
