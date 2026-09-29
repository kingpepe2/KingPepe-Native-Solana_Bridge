// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real DPAPI journal and the real runtime, synthetic Mainnet-shaped identities,
// mocked chain reads and broadcasts. No network, no production store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519.js';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {burnFixture} from '../../native/burn/tests/burn-fixture.mjs';
import {planNativeBurn} from '../../native/burn/burn-protocol.mjs';
import {burnDepositDestination,burnOperationalDestination,signNativeBurnWithKey} from '../../native/burn/burn-key.mjs';
import {initialBurnAuthorizations,ProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {initialBurnAttesterState,ProtectedBurnAttester} from '../../services/attesters/protected-burn-attester.mjs';
import {initialBurnJournal,issueBurnDeposit,recordBurnDeposits,prepareBurnAuthorization,retainBurnAttestation,retainBurnSolanaPacket,
  markBurnSolanaPacket,retainBurnMint,completeBurnOperation,burnReserveCommitments} from '../../services/bridge-validator/burn-journal-state.mjs';
import {openBurnServiceRuntime} from '../../services/bridge-validator/burn-service-runtime.mjs';
import {NativeBurnObserver} from '../../native/burn/burn-observer.mjs';
import {NativeBurnVerifier} from '../../native/burn/burn-evidence.mjs';
import {NativeBurnFeePolicy} from '../../native/burn/burn-fees.mjs';
import {BurnSolanaAdapter,burnReserveEnvelope} from '../../services/solana-observer/burn-solana-adapter.mjs';
import {ProtectedBurnSolanaSigner,associatedTokenCreationMessage,burnSolanaPlanOptions} from '../../services/relayer/burn-solana-signer.mjs';
import {base58Encode,prepareSignedLocalnetSolanaDepositClaimTransaction} from '../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
if(process.platform!=='win32')throw Error('WINDOWS_RESERVE_RUNTIME_REQUIRES_WINDOWS');

const hash=s=>createHash('sha256').update('ReserveRuntime:'+s).digest('hex'),hex=b=>Buffer.from(b).toString('hex');
const KPEPE=100_000_000n,kpepe=n=>(BigInt(n)*KPEPE).toString();
const quote={feeLamports:'5000',rents:{0:'890880',240:'2561280',211:'2359440',73:'1398960',165:'2039280'}};
const ENVELOPE=burnReserveEnvelope(quote);

async function composition(t) {
  const f=burnFixture({mainnet:true}),root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-reserve-runtime-')),sid=windowsCurrentServiceSid();
  const repoRoot=path.resolve(import.meta.dirname,'../..'),events=[],world={balance:0n,slot:1000,minted:f.deposit.amountAtomic,tokenAccounts:new Set(),broadcasts:[],sent:[],burned:new Set(),
    plans:new Map(),blocks:new Map(),clock:0,feeValue:5000,discoverFailure:null,onDiscover:null,onPlan:null,staleBalance:false};
  // Normal public operation requires the active on-chain program state.
  Object.assign(f.policy.manifest.config,{mainnetProgramState:5,mainnetActivationEnabled:true});
  const prior=process.env.SOLANA_MAINNET_RPC_URL;delete process.env.SOLANA_MAINNET_RPC_URL;
  const now=Date.now.bind(Date);t.mock.method(Date,'now',()=>now()+world.clock);
  const rpc=(method,params)=>{
    if(method==='getGenesisHash')return f.manifest.solanaGenesis;
    if(method==='getHealth')return 'ok';
    if(method==='getLatestBlockhash')return {context:{slot:world.slot},value:{blockhash:base58Encode(Buffer.alloc(32,(world.slot%200)+1)),lastValidBlockHeight:world.slot+150}};
    if(method==='getFeeForMessage')return {context:{slot:world.slot},value:world.feeValue};
    if(method==='getMinimumBalanceForRentExemption')return Number(quote.rents[params[0]]);
    if(method==='getBalance')return {context:{slot:world.staleBalance?0:++world.slot},value:Number(world.balance)};
    throw Error('UNEXPECTED_TEST_RPC_METHOD_'+method);
  };
  t.mock.method(globalThis,'fetch',async(_url,request)=>{const r=JSON.parse(request.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result:rpc(r.method,r.params)}));});
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
  const options={stores,nativeRpcStore:store('native-rpc','NATIVE_OBSERVER','native-rpc-auth',Buffer.from(JSON.stringify({endpoint:'http://127.0.0.1:18443',username:'isolated-test',password:randomBytes(32).toString('hex')}))),
    solanaRpcStore:store('solana-rpc','BRIDGE_VALIDATOR','solana-rpc-url',Buffer.from('https://mainnet-fixture.invalid.example/')),
    nativeVerifierExecutable:path.join(root,'unused-verifier.exe'),policy:f.policy,solanaEndpoint:'ENV:SOLANA_MAINNET_RPC_URL',
    feePolicy:{policy:'DYNAMIC_NODE_ESTIMATE_WITH_CAP',minimumRelayAtomicPerKvB:'100',maximumAtomicPerKvB:'10000000',maximumFeeAtomic:'5800000',
      sourcePolicy:{insufficientHistory:'LIVE_NODE_FLOORS_AND_NATIVE_WALLET_MINIMUM',walletMinimumAtomicPerKvB:'1000',dustRelayAtomicPerKvB:'3000',maximumBurnVirtualBytes:'580'}}};
  // The already completed controlled operation, exactly as production holds one.
  f.finalize();const authorization=f.authorize();
  prepareBurnAuthorization(f.state,f.id,authorization.encodedMessageHex);retainBurnAttestation(f.state,f.id,authorization);
  const recentBlockhash=base58Encode(Buffer.alloc(32,1)),lastValidBlockHeight='301';
  const signed=await prepareSignedLocalnetSolanaDepositClaimTransaction({...burnSolanaPlanOptions({context:f.context,binding:f.binding,feePayerHex:f.policy.feePayerHex,...authorization,recentBlockhash,lastValidBlockHeight}),
    feePayerSigner:{publicKeyHex:f.policy.feePayerHex,sign:bytes=>ed25519.sign(bytes,f.payer)}});
  const claim={kind:'CLAIM',recentBlockhash,lastValidBlockHeight,messageDigestHex:decodeCanonicalBridgeMessage(Buffer.from(authorization.encodedMessageHex,'hex')).messageDigestHex,
    preparedTransactionBase64:signed.preparedTransactionBase64,signature:signed.signatures[0].signatureBase58};
  retainBurnSolanaPacket(f.state,f.id,claim);markBurnSolanaPacket(f.state,f.id,claim.signature,{outcome:'FINALIZED',sendAttempts:1,observedSlot:'21'});
  const receipt={operationId:f.id,amountAtomic:f.deposit.amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:claim.signature,slot:'21',commitment:'finalized'};
  retainBurnMint(f.state,f.id,receipt);completeBurnOperation(f.state,f.id);f.state.mainnetControl.mode='NORMAL';
  const base=structuredClone(f.state);
  // A further operation with its finalized deposit. Its plan is what the
  // mocked fee policy will select when the runtime reaches it.
  const add=(state,n,amountAtomic,{tokenAccount=true}={})=>{
    const binding={...f.binding,destination:hex(ed25519.getPublicKey(ed25519.utils.randomSecretKey())),nonce:hash('nonce'+n)};
    const id=issueBurnDeposit(state,binding,20).operationId,fees=burnOperationalDestination(binding);
    const deposit={txid:hash('deposit'+n),vout:0,amountAtomic,blockHash:hash('deposit-block'+n),height:21,confirmations:12};
    recordBurnDeposits(state,id,[deposit]);world.blocks.set(id,deposit.blockHash);
    world.plans.set(id,planNativeBurn({operationId:id,inputs:[{txid:deposit.txid,vout:0,amountAtomic,scriptPubKeyHex:burnDepositDestination(binding).scriptPubKeyHex},
      {txid:hash('fee-coin'+n),vout:0,amountAtomic:'1000000',scriptPubKeyHex:fees.scriptPubKeyHex}],operationalScriptHex:fees.scriptPubKeyHex,
      feePolicy:{minimumRateAtomicPerKvB:'100',normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:'1000000',maximumAbsoluteFeeAtomic:'580000',dustRelayAtomicPerKvB:'3000'}}));
    if(tokenAccount)world.tokenAccounts.add(binding.destination);
    return {id,binding,deposit};
  };
  t.mock.method(NativeBurnObserver.prototype,'discover',async state=>{
    if(world.discoverFailure)throw Error(world.discoverFailure);world.onDiscover?.();
    return {tip:{height:50,hash:'11'.repeat(32)},cursor:state.nativeScan,observations:[],caughtUp:true};
  });
  t.mock.method(NativeBurnObserver.prototype,'burnStatus',async plan=>plan.txid===f.plan.txid?{found:true,confirmations:40}:
    world.burned.has(plan.txid)?{found:true,confirmations:1}:{found:false,confirmations:0});
  t.mock.method(NativeBurnObserver.prototype,'operationalCoins',async()=>[]);
  t.mock.method(NativeBurnObserver.prototype,'preparePlan',async plan=>({...plan,transactionBlockHints:Object.fromEntries(plan.inputs.map(i=>[i.txid,world.blocks.get(plan.operationId)]))}));
  t.mock.method(NativeBurnObserver.prototype,'broadcast',async plan=>{world.broadcasts.push(plan.operationId);world.burned.add(plan.txid);});
  t.mock.method(NativeBurnVerifier.prototype,'verifyFinalizedBurn',async()=>({evidence:f.evidence}));
  t.mock.method(NativeBurnVerifier.prototype,'verifyDepositAdmission',async()=>({synthetic:true}));
  t.mock.method(NativeBurnFeePolicy.prototype,'selectPlan',async({operationId})=>{world.onPlan?.();return {plan:world.plans.get(operationId)};});
  t.mock.method(NativeBurnFeePolicy.prototype,'verifyBeforeBroadcast',async()=>{});
  t.mock.method(ProtectedNativeBurnSigner.prototype,'sign',({binding,plan})=>signNativeBurnWithKey({rootSecret:f.root,binding,plan}));
  t.mock.method(ProtectedBurnAttester.prototype,'reserve',async()=>{});
  t.mock.method(ProtectedBurnSolanaSigner.prototype,'prepare',async({kind,binding,recentBlockhash,lastValidBlockHeight})=>{
    assert.equal(kind,'ATA');const {message}=associatedTokenCreationMessage({binding,feePayerHex:f.policy.feePayerHex,recentBlockhash,lastValidBlockHeight}),signature=ed25519.sign(message,f.payer);
    return {kind,recentBlockhash,lastValidBlockHeight,messageDigestHex:null,signature:base58Encode(signature),preparedTransactionBase64:Buffer.concat([Buffer.of(1),Buffer.from(signature),message]).toString('base64')};
  });
  t.mock.method(BurnSolanaAdapter.prototype,'observe',async(binding,_plan,attestation)=>attestation?{claimExists:true}:
    {managerMintedAtomic:world.minted,ataExists:world.tokenAccounts.has(binding.destination),claimExists:false,receiptExists:false,slot:String(world.slot)});
  t.mock.method(BurnSolanaAdapter.prototype,'packetStatus',async(packet,binding)=>packet.kind==='ATA'?
    {status:null,observed:{slot:String(world.slot)},exists:world.tokenAccounts.has(binding.destination),expired:false}:
    {status:{confirmationStatus:'finalized',err:null},observed:{slot:'100'}});
  t.mock.method(BurnSolanaAdapter.prototype,'mintReceipt',async()=>receipt);
  t.mock.method(BurnSolanaAdapter.prototype,'deployment',async()=>({managerMintedAtomic:world.minted,mintSupplyAtomic:world.minted}));
  t.mock.method(BurnSolanaAdapter.prototype,'send',async packet=>{world.sent.push(packet.kind);events.push({event:'TEST_SOLANA_SEND',kind:packet.kind});});
  let service=await openBurnServiceRuntime(options,event=>events.push(event));
  t.after(async()=>{await service?.close();f.destroy();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('kingpepe-reserve-runtime-'));rmSync(root,{recursive:true});
    if(prior===undefined)delete process.env.SOLANA_MAINNET_RPC_URL;else process.env.SOLANA_MAINNET_RPC_URL=prior;});
  return {f,world,events,add,base,
    get service(){return service;},
    load(state){service.journal.update(s=>{for(const key of Object.keys(s))delete s[key];Object.assign(s,structuredClone(state));});},
    // Process loss: every lease is released and the journal is reopened from disk.
    async restart(){await service.close();service=null;service=await openBurnServiceRuntime(options,event=>events.push(event));},
    op(id){return service.journal.read().operations.find(o=>o.operationId===id);},
    names(){return events.map(e=>e.event);}};
}

