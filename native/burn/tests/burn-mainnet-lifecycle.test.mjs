// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic Mainnet-shaped protocol tests; no real RPC, funding or burn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {burnFixture} from './burn-fixture.mjs';
import {initialBurnJournal,validateBurnJournalState,recordBurnDeposits,retainBurnMint,completeBurnOperation} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {beginMainnetControlled,adoptMainnetExactReceived,enableMainnetNormal,requireMainnetEconomicOperation,mainnetRuntimeFlags} from '../../../services/bridge-validator/burn-mainnet-lifecycle.mjs';
import {MAX_KPEPE_SUPPLY_ATOMIC} from '../../../shared/monetary-supply.mjs';
import {parseNativeTransactionHex} from '../../node/native-taproot-transaction.mjs';
import {verifyBurnDeploymentSnapshot} from '../../../services/solana-observer/burn-solana-adapter.mjs';
import {decodeBridgeAbi,encodeBridgeAbi} from '../../../shared/protocol/solana-bridge-abi.mjs';

test('Mainnet journal starts closed, rejects TEST relabeling and binds exactly one controlled operation across restart',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  const empty=initialBurnJournal(f.binding,f.state.deliveryPolicy);
  assert.equal(validateBurnJournalState(empty).mainnetControl.mode,'PREPARED');
  assert.throws(()=>requireMainnetEconomicOperation(empty,f.id),/NotActivated/);
  assert.throws(()=>validateBurnJournalState({...empty,paused:false}),/PreparedState/);
  const missing=structuredClone(empty);delete missing.mainnetControl;assert.throws(()=>validateBurnJournalState(missing),/FieldsRejected/);
  const loaded=validateBurnJournalState(JSON.parse(JSON.stringify(f.state)));
  recordBurnDeposits(loaded,f.id,[f.deposit]);
  requireMainnetEconomicOperation(loaded,f.id,'100000');
  assert.throws(()=>requireMainnetEconomicOperation(loaded,'ff'.repeat(32),'100000'),/ControlledOperationOnly/);
  assert.throws(()=>requireMainnetEconomicOperation(loaded,f.id,'100001'),/ReceivedAmountChanged/);
  assert.throws(()=>beginMainnetControlled(loaded,{destinationHex:f.binding.destination,nonce:f.binding.nonce,amountModel:'EXACT_RECEIVED'}),/AlreadyPrepared/);
  for(const key of ['nonce','destinationHex','operationId']){
    const changed=structuredClone(loaded);changed.mainnetControl.controlled[key]='ff'.repeat(32);
    assert.throws(()=>validateBurnJournalState(changed),/Controlled/);
  }
});

test('normal enablement requires the existing completed exact burn/mint; ambiguous Native response does not require a second burn',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  assert.throws(()=>enableMainnetNormal(f.state),/CompletionRequired/);
  f.finalize();assert.equal(f.state.operations[0].broadcastAccepted,false);
  assert.throws(()=>enableMainnetNormal(f.state),/CompletionRequired/);
  retainBurnMint(f.state,f.id,{operationId:f.id,amountAtomic:'100000',destination:f.binding.destination,mint:f.binding.mint,
    signature:'2'.repeat(88),commitment:'finalized',slot:'20'});
  assert.throws(()=>enableMainnetNormal(f.state),/CompletionRequired/);
  completeBurnOperation(f.state,f.id);enableMainnetNormal(f.state);
  const loaded=validateBurnJournalState(JSON.parse(JSON.stringify(f.state)));
  assert.equal(loaded.mainnetControl.mode,'NORMAL');assert.equal(loaded.operations.length,1);
  const health={healthy:true,fresh:true,reconciliation:'MATCH',programState:5};
  assert.deepEqual(mainnetRuntimeFlags(loaded,health),{productionReady:true,mainnetActivation:'ENABLED'});
  for(const patch of [{healthy:false},{fresh:false},{reconciliation:'FAIL'},{programState:4},{programState:0}])
    assert.equal(mainnetRuntimeFlags(loaded,{...health,...patch}).productionReady,false);
  loaded.paused=true;assert.equal(mainnetRuntimeFlags(loaded,health).mainnetActivation,'DISABLED');
});

