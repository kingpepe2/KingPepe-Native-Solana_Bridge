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
import {NativeBurnObserver} from '../../native/burn/burn-observer.mjs';
import {NativeBurnVerifier} from '../../native/burn/burn-evidence.mjs';
import {BurnSolanaAdapter} from '../../services/solana-observer/burn-solana-adapter.mjs';
import {ed25519} from '@noble/curves/ed25519.js';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {issueBurnDeposit,prepareBurnAuthorization,retainBurnAttestation,retainBurnSolanaPacket,markBurnSolanaPacket,retainBurnMint,completeBurnOperation} from '../../services/bridge-validator/burn-journal-state.mjs';
import {burnSolanaPlanOptions} from '../../services/relayer/burn-solana-signer.mjs';
import {base58Encode,prepareSignedLocalnetSolanaDepositClaimTransaction} from '../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
if(process.platform!=='win32')throw Error('WINDOWS_MAINNET_COMPOSITION_REQUIRES_WINDOWS');

test('protected production composition opens its own paused journal and cannot inherit TEST resume or plaintext RPC options',async t=>{
  const f=burnFixture({mainnet:true}),root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-mainnet-composition-')),sid=windowsCurrentServiceSid();
  const repoRoot=path.resolve(import.meta.dirname,'../..');let service;
  const priorEndpoint=process.env.SOLANA_MAINNET_RPC_URL;
  delete process.env.SOLANA_MAINNET_RPC_URL; // Runtime must use its DPAPI store.
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
  const solanaRpc=store('solana-rpc','BRIDGE_VALIDATOR','solana-rpc-url',Buffer.from('https://mainnet-fixture.invalid.example/'));
  const token=store('service-auth','BRIDGE_VALIDATOR','service-auth',randomBytes(32));
  const feePolicy={minimumRelayAtomicPerKvB:'100',normalAtomicPerKvB:'1000',maximumAtomicPerKvB:'10000000',maximumFeeAtomic:'5800000'};
  const options={stores,nativeRpcStore:rpc,solanaRpcStore:solanaRpc,nativeVerifierExecutable:path.join(root,'unused-verifier.exe'),policy:f.policy,solanaEndpoint:'ENV:SOLANA_MAINNET_RPC_URL',feePolicy};
  const file=path.join(root,'service.json'),c={runtime:options,accessTokenStore:token,port:54012,intervalMs:1000,productionReady:false,mainnetActivation:'DISABLED'};
  writeFileSync(file,JSON.stringify(c));assert.throws(()=>loadBurnServiceConfiguration(file),/EnvironmentRejected/);
  assert.equal(loadBurnServiceConfiguration(file,{mainnet:true}).runtime.policy.context.environment,'mainnet');
  await assert.rejects(openBurnServiceRuntime({...options,nativeRpcOptions:{}}),/FieldsRejected/);
  await assert.rejects(openBurnServiceRuntime({...options,solanaRpcStore:rpc}),/SolanaCredentialBinding/);
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
  await t.test('a Native lookup tip race withholds accounting and never authorizes processing or creates a persistent pause',async()=>{
    service.journal.update(s=>{s.mainnetControl=structuredClone(f.state.mainnetControl);s.operations=structuredClone(f.state.operations);s.paused=false;s.pauseReason='SYNTHETIC_READ_ONLY_REVIEW';});
    const before=service.journal.read();
    let code='NativeTransactionLookupSourceChanged';
    const observation=t.mock.method(NativeBurnObserver.prototype,'discover',async()=>{throw Error(code);});
    try{
      const health=await service.runtime.cycle({readOnly:true});
      assert.equal(health.state,'PENDING');assert.equal(health.reason,code);
      assert.equal(health.reconciliation,null);assert.equal(health.accounting,null);assert.equal(health.productionReady,false);
      assert.deepEqual(service.journal.read(),before);
      await assert.rejects(service.runtime.resumeReviewedMainnetRuntime(),/ReviewIncomplete/);
      await assert.rejects(service.runtime.activateUserFundedExecution(),/ReviewIncomplete|Activation/);
      service.journal.pause('OPERATOR_PAUSE');
      const paused=service.journal.read();
      await service.runtime.cycle({readOnly:true});
      assert.deepEqual(service.journal.read(),paused);
      for(code of ['NativeTransactionLookupSubstituted','NativeTransactionLookupBlockNotActive','BURN_MINT_RECONCILIATION_MISMATCH']){
        const failed=await service.runtime.cycle({readOnly:true});
        assert.equal(failed.state,'PAUSED');assert.equal(failed.accounting,null);
        assert.equal(service.journal.read().pauseReason,code.toUpperCase());
        assert.deepEqual(service.journal.read().operations,before.operations);
      }
    }finally{observation.mock.restore();}
  });
  await t.test('serialized accounting revalidates finalized receipts without rewriting them, preserves two legacy operations and stays inside the unchanged freshness budget',async()=>{
    f.finalize();const authorization=f.authorize();
    prepareBurnAuthorization(f.state,f.id,authorization.encodedMessageHex);retainBurnAttestation(f.state,f.id,authorization);
    const recentBlockhash=base58Encode(Buffer.alloc(32,1)),lastValidBlockHeight='301';
    const signed=await prepareSignedLocalnetSolanaDepositClaimTransaction({...burnSolanaPlanOptions({context:f.context,binding:f.binding,feePayerHex:f.policy.feePayerHex,...authorization,recentBlockhash,lastValidBlockHeight}),
      feePayerSigner:{publicKeyHex:f.policy.feePayerHex,sign:bytes=>ed25519.sign(bytes,f.payer)}});
    const packet={kind:'CLAIM',recentBlockhash,lastValidBlockHeight,messageDigestHex:decodeCanonicalBridgeMessage(Buffer.from(authorization.encodedMessageHex,'hex')).messageDigestHex,
      preparedTransactionBase64:signed.preparedTransactionBase64,signature:signed.signatures[0].signatureBase58};
    retainBurnSolanaPacket(f.state,f.id,packet);markBurnSolanaPacket(f.state,f.id,packet.signature,{outcome:'FINALIZED',sendAttempts:1,observedSlot:'21'});
    const receipt={operationId:f.id,amountAtomic:f.deposit.amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:packet.signature,slot:'21',commitment:'finalized'};
    retainBurnMint(f.state,f.id,receipt);completeBurnOperation(f.state,f.id);f.state.mainnetControl.mode='NORMAL';
    for(const n of [2,3])issueBurnDeposit(f.state,{...f.binding,nonce:Buffer.alloc(32,n).toString('hex')},20);
    f.state.paused=true;f.state.pauseReason='OPERATOR_PAUSE';service.journal.update(s=>Object.assign(s,structuredClone(f.state)));
    const before=service.journal.read(),updates=t.mock.method(service.journal,'update');
    let active=0,maximum=0,cycles=0,receipts=0,invalid=false;
    const mocks=[t.mock.method(NativeBurnObserver.prototype,'discover',async state=>{
      active++;maximum=Math.max(maximum,active);await delay(15);cycles++;
      return {tip:{height:44+cycles,hash:'11'.repeat(32)},cursor:state.nativeScan,observations:[],caughtUp:true};
    }),t.mock.method(NativeBurnObserver.prototype,'burnStatus',async()=>({found:true,confirmations:12+cycles})),
    t.mock.method(NativeBurnVerifier.prototype,'verifyFinalizedBurn',async()=>({evidence:f.evidence})),
    t.mock.method(BurnSolanaAdapter.prototype,'observe',async()=>({claimExists:true})),
    t.mock.method(BurnSolanaAdapter.prototype,'packetStatus',async()=>({status:{confirmationStatus:'finalized',err:null},observed:{slot:'100'}})),
    t.mock.method(BurnSolanaAdapter.prototype,'mintReceipt',async()=>{receipts++;return {...receipt,...(invalid?{signature:'3'.repeat(88)}:{})};}),
    t.mock.method(BurnSolanaAdapter.prototype,'deployment',async()=>{active--;return {managerMintedAtomic:f.deposit.amountAtomic,mintSupplyAtomic:f.deposit.amountAtomic};})];
    try{
      const started=performance.now();const results=await Promise.all([service.runtime.cycle({readOnly:true}),service.runtime.cycle({readOnly:true})]);
      assert(performance.now()-started<30000,'protected composition must finish within unchanged freshness budget');
      assert.equal(maximum,1);assert.equal(receipts,2);assert.equal(cycles,2);
      assert.equal(updates.mock.callCount(),0,'unchanged discovery and completed receipts must not rewrite protected state');
      for(const r of results){assert.equal(r.reconciliation,'MATCH');assert.equal(r.accounting.mintedAtomic,f.deposit.amountAtomic);assert.equal(r.productionReady,false);assert.equal(r.paused,true);}
      assert.deepEqual(service.journal.read().operations,before.operations);
      const reads=t.mock.method(service.journal,'read'),observedAt=results.at(-1).accounting.observedAt;
      try{
        for(let i=0;i<100;i++)assert.equal(service.runtime.status().accounting.observedAt,observedAt);
        assert.equal(reads.mock.callCount(),0,'status polling must not run synchronous DPAPI reads');
        const clock=t.mock.method(Date,'now',()=>observedAt+31259);
        try{
          assert.equal(service.runtime.status().accounting,null,'the captured success gap expires accounting, even with a cached public summary');
          assert.equal(service.runtime.status().productionReady,false);
        }finally{clock.mock.restore();}
      }finally{reads.mock.restore();}
      invalid=true;const failure=await service.runtime.cycle({readOnly:true});
      assert.equal(failure.accounting,null);assert.equal(failure.reason,'BurnJournalSecondMintRejected');
      assert.deepEqual(service.journal.read().operations,before.operations);
      assert.equal(service.runtime.status().executionPolicy,'LEGACY_OPERATOR_FUNDED');
      // Any real RPC/signing/submission path would have failed global fetch;
      // neither verification nor simulated tip movement creates an economic packet.
    }finally{updates.mock.restore();for(const mock of mocks)mock.mock.restore();}
  });
});
