// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Codec/HTTP/CLI boundary tests. Stub statuses below are NOT chain evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { bech32, bech32m } from "@scure/base";
import { witnessAddressFromScript, scriptFromWitnessAddress } from "../../../native/node/witness-address.mjs";
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";
import { createNativeDepositRequest, createSolanaWithdrawalRequest } from "../../../solana/ts/sdk/bridge.mjs";
import { decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { createWithdrawalInstruction } from "../../../solana/ts/sdk/withdrawal.mjs";
import { base58Encode } from "../solana-deposit-claim-transaction-plan.mjs";
import { decodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { BridgeUserApi } from "../user-api.mjs";
import { listenBridgeUserApi } from "../user-http.mjs";
import { createBridgeClient } from "../../../solana/ts/sdk/client.mjs";
import { runBridgeCli } from "../../../cli/bridge.mjs";

const h = n => n.toString(16).padStart(2, "0").repeat(32), key = n => base58Encode(Buffer.from(h(n), "hex"));
// Public secp256k1 generator points, no private state fixture.
const generator = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const second = "c6047f9441ed7d6d3045406e95c07cd85a961ae58cd9ee37abac09b95c709ee5";
const policy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: h(2), solanaGenesis: key(3), minimumSolanaSlot: "0",
  managerProgramId: h(4), transceiverProgramId: h(5), mint: h(6), protocolId: 1, nativeNetwork: 8000111, policyEpoch: 1, keyEpoch: 1,
  frostPublicKeyHex: generator, csvDelayBlocks: 12, minimumConfirmations: 6, maximumAmountAtomic: "18446744073709551615", maximumFeeAtomic: "10000" };
const deposit = { amountAtomic: "100000000", recipient: key(7), userRecoveryPublicKeyHex: second, nonceHex: h(8) };
const withdrawal = { amountAtomic: "20000000", feeAtomic: "1000", destination: witnessAddressFromScript("5120" + second),
  userAuthority: key(7), sourceTokenAccount: key(8), withdrawalIdHex: h(9), nonceHex: h(10), validFrom: "10", validUntil: "3610", recentBlockhash: key(11) };

test("Native request is deterministic, exact and reconstructs the funded recoverable script", () => {
  const a = createNativeDepositRequest({ policy, ...deposit });
  assert.deepEqual(a, createNativeDepositRequest({ policy, ...deposit }));
  assert.equal(a.amountAtomic, "100000000"); assert.equal(a.depositIntent.recipientHex, h(7));
  assert.equal(scriptFromWitnessAddress(a.depositAddress), a.recovery.scriptPubKeyHex);
  assert.equal(a.operationId, a.recovery.depositCommitmentHex); assert.equal(a.state, "AWAITING_USER_TRANSACTION");
  assert.notEqual(a.operationId, createNativeDepositRequest({ policy, ...deposit, nonceHex: h(12) }).operationId);
});
test("user amounts remain exact up to u64 and reject floating point, zero and overflow", () => {
  assert.equal(createNativeDepositRequest({ policy, ...deposit, amountAtomic: "18446744073709551615" }).amountAtomic, "18446744073709551615");
  for (const value of [0, 0.1, "0", "-1", "01", "1.0", "1e8", "18446744073709551616"]) {
    assert.throws(() => createNativeDepositRequest({ policy, ...deposit, amountAtomic: value }));
  }
  assert.throws(() => createNativeDepositRequest({ policy: { ...policy, maximumAmountAtomic: "5" }, ...deposit }));
});
test("request rejects wrong Native genesis, invalid recovery key and hidden fields", () => {
  assert.throws(() => createNativeDepositRequest({ policy: { ...policy, nativeGenesis: h(99) }, ...deposit }));
  assert.throws(() => createNativeDepositRequest({ policy, ...deposit, userRecoveryPublicKeyHex: generator }));
  assert.throws(() => createNativeDepositRequest({ policy, ...deposit, privateKey: "NOT_A_KEY" }));
  assert.throws(() => createNativeDepositRequest({ policy, ...deposit, recipient: key(7) + "1" }));
});
test("address codecs accept only supported scripts with correct checksum/network/padding", () => {
  for (const script of ["0014" + "42".repeat(20), "0020" + h(42), "5120" + second]) {
    const address = witnessAddressFromScript(script); assert.equal(scriptFromWitnessAddress(address), script);
    assert.equal(scriptFromWitnessAddress(address.toUpperCase()), script);
    assert.throws(() => scriptFromWitnessAddress(address.slice(0, -1) + (address.endsWith("q") ? "p" : "q")));
    assert.throws(() => scriptFromWitnessAddress("R" + address.slice(1)));
    assert.throws(() => scriptFromWitnessAddress(witnessAddressFromScript(script, "kpepe")));
  }
  assert.throws(() => scriptFromWitnessAddress(bech32.encode("rkpepe", [1, ...bech32.toWords(Buffer.from(second, "hex"))])));
  assert.throws(() => scriptFromWitnessAddress(bech32m.encode("rkpepe", [0, ...bech32m.toWords(Buffer.alloc(20))])));
  assert.throws(() => scriptFromWitnessAddress(bech32m.encode("rkpepe", [1, ...bech32m.toWords(Buffer.alloc(32)), 1])));
});
test("withdrawal produces the exact Borsh record instruction and one unsigned user transaction", () => {
  const r = createSolanaWithdrawalRequest({ policy, ...withdrawal }), m = decodeCanonicalBridgeMessage(r.encodedMessageHex);
  assert.equal(m.destinationHex, "5120" + second); assert.equal(m.amountAtomic, 20000000n); assert.equal(r.netAtomic, "19999000");
  assert.equal(m.version, 2); assert.equal(r.operationId, m.operationIdHex);
  const ix = createWithdrawalInstruction({ encodedMessageHex: r.encodedMessageHex, userAuthority: withdrawal.userAuthority,
    payer: withdrawal.userAuthority, sourceTokenAccount: withdrawal.sourceTokenAccount });
  assert.equal(Buffer.from(ix.data).toString("base64"), r.instruction.dataBase64);
  const abi = decodeBridgeAbi("RecordWithdrawal", ix.data); assert.equal(abi.burn.amountAtomic, 20000000n); assert.equal(abi.burn.decimals, 8);
  const packet = Buffer.from(r.transactionBase64, "base64"); assert(packet.length <= 1232);
  assert.equal(packet[0], 1); assert(packet.subarray(1, 65).equals(Buffer.alloc(64))); assert.equal(packet[65], 1);
  assert.equal(r.walletAction, "SIGN_AND_SEND_WITH_YOUR_SOLANA_WALLET");
});
test("withdrawal refuses wrong amount, fee, destination, signer and unsupported validity", () => {
  for (const changes of [{ amountAtomic: "0" }, { feeAtomic: "10001" }, { feeAtomic: withdrawal.amountAtomic },
    { destination: witnessAddressFromScript("5120" + second, "kpepe") }, { userAuthority: "invalid" },
    { validUntil: "10" }, { validUntil: "100000" }, { withdrawalIdHex: h(0) }, { nonceHex: h(0) }, { mint: key(99) }]) {
    assert.throws(() => createSolanaWithdrawalRequest({ policy, ...withdrawal, ...changes }));
  }
});

async function httpFixture(t) {
  // This explicit method stub tests ONLY transport/routing. Local-chain tests
  // use real BridgeUserApi/service instances and verify actual on-chain actions.
  const api = Object.create(BridgeUserApi.prototype), calls = [];
  Object.assign(api, { getBridgeStatus: () => ({ state: "PAUSED", trust: "UNIT_TEST_ONLY" }),
    getOperationStatus: id => ({ operationId: id, state: "OBSERVED" }), getDepositStatus: () => null,
    createNativeDepositRequest: v => { calls.push(v); return { state: "AWAITING_USER_TRANSACTION" }; },
    submitSolanaWithdrawal: async () => { throw new Error("PRIVATE_EXCEPTION_MUST_NOT_LEAK"); } });
  const token = randomBytes(32), server = await listenBridgeUserApi({ api, accessToken: token });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const endpoint = `http://127.0.0.1:${server.address().port}/`, accessToken = token.toString("hex");
  return { endpoint, accessToken, calls, client: createBridgeClient({ endpoint, accessToken }) };
}
test("authorized local client routes status/request and rejects unauthorized clients", async t => {
  const f = await httpFixture(t); assert.equal((await f.client.getBridgeStatus()).state, "PAUSED");
  assert.equal(await f.client.getDepositStatus(h(88)), null);
  await f.client.createNativeDepositRequest(deposit); assert.deepEqual(f.calls, [deposit]);
  assert.equal((await fetch(f.endpoint + "bridge/status")).status, 403);
  await assert.rejects(createBridgeClient({ endpoint: f.endpoint, accessToken: randomBytes(32).toString("hex") }).getBridgeStatus());
  assert.throws(() => createBridgeClient({ endpoint: "http://example.com/", accessToken: f.accessToken }));
  assert.throws(() => f.client.getOperationStatus("../status"));
});
test("HTTP rejects cross-origin, malformed and oversized input; no admin route or leaked errors", async t => {
  const f = await httpFixture(t), headers = { authorization: "Bearer " + f.accessToken, "content-type": "application/json" };
  assert.equal((await fetch(f.endpoint + "bridge/status", { headers: { ...headers, origin: "https://example.com" } })).status, 403);
  for (const route of ["sign", "mint", "resume", "pause"]) assert.equal((await fetch(f.endpoint + route, { method: "POST", headers, body: "{}" })).status, 404);
  assert.equal((await fetch(f.endpoint + "deposits/request", { method: "POST", headers, body: "{" })).status, 400);
  assert.equal((await fetch(f.endpoint + "deposits/request", { method: "POST", headers, body: JSON.stringify("x".repeat(17000)) })).status, 413);
  const r = await fetch(f.endpoint + "withdrawals/submit", { method: "POST", headers, body: "{}" });
  assert.equal(r.status, 400); assert(!(await r.text()).includes("PRIVATE_EXCEPTION"));
});
test("CLI routes public JSON and status without handling user wallet signatures", async t => {
  const f = await httpFixture(t), output = [], options = { client: f.client, output: s => output.push(s), readInput: async () => JSON.stringify(deposit) };
  await runBridgeCli(["deposit"], options); await runBridgeCli(["status"], options); await runBridgeCli(["operation", h(12)], options);
  assert.equal(JSON.parse(output[0]).state, "AWAITING_USER_TRANSACTION"); assert.equal(JSON.parse(output[2]).operationId, h(12));
  await assert.rejects(runBridgeCli(["sign"], options)); await assert.rejects(runBridgeCli(["withdraw", "submit"], options));
});
