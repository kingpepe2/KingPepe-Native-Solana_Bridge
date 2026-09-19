// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic state/intake facts; never evidence of a Mainnet economic operation.
import test from "node:test";
import assert from "node:assert/strict";
import { mainnetDepositRequestFixture } from "../../../tests/integration/mainnet-deposit-request-fixture.mjs";
import { initialDepositControllerState, decodeDepositControllerState, newDepositControllerRecord } from "../deposit-controller-state.mjs";
import { NativeDepositObserver } from "../native-deposit-observer.mjs";
import { BridgeUserApi } from "../user-api.mjs";
import { createRawNativeCreditAttestationVerifier } from "../native-reserve-credit.mjs";
import { solanaDeliveryFixture } from "../../../tests/integration/solana-delivery-fixture.mjs";
import { nativeReserveCreditEvidenceInput } from "../native-reserve-credit.mjs";
const bytes = v => Buffer.from(JSON.stringify(v));
test("Mainnet pending intake is bounded, forward-only and grants no credit; TEST protocol is not relabelled", async () => {
  const f = await mainnetDepositRequestFixture(), state = JSON.parse(initialDepositControllerState(f.policy));
  state.requests.push(f.request);
  const decode = value => decodeDepositControllerState(bytes(value), f.policy);
  assert.deepEqual(decode(state).requests, [f.request]); assert.deepEqual(state.records, []);
  for (const mutate of [s => { delete s.requests; }, s => { s.protocol = "KINGPEPE_PROTECTED_DEPOSIT_CONTROLLER_V1"; },
    s => { s.requests[0].depositVout = null; }, s => { s.requests[0].depositIntent.nativeNetwork++; },
    s => { s.requests[0].proofVerified = true; }, s => { s.requests.push(structuredClone(s.requests[0])); },
    s => { const r = structuredClone(s.requests[0]); r.operationId = "ab".repeat(32); r.depositTxidHex = "cd".repeat(32); s.requests.push(r); }]) {
    const value = structuredClone(state); mutate(value); assert.throws(() => decode(value));
  }
  assert.throws(() => BridgeUserApi.createMainnet({ controller: {}, depositFeeInputs() {} }));
});
test("pending Native intake cannot become a sweep plan before finality and moves atomically into one registered record", async () => {
  const f = await mainnetDepositRequestFixture(), observer = NativeDepositObserver.createMainnet({ nativeRpc: f.rpc, nativeVerifier: f.verifier,
    policy: f.policy.deliveryPolicy.operationPolicy, nativeFeePolicy: f.feePolicy });
  const request = await observer.verifyNotification({ ...f.request, depositVout: null });
  assert.equal(request.depositVout, 0); await assert.rejects(observer.observe(request), /FINALITY_INSUFFICIENT/);
  assert.equal(f.calls.includes("estimatesmartfee"), false);
  f.conditions.finalized = true; const plan = await observer.observe(request);
  const state = JSON.parse(initialDepositControllerState(f.policy)); state.requests.push(request);
  const reopened = JSON.parse(JSON.stringify(plan));
  const read = nativeReserveCreditEvidenceInput(reopened, f.policy.deliveryPolicy.operationPolicy);
  assert.deepEqual(read.transactionBlockHints, plan.acceptedCheckpoint.transactionBlockHints);
  assert.equal(read.acceptedCheckpoint, undefined, "An input checkpoint must not masquerade as a sweep proof");
  assert.equal(read.minimumConfirmations, 12);
  assert.equal(plan.acceptedCheckpoint.minimumConfirmations, 1, "Proof packet minimum is not the signing finality policy");
  state.records.push(newDepositControllerRecord(plan, f.policy));
  assert.throws(() => decodeDepositControllerState(bytes(state), f.policy));
  state.requests = [];
  assert.equal(decodeDepositControllerState(bytes(state), f.policy).records[0].nativeValidationDigest, null);
  assert.equal(state.records[0].credit, null); assert.deepEqual(state.records[0].packets, []);
});
test("Mainnet attester adapter does not elevate serialized proof flags or a forged local-validation label", async () => {
  const f = await mainnetDepositRequestFixture(); f.conditions.finalized = true;
  const observer = NativeDepositObserver.createMainnet({ nativeRpc: f.rpc, nativeVerifier: f.verifier,
    policy: f.policy.deliveryPolicy.operationPolicy, nativeFeePolicy: f.feePolicy });
  const plan = await observer.observe(f.request), packet = await (await solanaDeliveryFixture({ mainnet: true })).delivery();
  f.verifier.verifyReserve = async () => ({ proofVerified: true, trust: "LOCALLY_VALIDATED_CHAIN_STATE", reserveBasis: { genesis: f.policy.deliveryPolicy.operationPolicy.nativeGenesis } });
  const verify = createRawNativeCreditAttestationVerifier({ policy: f.policy.deliveryPolicy.operationPolicy, nativeVerifier: f.verifier });
  await assert.rejects(verify({ encodedMessageHex: packet.encodedMessageHex, rawEvidence: { plan, acceptedCheckpoint: plan.acceptedCheckpoint } }),
    /RAW_NATIVE_VERIFIED_RESERVE_REQUIRED/);
});
