// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Canonical signed-packet and retained transport-state validation. No private
// fee-payer key, mint authority, Native proof flag or economic balance is held.
import { createHash } from "node:crypto";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { validateReconciliationBinding } from "../reconciliation/deposit-reconciliation.mjs";
import { deploymentManifestDigest, deploymentAddresses, verifyDeploymentSnapshot } from "../solana-observer/deployment-integrity.mjs";
import { decodeDepositClaimAccountBase64 } from "../solana-observer/solana-deposit-claim-observer.mjs";
import { base58Decode, base58Encode, findProgramAddress, TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX, DEPOSIT_CLAIM_PDA_SEED_PREFIX,
  verifySignedLocalnetSolanaDepositReceiptTransaction, verifySignedLocalnetSolanaDepositClaimTransaction } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { verifyProjectAttestation, ATTESTATION_MODE, ATTESTATION_PROTOCOL } from "../attesters/attestation-service.mjs";
import { depositOperationPolicyDigest } from "../bridge-validator/deposit-operation-state.mjs";

export const SOLANA_DELIVERY_PROTOCOL = "KINGPEPE_PROTECTED_SOLANA_DEPOSIT_OUTBOX_V1";
export const MAX_SOLANA_DELIVERIES = 128, MAX_SOLANA_REBUILDS = 8, MAX_SOLANA_SENDS = 32;
const HASH = /^[0-9a-f]{64}$/u;
const check = (v, code = "SolanaDepositDeliveryRejected") => { if (!v) throw new Error(code); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
const hash = v => { check(typeof v === "string" && HASH.test(v)); return v; };
const digest = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const deliveryUint = value => { check(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value) &&
  BigInt(value) <= 0xffff_ffff_ffff_ffffn); return BigInt(value); };
const key = value => { check(typeof value === "string" && value.length >= 32 && value.length <= 44);
  const b = Buffer.from(base58Decode(value)); check(b.length === 32 && base58Encode(b) === value); return b; };
