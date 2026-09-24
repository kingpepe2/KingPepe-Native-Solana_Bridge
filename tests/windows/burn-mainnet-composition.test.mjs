// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real DPAPI, ephemeral synthetic Mainnet identities, no RPC or transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {burnFixture} from '../../native/burn/tests/burn-fixture.mjs';
import {initialBurnAuthorizations} from '../../native/burn/protected-burn-signer.mjs';
import {initialBurnAttesterState} from '../../services/attesters/protected-burn-attester.mjs';
import {initialBurnJournal} from '../../services/bridge-validator/burn-journal-state.mjs';
import {openBurnServiceRuntime} from '../../services/bridge-validator/burn-service-runtime.mjs';
import {loadBurnServiceConfiguration} from '../../services/bridge-validator/burn-service.mjs';
if(process.platform!=='win32')throw Error('WINDOWS_MAINNET_COMPOSITION_REQUIRES_WINDOWS');

test('protected production composition opens its own paused journal and cannot inherit TEST resume or plaintext RPC options',async t=>{
  const f=burnFixture({mainnet:true}),root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-mainnet-composition-')),sid=windowsCurrentServiceSid();
  const repoRoot=path.resolve(import.meta.dirname,'../..');let service;
  const priorEndpoint=process.env.SOLANA_MAINNET_RPC_URL;
  process.env.SOLANA_MAINNET_RPC_URL='https://mainnet-fixture.invalid.example/';
  t.mock.method(globalThis,'fetch',async()=>{throw Error('NO_NETWORK_IN_PROTECTED_COMPOSITION_TEST');});
  t.after(async()=>{await service?.close();f.destroy();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('kingpepe-mainnet-composition-'));rmSync(root,{recursive:true});
    if(priorEndpoint===undefined)delete process.env.SOLANA_MAINNET_RPC_URL;else process.env.SOLANA_MAINNET_RPC_URL=priorEndpoint;});
  const store=(name,role,purpose,payload)=>{
    const options={root:path.join(root,name),repoRoot,context:{role,purpose,serviceSid:sid,environment:'mainnet',nativeGenesis:f.binding.nativeGenesis,
      solanaDeployment:f.binding.solanaDeployment,instanceId:randomBytes(32).toString('hex'),keyEpoch:1}};
    try{WindowsProtectedStore.create(options,payload).close();}finally{payload.fill(0);}return options;
  };
  const stores={burnKey:store('burn-key','BURN_SIGNER','native-burn-key',Buffer.from(f.root)),
    burnState:store('burn-state','BURN_SIGNER','native-burn-authorizations',initialBurnAuthorizations(f.binding.burnPublicKey)),
    journal:store('journal','BRIDGE_VALIDATOR','burn-operations',Buffer.from(JSON.stringify(initialBurnJournal(f.binding,{context:f.context,feePayerHex:f.policy.feePayerHex})))),
    payer:store('payer','FEE_PAYER','fee-payer-seed',Buffer.from(f.payer))};
  for(const [i,role] of ['ATTESTER_A','ATTESTER_B'].entries()){
    stores['attesterKey'+i]=store('attester-key-'+i,role,'attester-seed',Buffer.from(f.attesters[i]));
    stores['attesterState'+i]=store('attester-state-'+i,role,'burn-attester-authorizations',initialBurnAttesterState(f.context,role));
  }
  const rpc=store('native-rpc','NATIVE_OBSERVER','native-rpc-auth',Buffer.from(JSON.stringify({endpoint:'http://127.0.0.1:18443',username:'isolated-test',password:randomBytes(32).toString('hex')})));
  const token=store('service-auth','BRIDGE_VALIDATOR','service-auth',randomBytes(32));
  const feePolicy={minimumRelayAtomicPerKvB:'100',normalAtomicPerKvB:'1000',maximumAtomicPerKvB:'10000000',maximumFeeAtomic:'5800000'};
  const options={stores,nativeRpcStore:rpc,nativeVerifierExecutable:path.join(root,'unused-verifier.exe'),policy:f.policy,solanaEndpoint:'ENV:SOLANA_MAINNET_RPC_URL',feePolicy};
  const file=path.join(root,'service.json'),c={runtime:options,accessTokenStore:token,port:54012,intervalMs:1000,productionReady:false,mainnetActivation:'DISABLED'};
  writeFileSync(file,JSON.stringify(c));assert.throws(()=>loadBurnServiceConfiguration(file),/EnvironmentRejected/);
  assert.equal(loadBurnServiceConfiguration(file,{mainnet:true}).runtime.policy.context.environment,'mainnet');
  await assert.rejects(openBurnServiceRuntime({...options,nativeRpcOptions:{}}),/FieldsRejected/);
  // Missing authoritative fee policy is rejected before any runtime is usable.
  await assert.rejects(openBurnServiceRuntime(options),/NativeFeePolicy|BurnFeeSourcePolicy/);
  // All leases opened before that failure must be released, including journal.
  const journal=new WindowsProtectedStore(stores.journal);const lease=await journal.acquireLease();await lease.close();journal.close();
  options.feePolicy={policy:'DYNAMIC_NODE_ESTIMATE_WITH_CAP',minimumRelayAtomicPerKvB:'100',maximumAtomicPerKvB:'10000000',maximumFeeAtomic:'5800000',
    sourcePolicy:{insufficientHistory:'LIVE_NODE_FLOORS_AND_NATIVE_WALLET_MINIMUM',walletMinimumAtomicPerKvB:'1000',dustRelayAtomicPerKvB:'3000',maximumBurnVirtualBytes:'580'}};
  service=await openBurnServiceRuntime(options);
  assert.equal(service.runtime.status().nativeNetwork,'MAINNET');assert.equal(service.runtime.status().activationMode,'PREPARED');
  assert.equal(service.api.getBridgeStatus().walletChain,'solana:mainnet');assert.equal(service.runtime.status().productionReady,false);
  await assert.rejects(service.runtime.resumeReviewedTestRuntime(),/TestResumeRejected/);
  await assert.rejects(service.runtime.createOperation({destinationHex:f.binding.destination,nonce:f.binding.nonce}),/PublicAdmissionClosed/);
  await assert.rejects(service.runtime.enableNormalMainnet(),/ReviewIncomplete/);
  assert.throws(()=>service.journal.update(s=>{s.mainnetControl.mode='NORMAL'}),/ControlledBindingRejected/);
  assert.equal(service.journal.read().mainnetControl.mode,'PREPARED');
});
