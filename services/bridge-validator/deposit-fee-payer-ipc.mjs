// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { isProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { validateSolanaDeliveryPolicy, solanaDeliveryPolicyDigest, validateSolanaDepositSigningIntent, validateSolanaDepositDelivery } from "../relayer/solana-deposit-delivery.mjs";
import { requireProtectedDepositFeePayer } from "./protected-deposit-fee-payer.mjs";
const CLIENTS = new WeakSet();
const check = v => { if (!v) throw new Error("DepositFeePayerIpcRejected"); };
export function depositFeePayerIpcHandler({ feePayer, policy, integrity }) {
  const pinned = validateSolanaDeliveryPolicy(policy); requireProtectedDepositFeePayer(feePayer, pinned, integrity);
  return async ({ peerRole, method, operationId, payload }) => {
    check(peerRole === "BRIDGE_VALIDATOR" && method === "prepareSolanaDeposit");
    const { intent } = validateSolanaDepositSigningIntent(payload, pinned); check(operationId === intent.operationId);
    requireProtectedDepositFeePayer(feePayer, pinned, integrity); return feePayer.prepare(intent);
  };
}
export function validateDepositFeePayerResponse(response, request, policy) {
  const intent = validateSolanaDepositSigningIntent(request, policy).intent, delivery = validateSolanaDepositDelivery(response, policy).delivery;
  const { preparedTransactionBase64, ...returned } = delivery;
  check(typeof preparedTransactionBase64 === "string" && canonicalJson(returned) === canonicalJson(intent)); return delivery;
}
export class ProtectedDepositFeePayerClient {
  #ipc; #port; #policy;
  constructor({ ipc, port, policy }) {
    check(isProtectedServiceIpc(ipc) && ipc.role === "BRIDGE_VALIDATOR" && ipc.peerRole === "FEE_PAYER");
    check(Number.isInteger(port) && port > 0 && port <= 65535); this.#policy = validateSolanaDeliveryPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = this.#policy.operationPolicy;
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => ipc.deployment[k] === v));
    this.#ipc = ipc; this.#port = port; CLIENTS.add(this); Object.freeze(this);
  }
  assertBinding(policy) { check(solanaDeliveryPolicyDigest(policy) === solanaDeliveryPolicyDigest(this.#policy)); }
  async prepare(input) {
    const { intent } = validateSolanaDepositSigningIntent(input, this.#policy);
    const result = await this.#ipc.request(this.#port, { method: "prepareSolanaDeposit", operationId: intent.operationId, payload: intent });
    return validateDepositFeePayerResponse(result, intent, this.#policy);
  }
}
export function requireDepositFeePayerClient(value, policy) { check(CLIENTS.has(value)); value.assertBinding(policy); }
