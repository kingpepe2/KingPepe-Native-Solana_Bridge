// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Called only inside BurnRuntime's exclusive queue. The protected journal is the
// single durable authority; a client signature is a lookup hint, never a credit.
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {requireProtectedBurnJournal} from './protected-burn-journal.mjs';
import {requireBurnSolanaAdapter} from '../solana-observer/burn-solana-adapter.mjs';
import {requireProtectedBurnSolanaSigner} from '../relayer/burn-solana-signer.mjs';
import {issueBurnDeposit,recordBurnDeposits,markBurnSolanaPacket} from './burn-journal-state.mjs';
import {executionLamports as amount,verifyExecutionPayment} from './execution-funding-wire.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
import {executionRecord,executionTotals,executionRequiredBalance,executionOperatorAvailable,executionCommitted,executionShortfall,recordExecutionCheck,
 executionSpendIntent,executionPendingSpend,reserveExecutionSpend,requireExecutionSpendIntent,adoptLegacyExecutionFunding,
 activateExecutionFunding,retainExecutionQuote,creditExecutionPayment,recordExecutionCost,
 requireExecutionAddressFunding,requireExecutionSolvency,commitExecutionBurn,beginExecutionRefund,retainExecutionRefund,markExecutionRefund} from './execution-funding-state.mjs';

