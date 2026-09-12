// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Phase-10 projection in the existing authenticated SQLite event journal.
// Public operation data only; neither a second database nor signing authority.
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { decodeCanonicalBridgeMessage, DEPLOYMENT_IDENTITY_LENGTH } from "../../shared/protocol/canonical-message.mjs";
import { validateDepositOperationPolicy, validateDepositOperationPlan, initialDepositOperationState,
  decodeDepositOperationState } from "./deposit-operation-state.mjs";
import { InMemorySolanaDepositClaimJournal } from "./solana-deposit-claim-submitter.mjs";
import { validateNativeDepositRequest } from "./native-deposit-observer.mjs";
import { verifyProjectAttestation } from "../attesters/attestation-service.mjs";
import { base58Encode } from "./solana-deposit-claim-transaction-plan.mjs";
import { initialCoordinatorSigningState, decodeCoordinatorSigningState } from "../../native/frost/coordinator/protected-signing-journal.mjs";

export const MAX_SERVICE_EVENT_BYTES = 262144;
const check = value => { if (!value) throw new Error("LocalLedgerServiceTransitionRejected"); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const keys = (v, fields) => check(v && Object.keys(v).sort().join() === fields.split(",").sort().join());
const hash = v => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);
export function initialServiceState() { return { policy: null, watches: new Map(), deposits: new Map(), deliveries: new Map(), signing: null, paused: null }; }
export function depositServiceStatus(r) {
  if (r.completed !== null) return "COMPLETED";
  if (r.operation.mintReceipt !== null) return "MINTED";
  if (r.attestations.length === 2) return "ATTESTED";
  if (r.operation.finalizedCredit !== null) return "SWEPT";
  return r.validated ? "VALIDATED" : "OBSERVED";
}
// Reuse the claim submitter's already-tested transition rules, including its
// sticky terminal stop and exact prepared-packet binding, for both namespaces.
export function restoreDelivery(entry) {
  const journal = new InMemorySolanaDepositClaimJournal();
  if (entry) {
    journal.persistPrepared(entry.prepared);
    const id = entry.prepared.operationIdHex;
    if (entry.submittedSignature) journal.recordSubmitted(id, entry.submittedSignature);
    if (entry.state === "COMPLETED") journal.recordCompleted(id, entry.result);
    else if (["REJECTED", "HARD_STOP"].includes(entry.state)) journal.recordTerminal(id, entry.result);
  }
  return journal;
}
export function reduceServiceEvent(previous, event, deployment) {
  const next = { ...previous, watches: new Map(previous.watches), deposits: new Map(previous.deposits), deliveries: new Map(previous.deliveries) };
  if (event.action === "SIGNING") {
    keys(event, "action,key,record");
    const state = previous.signing ? structuredClone(previous.signing) : JSON.parse(initialCoordinatorSigningState(event.key));
    decodeCoordinatorSigningState(Buffer.from(JSON.stringify(state)), event.key);
    const r = event.record, request = r.request, intent = request.intent, d = Buffer.from(deployment);
    check(intent.nativeNetwork === "regtest" && ["RESERVE_SWEEP", "WITHDRAWAL"].includes(intent.purpose) &&
      intent.nativeGenesisHash === d.subarray(8, 40).toString("hex") && intent.solanaDeployment === d.subarray(40, 72).toString("hex"));
    const old = state.records.find(v => v.request.requestId === request.requestId);
    if (old && same(old, r)) return { state: previous, unchanged: true };
    if (!old) check(r.state === "PREPARED" && request.attempt === 1);
    else {
      check(old.request.intentDigest === request.intentDigest);
      if (r.state === "PREPARED") check(old.state === "ABORTED" && request.attempt === old.request.attempt + 1);
      else check(old.state === "PREPARED" && same(request, old.request) && ["SIGNED", "ABORTED"].includes(r.state));
    }
    if (old) state.records[state.records.indexOf(old)] = r; else state.records.push(r);
    next.signing = decodeCoordinatorSigningState(Buffer.from(JSON.stringify(state)), event.key);
    return { state: next, unchanged: false };
  }
  if (event.action === "PAUSE" || event.action === "RESUME") {
    keys(event, "action,reason"); check(typeof event.reason === "string" && /^[A-Z_]{1,64}$/u.test(event.reason));
    next.paused = event.action === "PAUSE" ? event.reason : null;
    return { state: next, unchanged: next.paused === previous.paused };
  }
  if (event.action === "REGISTER" || event.action === "WATCH") {
    keys(event, event.action === "REGISTER" ? "action,policy,plan" : "action,policy,request");
    const p = validateDepositOperationPolicy(event.policy);
    const d = Buffer.from(deployment);
    check(d.length === DEPLOYMENT_IDENTITY_LENGTH && d.readUInt32LE(0) === p.protocolId && d.readUInt32LE(4) === p.nativeNetwork);
    for (const [i, k] of ["nativeGenesis", "solanaDeployment", "managerProgramId", "transceiverProgramId", "mint"].entries())
      check(d.subarray(8 + i * 32, 40 + i * 32).toString("hex") === p[k]);
    check(previous.policy === null || same(previous.policy, p)); next.policy = p;
    if (event.action === "WATCH") {
      const r = validateNativeDepositRequest(event.request, p), old = previous.watches.get(r.operationId);
      if (old) { check(same(old, r)); return { state: previous, unchanged: true }; }
      check(next.watches.size < 64 && ![...next.watches.values()].some(w => same(w.depositIntent, r.depositIntent)));
      next.watches.set(r.operationId, r); return { state: next, unchanged: false };
    }
    const plan = validateDepositOperationPlan(event.plan, p), watch = next.watches.get(plan.operationId);
    if (watch) check(same(watch.depositIntent, plan.depositIntent) && plan.inputs[0].txid === watch.depositTxidHex &&
      (watch.depositVout === null || plan.inputs[0].vout === watch.depositVout) && same(watch.feeFundingInputs, plan.inputs.slice(1)) &&
      plan.depositPolicy.userRecoveryPublicKeyHex === watch.userRecoveryPublicKeyHex);
    const old = previous.deposits.get(plan.operationId);
    if (old) { check(same(old.operation.plan, plan)); return { state: previous, unchanged: true }; }
    next.deposits.set(plan.operationId, { operation: { plan, signedTransactionHex: null, broadcastAttempted: false,
      broadcastAccepted: false, finalizedCredit: null, mintReceipt: null }, validated: false, attestations: [], completed: null });
  } else if (event.action === "DELIVERY_REBUILD") {
    keys(event, "action,stage,prepared,expiry"); check(["RECEIPT", "CLAIM"].includes(event.stage));
    const p = event.prepared, e = event.expiry, key = event.stage + ":" + p.operationIdHex, old = previous.deliveries.get(key);
    keys(e, "signature,finalizedHeight,slot");
    check(old && !["COMPLETED", "REJECTED", "HARD_STOP"].includes(old.state));
    check(typeof e.finalizedHeight === "string" && /^[1-9][0-9]{0,19}$/u.test(e.finalizedHeight) &&
      typeof e.slot === "string" && /^[0-9]{1,20}$/u.test(e.slot) && BigInt(e.finalizedHeight) > BigInt(old.prepared.lastValidBlockHeight));
    check(e.signature === base58Encode(Buffer.from(old.prepared.preparedTransactionBase64, "base64").subarray(1, 65)));
    for (const k of ["operationIdHex", "encodedMessageHex", "messageDigestHex", "amountAtomic", "solanaRecipientHex", "depositClaimAccountBase58", "mintAccountBase58"]) check(p[k] === old.prepared[k]);
    check(p.recentBlockhash !== old.prepared.recentBlockhash && BigInt(p.lastValidBlockHeight) > BigInt(e.finalizedHeight));
    const attempts = [...(old.previousAttempts ?? []), { prepared: old.prepared, expiry: e }]; check(attempts.length < 8);
    const journal = restoreDelivery(); journal.persistPrepared(p);
    next.deliveries.set(key, { ...journal.get(p.operationIdHex), previousAttempts: attempts });
    return { state: next, unchanged: false };
  } else if (event.action === "DELIVERY") {
    keys(event, "action,stage,method,args,operationId");
    check(["RECEIPT", "CLAIM"].includes(event.stage) && hash(event.operationId) && Array.isArray(event.args));
    check(["persistPrepared", "recordSubmitted", "recordCompleted", "recordTerminal"].includes(event.method));
    const deposit = [...next.deposits.values()].find(r => r.operation.finalizedCredit &&
      decodeCanonicalBridgeMessage(r.operation.finalizedCredit.encodedMessageHex).operationIdHex === event.operationId);
    check(deposit && deposit.attestations.length === 2);
    const key = event.stage + ":" + event.operationId, old = previous.deliveries.get(key), journal = restoreDelivery(old);
    check(event.method === "persistPrepared" ? event.args.length === 1 && event.args[0]?.operationIdHex === event.operationId :
      event.args.length === 2 && event.args[0] === event.operationId);
    journal[event.method](...event.args);
    const entry = JSON.parse(JSON.stringify(journal.get(event.operationId)));
    if (old?.previousAttempts) entry.previousAttempts = old.previousAttempts;
    check(entry.prepared.encodedMessageHex === deposit.operation.finalizedCredit.encodedMessageHex);
    next.deliveries.set(key, entry);
    return { state: next, unchanged: old !== undefined && same(old, entry) };
  } else {
    keys(event, "action,operationId,value"); check(hash(event.operationId));
    const old = previous.deposits.get(event.operationId); check(old);
    const r = structuredClone(old), op = r.operation;
    switch (event.action) {
      case "VALIDATED": check(event.value === op.plan.acceptedCheckpoint.evidenceDigestHex); r.validated = true; break;
      case "SIGNED": check(r.validated && (op.signedTransactionHex === null || op.signedTransactionHex === event.value)); op.signedTransactionHex = event.value; break;
      case "BROADCAST": check(event.value === true && op.signedTransactionHex !== null); op.broadcastAttempted = true; break;
      case "ACCEPTED": check(event.value === true && op.broadcastAttempted); op.broadcastAccepted = true; break;
      case "CREDIT": check(op.broadcastAccepted && (op.finalizedCredit === null || same(op.finalizedCredit, event.value))); op.finalizedCredit = event.value; break;
      case "ATTESTED": {
        check(op.finalizedCredit !== null);
        const a = event.value, m = decodeCanonicalBridgeMessage(op.finalizedCredit.encodedMessageHex);
        check(a && ["ATTESTER_A", "ATTESTER_B"].includes(a.role) && a.state === "VERIFIED_READY" &&
          a.operationIdHex === m.operationIdHex && a.messageDigestHex === m.messageDigestHex && hash(a.attesterPublicKeyHex) &&
          typeof a.signatureHex === "string" && /^[0-9a-f]{128}$/u.test(a.signatureHex) && verifyProjectAttestation(a, op.finalizedCredit.encodedMessageHex));
        const prior = r.attestations.find(v => v.role === a.role);
        if (prior) check(same(prior, a));
        else { check(a.role === ["ATTESTER_A", "ATTESTER_B"][r.attestations.length] && !r.attestations.some(v => v.attesterPublicKeyHex === a.attesterPublicKeyHex)); r.attestations.push(a); }
        break;
      }
      case "MINTED": check(r.attestations.length === 2 && (op.mintReceipt === null || same(op.mintReceipt, event.value))); op.mintReceipt = event.value; break;
      case "COMPLETED": check(op.mintReceipt !== null && hash(event.value) && (r.completed === null || r.completed === event.value)); r.completed = event.value; break;
      default: check(false);
    }
    if (same(old, r)) return { state: previous, unchanged: true };
    next.deposits.set(event.operationId, r);
  }
  // The existing canonical validator checks signatures, amount, recipient,
  // fee funding, unique inputs and retained acceptance/credit/mint bindings.
  const state = JSON.parse(initialDepositOperationState(next.policy));
  state.operations = [...next.deposits.values()].map(r => r.operation);
  decodeDepositOperationState(Buffer.from(JSON.stringify(state)), next.policy);
  return { state: next, unchanged: false };
}
