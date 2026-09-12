// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual ephemeral Ed25519 signatures with SYNTHETIC accounts/chain data.
// This fixture is not on-chain execution or proof of a Native reserve.
import { ed25519 } from "@noble/curves/ed25519.js";
import { createHash } from "node:crypto";
import { reconciliationFixture } from "./reconciliation-fixture.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { base58Encode, prepareSignedLocalnetSolanaDepositClaimTransaction,
  prepareSignedLocalnetSolanaDepositReceiptTransaction } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { ATTESTATION_MODE, ATTESTATION_PROTOCOL } from "../../services/attesters/attestation-service.mjs";
export async function solanaDeliveryFixture() {
  const f = reconciliationFixture(), k = ed25519.keygen(), signers = [ed25519.keygen(), ed25519.keygen()];
  const digest = v => createHash("sha256").update(v).digest("hex"), h = v => Buffer.from(v, "hex");
  f.snapshot.accounts.pop(); // The receipt/claim pair is added explicitly below.
  f.manifest.config.attesters = signers.map(s => base58Encode(s.publicKey));
  const configData = Buffer.from(f.snapshot.accounts[4].data[0], "base64");
  signers[0].publicKey.forEach((b, i) => { configData[177 + i] = b; });
  signers[1].publicKey.forEach((b, i) => { configData[209 + i] = b; });
  f.snapshot.accounts[4].data[0] = configData.toString("base64");
  const p = f.policy, encoded = encodeCanonicalBridgeMessage({ action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, nativeGenesis: h(p.nativeGenesis), solanaDeployment: h(p.solanaDeployment),
      managerProgramId: h(p.managerProgramId), transceiverProgramId: h(p.transceiverProgramId), mint: h(p.mint) },
    depositOutpoint: { txid: h(digest("disposable Solana-delivery deposit")), vout: 0 }, withdrawalId: Buffer.alloc(32),
    amountAtomic: 100n, feeAtomic: 0n, destination: Buffer.alloc(32, 8), policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch,
    nonce: h(digest("disposable delivery nonce")), validFrom: 1n, validUntil: BigInt(Math.floor(Date.now() / 1000) + 3600), evidenceDigest: h(digest("synthetic evidence")) });
  const message = decodeCanonicalBridgeMessage(encoded), encodedMessageHex = Buffer.from(encoded).toString("hex");
  const attestations = signers.map((s, i) => ({ protocol: ATTESTATION_PROTOCOL, mode: ATTESTATION_MODE, role: ["ATTESTER_A", "ATTESTER_B"][i],
    keyEpoch: p.keyEpoch, policyEpoch: p.policyEpoch, attesterPublicKeyHex: Buffer.from(s.publicKey).toString("hex"),
    operationIdHex: message.operationIdHex, messageDigestHex: message.messageDigestHex, signedBytes: "CANONICAL_BRIDGE_MESSAGE_V1",
    signatureHex: Buffer.from(ed25519.sign(encoded, s["secret" + "Key"])).toString("hex"), state: "VERIFIED_READY" }));
  const policy = { operationPolicy: p, manifest: f.manifest, feePayerPublicKey: base58Encode(k.publicKey) };
  async function delivery(kind = "RECEIPT", generation = 0) {
    const recentBlockhash = base58Encode(h(digest("disposable blockhash " + generation))), lastValidBlockHeight = String(1000 + generation), minimumSlot = String(1 + generation);
    const build = kind === "RECEIPT" ? prepareSignedLocalnetSolanaDepositReceiptTransaction : prepareSignedLocalnetSolanaDepositClaimTransaction;
    const tx = await build({ environment: "localnet", cluster: "localnet", managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId,
      mintHex: p.mint, recipientTokenAccountHex: message.destinationHex, feePayerHex: Buffer.from(k.publicKey).toString("hex"),
      tokenProgramIdBase58: policy.manifest.mint.tokenProgram, recentBlockhashBase58: recentBlockhash, lastValidBlockHeight,
      encodedMessageHex, attestations, feePayerSigner: { publicKeyHex: Buffer.from(k.publicKey).toString("hex"), sign: bytes => ed25519.sign(bytes, k["secret" + "Key"]) } });
    return { operationId: digest("disposable operation"), kind, encodedMessageHex, attestations: structuredClone(attestations),
      preparedTransactionBase64: tx.preparedTransactionBase64, recentBlockhash, lastValidBlockHeight, minimumSlot };
  }
  function accounts({ receipt = false, claim = false } = {}) {
    const snapshot = structuredClone(f.snapshot), account = (owner, bytes) => ({ owner, executable: false, data: [bytes.toString("base64"), "base64"] });
    const epoch = Buffer.alloc(4); epoch.writeUInt32LE(p.keyEpoch);
    const r = Buffer.concat([Buffer.from("KPTRCPT1"), Buffer.from([1]), h(message.messageDigestHex), h(message.operationIdHex),
      h(p.transceiverProgramId), h(p.managerProgramId), h(p.mint), Buffer.from([0, 0]), epoch,
      ...signers.map(s => Buffer.from(s.publicKey)).sort(Buffer.compare), Buffer.from([0])]);
    const c = Buffer.alloc(211); c.write("KPBCLM01"); c[8] = 1; h(message.operationIdHex).copy(c, 9); h(message.messageDigestHex).copy(c, 41);
    c.writeBigUInt64LE(100n, 73); c.writeUInt16LE(32, 81); h(message.destinationHex).copy(c, 83);
    snapshot.accounts.push(receipt ? account(f.manifest.transceiver.id, r) : null, claim ? account(f.manifest.manager.id, c) : null);
    return snapshot;
  }
  return { policy, message, delivery, accounts,
    // Synchronous TEST enrollment only. Never return or serialize the seed.
    withFeePayerSeedForTest(consume) { const bytes = Buffer.from(k["secret" + "Key"]);
      try { const result = consume(bytes); if (result?.then) throw new Error("SynchronousTestEnrollmentRequired"); return result; }
      finally { bytes.fill(0); } } };
}
