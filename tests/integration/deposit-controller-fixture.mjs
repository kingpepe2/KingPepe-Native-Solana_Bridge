// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Codec-only SYNTHETIC chains; actual ephemeral FROST and Ed25519 signatures.
import { ed25519 } from "@noble/curves/ed25519.js";
import { depositOperationFixture } from "./deposit-operation-fixture.mjs";
import { deploymentFixture } from "./deployment-fixture.mjs";
import { base58Encode, base58Decode, findProgramAddress, prepareSignedLocalnetSolanaDepositReceiptTransaction,
  prepareSignedLocalnetSolanaDepositClaimTransaction } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { UPGRADEABLE_LOADER } from "../../services/solana-observer/deployment-integrity.mjs";
import { ATTESTATION_MODE, ATTESTATION_PROTOCOL } from "../../services/attesters/attestation-service.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { initialDepositControllerState, newDepositControllerRecord } from "../../services/bridge-validator/deposit-controller-state.mjs";
export async function depositControllerFixture(options) {
  const f = await depositOperationFixture(options), op = f.policy, m = deploymentFixture().manifest;
  const bytes = v => Buffer.from(v, "hex"), key = v => base58Encode(bytes(v));
  const derive = (seed, program) => findProgramAddress([Buffer.from(seed), bytes(op.mint)], bytes(program)).base58;
  m.solanaGenesis = op.solanaGenesis; m.solanaDeploymentHex = op.solanaDeployment; m.minimumSlot = op.minimumSolanaSlot;
  for (const [name, id] of [["manager", op.managerProgramId], ["transceiver", op.transceiverProgramId]]) {
    m[name].id = key(id); m[name].programData = findProgramAddress([bytes(id)], base58Decode(UPGRADEABLE_LOADER)).base58;
  }
  m.mint.id = key(op.mint); m.mint.authority = derive("kingpepe-mint-authority", op.managerProgramId);
  Object.assign(m.config, { bridgePda: derive("kingpepe-bridge-state", op.managerProgramId), transceiverPda: derive("kingpepe-transceiver-config", op.transceiverProgramId),
    protocolId: op.protocolId, nativeNetwork: op.nativeNetwork });
  const signers = [ed25519.keygen(), ed25519.keygen()], payer = ed25519.keygen();
  m.config.attesters = signers.map(s => base58Encode(s.publicKey));
  const policy = { deliveryPolicy: { operationPolicy: op, manifest: m, feePayerPublicKey: base58Encode(payer.publicKey) }, creditValiditySeconds: 3600 };
  const state = JSON.parse(initialDepositControllerState(policy)), record = newDepositControllerRecord(f.plan, policy);
  state.lastTimeMs = Date.now(); state.records.push(record);
  const now = String(Math.floor(state.lastTimeMs / 1000)), until = String(BigInt(now) + 3600n), d = f.plan.depositIntent;
  const encoded = encodeCanonicalBridgeMessage({ action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: op.protocolId, nativeNetwork: op.nativeNetwork, nativeGenesis: op.nativeGenesis, solanaDeployment: op.solanaDeployment,
      managerProgramId: op.managerProgramId, transceiverProgramId: op.transceiverProgramId, mint: op.mint },
    depositOutpoint: { txid: f.plan.inputs[0].txid, vout: 0 }, withdrawalId: "00".repeat(32), amountAtomic: d.amountAtomic, feeAtomic: "0",
    destination: bytes(d.recipientHex), policyEpoch: op.policyEpoch, keyEpoch: op.keyEpoch, nonce: "43".repeat(32), validFrom: now, validUntil: until, evidenceDigest: "45".repeat(32) });
  const message = decodeCanonicalBridgeMessage(encoded), credit = { ...f.finalizedCredit, encodedMessageHex: Buffer.from(encoded).toString("hex") };
  const attestations = signers.map((s, i) => ({ protocol: ATTESTATION_PROTOCOL, mode: ATTESTATION_MODE, role: ["ATTESTER_A", "ATTESTER_B"][i],
    keyEpoch: op.keyEpoch, policyEpoch: op.policyEpoch, attesterPublicKeyHex: Buffer.from(s.publicKey).toString("hex"),
    messageDigestHex: message.messageDigestHex, operationIdHex: message.operationIdHex, signedBytes: "CANONICAL_BRIDGE_MESSAGE_V1",
    signatureHex: Buffer.from(ed25519.sign(encoded, s["secret" + "Key"])).toString("hex"), state: "VERIFIED_READY" }));
  for (const s of signers) s["secret" + "Key"].fill(0);
  const ready = () => { record.nativeValidationDigest = f.plan.acceptedCheckpoint.evidenceDigestHex; record.creditWindow = { validFrom: now, validUntil: until };
    record.credit = structuredClone(credit); record.attestations = structuredClone(attestations); };
  async function packet(kind = "RECEIPT", generation = 0) {
    const recentBlockhash = base58Encode(Buffer.alloc(32, 20 + generation)), lastValidBlockHeight = String(1000 + generation), minimumSlot = String(10 + generation);
    const intent = { operationId: f.plan.operationId, kind, encodedMessageHex: credit.encodedMessageHex, attestations: structuredClone(attestations),
      recentBlockhash, lastValidBlockHeight, minimumSlot };
    const build = kind === "RECEIPT" ? prepareSignedLocalnetSolanaDepositReceiptTransaction : prepareSignedLocalnetSolanaDepositClaimTransaction;
    const tx = await build({ environment: "localnet", cluster: "localnet", managerProgramIdHex: op.managerProgramId, transceiverProgramIdHex: op.transceiverProgramId,
      mintHex: op.mint, recipientTokenAccountHex: d.recipientHex, feePayerHex: Buffer.from(payer.publicKey).toString("hex"), tokenProgramIdBase58: m.mint.tokenProgram,
      recentBlockhashBase58: recentBlockhash, lastValidBlockHeight, encodedMessageHex: credit.encodedMessageHex, attestations,
      feePayerSigner: { publicKeyHex: Buffer.from(payer.publicKey).toString("hex"), sign: x => ed25519.sign(x, payer["secret" + "Key"]) } });
    return { intent, delivery: { ...intent, preparedTransactionBase64: tx.preparedTransactionBase64 }, unsignedExpiredAtHeight: null };
  }
  return { ...f, policy, state, record, credit, attestations, ready, packet, dispose() { payer["secret" + "Key"].fill(0); } };
}
