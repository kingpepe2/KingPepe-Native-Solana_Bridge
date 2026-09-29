// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic keys and amounts. No network beyond a loopback TEST transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519.js';
import {burnFixture,FIXTURE_RESERVE} from './burn-fixture.mjs';
import {burnOperationId,planNativeBurn,nativeBurnCommitment} from '../burn-protocol.mjs';
import {burnDepositDestination,burnOperationalDestination,signNativeBurnWithKey} from '../burn-key.mjs';
import {issueBurnDeposit,recordBurnDeposits,retainBurnPlan,retainBurnReserve,retainSignedBurn,markBurnBroadcast,retainFinalBurn,
  retainBurnMint,completeBurnOperation,burnReserveCommitments,minimumBurnDepositAtomic,validateBurnJournalState} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {BurnSolanaAdapter,burnReserveEnvelope,burnReserveRemaining,requireBurnReserveAvailable} from '../../../services/solana-observer/burn-solana-adapter.mjs';
import {MIN_BRIDGE_DEPOSIT_ATOMIC,MIN_BRIDGE_DEPOSIT_KPEPE} from '../../../shared/monetary-supply.mjs';

const hash=s=>createHash('sha256').update('ReserveFixture:'+s).digest('hex'),hex=b=>Buffer.from(b).toString('hex');
const reload=state=>validateBurnJournalState(JSON.parse(JSON.stringify(state)));
const KPEPE=100_000_000n,kpepe=n=>(BigInt(n)*KPEPE).toString();
const quote={feeLamports:'5000',rents:{0:'890880',240:'2561280',211:'2359440',73:'1398960',165:'2039280'}};
const ENVELOPE=burnReserveEnvelope(quote);
const held=balance=>({lamports:ENVELOPE.toString(),balanceLamports:String(balance),slot:'10'});
// Another operation of the same deployment, with its own wallet, deposit and fee coin.
function operation(f,n,amountAtomic='100000') {
  const binding={...f.binding,destination:hex(ed25519.getPublicKey(ed25519.utils.randomSecretKey())),nonce:hash('nonce'+n)};
  const id=issueBurnDeposit(f.state,binding,20).operationId,fees=burnOperationalDestination(binding);
  const deposit={txid:hash('deposit'+n),vout:0,amountAtomic,blockHash:hash('deposit-block'+n),height:21,confirmations:12};
  const plan=planNativeBurn({operationId:id,inputs:[{txid:deposit.txid,vout:0,amountAtomic,scriptPubKeyHex:burnDepositDestination(binding).scriptPubKeyHex},
    {txid:hash('fee-coin'+n),vout:0,amountAtomic:'1000000',scriptPubKeyHex:fees.scriptPubKeyHex}],operationalScriptHex:fees.scriptPubKeyHex,
    feePolicy:{minimumRateAtomicPerKvB:'100',normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:'1000000',maximumAbsoluteFeeAtomic:'580000',dustRelayAtomicPerKvB:'3000'}});
  const evidence={binding,operationId:id,deposit:{txid:deposit.txid,vout:0},depositHeight:21,depositBlockHash:deposit.blockHash,burn:{txid:plan.txid,vout:0},
    burnHeight:33,burnBlockHash:hash('burn-block'+n),amountAtomic,burnCommitment:nativeBurnCommitment({operationId:id,deposit:{txid:deposit.txid,vout:0},amountAtomic})};
  recordBurnDeposits(f.state,id,[deposit]);retainBurnPlan(f.state,id,plan);
  const mint={operationId:id,amountAtomic,destination:binding.destination,mint:binding.mint,signature:String(n+2).repeat(88).slice(0,88),commitment:'finalized',slot:'123'};
  return {id,binding,plan,deposit,evidence,mint,burn:state=>{retainSignedBurn(state,id,signNativeBurnWithKey({rootSecret:f.root,binding,plan}));markBurnBroadcast(state,id,true);}};
}
function competing(t,count) {
  const f=burnFixture();t.after(f.destroy);
  return {f,ops:Array.from({length:count},(_,n)=>operation(f,n+1))};
}

