// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Called only inside BurnRuntime's exclusive queue. The protected journal is the
// single durable authority; a client signature is a lookup hint, never a credit.
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {requireProtectedBurnJournal} from './protected-burn-journal.mjs';
import {requireBurnSolanaAdapter} from '../solana-observer/burn-solana-adapter.mjs';
import {requireProtectedBurnSolanaSigner} from '../relayer/burn-solana-signer.mjs';
import {issueBurnDeposit,recordBurnDeposits} from './burn-journal-state.mjs';
import {executionLamports as amount,verifyExecutionPayment} from './execution-funding-wire.mjs';
import {executionRecord,executionTotals,executionRequiredBalance,executionOperatorAvailable,executionBudget,
 activateExecutionFunding,retainExecutionQuote,creditExecutionPayment,recordExecutionCost,
 requireExecutionAddressFunding,requireExecutionSolvency,commitExecutionBurn,beginExecutionRefund,retainExecutionRefund,markExecutionRefund} from './execution-funding-state.mjs';

export class ExecutionFundingController {
 #journal;#solana;#signer;ready=false;
 constructor({journal,solana,signer}){requireProtectedBurnJournal(journal);requireBurnSolanaAdapter(solana);requireProtectedBurnSolanaSigner(signer);this.#journal=journal;this.#solana=solana;this.#signer=signer;}
 async review(){
  const state=this.#journal.read(),binding=state.operations.at(-1)?.binding??state.execution?.records.at(-1)?.binding;
  check(binding,'ExecutionReviewBindingRequired');const estimate=await this.#solana.executionEstimate(binding);
  const budget=executionBudget({...estimate.budget,ataExists:false});
  const unsignedLegacy=state.operations.filter(o=>(!state.execution||state.execution.legacyIds.includes(o.operationId))&&o.deposit&&!o.signedBurnHex&&!o.broadcastAttempted&&!o.mintReceipt);
  const legacyProvision=BigInt(unsignedLegacy.length)*amount(budget.executionLamports);
  const required=executionRequiredBalance(state,budget)+amount(budget.completionBackstopLamports)+legacyProvision;
  const balance=amount(await this.#solana.executionBalance()),liabilities=(state.execution?.records??[]).reduce((n,r)=>n+executionTotals(r).liability,0n);
  const capital=state.execution?executionOperatorAvailable(state):balance;
  const shortfall=[required-balance,required-liabilities-capital,0n].reduce((a,b)=>a>b?a:b);
  return {recipient:estimate.recipient,balanceLamports:String(balance),requiredBalanceLamports:String(required),additionalFundingLamports:String(shortfall),completionBackstopPerOperationLamports:budget.completionBackstopLamports,
   walletReserveLamports:budget.walletReserveLamports,legacyProvisionLamports:String(legacyProvision),userLiabilityLamports:String(liabilities),budget,createdSlot:this.#solana.executionSlot,policy:state.execution?'USER_FUNDED':'LEGACY_OPERATOR_FUNDED'};
 }
 async activate(){
  check(!this.#journal.read().execution,'ExecutionAlreadyMigrated');const report=await this.review();check(report.additionalFundingLamports==='0','EXECUTION_BACKSTOP_FUNDING_REQUIRED');
  const history=await this.#solana.executionHistory(null,{latestOnly:true});
  check(!history[0]||history[0].slot<=report.createdSlot,'EXECUTION_CUTOVER_BALANCE_CHANGED');
  this.#journal.update(s=>activateExecutionFunding(s,{now:Date.now(),slot:report.createdSlot,budget:report.budget,balanceLamports:report.balanceLamports,scanSignature:history[0]?.signature??null}));
  this.ready=true;return report;
 }
 async quote(id){
  const state=this.#journal.read(),r=executionRecord(state,id);check(r,'ExecutionOperationUnknown');
  check(!r.burnCommitted&&!r.closed,'ExecutionQuoteNotAllowed');
  const estimate=await this.#solana.executionEstimate(r.binding);
  requireExecutionSolvency(state,estimate.budget,await this.#solana.executionBalance(),{candidateId:id});
  // Reuse still-valid exact payment bytes. A wallet retry has the same signature;
  // do not invite a second distinct debit while an earlier payment can still land.
  const previous=r.quotes.at(-1),unchanged=previous&&['accountRentLamports','networkFeeLamports','priorityFeeLamports','retryAllowanceLamports','refundAllowanceLamports','paymentFeeLamports'].every(k=>previous.budget[k]===estimate.budget[k]);
  if(unchanged&&await this.#solana.executionHeight()<=BigInt(previous.lastValidBlockHeight))return;
  this.#journal.update(s=>retainExecutionQuote(s,id,{...estimate,now:Date.now()}));
 }
 async payment(id,signature){
  const r=executionRecord(this.#journal.read(),id);check(r,'ExecutionOperationUnknown');
  const transaction=await this.#solana.executionTransaction(signature);if(!transaction)return false;
  let payment;for(const quote of r.quotes){try{payment=verifyExecutionPayment({quote,signature,transaction});break;}catch(error){if(!/^Execution(?:Payment|Signature|Packet|Message)/u.test(error.message))throw error;}}
  check(payment,'ExecutionPaymentBindingRejected');this.#journal.update(s=>creditExecutionPayment(s,id,payment,Date.now()));return true;
 }
 async synchronize(){
  this.ready=false;let state=this.#journal.read();if(!state.execution){this.ready=true;return;}
  const history=await this.#solana.executionHistory(state.execution.scanSignature);
  const known=new Set([...state.operations.flatMap(o=>(o.solanaPacket??[]).map(x=>x.packet.signature)),...state.execution.records.flatMap(r=>[...r.payments,...r.refunds].map(x=>x.signature))]);
  const credits=[];let unknownDebit=false;
  for(const row of [...history].reverse()){
   if(known.has(row.signature))continue;const transaction=await this.#solana.executionTransaction(row.signature);check(transaction,'EXECUTION_PAYMENT_SCAN_INCOMPLETE');
   let found=false;
   for(const r of state.execution.records){for(const quote of r.quotes){try{const payment=verifyExecutionPayment({quote,signature:row.signature,transaction});credits.push({id:r.operationId,payment});found=true;break;}catch(error){if(!/^Execution(?:Payment|Signature|Packet|Message)/u.test(error.message))throw error;}}if(found)break;}
   if(!found&&await this.#solana.executionUnknownDebit(row.signature))unknownDebit=true;
  }
  // Costs are finalized exact-message debits. Failed transactions count only their network fees.
  const costs=[];
  for(const op of state.operations){
   for(const row of op.solanaPacket??[]){
    if(row.outcome==='EXPIRED_UNSEEN'||executionRecord(state,op.operationId)?.costs.some(c=>c.signature===row.packet.signature)||state.execution.operatorCosts.some(c=>c.signature===row.packet.signature))continue;
    if(state.execution.legacyIds.includes(op.operationId)&&row.outcome==='FINALIZED'&&Number(row.observedSlot)<=state.execution.activatedSlot)continue;
    const cost=await this.#solana.executionCost(op,row.packet);if(cost)costs.push({id:op.operationId,cost});
   }
  }
  const refunds=[];
  for(const r of state.execution.records)for(const row of r.refunds.filter(x=>x.outcome==='UNRESOLVED')){const outcome=await this.#solana.executionRefundStatus(row);if(outcome)refunds.push({id:r.operationId,signature:row.signature,outcome});}
  this.#journal.update(s=>{
   for(const c of credits)creditExecutionPayment(s,c.id,c.payment,Date.now());for(const c of costs)recordExecutionCost(s,c.id,c.cost);
   for(const r of refunds)markExecutionRefund(s,r.id,r.signature,r.outcome);
   if(unknownDebit)s.execution.operatorHold='UNRECOGNIZED_PAYER_SPEND';
   if(history.length)s.execution.scanSignature=history[0].signature;
  });this.ready=true;
 }
 async issueFundedAddresses(){
  if(!this.ready)return;const state=this.#journal.read();if(!state.execution||state.paused)return;
  for(const r of state.execution.records){
   if(r.closed||r.burnCommitted||!r.payments.length||state.operations.some(o=>o.operationId===r.operationId))continue;
   try{
   try{requireExecutionAddressFunding(this.#journal.read(),r.operationId);}catch(error){if(error.message==='EXECUTION_FUNDING_REQUIRED')continue;throw error;}
   const estimate=await this.#solana.executionEstimate(r.binding);
   requireExecutionSolvency(this.#journal.read(),estimate.budget,await this.#solana.executionBalance(),{candidateId:r.operationId});
   if(executionTotals(executionRecord(this.#journal.read(),r.operationId)).available<amount(estimate.budget.depositLamports)){this.#journal.update(s=>{executionRecord(s,r.operationId).hold='EXECUTION_TOP_UP_REQUIRED';});continue;}
   this.#journal.update(s=>{issueBurnDeposit(s,r.binding,r.createdHeight);recordBurnDeposits(s,r.operationId,executionRecord(s,r.operationId).nativeObservations);});
   }catch(error){const code=/^[A-Z_]{1,64}$/u.test(error.message)?error.message:'EXECUTION_ADDRESS_REVIEW_REQUIRED';this.#journal.update(s=>{executionRecord(s,r.operationId).hold=code;});}
  }
 }
 async admission(id,{commit=false}={}){
  const state=this.#journal.read(),op=state.operations.find(o=>o.operationId===id);check(op,'ExecutionOperationUnknown');
  if(!state.execution||op.signedBurnHex||op.broadcastAttempted||op.burnEvidence||executionRecord(state,id)?.burnCommitted)return true;
  check(this.ready,'EXECUTION_FUNDING_RECONCILIATION_PENDING');
  const estimate=await this.#solana.executionEstimate(op.binding),balanceLamports=await this.#solana.executionBalance();
  // Run the same gate on a copy before ATA spending; reserve durably immediately before Native signing.
  if(commit)this.#journal.update(s=>commitExecutionBurn(s,id,{budget:estimate.budget,balanceLamports}));
  else commitExecutionBurn(structuredClone(this.#journal.read()),id,{budget:estimate.budget,balanceLamports});
  return true;
 }
 async refunds({nativeClear}){
  if(!this.ready)return;const state=this.#journal.read();if(!state.execution||state.paused)return;
  for(const r of state.execution.records){
   if(!r.payments.length)continue;const op=state.operations.find(o=>o.operationId===r.operationId);
   if(op&&!op.mintReceipt&&(op.signedBurnHex||op.broadcastAttempted||r.burnCommitted))continue;
   let pending=r.refunds.find(x=>x.outcome==='UNRESOLVED');
   const estimate=await this.#solana.executionEstimate(r.binding);
   // Preserve every other operation's liability and all completion backstops.
   requireExecutionSolvency(this.#journal.read(),estimate.budget,await this.#solana.executionBalance());
   if(!pending){
    const terms=this.#journal.update(s=>beginExecutionRefund(s,r.operationId,{now:Date.now(),nativeClear,feeLamports:estimate.budget.fees.refund}));if(!terms)continue;
    const recent=await this.#solana.latestBlockhash();
    const packet=this.#signer.prepareExecutionRefund({operationId:r.operationId,sequence:terms.sequence,amountLamports:terms.amountLamports,feeLamports:terms.feeLamports,...recent});
    this.#journal.update(s=>retainExecutionRefund(s,r.operationId,packet));pending=executionRecord(this.#journal.read(),r.operationId).refunds.at(-1);
   }
   check(pending.sendAttempts<32,'EXECUTION_REFUND_REVIEW_REQUIRED');
   const resolved=await this.#solana.executionRefundStatus(pending);
   if(resolved){this.#journal.update(s=>markExecutionRefund(s,r.operationId,pending.signature,resolved));continue;}
   this.#journal.update(s=>{executionRecord(s,r.operationId).refunds.find(x=>x.signature===pending.signature).sendAttempts++;});
   await this.#solana.sendExecutionRefund(pending);
  }
 }
}