test('concurrent operations cannot consume the same reserve, across restarts and until the mint',async t=>{
  const c=await composition(t),{world,events}=c,state=structuredClone(c.base);state.paused=false;state.pauseReason='MAINNET_REVIEWED_RESUME';
  const small=c.add(state,1,kpepe(999)),a=c.add(state,2,kpepe(1000)),b=c.add(state,3,kpepe(1001)),d=c.add(state,4,kpepe(1500));
  c.load(state);world.balance=ENVELOPE*2n+ENVELOPE/2n; // covers two, not three

  let status=await c.service.runtime.cycle();
  assert.deepEqual(world.broadcasts,[a.id,b.id]);
  for(const op of [a,b]){const record=c.op(op.id);assert.equal(record.state,'BURN_BROADCAST');assert.equal(record.reserve.lamports,ENVELOPE.toString());
    assert.equal(record.plan.inputs[0].amountAtomic,op.deposit.amountAtomic);}
  // The third was measured against what the first two left.
  const third=c.op(d.id);assert.equal(third.state,'BURN_READY');assert.equal(Object.hasOwn(third,'reserve'),false);assert.equal(third.signedBurnHex,null);
  assert.equal(status.state,'PENDING');assert.equal(status.reason,'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED');assert.equal(status.paused,false);
  assert(events.some(e=>e.event==='PROCESSING_HELD'&&e.operationId===d.id&&e.reason==='BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'));
  assert.deepEqual(burnReserveCommitments(c.service.journal.read()),{committedLamports:(ENVELOPE*2n).toString(),activeCommitments:2});
  // Below the minimum: nothing planned, signed, committed or paid.
  const held=c.op(small.id);assert.equal(held.state,'DEPOSIT_FINALIZED');assert.equal(held.plan,null);assert.equal(Object.hasOwn(held,'reserve'),false);
  assert(events.some(e=>e.event==='DEPOSIT_BELOW_MINIMUM'&&e.operationId===small.id));
  const shown=c.service.runtime.operation(small.id);
  assert.equal(shown.minimumDepositAtomic,kpepe(1000));assert.equal(shown.depositBelowMinimum,true);assert.equal(shown.remainingDepositAtomic,kpepe(1));
  assert.equal(shown.amountAtomic,kpepe(999));assert.equal(shown.burnTxid,null);assert.equal(shown.reserveCommitted,false);
  const eligible=c.service.runtime.operation(d.id);assert.equal(eligible.depositBelowMinimum,false);assert.equal(eligible.remainingDepositAtomic,'0');
  assert.deepEqual(world.sent,[]);

  // Restart and crash after the Native burns: the commitments are on disk.
  for(let n=0;n<2;n++){
    await c.restart();
    assert.deepEqual(burnReserveCommitments(c.service.journal.read()),{committedLamports:(ENVELOPE*2n).toString(),activeCommitments:2});
    status=await c.service.runtime.cycle();
    assert.deepEqual(world.broadcasts,[a.id,b.id],'no second burn and no third burn');
    assert.equal(Object.hasOwn(c.op(d.id),'reserve'),false);assert.equal(status.reason,'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED');
  }
  const published=c.service.api.getBridgeStatus();
  assert.equal(published.minimumDepositAtomic,kpepe(1000));assert.equal(published.bridgeFeeAtomic,'0');assert.equal(published.executionPolicy,'LEGACY_OPERATOR_FUNDED');
  assert.equal(published.reserveCommittedLamports,(ENVELOPE*2n).toString());assert.equal(published.reserveActiveCommitments,2);

  // The burned, unminted operations keep their SOL even when the balance
  // would otherwise cover the third: only the remainder is available.
  world.balance=ENVELOPE*3n-1n;await c.service.runtime.cycle();
  assert.deepEqual(world.broadcasts,[a.id,b.id]);assert.equal(Object.hasOwn(c.op(d.id),'reserve'),false);
  world.balance=ENVELOPE*3n;status=await c.service.runtime.cycle();
  assert.deepEqual(world.broadcasts,[a.id,b.id,d.id]);assert.equal(c.op(d.id).reserve.lamports,ENVELOPE.toString());
  assert.equal(c.op(d.id).plan.inputs[0].amountAtomic,kpepe(1500));
  assert.equal(status.state,'HEALTHY');assert.equal(status.reserve.committedLamports,(ENVELOPE*3n).toString());
  // The production model never changes to user funding through this runtime.
  await assert.rejects(c.service.runtime.activateUserFundedExecution(),{message:'ExecutionUserFundedDisabled'});
  assert.equal(c.service.journal.read().execution,undefined);
});

