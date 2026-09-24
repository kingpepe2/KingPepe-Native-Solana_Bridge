// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic Mainnet-shaped RPC fixtures. No network, real signing key or burn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {burnFixture} from './burn-fixture.mjs';
import {NativeRpcClient} from '../../node/native-rpc-client.mjs';
import {NativeBurnObserver} from '../burn-observer.mjs';
import {NativeBurnVerifier,validateNativeBurnNetwork} from '../burn-evidence.mjs';
import {burnDepositDestination,burnOperationalDestination,signNativeBurnWithKey} from '../burn-key.mjs';
import {burnOperationId,planNativeBurn,validateBurnPlanBlockHints} from '../burn-protocol.mjs';
import {validateBurnContext} from '../../../services/bridge-validator/burn-context.mjs';
import {initialBurnJournal,issueBurnDeposit,recordBurnDeposits,retainBurnPlan,validateBurnJournalState} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {beginMainnetControlled} from '../../../services/bridge-validator/burn-mainnet-lifecycle.mjs';
import {BurnSolanaRpc} from '../../../services/solana-observer/burn-solana-rpc.mjs';
import {base58Encode,base58Decode} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {NATIVE_MAINNET_GENESIS,NATIVE_MAINNET_DOMAIN,SOLANA_MAINNET_GENESIS,SOLANA_DEVNET_GENESIS,mainnetDeploymentIdentity} from '../../../shared/network-identity.mjs';
const h=s=>createHash('sha256').update('PublicMainnetFixture:'+s).digest('hex');
const nativeValue=atomic=>{const n=BigInt(atomic);return `${n/100000000n}.${(n%100000000n).toString().padStart(8,'0')}`;};
function fixture(){
 const f=burnFixture(),binding={...f.binding,nativeGenesis:NATIVE_MAINNET_GENESIS,nativeNetwork:NATIVE_MAINNET_DOMAIN,
  solanaGenesis:Buffer.from(base58Decode(SOLANA_MAINNET_GENESIS)).toString('hex')};
 binding.solanaDeployment=mainnetDeploymentIdentity({manager:base58Encode(Buffer.from(binding.bridgeProgram,'hex')),
  transceiver:base58Encode(Buffer.from(binding.transceiverProgram,'hex')),mint:base58Encode(Buffer.from(binding.mint,'hex'))});
 const {destination,nonce,...deployment}=binding,context={...f.context,environment:'mainnet',deployment};
 const deposit=burnDepositDestination(binding),fees=burnOperationalDestination(binding),operationId=burnOperationId(binding);
 const plan=planNativeBurn({operationId,operationalScriptHex:fees.scriptPubKeyHex,inputs:[
  {...f.plan.inputs[0],scriptPubKeyHex:deposit.scriptPubKeyHex},{...f.plan.inputs[1],scriptPubKeyHex:fees.scriptPubKeyHex}],
  feePolicy:{minimumRateAtomicPerKvB:'100',normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:'10000000',maximumAbsoluteFeeAtomic:'5800000',dustRelayAtomicPerKvB:'3000'}});
 return {f,binding,context,plan,deposit,fees};
}
test('Mainnet burn context binds actual genesis, magic domain, both programs, Mint and cluster',()=>{
 const x=fixture();try{
  assert.deepEqual(validateBurnContext(x.context),x.context);
  for(const patch of [{nativeGenesis:x.f.binding.nativeGenesis},{nativeNetwork:8000111},{solanaGenesis:x.f.binding.solanaGenesis},
    {solanaDeployment:h('different')},{bridgeProgram:h('different')},{transceiverProgram:h('different')},{mint:h('different')}])
    assert.throws(()=>validateBurnContext({...x.context,deployment:{...x.context.deployment,...patch}}));
  for(const environment of ['devnet','localnet'])assert.throws(()=>validateBurnContext({...x.context,environment}));
  assert(x.deposit.address.startsWith('kpepe1p'));assert(x.fees.address.startsWith('kpepe1p'));
  assert.notEqual(burnDepositDestination({...x.binding,nonce:h('next')}).address,x.deposit.address);
  assert.notEqual(burnDepositDestination({...x.binding,destination:h('recipient')}).address,x.deposit.address);
 }finally{x.f.destroy();}
});
test('Mainnet admission rejects REGTEST, wrong genesis, catch-up and malformed chain state',()=>{
 const c={chain:'main',blocks:200,headers:200,initialblockdownload:false};
 assert.equal(validateNativeBurnNetwork(c,NATIVE_MAINNET_GENESIS,'mainnet'),c);
 for(const patch of [{chain:'regtest'},{headers:201},{initialblockdownload:true},{headers:199},{blocks:0.5}])
  assert.throws(()=>validateNativeBurnNetwork({...c,...patch},NATIVE_MAINNET_GENESIS,'mainnet'));
 assert.throws(()=>validateNativeBurnNetwork(c,h('wrong'),'mainnet'));
});
function rpcFixture(x){
 let spent=false,wrongGenesis=false;const calls=[],tip=h('tip'),block=h('funding-block');
 const signed=signNativeBurnWithKey({rootSecret:x.f.root,binding:x.binding,plan:x.plan});
 const client=new NativeRpcClient({fetchFn:async(_url,init)=>{
  const q=JSON.parse(init.body),[a,b,c]=q.params;calls.push({method:q.method,params:q.params});let result,error=null;
  if(q.method==='getblockchaininfo')result={chain:'main',blocks:211,headers:211,bestblockhash:tip,initialblockdownload:false,chainwork:h('work')};
  else if(q.method==='getblockhash')result=a===0?(wrongGenesis?h('wrong'):NATIVE_MAINNET_GENESIS):a===211?tip:block;
  else if(q.method==='gettxout'){
   const input=x.plan.inputs.find(i=>i.txid===a&&i.vout===b);
   result=spent?null:{bestblock:tip,confirmations:12,coinbase:false,value:nativeValue(input?.amountAtomic??x.plan.changeAtomic),
    scriptPubKey:{hex:input?.scriptPubKeyHex??x.fees.scriptPubKeyHex}};
  }else if(q.method==='getrawtransaction'){
   if(c===undefined)error={code:-5,message:'No transaction index'};
   else result={txid:x.plan.txid,hex:signed,blockhash:block,confirmations:12,in_active_chain:true};
  }else if(q.method==='getblockheader')result={hash:block,height:200,confirmations:12};
  else throw Error('UnexpectedReadOnlyFixtureCall');
  return Response.json({id:q.id,result,error});
 }});
 return {client,calls,block,spent:v=>{spent=v},wrongGenesis:v=>{wrongGenesis=v}};
}
test('Mainnet plans retain spent-input block locations across journal restart before burn',async()=>{
 const x=fixture();try{const r=rpcFixture(x),observer=new NativeBurnObserver(r.client,'mainnet');
  const plan=await observer.preparePlan(x.plan);assert.deepEqual(validateBurnPlanBlockHints(plan),Object.fromEntries(plan.inputs.map(i=>[i.txid,r.block])));
  const state=initialBurnJournal(x.binding,{context:x.context,feePayerHex:x.f.policy.feePayerHex});
  beginMainnetControlled(state,{destinationHex:x.binding.destination,nonce:x.binding.nonce,amountAtomic:x.f.deposit.amountAtomic});state.paused=false;
  const op=issueBurnDeposit(state,x.binding,199);
  recordBurnDeposits(state,op.operationId,[{...x.f.deposit,blockHash:r.block,height:200,confirmations:12}]);
  retainBurnPlan(state,op.operationId,plan);
  assert.deepEqual(validateBurnJournalState(JSON.parse(JSON.stringify(state))).operations[0].plan.transactionBlockHints,plan.transactionBlockHints);
  for(const transactionBlockHints of [undefined,{}, {[plan.inputs[0].txid]:r.block}, {...plan.transactionBlockHints,extra:r.block}])
   assert.throws(()=>validateBurnPlanBlockHints({...plan,transactionBlockHints}));
  r.wrongGenesis(true);await assert.rejects(observer.preparePlan(x.plan),/NETWORK_MISMATCH/);
 }finally{x.f.destroy();}
});
test('no-index burn recovery uses operational change then retained finalized block; a miss is not absence',async()=>{
 const x=fixture();try{const r=rpcFixture(x),observer=new NativeBurnObserver(r.client,'mainnet');
  assert.equal((await observer.burnStatus(x.plan)).confirmations,12);
  assert(r.calls.some(c=>c.method==='getrawtransaction'&&c.params[2]===r.block));
  r.spent(true);assert.equal((await observer.burnStatus(x.plan,r.block)).found,true);
  const pending=await observer.burnStatus(x.plan);assert.equal(pending.found,false);assert.equal(pending.transactionAbsenceProven,false);
  assert(!r.calls.some(c=>c.method==='sendrawtransaction'));
  const verifier=new NativeBurnVerifier({rpc:r.client,executable:'C:/unexecuted-test-verifier.exe',environment:'mainnet'});
  await assert.rejects(verifier.verifyDepositAdmission({binding:x.binding,plan:x.plan}),/BlockHintsRequired/);
 }finally{x.f.destroy();}
});
test('protected Mainnet Solana binding validates cluster before every request and never leaks its URL',async t=>{
 const prior=process.env.SOLANA_MAINNET_RPC_URL,endpoint='https://mainnet.invalid.example/private-marker';
 try{
  process.env.SOLANA_MAINNET_RPC_URL=endpoint;
  const rpc=new BurnSolanaRpc({environment:'mainnet',endpoint:'ENV:SOLANA_MAINNET_RPC_URL',expectedGenesis:SOLANA_MAINNET_GENESIS});
  const calls=[];let genesis=SOLANA_MAINNET_GENESIS,fail=false;
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,endpoint);const q=JSON.parse(init.body);calls.push(q.method);
   if(fail)throw Error(endpoint);return Response.json({jsonrpc:'2.0',id:q.id,result:q.method==='getGenesisHash'?genesis:'ok'});});
  assert.equal(await rpc.call('getHealth'),'ok');assert.deepEqual(calls.splice(0),['getGenesisHash','getHealth','getGenesisHash']);
  genesis=SOLANA_DEVNET_GENESIS;await assert.rejects(rpc.call('getHealth'),/^Error: BURN_SOLANA_NETWORK_MISMATCH$/);assert.deepEqual(calls.splice(0),['getGenesisHash']);
  genesis=SOLANA_MAINNET_GENESIS;fail=true;await assert.rejects(rpc.call('getHealth'),/^Error: BURN_SOLANA_RPC_UNAVAILABLE$/);
  assert.throws(()=>new BurnSolanaRpc({environment:'mainnet',endpoint,expectedGenesis:SOLANA_MAINNET_GENESIS}),/ProtectedMainnetEndpoint/);
 }finally{if(prior===undefined)delete process.env.SOLANA_MAINNET_RPC_URL;else process.env.SOLANA_MAINNET_RPC_URL=prior;}
});
