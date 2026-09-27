// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic signed payment and journal transitions, never production transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ed25519} from '@noble/curves/ed25519.js';
import {base58} from '@scure/base';
import {burnFixture} from './burn-fixture.mjs';
import {burnOperationId} from '../burn-protocol.mjs';
import {signNativeBurnWithKey} from '../burn-key.mjs';
import {issueBurnDeposit,recordBurnDeposits,retainBurnPlan,retainSignedBurn,markBurnBroadcast,validateBurnJournalState,burnJournalAccounting,retainBurnSolanaPacket,markBurnSolanaPacket,prepareBurnAuthorization,retainBurnAttestation,retainBurnMint,completeBurnOperation} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {associatedTokenCreationMessage} from '../../../services/relayer/burn-solana-signer.mjs';
import * as funding from '../../../services/bridge-validator/execution-funding-state.mjs';
import * as wire from '../../../services/bridge-validator/execution-funding-wire.mjs';
import {validateExecutionQuote,signExecutionPayment,EXECUTION_RECIPIENT,EXECUTION_GENESIS} from '../../../integrations/explorer/web/bridge-execution.js';
const key=hex=>base58.encode(Buffer.from(hex,'hex')),now=1000,slot=100;
const budget=()=>funding.executionBudget({rents:{0:'650240',73:'1021080',165:'1488440',211:'1722120',240:'1869440'},fees:{single:'5000',receipt:'15000',payment:'5000',refund:'5000'},ataExists:true});
function fixture(t,{legacy=false}={}){
 const f=burnFixture();t.after(f.destroy);if(!legacy)f.state.operations=[];
 funding.activateExecutionFunding(f.state,{now,slot,budget:budget(),balanceLamports:'1000000000',scanSignature:null});
 if(!legacy)funding.createExecutionIntent(f.state,f.binding,now,20);
 return f;
}
function quote(f,b=budget(),hash=key('22'.repeat(32))){return funding.retainExecutionQuote(f.state,f.id,{budget:b,now,createdSlot:slot,recentBlockhash:hash,lastValidBlockHeight:'300',recipient:key(f.policy.feePayerHex),destination:key(f.binding.destination),genesis:key(f.binding.solanaGenesis)});}
function transaction(q,seed){const message=wire.executionPaymentMessage(q),sig=ed25519.sign(message,seed);return {signature:base58.encode(sig),transaction:{slot:101,meta:{err:null,fee:5000},transaction:[Buffer.concat([Buffer.of(1),Buffer.from(sig),message]).toString('base64'),'base64']}};}
function pay(f,q=quote(f)){const tx=transaction(q,f.wallet),p=wire.verifyExecutionPayment({quote:q,...tx});funding.creditExecutionPayment(f.state,f.id,p,now+1);return p;}
function issued(f){pay(f);issueBurnDeposit(f.state,f.binding,20);recordBurnDeposits(f.state,f.id,[f.deposit]);retainBurnPlan(f.state,f.id,f.plan);}
function ataPacket(f){const recentBlockhash=key('33'.repeat(32)),{message}=associatedTokenCreationMessage({binding:f.binding,feePayerHex:f.policy.feePayerHex,recentBlockhash}),signature=ed25519.sign(message,f.payer);
 return {kind:'ATA',messageDigestHex:null,recentBlockhash,lastValidBlockHeight:'500',signature:base58.encode(signature),preparedTransactionBase64:Buffer.concat([Buffer.of(1),Buffer.from(signature),message]).toString('base64')};}
