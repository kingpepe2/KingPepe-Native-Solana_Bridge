// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { bridgeInputDigest } from "../../../shared/protocol/bridge-inputs.mjs";
import { schnorr, schnorr_FROST } from "@noble/curves/secp256k1.js";
import { assertWindowsProtectedStore } from "../../../shared/windows/protected-store.mjs";
import { requireIntegrityGuard } from "../../../services/supervisor/protected-integrity.mjs";
import { REQUIRED_FROST_SIGNERS, assertHashHex, canonicalJson, nativeSigningIntentDigest,
  validateNativeSigningIntent } from "../policy/native-signing-policy.mjs";
import { createNativeFrostSigningRequest, validateNativeFrostSigningRequest, validateNativeFrostAbortReceipt } from "../policy/signing-request.mjs";

export const COORDINATOR_JOURNAL_PROTOCOL = "KINGPEPE_COORDINATOR_SIGNING_V1";
export const MAX_COORDINATOR_REQUESTS = 256; // Never prune consumed signing identities.
const MAX_BYTES = 900_000, JOURNALS = new WeakSet();
const BRIDGE_PURPOSES = new Set(["RESERVE_SWEEP", "WITHDRAWAL"]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function check(ok, code = "CoordinatorJournalInvalid") { if (!ok) throw new Error(code); }
function fields(v, names) {
  check(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
}
function identity(key) {
  assertHashHex(key.aggregateTweakedXOnlyPublicKey, "aggregate key");
  fields(key.publicPackage, ["signers", "commitmentsHex", "verifyingSharesHex"]);
  fields(key.publicPackage.signers, ["min", "max"]);
  check(key.publicPackage.signers.min === 2 && key.publicPackage.signers.max === 2);
  check(Array.isArray(key.publicPackage.commitmentsHex) && key.publicPackage.commitmentsHex.length === 2 &&
    key.publicPackage.commitmentsHex.every(p => typeof p === "string" && /^(02|03)[0-9a-f]{64}$/u.test(p)));
  fields(key.publicPackage.verifyingSharesHex, [1, 2].map(n => schnorr_FROST.Identifier.fromNumber(n)));
  check(Object.values(key.publicPackage.verifyingSharesHex).every(p => typeof p === "string" && /^(02|03)[0-9a-f]{64}$/u.test(p)));
  return bridgeInputDigest("CoordinatorKey", { protocol: COORDINATOR_JOURNAL_PROTOCOL, publicPackage: key.publicPackage, aggregateTweakedXOnlyPublicKey: key.aggregateTweakedXOnlyPublicKey });
}
function validateResult(result, request, key) {
  fields(result, ["state", "requestId", "epoch", "sessionId", "intentDigest", "messageHex", "signatureHex",
    "aggregateTweakedXOnlyPublicKey", "signerIds", "participantIdentifiers"]);
  check(result.state === "SIGNED" && result.aggregateTweakedXOnlyPublicKey === key.aggregateTweakedXOnlyPublicKey);
  for (const name of ["requestId", "epoch", "sessionId", "intentDigest", "messageHex"]) check(result[name] === request[name]);
  check(canonicalJson(result.signerIds) === canonicalJson(REQUIRED_FROST_SIGNERS));
  check(canonicalJson(result.participantIdentifiers) === canonicalJson([1, 2].map(n => schnorr_FROST.Identifier.fromNumber(n))));
  check(typeof result.signatureHex === "string" && /^[0-9a-f]{128}$/u.test(result.signatureHex));
  const sig = Buffer.from(result.signatureHex, "hex"), msg = Buffer.from(request.messageHex, "hex"), pub = Buffer.from(key.aggregateTweakedXOnlyPublicKey, "hex");
  check(schnorr_FROST.verify(sig, msg, pub) && schnorr.verify(sig, msg, pub));
}

export function initialCoordinatorSigningState(key) {
  return Buffer.from(JSON.stringify({ protocol: COORDINATOR_JOURNAL_PROTOCOL, identityDigest: identity(key), records: [] }));
}

// Storage codec, not chain verification. Only public signing transcripts and
// aggregate results are retained here: never private shares or secret nonces.
export function decodeCoordinatorSigningState(bytes, key) {
  check(bytes instanceof Uint8Array && bytes.length <= MAX_BYTES);
  const text = Buffer.from(bytes).toString("utf8"), v = JSON.parse(text);
  check(JSON.stringify(v) === text); // Duplicate keys/alternate persisted encoding fail closed.
  fields(v, ["protocol", "identityDigest", "records"]);
  check(v.protocol === COORDINATOR_JOURNAL_PROTOCOL && v.identityDigest === identity(key));
  check(Array.isArray(v.records) && v.records.length <= MAX_COORDINATOR_REQUESTS);
  const ids = new Set(), inputs = new Set();
  for (const r of v.records) {
    fields(r, ["request", "state", "abortReceipts", "result"]);
    const request = validateNativeFrostSigningRequest(r.request);
    check(!ids.has(request.requestId)); ids.add(request.requestId);
    const input = request.intent.purpose + ":" + request.intent.operationId + ":" + request.intent.signingInputIndex;
    check(!inputs.has(input)); inputs.add(input);
    check(["PREPARED", "ABORTED", "SIGNED"].includes(r.state));
    if (r.state === "ABORTED") {
      check(Array.isArray(r.abortReceipts) && r.abortReceipts.length === 2);
      REQUIRED_FROST_SIGNERS.forEach((id, index) => validateNativeFrostAbortReceipt(r.abortReceipts[index], request, id));
    } else check(r.abortReceipts === null);
    if (r.state === "SIGNED") validateResult(r.result, request, key);
    else check(r.result === null);
  }
  return v;
}

export class ProtectedCoordinatorSigningJournal {
  #key; #guard; #store; #lease; #revision; #pendingWrite; #closed = false; #busy = false; #stopped = false;
  static async open({ store, integrity, publicPackage, aggregateTweakedXOnlyPublicKey }) {
    assertWindowsProtectedStore(store, "COORDINATOR", "coordinator-signing");
    requireIntegrityGuard(integrity, "COORDINATOR");
    check(store.context.environment === "localnet", "ProtectedCoordinatorLocalOnly");
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = store.context;
    integrity.assertDeployment({ environment, nativeGenesis, solanaDeployment, keyEpoch });
    const self = new ProtectedCoordinatorSigningJournal();
    self.#key = structuredClone({ publicPackage, aggregateTweakedXOnlyPublicKey });
    self.#guard = integrity; self.#store = store;
    try {
      self.#lease = await store.acquireLease(); self.#read();
      JOURNALS.add(self); return self;
    } catch (error) {
      try { await self.#reportStorageError(error); } finally { await self.close(); }
      throw new Error("CoordinatorJournalUnavailable");
    }
  }
  assertBinding(key, integrity) {
    check(!this.#closed && !this.#stopped && identity(key) === identity(this.#key) && integrity === this.#guard, "CoordinatorJournalUnavailable");
    this.#lease.assertHeld();
  }
  #read() {
    check(!this.#closed && !this.#stopped, "CoordinatorJournalUnavailable"); this.#lease.assertHeld();
    const read = this.#store.read();
    try {
      const value = decodeCoordinatorSigningState(read.payload, this.#key), context = this.#store.context;
      for (const { request } of value.records) check(request.intent.nativeNetwork === "regtest" && BRIDGE_PURPOSES.has(request.intent.purpose) &&
        request.intent.nativeGenesisHash === context.nativeGenesis && request.intent.solanaDeployment === context.solanaDeployment && request.epoch === context.keyEpoch);
      // Accept only our exact uncertain CAS completion, never an unrelated
      // concurrent write merely because its DPAPI authentication is valid.
      if (this.#revision !== undefined && read.revision !== this.#revision) {
        check(this.#pendingWrite && BigInt(read.revision) === BigInt(this.#revision) + 1n && digest(read.payload) === this.#pendingWrite,
          "CoordinatorJournalConcurrentMutation");
      }
      this.#revision = read.revision; this.#pendingWrite = undefined;
      return { value, revision: read.revision };
    } catch { const error = new Error("CoordinatorJournalAuthenticatedStateInvalid"); error.evidenceDigest = digest(read.payload); throw error; }
    finally { read.payload.fill(0); }
  }
  #write(value, revision) {
    const bytes = Buffer.from(JSON.stringify(value));
    try {
      decodeCoordinatorSigningState(bytes, this.#key); this.#lease.assertHeld();
      this.#pendingWrite = digest(bytes);
      this.#revision = this.#store.write(bytes, revision).revision; this.#pendingWrite = undefined;
    }
    finally { bytes.fill(0); }
  }
  async #reportStorageError(error) {
    if (!["ProtectedStateRollbackDetected", "CoordinatorJournalAuthenticatedStateInvalid"].includes(error?.message)) return;
    this.#stopped = true;
    await this.#guard.report(identity(this.#key), "COORDINATOR_JOURNAL_INTEGRITY", error.evidenceDigest ?? digest(error.message));
  }
  async runExclusive(action) {
    this.assertBinding(this.#key, this.#guard);
    check(!this.#busy, "CoordinatorJournalBusy"); this.#busy = true;
    try { return await action(); }
    catch (error) { await this.#reportStorageError(error); throw error; }
    finally { this.#busy = false; }
  }
  #intent(intent) {
    const snapshot = validateNativeSigningIntent(intent), context = this.#store.context;
    check(BRIDGE_PURPOSES.has(snapshot.purpose) && snapshot.nativeNetwork === "regtest" && snapshot.nativeGenesisHash === context.nativeGenesis &&
      snapshot.solanaDeployment === context.solanaDeployment && snapshot.keyEpoch === context.keyEpoch, "CoordinatorJournalContextMismatch");
    return snapshot;
  }
  #record(value, intent) {
    const snapshot = this.#intent(intent), record = value.records.find(r => r.request.requestId === snapshot.signingRequestId);
    const reused = value.records.find(r => r.request.intent.purpose === snapshot.purpose && r.request.intent.operationId === snapshot.operationId && r.request.intent.signingInputIndex === snapshot.signingInputIndex);
    check(!reused || reused === record, "CoordinatorJournalInputAlreadyBound");
    if (record) check(record.request.intentDigest === nativeSigningIntentDigest(snapshot), "CoordinatorJournalRequestChanged");
    return record;
  }
  lookup(intent) {
    const { value } = this.#read(); return structuredClone(this.#record(value, intent) ?? null);
  }
  retainedResult(intent) {
    const record = this.lookup(intent); check(record?.state === "SIGNED", "CoordinatorJournalResultUnavailable"); return record.result;
  }
  assertRetainedResults(intents) {
    check(Array.isArray(intents) && intents.length <= MAX_COORDINATOR_REQUESTS, "CoordinatorJournalInvalid");
    if (intents.length === 0) return;
    // One fully validated protected image, not one OS round trip per job.
    const { value } = this.#read();
    for (const intent of intents) check(this.#record(value, intent)?.state === "SIGNED", "CoordinatorJournalResultUnavailable");
  }
  prepare(intent) {
    check(this.#busy, "CoordinatorJournalExclusiveRequired");
    const { value, revision } = this.#read(), previous = this.#record(value, intent);
    check(!previous || previous.state === "ABORTED", "CoordinatorJournalRecoveryRequired");
    check(previous || value.records.length < MAX_COORDINATOR_REQUESTS, "CoordinatorJournalCapacity");
    const request = createNativeFrostSigningRequest(this.#intent(intent), { attempt: previous ? previous.request.attempt + 1 : 1 });
    const next = { request, state: "PREPARED", abortReceipts: null, result: null };
    if (previous) value.records[value.records.indexOf(previous)] = next; else value.records.push(next);
    this.#write(value, revision); return request; // Durable BEFORE either commitment.
  }
  #transition(request, update) {
    check(this.#busy, "CoordinatorJournalExclusiveRequired");
    const { value, revision } = this.#read(), record = this.#record(value, request.intent);
    check(record && canonicalJson(record.request) === canonicalJson(request) && record.state === "PREPARED", "CoordinatorJournalTransitionRejected");
    Object.assign(record, update); this.#write(value, revision);
  }
  markAborted(request, receipts) {
    this.#transition(request, { state: "ABORTED", abortReceipts: structuredClone(receipts), result: null });
  }
  markSigned(request, result) {
    this.#transition(request, { state: "SIGNED", abortReceipts: null, result: structuredClone(result) });
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}

export function requireCoordinatorSigningJournal(journal, key, integrity) {
  check(JOURNALS.has(journal), "ProtectedCoordinatorJournalRequired"); journal.assertBinding(key, integrity);
}
