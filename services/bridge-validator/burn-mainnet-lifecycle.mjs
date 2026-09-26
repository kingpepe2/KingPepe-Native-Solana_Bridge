// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Durable activation bookkeeping. Chain/signing verification remains in the
// concrete runtime; these transitions grant no RPC or signing capability.
import {burnHash,burnAmount,burnOperationId,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {NATIVE_MAINNET_GENESIS} from '../../shared/network-identity.mjs';

export function initialMainnetLifecycle(){return {mode:'PREPARED',controlled:null};}
export const MAINNET_DEPOSIT_AMOUNT_MODEL='EXACT_RECEIVED';
const exactReceived=a=>a?.amountModel===MAINNET_DEPOSIT_AMOUNT_MODEL;
export function validateMainnetLifecycle(state) {
  const c=state.mainnetControl;
  check(state.deployment.nativeGenesis===NATIVE_MAINNET_GENESIS&&c&&
    Object.keys(c).sort().join()==='controlled,mode'&&['PREPARED','CONTROLLED','NORMAL'].includes(c.mode),'BurnMainnetLifecycleRejected');
  if(c.mode==='PREPARED') {
    check(c.controlled===null&&state.operations.length===0&&state.paused,'BurnMainnetPreparedStateRejected');return c;
  }
  const a=c.controlled;
  const fields=a&&Object.keys(a).sort().join();
  // Retain old journals for explicit local migration and historical evidence.
  // Legacy fixed-amount records cannot authorize controlled economic actions.
  check(fields==='amountAtomic,destinationHex,nonce,operationId'||
    fields==='amountModel,destinationHex,nonce,operationId'&&exactReceived(a),'BurnMainnetControlledBindingRejected');
  if(!exactReceived(a))burnAmount(a.amountAtomic);
  burnHash(a.destinationHex);burnHash(a.nonce);burnHash(a.operationId);
  check(burnOperationId({...state.deployment,destination:a.destinationHex,nonce:a.nonce})===a.operationId,'BurnMainnetControlledBindingRejected');
  if(c.mode==='CONTROLLED')check(state.operations.length<=1&&state.operations.every(op=>op.operationId===a.operationId),'BurnMainnetControlledOperationOnly');
  else requireCompletedControlledOperation(state);
  return c;
}
export function beginMainnetControlled(state,input) {
  validateMainnetLifecycle(state);
  check(state.mainnetControl.mode==='PREPARED'&&state.operations.length===0,'BurnMainnetControlledAlreadyPrepared');
  check(input&&Object.keys(input).sort().join()==='amountModel,destinationHex,nonce'&&exactReceived(input),'BurnMainnetExactReceivedRequired');
  const {destinationHex,nonce,amountModel}=input;
  burnHash(destinationHex);burnHash(nonce);
  const operationId=burnOperationId({...state.deployment,destination:destinationHex,nonce});
  state.mainnetControl={mode:'CONTROLLED',controlled:{operationId,destinationHex,nonce,amountModel}};
  return operationId;
}
export function adoptMainnetExactReceived(state,input) {
  const c=validateMainnetLifecycle(state),a=c.controlled;
  check(input&&Object.keys(input).sort().join()==='amountModel,destinationHex,nonce,operationId'&&exactReceived(input),'BurnMainnetExactReceivedRequired');
  check(c.mode==='CONTROLLED'&&state.paused&&state.operations.length===1&&a&&
    ['operationId','destinationHex','nonce'].every(k=>input[k]===a[k]),'BurnMainnetControlledBindingRejected');
  const op=state.operations[0];
  check(op.operationId===a.operationId&&op.binding.destination===a.destinationHex&&op.binding.nonce===a.nonce&&
    op.state==='DEPOSIT_ADDRESS_ISSUED'&&op.deposit===null&&op.plan===null&&op.signedBurnHex===null&&
    !op.broadcastAttempted&&!op.broadcastAccepted&&op.burnEvidence===null&&op.attestationDraftHex===null&&
    op.attestation===null&&op.priorAttestations.length===0&&op.solanaPacket===null&&op.mintReceipt===null&&
    op.exception===null&&!op.retired,'BurnMainnetUnfundedControlledOperationRequired');
  state.mainnetControl.controlled={operationId:a.operationId,destinationHex:a.destinationHex,nonce:a.nonce,amountModel:MAINNET_DEPOSIT_AMOUNT_MODEL};
  return a.operationId;
}
export function requireMainnetEconomicOperation(state,operationId,amountAtomic=null) {
  if(state.deployment.nativeGenesis!==NATIVE_MAINNET_GENESIS)return;
  const c=validateMainnetLifecycle(state);
  check(c.mode!=='PREPARED','BurnMainnetNotActivated');
  if(c.mode==='CONTROLLED') {
    check(operationId===c.controlled.operationId,'BurnMainnetControlledOperationOnly');
    check(exactReceived(c.controlled),'BurnMainnetExactReceivedRequired');
  }
  if(amountAtomic!==null) {
    burnAmount(amountAtomic);
    check(state.operations.find(op=>op.operationId===operationId)?.deposit?.amountAtomic===amountAtomic,'BurnMainnetReceivedAmountChanged');
  }
}
export function requireCompletedControlledOperation(state) {
  const c=state.mainnetControl.controlled,op=state.operations.find(op=>op.operationId===c?.operationId);
  check(op&&op.state==='COMPLETED'&&op.retired&&op.broadcastAttempted&&op.burnEvidence&&op.mintReceipt&&
    op.binding.destination===c.destinationHex&&op.binding.nonce===c.nonce&&
    op.deposit&&op.deposit.confirmations>=12&&
    op.deposit.amountAtomic===op.burnEvidence.amountAtomic&&op.deposit.amountAtomic===op.mintReceipt.amountAtomic&&
    (exactReceived(c)||op.deposit.amountAtomic===c.amountAtomic),'BurnMainnetControlledCompletionRequired');
  burnAmount(op.deposit.amountAtomic);
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