function spendTerms(packet,index=0,maximumDebitLamports='1000000'){return {index,kind:packet.kind,messageDigestHex:packet.messageDigestHex,recentBlockhash:packet.recentBlockhash,lastValidBlockHeight:packet.lastValidBlockHeight,maximumDebitLamports,createdSlot:101};}
function refundPacket(f,terms){const source=key(f.policy.feePayerHex),destination=key(f.binding.destination),recentBlockhash=key('33'.repeat(32));const message=wire.executionTransferMessage({source,destination,lamports:terms.amountLamports,blockhash:recentBlockhash,memo:wire.executionRefundMemo(f.id,terms.sequence)}),signature=ed25519.sign(message,f.payer);
 return {operationId:f.id,sequence:terms.sequence,amountLamports:terms.amountLamports,feeLamports:terms.feeLamports,source,destination,recentBlockhash,lastValidBlockHeight:'500',signature:base58.encode(signature),preparedTransactionBase64:Buffer.concat([Buffer.of(1),Buffer.from(signature),message]).toString('base64')};}

test('operation budget funds live execution plus the bounded retry policy without a global reserve',()=>{
 const a=budget(),b=funding.executionBudget({...a,ataExists:false});assert.equal(a.executionLamports,'5653720');assert.equal(b.executionLamports,'7147160');assert.equal(a.depositLamports,'30832320');assert.equal(a.walletDebitLamports,'30837320');assert.equal(a.completionBackstopLamports,undefined);
 const changed=funding.executionBudget({...a,rents:{...a.rents,240:'2000000'},fees:{...a.fees,single:'6000',receipt:'18000'}});
 assert.notEqual(changed.depositLamports,a.depositLamports);assert(BigInt(changed.completionLamports)>BigInt(a.completionLamports));
 assert.equal(a.priorityFeeLamports,'0');assert.equal(BigInt(a.depositLamports)-BigInt(a.executionLamports)-BigInt(a.refundAllowanceLamports),BigInt(a.retryAllowanceLamports));
});
test('cutover requires zero Team reserve and preserves already-burned legacy obligations',t=>{
 const f=burnFixture();t.after(f.destroy);f.finalize();
 funding.activateExecutionFunding(f.state,{now,slot,balanceLamports:'0',scanSignature:null});assert.deepEqual(f.state.execution.legacyIds,[f.id]);validateBurnJournalState(f.state);
 assert.equal(funding.executionRequiredBalance(f.state),0n);assert.equal(f.state.execution.legacyCapitalLamports,'0');
 assert.equal(funding.publicExecutionFunding(f.state,f.id).policy,'LEGACY_OPERATOR_FUNDED');
});
test('unburned legacy operations are held for local policy review; adoption preserves identity, deposit and destination',t=>{
 const f=fixture(t,{legacy:true}),before=structuredClone(f.state.operations[0]);
 assert.equal(funding.publicExecutionFunding(f.state,f.id).status,'LEGACY_FUNDING_REVIEW_REQUIRED');
 assert.throws(()=>funding.requireExecutionBurnCommitted(f.state,f.id),/LEGACY_POLICY_REVIEW/);
 funding.adoptLegacyExecutionFunding(f.state,f.id,now);assert.deepEqual(f.state.operations[0],before);
 assert.equal(funding.publicExecutionFunding(f.state,f.id).policy,'USER_FUNDED');validateBurnJournalState(f.state);
 assert.throws(()=>funding.requireExecutionBurnCommitted(f.state,f.id),/NOT_RESERVED/);
});
test('unpaid intent exposes no Native address, cannot sign a burn and does not pause other operations',t=>{
 const f=fixture(t);quote(f);assert.throws(()=>issueBurnDeposit(f.state,f.binding,20),/EXECUTION_FUNDING_REQUIRED/);assert.throws(()=>funding.requireExecutionBurnCommitted(f.state,f.id),/NOT_RESERVED/);
 assert.equal(f.state.operations.length,0);assert.equal(f.state.paused,false);assert.equal(funding.publicExecutionFunding(f.state,f.id).depositAddressIssued,false);validateBurnJournalState(f.state);
});
test('a finalized signed payment unlocks exactly its bound operation; replay and changed destination are rejected',t=>{
 const f=fixture(t),q=quote(f),p=pay(f,q);assert.equal(funding.creditExecutionPayment(f.state,f.id,p,now+2),false);issueBurnDeposit(f.state,f.binding,20);
 const other={...f.binding,nonce:'44'.repeat(32)},id=burnOperationId(other);funding.createExecutionIntent(f.state,other,now,20);
 assert.throws(()=>funding.creditExecutionPayment(f.state,id,p,now),/Replay/);assert.throws(()=>issueBurnDeposit(f.state,other,20),/FUNDING_REQUIRED/);
 const changed=structuredClone(f.state);changed.execution.records[0].binding.destination='55'.repeat(32);assert.throws(()=>validateBurnJournalState(changed));validateBurnJournalState(f.state);
});
test('wrong wallet, recipient, amount, operation memo, unsigned packet, failed and old-slot payments cannot create credits',t=>{
 const f=fixture(t),q=quote(f),tx=transaction(q,f.wallet);const evil=ed25519.utils.randomSecretKey();t.after(()=>evil.fill(0));
 assert.throws(()=>wire.verifyExecutionPayment({quote:q,...transaction(q,evil)}),/Signature/);
 for(const delta of [{destination:key(f.policy.feePayerHex)},{recipient:key('66'.repeat(32))},{amountLamports:'1'},{operationId:'77'.repeat(32)},{quoteId:'88'.repeat(32)}])assert.throws(()=>wire.verifyExecutionPayment({quote:{...q,...delta},...tx}));
 for(const bad of [{...tx.transaction,slot:99},{...tx.transaction,meta:{err:{InstructionError:[]},fee:5000}},{...tx.transaction,transaction:[wire.executionUnsignedTransaction(wire.executionPaymentMessage(q)),'base64']}])assert.throws(()=>wire.verifyExecutionPayment({quote:q,signature:tx.signature,transaction:bad}));
 assert.equal(funding.executionTotals(funding.executionRecord(f.state,f.id)).funded,0n);
});
test('a real second payment is a second refund liability, not a second operation or Native deposit',t=>{
 const f=fixture(t),q=quote(f);const q2=quote(f,budget(),key('44'.repeat(32)));pay(f,q);pay(f,q2);issueBurnDeposit(f.state,f.binding,20);issueBurnDeposit(f.state,f.binding,20);
 assert.equal(f.state.operations.length,1);assert.equal(funding.executionTotals(funding.executionRecord(f.state,f.id)).funded,2n*BigInt(budget().depositLamports));validateBurnJournalState(f.state);
});
test('user reserves alone authorize burn; unrelated Bridge money cannot satisfy an operation shortfall',t=>{
 const f=fixture(t);issued(f);const liability=funding.executionTotals(funding.executionRecord(f.state,f.id)).liability;
 const expensive=funding.executionBudget({...budget(),fees:{single:'10000',receipt:'30000',payment:'10000',refund:'10000'}});
 f.state.execution.legacyCapitalLamports='0';assert.throws(()=>funding.commitExecutionBurn(f.state,f.id,{budget:expensive,balanceLamports:'100000000000'}),/ADDITIONAL_SOL/);
 assert.throws(()=>funding.commitExecutionBurn(f.state,f.id,{budget:budget(),balanceLamports:String(liability-1n)}),/RESERVED_BALANCE/);
 funding.commitExecutionBurn(f.state,f.id,{budget:budget(),balanceLamports:String(liability)});assert.equal(funding.executionRecord(f.state,f.id).burnCommitted,true);validateBurnJournalState(f.state);
});
test('exact top-up funds only its bound operation; wrong-wallet and replay attempts never duplicate credits',t=>{
 const f=fixture(t);issued(f);const b=funding.executionBudget({...budget(),fees:{single:'6000',receipt:'18000',payment:'6000',refund:'6000'}});
 const missing=funding.recordExecutionCheck(f.state,f.id,{budget:b,now:now+1,slot:101});assert.equal(missing,41000n);
 const q=quote(f,b,key('44'.repeat(32))),publicState=funding.publicExecutionFunding(f.state,f.id);
 assert.equal(publicState.status,'ADDITIONAL_SOL_REQUIRED');assert.equal(publicState.additionalSolRequiredLamports,'41000');assert.equal(q.amountLamports,'41000');
 const evil=ed25519.utils.randomSecretKey();t.after(()=>evil.fill(0));assert.throws(()=>wire.verifyExecutionPayment({quote:q,...transaction(q,evil)}));
 const p=pay(f,q);assert.equal(funding.creditExecutionPayment(f.state,f.id,p,now+2),false);
 const other={...f.binding,nonce:'55'.repeat(32)},id=burnOperationId(other);funding.createExecutionIntent(f.state,other,now,20);
 assert.throws(()=>funding.creditExecutionPayment(f.state,id,p,now),/Replay/);assert.throws(()=>issueBurnDeposit(f.state,other,20),/FUNDING_REQUIRED/);
 assert.equal(funding.recordExecutionCheck(f.state,f.id,{budget:b,now:now+3,slot:102}),0n);
 funding.commitExecutionBurn(f.state,f.id,{budget:b,balanceLamports:b.depositLamports});validateBurnJournalState(f.state);
});
test('signing intentions reserve only their operation and survive a crash before signed-packet persistence',t=>{
 const f=fixture(t);issued(f);const packet=ataPacket(f),funded=funding.executionTotals(funding.executionRecord(f.state,f.id)).available;
 assert.throws(()=>retainBurnSolanaPacket(f.state,f.id,packet),/SpendNotReserved/);
 assert.throws(()=>funding.reserveExecutionSpend(f.state,f.id,spendTerms(packet,0,String(funded+1n)),'999999999999'),/OPERATION_FUNDS/);
 funding.reserveExecutionSpend(f.state,f.id,spendTerms(packet),String(funded));
 const reopened=validateBurnJournalState(JSON.parse(JSON.stringify(f.state)));
 assert.equal(funding.requireExecutionSpendIntent(reopened,f.id,packet).maximumDebitLamports,'1000000');
 assert.throws(()=>funding.requireExecutionSpendIntent(reopened,f.id,{...packet,recentBlockhash:key('44'.repeat(32))}),/SpendNotReserved/);
 assert.throws(()=>funding.reserveExecutionSpend(reopened,f.id,spendTerms(packet),String(funded)),/IntentExists/);
 retainBurnSolanaPacket(reopened,f.id,packet);assert.equal(funding.executionPendingSpend(reopened,f.id),1000000n);validateBurnJournalState(reopened);
});
test('another user payment or refundable remainder cannot cover an underfunded operation',t=>{
 const f=fixture(t);issued(f);const other={...f.binding,nonce:'66'.repeat(32)},id=burnOperationId(other);funding.createExecutionIntent(f.state,other,now,20);
 const q=funding.retainExecutionQuote(f.state,id,{budget:budget(),now,createdSlot:slot,recentBlockhash:key('22'.repeat(32)),lastValidBlockHeight:'300',recipient:key(f.policy.feePayerHex),destination:key(f.binding.destination),genesis:key(f.binding.solanaGenesis)});
 const p=wire.verifyExecutionPayment({quote:q,...transaction(q,f.wallet)});funding.creditExecutionPayment(f.state,id,p,now+1);
 const own=funding.executionTotals(funding.executionRecord(f.state,f.id)).available,packet=ataPacket(f);
 assert.equal(funding.executionRequiredBalance(f.state),own*2n);
 assert.throws(()=>funding.reserveExecutionSpend(f.state,f.id,spendTerms(packet,0,String(own+1n)),String(own*2n)),/OPERATION_FUNDS/);
 assert.equal(funding.executionTotals(funding.executionRecord(f.state,id)).available,own);
});
test('after burn the allowance never expires or becomes another user top-up; exceptional funding is an incident',t=>{
 const f=fixture(t);issued(f);funding.commitExecutionBurn(f.state,f.id,{budget:budget(),balanceLamports:budget().depositLamports});
 const huge=funding.executionBudget({...budget(),rents:{...budget().rents,240:'1000000000'}});
 assert(funding.recordExecutionCheck(f.state,f.id,{budget:huge,now:1e12,slot:102})>0n);
 const p=funding.publicExecutionFunding(f.state,f.id);assert.equal(p.status,'POST_BURN_EXECUTION_FUNDING_INCIDENT');assert.equal(p.quote,null);assert.equal(p.expiresAt,null);assert.equal(p.additionalSolRequiredLamports,'0');
 assert.equal(funding.beginExecutionRefund(f.state,f.id,{now:1e12,nativeClear:true,feeLamports:'5000'}),null);assert.throws(()=>quote(f,huge),/QuoteNotAllowed/);
 assert.equal(funding.executionRequiredBalance(f.state),BigInt(budget().depositLamports));
});
test('unused operation funds refund after exact deposit/burn/mint completion and actual costs',t=>{
 const f=fixture(t);issued(f);const packet=ataPacket(f);funding.reserveExecutionSpend(f.state,f.id,spendTerms(packet),budget().depositLamports);retainBurnSolanaPacket(f.state,f.id,packet);
 markBurnSolanaPacket(f.state,f.id,packet.signature,{outcome:'FINALIZED',sendAttempts:1,observedSlot:'101'});
 funding.recordExecutionCost(f.state,f.id,{signature:packet.signature,lamports:'1000000',networkFeeLamports:'5000',slot:101});
 const remaining=funding.executionBudget({...budget(),packetCounts:{ATA:1,RECEIPT:0,CLAIM:0}});
 funding.commitExecutionBurn(f.state,f.id,{budget:remaining,balanceLamports:String(BigInt(budget().depositLamports)-1000000n)});f.finalize();
 assert.equal(funding.beginExecutionRefund(f.state,f.id,{now:1e12,nativeClear:true,feeLamports:'5000'}),null);
 retainBurnMint(f.state,f.id,{operationId:f.id,amountAtomic:f.deposit.amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:base58.encode(new Uint8Array(64).fill(9)),slot:'103',commitment:'finalized'});completeBurnOperation(f.state,f.id);
 const terms=funding.beginExecutionRefund(f.state,f.id,{now:1e12,nativeClear:true,feeLamports:'5000'});assert.equal(terms.amountLamports,String(BigInt(budget().depositLamports)-1000000n-5000n));
 const refund=refundPacket(f,terms);funding.retainExecutionRefund(f.state,f.id,refund);funding.markExecutionRefund(f.state,f.id,refund.signature,{outcome:'FINALIZED',actualFeeLamports:'5000'});
 assert.equal(funding.executionTotals(funding.executionRecord(f.state,f.id)).liability,0n);const a=burnJournalAccounting(f.state);assert.equal(a.finalizedNativeBurnAtomic,a.mintedAtomic);assert.equal(a.mintedAtomic,f.deposit.amountAtomic);validateBurnJournalState(f.state);
});
test('legacy constructed burn remains possibly signed and can never be retroactively charged to the user',t=>{
 const f=burnFixture();t.after(f.destroy);recordBurnDeposits(f.state,f.id,[f.deposit]);retainBurnPlan(f.state,f.id,f.plan);
 funding.activateExecutionFunding(f.state,{now,slot,balanceLamports:'0',scanSignature:null});
 assert.equal(f.state.operations[0].signedBurnHex,null);
 assert.equal(funding.executionRequiredBalance(f.state),0n);assert.equal(funding.executionCommitted(f.state,f.id),true);
 assert.throws(()=>funding.adoptLegacyExecutionFunding(f.state,f.id,now),/LEGACY_POLICY_REVIEW/);
});
test('signed-or-possibly-signed burns never depend on a new quote or user top-up after a fee change',t=>{
 const f=fixture(t);issued(f);funding.commitExecutionBurn(f.state,f.id,{budget:budget(),balanceLamports:'1000000000'});
 const huge=funding.executionBudget({...budget(),rents:{...budget().rents,240:'10000000000'}});
 funding.commitExecutionBurn(f.state,f.id,{budget:huge,balanceLamports:'0'});funding.requireExecutionBurnCommitted(f.state,f.id);
 const signed=signNativeBurnWithKey({rootSecret:f.root,binding:f.binding,plan:f.plan});retainSignedBurn(f.state,f.id,signed);markBurnBroadcast(f.state,f.id);
 assert.equal(funding.beginExecutionRefund(f.state,f.id,{now:1e12,nativeClear:true,feeLamports:'5000'}),null);
 assert.throws(()=>quote(f,huge),/QuoteNotAllowed/);validateBurnJournalState(f.state);
});
test('12 confirmations and EXACT_RECEIVED are unchanged and SOL never changes KPEPE accounting',t=>{
 const f=fixture(t);pay(f);issueBurnDeposit(f.state,f.binding,20);recordBurnDeposits(f.state,f.id,[{...f.deposit,confirmations:11}]);assert.throws(()=>retainBurnPlan(f.state,f.id,f.plan),/NotFinal/);
 recordBurnDeposits(f.state,f.id,[f.deposit]);retainBurnPlan(f.state,f.id,f.plan);funding.commitExecutionBurn(f.state,f.id,{budget:budget(),balanceLamports:'1000000000'});f.finalize();
 assert.equal(f.state.operations[0].burnEvidence.amountAtomic,f.deposit.amountAtomic);assert.equal(f.state.operations[0].plan.inputs[0].amountAtomic,f.deposit.amountAtomic);
 const accounting=burnJournalAccounting(f.state);assert.equal(accounting.finalizedNativeBurnAtomic,f.deposit.amountAtomic);assert(!Object.keys(accounting).some(k=>/lamports|SOL/u.test(k)));validateBurnJournalState(f.state);
});
test('expiry refund needs fresh Native absence, never races a deposit or possibly-signed burn',t=>{
 const f=fixture(t);pay(f);const args={now:now+funding.EXECUTION_EXPIRY_MS+2,feeLamports:'5000',nativeClear:true};
 assert.equal(funding.beginExecutionRefund(f.state,f.id,{...args,nativeClear:false}),null);
 funding.recordExecutionNativeObservations(f.state,f.id,[{...f.deposit,height:0,blockHash:null,confirmations:0}]);assert.equal(funding.beginExecutionRefund(f.state,f.id,args),null);
 funding.recordExecutionNativeObservations(f.state,f.id,[]);const terms=funding.beginExecutionRefund(f.state,f.id,args);assert.equal(terms.amountLamports,String(BigInt(budget().depositLamports)-5000n));
 assert.throws(()=>issueBurnDeposit(f.state,f.binding,20),/FUNDING_REQUIRED/);validateBurnJournalState(f.state);
});
test('refund packet persistence, duplicate outcome handling and restart are idempotent',t=>{
 const f=fixture(t);pay(f);const args={now:1e12,feeLamports:'5000',nativeClear:true},terms=funding.beginExecutionRefund(f.state,f.id,args),packet=refundPacket(f,terms);
 funding.retainExecutionRefund(f.state,f.id,packet);f.state=validateBurnJournalState(JSON.parse(JSON.stringify(f.state)));
 assert.equal(funding.beginExecutionRefund(f.state,f.id,args),null);assert.throws(()=>funding.retainExecutionRefund(f.state,f.id,packet),/NotAuthorized/);
 funding.markExecutionRefund(f.state,f.id,packet.signature,{outcome:'FINALIZED',actualFeeLamports:'5000'});funding.markExecutionRefund(f.state,f.id,packet.signature,{outcome:'FINALIZED',actualFeeLamports:'5000'});
 assert.equal(funding.executionTotals(funding.executionRecord(f.state,f.id)).liability,0n);assert.equal(funding.beginExecutionRefund(f.state,f.id,args),null);validateBurnJournalState(f.state);
});
test('wrong refund destination or amount cannot survive protected journal validation',t=>{
 const f=fixture(t);pay(f);const terms=funding.beginExecutionRefund(f.state,f.id,{now:1e12,feeLamports:'5000',nativeClear:true});funding.retainExecutionRefund(f.state,f.id,refundPacket(f,terms));
 for(const delta of [{destination:key('66'.repeat(32))},{amountLamports:'1'},{sequence:2},{source:key('11'.repeat(32))}]){const bad=structuredClone(f.state);Object.assign(bad.execution.records[0].refunds[0],delta);assert.throws(()=>validateBurnJournalState(bad));}
});
test('Native addresses for pending and expired fee intents remain observed without public issuance',t=>{
 const f=fixture(t);pay(f);const watched=funding.executionWatchOperations(f.state);assert.equal(watched.length,1);assert.equal(watched[0].operationId,f.id);
 funding.beginExecutionRefund(f.state,f.id,{now:1e12,feeLamports:'5000',nativeClear:true});funding.recordExecutionNativeObservations(f.state,f.id,[f.deposit]);
 assert.equal(funding.executionWatchOperations(f.state)[0].exception.deposits.length,1);assert.equal(funding.executionRecord(f.state,f.id).hold,'LATE_NATIVE_DEPOSIT_REVIEW_REQUIRED');
 assert.throws(()=>issueBurnDeposit(f.state,f.binding,20),/FUNDING_REQUIRED/);assert.equal(f.state.paused,false);
});
test('browser independently reconstructs only the fixed transfer and operation memo; modified bytes never reach Phantom',async t=>{
 const f=fixture(t);quote(f);const q=funding.publicExecutionFunding(f.state,f.id).quote;
 const options={base58,operationId:f.id,destination:q.destination,recipient:q.recipient,genesis:q.genesis};
 assert(Buffer.from(await validateExecutionQuote(q,options)).equals(Buffer.from(q.unsignedTransactionBase64,'base64')));
 for(const delta of [{amountLamports:'1'},{recipient:key('55'.repeat(32))},{operationId:'66'.repeat(32)},{unsignedTransactionBase64:Buffer.alloc(300).toString('base64')}])await assert.rejects(validateExecutionQuote({...q,...delta},options));
});
test('Phantom rejection and changed connected wallet produce no authorization or local signing',async t=>{
 const f=fixture(t),r=funding.executionRecord(f.state,f.id);
 const q=quote(f);const adapted={...q,recipient:EXECUTION_RECIPIENT,genesis:EXECUTION_GENESIS};delete adapted.quoteId;adapted.quoteId=wire.executionDigest(adapted);adapted.unsignedTransactionBase64=wire.executionUnsignedTransaction(wire.executionPaymentMessage(adapted));
 const operation={operationId:f.id,destination:adapted.destination,executionFunding:{quote:adapted}},account={address:adapted.destination,chains:['solana:mainnet']};let calls=0;
 const wallet={chains:['solana:mainnet'],features:{'solana:signAndSendTransaction':{signAndSendTransaction:async()=>{calls++;throw Object.assign(Error('Cancelled'),{code:4001});}}}};
 await assert.rejects(signExecutionPayment({wallet,account,operation,base58}),/Cancelled/);assert.equal(calls,1);assert.equal(r.payments.length,0);
 await assert.rejects(signExecutionPayment({wallet,account:{...account,address:EXECUTION_RECIPIENT},operation,base58}));assert.equal(calls,1);
 assert.equal(f.state.operations.length,0);assert.equal(f.state.paused,false);
});
