// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { NativeFrostSigner } from "./native-frost-signer.mjs";
import { validateNativeSigningIntent } from "../policy/native-signing-policy.mjs";
import { validateNativeFrostSigningRequest } from "../policy/signing-request.mjs";
import { ProtectedServiceIpc } from "../../../shared/windows/service-ipc.mjs";

// No DKG secret, private-share export, arbitrary method dispatch or shell API.
export function nativeFrostIpcHandler(signer) {
  if (!(signer instanceof NativeFrostSigner)) throw new Error("IpcNativeSignerRequired");
  return async ({ method, operationId, payload, peerRole }) => {
    if (peerRole !== "COORDINATOR") throw new Error("IpcCoordinatorRequired");
    if (method === "verifyNativeEvidence") {
      const intent = validateNativeSigningIntent(payload);
      if (operationId !== intent.operationId) throw new Error("IpcOperationBindingRejected");
      await signer.verifyNativeEvidence(intent); return { state: "NATIVE_EVIDENCE_CHECKED", operationId };
    }
    const request = validateNativeFrostSigningRequest(payload?.request);
    if (operationId !== request.intent.operationId) throw new Error("IpcOperationBindingRejected");
    if (method === "signingCommitment") return signer.signingCommitment(request);
    if (method === "signatureShare") return signer.signatureShare(request, payload.commitments);
    if (method === "abortSigningSession") return signer.abortSigningSession(request);
    throw new Error("IpcNativeMethodRejected");
  };
}

export class ProtectedRemoteFrostPeer {
  #ipc; #port;
  constructor({ ipc, port, signerId }) {
    if (!(ipc instanceof ProtectedServiceIpc) || ipc.role !== "COORDINATOR" || ipc.peerRole !== signerId ||
        !["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"].includes(signerId)) throw new Error("IpcSignerBindingRejected");
    this.#ipc = ipc; this.#port = port;
    Object.defineProperty(this, "signerId", { value: signerId, enumerable: true }); Object.freeze(this);
  }
  isAvailable() { return true; } // Reachability is determined by authenticated calls, never this hint.
  async verifyNativeEvidence(intent) {
    const result = await this.#ipc.request(this.#port, { method: "verifyNativeEvidence", operationId: intent.operationId, payload: intent });
    if (result?.state !== "NATIVE_EVIDENCE_CHECKED" || result.operationId !== intent.operationId) throw new Error("IpcNativeEvidenceRejected");
  }
  signingCommitment(request) { return this.#call("signingCommitment", request); }
  signatureShare(request, commitments) { return this.#call("signatureShare", request, commitments); }
  abortSigningSession(request) { return this.#call("abortSigningSession", request); }
  #call(method, request, commitments) {
    request = validateNativeFrostSigningRequest(request);
    return this.#ipc.request(this.#port, { method, operationId: request.intent.operationId,
      payload: commitments === undefined ? { request } : { request, commitments } });
  }
}
