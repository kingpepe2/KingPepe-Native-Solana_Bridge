// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// The bridge validator receives signatures, never attester key material.
import { isProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { validateSolanaDeliveryPolicy, solanaDeliveryPolicyDigest } from "../relayer/solana-deposit-delivery.mjs";
import { validateDepositOperationPlan } from "../bridge-validator/deposit-operation-state.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { base58Decode } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { verifyProjectAttestation, ATTESTATION_PROTOCOL, ATTESTATION_MODE } from "./attestation-service.mjs";
const CLIENTS = new WeakSet(), ROLES = ["ATTESTER_A", "ATTESTER_B"];
const check = v => { if (!v) throw new Error("ProtectedAttestationClientRejected"); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
export function validateProtectedAttestationRequest(input, policy) {
  const p = validateSolanaDeliveryPolicy(policy), v = structuredClone(input);
  fields(v, ["encodedMessageHex", "rawEvidence"]); fields(v.rawEvidence, ["plan", "acceptedCheckpoint"]);
  check(typeof v.encodedMessageHex === "string" && /^[0-9a-f]{1028}$/u.test(v.encodedMessageHex) && Buffer.byteLength(JSON.stringify(v)) <= 200000);
  const plan = validateDepositOperationPlan(v.rawEvidence.plan, p.operationPolicy);
  const m = decodeCanonicalBridgeMessage(Buffer.from(v.encodedMessageHex, "hex")), d = m.deployment, op = p.operationPolicy;
  check(m.action === "DepositClaim" && m.direction === "NativeToSolana" && m.feeAtomic === 0n &&
    m.depositOutpointText === plan.inputs[0].txid + ":" + plan.inputs[0].vout &&
    m.amountAtomic.toString() === plan.depositIntent.amountAtomic && m.destinationHex === plan.depositIntent.recipientHex);
  for (const [field, expected] of [["nativeGenesis", op.nativeGenesis], ["solanaDeployment", op.solanaDeployment],
    ["managerProgramId", op.managerProgramId], ["transceiverProgramId", op.transceiverProgramId], ["mint", op.mint]])
    check(Buffer.from(d[field]).toString("hex") === expected);
  check(d.protocolId === op.protocolId && d.nativeNetwork === op.nativeNetwork && m.policyEpoch === op.policyEpoch && m.keyEpoch === op.keyEpoch);
  // The service independently validates this checkpoint/raw plan against Native.
  // This client check does not promote serialized evidence to a chain proof.
  return { request: { encodedMessageHex: v.encodedMessageHex, rawEvidence: { plan, acceptedCheckpoint: v.rawEvidence.acceptedCheckpoint } }, message: m };
}
export function validateProtectedAttestationResponse(input, request, policy, role) {
  check(ROLES.includes(role)); const p = validateSolanaDeliveryPolicy(policy), { message } = validateProtectedAttestationRequest(request, p), v = structuredClone(input);
  fields(v, ["protocol", "mode", "role", "keyEpoch", "policyEpoch", "attesterPublicKeyHex", "messageDigestHex", "operationIdHex", "signedBytes", "signatureHex", "state"]);
  check(v.protocol === ATTESTATION_PROTOCOL && v.mode === ATTESTATION_MODE && v.role === role &&
    v.keyEpoch === p.operationPolicy.keyEpoch && v.policyEpoch === p.operationPolicy.policyEpoch &&
    v.attesterPublicKeyHex === Buffer.from(base58Decode(p.manifest.config.attesters[ROLES.indexOf(role)])).toString("hex") &&
    v.messageDigestHex === message.messageDigestHex && v.operationIdHex === message.operationIdHex &&
    v.signedBytes === "CANONICAL_BRIDGE_MESSAGE_V1" && v.state === "VERIFIED_READY" && verifyProjectAttestation(v, request.encodedMessageHex));
  return Object.freeze(v);
}
export class ProtectedDepositAttesterClient {
  #ipc; #port; #role; #policy;
  constructor({ ipc, port, role, policy }) {
    check(ROLES.includes(role) && isProtectedServiceIpc(ipc) && ipc.role === "BRIDGE_VALIDATOR" && ipc.peerRole === role);
    check(Number.isInteger(port) && port > 0 && port <= 65535); this.#policy = validateSolanaDeliveryPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = this.#policy.operationPolicy;
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => ipc.deployment[k] === v));
    this.#ipc = ipc; this.#port = port; this.#role = role; CLIENTS.add(this); Object.freeze(this);
  }
  get role() { return this.#role; }
  assertBinding(policy, role) { check(role === this.#role && solanaDeliveryPolicyDigest(policy) === solanaDeliveryPolicyDigest(this.#policy)); }
  async attest(input) {
    const { request, message } = validateProtectedAttestationRequest(input, this.#policy);
    const result = await this.#ipc.request(this.#port, { method: "attestDeposit", operationId: message.operationIdHex, payload: request });
    return validateProtectedAttestationResponse(result, request, this.#policy, this.#role);
  }
}
export function requireDepositAttesterClient(value, policy, role) { check(CLIENTS.has(value)); value.assertBinding(policy, role); }
