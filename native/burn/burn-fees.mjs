// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// The TEST profile records source-derived bounds, never an invented fixed fee.
import {NativeRpcClient} from '../node/native-rpc-client.mjs';
import {readNativeFeeObservation,quoteNativeMinerFee,validateNativeFeePolicy} from '../node/native-fee-policy.mjs';
import {planNativeBurn,burnUint,requireBurn as check} from './burn-protocol.mjs';

export class NativeBurnFeePolicy {
  #rpc;#policy;
  constructor({rpc,policy}) {
    check(rpc instanceof NativeRpcClient,'NativeBurnRpcRequired');this.#rpc=rpc;this.#policy=validateNativeFeePolicy(policy);
    check(this.#policy.sourcePolicy,'BurnFeeSourcePolicyRequired');
  }
  async observation() {
    const estimate=await this.#rpc.call('estimatesmartfee',[3,'ECONOMICAL']);
    const network=await this.#rpc.call('getnetworkinfo'),mempool=await this.#rpc.call('getmempoolinfo');
    return readNativeFeeObservation({estimateRaw:estimate.raw,networkRaw:network.raw,mempoolRaw:mempool.raw,policy:this.#policy});
  }
  get maximumRateAtomicPerKvB(){return this.#policy.maximumAtomicPerKvB;}
  async selectPlan({operationId,deposit,operationalScriptHex,feeCoins}) {
    const observation=await this.observation();
    const rate=quoteNativeMinerFee({policy:this.#policy,observation,virtualBytes:'1'}).rateAtomicPerKvB;
    for(let count=1;count<=Math.min(7,feeCoins.length);count++){
      try{
        const plan=planNativeBurn({operationId,inputs:[deposit,...feeCoins.slice(0,count)],operationalScriptHex,
          feePolicy:{minimumRateAtomicPerKvB:this.#policy.minimumRelayAtomicPerKvB,normalRateAtomicPerKvB:rate,
            maximumRateAtomicPerKvB:this.#policy.maximumAtomicPerKvB,maximumAbsoluteFeeAtomic:this.#policy.maximumFeeAtomic,
            dustRelayAtomicPerKvB:this.#policy.sourcePolicy.dustRelayAtomicPerKvB}});
        const quote=quoteNativeMinerFee({policy:this.#policy,observation,virtualBytes:plan.virtualBytes});
        check(plan.feeAtomic===quote.feeAtomic,'BurnFeeSizingChanged');return {plan,observation};
      }catch(error){if(error.message!=='NativeBurnFeeFundingInsufficient')throw error;}
    }
    throw new Error('BURN_OPERATIONAL_FEE_FUNDING_REQUIRED');
  }
  async verifyBeforeBroadcast(plan) {
    const observation=await this.observation(),quote=quoteNativeMinerFee({policy:this.#policy,observation,virtualBytes:plan.virtualBytes});
    // Persisted signed burns are never silently rebuilt for a fee bump. An
    // increase beyond the signed fee holds that exact operation for review.
    check(burnUint(plan.feeAtomic)>=burnUint(quote.feeAtomic)&&burnUint(plan.feeAtomic)<=burnUint(this.#policy.maximumFeeAtomic)&&
      burnUint(plan.feeRateAtomicPerKvB)<=burnUint(this.#policy.maximumAtomicPerKvB),'BURN_FEE_POLICY_EXCEPTION');
    return quote;
  }
}
