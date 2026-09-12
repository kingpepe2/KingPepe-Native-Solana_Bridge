// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Read-only, bounded journal transport. This is NOT chain proof or authority
// for reconciliation to mutate the Bridge Validator's state.
import { isProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { requireDepositOperationJournal } from "./protected-deposit-journal.mjs";
import { validateDepositOperationPolicy, depositOperationPolicyDigest, decodeDepositOperationState,
  depositOperationAccounting, DEPOSIT_OPERATION_PROTOCOL, MAX_DEPOSIT_OPERATIONS } from "./deposit-operation-state.mjs";

const PROTOCOL = "KINGPEPE_DEPOSIT_SNAPSHOT_V1", CLIENTS = new WeakSet(), SNAPSHOTS = new WeakMap();
const check = v => { if (!v) throw new Error("DepositSnapshotRejected"); };
const fields = (v, names) => check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join());
const revision = v => { check(typeof v === "string" && /^[1-9][0-9]{0,19}$/u.test(v) && BigInt(v) <= 0xffff_ffff_ffff_ffffn); return BigInt(v); };
function immutable(v) { for (const child of Object.values(v)) if (child && typeof child === "object") immutable(child); return Object.freeze(v); }

export function depositSnapshotIpcHandler({ journal, integrity, policy }) {
  const pinned = validateDepositOperationPolicy(policy), policyDigest = depositOperationPolicyDigest(pinned);
  requireDepositOperationJournal(journal, pinned, integrity);
  return async ({ peerRole, method, operationId, payload }) => {
    check(peerRole === "RECONCILIATION" && method === "depositSnapshot" && operationId === policyDigest);
    fields(payload, ["index", "revision"]);
    check(Number.isInteger(payload.index) && payload.index >= 0 && payload.index < MAX_DEPOSIT_OPERATIONS);
    if (payload.revision === null) check(payload.index === 0); else revision(payload.revision);
    requireDepositOperationJournal(journal, pinned, integrity);
    const snapshot = await journal.snapshot();
    check(payload.revision === null || payload.revision === snapshot.revision);
    check(snapshot.operations.length === 0 ? payload.index === 0 : payload.index < snapshot.operations.length);
    return Object.freeze({ protocol: PROTOCOL, policyDigest, revision: snapshot.revision,
      count: snapshot.operations.length, index: payload.index, record: snapshot.operations[payload.index] ?? null });
  };
}

export class ProtectedDepositSnapshotClient {
  #ipc; #port; #policy; #revision = 0n; #busy = false;
  constructor({ ipc, port, policy }) {
    check(isProtectedServiceIpc(ipc) && ipc.role === "RECONCILIATION" && ipc.peerRole === "BRIDGE_VALIDATOR");
    check(Number.isInteger(port) && port >= 1 && port <= 65535);
    this.#policy = validateDepositOperationPolicy(policy);
    const { environment, nativeGenesis, solanaDeployment, keyEpoch } = this.#policy;
    check(Object.entries({ environment, nativeGenesis, solanaDeployment, keyEpoch }).every(([k, v]) => ipc.deployment[k] === v));
    this.#ipc = ipc; this.#port = port; CLIENTS.add(this);
  }
  assertBinding(policy) { check(depositOperationPolicyDigest(policy) === depositOperationPolicyDigest(this.#policy)); }
  async read() {
    check(!this.#busy); this.#busy = true;
    try {
      const policyDigest = depositOperationPolicyDigest(this.#policy);
      const page = async (index, expectedRevision) => {
        const response = await this.#ipc.request(this.#port, { method: "depositSnapshot", operationId: policyDigest,
          payload: { index, revision: expectedRevision } });
        fields(response, ["protocol", "policyDigest", "revision", "count", "index", "record"]);
        check(response.protocol === PROTOCOL && response.policyDigest === policyDigest && response.index === index &&
          Number.isInteger(response.count) && response.count >= 0 && response.count <= MAX_DEPOSIT_OPERATIONS);
        if (revision(response.revision) < this.#revision) throw new Error("DepositSnapshotRollbackDetected");
        check(expectedRevision === null || response.revision === expectedRevision);
        check(response.count === 0 ? index === 0 && response.record === null : index < response.count && response.record !== null);
        return response;
      };
      const first = await page(0, null), records = first.count ? [first.record] : [];
      for (let index = 1; index < first.count; index++) {
        const next = await page(index, first.revision); check(next.count === first.count); records.push(next.record);
      }
      const final = await page(0, first.revision); check(final.count === first.count && JSON.stringify(final.record) === JSON.stringify(first.record));
      const state = decodeDepositOperationState(Buffer.from(JSON.stringify({ protocol: DEPOSIT_OPERATION_PROTOCOL, policyDigest, operations: records })), this.#policy);
      this.#revision = revision(first.revision);
      const result = immutable({ protocol: PROTOCOL, trust: "AUTHENTICATED_LOCAL_JOURNAL_OBSERVATION", revision: first.revision,
        policyDigest, operations: state.operations, accounting: depositOperationAccounting(state, this.#policy) });
      SNAPSHOTS.set(result, this); return result;
    } finally { this.#busy = false; }
  }
  async assertCurrent(snapshot) {
    check(!this.#busy && SNAPSHOTS.get(snapshot) === this); this.#busy = true;
    try {
      const response = await this.#ipc.request(this.#port, { method: "depositSnapshot", operationId: snapshot.policyDigest,
        payload: { index: 0, revision: snapshot.revision } });
      fields(response, ["protocol", "policyDigest", "revision", "count", "index", "record"]);
      check(response.protocol === PROTOCOL && response.policyDigest === snapshot.policyDigest && response.revision === snapshot.revision &&
        response.count === snapshot.operations.length && response.index === 0 &&
        JSON.stringify(response.record) === JSON.stringify(snapshot.operations[0] ?? null));
      if (revision(response.revision) < this.#revision) throw new Error("DepositSnapshotRollbackDetected");
    } finally { this.#busy = false; }
  }
}
export function requireDepositSnapshotClient(client, policy) {
  check(CLIENTS.has(client)); client.assertBinding(policy);
}