test('the commitment is durable before any SOL is spent on the token account',async t=>{
  const c=await composition(t),{world,events}=c,state=structuredClone(c.base);state.paused=false;state.pauseReason='MAINNET_REVIEWED_RESUME';
  const a=c.add(state,1,kpepe(1000),{tokenAccount:false}),b=c.add(state,2,kpepe(2000),{tokenAccount:false});
  c.load(state);world.balance=ENVELOPE*2n-1n;
  await c.service.runtime.cycle();
  assert.deepEqual(world.sent,['ATA'],'only the committed operation may pay for its token account');
  assert.equal(c.op(a.id).reserve.lamports,ENVELOPE.toString());assert.equal(c.op(a.id).solanaPacket.length,1);
  assert.equal(Object.hasOwn(c.op(b.id),'reserve'),false);assert.equal(c.op(b.id).solanaPacket,null);
  const order=events.filter(e=>['RESERVE_COMMITTED','TEST_SOLANA_SEND','ATA_BROADCAST'].includes(e.event)).map(e=>e.event);
  assert.deepEqual(order,['RESERVE_COMMITTED','TEST_SOLANA_SEND','ATA_BROADCAST']);
  assert.deepEqual(world.broadcasts,[],'no burn before the token account exists');
  // The account now exists and its rent has left the balance. The committed
  // operation is still admitted; the other still is not.
  world.tokenAccounts.add(a.binding.destination);world.balance-=2039280n+5000n;
  await c.restart();await c.service.runtime.cycle();
  assert.deepEqual(world.broadcasts,[a.id]);assert.deepEqual(world.sent,['ATA']);
  assert.equal(Object.hasOwn(c.op(b.id),'reserve'),false);
});

