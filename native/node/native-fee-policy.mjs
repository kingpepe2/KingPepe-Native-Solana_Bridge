// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Network miner fees are exact atomic units, separate from the zero Bridge fee.
import { decimalCoinsToAtomic } from "./native-rpc-client.mjs";
import { parseNativeTransactionHex } from "./native-taproot-transaction.mjs";

const U64 = 0xffff_ffff_ffff_ffffn;
const check = (v, code = "NativeFeePolicyRejected") => { if (!v) throw new Error(code); };
const amount = v => { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v)); const n = BigInt(v); check(n <= U64); return n; };
const ceil = (n, d) => (n + d - 1n) / d;

export function nativeTransactionWeight(transactionHex) {
  const tx = parseNativeTransactionHex(transactionHex);
  const strippedBytes = BigInt(tx.strippedHex.length / 2), totalBytes = BigInt(tx.rawHex.length / 2);
  const weight = strippedBytes * 3n + totalBytes;
  check(weight > 0n && weight <= 4_000_000n);
  return Object.freeze({ weight: weight.toString(), virtualBytes: ceil(weight, 4n).toString() });
}

export function validateNativeFeePolicy(value) {
  check(value && Object.keys(value).sort().join() === ["policy", "minimumRelayAtomicPerKvB", "maximumAtomicPerKvB", "maximumFeeAtomic"].sort().join());
  check(value.policy === "DYNAMIC_NODE_ESTIMATE_WITH_CAP");
  const floor = amount(value.minimumRelayAtomicPerKvB), rateCap = amount(value.maximumAtomicPerKvB), feeCap = amount(value.maximumFeeAtomic);
  check(floor > 0n && rateCap >= floor && feeCap > 0n);
  return Object.freeze({ ...value });
}

// A missing estimator result is a dependency wait; there is no fixed fee fallback.
export function readNativeFeeObservation({ estimateRaw, networkRaw, mempoolRaw }) {
  const exact = raw => {
    check(typeof raw === "string" && raw.length <= 1_000_000, "NativeFeeObservationRejected");
    try {
      const envelope = JSON.parse(raw, (_k, v, context) => typeof v === "number" ? context.source : v);
      check(envelope?.error === null && envelope.result && !Array.isArray(envelope.result), "NativeFeeObservationRejected");
      return envelope.result;
    } catch { throw new Error("NativeFeeObservationRejected"); }
  };
  const estimate = exact(estimateRaw), network = exact(networkRaw), pool = exact(mempoolRaw);
  check(estimate && typeof estimate.feerate === "string" && !estimate.errors, "NativeFeeEstimateUnavailable");
  const rate = text => { check(typeof text === "string", "NativeFeeObservationRejected"); const n = decimalCoinsToAtomic(text, 8); check(n > 0n && n <= U64, "NativeFeeObservationRejected"); return n; };
  const relay = rate(network?.relayfee), estimated = rate(estimate.feerate);
  const poolFloor = rate(pool?.mempoolminfee);
  const floor = relay > poolFloor ? relay : poolFloor;
  return Object.freeze({ estimatedAtomicPerKvB: estimated.toString(), minimumRelayAtomicPerKvB: relay.toString(),
    mempoolMinimumAtomicPerKvB: poolFloor.toString(), effectiveFloorAtomicPerKvB: floor.toString(),
    estimatedBlocks: estimate.blocks, estimateMode: "ECONOMICAL" });
}

export function quoteNativeMinerFee({ policy, observation, virtualBytes }) {
  policy = validateNativeFeePolicy(policy);
  const size = amount(virtualBytes); check(size > 0n && size <= 1_000_000n);
  const estimated = amount(observation.estimatedAtomicPerKvB), currentFloor = amount(observation.effectiveFloorAtomicPerKvB);
  check(estimated > 0n && currentFloor > 0n, "NativeFeeObservationRejected");
  const minimum = amount(policy.minimumRelayAtomicPerKvB);
  const rate = [estimated, currentFloor, minimum].reduce((a, b) => a > b ? a : b);
  const fee = ceil(rate * size, 1000n);
  check(rate <= amount(policy.maximumAtomicPerKvB) && fee <= amount(policy.maximumFeeAtomic), "NativeFeeOperatorReviewRequired");
  return Object.freeze({ policy: policy.policy, rateAtomicPerKvB: rate.toString(), virtualBytes: size.toString(), feeAtomic: fee.toString() });
}
