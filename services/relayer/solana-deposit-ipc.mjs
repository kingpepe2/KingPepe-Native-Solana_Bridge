// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { isProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { validateSolanaDeliveryPolicy, solanaDeliveryPolicyDigest, validateSolanaDepositDelivery, solanaDeliveryId, deliveryUint } from "./solana-deposit-delivery.mjs";
import { requireSolanaDepositOutbox } from "./protected-solana-deposit-outbox.mjs";
const CLIENTS = new WeakSet();
const check = v => { if (!v) throw new Error("SolanaDeliveryIpcRejected"); };
export function solanaDepositIpcHandler({ outbox, integrity, policy }) {
  const pinned = validateSolanaDeliveryPolicy(policy); requireSolanaDepositOutbox(outbox, pinned, integrity);
  return async ({ peerRole, method, operationId, payload }) => {
    check(peerRole === "BRIDGE_VALIDATOR" && ["enqueueSolanaDeposit", "solanaDepositStatus"].includes(method));
    const v = validateSolanaDepositDelivery(payload, pinned); check(v.delivery.operationId === operationId);
    requireSolanaDepositOutbox(outbox, pinned, integrity);
    return method === "enqueueSolanaDeposit" ? outbox.enqueue(v.delivery) : outbox.status(solanaDeliveryId(v.delivery, pinned));
  };
}
export function validateSolanaDeliveryResponse(input, delivery, policy, method) {
  const expected = validateSolanaDepositDelivery(delivery, policy), v = structuredClone(input);
  const fields = method === "enqueueSolanaDeposit" ? ["state", "deliveryId", "operationId", "kind"] :
    ["state", "deliveryId", "operationId", "kind", "signature", "observedSlot"];
  check(["enqueueSolanaDeposit", "solanaDepositStatus"].includes(method) && v && !Array.isArray(v) && Object.keys(v).sort().join() === fields.sort().join());
  check(v.deliveryId === solanaDeliveryId(delivery, policy) && v.operationId === delivery.operationId && v.kind === delivery.kind);
  if (method === "enqueueSolanaDeposit") check(v.state === "ACCEPTED");
  else { check(["WAITING_FOR_DEPENDENCY", "QUEUED_BY_LIMIT", "FINALIZED_ACCOUNT", "EXPIRED_UNSEEN", "FINALIZED_FAILED"].includes(v.state));
    check(v.signature === expected.signature); deliveryUint(v.observedSlot); }
  return Object.freeze(v); // A transport/account observation, never mint settlement.
}
export class ProtectedSolanaDepositClient {
  #ipc; #port; #policy;
  constructor({ ipc, port, policy }) {
    check(isProtectedServiceIpc(ipc) && ipc.role === "BRIDGE_VALIDATOR" && ipc.peerRole === "RELAYER" && Number.isInteger(port) && port > 0 && port <= 65535);
    this.#policy = validateSolanaDeliveryPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = this.#policy.operationPolicy;
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => ipc.deployment[k] === v));
    this.#ipc = ipc; this.#port = port; CLIENTS.add(this); Object.freeze(this);
  }
  assertBinding(policy) { check(solanaDeliveryPolicyDigest(policy) === solanaDeliveryPolicyDigest(this.#policy)); }
  enqueue(value) { return this.#call("enqueueSolanaDeposit", value); }
  status(value) { return this.#call("solanaDepositStatus", value); }
  async #call(method, input) {
    const delivery = validateSolanaDepositDelivery(input, this.#policy).delivery;
    const result = await this.#ipc.request(this.#port, { method, operationId: delivery.operationId, payload: delivery });
    return validateSolanaDeliveryResponse(result, delivery, this.#policy, method);
  }
}
export function requireSolanaDepositClient(client, policy) { check(CLIENTS.has(client)); client.assertBinding(policy); }
