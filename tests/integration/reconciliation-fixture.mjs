// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic codec/persistence fixture ONLY, not Native or Solana chain proof.
import { deploymentFixture } from "./deployment-fixture.mjs";
import { base58Decode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";

export function reconciliationFixture() {
  const { manifest: m, snapshot } = deploymentFixture(), hex = v => Buffer.from(base58Decode(v)).toString("hex"), bytes = v => Buffer.from(v, "hex");
  const policy = { environment: "localnet", nativeGenesis: m.nativeGenesisHex, solanaDeployment: m.solanaDeploymentHex, solanaGenesis: m.solanaGenesis,
    minimumSolanaSlot: "1", managerProgramId: hex(m.manager.id), transceiverProgramId: hex(m.transceiver.id), mint: hex(m.mint.id),
    protocolId: m.config.protocolId, nativeNetwork: m.config.nativeNetwork, policyEpoch: m.config.policyEpoch, keyEpoch: m.config.keyEpoch,
    frostPublicKeyHex: "11".repeat(32), csvDelayBlocks: 10, minimumConfirmations: 3, maximumAmountAtomic: "1000000000", maximumFeeAtomic: "1000" };
  const message = encodeCanonicalBridgeMessage({ action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: policy.protocolId, nativeNetwork: policy.nativeNetwork, nativeGenesis: bytes(policy.nativeGenesis), solanaDeployment: bytes(policy.solanaDeployment),
      managerProgramId: bytes(policy.managerProgramId), transceiverProgramId: bytes(policy.transceiverProgramId), mint: bytes(policy.mint) },
    depositOutpoint: { txid: Buffer.alloc(32, 9), vout: 0 }, withdrawalId: Buffer.alloc(32), amountAtomic: 100n, feeAtomic: 0n, destination: Buffer.alloc(32, 8),
    policyEpoch: 1, keyEpoch: 1, nonce: Buffer.alloc(32, 7), validFrom: 1n, validUntil: 2n, evidenceDigest: Buffer.alloc(32, 6) });
  const decoded = decodeCanonicalBridgeMessage(message), b = Buffer.alloc(211); b.write("KPBCLM01"); b[8] = 1;
  bytes(decoded.operationIdHex).copy(b, 9); bytes(decoded.messageDigestHex).copy(b, 41); b.writeBigUInt64LE(100n, 73); b.writeUInt16LE(32, 81); Buffer.alloc(32, 8).copy(b, 83);
  const operation = { plan: { operationId: "42".repeat(32), depositIntent: { amountAtomic: "100" } },
    finalizedCredit: { encodedMessageHex: Buffer.from(message).toString("hex") }, mintReceipt: { rootSlot: "9" } };
  snapshot.accounts.push({ owner: m.manager.id, executable: false, data: [b.toString("base64"), "base64"] });
  return { policy, manifest: m, snapshot, operations: [operation] };
}
