// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { ProjectAttester } from "../attestation-service.mjs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ATTESTER_JOURNAL_PROTOCOL, decodeAttesterAuthorizationState, MAX_ATTESTER_AUTHORIZATIONS,
  ProtectedAttesterAuthorizationJournal, requireAttesterAuthorizationJournal } from "../authorization-journal.mjs";
import { decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { normalizeProtectedContext } from "../../../shared/windows/protected-store.mjs";

// Public message vector + in-memory disposable attester. Codec tests are NOT
// protected storage, Native proof, service isolation or crash-recovery evidence.
function fixture(t) {
  const v = JSON.parse(readFileSync(new URL("../../../solana/modules/bridge-messages/vectors/canonical-v1.json", import.meta.url))).vectors.find(x => x.name === "deposit-claim-v1");
  const m = decodeCanonicalBridgeMessage(v.encodedHex), seed = randomBytes(32), d = v.deployment;
  const attester = new ProjectAttester({ role: "ATTESTER_A", secretKey: seed, policy: {
    role: "ATTESTER_A", attesterPublicKeyHex: Buffer.from(ed25519.getPublicKey(seed)).toString("hex"), protocolId: d.protocolId,
    nativeNetwork: d.nativeNetwork, nativeGenesisHex: d.nativeGenesis, solanaDeploymentHex: d.solanaDeployment,
    managerProgramIdHex: d.managerProgramId, transceiverProgramIdHex: d.transceiverProgramId, mintHex: d.mint,
    keyEpoch: m.keyEpoch, policyEpoch: m.policyEpoch, acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"] } });
  seed.fill(0); t.after(() => attester.close());
  const request = { encodedMessageHex: v.encodedHex, evidence: { trust: "LOCALLY_VALIDATED_CHAIN_STATE", nativeNetwork: d.nativeNetwork,
    nativeGenesisHash: d.nativeGenesis, operationIdHex: m.operationIdHex, depositOutpoint: m.depositOutpointText,
    amountAtomic: m.amountAtomic.toString(), solanaRecipientHex: m.destinationHex, evidenceDigestHex: m.evidenceDigestHex,
    reserveAllocationIdHex: "ab".repeat(32), reserveTransitionState: "CANONICAL_RESERVE", mintCreditState: "AUTHORIZED_UNCONSUMED",
    finalitySatisfied: true, sweepFinalized: true, utxoUnspentAtDeposit: true, noPriorConsumption: true } };
  const state = { protocol: ATTESTER_JOURNAL_PROTOCOL,
    identityDigest: createHash("sha256").update(JSON.stringify([ATTESTER_JOURNAL_PROTOCOL, attester.role, attester.publicKeyHex, attester.policy])).digest("hex"),
    records: [{ operationIdHex: m.operationIdHex, depositOutpoint: m.depositOutpointText, reserveAllocationIdHex: request.evidence.reserveAllocationIdHex,
      encodedMessageHex: v.encodedHex, signature: null }], incident: null };
  return { attester, request, state, now: m.validFrom, decode: value => decodeAttesterAuthorizationState(Buffer.from(JSON.stringify(value)), attester) };
}
test("attester journal codec preserves prepared binding and independently verifies a signed result", t => {
  const f = fixture(t); assert.deepEqual(f.decode(f.state), f.state);
  f.state.records[0].signature = f.attester.signDepositCredit(f.request, f.now);
  assert.deepEqual(f.decode(f.state), f.state);
});
for (const [name, mutate] of [
  ["wrong protocol", s => { s.protocol += "x"; }], ["wrong policy identity", s => { s.identityDigest = "ff".repeat(32); }],
  ["duplicate backing", s => { s.records.push(structuredClone(s.records[0])); }],
  ["wrong operation", s => { s.records[0].operationIdHex = "ff".repeat(32); }],
  ["wrong outpoint", s => { s.records[0].depositOutpoint += "0"; }],
  ["malformed allocation", s => { s.records[0].reserveAllocationIdHex = "invalid"; }],
  ["trailing message bytes", s => { s.records[0].encodedMessageHex += "00"; }],
  ["unbounded journal", s => { s.records = Array(MAX_ATTESTER_AUTHORIZATIONS + 1).fill(s.records[0]); }],
  ["invalid incident", s => { s.incident = { code: "AUTO_CLEAR", operationId: "01".repeat(32), evidenceDigest: "02".repeat(32) }; }],
]) test("attester journal codec rejects " + name, t => {
  const f = fixture(t); mutate(f.state); assert.throws(() => f.decode(f.state));
});
test("attester journal rejects substituted signature, role and key", t => {
  const f = fixture(t), signed = f.attester.signDepositCredit(f.request, f.now);
  for (const patch of [{ signatureHex: "00".repeat(64) }, { role: "ATTESTER_B" }, { attesterPublicKeyHex: "ff".repeat(32) }, { state: "HARD_STOP" }]) {
    f.state.records[0].signature = { ...signed, ...patch }; assert.throws(() => f.decode(f.state));
  }
});
test("attester journal rejects duplicate JSON keys, malformed and oversized protected images", t => {
  const f = fixture(t), bytes = Buffer.from(JSON.stringify(f.state).replace('"records":', '"records":[],"records":'));
  assert.throws(() => decodeAttesterAuthorizationState(bytes, f.attester));
  assert.throws(() => decodeAttesterAuthorizationState(Buffer.from("{"), f.attester));
  assert.throws(() => decodeAttesterAuthorizationState(Buffer.alloc(900001), f.attester));
});
test("in-memory attester and forged journal cannot become a protected runtime journal", t => {
  const f = fixture(t); assert.throws(() => ProtectedAttesterAuthorizationJournal.initialState(f.attester), /ProtectedAttesterStorageRequired/u);
  assert.throws(() => requireAttesterAuthorizationJournal({ assertBinding() {} }, f.attester, {}), /ProtectedAttesterJournalRequired/u);
});
test("attester authorization storage purpose denies other service roles", () => {
  const context = { role: "COORDINATOR", purpose: "attester-authorizations", serviceSid: "S-1-5-21-1-2-3-1001", environment: "localnet",
    nativeGenesis: "01".repeat(32), solanaDeployment: "02".repeat(32), instanceId: "03".repeat(32), keyEpoch: 1 };
  for (const role of ["COORDINATOR", "KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "BRIDGE_VALIDATOR", "SUPERVISOR"]) assert.throws(() => normalizeProtectedContext({ ...context, role }));
  for (const role of ["ATTESTER_A", "ATTESTER_B"]) assert.equal(normalizeProtectedContext({ ...context, role }).role, role);
});