test('controlled processing derives every amount from the received deposit, with separate fees and only the global cap',t=>{
  for(const amountAtomic of ['330','331','100000000000000',(MAX_KPEPE_SUPPLY_ATOMIC-1_000_000n).toString()]) {
    const f=burnFixture({mainnet:true,amountAtomic});t.after(f.destroy);
    assert.equal(f.state.mainnetControl.controlled.amountModel,'EXACT_RECEIVED');
    assert.equal(Object.hasOwn(f.state.mainnetControl.controlled,'amountAtomic'),false);
    f.finalize();requireMainnetEconomicOperation(f.state,f.id,amountAtomic);
    const burn=parseNativeTransactionHex(f.state.operations[0].signedBurnHex);
    assert.equal(burn.outputs[0].amountAtomic,amountAtomic);
    assert.equal(BigInt(f.plan.inputs[1].amountAtomic)-BigInt(burn.outputs[1].amountAtomic),BigInt(f.plan.feeAtomic));
    const receipt={operationId:f.id,amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:'2'.repeat(88),commitment:'finalized',slot:'20'};
    assert.throws(()=>retainBurnMint(f.state,f.id,{...receipt,amountAtomic:(BigInt(amountAtomic)-1n).toString()}),/MintBindingChanged/);
    retainBurnMint(f.state,f.id,receipt);completeBurnOperation(f.state,f.id);
    const changed=structuredClone(f.state);changed.operations[0].burnEvidence.amountAtomic=(BigInt(amountAtomic)+1n).toString();
    assert.throws(()=>enableMainnetNormal(changed),/CompletionRequired/);
    enableMainnetNormal(f.state);
    const restored=validateBurnJournalState(JSON.parse(JSON.stringify(f.state)));
    assert.equal(restored.operations[0].mintReceipt.amountAtomic,amountAtomic);
  }
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  recordBurnDeposits(f.state,f.id,[{...f.deposit,amountAtomic:MAX_KPEPE_SUPPLY_ATOMIC.toString()}]);
  requireMainnetEconomicOperation(f.state,f.id,MAX_KPEPE_SUPPLY_ATOMIC.toString());
  for(const amount of ['0','-1',(MAX_KPEPE_SUPPLY_ATOMIC+1n).toString()])
    assert.throws(()=>requireMainnetEconomicOperation(f.state,f.id,amount),/NativeBurn/);
  assert.equal(mainnetRuntimeFlags(f.state,{healthy:true,fresh:true,reconciliation:'MATCH',programState:4}).productionReady,false);
});

test('exact-received migration preserves the single unfunded operation and cannot change its destination or activate deposits',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  const legacy=structuredClone(f.state),a=legacy.mainnetControl.controlled;
  delete a.amountModel;a.amountAtomic='331';legacy.paused=true;
  const prior=validateBurnJournalState(JSON.parse(JSON.stringify(legacy))),before=structuredClone(prior);
  const requested={operationId:f.id,destinationHex:f.binding.destination,nonce:f.binding.nonce,amountModel:'EXACT_RECEIVED'};
  assert.throws(()=>requireMainnetEconomicOperation(prior,f.id),/ExactReceivedRequired/);
  for(const key of ['operationId','destinationHex','nonce'])
    assert.throws(()=>adoptMainnetExactReceived(structuredClone(prior),{...requested,[key]:'ff'.repeat(32)}),/BindingRejected/);
  for(const patch of [{paused:false},{operations:[]},{mainnetControl:{...prior.mainnetControl,mode:'NORMAL'}}])
    assert.throws(()=>adoptMainnetExactReceived({...structuredClone(prior),...patch},requested));
  const funded=structuredClone(prior);recordBurnDeposits(funded,f.id,[f.deposit]);
  assert.throws(()=>adoptMainnetExactReceived(funded,requested),/UnfundedControlledOperationRequired/);
  assert.equal(adoptMainnetExactReceived(prior,requested),f.id);
  assert.deepEqual(prior.operations,before.operations);assert.deepEqual(prior.deployment,before.deployment);
  assert.deepEqual(prior.deliveryPolicy,before.deliveryPolicy);assert.deepEqual(prior.nativeScan,before.nativeScan);
  assert.equal(prior.paused,true);assert.equal(prior.pauseReason,before.pauseReason);
  assert.deepEqual(prior.mainnetControl.controlled,requested);
  const restored=validateBurnJournalState(JSON.parse(JSON.stringify(prior)));
  assert.equal(adoptMainnetExactReceived(restored,requested),f.id);assert.equal(restored.operations.length,1);
  assert.throws(()=>enableMainnetNormal(restored),/CompletionRequired/);
  assert.equal(mainnetRuntimeFlags(restored,{healthy:true,fresh:true,reconciliation:'MATCH',programState:5}).productionReady,false);
});