test('stale accounting, a mismatch, ambiguity or inconsistent history admit no burn',async t=>{
  const c=await composition(t),{world}=c,state=structuredClone(c.base);state.paused=false;state.pauseReason='MAINNET_REVIEWED_RESUME';
  const a=c.add(state,1,kpepe(1000)),ambiguous=c.add(state,2,kpepe(1000));
  recordBurnDeposits(state,ambiguous.id,[ambiguous.deposit,{...ambiguous.deposit,txid:hash('second-payment')}]);
  c.load(state);world.balance=ENVELOPE*4n;
  const unburned=()=>{assert.deepEqual(world.broadcasts,[]);assert.deepEqual(world.sent,[]);assert.equal(c.op(a.id).signedBurnHex,null);assert.equal(c.op(a.id).broadcastAttempted,false);};

  // Accounting verified at the start of the cycle is 30 s old by the time the
  // operation is reached: it waits for the next cycle and nothing is paused.
  world.onPlan=()=>{world.clock+=30001;};
  let status=await c.service.runtime.cycle();world.onPlan=null;
  assert.equal(status.state,'PENDING');assert.equal(status.reason,'BURN_ACCOUNTING_NOT_FRESH');assert.equal(status.paused,false);
  assert.equal(Object.hasOwn(c.op(a.id),'reserve'),false);unburned();
  // It becomes stale only between the reserve commitment and the signature.
  let discoveries=0;world.onDiscover=()=>{if(++discoveries===2)world.clock+=30001;};
  status=await c.service.runtime.cycle();world.onDiscover=null;
  assert.equal(status.reason,'BURN_ACCOUNTING_NOT_FRESH');assert.equal(c.service.journal.read().paused,false);
  assert.equal(c.op(a.id).reserve.lamports,ENVELOPE.toString());unburned();
  // Exactly at the limit is still fresh; one millisecond more is not.
  assert.equal(c.service.runtime.status().accounting,null);

  // A balance observation older than the verified snapshot.
  world.staleBalance=true;status=await c.service.runtime.cycle();world.staleBalance=false;
  assert.equal(status.reason,'BURN_SOLANA_BALANCE_UNAVAILABLE');unburned();
  assert.equal(c.service.journal.read().paused,true);
  c.service.journal.update(s=>{s.paused=false;s.pauseReason='MAINNET_REVIEWED_RESUME';});
  // A failed fee quote.
  world.feeValue=0;status=await c.service.runtime.cycle();world.feeValue=5000;
  assert.equal(status.reason,'BURN_SOLANA_FEE_QUOTE_UNAVAILABLE');assert.equal(status.state,'PENDING');unburned();
  // The balance fell after the commitment was taken.
  world.balance=ENVELOPE-2039280n-1n;status=await c.service.runtime.cycle();
  assert.equal(status.reason,'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED');unburned();world.balance=ENVELOPE*4n;

  // Genuine reconciliation mismatch.
  const minted=world.minted;world.minted=(BigInt(minted)+1n).toString();
  status=await c.service.runtime.cycle();world.minted=minted;
  assert.equal(status.state,'PAUSED');assert.equal(c.service.journal.read().pauseReason,'BURN_MINT_RECONCILIATION_MISMATCH');unburned();
  await c.service.runtime.cycle();unburned();
  c.service.journal.update(s=>{s.paused=false;s.pauseReason='MAINNET_REVIEWED_RESUME';});
  // Inconsistent historical Native evidence, and a harmless tip race.
  world.discoverFailure='NativeTransactionLookupSubstituted';status=await c.service.runtime.cycle();
  assert.equal(status.state,'PAUSED');assert.equal(c.service.journal.read().pauseReason,'NATIVETRANSACTIONLOOKUPSUBSTITUTED');unburned();
  c.service.journal.update(s=>{s.paused=false;s.pauseReason='MAINNET_REVIEWED_RESUME';});
  world.discoverFailure='NativeTransactionLookupSourceChanged';status=await c.service.runtime.cycle();world.discoverFailure=null;
  assert.equal(status.state,'PENDING');assert.equal(c.service.journal.read().paused,false);unburned();

  // The ambiguous operation is never planned, committed or burned.
  const record=c.op(ambiguous.id);assert.equal(record.exception.reason,'MULTIPLE_DEPOSITS_REQUIRE_REVIEW');assert.equal(record.plan,null);assert.equal(Object.hasOwn(record,'reserve'),false);
  // With every gate satisfied the same operation proceeds, once.
  status=await c.service.runtime.cycle();
  assert.deepEqual(world.broadcasts,[a.id]);assert.equal(status.state,'HEALTHY');
  await c.service.runtime.cycle();assert.deepEqual(world.broadcasts,[a.id]);
  assert.deepEqual(burnReserveCommitments(c.service.journal.read()),{committedLamports:ENVELOPE.toString(),activeCommitments:1});
});

test('a paused runtime commits nothing and leaves the journal readable by the prior release',async t=>{
  const c=await composition(t),{world}=c,state=structuredClone(c.base);
  // As production holds it: completed before commitments existed.
  delete state.operations[0].reserve;
  state.paused=false;state.pauseReason='MAINNET_REVIEWED_RESUME';const a=c.add(state,1,kpepe(5000));
  state.paused=true;state.pauseReason='OPERATOR_PAUSE';c.load(state);world.balance=ENVELOPE*4n;
  const before=c.service.journal.read();
  for(let n=0;n<3;n++){const status=await c.service.runtime.cycle();assert.equal(status.state,'PAUSED');assert.equal(status.reconciliation,'MATCH');
    assert.deepEqual(status.reserve,{committedLamports:'0',activeCommitments:0});assert.equal(status.minimumDepositAtomic,kpepe(1000));}
  assert.deepEqual(c.service.journal.read(),before);assert.deepEqual(world.broadcasts,[]);assert.deepEqual(world.sent,[]);
  assert.equal(c.op(a.id).plan,null);
  assert(!JSON.stringify(c.service.journal.read()).includes('"reserve"'));
});
