// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// KingPepe 31.1.0, source 3f2621820ffefae59cbe48b350f5f8f6ec8a6da5.
// policy/policy.h: relay 100 and dust 3000 atomic/kvB.
// wallet/wallet.h: minimum 1000 atomic/kvB, fallback disabled, max fee COIN/10.
// node/transaction.h: default raw-transaction rate ceiling COIN/10 per kvB.
// These ceilings are safety limits. Normal fees always use current node data.
import {validateNativeFeePolicy} from '../node/native-fee-policy.mjs';

export const NATIVE_BURN_SOURCE_SHA='3f2621820ffefae59cbe48b350f5f8f6ec8a6da5';
export function nativeBurnSourceFeePolicy() {
  // Eight P2TR inputs, one 57-byte burn script and one P2TR change output.
  // SIGHASH_DEFAULT witnesses are exactly 64 bytes. ceil(weight / 4) = 580.
  const maximumVirtualBytes=580n,sourceRateMaximum=10_000_000n,walletAbsoluteMaximum=10_000_000n;
  const sizedMaximum=(sourceRateMaximum*maximumVirtualBytes+999n)/1000n;
  return validateNativeFeePolicy({policy:'DYNAMIC_NODE_ESTIMATE_WITH_CAP',minimumRelayAtomicPerKvB:'100',
    maximumAtomicPerKvB:sourceRateMaximum.toString(),maximumFeeAtomic:(sizedMaximum<walletAbsoluteMaximum?sizedMaximum:walletAbsoluteMaximum).toString(),
    sourcePolicy:{insufficientHistory:'LIVE_NODE_FLOORS_AND_NATIVE_WALLET_MINIMUM',walletMinimumAtomicPerKvB:'1000',
      dustRelayAtomicPerKvB:'3000',maximumBurnVirtualBytes:maximumVirtualBytes.toString()}});
}