test('new controlled operations reject requested amounts and unknown amount models',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  const empty=()=>initialBurnJournal(f.binding,f.state.deliveryPolicy);
  const input={destinationHex:f.binding.destination,nonce:f.binding.nonce,amountModel:'EXACT_RECEIVED'};
  for(const changed of [{...input,amountAtomic:'331'},{...input,maximumAmountAtomic:'331'},
    {...input,amountModel:'FIXED'},{destinationHex:input.destinationHex,nonce:input.nonce,amountAtomic:'331'}])
    assert.throws(()=>beginMainnetControlled(empty(),changed),/ExactReceivedRequired/);
  const state=empty();beginMainnetControlled(state,input);assert.equal(state.paused,true);assert.equal(state.operations.length,0);
});

test('production runtime verification accepts only its exact reviewed on-chain mode and artifacts',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  assert.equal(verifyBurnDeploymentSnapshot(f.policy,f.snapshot).managerMintedAtomic,'0');
  const changed=structuredClone(f.policy);changed.manifest.config.mainnetProgramState=5;changed.manifest.config.mainnetActivationEnabled=true;
  assert.throws(()=>verifyBurnDeploymentSnapshot(changed,f.snapshot),/SOLANA_DEPLOYMENT_CHANGED/);
  changed.artifacts.manager.sha256='ff'.repeat(32);
  assert.throws(()=>verifyBurnDeploymentSnapshot(changed,f.snapshot));
});

test('verifying initialized disabled production cannot open deposits or bypass controlled activation',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  const policy=structuredClone(f.policy),snapshot=structuredClone(f.snapshot);
  Object.assign(policy.manifest.config,{mainnetProgramState:1,depositsPaused:true,mainnetActivationEnabled:false});
  const bridge=decodeBridgeAbi('BridgeState',Buffer.from(snapshot.accounts[3].data[0],'base64'));
  bridge.state=1;bridge.config.policy.depositsPaused=true;
  snapshot.accounts[3].data[0]=encodeBridgeAbi('BridgeState',bridge).toString('base64');
  const journal=initialBurnJournal(f.binding,f.state.deliveryPolicy),before=JSON.stringify(journal);
  assert.equal(verifyBurnDeploymentSnapshot(policy,snapshot).managerMintedAtomic,'0');
  for(const programState of [0,1,4,5,255])assert.deepEqual(mainnetRuntimeFlags(journal,
    {healthy:true,fresh:true,reconciliation:'MATCH',programState}),{productionReady:false,mainnetActivation:'DISABLED'});
  assert.throws(()=>requireMainnetEconomicOperation(journal,f.id,'100000'),/NotActivated/);
  assert.throws(()=>enableMainnetNormal(journal),/ControlledCompletionRequired/);
  assert.equal(journal.paused,true);assert.equal(journal.mainnetControl.mode,'PREPARED');
  assert.equal(journal.operations.length,0);assert.equal(JSON.stringify(journal),before);
  // Even a manifest declaring CONTROLLED must match the actual disabled bytes.
  const relabeled=structuredClone(policy);Object.assign(relabeled.manifest.config,{mainnetProgramState:4,depositsPaused:false});
  assert.throws(()=>verifyBurnDeploymentSnapshot(relabeled,snapshot),/SOLANA_DEPLOYMENT_CHANGED/);
});
