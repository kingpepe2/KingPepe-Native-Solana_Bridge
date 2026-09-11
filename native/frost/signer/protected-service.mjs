// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { NativeFrostSigner } from "./native-frost-signer.mjs";
import { validateNativeSigningIntent } from "../policy/native-signing-policy.mjs";
import { validateNativeFrostSigningRequest } from "../policy/signing-request.mjs";
import { isProtectedServiceIpc } from "../../../shared/windows/service-ipc.mjs";
import { requireIntegrityGuard } from "../../../services/supervisor/protected-integrity.mjs";
import { createHash } from "node:crypto";

const PEERS = new WeakSet();
export function isProtectedRemoteFrostPeer(value) { return PEERS.has(value); }

// No DKG secret, private-share export, arbitrary method dispatch or shell API.
export function nativeFrostIpcHandler(signer, integrity) {
  if (!(signer instanceof NativeFrostSigner)) throw new Error("IpcNativeSignerRequired");
  requireIntegrityGuard(integrity, signer.signerId);
  const context = signer.dkgContext();
  integrity.assertDeployment({ environment: "localnet", nativeGenesis: context.nativeGenesisHash,
    solanaDeployment: context.solanaDeployment, keyEpoch: context.keyEpoch });
  if (!signer.hasProtectedLifetimeFence()) throw new Error("IpcFencedSignerRequired");
  return async ({ method, operationId, payload, peerRole }) => {
    try {
    if (!signer.hasProtectedLifetimeFence()) throw new Error("IpcFencedSignerRequired");
    if (peerRole !== "COORDINATOR") throw new Error("IpcCoordinatorRequired");
    if (method !== "abortSigningSession") await integrity.assertRunning(operationId, "FROST_SIGN");
    if (method === "verifyNativeEvidence") {
      const intent = validateNativeSigningIntent(payload);
      if (operationId !== intent.operationId) throw new Error("IpcOperationBindingRejected");
      await signer.verifyNativeEvidence(intent);
      await integrity.assertRunning(operationId, "FROST_SIGN"); return { state: "NATIVE_EVIDENCE_CHECKED", operationId };
    }
    const request = validateNativeFrostSigningRequest(payload?.request);
    if (operationId !== request.intent.operationId) throw new Error("IpcOperationBindingRejected");
    if (method === "abortSigningSession") return signer.abortSigningSession(request);
    if (method !== "signingCommitment" && method !== "signatureShare") throw new Error("IpcNativeMethodRejected");
    // The initial coordinator verification may age while other services work.
    // Refresh each participant's own evidence at every secret-bearing action;
    // never extend/bypass the Native signer's existing freshness fence.
    await signer.verifyNativeEvidence(request.intent);
    await integrity.assertRunning(operationId, "FROST_SIGN");
    let result;
    if (method === "signingCommitment") result = signer.signingCommitment(request);
    else if (method === "signatureShare") result = signer.signatureShare(request, payload.commitments);
    else throw new Error("IpcNativeMethodRejected");
    await integrity.assertRunning(operationId, "FROST_SIGN"); return result;
    } catch (error) {
      if (["ProtectedSignerStateIntegrityRejected", "ProtectedSignerFenceRejected", "ProtectedStateRollbackDetected", "ProtectedLifetimeLeaseLost"].includes(error?.message)) {
        // Do not include private state or paths in the incident evidence digest.
        await integrity.report(operationId, "SIGNER_ROLLBACK", createHash("sha256").update(error.message).digest("hex"));
      }
      throw error;
    }
  };
}

export class ProtectedRemoteFrostPeer {
  #ipc; #port;
  constructor({ ipc, port, signerId }) {
    if (!isProtectedServiceIpc(ipc) || ipc.role !== "COORDINATOR" || ipc.peerRole !== signerId ||
        !["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"].includes(signerId)) throw new Error("IpcSignerBindingRejected");
    this.#ipc = ipc; this.#port = port;
    Object.defineProperty(this, "signerId", { value: signerId, enumerable: true }); PEERS.add(this); Object.freeze(this);
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
