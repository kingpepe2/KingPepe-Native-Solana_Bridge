// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// SOL liabilities are separate from the unchanged KPEPE conservation equation.
import {burnOperationId,burnHash,burnAmount,validateBurnBinding,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {burnDepositDestination} from '../../native/burn/burn-key.mjs';
import {base58Decode} from './solana-deposit-claim-transaction-plan.mjs';
import {executionDigest,executionLamports as amount,executionPublicKey,executionPaymentMessage,executionUnsignedTransaction,executionTransferMessage,executionRefundMemo,verifyExecutionSignedMessage} from './execution-funding-wire.mjs';
export const EXECUTION_VERSION=1,EXECUTION_EXPIRY_MS=24*60*60*1000,EXECUTION_PACKET_LIMIT=8;
const integer=n=>check(Number.isSafeInteger(n)&&n>=0,'ExecutionIntegerRejected');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=structuredClone;
export function executionBudget({rents,fees,ataExists}){
 for(const size of [0,73,165,211,240])amount(rents[size]);
 for(const key of ['single','receipt','payment','refund'])amount(fees[key]);
 check(typeof ataExists==='boolean','ExecutionAtaStateRequired');
 const protocol=amount(rents[240])+amount(rents[211])+2n*amount(rents[73]);
 const network=amount(fees.receipt)+amount(fees.single)+(ataExists?0n:amount(fees.single));
 const account=protocol+(ataExists?0n:amount(rents[165]));
 const backstop=BigInt(EXECUTION_PACKET_LIMIT)*(amount(rents[240])+amount(rents[165])+amount(fees.receipt)+2n*amount(fees.single))+amount(rents[211])+2n*amount(rents[73]);
 return {rents:clone(rents),fees:clone(fees),ataExists,accountRentLamports:String(account),networkFeeLamports:String(network),priorityFeeLamports:'0',retryAllowanceLamports:String(network),refundAllowanceLamports:fees.refund,
  executionLamports:String(account+network),depositLamports:String(account+2n*network+amount(fees.refund)),paymentFeeLamports:fees.payment,
  walletDebitLamports:String(account+2n*network+amount(fees.refund)+amount(fees.payment)),walletReserveLamports:rents[0],completionBackstopLamports:String(backstop)};
}
export function executionRecord(state,id){return state.execution?.records.find(r=>r.operationId===id)??null;}
export function isLegacyExecution(state,id){return !state.execution||state.execution.legacyIds.includes(id);}
export function executionTotals(record){
 const funded=record.payments.reduce((n,p)=>n+amount(p.amountLamports),0n),cost=record.costs.reduce((n,c)=>n+amount(c.lamports),0n);
 const refunds=record.refunds.filter(r=>r.outcome==='FINALIZED').reduce((n,r)=>n+amount(r.amountLamports),0n);
 const refundFees=record.refunds.filter(r=>['FINALIZED','FINALIZED_FAILED'].includes(r.outcome)).reduce((n,r)=>n+amount(r.actualFeeLamports),0n);
 const pending=record.refunds.filter(r=>r.outcome==='UNRESOLVED').reduce((n,r)=>n+amount(r.amountLamports)+amount(r.feeLamports),0n);
 const remainder=funded-cost-refunds-refundFees;
 return {funded,cost,refunds,refundFees,pending,available:remainder-pending,liability:remainder>0n?remainder:0n,operatorContribution:remainder<0n?-remainder:0n};
}
export function executionRequiredBalance(state,budget,{candidateId=null,candidateCost='0'}={}){
 let required=amount(budget.walletReserveLamports);
 for(const record of state.execution?.records??[])required+=executionTotals(record).liability;
 // A legacy prepared plan may have been signed immediately before a crash in
 // the older runtime. Reserve its completion conservatively during migration.
 const obligations=state.operations.filter(o=>(o.signedBurnHex||o.broadcastAttempted||executionRecord(state,o.operationId)?.burnCommitted||o.plan&&isLegacyExecution(state,o.operationId))&&!o.mintReceipt);
 required+=BigInt(obligations.length)*amount(budget.completionBackstopLamports);
 if(candidateId&&!obligations.some(o=>o.operationId===candidateId))required+=amount(budget.completionBackstopLamports);
 if(candidateId&&isLegacyExecution(state,candidateId)&&!obligations.some(o=>o.operationId===candidateId))required+=amount(candidateCost);
  return required;
}
export function executionOperatorAvailable(state){
 if(!state.execution)return 0n;
 return amount(state.execution.operatorCapitalLamports)-state.execution.operatorCosts.reduce((n,c)=>n+amount(c.lamports),0n)-state.execution.records.reduce((n,r)=>n+executionTotals(r).operatorContribution,0n);
}
export function requireExecutionSolvency(state,budget,balanceLamports,options={}){
 check(state.execution&&!state.execution.operatorHold,'EXECUTION_OPERATOR_REVIEW_REQUIRED');
 const liabilities=state.execution.records.reduce((n,r)=>n+executionTotals(r).liability,0n),required=executionRequiredBalance(state,budget,options);
 check(amount(balanceLamports)>=required&&executionOperatorAvailable(state)>=required-liabilities,'EXECUTION_BACKSTOP_FUNDING_REQUIRED');
}
export function activateExecutionFunding(state,{now,slot,budget,balanceLamports,scanSignature}){
  integer(now);check(!state.execution,'ExecutionAlreadyMigrated');
  integer(slot);
 check(scanSignature===null||typeof scanSignature==='string','ExecutionScanCursorRejected');
 const minimum=executionRequiredBalance(state,budget)+amount(budget.completionBackstopLamports);
 check(amount(balanceLamports)>=minimum,'EXECUTION_BACKSTOP_FUNDING_REQUIRED');
  state.execution={version:EXECUTION_VERSION,activatedAt:now,activatedSlot:slot,operatorCapitalLamports:balanceLamports,operatorCosts:[],operatorHold:null,legacyIds:state.operations.map(o=>o.operationId),scanSignature,records:[]};
}
export function createExecutionIntent(state,binding,now,createdHeight){
 check(state.execution&&!state.paused,'EXECUTION_POLICY_UNAVAILABLE');validateBurnBinding(binding);integer(now);integer(createdHeight);
 check(Object.entries(state.deployment).every(([k,v])=>binding[k]===v),'ExecutionDeploymentChanged');
 const operationId=burnOperationId(binding),known=executionRecord(state,operationId);
 if(known){check(same(known.binding,binding),'ExecutionDestinationChanged');return known;}
 check(!state.operations.some(o=>o.operationId===operationId)&&state.execution.records.length<128,'ExecutionIntentCapacity');
 check(Buffer.byteLength(JSON.stringify(state))+65000*(state.operations.filter(o=>!o.retired).length+state.execution.records.filter(r=>!r.closed).length+1)<1_000_000,'ExecutionRecoveryCapacity');
 check(state.execution.records.filter(r=>r.binding.destination===binding.destination&&!r.closed).length<3,'ExecutionWalletIntentCapacity');
 const row={operationId,binding:clone(binding),createdAt:now,createdHeight,nativeObservations:[],fundedAt:null,quotes:[],payments:[],costs:[],refunds:[],burnCommitted:false,closed:false,hold:null};state.execution.records.push(row);
 return row;
}
export function executionWatchOperations(state){
 return [...state.operations,...(state.execution?.records??[]).filter(r=>!state.operations.some(o=>o.operationId===r.operationId)).map(r=>{
  const d=burnDepositDestination(r.binding);return {operationId:r.operationId,createdHeight:r.createdHeight,depositScriptHex:d.scriptPubKeyHex,deposit:null,exception:{deposits:r.nativeObservations}};
 })];
}
export function recordExecutionNativeObservations(state,id,observations){
 const r=executionRecord(state,id);check(r,'ExecutionOperationUnknown');validateNativeObservations(observations);r.nativeObservations=clone(observations);
 if(r.closed&&observations.length)r.hold='LATE_NATIVE_DEPOSIT_REVIEW_REQUIRED';
}
function validateNativeObservations(rows){
 check(Array.isArray(rows)&&rows.length<=64,'ExecutionNativeObservationsRejected');const seen=new Set();
 for(const o of rows){check(Object.keys(o).sort().join()==='amountAtomic,blockHash,confirmations,height,txid,vout','ExecutionNativeObservationShape');burnHash(o.txid);burnAmount(o.amountAtomic);integer(o.vout);integer(o.height);integer(o.confirmations);if(o.blockHash!==null)burnHash(o.blockHash);
  check(o.vout<=0xffffffff&&(o.confirmations===0?o.height===0&&o.blockHash===null:o.height>0&&o.blockHash!==null)&&!seen.has(`${o.txid}:${o.vout}`),'ExecutionNativeObservationRejected');seen.add(`${o.txid}:${o.vout}`);}
}
export function retainExecutionQuote(state,id,{budget,now,createdSlot,recentBlockhash,lastValidBlockHeight,recipient,destination,genesis}){
 const r=executionRecord(state,id);check(r&&!r.burnCommitted&&!r.closed&&!r.refunds.some(x=>x.outcome==='UNRESOLVED'),'ExecutionQuoteNotAllowed');integer(now);integer(createdSlot);
 executionPublicKey(recipient);executionPublicKey(destination);executionPublicKey(genesis);executionPublicKey(recentBlockhash);amount(lastValidBlockHeight);
 check(r.quotes.length<16,'ExecutionQuoteCapacity');
 const totals=executionTotals(r),needed=amount(budget.depositLamports)>totals.available?amount(budget.depositLamports)-totals.available:0n;
 if(needed===0n){r.hold=null;return null;}
 const q={version:EXECUTION_VERSION,operationId:id,destination,recipient,genesis,createdAt:now,createdSlot,recentBlockhash,lastValidBlockHeight,
  amountLamports:String(needed),budget:clone(budget)};
 q.quoteId=executionDigest(q);r.quotes.push(q);r.hold='AWAITING_EXECUTION_FUNDING';return clone(q);
}
export function creditExecutionPayment(state,id,payment,now){
 const r=executionRecord(state,id);check(r,'ExecutionOperationUnknown');integer(now);
 const previous=state.execution.records.flatMap(x=>x.payments.map(p=>({id:x.operationId,p}))).find(x=>x.p.signature===payment.signature);
 if(previous){check(previous.id===id&&same(previous.p,payment),'ExecutionPaymentReplay');return false;}
 const quote=r.quotes.find(q=>q.quoteId===payment.quoteId);
 check(quote&&payment.operationId===id&&payment.amountLamports===quote.amountLamports&&payment.slot>=quote.createdSlot,'ExecutionPaymentBinding');
 check(r.payments.length<32,'ExecutionPaymentCapacity');r.payments.push(clone(payment));r.fundedAt??=now;
 // A real second transfer is a refund liability, never a second operation.
 if(!r.closed)r.hold=null;return true;
}
export function requireExecutionAddressFunding(state,id){
 if(!state.execution||state.execution.legacyIds.includes(id))return;
 const r=executionRecord(state,id),q=r?.quotes.at(-1);
  check(r&&!r.closed&&!r.burnCommitted&&q&&r.payments.length>0&&executionTotals(r).available>=amount(q.budget.depositLamports)&&!r.refunds.some(x=>x.outcome==='UNRESOLVED'),'EXECUTION_FUNDING_REQUIRED');
}
export function commitExecutionBurn(state,id,{budget,balanceLamports}){
 const op=state.operations.find(o=>o.operationId===id);check(op,'ExecutionOperationUnknown');
 if(!state.execution||op.signedBurnHex||op.broadcastAttempted||executionRecord(state,id)?.burnCommitted)return;
 const r=executionRecord(state,id);
 if(!isLegacyExecution(state,id)){
  check(r&&!r.closed&&!r.refunds.some(x=>x.outcome==='UNRESOLVED')&&executionTotals(r).available>=amount(budget.executionLamports),'EXECUTION_FUNDING_REQUIRED');
 }
  requireExecutionSolvency(state,budget,balanceLamports,{candidateId:id,candidateCost:budget.executionLamports});
 if(r){r.burnCommitted=true;r.hold=null;}
}
export function requireExecutionBurnCommitted(state,id){
 if(isLegacyExecution(state,id))return;
 check(executionRecord(state,id)?.burnCommitted===true,'EXECUTION_BURN_NOT_RESERVED');
}
export function recordExecutionCost(state,id,cost){
  if(!state.execution)return;
  const r=executionRecord(state,id);
  const op=state.operations.find(o=>o.operationId===id);check(op?.solanaPacket?.some(x=>x.packet.signature===cost.signature),'ExecutionUnrelatedCost');
  amount(cost.lamports);amount(cost.networkFeeLamports);integer(cost.slot);check(amount(cost.lamports)>=amount(cost.networkFeeLamports),'ExecutionCostRejected');
  if(!r){
    check(isLegacyExecution(state,id),'ExecutionOperationUnknown');if(cost.slot<=state.execution.activatedSlot)return;
    const previous=state.execution.operatorCosts.find(c=>c.signature===cost.signature),value={operationId:id,...clone(cost)};
    if(previous){check(same(previous,value),'ExecutionCostChanged');return;}
    check(state.execution.operatorCosts.length<8192,'ExecutionCostCapacity');state.execution.operatorCosts.push(value);return;
  }
 const previous=state.execution.records.flatMap(x=>x.costs.map(c=>({id:x.operationId,c}))).find(x=>x.c.signature===cost.signature);
 if(previous){check(previous.id===id&&same(previous.c,cost),'ExecutionCostChanged');return;}
 check(r.costs.length<32,'ExecutionCostCapacity');r.costs.push(clone(cost));
}
export function beginExecutionRefund(state,id,{now,nativeClear,feeLamports}){
 const r=executionRecord(state,id),op=state.operations.find(o=>o.operationId===id);check(r,'ExecutionOperationUnknown');integer(now);
 if(r.refunds.some(x=>x.outcome==='UNRESOLVED'))return null;
 const completed=op?.state==='COMPLETED';
 const expired=r.fundedAt!==null&&now>=r.fundedAt+EXECUTION_EXPIRY_MS&&!r.burnCommitted&&!op?.signedBurnHex&&!op?.broadcastAttempted&&!op?.deposit&&!op?.exception&&!r.nativeObservations.length&&nativeClear;
 if(!completed&&!expired&&!r.closed)return null;
 check(!r.burnCommitted||completed,'ExecutionRefundBurnObligation');
 // Every potentially landed execution must be reconciled before releasing money.
 check((op?.solanaPacket??[]).every(x=>x.outcome==='EXPIRED_UNSEEN'||r.costs.some(c=>c.signature===x.packet.signature)),'EXECUTION_COST_RECONCILIATION_PENDING');
 const available=executionTotals(r).available,fee=amount(feeLamports);
 if(available<=fee)return null; // Retain explicit tiny refund liability; never treat it as profit.
 r.closed=true;r.hold=completed?'COMPLETED_REFUND_PENDING':'EXPIRED_REFUND_PENDING';
 return {sequence:r.refunds.length,amountLamports:String(available-fee),feeLamports,reason:completed?'COMPLETED':'EXPIRED'};
}
export function retainExecutionRefund(state,id,row){
 const r=executionRecord(state,id);check(r?.closed&&row.sequence===r.refunds.length&&r.refunds.length<16&&!r.refunds.some(x=>x.outcome==='UNRESOLVED'),'ExecutionRefundNotAuthorized');
 check(amount(row.amountLamports)>0n&&amount(row.amountLamports)+amount(row.feeLamports)<=executionTotals(r).available,'ExecutionRefundExceedsLiability');
 r.refunds.push({...clone(row),outcome:'UNRESOLVED',actualFeeLamports:null,sendAttempts:0});
}
export function markExecutionRefund(state,id,signature,{outcome,actualFeeLamports=null}){
 const r=executionRecord(state,id),row=r?.refunds.find(x=>x.signature===signature);check(row&&['FINALIZED','FINALIZED_FAILED','EXPIRED_UNSEEN'].includes(outcome),'ExecutionRefundOutcomeRejected');
  check(row.outcome==='UNRESOLVED'||row.outcome===outcome,'ExecutionRefundOutcomeChanged');
 if(row.outcome!=='UNRESOLVED'){check(row.actualFeeLamports===actualFeeLamports,'ExecutionRefundFeeChanged');return;}
 if(outcome!=='EXPIRED_UNSEEN')amount(actualFeeLamports);
 row.outcome=outcome;row.actualFeeLamports=actualFeeLamports;r.hold=outcome==='FINALIZED'?'REFUNDED':'REFUND_PENDING';
}
export function publicExecutionFunding(state,id){
 const r=executionRecord(state,id);
 if(!r)return {policy:isLegacyExecution(state,id)?'LEGACY_OPERATOR_FUNDED':'USER_FUNDED',status:'OPERATOR_FUNDED'};
 const t=executionTotals(r),q=r.quotes.at(-1),op=state.operations.find(o=>o.operationId===id);
 return {policy:'USER_FUNDED',status:r.hold??(r.payments.length?'PAID_VERIFIED':'AWAITING_EXECUTION_FUNDING'),burnCommitted:r.burnCommitted,
  fundedLamports:String(t.funded),actualCostLamports:String(t.cost+t.refundFees),refundedLamports:String(t.refunds),remainderLamports:String(t.liability),operatorContributionLamports:String(t.operatorContribution),
  expiresAt:r.fundedAt===null?null:r.fundedAt+EXECUTION_EXPIRY_MS,paymentSignatures:r.payments.map(p=>p.signature),refundSignatures:r.refunds.filter(x=>x.outcome==='FINALIZED').map(x=>x.signature),
  quote:q&&!r.closed&&!r.burnCommitted&&(!r.payments.length||['EXECUTION_TOP_UP_REQUIRED','EXECUTION_FUNDING_REQUIRED','AWAITING_EXECUTION_FUNDING'].includes(r.hold))?{...clone(q),unsignedTransactionBase64:executionUnsignedTransaction(executionPaymentMessage(q))}:null,
  depositAddressIssued:!!op};
}
export function validateExecutionState(state){
 const e=state.execution;if(!e)return;
  check(e.version===EXECUTION_VERSION&&Object.keys(e).sort().join()==='activatedAt,activatedSlot,legacyIds,operatorCapitalLamports,operatorCosts,operatorHold,records,scanSignature,version','ExecutionJournalShape');integer(e.activatedAt);integer(e.activatedSlot);amount(e.operatorCapitalLamports);
  check(e.operatorHold===null||e.operatorHold==='UNRECOGNIZED_PAYER_SPEND','ExecutionOperatorHoldRejected');
  check(Array.isArray(e.operatorCosts)&&e.operatorCosts.length<8192,'ExecutionCostCapacity');
  const legacyCosts=new Set();for(const c of e.operatorCosts){check(e.legacyIds.includes(c.operationId)&&state.operations.find(o=>o.operationId===c.operationId)?.solanaPacket?.some(x=>x.packet.signature===c.signature)&&!legacyCosts.has(c.signature)&&c.slot>e.activatedSlot,'ExecutionLegacyCostChanged');legacyCosts.add(c.signature);amount(c.lamports);amount(c.networkFeeLamports);integer(c.slot);}
 check(Array.isArray(e.legacyIds)&&new Set(e.legacyIds).size===e.legacyIds.length&&e.legacyIds.every(id=>state.operations.some(o=>o.operationId===id))&&Array.isArray(e.records)&&e.records.length<=128,'ExecutionMigrationBinding');
 const ids=new Set(),payments=new Set(),costs=new Set(),refunds=new Set();
 for(const r of e.records){
  check(Object.keys(r).sort().join()==='binding,burnCommitted,closed,costs,createdAt,createdHeight,fundedAt,hold,nativeObservations,operationId,payments,quotes,refunds','ExecutionRecordShape');
  integer(r.createdHeight);validateNativeObservations(r.nativeObservations);
  validateBurnBinding(r.binding);check(r.operationId===burnOperationId(r.binding)&&!ids.has(r.operationId)&&!e.legacyIds.includes(r.operationId)&&Object.entries(state.deployment).every(([k,v])=>r.binding[k]===v),'ExecutionRecordBinding');ids.add(r.operationId);integer(r.createdAt);if(r.fundedAt!==null)integer(r.fundedAt);
  check(typeof r.burnCommitted==='boolean'&&typeof r.closed==='boolean'&&(r.hold===null||/^[A-Z_]{1,64}$/u.test(r.hold)),'ExecutionRecordState');
  for(const [key,max] of [['quotes',16],['payments',32],['costs',32],['refunds',16]])check(Array.isArray(r[key])&&r[key].length<=max,'ExecutionRecordCapacity');
  for(const q of r.quotes){const {quoteId,...original}=q;check(executionDigest(original)===quoteId&&q.operationId===r.operationId&&executionPublicKey(q.destination).toString('hex')===r.binding.destination&&executionPublicKey(q.recipient).toString('hex')===state.deliveryPolicy.feePayerHex&&executionPublicKey(q.genesis).toString('hex')===r.binding.solanaGenesis&&same(q.budget,executionBudget(q.budget)),'ExecutionQuoteChanged');amount(q.amountLamports);integer(q.createdAt);integer(q.createdSlot);amount(q.lastValidBlockHeight);executionPublicKey(q.recentBlockhash);}
  for(const p of r.payments){const q=r.quotes.find(q=>q.quoteId===p.quoteId);check(Object.keys(p).sort().join()==='amountLamports,operationId,paymentFeeLamports,quoteId,signature,slot'&&q&&p.operationId===r.operationId&&p.amountLamports===q.amountLamports&&p.slot>=q.createdSlot&&!payments.has(p.signature)&&base58Decode(p.signature).length===64,'ExecutionPaymentReplay');payments.add(p.signature);integer(p.slot);amount(p.paymentFeeLamports);}
  check((r.fundedAt!==null)===(r.payments.length>0),'ExecutionFundingTimestampChanged');
  const op=state.operations.find(o=>o.operationId===r.operationId);
  for(const c of r.costs){check(Object.keys(c).sort().join()==='lamports,networkFeeLamports,signature,slot'&&op?.solanaPacket?.some(x=>x.packet.signature===c.signature)&&!costs.has(c.signature),'ExecutionCostBinding');costs.add(c.signature);check(amount(c.lamports)>=amount(c.networkFeeLamports),'ExecutionCostRejected');integer(c.slot);}
  for(const [index,f] of r.refunds.entries()){
   check(Object.keys(f).sort().join()==='actualFeeLamports,amountLamports,destination,feeLamports,lastValidBlockHeight,operationId,outcome,preparedTransactionBase64,recentBlockhash,sendAttempts,sequence,signature,source'&&r.closed&&(!r.burnCommitted||op?.state==='COMPLETED')&&f.operationId===r.operationId&&f.sequence===index&&!refunds.has(f.signature)&&['UNRESOLVED','FINALIZED','FINALIZED_FAILED','EXPIRED_UNSEEN'].includes(f.outcome),'ExecutionRefundReplay');
   check(executionPublicKey(f.source).toString('hex')===state.deliveryPolicy.feePayerHex&&executionPublicKey(f.destination).toString('hex')===r.binding.destination,'ExecutionRefundDestinationChanged');
   const msg=executionTransferMessage({source:f.source,destination:f.destination,lamports:f.amountLamports,blockhash:f.recentBlockhash,memo:executionRefundMemo(f.operationId,f.sequence)});
   check(verifyExecutionSignedMessage(f.preparedTransactionBase64,msg,f.source)===f.signature,'ExecutionRefundPacketChanged');
   refunds.add(f.signature);amount(f.amountLamports);amount(f.feeLamports);amount(f.lastValidBlockHeight);integer(f.sendAttempts);check(f.sendAttempts<=32,'ExecutionRefundRetryLimit');
   if(['FINALIZED','FINALIZED_FAILED'].includes(f.outcome))amount(f.actualFeeLamports);else check(f.actualFeeLamports===null,'ExecutionRefundFeeNotFinal');
  }
  check(r.refunds.filter(x=>x.outcome==='UNRESOLVED').length<=1,'ExecutionConcurrentRefund');
  if(op){check(same(op.binding,r.binding)&&r.payments.length>0,'ExecutionUnfundedAddress');if(op.signedBurnHex||op.broadcastAttempted)check(r.burnCommitted,'ExecutionUnfundedBurn');}
  if(r.burnCommitted)check(op?.plan,'ExecutionBurnReservationMissing');
 }
 check(state.operations.every(o=>e.legacyIds.includes(o.operationId)||ids.has(o.operationId)),'ExecutionMissingOperationPolicy');
}