export class ExecutionFundingController {
 #journal;#solana;#signer;ready=false;
 constructor({journal,solana,signer}){requireProtectedBurnJournal(journal);requireBurnSolanaAdapter(solana);requireProtectedBurnSolanaSigner(signer);this.#journal=journal;this.#solana=solana;this.#signer=signer;}
 async review(){
  const state=this.#journal.read(),binding=state.operations.at(-1)?.binding??state.execution?.records.at(-1)?.binding;
  check(binding,'ExecutionReviewBindingRequired');const estimate=await this.#solana.executionEstimate(binding);
  const balance=await this.#solana.executionBalance();
  return {recipient:estimate.recipient,balanceLamports:balance,globalCompletionBackstop:false,teamReserveRequiredLamports:'0',userLiabilityLamports:String(executionRequiredBalance(state)),
   legacyUnburnedReview:state.operations.filter(o=>(!state.execution||state.execution.legacyIds.includes(o.operationId))&&!o.plan&&!o.signedBurnHex&&!o.broadcastAttempted&&!o.mintReceipt).map(o=>o.operationId),
   budget:estimate.budget,createdSlot:this.#solana.executionSlot,policy:state.execution?'USER_FUNDED':'LEGACY_OPERATOR_FUNDED'};
 }
 async activate(){
  check(!this.#journal.read().execution,'ExecutionAlreadyMigrated');const report=await this.review();
  const history=await this.#solana.executionHistory(null,{latestOnly:true});
  check(!history[0]||history[0].slot<=report.createdSlot,'EXECUTION_CUTOVER_BALANCE_CHANGED');
  this.#journal.update(s=>activateExecutionFunding(s,{now:Date.now(),slot:report.createdSlot,budget:report.budget,balanceLamports:report.balanceLamports,scanSignature:history[0]?.signature??null}));
  this.ready=true;return report;
 }
 adoptLegacy(id){this.#journal.update(s=>adoptLegacyExecutionFunding(s,id,Date.now()));}
 async #estimate(id){const s=this.#journal.read(),op=s.operations.find(o=>o.operationId===id),r=executionRecord(s,id);return this.#solana.executionEstimate(r?.binding??op?.binding,op);}
 async #retainQuote(id,estimate,{refresh=false}={}){
  const state=this.#journal.read(),r=executionRecord(state,id),previous=r.quotes.at(-1),needed=executionShortfall(state,id,estimate.budget);
  // A repeated check never creates a charge or a different valid payment packet.
  if(needed===0n)return;
  const unchanged=previous&&previous.amountLamports===String(needed)&&JSON.stringify(previous.budget)===JSON.stringify(estimate.budget);
  if(unchanged&&(!refresh||await this.#solana.executionHeight()<=BigInt(previous.lastValidBlockHeight)))return;
  this.#journal.update(s=>retainExecutionQuote(s,id,{...estimate,now:Date.now()}));
 }
 async quote(id){
  const state=this.#journal.read(),r=executionRecord(state,id);check(r,'ExecutionOperationUnknown');
  check(!r.burnCommitted&&!r.closed,'ExecutionQuoteNotAllowed');
  const estimate=await this.#estimate(id);requireExecutionSolvency(state,await this.#solana.executionBalance());
  this.#journal.update(s=>recordExecutionCheck(s,id,{budget:estimate.budget,now:Date.now(),slot:estimate.createdSlot}));
  await this.#retainQuote(id,estimate,{refresh:true});
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
  const costs=[],expiredPackets=[];
  for(const op of state.operations){
   for(const row of op.solanaPacket??[]){
    if(row.outcome==='EXPIRED_UNSEEN'||executionRecord(state,op.operationId)?.costs.some(c=>c.signature===row.packet.signature)||state.execution.operatorCosts.some(c=>c.signature===row.packet.signature))continue;
    if(state.execution.legacyIds.includes(op.operationId)&&row.outcome==='FINALIZED'&&Number(row.observedSlot)<=state.execution.activatedSlot)continue;
    const cost=await this.#solana.executionCost(op,row.packet);if(cost)costs.push({id:op.operationId,cost});
    else if(await this.#solana.executionPacketExpired(row.packet))expiredPackets.push({id:op.operationId,row});
   }
  }
  const refunds=[];
  for(const r of state.execution.records)for(const row of r.refunds.filter(x=>x.outcome==='UNRESOLVED')){const outcome=await this.#solana.executionRefundStatus(row);if(outcome)refunds.push({id:r.operationId,signature:row.signature,outcome});}
  const orphans=state.execution.spends.filter(s=>!s.abandoned&&!state.operations.find(o=>o.operationId===s.operationId)?.solanaPacket?.[s.index]);
  const expired=[];
  if(orphans.length){const height=await this.#solana.executionHeight();for(const s of orphans)if(height>BigInt(s.lastValidBlockHeight))expired.push(s);}
  this.#journal.update(s=>{
   for(const c of credits)creditExecutionPayment(s,c.id,c.payment,Date.now());for(const c of costs)recordExecutionCost(s,c.id,c.cost);
   for(const {id,row} of expiredPackets)markBurnSolanaPacket(s,id,row.packet.signature,{outcome:'EXPIRED_UNSEEN',sendAttempts:row.sendAttempts,observedSlot:String(this.#solana.executionSlot)});
   for(const r of refunds)markExecutionRefund(s,r.id,r.signature,r.outcome);
   for(const row of expired)executionSpendIntent(s,row.operationId,row.index).abandoned=true;
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
   const estimate=await this.#estimate(r.operationId);
   requireExecutionSolvency(this.#journal.read(),await this.#solana.executionBalance());
   const missing=this.#journal.update(s=>recordExecutionCheck(s,r.operationId,{budget:estimate.budget,now:Date.now(),slot:estimate.createdSlot}));
   if(missing>0n){await this.#retainQuote(r.operationId,estimate);continue;}
   this.#journal.update(s=>{issueBurnDeposit(s,r.binding,r.createdHeight);recordBurnDeposits(s,r.operationId,executionRecord(s,r.operationId).nativeObservations);});
   }catch(error){const code=/^[A-Z_]{1,64}$/u.test(error.message)?error.message:'EXECUTION_ADDRESS_REVIEW_REQUIRED';this.#journal.update(s=>{executionRecord(s,r.operationId).hold=code;});}
  }
 }
 async admission(id,{commit=false}={}){
  const state=this.#journal.read(),op=state.operations.find(o=>o.operationId===id);check(op,'ExecutionOperationUnknown');
  if(!state.execution||op.signedBurnHex||op.broadcastAttempted||op.burnEvidence||executionRecord(state,id)?.burnCommitted)return true;
  if(!executionRecord(state,id))check(state.execution.legacyCommittedIds.includes(id),'EXECUTION_LEGACY_POLICY_REVIEW_REQUIRED');
  check(this.ready,'EXECUTION_FUNDING_RECONCILIATION_PENDING');
  await this.synchronize();
  const pending=executionPendingSpend(this.#journal.read(),id);if(pending>0n&&!commit)return true;
  check(pending===0n,'EXECUTION_SPEND_RECONCILIATION_PENDING');
  const estimate=await this.#estimate(id),balanceLamports=await this.#solana.executionBalance();
  if(executionRecord(state,id)){
   const missing=this.#journal.update(s=>recordExecutionCheck(s,id,{budget:estimate.budget,now:Date.now(),slot:estimate.createdSlot}));
   if(missing>0n){await this.#retainQuote(id,estimate);throw Error('EXECUTION_ADDITIONAL_SOL_REQUIRED');}
  }
  // Run the same gate on a copy before ATA spending; reserve durably immediately before Native signing.
  if(commit)this.#journal.update(s=>commitExecutionBurn(s,id,{budget:estimate.budget,balanceLamports}));
  else commitExecutionBurn(structuredClone(this.#journal.read()),id,{budget:estimate.budget,balanceLamports});
  return true;
 }
 async prepareSpend(id,kind){
  if(!this.#journal.read().execution)return this.#solana.latestBlockhash();
  await this.synchronize();let state=this.#journal.read(),op=state.operations.find(o=>o.operationId===id),index=op.solanaPacket?.length??0;
  let intent=executionSpendIntent(state,id,index);
  if(intent&&await this.#solana.executionHeight()>BigInt(intent.lastValidBlockHeight)){
   this.#journal.update(s=>{executionSpendIntent(s,id,index).abandoned=true;});intent=null;state=this.#journal.read();
  }
  const digest=kind==='ATA'?null:decodeCanonicalBridgeMessage(Buffer.from(op.attestation.encodedMessageHex,'hex')).messageDigestHex;
  if(intent){check(intent.kind===kind&&intent.messageDigestHex===digest,'EXECUTION_SPEND_RECONCILIATION_PENDING');return {recentBlockhash:intent.recentBlockhash,lastValidBlockHeight:intent.lastValidBlockHeight};}
  check(executionPendingSpend(state,id)===0n,'EXECUTION_SPEND_RECONCILIATION_PENDING');
  const estimate=await this.#estimate(id),balance=await this.#solana.executionBalance();
  if(executionRecord(state,id)){
   const missing=this.#journal.update(s=>recordExecutionCheck(s,id,{budget:estimate.budget,now:Date.now(),slot:estimate.createdSlot}));
   if(missing>0n){if(!executionCommitted(state,id))await this.#retainQuote(id,estimate);throw Error(executionCommitted(state,id)?'EXECUTION_POST_BURN_FUNDING_INCIDENT':'EXECUTION_ADDITIONAL_SOL_REQUIRED');}
  }
  check(estimate.budget.packetCounts[kind]<8,'EXECUTION_PACKET_RETRY_POLICY_EXHAUSTED');
  const terms={index,kind,messageDigestHex:digest,maximumDebitLamports:this.#solana.executionPacketDebit(kind,estimate.budget),createdSlot:estimate.createdSlot,recentBlockhash:estimate.recentBlockhash,lastValidBlockHeight:estimate.lastValidBlockHeight};
  this.#journal.update(s=>reserveExecutionSpend(s,id,terms,balance));return {recentBlockhash:terms.recentBlockhash,lastValidBlockHeight:terms.lastValidBlockHeight};
 }
 async authorizeSend(id,packet){
  if(!this.#journal.read().execution)return;
  await this.synchronize();let state=this.#journal.read(),op=state.operations.find(o=>o.operationId===id);
  const estimate=await this.#estimate(id),balance=await this.#solana.executionBalance(),packetFee=amount(await this.#solana.executionPacketFee(packet));
  const cost=amount(this.#solana.executionPacketDebit(packet.kind,estimate.budget))-amount(packet.kind==='RECEIPT'?estimate.budget.fees.receipt:estimate.budget.fees.single)+packetFee;
  const index=op.solanaPacket.findIndex(x=>x.packet.signature===packet.signature);check(index>=0,'ExecutionPacketNotRetained');
  if(!executionSpendIntent(state,id,index)&&state.execution.legacyCommittedIds.includes(id)){
   this.#journal.update(s=>reserveExecutionSpend(s,id,{index,kind:packet.kind,messageDigestHex:packet.messageDigestHex,maximumDebitLamports:String(cost),createdSlot:estimate.createdSlot,recentBlockhash:packet.recentBlockhash,lastValidBlockHeight:packet.lastValidBlockHeight},balance));state=this.#journal.read();
  }
  const intent=requireExecutionSpendIntent(state,id,packet);requireExecutionSolvency(state,balance);
  const r=executionRecord(state,id);
  check(cost<=amount(intent.maximumDebitLamports),'EXECUTION_SIGNED_COST_CHANGED');
  if(r)check(executionTotals(r).available>=executionPendingSpend(state,id),'EXECUTION_POST_BURN_FUNDING_INCIDENT');
  else check(executionOperatorAvailable(state)>=state.execution.legacyIds.reduce((n,x)=>n+executionPendingSpend(state,x),0n)&&amount(balance)-executionRequiredBalance(state)>=cost,'EXECUTION_LEGACY_FUNDING_INCIDENT');
 }
 async refunds({nativeClear}){
  if(!this.ready)return;const state=this.#journal.read();if(!state.execution||state.paused)return;
  for(const r of state.execution.records){
   if(!r.payments.length)continue;const op=state.operations.find(o=>o.operationId===r.operationId);
   if(op&&!op.mintReceipt&&(op.signedBurnHex||op.broadcastAttempted||r.burnCommitted))continue;
   let pending=r.refunds.find(x=>x.outcome==='UNRESOLVED');
   const estimate=await this.#estimate(r.operationId);
   // Preserve every operation's exclusive liability. There is no Team reserve.
   requireExecutionSolvency(this.#journal.read(),await this.#solana.executionBalance());
   if(!pending){
    const terms=this.#journal.update(s=>beginExecutionRefund(s,r.operationId,{now:Date.now(),nativeClear,feeLamports:estimate.budget.fees.refund}));if(!terms)continue;
    const recent=await this.#solana.latestBlockhash();
    const packet=this.#signer.prepareExecutionRefund({operationId:r.operationId,sequence:terms.sequence,amountLamports:terms.amountLamports,feeLamports:terms.feeLamports,...recent});
    this.#journal.update(s=>retainExecutionRefund(s,r.operationId,packet));pending=executionRecord(this.#journal.read(),r.operationId).refunds.at(-1);
   }
   check(pending.sendAttempts<32,'EXECUTION_REFUND_REVIEW_REQUIRED');
   const resolved=await this.#solana.executionRefundStatus(pending);
   if(resolved){this.#journal.update(s=>markExecutionRefund(s,r.operationId,pending.signature,resolved));continue;}
   check(amount(await this.#solana.executionPacketFee(pending))<=amount(pending.feeLamports),'EXECUTION_REFUND_FEE_CHANGED');
   this.#journal.update(s=>{executionRecord(s,r.operationId).refunds.find(x=>x.signature===pending.signature).sendAttempts++;});
   await this.#solana.sendExecutionRefund(pending);
  }
 }
}