test('the former whole-balance rule admitted every operation against the same reserve',()=>{
  // Reproduction of the defect in the prior release: each operation was
  // compared with the entire balance and nothing was held for the others.
  const balance=ENVELOPE.toString(),former=()=>requireBurnReserveAvailable({balanceLamports:balance,committedElsewhereLamports:'0',requiredLamports:ENVELOPE.toString()});
  assert.equal(former(),balance);assert.equal(former(),balance);assert.equal(former(),balance);
  // The same balance, measured after the first operation's commitment.
  assert.throws(()=>requireBurnReserveAvailable({balanceLamports:balance,committedElsewhereLamports:ENVELOPE.toString(),requiredLamports:ENVELOPE.toString()}),
    {message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
});

test('one operation is admitted only by a sufficient reserve',t=>{
  const {f,ops:[a]}=competing(t,1);
  assert.throws(()=>retainBurnReserve(f.state,a.id,held(ENVELOPE-1n)),/BurnReserveAmountRejected/);
  assert.equal(f.state.operations.find(o=>o.operationId===a.id).reserve,undefined);
  assert.throws(()=>a.burn(f.state),{message:'BURN_RESERVE_COMMITMENT_REQUIRED'});
  assert.equal(f.state.operations.find(o=>o.operationId===a.id).signedBurnHex,null);
  retainBurnReserve(f.state,a.id,held(ENVELOPE));a.burn(f.state);
  assert.deepEqual(burnReserveCommitments(f.state),{committedLamports:ENVELOPE.toString(),activeCommitments:1});
});

test('two operations both burn only when the reserve covers both',t=>{
  const {f,ops:[a,b]}=competing(t,2),balance=ENVELOPE*2n;
  retainBurnReserve(f.state,a.id,held(balance));retainBurnReserve(f.state,b.id,held(balance));
  a.burn(f.state);b.burn(f.state);
  assert.deepEqual(burnReserveCommitments(reload(f.state)),{committedLamports:(ENVELOPE*2n).toString(),activeCommitments:2});
});

test('two operations competing for a reserve that covers one: exactly one burns',t=>{
  const {f,ops:[a,b]}=competing(t,2),balance=ENVELOPE*2n-1n;
  retainBurnReserve(f.state,a.id,held(balance));
  assert.throws(()=>retainBurnReserve(f.state,b.id,held(balance)),{message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
  a.burn(f.state);
  assert.throws(()=>b.burn(f.state),{message:'BURN_RESERVE_COMMITMENT_REQUIRED'});
  const state=reload(f.state),second=state.operations.find(o=>o.operationId===b.id);
  assert.equal(second.signedBurnHex,null);assert.equal(second.broadcastAttempted,false);assert.equal(second.state,'BURN_READY');
  assert.equal(burnReserveCommitments(state).activeCommitments,1);
  // Order does not matter: whichever is measured second is refused.
  const other=competing(t,2),[c,d]=other.ops;
  retainBurnReserve(other.f.state,d.id,held(balance));
  assert.throws(()=>retainBurnReserve(other.f.state,c.id,held(balance)),{message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
});

test('three operations competing for a limited reserve never hold more than the balance',t=>{
  const {f,ops}=competing(t,3),balance=ENVELOPE*2n+ENVELOPE/2n;let admitted=0;
  for(const op of ops){try{retainBurnReserve(f.state,op.id,held(balance));op.burn(f.state);admitted++;}catch(error){assert.match(error.message,/^BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED$/);}}
  assert.equal(admitted,2);
  const {committedLamports,activeCommitments}=burnReserveCommitments(reload(f.state));
  assert.equal(activeCommitments,2);assert(BigInt(committedLamports)<=balance);
  // A later, larger balance admits the third without disturbing the others.
  const third=ops.find(op=>!f.state.operations.find(o=>o.operationId===op.id).reserve);
  retainBurnReserve(f.state,third.id,held(ENVELOPE*3n));third.burn(f.state);
  assert.equal(burnReserveCommitments(reload(f.state)).committedLamports,(ENVELOPE*3n).toString());
});

test('a commitment survives restart before burn, after burn and while burned but unminted',t=>{
  const {f,ops:[a,b]}=competing(t,2),balance=ENVELOPE*2n-1n;
  retainBurnReserve(f.state,a.id,held(balance));
  // Restart or crash before the burn is signed.
  let state=reload(f.state);assert.deepEqual(state.operations.find(o=>o.operationId===a.id).reserve,held(balance));
  assert.throws(()=>retainBurnReserve(state,b.id,held(balance)),{message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
  // Crash after the Native burn was signed and broadcast.
  a.burn(state);state=reload(state);assert.equal(burnReserveCommitments(state).committedLamports,ENVELOPE.toString());
  // Burned and finalized, mint still outstanding, across further restarts.
  retainFinalBurn(state,a.id,a.evidence);
  for(let n=0;n<3;n++){state=reload(state);assert.equal(state.operations.find(o=>o.operationId===a.id).state,'BURN_FINALIZED');
    assert.equal(burnReserveCommitments(state).committedLamports,ENVELOPE.toString());
    assert.throws(()=>retainBurnReserve(state,b.id,held(balance)),{message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});}
  assert.deepEqual(reload(state),state);
});

test('only completion after the finalized mint releases a commitment, exactly once',t=>{
  const {f,ops:[a,b]}=competing(t,2),balance=ENVELOPE*2n-1n;
  retainBurnReserve(f.state,a.id,held(balance));a.burn(f.state);retainFinalBurn(f.state,a.id,a.evidence);
  assert.throws(()=>completeBurnOperation(f.state,a.id),/CompletionEvidenceMissing/);
  assert.equal(burnReserveCommitments(f.state).activeCommitments,1);
  retainBurnMint(f.state,a.id,a.mint);
  // The receipt alone does not release it; reconciliation completes first.
  assert.equal(burnReserveCommitments(f.state).activeCommitments,1);
  completeBurnOperation(f.state,a.id);
  assert.deepEqual(burnReserveCommitments(f.state),{committedLamports:'0',activeCommitments:0});
  completeBurnOperation(f.state,a.id);completeBurnOperation(reload(f.state),a.id);
  assert.deepEqual(burnReserveCommitments(reload(f.state)),{committedLamports:'0',activeCommitments:0});
  // The record of what was held is retained; it simply no longer counts.
  assert.deepEqual(reload(f.state).operations.find(o=>o.operationId===a.id).reserve,held(balance));
  // Asking again for a completed operation returns that record and holds nothing.
  assert.deepEqual(retainBurnReserve(f.state,a.id,held(balance*2n)),held(balance));
  assert.deepEqual(burnReserveCommitments(f.state),{committedLamports:'0',activeCommitments:0});
  // Its release makes room for the operation that had been refused.
  retainBurnReserve(f.state,b.id,held(balance));b.burn(f.state);
  assert.deepEqual(burnReserveCommitments(reload(f.state)),{committedLamports:ENVELOPE.toString(),activeCommitments:1});
});

test('a repeated observation of one operation never obtains or counts a second commitment',t=>{
  const {f,ops:[a]}=competing(t,1);
  const first=retainBurnReserve(f.state,a.id,held(ENVELOPE*4n));
  for(const again of [held(ENVELOPE*4n),{lamports:(ENVELOPE*2n).toString(),balanceLamports:(ENVELOPE*9n).toString(),slot:'99'}])
    assert.deepEqual(retainBurnReserve(f.state,a.id,again),first);
  assert.deepEqual(burnReserveCommitments(reload(f.state)),{committedLamports:ENVELOPE.toString(),activeCommitments:1});
  a.burn(f.state);assert.deepEqual(retainBurnReserve(reload(f.state),a.id,held(ENVELOPE*4n)),first);
  assert.equal(burnReserveCommitments(f.state).committedLamports,ENVELOPE.toString());
});

test('a journal cannot lose, forge or add a commitment around a burn',t=>{
  const {f,ops:[a,b]}=competing(t,2);
  retainBurnReserve(f.state,a.id,held(ENVELOPE*2n));a.burn(f.state);
  const lost=JSON.parse(JSON.stringify(f.state));delete lost.operations.find(o=>o.operationId===a.id).reserve;
  assert.throws(()=>validateBurnJournalState(lost),{message:'BURN_RESERVE_COMMITMENT_REQUIRED'});
  for(const reserve of [{lamports:'0',balanceLamports:'1',slot:'1'},{lamports:'2',balanceLamports:'1',slot:'1'},{lamports:'1',balanceLamports:'1'},
    {lamports:'1',balanceLamports:'1',slot:'1',extra:true},{lamports:1,balanceLamports:'1',slot:'1'},{lamports:'-1',balanceLamports:'1',slot:'1'},null,'1']){
    const forged=JSON.parse(JSON.stringify(f.state));forged.operations.find(o=>o.operationId===a.id).reserve=reserve;
    assert.throws(()=>validateBurnJournalState(forged),/BurnReserve/);
  }
  // A commitment is taken before the plan is acted on, never afterwards.
  const unplanned=JSON.parse(JSON.stringify(f.state)),record=unplanned.operations.find(o=>o.operationId===b.id);
  record.plan=null;record.state='DEPOSIT_FINALIZED';record.reserve=held(ENVELOPE*2n);
  assert.throws(()=>validateBurnJournalState(unplanned),/AdmissionStopped/);
  f.state.paused=true;f.state.pauseReason='OPERATOR_PAUSE';
  assert.throws(()=>retainBurnReserve(f.state,b.id,held(ENVELOPE*2n)),/AdmissionStopped/);
});

test('records completed before commitments existed still load; nothing unfinished may lack one',t=>{
  const f=burnFixture();t.after(f.destroy);f.finalize();
  retainBurnMint(f.state,f.id,{operationId:f.id,amountAtomic:f.deposit.amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:'2'.repeat(88),commitment:'finalized',slot:'21'});
  completeBurnOperation(f.state,f.id);
  const prior=JSON.parse(JSON.stringify(f.state));delete prior.operations[0].reserve;
  const loaded=validateBurnJournalState(prior);
  assert.equal(loaded.operations[0].state,'COMPLETED');assert.equal(Object.hasOwn(loaded.operations[0],'reserve'),false);
  assert.deepEqual(burnReserveCommitments(loaded),{committedLamports:'0',activeCommitments:0});
  for(const change of [op=>{op.retired=false;op.state='MINTED';},op=>{op.retired=false;op.state='BURN_FINALIZED';op.mintReceipt=null;}]){
    const unfinished=JSON.parse(JSON.stringify(prior));change(unfinished.operations[0]);
    assert.throws(()=>validateBurnJournalState(unfinished),{message:'BURN_RESERVE_COMMITMENT_REQUIRED'});
  }
});

test('the reserve envelope is conservative and every failed quote fails closed',()=>{
  // 13 signature fees, five rent-exempt accounts including the token account.
  assert.equal(ENVELOPE,5000n*13n+890880n+2561280n+2359440n+2n*1398960n+2039280n);
  assert.equal(burnReserveRemaining(quote,false),ENVELOPE);assert.equal(burnReserveRemaining(quote,true),ENVELOPE-2039280n);
  for(const bad of [{...quote,feeLamports:'0'},{...quote,feeLamports:5000},{...quote,feeLamports:'NaN'},{feeLamports:'5000'},{...quote,rents:null}])
    assert.throws(()=>burnReserveEnvelope(bad),{message:'BURN_SOLANA_RESERVE_QUOTE_REJECTED'});
  for(const size of [0,240,211,73,165])for(const value of [undefined,'NaN','-1',1])
    assert.throws(()=>burnReserveEnvelope({...quote,rents:{...quote.rents,[size]:value}}),{message:'BURN_SOLANA_RENT_QUOTE_UNAVAILABLE'});
  assert.throws(()=>burnReserveRemaining(quote),{message:'BURN_SOLANA_RESERVE_QUOTE_REJECTED'});
  const need=ENVELOPE.toString();
  for(const balanceLamports of [undefined,'bad',-1,'1.5'])
    assert.throws(()=>requireBurnReserveAvailable({balanceLamports,committedElsewhereLamports:'0',requiredLamports:need}),{message:'BURN_SOLANA_BALANCE_UNAVAILABLE'});
  for(const patch of [{committedElsewhereLamports:undefined},{requiredLamports:'0'},{requiredLamports:undefined}])
    assert.throws(()=>requireBurnReserveAvailable({balanceLamports:need,committedElsewhereLamports:'0',requiredLamports:need,...patch}),{message:'BURN_SOLANA_RESERVE_QUOTE_REJECTED'});
  // A balance that fell after the quote is measured as it now is.
  assert.equal(requireBurnReserveAvailable({balanceLamports:(ENVELOPE*2n).toString(),committedElsewhereLamports:need,requiredLamports:need}),need);
  assert.throws(()=>requireBurnReserveAvailable({balanceLamports:(ENVELOPE*2n-1n).toString(),committedElsewhereLamports:need,requiredLamports:need}),
    {message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
});

async function transport(t,f) {
  const rpc={balance:0n,slot:10,snapshot:0,staleBalance:false,feeValue:5000,health:'ok',rent:size=>Number(quote.rents[size]),calls:[]};
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const input=JSON.parse(body);rpc.calls.push(input.method);
    const result=input.method==='getGenesisHash'?f.manifest.solanaGenesis:
      input.method==='getMultipleAccounts'?{context:{slot:rpc.snapshot=++rpc.slot},value:[...f.snapshot.accounts,...input.params[0].slice(f.snapshot.accounts.length).map(()=>null)]}:
      input.method==='getHealth'?rpc.health:
      input.method==='getLatestBlockhash'?{context:{slot:rpc.slot},value:{blockhash:f.manifest.solanaGenesis,lastValidBlockHeight:500}}:
      input.method==='getFeeForMessage'?{context:{slot:rpc.slot},value:rpc.feeValue}:
      input.method==='getMinimumBalanceForRentExemption'?rpc.rent(input.params[0]):
      input.method==='getBalance'?(assert.equal(input.params[1].commitment,'finalized'),assert.equal(input.params[1].minContextSlot,rpc.snapshot),
        {context:{slot:rpc.staleBalance?rpc.snapshot-1:++rpc.slot},value:Number(rpc.balance)}):undefined;
    assert.notEqual(result,undefined,'unexpected TEST RPC method '+input.method);
    res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  return {rpc,adapter:new BurnSolanaAdapter({policy:f.policy,endpoint:`http://127.0.0.1:${server.address().port}`})};
}

test('pre-burn admission measures the finalized balance left after other commitments',async t=>{
  const {f,ops:[a,b]}=competing(t,2),{rpc,adapter}=await transport(t,f);
  rpc.balance=ENVELOPE*2n-1n;
  const first=await adapter.preBurn(a.binding,a.plan,'0',{committedElsewhereLamports:burnReserveCommitments(f.state,a.id).committedLamports});
  assert.equal(first.reserveEnvelopeLamports,ENVELOPE.toString());assert.equal(first.requiredLamports,ENVELOPE.toString());
  assert.equal(first.balanceLamports,rpc.balance.toString());assert.equal(first.balanceSlot,String(rpc.slot));assert(BigInt(first.balanceSlot)>BigInt(rpc.snapshot));assert.equal(first.ataExists,false);
  retainBurnReserve(f.state,a.id,{lamports:first.reserveEnvelopeLamports,balanceLamports:first.balanceLamports,slot:first.balanceSlot});
  await assert.rejects(adapter.preBurn(b.binding,b.plan,'0',{committedElsewhereLamports:burnReserveCommitments(f.state,b.id).committedLamports}),
    {message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
  // The committed operation itself is still admitted on the same balance.
  await adapter.preBurn(a.binding,a.plan,'0',{committedElsewhereLamports:burnReserveCommitments(f.state,a.id).committedLamports,committed:true});
  rpc.balance=ENVELOPE*2n;
  const second=await adapter.preBurn(b.binding,b.plan,'0',{committedElsewhereLamports:burnReserveCommitments(f.state,b.id).committedLamports});
  retainBurnReserve(f.state,b.id,{lamports:second.reserveEnvelopeLamports,balanceLamports:second.balanceLamports,slot:second.balanceSlot});
  assert.equal(burnReserveCommitments(f.state).activeCommitments,2);
});

test('a stale balance, a fallen balance or a failed quote cannot admit a burn',async t=>{
  const {f,ops:[a]}=competing(t,1),{rpc,adapter}=await transport(t,f),admit=()=>adapter.preBurn(a.binding,a.plan,'0',{committedElsewhereLamports:'0'});
  rpc.balance=ENVELOPE;await admit();
  // An observation older than the account snapshot already verified.
  rpc.staleBalance=true;await assert.rejects(admit(),{message:'BURN_SOLANA_BALANCE_UNAVAILABLE'});
  rpc.staleBalance=false;await admit();
  // The balance fell between one admission and the next.
  rpc.balance=ENVELOPE-1n;await assert.rejects(admit(),{message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
  rpc.balance=ENVELOPE;
  for(const feeValue of [0,-1,null,'5000',1.5]){rpc.feeValue=feeValue;await assert.rejects(admit(),{message:'BURN_SOLANA_FEE_QUOTE_UNAVAILABLE'});}
  rpc.feeValue=5000;
  for(const rent of [()=>null,()=>-1,()=>'1',()=>1.5]){const before=rpc.rent;rpc.rent=rent;await assert.rejects(admit(),{message:'BURN_SOLANA_RENT_QUOTE_UNAVAILABLE'});rpc.rent=before;}
  rpc.health='behind';await assert.rejects(admit(),{message:'BURN_SOLANA_UNHEALTHY'});rpc.health='ok';
  // Issuance the journal cannot explain still stops admission first.
  await assert.rejects(adapter.preBurn(a.binding,a.plan,'1',{committedElsewhereLamports:'0'}),{message:'BURN_SOLANA_UNEXPLAINED_ISSUANCE'});
  // A higher fee raises what must be available.
  rpc.feeValue=5001;await assert.rejects(admit(),{message:'BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED'});
  await assert.rejects(adapter.preBurn(a.binding,a.plan,'0',{committedElsewhereLamports:'0',committed:'yes'}),{message:'BURN_SOLANA_RESERVE_QUOTE_REJECTED'});
});

test('the Mainnet minimum is 1000 KPEPE and the whole received amount is bridged',t=>{
  assert.equal(MIN_BRIDGE_DEPOSIT_KPEPE,1000n);assert.equal(MIN_BRIDGE_DEPOSIT_ATOMIC,100_000_000_000n);
  for(const [amountAtomic,eligible] of [[kpepe(999),false],[(BigInt(kpepe(1000))-1n).toString(),false],[kpepe(1000),true],[kpepe(1001),true],[kpepe(1500),true]]){
    const f=burnFixture({mainnet:true,amountAtomic});t.after(f.destroy);
    assert.equal(minimumBurnDepositAtomic(f.state),MIN_BRIDGE_DEPOSIT_ATOMIC);
    if(!eligible){
      recordBurnDeposits(f.state,f.id,[f.deposit]);
      assert.throws(()=>retainBurnPlan(f.state,f.id,f.plan),{message:'BURN_DEPOSIT_BELOW_MINIMUM'});
      const op=reload(f.state).operations[0];
      // Held, not discarded: the received deposit stays on record, unburned.
      assert.equal(op.state,'DEPOSIT_FINALIZED');assert.equal(op.deposit.amountAtomic,amountAtomic);assert.equal(op.plan,null);assert.equal(op.exception,null);
      assert.throws(()=>retainBurnReserve(f.state,f.id,{...FIXTURE_RESERVE}),/AdmissionStopped/);
      assert.throws(()=>retainSignedBurn(f.state,f.id,signNativeBurnWithKey({rootSecret:f.root,binding:f.binding,plan:f.plan})),{message:'BURN_RESERVE_COMMITMENT_REQUIRED'});
      assert.equal(op.signedBurnHex,null);assert.equal(op.solanaPacket,null);assert.equal(op.mintReceipt,null);
      continue;
    }
    f.finalize();const op=reload(f.state).operations[0];
    assert.equal(op.plan.inputs[0].amountAtomic,amountAtomic);assert.equal(op.burnEvidence.amountAtomic,amountAtomic);
    // Nothing is withheld as a fee and nothing less than the deposit is minted.
    const receipt={operationId:f.id,amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:'2'.repeat(88),commitment:'finalized',slot:'21'};
    for(const other of [(BigInt(amountAtomic)-1n).toString(),kpepe(999),(BigInt(amountAtomic)+1n).toString()])
      assert.throws(()=>retainBurnMint(f.state,f.id,{...receipt,amountAtomic:other}),/MintBindingChanged/);
    retainBurnMint(f.state,f.id,receipt);completeBurnOperation(f.state,f.id);
    assert.equal(reload(f.state).operations[0].mintReceipt.amountAtomic,amountAtomic);
  }
});

test('payments to one address are never added together',t=>{
  // The canonical model binds one operation to one deposit output. A second
  // arrival is an exception for review; it cannot complete a minimum.
  for(const parts of [[600,300,100],[600,300,99],[999,1]]){
    const f=burnFixture({mainnet:true,amountAtomic:kpepe(parts[0])});t.after(f.destroy);
    const deposits=parts.map((n,i)=>({...f.deposit,txid:hash('part'+i),amountAtomic:kpepe(n)}));
    recordBurnDeposits(f.state,f.id,[deposits[0]]);
    assert.throws(()=>retainBurnPlan(f.state,f.id,f.plan),/BURN_DEPOSIT_BELOW_MINIMUM|DepositBindingChanged/);
    recordBurnDeposits(f.state,f.id,deposits);
    const op=reload(f.state).operations[0];
    assert.equal(op.exception.reason,'MULTIPLE_DEPOSITS_REQUIRE_REVIEW');assert.equal(op.plan,null);assert.equal(op.signedBurnHex,null);
    assert.equal(op.deposit.amountAtomic,kpepe(parts[0]));
    assert.throws(()=>retainBurnPlan(f.state,f.id,f.plan),/AdmissionStopped/);
    // The same observation again changes nothing.
    recordBurnDeposits(f.state,f.id,deposits);assert.deepEqual(reload(f.state).operations[0],op);
  }
});
