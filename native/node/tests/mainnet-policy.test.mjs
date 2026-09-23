// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from "node:test";
import assert from "node:assert/strict";
import { nativeIdentity, isMainnetBinding, NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN,
  NATIVE_REGTEST_GENESIS, SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS, mainnetRpcEndpoint, assertMainnetSolanaGenesis } from "../../../shared/network-identity.mjs";
import { readNativeFeeObservation, quoteNativeMinerFee, nativeTransactionWeight, validateNativeFeePolicy } from "../native-fee-policy.mjs";
import { createUnsignedNativeTransaction } from "../native-taproot-transaction.mjs";

test("production identity binds actual Native and Solana genesis, never labels alone", () => {
  const binding = { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS, nativeNetwork: NATIVE_MAINNET_DOMAIN, solanaGenesis: SOLANA_MAINNET_GENESIS };
  assert(isMainnetBinding(binding));
  for (const mutation of [{ environment: "devnet" }, { nativeGenesis: NATIVE_REGTEST_GENESIS }, { nativeNetwork: 8000111 }, { solanaGenesis: SOLANA_DEVNET_GENESIS }]) assert(!isMainnetBinding({ ...binding, ...mutation }));
  assert.equal(nativeIdentity("mainnet").hrp, "kpepe"); assert.equal(nativeIdentity("devnet").hrp, "rkpepe");
  assert.throws(() => nativeIdentity(undefined)); assert.throws(() => nativeIdentity("mainnet-beta"));
  assert.equal(mainnetRpcEndpoint("https://example.invalid/rpc", SOLANA_MAINNET_GENESIS), "https://example.invalid/rpc");
  assert.throws(() => mainnetRpcEndpoint("http://example.invalid/rpc", SOLANA_MAINNET_GENESIS));
  assert.throws(() => mainnetRpcEndpoint("https://example.invalid/rpc", SOLANA_DEVNET_GENESIS));
  assert.throws(() => assertMainnetSolanaGenesis(SOLANA_DEVNET_GENESIS));
});

const policy = { policy: "DYNAMIC_NODE_ESTIMATE_WITH_CAP", minimumRelayAtomicPerKvB: "1000", maximumAtomicPerKvB: "10000", maximumFeeAtomic: "5000" };
const raw = fields => '{"result":{' + fields + '},"error":null,"id":1}';
const observation = () => readNativeFeeObservation({ estimateRaw: raw('"feerate":0.00002000,"blocks":3'), networkRaw: raw('"relayfee":0.00001000'), mempoolRaw: raw('"mempoolminfee":0.00001000') });
test("dynamic miner fee uses integer tokens, actual vsize and ceil without a fixed fallback", () => {
  const observed = observation(); assert.equal(observed.estimatedAtomicPerKvB, "2000");
  assert.equal(quoteNativeMinerFee({ policy, observation: observed, virtualBytes: "141" }).feeAtomic, "282");
  assert.equal(quoteNativeMinerFee({ policy, observation: { ...observed, estimatedAtomicPerKvB: "1001" }, virtualBytes: "141" }).feeAtomic, "142");
  assert.equal(quoteNativeMinerFee({ policy, observation: { ...observed, estimatedAtomicPerKvB: "1" }, virtualBytes: "141" }).feeAtomic, "141");
  assert.throws(() => readNativeFeeObservation({ estimateRaw: raw('"errors":["Insufficient data"],"blocks":0'), networkRaw: raw('"relayfee":0.00001000'), mempoolRaw: raw('"mempoolminfee":0.00001000') }), /NativeFeeEstimateUnavailable/);
  assert.throws(() => readNativeFeeObservation({ estimateRaw: raw('"feerate":0.000000001,"blocks":3'), networkRaw: raw('"relayfee":0.00001000'), mempoolRaw: raw('"mempoolminfee":0.00001000') }));
  assert.throws(() => readNativeFeeObservation({ estimateRaw: '{private diagnostic', networkRaw: '{}', mempoolRaw: '{}' }), /^Error: NativeFeeObservationRejected$/);
});
test("excessive estimates, fee totals and malformed policies require review, never overpay", () => {
  assert.throws(() => quoteNativeMinerFee({ policy, observation: { ...observation(), estimatedAtomicPerKvB: "10001" }, virtualBytes: "141" }), /NativeFeeOperatorReviewRequired/);
  assert.throws(() => quoteNativeMinerFee({ policy, observation: observation(), virtualBytes: "2501" }), /NativeFeeOperatorReviewRequired/);
  for (const value of ["1.5", "-1", "01", 1, "18446744073709551616"]) assert.throws(() => validateNativeFeePolicy({ ...policy, maximumFeeAtomic: value }));
  const tx = createUnsignedNativeTransaction({ inputs: [{ txid: "01".repeat(32), vout: 0 }], outputs: [{ amountAtomic: "1", scriptPubKeyHex: "5120" + "02".repeat(32) }] });
  assert.deepEqual(nativeTransactionWeight(tx), { weight: String(tx.length * 2), virtualBytes: String(tx.length / 2) });
});
