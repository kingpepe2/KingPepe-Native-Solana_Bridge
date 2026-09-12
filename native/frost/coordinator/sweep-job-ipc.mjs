// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { schnorr, schnorr_FROST } from "@noble/curves/secp256k1.js";
import { isProtectedServiceIpc } from "../../../shared/windows/service-ipc.mjs";
import { validateDepositOperationPolicy, depositOperationPolicyDigest } from "../../../services/bridge-validator/deposit-operation-state.mjs";
import { requireProtectedSweepJobs } from "./protected-sweep-jobs.mjs";
import { validateSweepJobIntent, sweepJobId } from "./sweep-job-state.mjs";
import { nativeSigningIntentDigest, REQUIRED_FROST_SIGNERS } from "../policy/native-signing-policy.mjs";

const CLIENTS = new WeakSet();
const check = value => { if (!value) throw new Error("SweepJobIpcRejected"); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
export function sweepJobIpcHandler({ jobs, policy, integrity }) {
  const pinned = validateDepositOperationPolicy(policy); requireProtectedSweepJobs(jobs, pinned, integrity);
  return async ({ peerRole, method, operationId, payload }) => {
    check(peerRole === "BRIDGE_VALIDATOR" && ["enqueueSweepSignature", "sweepSignatureStatus"].includes(method));
    fields(payload, ["intent"]); const intent = validateSweepJobIntent(payload.intent, pinned);
    check(operationId === intent.operationId); requireProtectedSweepJobs(jobs, pinned, integrity);
    return method === "enqueueSweepSignature" ? jobs.enqueue(intent) : jobs.status(intent);
  };
}
export function validateSweepJobResponse(input, intent, policy, method) {
  const pinned = validateDepositOperationPolicy(policy), i = validateSweepJobIntent(intent, pinned), value = structuredClone(input);
  check(["enqueueSweepSignature", "sweepSignatureStatus"].includes(method));
  fields(value, value.state === "SIGNED" ? ["state", "jobId", "result"] : ["state", "jobId"]);
  check(value.jobId === sweepJobId(i, pinned));
  if (method === "enqueueSweepSignature") check(value.state === "ACCEPTED");
  else check(["SIGNED", "WAITING_FOR_DEPENDENCY", "QUEUED_BY_LIMIT"].includes(value.state));
  if (value.state === "SIGNED") {
    const r = value.result;
    fields(r, ["state", "requestId", "epoch", "sessionId", "intentDigest", "messageHex", "signatureHex", "aggregateTweakedXOnlyPublicKey", "signerIds", "participantIdentifiers"]);
    check(r.state === "SIGNED" && r.requestId === i.signingRequestId && r.epoch === i.keyEpoch &&
      r.intentDigest === nativeSigningIntentDigest(i) && r.messageHex === i.taprootSighashHex && r.aggregateTweakedXOnlyPublicKey === pinned.frostPublicKeyHex);
    check(typeof r.sessionId === "string" && /^[0-9a-f]{64}$/u.test(r.sessionId) && typeof r.signatureHex === "string" && /^[0-9a-f]{128}$/u.test(r.signatureHex));
    check(JSON.stringify(r.signerIds) === JSON.stringify(REQUIRED_FROST_SIGNERS) &&
      JSON.stringify(r.participantIdentifiers) === JSON.stringify([1, 2].map(v => schnorr_FROST.Identifier.fromNumber(v))));
    check(schnorr.verify(Buffer.from(r.signatureHex, "hex"), Buffer.from(i.taprootSighashHex, "hex"), Buffer.from(pinned.frostPublicKeyHex, "hex")));
    Object.freeze(r.signerIds); Object.freeze(r.participantIdentifiers); Object.freeze(r);
  }
  return Object.freeze(value);
}
export class ProtectedSweepJobClient {
  #ipc; #port; #policy;
  constructor({ ipc, port, policy }) {
    check(isProtectedServiceIpc(ipc) && ipc.role === "BRIDGE_VALIDATOR" && ipc.peerRole === "COORDINATOR");
    check(Number.isInteger(port) && port >= 1 && port <= 65535);
    this.#policy = validateDepositOperationPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = this.#policy;
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => ipc.deployment[k] === v));
    this.#ipc = ipc; this.#port = port; CLIENTS.add(this); Object.freeze(this);
  }
  assertBinding(policy) { check(depositOperationPolicyDigest(policy) === depositOperationPolicyDigest(this.#policy)); }
  enqueue(intent) { return this.#call("enqueueSweepSignature", intent); }
  status(intent) { return this.#call("sweepSignatureStatus", intent); }
  async #call(method, input) {
    const intent = validateSweepJobIntent(input, this.#policy);
    const response = await this.#ipc.request(this.#port, { method, operationId: intent.operationId, payload: { intent } });
    return validateSweepJobResponse(response, intent, this.#policy, method);
  }
}
export function requireSweepJobClient(client, policy) { check(CLIENTS.has(client)); client.assertBinding(policy); }
