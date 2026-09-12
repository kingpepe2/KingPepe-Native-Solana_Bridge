// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { ProjectAttester, verifyProjectAttestation } from "./attestation-service.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";

export const ATTESTER_JOURNAL_PROTOCOL = "KINGPEPE_ATTESTER_AUTHORIZATIONS_V1";
export const MAX_ATTESTER_AUTHORIZATIONS = 256; // Bounded local enrollment; never prune replay markers.
const MAX_BYTES = 900_000, HASH = /^[0-9a-f]{64}$/u, JOURNALS = new WeakSet();
const digest = value => createHash("sha256").update(value).digest("hex");
function check(ok, code = "AttesterJournalInvalid") { if (!ok) throw new Error(code); }
function fields(v, names) {
  check(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
}
function identity(attester) {
  check(attester instanceof ProjectAttester);
  return digest(JSON.stringify([ATTESTER_JOURNAL_PROTOCOL, attester.role, attester.publicKeyHex, attester.policy]));
}
function message(encoded, policy) {
  check(typeof encoded === "string" && encoded.length <= 8192 && /^(?:[0-9a-f]{2})+$/u.test(encoded));
  const m = decodeCanonicalBridgeMessage(encoded);
  check(m.action === "DepositClaim" && m.direction === "NativeToSolana" && m.keyEpoch === policy.keyEpoch && m.policyEpoch === policy.policyEpoch);
  check(m.deployment.protocolId === policy.protocolId && m.deployment.nativeNetwork === policy.nativeNetwork);
  for (const [name, pin] of [["nativeGenesis", "nativeGenesisHex"], ["solanaDeployment", "solanaDeploymentHex"],
    ["managerProgramId", "managerProgramIdHex"], ["transceiverProgramId", "transceiverProgramIdHex"], ["mint", "mintHex"]]) {
    check(Buffer.from(m.deployment[name]).toString("hex") === policy[pin]);
  }
  return m;
}
function signature(value, encoded, attester) {
  fields(value, ["protocol", "mode", "role", "keyEpoch", "policyEpoch", "attesterPublicKeyHex", "messageDigestHex", "operationIdHex", "signedBytes", "signatureHex", "state"]);
  check(value.role === attester.role && value.attesterPublicKeyHex === attester.publicKeyHex && value.state === "VERIFIED_READY" &&
    value.signedBytes === "CANONICAL_BRIDGE_MESSAGE_V1" && typeof value.signatureHex === "string" && /^[0-9a-f]{128}$/u.test(value.signatureHex));
  check(verifyProjectAttestation(value, encoded));
}

// This codec validates retained bindings, NOT Native evidence or live permission.
// JSON is only the protected storage envelope; signatures authorize canonical bytes.
export function decodeAttesterAuthorizationState(bytes, attester) {
  check(bytes instanceof Uint8Array && bytes.length <= MAX_BYTES);
  const text = Buffer.from(bytes).toString("utf8"), v = JSON.parse(text);
  check(JSON.stringify(v) === text); // Reject duplicate keys/noncanonical persisted images.
  fields(v, ["protocol", "identityDigest", "records", "incident"]);
  check(v.protocol === ATTESTER_JOURNAL_PROTOCOL && v.identityDigest === identity(attester));
  check(Array.isArray(v.records) && v.records.length <= MAX_ATTESTER_AUTHORIZATIONS);
  const operations = new Set(), deposits = new Set(), allocations = new Set();
  for (const r of v.records) {
    fields(r, ["operationIdHex", "depositOutpoint", "reserveAllocationIdHex", "encodedMessageHex", "signature"]);
    const m = message(r.encodedMessageHex, attester.policy);
    check(r.operationIdHex === m.operationIdHex && r.depositOutpoint === m.depositOutpointText && typeof r.reserveAllocationIdHex === "string" && HASH.test(r.reserveAllocationIdHex));
    check(!operations.has(r.operationIdHex) && !deposits.has(r.depositOutpoint) && !allocations.has(r.reserveAllocationIdHex));
    operations.add(r.operationIdHex); deposits.add(r.depositOutpoint); allocations.add(r.reserveAllocationIdHex);
    if (r.signature !== null) signature(r.signature, r.encodedMessageHex, attester);
  }
  if (v.incident !== null) {
    fields(v.incident, ["code", "operationId", "evidenceDigest"]);
    check(v.incident.code === "CONFLICTING_RESERVE_EVIDENCE" && HASH.test(v.incident.operationId) && HASH.test(v.incident.evidenceDigest));
  }
  return v;
}

export class ProtectedAttesterAuthorizationJournal {
  #attester; #guard; #store; #lease; #closed = false; #busy = false; #stopped = false;
  static initialState(attester) {
    attester.assertProtectedStorage();
    return Buffer.from(JSON.stringify({ protocol: ATTESTER_JOURNAL_PROTOCOL, identityDigest: identity(attester), records: [], incident: null }));
  }
  static async open({ attester, integrity, store }) {
    check(attester instanceof ProjectAttester);
    const context = attester.assertProtectedStorage();
    assertWindowsProtectedStore(store, attester.role, "attester-authorizations");
    requireIntegrityGuard(integrity, attester.role);
    check(context.environment === "localnet", "ProtectedAttesterLocalOnly");
    for (const name of ["role", "serviceSid", "environment", "nativeGenesis", "solanaDeployment", "instanceId", "keyEpoch"]) {
      check(context[name] === store.context[name], "AttesterJournalContextMismatch");
    }
    integrity.assertDeployment({ environment: context.environment, nativeGenesis: context.nativeGenesis, solanaDeployment: context.solanaDeployment, keyEpoch: context.keyEpoch });
    const self = new ProtectedAttesterAuthorizationJournal();
    self.#attester = attester; self.#guard = integrity; self.#store = store;
    try {
      self.#lease = await store.acquireLease();
      const { value } = self.#read();
      if (value.incident !== null) { self.#stopped = true; await self.#report(value.incident); throw new Error("AttesterJournalStopped"); }
      JOURNALS.add(self); return self;
    } catch (error) {
      try { await self.#reportStorageError(error); } finally { await self.close(); }
      throw new Error("AttesterJournalUnavailable");
    }
  }
  assertBinding(attester, integrity) {
    check(!this.#closed && !this.#stopped && this.#attester === attester && this.#guard === integrity, "AttesterJournalUnavailable");
    this.#lease.assertHeld();
  }
  #read() {
    check(!this.#closed, "AttesterJournalUnavailable"); this.#lease.assertHeld();
    const r = this.#store.read();
    try { return { value: decodeAttesterAuthorizationState(r.payload, this.#attester), revision: r.revision }; }
    catch { const e = new Error("AttesterJournalAuthenticatedStateInvalid"); e.evidenceDigest = digest(r.payload); throw e; }
    finally { r.payload.fill(0); }
  }
  #write(value, revision) {
    const bytes = Buffer.from(JSON.stringify(value));
    try {
      decodeAttesterAuthorizationState(bytes, this.#attester); this.#lease.assertHeld();
      return this.#store.write(bytes, revision).revision;
    } finally { bytes.fill(0); }
  }
  async #report(incident) {
    await this.#guard.report(incident.operationId, incident.code, incident.evidenceDigest);
  }
  async #reportStorageError(error) {
    if (!["ProtectedStateRollbackDetected", "AttesterJournalAuthenticatedStateInvalid", "AttesterJournalConcurrentMutation", "ProtectedAttesterStateChanged"].includes(error?.message)) return;
    this.#stopped = true;
    await this.#report({ operationId: identity(this.#attester), code: "ATTESTER_JOURNAL_INTEGRITY",
      evidenceDigest: error.evidenceDigest ?? digest(error.message) });
  }
  async authorize(verifiedRequest) {
    this.assertBinding(this.#attester, this.#guard);
    check(!this.#busy, "AttesterJournalBusy"); this.#busy = true;
    try {
      const request = structuredClone(verifiedRequest), m = message(request.encodedMessageHex, this.#attester.policy);
      await this.#guard.assertRunning(m.operationIdHex, "ATTEST_MINT_CREDIT");
      this.#attester.assertProtectedStorage();
      check(this.#attester.evaluateDepositCredit(request).state === "VERIFIED_READY", "AttesterJournalPolicyRejected");
      const allocation = request.evidence.reserveAllocationIdHex;
      check(typeof allocation === "string" && HASH.test(allocation));
      let { value, revision } = this.#read();
      if (value.incident !== null) { this.#stopped = true; await this.#report(value.incident); throw new Error("AttesterJournalStopped"); }
      const related = value.records.filter(r => r.operationIdHex === m.operationIdHex || r.depositOutpoint === m.depositOutpointText || r.reserveAllocationIdHex === allocation);
      let record = related[0];
      if (related.length > 1 || (record && (record.encodedMessageHex !== request.encodedMessageHex || record.reserveAllocationIdHex !== allocation))) {
        this.#stopped = true;
        value.incident = { code: "CONFLICTING_RESERVE_EVIDENCE", operationId: m.operationIdHex,
          evidenceDigest: digest(JSON.stringify([related, request.encodedMessageHex, allocation])) };
        // A failed local write still attempts the durable GLOBAL report. Neither
        // failure acknowledges success or releases a signature.
        try { this.#write(value, revision); } finally { await this.#report(value.incident); }
        throw new Error("AttesterJournalConflict");
      }
      if (!record) {
        check(value.records.length < MAX_ATTESTER_AUTHORIZATIONS, "AttesterJournalCapacity");
        record = { operationIdHex: m.operationIdHex, depositOutpoint: m.depositOutpointText, reserveAllocationIdHex: allocation,
          encodedMessageHex: request.encodedMessageHex, signature: null };
        value.records.push(record); revision = this.#write(value, revision); // PREPARED before signing.
      }
      if (record.signature === null) {
        await this.#guard.assertRunning(m.operationIdHex, "ATTEST_MINT_CREDIT");
        this.#lease.assertHeld(); this.#attester.assertProtectedStorage();
        // Re-read before NEW signing after the asynchronous guard. A retained
        // signature has no new signing boundary: it still undergoes the initial
        // key/evidence/policy check and the final global/revision/policy checks.
        const current = this.#read(); check(current.revision === revision, "AttesterJournalConcurrentMutation");
        record.signature = this.#attester.signDepositCredit(request);
        revision = this.#write(value, revision); // Exact result durable BEFORE acknowledgement.
      }
      await this.#guard.assertRunning(m.operationIdHex, "ATTEST_MINT_CREDIT");
      check(this.#read().revision === revision, "AttesterJournalConcurrentMutation");
      // Time can advance during the authenticated guard and protected read.
      check(this.#attester.evaluateDepositCredit(request).state === "VERIFIED_READY", "AttesterJournalPolicyRejected");
      return Object.freeze(structuredClone(record.signature));
    } catch (error) {
      await this.#reportStorageError(error); throw error;
    } finally { this.#busy = false; }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}

export function requireAttesterAuthorizationJournal(journal, attester, integrity) {
  check(JOURNALS.has(journal), "ProtectedAttesterJournalRequired"); journal.assertBinding(attester, integrity);
}
