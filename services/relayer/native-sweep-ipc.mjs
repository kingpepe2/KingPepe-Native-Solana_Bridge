// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { isProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { validateDepositOperationPolicy, depositOperationPolicyDigest } from "../bridge-validator/deposit-operation-state.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { validateNativeSweepDelivery, requireNativeSweepOutbox } from "./native-sweep-outbox.mjs";
const CLIENTS = new WeakSet();
const check = value => { if (!value) throw new Error("NativeSweepIpcRejected"); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
export function nativeSweepIpcHandler({ outbox, policy, integrity }) {
  const pinned = validateDepositOperationPolicy(policy); requireNativeSweepOutbox(outbox, pinned, integrity);
  return async ({ peerRole, method, operationId, payload }) => {
    check(peerRole === "BRIDGE_VALIDATOR" && ["enqueueNativeSweep", "nativeSweepStatus"].includes(method));
    const delivery = validateNativeSweepDelivery(payload, pinned); check(delivery.plan.operationId === operationId);
    requireNativeSweepOutbox(outbox, pinned, integrity);
    if (method === "enqueueNativeSweep") return outbox.enqueue(delivery);
    try { return await outbox.status(operationId); }
    catch (error) {
      if (error?.message !== "NativeSweepDeliveryMissing") throw error;
      // An authenticated negative lookup is distinct from transport/auth failure.
      return { state: "NOT_ENQUEUED", operationId, txid: parseNativeTransactionHex(delivery.signedTransactionHex).txidHex };
    }
  };
}
export function validateNativeSweepResponse(input, delivery, policy, method) {
  const expected = validateNativeSweepDelivery(delivery, policy), value = structuredClone(input);
  fields(value, ["state", "operationId", "txid"]);
  check(["enqueueNativeSweep", "nativeSweepStatus"].includes(method));
  check(value.operationId === expected.plan.operationId && value.txid === parseNativeTransactionHex(expected.signedTransactionHex).txidHex);
  check(method === "enqueueNativeSweep" ? value.state === "ACCEPTED" :
    ["NOT_ENQUEUED", "BROADCAST_OBSERVED", "WAITING_FOR_DEPENDENCY", "QUEUED_BY_LIMIT"].includes(value.state));
  return Object.freeze(value); // OBSERVED is not a finality or credit attestation.
}
export class ProtectedNativeSweepClient {
  #ipc; #port; #policy;
  constructor({ ipc, port, policy }) {
    check(isProtectedServiceIpc(ipc) && ipc.role === "BRIDGE_VALIDATOR" && ipc.peerRole === "RELAYER");
    check(Number.isInteger(port) && port >= 1 && port <= 65535);
    this.#policy = validateDepositOperationPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = this.#policy;
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => ipc.deployment[k] === v));
    this.#ipc = ipc; this.#port = port; CLIENTS.add(this); Object.freeze(this);
  }
  assertBinding(policy) { check(depositOperationPolicyDigest(policy) === depositOperationPolicyDigest(this.#policy)); }
  enqueue(delivery) { return this.#call("enqueueNativeSweep", delivery); }
  status(delivery) { return this.#call("nativeSweepStatus", delivery); }
  async #call(method, input) {
    const delivery = validateNativeSweepDelivery(input, this.#policy);
    const response = await this.#ipc.request(this.#port, { method, operationId: delivery.plan.operationId, payload: delivery });
    return validateNativeSweepResponse(response, delivery, this.#policy, method);
  }
}
export function requireNativeSweepClient(client, policy) { check(CLIENTS.has(client)); client.assertBinding(policy); }
