// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readNativeFeeObservation,quoteNativeMinerFee} from '../../node/native-fee-policy.mjs';
import {nativeBurnSourceFeePolicy} from '../burn-source-policy.mjs';
import {burnFixture} from './burn-fixture.mjs';
import {planNativeBurn} from '../burn-protocol.mjs';
const raw=result=>JSON.stringify({error:null,result});
const policy={policy:'DYNAMIC_NODE_ESTIMATE_WITH_CAP',minimumRelayAtomicPerKvB:'100',maximumAtomicPerKvB:'1000000',maximumFeeAtomic:'580000',
  sourcePolicy:{insufficientHistory:'LIVE_NODE_FLOORS_AND_NATIVE_WALLET_MINIMUM',walletMinimumAtomicPerKvB:'1000',dustRelayAtomicPerKvB:'3000',maximumBurnVirtualBytes:'580'}};
const input={policy,networkRaw:raw({relayfee:0.000001}),mempoolRaw:raw({mempoolminfee:0.000001,minrelaytxfee:0.000001,loaded:true})};
test('actual Native insufficient-history targets 0 and 3 use live floors plus the source wallet minimum',()=>{
  for(const blocks of [0,3,1008]){
    const observation=readNativeFeeObservation({...input,estimateRaw:raw({errors:['Insufficient data or no feerate found'],blocks})});
    assert.equal(observation.rateSource,'LIVE_NODE_FLOORS_AND_NATIVE_WALLET_MINIMUM');
    assert.equal(quoteNativeMinerFee({policy,observation,virtualBytes:'235'}).feeAtomic,'235');
  }
  for(const blocks of [-1,1.5,1009,'3'])assert.throws(()=>readNativeFeeObservation({...input,estimateRaw:raw({errors:['Insufficient data or no feerate found'],blocks})}));
  assert.throws(()=>readNativeFeeObservation({...input,estimateRaw:raw({errors:['Method not found'],blocks:3})}));
  assert.throws(()=>readNativeFeeObservation({...input,policy:{...policy,sourcePolicy:undefined},estimateRaw:raw({errors:['Insufficient data or no feerate found'],blocks:3})}));
});
test('normal node estimate and stronger live mempool minimum are integer quoted; excessive fees hold',()=>{
  const observation=readNativeFeeObservation({...input,estimateRaw:raw({feerate:0.00002000,blocks:3}),mempoolRaw:raw({mempoolminfee:0.00003001,minrelaytxfee:0.000001,loaded:true})});
  assert.equal(quoteNativeMinerFee({policy,observation,virtualBytes:'235'}).feeAtomic,'706');
  assert.throws(()=>quoteNativeMinerFee({policy,observation:{...observation,effectiveFloorAtomicPerKvB:'1000001'},virtualBytes:'235'}),/ReviewRequired/);
  assert.throws(()=>quoteNativeMinerFee({policy,observation,virtualBytes:'581'}),/ReviewRequired/);
});

test('source-derived fee ceilings cover measured two through eight input burns without reducing the deposit',()=>{
  const f=burnFixture(),p=nativeBurnSourceFeePolicy();
  try{
    assert.equal(p.maximumAtomicPerKvB,'10000000');assert.equal(p.maximumFeeAtomic,'5800000');
    const observation=readNativeFeeObservation({...input,policy:p,estimateRaw:raw({errors:['Insufficient data or no feerate found'],blocks:3})});
    for(let count=2;count<=8;count++){
      const inputs=[f.plan.inputs[0],...Array.from({length:count-1},(_,i)=>({...f.plan.inputs[1],txid:(i+60).toString(16).padStart(2,'0').repeat(32)}))];
      const plan=planNativeBurn({operationId:f.id,inputs,operationalScriptHex:f.plan.operationalScriptHex,
        feePolicy:{minimumRateAtomicPerKvB:p.minimumRelayAtomicPerKvB,normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:p.maximumAtomicPerKvB,
          maximumAbsoluteFeeAtomic:p.maximumFeeAtomic,dustRelayAtomicPerKvB:p.sourcePolicy.dustRelayAtomicPerKvB}});
      const quote=quoteNativeMinerFee({policy:p,observation,virtualBytes:plan.virtualBytes});
      assert.equal(plan.feeAtomic,quote.feeAtomic);assert.equal(plan.inputs[0].amountAtomic,'100000');
      if(count===2)assert.equal(plan.virtualBytes,'235');if(count===8)assert.equal(plan.virtualBytes,'580');
    }
  }finally{f.destroy();}
});
