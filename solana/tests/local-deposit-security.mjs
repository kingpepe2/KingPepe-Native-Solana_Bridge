// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real REGTEST/local-validator checks. No production keys, RPCs or deployment.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLocalNativeToSolanaE2e, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { combineProjectAttestations } from "../../services/attesters/attestation-service.mjs";
import { SolanaLocalRpcClient } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { prepareSignedLocalnetSolanaDepositReceiptTransaction } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { decodeSplMintAccountBase64 } from "../../services/solana-observer/solana-deposit-claim-observer.mjs";
import { bytesToHex, decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";

export async function runLocalDepositSecurityE2e(repoRoot) {
  const passed = [];
  const result = await runLocalNativeToSolanaE2e({
    repoRoot,
    solanaDepositClaim: async (context) => {
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
      return completed;
    },
  });
  return { ...result, localSecurity: { passed, pass: passed.length, fail: result.state === "COMPLETED" && passed.length === 6 ? 0 : 1,
    scope: "Real local-validator happy path, idempotent retry, duplicate backing and protocol/Native domain preflight rejection; not complete adversarial coverage." } };
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
