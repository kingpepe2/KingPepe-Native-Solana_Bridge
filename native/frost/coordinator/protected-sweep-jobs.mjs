// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Persist-before-ack dispatch. The worker uses the existing exact A+B signing
// journal; a request timeout never means approval or a completed signature.
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { assertWindowsProtectedStore } from "../../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../../../services/supervisor/protected-integrity.mjs";
import { validateDepositOperationPolicy, depositOperationPolicyDigest } from "../../../services/bridge-validator/deposit-operation-state.mjs";
import { NativeFrostCoordinator } from "./native-frost-coordinator.mjs";
import { requireCoordinatorSigningJournal } from "./protected-signing-journal.mjs";
import { isProtectedRemoteFrostPeer } from "../signer/protected-service.mjs";
import { validateSweepJobIntent, sweepJobId, decodeSweepJobState, MAX_SWEEP_JOBS, MAX_SWEEP_JOB_ATTEMPTS } from "./sweep-job-state.mjs";

const SERVICES = new WeakSet();
const check = (value, code = "SweepJobUnavailable") => { if (!value) throw new Error(code); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export class ProtectedSweepJobs {
  #store; #guard; #policy; #key; #signers; #signingJournal; #lease; #revision; #pending; #busy = false; #running = false; #closed = false; #stopped = false;
  static async open({ store, integrity, policy, publicPackage, aggregateTweakedXOnlyPublicKey, signers, signingJournal }) {
    assertWindowsProtectedStore(store, "COORDINATOR", "coordinator-jobs"); requireIntegrityGuard(integrity, "COORDINATOR");
    const self = new ProtectedSweepJobs(); self.#policy = validateDepositOperationPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = self.#policy;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => store.context[k] === v));
    check(aggregateTweakedXOnlyPublicKey === self.#policy.frostPublicKeyHex);
    self.#key = structuredClone({ publicPackage, aggregateTweakedXOnlyPublicKey });
    requireCoordinatorSigningJournal(signingJournal, self.#key, integrity);
    check(Array.isArray(signers) && signers.length === 2 && signers.every(isProtectedRemoteFrostPeer) &&
      signers[0].signerId === "KINGPEPE_FROST_A" && signers[1].signerId === "KINGPEPE_FROST_B");
    self.#signers = [...signers]; self.#signingJournal = signingJournal; self.#store = store; self.#guard = integrity;
    try { self.#lease = await store.acquireLifetimeLease(); self.#read(); SERVICES.add(self); return self; }
    catch (error) { try { await self.#report(error); } finally { await self.close(); } throw new Error("SweepJobUnavailable"); }
  }
  assertBinding(policy, integrity) {
    check(!this.#closed && !this.#stopped && integrity === this.#guard && depositOperationPolicyDigest(policy) === depositOperationPolicyDigest(this.#policy));
    this.#lease.assertHeld(); requireCoordinatorSigningJournal(this.#signingJournal, this.#key, this.#guard);
  }
  #read() {
    check(!this.#closed && !this.#stopped); this.#lease.assertHeld(); const read = this.#store.read();
    try {
      const state = decodeSweepJobState(read.payload, this.#policy);
      this.#signingJournal.assertRetainedResults(state.jobs.filter(job => job.completed).map(job => job.intent));
      if (this.#revision !== undefined && read.revision !== this.#revision) check(this.#pending &&
        BigInt(read.revision) === BigInt(this.#revision) + 1n && hash(read.payload) === this.#pending);
      this.#revision = read.revision; this.#pending = undefined; return { state, revision: read.revision };
    } catch { const error = new Error("SweepJobAuthenticatedStateInvalid"); error.evidenceDigest = hash(read.payload); throw error; }
    finally { read.payload.fill(0); }
  }
  #write(state, revision) {
    const now = Date.now(); check(now >= state.lastTimeMs, "SweepJobAuthenticatedStateInvalid");
    state.lastTimeMs = now; const bytes = Buffer.from(JSON.stringify(state));
    try { decodeSweepJobState(bytes, this.#policy); this.#lease.assertHeld(); this.#pending = hash(bytes);
      this.#revision = this.#store.write(bytes, revision).revision; this.#pending = undefined;
    } finally { bytes.fill(0); }
  }
  async #report(error) {
    if (!["ProtectedStateRollbackDetected", "ProtectedLifetimeLeaseLost", "SweepJobAuthenticatedStateInvalid"].includes(error?.message)) return;
    this.#stopped = true;
    await this.#guard.report(depositOperationPolicyDigest(this.#policy), "COORDINATOR_JOURNAL_INTEGRITY", error.evidenceDigest ?? hash(error.message));
  }
  async #exclusive(action) {
    this.assertBinding(this.#policy, this.#guard); check(!this.#busy, "SweepJobBusy"); this.#busy = true;
    try { return await action(); }
    catch (error) {
      try { if (this.#pending) this.#read(); } catch (readError) { await this.#report(readError); throw readError; }
      await this.#report(error); throw error;
    } finally { this.#busy = false; }
  }
  #find(state, intent) {
    const id = sweepJobId(intent, this.#policy), found = state.jobs.find(j => j.jobId === id);
    check(!state.jobs.some(j => j.intent.signingRequestId === intent.signingRequestId && j.jobId !== id), "SweepJobRequestChanged"); return found;
  }
  async enqueue(input) {
    const intent = validateSweepJobIntent(input, this.#policy);
    return this.#exclusive(async () => {
      await this.#guard.assertRunning(intent.operationId, "COORDINATE_SWEEP");
      const { state, revision } = this.#read(); let found = this.#find(state, intent);
      if (!found) {
        check(state.jobs.length < MAX_SWEEP_JOBS, "SweepJobCapacity");
        found = { jobId: sweepJobId(intent, this.#policy), intent, attempts: 0, lastAttemptAt: 0, retryAfter: 0, completed: false };
        state.jobs.push(found); this.#write(state, revision);
      }
      // The response only confirms durable receipt, NEVER a signing result.
      return Object.freeze({ state: "ACCEPTED", jobId: found.jobId });
    });
  }
  async status(input) {
    const intent = validateSweepJobIntent(input, this.#policy);
    return this.#exclusive(async () => {
      const { state } = this.#read(), found = this.#find(state, intent); check(found, "SweepJobMissing");
      // Even a previously created aggregate is released only under current
      // admission. The old journal independently revalidates the signature.
      await this.#guard.assertRunning(intent.operationId, "COORDINATE_SWEEP");
      const signed = this.#signingJournal.lookup(intent);
      if (signed?.state === "SIGNED") return Object.freeze({ state: "SIGNED", jobId: found.jobId, result: signed.result });
      check(!found.completed, "SweepJobAuthenticatedStateInvalid");
      return Object.freeze({ state: found.attempts >= MAX_SWEEP_JOB_ATTEMPTS ? "QUEUED_BY_LIMIT" : "WAITING_FOR_DEPENDENCY", jobId: found.jobId });
    });
  }
  async runOne() {
    check(!this.#running && !this.#closed, "SweepJobBusy"); this.#running = true;
    let selected;
    try {
      selected = await this.#exclusive(async () => {
        const { state, revision } = this.#read();
        const job = state.jobs.find(j => !j.completed && j.attempts < MAX_SWEEP_JOB_ATTEMPTS && j.retryAfter <= Date.now());
        if (!job) return null;
        await this.#guard.assertRunning(job.intent.operationId, "COORDINATE_SWEEP");
        // No other queue mutation can occur inside this critical section.
        job.attempts++; job.lastAttemptAt = Date.now(); job.retryAfter = job.lastAttemptAt + Math.min(30000, 1000 * 2 ** job.attempts);
        this.#write(state, revision); return structuredClone(job);
      });
      if (!selected) return Object.freeze({ state: "WAITING_FOR_DEPENDENCY" });
      // A fresh coordinator first resolves its durable previous attempt. It
      // cannot reset the journal or clear the authoritative integrity state.
      const coordinator = new NativeFrostCoordinator({ ...this.#key, signers: this.#signers, integrity: this.#guard, signingJournal: this.#signingJournal });
      await coordinator.signAutomaticallyOverIpc(selected.intent);
      await this.#exclusive(() => {
        const { state, revision } = this.#read(), job = this.#find(state, selected.intent);
        check(job && job.attempts === selected.attempts);
        this.#signingJournal.retainedResult(job.intent); job.completed = true; this.#write(state, revision);
      });
      return Object.freeze({ state: "SIGNED", jobId: selected.jobId });
    } catch (error) {
      await this.#report(error);
      // Exact bytes/attempt identity remain in their respective protected
      // journals. Unavailability is a bounded wait, never fabricated success.
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "WAITING_FOR_DEPENDENCY", reason: "SWEEP_JOB_UNAVAILABLE" });
    } finally { this.#running = false; }
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 30000);
    while (!signal.aborted && !this.#closed) { await onStatus(await this.runOne());
      try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("SweepJobInterrupted"); } }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
export function requireProtectedSweepJobs(jobs, policy, integrity) {
  check(SERVICES.has(jobs), "ProtectedSweepJobsRequired"); jobs.assertBinding(policy, integrity);
}
