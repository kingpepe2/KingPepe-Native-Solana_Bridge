// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Actual ephemeral FROST/transaction fixture; all chain/checkpoint facts here
// are synthetic. No private share/key is returned or placed inside a checkout.
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { FileBackedFrostStateStore, NativeFrostSigner, NativeFrostCoordinator, REQUIRED_FROST_SIGNERS,
  createLocalNativeDkgPolicy, createNativeSigningPolicy, runTwoPartyDkg } from "../../native/frost/index.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { buildRegtestRecoverableDeposit, deriveRegtestDepositCommitment } from "../../native/recovery/taproot-deposit.mjs";
import { attachTaprootWitnesses, createLocalTaprootSighashEvidences, parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { prepareLocalNativeReserveSweepSigningIntent } from "../../services/bridge-validator/native-reserve-sweep-signing-intent.mjs";
import { initialDepositOperationState } from "../../services/bridge-validator/deposit-operation-state.mjs";
const h = value => createHash("sha256").update(value).digest("hex");
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
export async function depositOperationFixture({ root, repoRoot, solanaDeployment = h("deployment") }) {
  const domains = { environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment, bridgeProgramId: h("manager"), transceiverProgramId: h("transceiver"), mint: h("mint"), keyEpoch: 1 };
  const dkgPolicy = createLocalNativeDkgPolicy(domains);
  const stores = REQUIRED_FROST_SIGNERS.map((signerId, i) => FileBackedFrostStateStore.createLocal({ signerId,
    root: path.join(root, "participant-" + i), repoRoot, policy: dkgPolicy }));
  const dkgSigners = stores.map((stateStore, index) => new NativeFrostSigner({ signerId: REQUIRED_FROST_SIGNERS[index], index, stateStore, policy: dkgPolicy }));
  const dkg = runTwoPartyDkg(dkgSigners, { epoch: 1 }); dkgSigners.forEach(s => s.close());
  const policy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: domains.solanaDeployment,
    solanaGenesis: base58Encode(Buffer.from(h("genesis fixture"), "hex")), minimumSolanaSlot: "5",
    managerProgramId: domains.bridgeProgramId, transceiverProgramId: domains.transceiverProgramId, mint: domains.mint, protocolId: 1, nativeNetwork: 8000111,
    policyEpoch: 1, keyEpoch: 1, frostPublicKeyHex: dkg.aggregateTweakedXOnlyPublicKey, csvDelayBlocks: 12, minimumConfirmations: 6,
    maximumAmountAtomic: "1000000000", maximumFeeAtomic: "10000" };
  const depositIntent = { nativeGenesisHex: REGTEST_GENESIS, solanaDeploymentHex: domains.solanaDeployment, managerProgramIdHex: domains.bridgeProgramId,
    transceiverProgramIdHex: domains.transceiverProgramId, mintHex: domains.mint, recipientHex: h("recipient"), nonceHex: h("deposit nonce"),
    amountAtomic: "100000000", protocolId: 1, nativeNetwork: 8000111, policyEpoch: 1, keyEpoch: 1 };
  const recoverySecret = randomBytes(32);
  const recovery = Buffer.from(schnorr.getPublicKey(recoverySecret)).toString("hex"); recoverySecret.fill(0);
  const depositPolicy = buildRegtestRecoverableDeposit({ nativeGenesisHex: REGTEST_GENESIS, depositCommitmentHex: deriveRegtestDepositCommitment(depositIntent),
    frostPublicKeyHex: policy.frostPublicKeyHex, userRecoveryPublicKeyHex: recovery, csvDelayBlocks: policy.csvDelayBlocks });
  const inputs = [{ txid: h("deposit"), vout: 0, amountAtomic: "100000000", scriptPubKeyHex: depositPolicy.scriptPubKeyHex, minimumConfirmations: 6 },
    { txid: h("fee"), vout: 1, amountAtomic: "1000", scriptPubKeyHex: depositPolicy.canonicalReserveScriptPubKeyHex, minimumConfirmations: 1 }];
  const unsignedTransactionHex = Buffer.concat([u32(2), Buffer.of(2), ...inputs.flatMap(i => [Buffer.from(i.txid, "hex").reverse(), u32(i.vout), Buffer.of(0), u32(0xffff_ffff)]),
    Buffer.of(1), u64(depositIntent.amountAtomic), Buffer.of(34), Buffer.from(depositPolicy.canonicalReserveScriptPubKeyHex, "hex"), u32(0)]).toString("hex");
  const acceptedCheckpoint = { protocol: "KINGPEPE_REGTEST_ACCEPTANCE_CHECKPOINT_V1", genesis: REGTEST_GENESIS, tipHash: h("tip"), tipHeight: 100,
    chainworkHex: "00".repeat(31) + "ff", minimumConfirmations: 1, evidenceDigestHex: h("codec proof fixture") };
  const spentOutputs = inputs.map(i => ({ amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex })), tapscriptSpends = [depositPolicy.sweep, undefined];
  const evidences = createLocalTaprootSighashEvidences({ unsignedNativeTransactionHex: unsignedTransactionHex, spentOutputs, tapscriptSpends,
    proofFingerprintHex: acceptedCheckpoint.evidenceDigestHex, reserveAmountAtomic: depositIntent.amountAtomic, nativeMinerFeeAtomic: "1000",
    expectedRecipientScriptPubKeyHex: depositPolicy.canonicalReserveScriptPubKeyHex, expectedChangeScriptPubKeyHex: depositPolicy.canonicalReserveScriptPubKeyHex });
  const operationId = h("sweep operation"), depositOutpoint = inputs[0].txid + ":0";
  const signingIntents = evidences.map(nativeSighashEvidence => prepareLocalNativeReserveSweepSigningIntent({ operationIdHex: operationId,
    config: { ...domains, nativeNetworkName: "regtest", maxAmountAtomic: policy.maximumAmountAtomic, maxFeeAtomic: policy.maximumFeeAtomic },
    deposit: { depositOutpoint, amountAtomic: depositIntent.amountAtomic, proofFingerprintHex: acceptedCheckpoint.evidenceDigestHex,
      finalitySatisfied: true, utxoUnspent: true },
    reserveSweepDraft: { state: "UNSIGNED_DRAFT_ONLY", signed: false, broadcast: false, depositOutpoint, reserveAmountAtomic: depositIntent.amountAtomic,
      nativeMinerFeeAtomic: "1000", feeFundingOutpoints: [inputs[1].txid + ":1"], unsignedNativeTransactionFingerprintHex: h(Buffer.from(unsignedTransactionHex, "hex")),
      proofFingerprintHex: acceptedCheckpoint.evidenceDigestHex }, nativeSighashEvidence }).signingIntent);
  const nativePolicy = createNativeSigningPolicy({ ...domains, maxAmountAtomic: policy.maximumAmountAtomic, maxFeeAtomic: policy.maximumFeeAtomic,
    reserveScriptPubKeyHex: depositPolicy.canonicalReserveScriptPubKeyHex, authorizedOperations: signingIntents });
  const signers = REQUIRED_FROST_SIGNERS.map((signerId, index) => new NativeFrostSigner({ signerId, index, policy: nativePolicy,
    stateStore: new FileBackedFrostStateStore({ signerId, root: path.join(root, "participant-" + index), repoRoot }),
    nativeEvidenceValidator: async intent => ({ digestHex: intent.proofFingerprint }) }));
  const coordinator = new NativeFrostCoordinator({ ...dkg, signers });
  const signatures = [];
  try { for (const intent of signingIntents) signatures.push((await coordinator.signAutomaticallyWithNativeEvidence(intent)).signatureHex); }
  finally { signers.forEach(s => s.close()); }
  const signedTransactionHex = attachTaprootWitnesses({ unsignedNativeTransactionHex: unsignedTransactionHex, signatures, spentOutputs, tapscriptSpends }).rawSignedTransactionHex;
  const plan = { operationId, depositIntent, depositPolicy, inputs, acceptedCheckpoint, unsignedTransactionHex, signingIntents };
  const state = JSON.parse(initialDepositOperationState(policy));
  state.operations.push({ plan, signedTransactionHex: null, broadcastAttempted: false, broadcastAccepted: false, finalizedCredit: null, mintReceipt: null });
  const txid = parseNativeTransactionHex(unsignedTransactionHex).txidHex;
  const encodedMessageHex = Buffer.from(encodeCanonicalBridgeMessage({ action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: 1, nativeNetwork: 8000111, nativeGenesis: REGTEST_GENESIS, solanaDeployment: policy.solanaDeployment,
      managerProgramId: policy.managerProgramId, transceiverProgramId: policy.transceiverProgramId, mint: policy.mint },
    depositOutpoint: { txid: inputs[0].txid, vout: 0 }, withdrawalId: "00".repeat(32), amountAtomic: depositIntent.amountAtomic, feeAtomic: "0",
    destination: Buffer.from(depositIntent.recipientHex, "hex"), policyEpoch: 1, keyEpoch: 1, nonce: h("claim nonce"), validFrom: "1", validUntil: "4102444800", evidenceDigest: h("codec claim evidence") })).toString("hex");
  const finalizedCredit = { acceptedCheckpoint, reserveAllocationIdHex: h("allocation"), encodedMessageHex,
    reserveBasis: { genesis: REGTEST_GENESIS, chainworkHex: acceptedCheckpoint.chainworkHex,
      deposit: { txid: inputs[0].txid, vout: 0, height: 90, blockHash: h("deposit block") },
      sweep: { txid, vout: 0, height: 95, blockHash: h("sweep block") }, amountAtomic: depositIntent.amountAtomic, reserveScriptHex: depositPolicy.canonicalReserveScriptPubKeyHex } };
  const decoded = decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex, "hex"));
  const mintReceipt = { signature: base58Encode(Buffer.concat([Buffer.from(h("signature fixture a"), "hex"), Buffer.from(h("signature fixture b"), "hex")])),
    slot: "10", rootSlot: "12", genesis: policy.solanaGenesis, operationId: decoded.operationIdHex, messageDigest: decoded.messageDigestHex,
    amountAtomic: depositIntent.amountAtomic, recipientHex: depositIntent.recipientHex, mint: policy.mint };
  return { policy, plan, state: JSON.parse(JSON.stringify(state)), signedTransactionHex, finalizedCredit, mintReceipt };
}