export function validateSolanaDeliveryPolicy(input) {
  fields(input, ["operationPolicy", "manifest", "feePayerPublicKey"]);
  const { policy, manifest } = validateReconciliationBinding(input.operationPolicy, input.manifest);
  key(input.feePayerPublicKey);
  check(!deploymentAddresses(manifest).includes(input.feePayerPublicKey));
  return Object.freeze({ operationPolicy: policy, manifest, feePayerPublicKey: input.feePayerPublicKey });
}
export function solanaDeliveryPolicyDigest(input) {
  const p = validateSolanaDeliveryPolicy(input);
  return digest([SOLANA_DELIVERY_PROTOCOL, depositOperationPolicyDigest(p.operationPolicy), deploymentManifestDigest(p.manifest), p.feePayerPublicKey]);
}
export function validateSolanaDepositDelivery(input, policy) {
  const p = validateSolanaDeliveryPolicy(policy), v = structuredClone(input);
  fields(v, ["operationId", "kind", "encodedMessageHex", "attestations", "preparedTransactionBase64", "recentBlockhash", "lastValidBlockHeight", "minimumSlot"]);
  hash(v.operationId); check(["RECEIPT", "CLAIM"].includes(v.kind));
  check(typeof v.encodedMessageHex === "string" && /^[0-9a-f]{1028}$/u.test(v.encodedMessageHex) && Buffer.byteLength(JSON.stringify(v)) <= 12000);
  const m = decodeCanonicalBridgeMessage(Buffer.from(v.encodedMessageHex, "hex")), op = p.operationPolicy, d = m.deployment;
  check(m.action === "DepositClaim" && m.direction === "NativeToSolana" && m.feeAtomic === 0n && m.amountAtomic > 0n && m.amountAtomic <= deliveryUint(op.maximumAmountAtomic));
  for (const [field, expected] of [["nativeGenesis", op.nativeGenesis], ["solanaDeployment", op.solanaDeployment],
    ["managerProgramId", op.managerProgramId], ["transceiverProgramId", op.transceiverProgramId], ["mint", op.mint]])
    check(Buffer.from(d[field]).toString("hex") === expected);
  check(d.protocolId === op.protocolId && d.nativeNetwork === op.nativeNetwork && m.policyEpoch === op.policyEpoch && m.keyEpoch === op.keyEpoch);
  check(Array.isArray(v.attestations) && v.attestations.length === 2);
  for (const [i, a] of v.attestations.entries()) {
    fields(a, ["protocol", "mode", "role", "keyEpoch", "policyEpoch", "attesterPublicKeyHex", "messageDigestHex", "operationIdHex", "signedBytes", "signatureHex", "state"]);
    check(a.protocol === ATTESTATION_PROTOCOL && a.mode === ATTESTATION_MODE && a.role === ["ATTESTER_A", "ATTESTER_B"][i] &&
      a.keyEpoch === op.keyEpoch && a.policyEpoch === op.policyEpoch && a.attesterPublicKeyHex === key(p.manifest.config.attesters[i]).toString("hex") &&
      a.messageDigestHex === m.messageDigestHex && a.operationIdHex === m.operationIdHex && a.signedBytes === "CANONICAL_BRIDGE_MESSAGE_V1" &&
      a.state === "VERIFIED_READY" && verifyProjectAttestation(a, v.encodedMessageHex));
  }
  key(v.recentBlockhash); deliveryUint(v.lastValidBlockHeight);
  check(deliveryUint(v.minimumSlot) >= deliveryUint(op.minimumSolanaSlot));
  const config = { environment: "localnet", cluster: "localnet", managerProgramIdHex: op.managerProgramId, transceiverProgramIdHex: op.transceiverProgramId,
    mintHex: op.mint, recipientTokenAccountHex: m.destinationHex, encodedMessageHex: v.encodedMessageHex, attestations: v.attestations,
    recentBlockhashBase58: v.recentBlockhash, lastValidBlockHeight: v.lastValidBlockHeight, preparedTransactionBase64: v.preparedTransactionBase64 };
  const verify = v.kind === "RECEIPT" ? verifySignedLocalnetSolanaDepositReceiptTransaction : verifySignedLocalnetSolanaDepositClaimTransaction;
  const result = verify(config);
  check(Buffer.from(v.preparedTransactionBase64, "base64").subarray(69, 101).equals(key(p.feePayerPublicKey)));
  return { delivery: v, signature: result.solanaSignature, message: m,
    receiptAddress: findProgramAddress([Buffer.from(TRANSCEIVER_RECEIPT_PDA_SEED_PREFIX), Buffer.from(m.messageDigestHex, "hex")], Buffer.from(op.transceiverProgramId, "hex")).base58,
    claimAddress: findProgramAddress([Buffer.from(DEPOSIT_CLAIM_PDA_SEED_PREFIX), Buffer.from(m.operationIdHex, "hex")], Buffer.from(op.managerProgramId, "hex")).base58 };
}
export function solanaDeliveryId(input, policy) {
  const v = validateSolanaDepositDelivery(input, policy); return digest([solanaDeliveryPolicyDigest(policy), v.delivery.operationId, v.delivery.kind, v.signature]);
}
export function initialSolanaDepositOutbox(policy) {
  return Buffer.from(JSON.stringify({ protocol: SOLANA_DELIVERY_PROTOCOL, policyDigest: solanaDeliveryPolicyDigest(policy), lastTimeMs: 0, records: [] }));
}
export function newSolanaDeliveryRecord(input, policy) {
  return { delivery: validateSolanaDepositDelivery(input, policy).delivery, sendAttempts: 0, lastSendAt: 0, retryAfter: 0,
    outcome: "UNRESOLVED", observedSlot: "0", finalizedHeight: "0" };
}
export function decodeSolanaDepositOutbox(bytes, policy, now = Date.now()) {
  check(bytes instanceof Uint8Array && bytes.length <= 900000);
  const text = Buffer.from(bytes).toString("utf8"), v = JSON.parse(text); check(JSON.stringify(v) === text);
  fields(v, ["protocol", "policyDigest", "lastTimeMs", "records"]);
  check(v.protocol === SOLANA_DELIVERY_PROTOCOL && v.policyDigest === solanaDeliveryPolicyDigest(policy));
  check(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(v.lastTimeMs) && v.lastTimeMs >= 0 && v.lastTimeMs <= now);
  check(Array.isArray(v.records) && v.records.length <= MAX_SOLANA_DELIVERIES);
  const identities = new Set(), operations = new Map(), outpoints = new Map(), groups = new Map();
  for (const r of v.records) {
    fields(r, ["delivery", "sendAttempts", "lastSendAt", "retryAfter", "outcome", "observedSlot", "finalizedHeight"]);
    const checked = validateSolanaDepositDelivery(r.delivery, policy), d = checked.delivery, id = solanaDeliveryId(d, policy);
    check(!identities.has(id)); identities.add(id);
    const common = canonicalJson([d.encodedMessageHex, d.attestations]);
    if (operations.has(d.operationId)) check(operations.get(d.operationId) === common);
    operations.set(d.operationId, common);
    const point = checked.message.depositOutpointText;
    if (outpoints.has(point)) check(outpoints.get(point) === d.operationId);
    outpoints.set(point, d.operationId);
    check(Number.isInteger(r.sendAttempts) && r.sendAttempts >= 0 && r.sendAttempts <= MAX_SOLANA_SENDS);
    check(Number.isSafeInteger(r.lastSendAt) && r.lastSendAt >= 0 && r.lastSendAt <= v.lastTimeMs &&
      Number.isSafeInteger(r.retryAfter) && r.retryAfter >= r.lastSendAt && r.retryAfter <= r.lastSendAt + 30000);
    check(r.sendAttempts === 0 ? r.lastSendAt === 0 && r.retryAfter === 0 : r.lastSendAt > 0);
    check(["UNRESOLVED", "FINALIZED_ACCOUNT", "EXPIRED_UNSEEN", "FINALIZED_FAILED"].includes(r.outcome));
    deliveryUint(r.observedSlot); deliveryUint(r.finalizedHeight);
    if (r.outcome !== "UNRESOLVED") check(deliveryUint(r.observedSlot) >= deliveryUint(d.minimumSlot) && deliveryUint(r.finalizedHeight) > 0n);
    if (r.outcome === "EXPIRED_UNSEEN") check(deliveryUint(r.finalizedHeight) > deliveryUint(d.lastValidBlockHeight));
    const group = d.operationId + ":" + d.kind, prior = groups.get(group) ?? [];
    check(prior.length < MAX_SOLANA_REBUILDS);
    if (prior.length) {
      const last = prior.at(-1);
      check(["EXPIRED_UNSEEN", "FINALIZED_FAILED"].includes(last.outcome) &&
        d.recentBlockhash !== last.delivery.recentBlockhash &&
        deliveryUint(d.lastValidBlockHeight) > deliveryUint(last.delivery.lastValidBlockHeight) &&
        deliveryUint(d.minimumSlot) >= deliveryUint(last.observedSlot));
    }
    prior.push(r); groups.set(group, prior);
  }
  return v;
}
export function validateSolanaDeliveryStatus(status) {
  if (status === null) return null;
  check(status && Object.hasOwn(status, "err") && status.err !== undefined && Number.isSafeInteger(status.slot) && status.slot >= 0 &&
    ["processed", "confirmed", "finalized"].includes(status.confirmationStatus), "SolanaDeliveryStatusMalformed");
  return Object.freeze({ slot: String(status.slot), finalized: status.confirmationStatus === "finalized", successful: status.err === null });
}
// Real callers obtain these accounts in the SAME finalized bank as deployment,
// Mint and counters. This pure validator does not elevate RPC to consensus.
export function verifySolanaDeliveryAccounts(input, policy, snapshot) {
  const p = validateSolanaDeliveryPolicy(policy), v = validateSolanaDepositDelivery(input, p), count = deploymentAddresses(p.manifest).length;
  check(snapshot && Array.isArray(snapshot.accounts) && snapshot.accounts.length === count + 2);
  const deployment = verifyDeploymentSnapshot(p.manifest, { ...snapshot, accounts: snapshot.accounts.slice(0, count) });
  check(deliveryUint(deployment.slot) >= deliveryUint(v.delivery.minimumSlot), "SolanaDeliveryObservationStale");
  const [receipt, claim] = snapshot.accounts.slice(count), m = v.message, op = p.operationPolicy;
  const data = (account, length, program) => {
    check(account && account.owner === program && account.executable === false &&
      Array.isArray(account.data) && account.data.length === 2 && account.data[1] === "base64" &&
      typeof account.data[0] === "string" && account.data[0].length <= 4 * Math.ceil(length / 3), "SolanaDeliveryAccountConflict");
    const bytes = Buffer.from(account.data[0], "base64");
    check(bytes.length === length && bytes.toString("base64") === account.data[0], "SolanaDeliveryAccountConflict"); return bytes;
  };
  if (receipt !== null) {
    const b = data(receipt, 240, p.manifest.transceiver.id), epoch = Buffer.alloc(4); epoch.writeUInt32LE(op.keyEpoch);
    const expected = Buffer.concat([Buffer.from("KPTRCPT1"), Buffer.from([1]), Buffer.from(m.messageDigestHex, "hex"), Buffer.from(m.operationIdHex, "hex"),
      Buffer.from(op.transceiverProgramId, "hex"), Buffer.from(op.managerProgramId, "hex"), Buffer.from(op.mint, "hex"),
      // Canonical V1 direction/action discriminants, validated above. The
      // Rust receipt stores the authorized public keys in byte-sorted order.
      Buffer.from([Buffer.from(v.delivery.encodedMessageHex, "hex")[10], Buffer.from(v.delivery.encodedMessageHex, "hex")[9]]),
      epoch, ...p.manifest.config.attesters.map(key).sort(Buffer.compare)]);
    check(expected.length === 239 && b.subarray(0, 239).equals(expected) && [0, 1].includes(b[239]), "SolanaDeliveryAccountConflict");
  }
  if (claim !== null) {
    const b = data(claim, 211, p.manifest.manager.id), parsed = decodeDepositClaimAccountBase64(b.toString("base64"));
    check(parsed.operationIdHex === m.operationIdHex && parsed.messageDigestHex === m.messageDigestHex &&
      parsed.amountAtomic === m.amountAtomic.toString() && parsed.solanaRecipientHex === m.destinationHex, "SolanaDeliveryAccountConflict");
    check(receipt !== null, "SolanaDeliveryAccountConflict");
  }
  return Object.freeze({ slot: deployment.slot, receiptExists: receipt !== null, claimExists: claim !== null, genesis: deployment.genesis });
}
