// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Offline orchestration of the retained FROST DKG. Each child alone opens its
// protected participant state. No complete private share reaches this process.
import { fork } from "node:child_process";
import { canonicalJson, createMainnetNativeDkgPolicy, REQUIRED_FROST_SIGNERS } from "../policy/native-signing-policy.mjs";
import { createTwoPartyDkgRequest, nativeFrostKeyContext } from "../policy/dkg-request.mjs";

function participant() {
  const child = fork(new URL("../signer/mainnet-preparation-actor.mjs", import.meta.url), [], {
    env: { ...process.env, KINGPEPE_MAINNET_PREPARE_ACTOR: "1" }, windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const pending = new Map(); let next = 1, failed = false;
  const failure = () => { failed = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error("MainnetPreparationChildUnavailable")); } pending.clear(); };
  child.on("error", failure); child.on("exit", failure); child.stderr.on("data", failure);
  child.on("message", message => {
    const request = pending.get(message?.id); if (!request) return failure();
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.reject(new Error("MainnetPreparationChildRejected")); else request.resolve(message.result);
  });
  const call = (method, value) => new Promise((resolve, reject) => {
    if (failed || !child.connected) return reject(new Error("MainnetPreparationChildUnavailable"));
    const id = next++, timer = setTimeout(() => { failure(); child.kill(); }, 30_000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, method, value }, error => { if (error) failure(); });
  });
  return { pid: child.pid, call, async close() {
    try { if (!failed && child.connected) await call("CLOSE", null); }
    finally { if (child.connected) child.disconnect(); if (failed) child.kill(); }
  } };
}

export async function prepareMainnetFrostParticipants({ policy, participantStates }) {
  if (process.platform !== "win32") throw new Error("WindowsProtectedStorageRequired");
  const expected = nativeFrostKeyContext(createMainnetNativeDkgPolicy(policy));
  if (!Array.isArray(participantStates) || participantStates.length !== 2 || participantStates[0].root === participantStates[1].root ||
      participantStates.some((p, n) => p.context.role !== REQUIRED_FROST_SIGNERS[n] || p.context.purpose !== "frost-state"))
    throw new Error("MainnetPreparationDistinctParticipantsRequired");
  const actors = [];
  try {
    for (const [n, stateOptions] of participantStates.entries()) {
      const actor = participant(); actors.push(actor);
      const context = await actor.call("INIT", { policy, stateOptions });
      if (canonicalJson(context) !== canonicalJson(expected)) throw new Error("MainnetPreparationContextMismatch");
      if (n && actor.pid === actors[0].pid) throw new Error("MainnetPreparationProcessSeparationRequired");
    }
    const request = createTwoPartyDkgRequest({ epoch: expected.keyEpoch, context: expected });
    const phases = await Promise.all(actors.map(a => a.call("PHASE", request)));
    if (phases.some(p => !["NOT_STARTED", "ROUND1", "ROUND2", "STAGED", "FINALIZED"].includes(p))) throw new Error("MainnetPreparationPhaseRejected");
    const ready = phases.every(p => ["STAGED", "FINALIZED"].includes(p));
    if (phases.includes("FINALIZED") && !ready) throw new Error("MainnetPreparationIncompleteHandoff");
    if (!ready) {
      const round1 = await Promise.all(actors.map(a => a.call("ROUND1", request)));
      const round2 = await Promise.all(actors.map(a => a.call("ROUND2", { request, round1 })));
      for (const [n, actor] of actors.entries()) await actor.call("STAGE", { request, round1,
        incoming: [{ senderId: REQUIRED_FROST_SIGNERS[1-n], round2: round2[1-n][REQUIRED_FROST_SIGNERS[n]] }] });
    }
    const results = await Promise.all(actors.map(a => a.call("COMPLETE", request)));
    if (canonicalJson(results[0].publicPackage) !== canonicalJson(results[1].publicPackage) ||
        results[0].publicPackageHash !== results[1].publicPackageHash ||
        results[0].aggregateTweakedXOnlyPublicKey !== results[1].aggregateTweakedXOnlyPublicKey)
      throw new Error("MainnetPreparationPublicPackageMismatch");
    return Object.freeze({ state: "PREPARED_NOT_ACTIVATED", signerTopology: "SINGLE_HOST", threshold: 2, participants: 2,
      separateProcesses: actors[0].pid !== actors[1].pid, publicPackage: results[0].publicPackage,
      publicPackageHash: results[0].publicPackageHash, aggregateTweakedXOnlyPublicKey: results[0].aggregateTweakedXOnlyPublicKey,
      productionSigningAuthorized: false, productionBroadcastAuthorized: false });
  } finally {
    const closed = await Promise.allSettled(actors.map(actor => actor.close()));
    if (closed.some(result => result.status === "rejected")) throw new Error("MainnetPreparationChildCloseFailed");
  }
}
