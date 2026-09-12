// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Durable orchestration metadata. Only the separate operation journal accounts
// reserve/credit; no controller field is a substitute for chain validation.
import { createHash } from "node:crypto";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { validateDepositOperationPlan, validateDepositCreditFact, MAX_DEPOSIT_OPERATIONS } from "./deposit-operation-state.mjs";
import { validateProtectedAttestationResponse } from "../attesters/protected-client.mjs";
import { validateSolanaDeliveryPolicy, solanaDeliveryPolicyDigest, validateSolanaDepositSigningIntent,
  validateSolanaDepositDelivery, deliveryUint, MAX_SOLANA_REBUILDS } from "../relayer/solana-deposit-delivery.mjs";
export const DEPOSIT_CONTROLLER_PROTOCOL = "KINGPEPE_PROTECTED_DEPOSIT_CONTROLLER_V1";
const check = v => { if (!v) throw new Error("DepositControllerStateRejected"); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
const hash = v => { check(typeof v === "string" && /^[0-9a-f]{64}$/u.test(v)); return v; };
const digest = v => createHash("sha256").update(canonicalJson(v)).digest("hex");
export function validateDepositControllerPolicy(input) {
  fields(input, ["deliveryPolicy", "creditValiditySeconds"]);
  const policy = validateSolanaDeliveryPolicy(input.deliveryPolicy);
  check(Number.isInteger(input.creditValiditySeconds) && input.creditValiditySeconds >= 1 && input.creditValiditySeconds <= 86400);
  return { deliveryPolicy: policy, creditValiditySeconds: input.creditValiditySeconds };
}
export function depositControllerPolicyDigest(input) {
  const p = validateDepositControllerPolicy(input); return digest([DEPOSIT_CONTROLLER_PROTOCOL, solanaDeliveryPolicyDigest(p.deliveryPolicy), p.creditValiditySeconds]);
}
export function initialDepositControllerState(policy) {
  return Buffer.from(JSON.stringify({ protocol: DEPOSIT_CONTROLLER_PROTOCOL, policyDigest: depositControllerPolicyDigest(policy), lastTimeMs: 0, records: [] }));
}
export function newDepositControllerRecord(plan, policy) {
  const p = validateDepositControllerPolicy(policy);
  return { plan: validateDepositOperationPlan(plan, p.deliveryPolicy.operationPolicy), nativeValidationDigest: null,
    creditWindow: null, credit: null, attestations: [], packets: [], completed: null };
}
export function controllerAttestationRequest(record) {
  check(record.credit !== null);
  return { encodedMessageHex: record.credit.encodedMessageHex,
    rawEvidence: { plan: record.plan, acceptedCheckpoint: record.credit.acceptedCheckpoint } };
}
export function decodeDepositControllerState(bytes, policy, now = Date.now()) {
  const p = validateDepositControllerPolicy(policy), dp = p.deliveryPolicy;
  check(bytes instanceof Uint8Array && bytes.length <= 900000);
  const text = Buffer.from(bytes).toString("utf8"), v = JSON.parse(text); check(JSON.stringify(v) === text);
  fields(v, ["protocol", "policyDigest", "lastTimeMs", "records"]);
  check(v.protocol === DEPOSIT_CONTROLLER_PROTOCOL && v.policyDigest === depositControllerPolicyDigest(p));
  check(Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(v.lastTimeMs) && v.lastTimeMs >= 0 && v.lastTimeMs <= now);
  check(Array.isArray(v.records) && v.records.length <= MAX_DEPOSIT_OPERATIONS);
  const ids = new Set(), deposits = new Set(), inputs = new Set();
  for (const r of v.records) {
    fields(r, ["plan", "nativeValidationDigest", "creditWindow", "credit", "attestations", "packets", "completed"]);
    const plan = validateDepositOperationPlan(r.plan, dp.operationPolicy), id = plan.operationId, point = plan.inputs[0].txid + ":" + plan.inputs[0].vout;
    check(!ids.has(id) && !deposits.has(point)); ids.add(id); deposits.add(point);
    for (const input of plan.inputs) { const key = input.txid + ":" + input.vout; check(!inputs.has(key)); inputs.add(key); }
    if (r.nativeValidationDigest !== null) check(hash(r.nativeValidationDigest) === plan.acceptedCheckpoint.evidenceDigestHex);
    if (r.creditWindow !== null) {
      check(r.nativeValidationDigest !== null); fields(r.creditWindow, ["validFrom", "validUntil"]);
      const from = deliveryUint(r.creditWindow.validFrom), until = deliveryUint(r.creditWindow.validUntil);
      check(until - from === BigInt(p.creditValiditySeconds) && from <= BigInt(Math.floor(v.lastTimeMs / 1000)));
    }
    if (r.credit !== null) {
      check(r.nativeValidationDigest !== null && r.creditWindow !== null);
      const fact = validateDepositCreditFact(plan, r.credit, dp.operationPolicy);
      const m = decodeCanonicalBridgeMessage(Buffer.from(fact.encodedMessageHex, "hex"));
      check(m.validFrom.toString() === r.creditWindow.validFrom && m.validUntil.toString() === r.creditWindow.validUntil);
    }
    check(Array.isArray(r.attestations) && r.attestations.length <= 2);
    if (r.attestations.length) check(r.credit !== null);
    for (const [i, a] of r.attestations.entries()) validateProtectedAttestationResponse(a, controllerAttestationRequest(r), dp, ["ATTESTER_A", "ATTESTER_B"][i]);
    check(Array.isArray(r.packets) && r.packets.length <= MAX_SOLANA_REBUILDS * 2);
    const seen = new Set(); let receiptSeen = false, claimSeen = false, counts = { RECEIPT: 0, CLAIM: 0 }, prior = null;
    for (const packet of r.packets) {
      fields(packet, ["intent", "delivery", "unsignedExpiredAtHeight"]); check(r.credit !== null && r.attestations.length === 2);
      const { intent, message } = validateSolanaDepositSigningIntent(packet.intent, dp);
      check(intent.operationId === id && intent.encodedMessageHex === r.credit.encodedMessageHex &&
        canonicalJson(intent.attestations) === canonicalJson(r.attestations));
      check(message.validFrom.toString() === r.creditWindow.validFrom && message.validUntil.toString() === r.creditWindow.validUntil);
      const key = digest(intent); check(!seen.has(key)); seen.add(key); check(++counts[intent.kind] <= MAX_SOLANA_REBUILDS);
      if (prior) { check((prior.delivery !== null || prior.unsignedExpiredAtHeight !== null) && deliveryUint(intent.minimumSlot) >= deliveryUint(prior.intent.minimumSlot));
        if (prior.intent.kind === intent.kind) check(intent.recentBlockhash !== prior.intent.recentBlockhash &&
          deliveryUint(intent.lastValidBlockHeight) > deliveryUint(prior.intent.lastValidBlockHeight)); }
      if (intent.kind === "RECEIPT") { check(!claimSeen); if (packet.delivery !== null) receiptSeen = true; } else { check(receiptSeen); claimSeen = true; }
      if (packet.unsignedExpiredAtHeight !== null) check(packet.delivery === null &&
        deliveryUint(packet.unsignedExpiredAtHeight) > deliveryUint(intent.lastValidBlockHeight));
      if (packet.delivery !== null) {
        const delivery = validateSolanaDepositDelivery(packet.delivery, dp).delivery;
        const { preparedTransactionBase64, ...withoutPacket } = delivery;
        check(typeof preparedTransactionBase64 === "string" && canonicalJson(withoutPacket) === canonicalJson(intent));
      }
      prior = packet;
    }
    if (r.completed !== null) {
      fields(r.completed, ["journalRevision", "solanaSlot", "evidenceDigest"]);
      check(r.credit !== null && r.attestations.length === 2 && r.packets.some(x => x.intent.kind === "CLAIM" && x.delivery !== null));
      check(deliveryUint(r.completed.journalRevision) > 0n); deliveryUint(r.completed.solanaSlot); hash(r.completed.evidenceDigest);
    }
  }
  return v;
}
