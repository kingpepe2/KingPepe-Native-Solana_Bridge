// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { NativeFrostSigner } from "./native-frost-signer.mjs";
import { validateNativeSigningIntent } from "../policy/native-signing-policy.mjs";
import { validateNativeFrostSigningRequest } from "../policy/signing-request.mjs";
import { isProtectedServiceIpc } from "../../../shared/windows/service-ipc.mjs";
import { requireIntegrityGuard } from "../../../services/supervisor/protected-integrity.mjs";
import { createHash } from "node:crypto";
import { WindowsProtectedFrostStateStore } from "../state/windows-protected-state-store.mjs";
import { WindowsFencedFrostStateStore } from "../state/windows-fenced-state-store.mjs";
import { assertWindowsProtectedStore } from "../../../shared/windows/protected-store.mjs";

const PEERS = new WeakSet();
export function isProtectedRemoteFrostPeer(value) { return PEERS.has(value); }

// The request handler cannot report a failure that precedes handler creation.
// This runtime entry point binds the authenticated role/domain first, opens only
// existing protected material, then reports confirmed startup integrity faults
// through the same durable incident outbox used by running signers.
export async function openProtectedNativeSigner({ base, fence, policy, integrity, nativeEvidenceValidator }) {
  if (!(base instanceof WindowsProtectedFrostStateStore) || typeof nativeEvidenceValidator !== "function")
    throw new Error("ProtectedSignerStartupBindingRejected");
  const c = base.context, role = c.role;
  assertWindowsProtectedStore(fence, role, "signer-fence"); base.assertPolicy(policy);
  requireIntegrityGuard(integrity, role);
  integrity.assertDeployment({ environment: c.environment, nativeGenesis: c.nativeGenesis,
    solanaDeployment: c.solanaDeployment, keyEpoch: c.keyEpoch });
  if (c.environment !== "localnet" || ["role", "serviceSid", "environment", "nativeGenesis", "solanaDeployment", "instanceId", "keyEpoch"]
    .some(key => c[key] !== fence.context[key])) throw new Error("ProtectedSignerStartupBindingRejected");
  // Public domain/instance digest, never secret state or a private filesystem path.
  const operationId = createHash("sha256").update(JSON.stringify(["KINGPEPE_SIGNER_STARTUP_V1", role,
    c.instanceId, c.environment, c.nativeGenesis, c.solanaDeployment, c.keyEpoch])).digest("hex");
  let state, signer;
  try {
    state = await WindowsFencedFrostStateStore.openLocal({ base, fence, policy });
    signer = new NativeFrostSigner({ signerId: role, index: role === "KINGPEPE_FROST_A" ? 0 : 1,
      policy, stateStore: state, nativeEvidenceValidator });
    const handler = nativeFrostIpcHandler(signer, integrity);
    return Object.freeze({ signer, handler, async close() { signer.close(); await state.close(); } });
  } catch (error) {
    const rollback = error?.message === "ProtectedStateRollbackDetected";
    const corrupt = ["ProtectedSignerFenceRejected", "ProtectedFrostStateInvalid",
      "FrostStateDeploymentMismatch", "FrostNonceRecoveryStateInvalid"].includes(error?.message);
    try {
      if (rollback || corrupt) await integrity.report(operationId, rollback ? "SIGNER_ROLLBACK" : "SIGNER_STATE_CORRUPT",
        createHash("sha256").update(error.message).digest("hex"));
    } finally {
      signer?.close();
      try { if (state) await state.close(); else { base.close(); fence.close(); } }
      finally { throw new Error("ProtectedSignerStartupRejected"); }
    }
  }
}

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
    // Independent evidence verification is read-only. Authorize immediately
    // after it, before any nonce/share mutation, and again before release.
    // A redundant pre-read round trip must not consume the bounded signing
    // response window; no signing guard or transport deadline is removed.
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
