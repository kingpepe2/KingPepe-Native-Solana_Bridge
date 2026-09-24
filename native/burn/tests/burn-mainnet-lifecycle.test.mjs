// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic Mainnet-shaped protocol tests; no real RPC, funding or burn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {burnFixture} from './burn-fixture.mjs';
import {initialBurnJournal,validateBurnJournalState,retainBurnMint,completeBurnOperation} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {beginMainnetControlled,enableMainnetNormal,requireMainnetEconomicOperation,mainnetRuntimeFlags} from '../../../services/bridge-validator/burn-mainnet-lifecycle.mjs';
import {verifyBurnDeploymentSnapshot} from '../../../services/solana-observer/burn-solana-adapter.mjs';

test('Mainnet journal starts closed, rejects TEST relabeling and binds exactly one controlled operation across restart',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  const empty=initialBurnJournal(f.binding,f.state.deliveryPolicy);
  assert.equal(validateBurnJournalState(empty).mainnetControl.mode,'PREPARED');
  assert.throws(()=>requireMainnetEconomicOperation(empty,f.id),/NotActivated/);
  assert.throws(()=>validateBurnJournalState({...empty,paused:false}),/PreparedState/);
  const missing=structuredClone(empty);delete missing.mainnetControl;assert.throws(()=>validateBurnJournalState(missing),/FieldsRejected/);
  const loaded=validateBurnJournalState(JSON.parse(JSON.stringify(f.state)));
  requireMainnetEconomicOperation(loaded,f.id,'100000');
  assert.throws(()=>requireMainnetEconomicOperation(loaded,'ff'.repeat(32),'100000'),/ControlledOperationOnly/);
  assert.throws(()=>requireMainnetEconomicOperation(loaded,f.id,'100001'),/ControlledAmountChanged/);
  assert.throws(()=>beginMainnetControlled(loaded,{destinationHex:f.binding.destination,nonce:f.binding.nonce,amountAtomic:'100000'}),/AlreadyPrepared/);
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

test('production runtime verification accepts only its exact reviewed on-chain mode and artifacts',t=>{
  const f=burnFixture({mainnet:true});t.after(f.destroy);
  assert.equal(verifyBurnDeploymentSnapshot(f.policy,f.snapshot).managerMintedAtomic,'0');
  const changed=structuredClone(f.policy);changed.manifest.config.mainnetProgramState=5;changed.manifest.config.mainnetActivationEnabled=true;
  assert.throws(()=>verifyBurnDeploymentSnapshot(changed,f.snapshot),/SOLANA_DEPLOYMENT_CHANGED/);
  changed.artifacts.manager.sha256='ff'.repeat(32);
  assert.throws(()=>verifyBurnDeploymentSnapshot(changed,f.snapshot));
});
