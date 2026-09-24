// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Durable activation bookkeeping. Chain/signing verification remains in the
// concrete runtime; these transitions grant no RPC or signing capability.
import {burnHash,burnAmount,burnOperationId,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {NATIVE_MAINNET_GENESIS} from '../../shared/network-identity.mjs';

export function initialMainnetLifecycle(){return {mode:'PREPARED',controlled:null};}
export function validateMainnetLifecycle(state) {
  const c=state.mainnetControl;
  check(state.deployment.nativeGenesis===NATIVE_MAINNET_GENESIS&&c&&
    Object.keys(c).sort().join()==='controlled,mode'&&['PREPARED','CONTROLLED','NORMAL'].includes(c.mode),'BurnMainnetLifecycleRejected');
  if(c.mode==='PREPARED') {
    check(c.controlled===null&&state.operations.length===0&&state.paused,'BurnMainnetPreparedStateRejected');return c;
  }
  const a=c.controlled;
  check(a&&Object.keys(a).sort().join()==='amountAtomic,destinationHex,nonce,operationId','BurnMainnetControlledBindingRejected');
  burnAmount(a.amountAtomic);burnHash(a.destinationHex);burnHash(a.nonce);burnHash(a.operationId);
  check(burnOperationId({...state.deployment,destination:a.destinationHex,nonce:a.nonce})===a.operationId,'BurnMainnetControlledBindingRejected');
  if(c.mode==='CONTROLLED')check(state.operations.length<=1&&state.operations.every(op=>op.operationId===a.operationId),'BurnMainnetControlledOperationOnly');
  else requireCompletedControlledOperation(state);
  return c;
}
export function beginMainnetControlled(state,{destinationHex,nonce,amountAtomic}) {
  validateMainnetLifecycle(state);
  check(state.mainnetControl.mode==='PREPARED'&&state.operations.length===0,'BurnMainnetControlledAlreadyPrepared');
  burnHash(destinationHex);burnHash(nonce);burnAmount(amountAtomic);
  const operationId=burnOperationId({...state.deployment,destination:destinationHex,nonce});
  state.mainnetControl={mode:'CONTROLLED',controlled:{operationId,destinationHex,nonce,amountAtomic}};
  return operationId;
}
export function requireMainnetEconomicOperation(state,operationId,amountAtomic=null) {
  if(state.deployment.nativeGenesis!==NATIVE_MAINNET_GENESIS)return;
  const c=validateMainnetLifecycle(state);
  check(c.mode!=='PREPARED','BurnMainnetNotActivated');
  if(c.mode==='CONTROLLED') {
    check(operationId===c.controlled.operationId,'BurnMainnetControlledOperationOnly');
    if(amountAtomic!==null)check(amountAtomic===c.controlled.amountAtomic,'BurnMainnetControlledAmountChanged');
  }
}
export function requireCompletedControlledOperation(state) {
  const c=state.mainnetControl.controlled,op=state.operations.find(op=>op.operationId===c?.operationId);
  check(op&&op.state==='COMPLETED'&&op.retired&&op.broadcastAttempted&&op.burnEvidence&&op.mintReceipt&&
    op.binding.destination===c.destinationHex&&op.binding.nonce===c.nonce&&
    op.deposit.amountAtomic===c.amountAtomic&&op.burnEvidence.amountAtomic===c.amountAtomic&&
    op.mintReceipt.amountAtomic===c.amountAtomic,'BurnMainnetControlledCompletionRequired');
  return op;
}
export function enableMainnetNormal(state) {
  validateMainnetLifecycle(state);requireCompletedControlledOperation(state);
  check(!state.operations.some(op=>op.exception),'BurnMainnetExceptionUnresolved');
  state.mainnetControl.mode='NORMAL';
}
export function mainnetRuntimeFlags(state,{healthy,fresh,reconciliation,programState}) {
  const enabled=state.mainnetControl?.mode==='NORMAL'&&!state.paused&&healthy&&fresh&&
    reconciliation==='MATCH'&&programState===5;
  return {productionReady:enabled,mainnetActivation:enabled?'ENABLED':'DISABLED'};
}
