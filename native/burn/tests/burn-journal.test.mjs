// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schnorr } from '@noble/curves/secp256k1.js';
import { burnOperationId,nativeBurnCommitment,planNativeBurn } from '../burn-protocol.mjs';
import { burnDepositDestination,burnOperationalDestination,signNativeBurnWithKey } from '../burn-key.mjs';
import { initialBurnJournal,issueBurnDeposit,recordBurnDeposits,retainBurnPlan,retainSignedBurn,markBurnBroadcast,
  retainFinalBurn,retainBurnMint,completeBurnOperation,burnJournalAccounting,reconcileBurnAccounting,validateBurnJournalState } from '../../../services/bridge-validator/burn-journal-state.mjs';

const h=n=>n.toString(16).padStart(2,'0').repeat(32);
function fixture() {
  const rootSecret=schnorr.utils.randomSecretKey(),binding={protocolId:1,nativeNetwork:8000111,nativeGenesis:h(1),solanaGenesis:h(2),solanaDeployment:h(8),bridgeProgram:h(3),transceiverProgram:h(4),mint:h(5),destination:h(6),
    burnPublicKey:Buffer.from(schnorr.getPublicKey(rootSecret)).toString('hex'),nonce:h(7)};
  const state=initialBurnJournal(binding);state.paused=false;state.pauseReason='TEST_REVIEWED';
  const id=burnOperationId(binding),op=issueBurnDeposit(state,binding,20),operational=burnOperationalDestination(binding);
  const deposit={txid:h(10),vout:0,amountAtomic:'100000',blockHash:h(11),height:21,confirmations:12};
  const inputs=[{txid:deposit.txid,vout:0,amountAtomic:deposit.amountAtomic,scriptPubKeyHex:burnDepositDestination(binding).scriptPubKeyHex},
    {txid:h(12),vout:1,amountAtomic:'1000000',scriptPubKeyHex:operational.scriptPubKeyHex}];
  const plan=planNativeBurn({operationId:id,inputs,operationalScriptHex:operational.scriptPubKeyHex,
    feePolicy:{minimumRateAtomicPerKvB:'100',normalRateAtomicPerKvB:'1000',maximumRateAtomicPerKvB:'1000000',maximumAbsoluteFeeAtomic:'600000',dustRelayAtomicPerKvB:'3000'}});
  const evidence={binding,operationId:id,deposit:{txid:deposit.txid,vout:0},depositBlockHash:deposit.blockHash,depositHeight:deposit.height,
    burn:{txid:plan.txid,vout:0},burnBlockHash:h(13),burnHeight:33,amountAtomic:deposit.amountAtomic,
    burnCommitment:nativeBurnCommitment({operationId:id,deposit:{txid:deposit.txid,vout:0},amountAtomic:deposit.amountAtomic})};
  const mint={operationId:id,amountAtomic:'100000',destination:binding.destination,mint:binding.mint,signature:'2'.repeat(88),commitment:'finalized',slot:'123'};
  const advance=()=>{recordBurnDeposits(state,id,[deposit]);retainBurnPlan(state,id,plan);
    retainSignedBurn(state,id,signNativeBurnWithKey({rootSecret,binding,plan}));markBurnBroadcast(state,id);retainFinalBurn(state,id,evidence);};
  return {rootSecret,binding,state,id,op,deposit,plan,evidence,mint,advance};
}
const reload=state=>validateBurnJournalState(JSON.parse(JSON.stringify(state)));
test('issued operation survives reload and another wallet cannot change its deposit address or destination',()=>{
  const f=fixture(),state=reload(f.state);
  assert.deepEqual(issueBurnDeposit(state,f.binding,99),f.op);
  const next=issueBurnDeposit(state,{...f.binding,destination:h(50)},99);
  assert.notEqual(next.operationId,f.id);assert.notEqual(next.depositAddress,f.op.depositAddress);
  assert.equal(state.operations[0].binding.destination,f.binding.destination);
  const changed=structuredClone(state);changed.operations[0].binding.destination=h(50);
  assert.throws(()=>reload(changed),/DestinationChanged/);
});
test('below finality and orphaned observations cannot retain burn or mint',()=>{
  const f=fixture();recordBurnDeposits(f.state,f.id,[{...f.deposit,confirmations:11}]);
  assert.throws(()=>retainBurnPlan(f.state,f.id,f.plan),/NotFinal/);
  assert.throws(()=>retainBurnMint(f.state,f.id,f.mint),/NoFinalizedBurn/);
  recordBurnDeposits(f.state,f.id,[]);assert.equal(reload(f.state).operations[0].state,'DEPOSIT_ADDRESS_ISSUED');
  recordBurnDeposits(f.state,f.id,[f.deposit]);retainBurnPlan(f.state,f.id,f.plan);
  assert.throws(()=>retainBurnMint(f.state,f.id,f.mint),/NoFinalizedBurn/);
  retainSignedBurn(f.state,f.id,signNativeBurnWithKey({rootSecret:f.rootSecret,binding:f.binding,plan:f.plan}));markBurnBroadcast(f.state,f.id);
  assert.throws(()=>retainBurnMint(f.state,f.id,f.mint),/NoFinalizedBurn/);
});
test('multiple deposits hold before burn; completed-address late deposits never create another economic action',()=>{
  const f=fixture();recordBurnDeposits(f.state,f.id,[f.deposit,{...f.deposit,txid:h(22)}]);
  assert.equal(f.state.operations[0].exception.reason,'MULTIPLE_DEPOSITS_REQUIRE_REVIEW');
  assert.throws(()=>retainBurnPlan(f.state,f.id,f.plan),/AdmissionStopped/);
  assert.equal(reload(f.state).operations[0].exception.reason,'MULTIPLE_DEPOSITS_REQUIRE_REVIEW');
  const g=fixture();g.advance();retainBurnMint(g.state,g.id,g.mint);completeBurnOperation(g.state,g.id);
  recordBurnDeposits(g.state,g.id,[g.deposit,{...g.deposit,txid:h(22)}]);
  assert.equal(g.state.operations[0].exception.reason,'LATE_DEPOSIT_TO_RETIRED_ADDRESS');
  assert.equal(reload(g.state).operations[0].state,'COMPLETED');
  assert.throws(()=>retainBurnPlan(g.state,g.id,g.plan),/AdmissionStopped/);
  assert.equal(burnJournalAccounting(g.state).mintedAtomic,'100000');
});
test('restart after final burn preserves obligation and resumes mint exactly once without a second burn',()=>{
  const f=fixture();f.advance();const state=reload(f.state);
  assert.equal(state.operations[0].state,'BURN_FINALIZED');
  assert.equal(burnJournalAccounting(state).pendingFinalizedBurnAtomic,'100000');
  assert.equal(reconcileBurnAccounting(state,{finalizedNativeBurnAtomic:'100000',bridgeIssuedAtomic:'0',mintSupplyAtomic:'0'}).state,'MATCH');
  for(let n=0;n<3;n++){retainBurnPlan(state,f.id,f.plan);markBurnBroadcast(state,f.id,true);retainFinalBurn(state,f.id,f.evidence);}
  retainBurnMint(state,f.id,f.mint);retainBurnMint(state,f.id,f.mint);completeBurnOperation(state,f.id);
  assert.equal(reload(state).operations.length,1);
  assert.equal(burnJournalAccounting(state).mintedAtomic,'100000');
  assert.equal(reconcileBurnAccounting(state,{finalizedNativeBurnAtomic:'100000',bridgeIssuedAtomic:'100000',mintSupplyAtomic:'100000'}).state,'MATCH');
  assert.throws(()=>retainBurnMint(state,f.id,{...f.mint,destination:h(98)}),/MintBindingChanged/);
  assert.throws(()=>retainBurnMint(state,f.id,{...f.mint,signature:'3'.repeat(88)}),/SecondMintRejected/);
});
test('reorg after reservation and any unbacked or above-cap observed supply cause persistent pause',()=>{
  const f=fixture();f.advance();recordBurnDeposits(f.state,f.id,[]);
  assert.equal(f.state.paused,true);assert.equal(f.state.pauseReason,'ACCEPTED_DEPOSIT_BASIS_CHANGED');
  for(const amount of ['1','2100000000000001']){
    const g=fixture();assert.throws(()=>reconcileBurnAccounting(g.state,{finalizedNativeBurnAtomic:'0',bridgeIssuedAtomic:amount,mintSupplyAtomic:amount}),/RECONCILIATION_MISMATCH/);
    assert.equal(reload(g.state).paused,true);
  }
});
