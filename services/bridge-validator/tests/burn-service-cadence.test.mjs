// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runBurnReconciliationLoop} from '../burn-service.mjs';

async function schedule(durations,{verified=true}={}){
  const controller=new AbortController(),starts=[],successes=[],waits=[];let now=0,active=0,maximum=0;
  await runBurnReconciliationLoop({intervalMs:5000,signal:controller.signal,clock:()=>now,
    runtime:{async cycle(){
      starts.push(now);maximum=Math.max(maximum,++active);await Promise.resolve();now+=durations[starts.length-1];active--;
      if(verified)successes.push(now);
      return {state:verified?'PAUSED':'PENDING',reason:verified?'OPERATOR_PAUSE':'NATIVE_RPC_UNAVAILABLE',reconciliation:verified?'MATCH':null,accounting:verified?{observedAt:now}:null};
    }},wait:async ms=>{waits.push(ms);now+=ms;if(starts.length===durations.length)controller.abort();}});
  return {starts,successes,waits,maximum};
}
test('long verified work does not add the old five-second sleep that crossed the 30-second freshness budget',async()=>{
  const work=26259,oldSuccessGap=work+5000;
  assert.equal(oldSuccessGap,31259);assert(oldSuccessGap>30000);
  const r=await schedule([work,work,work]);
  assert.equal(r.maximum,1);assert.deepEqual(r.waits,[1,1,1]);
  assert.deepEqual(r.successes.slice(1).map((s,i)=>s-r.successes[i]),[26260,26260]);
});
test('warm verification has margin while quick cycles remain rate limited and errors retain retry backoff',async()=>{
  const warm=await schedule([15499,15499,15499]);
  assert(warm.successes[1]-warm.successes[0]<20000);assert.equal(warm.maximum,1);
  const quick=await schedule([100,100,100]);assert.deepEqual(quick.starts,[0,5000,10000]);
  const failed=await schedule([26259,26259],{verified:false});assert.deepEqual(failed.successes,[]);assert.deepEqual(failed.waits,[5000,5000]);
});
test('a slow or failed verification is never relabeled fresh by the scheduler and shutdown drains the cycle',async()=>{
  const slow=await schedule([31000,31000]);assert(slow.successes[1]-slow.successes[0]>30000);
  const controller=new AbortController();let calls=0,completed=false;
  await runBurnReconciliationLoop({intervalMs:5000,signal:controller.signal,runtime:{async cycle(){
    calls++;controller.abort();await Promise.resolve();completed=true;return {reconciliation:null,accounting:null};
  }},wait:async(_ms,_value,{signal})=>{assert(signal.aborted);throw Object.assign(Error('aborted'),{name:'AbortError'});}});
  assert.equal(calls,1);assert(completed);
  await assert.rejects(runBurnReconciliationLoop({intervalMs:5000,runtime:{cycle:async()=>{throw Error('VerificationFailure');}}}),/VerificationFailure/);
});
