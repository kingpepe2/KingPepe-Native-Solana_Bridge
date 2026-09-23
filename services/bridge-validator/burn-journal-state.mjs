// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Pure forward burn journal transitions. This is durable bookkeeping, not proof.
import { burnOperationId, burnHash, burnUint, burnAmount, validateBurnBinding, validateNativeBurnTransaction, encodeFinalizedBurnEvidence, requireBurn as check } from '../../native/burn/burn-protocol.mjs';
import { burnDepositDestination, verifyNativeBurnSignatures } from '../../native/burn/burn-key.mjs';
import { MAX_KPEPE_SUPPLY_ATOMIC } from '../../shared/monetary-supply.mjs';
import { parseNativeTransactionHex } from '../../native/node/native-taproot-transaction.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
import {validateBurnContext,assertBurnMessageContext} from './burn-context.mjs';
import {verifyBurnAttestationPair} from '../attesters/burn-attestation-codec.mjs';
import {verifyBurnSolanaPacket} from '../relayer/burn-solana-signer.mjs';

export const BURN_JOURNAL_PROTOCOL = 'KINGPEPE_AUTOMATIC_BURN_JOURNAL_V1';
export const BURN_STATES = Object.freeze(['DEPOSIT_ADDRESS_ISSUED','DEPOSIT_OBSERVED','DEPOSIT_FINALIZED','BURN_READY','BURN_BROADCAST','BURN_FINALIZED','ATTESTED','CLAIMED','MINTED','COMPLETED']);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const integer = n => check(Number.isSafeInteger(n) && n >= 0,'BurnJournalIntegerRejected');
function sameBinding(a,b) { return burnOperationId(a) === burnOperationId(b); }
export function initialBurnJournal(binding,deliveryPolicy=null) {
  const {nonce:_nonce,destination:_destination,...deployment} = validateBurnBinding(binding);
  return {protocol:BURN_JOURNAL_PROTOCOL,deployment,deliveryPolicy,nativeScan:null,paused:true,pauseReason:'INITIAL_REVIEW_REQUIRED',operations:[]};
}
function deploymentMatches(state,binding) {
  check(Object.entries(state.deployment).every(([k,v]) => binding[k] === v),'BurnJournalDeploymentChanged');
}
export function burnJournalRecord(state,id) {
  const record = state.operations.find(op => op.operationId === burnHash(id));
  check(record,'BurnJournalOperationUnknown'); return record;
}
export function issueBurnDeposit(state,binding,createdHeight) {
  validateBurnBinding(binding); deploymentMatches(state,binding); integer(createdHeight);
  check(!state.paused,'BurnJournalPaused');
  const operationId = burnOperationId(binding), known = state.operations.find(op=>op.operationId===operationId);
  if (known) { check(sameBinding(known.binding,binding),'BurnJournalDestinationChanged'); return structuredClone(known); }
  const deposit = burnDepositDestination(binding);
  check(!state.operations.some(op=>op.depositAddress===deposit.address),'BurnJournalAddressReused');
  // Storage admission only; no monetary/per-transfer limit is imposed.
  check(state.operations.length < 512,'BurnJournalStorageCapacity');
  // A deposit address is not issued unless the existing bounded encrypted
  // store has capacity reserved for that operation's complete recovery record.
  check(Buffer.byteLength(JSON.stringify(state))+65000*(state.operations.filter(o=>!o.retired).length+1)<1_000_000,'BurnJournalStorageCapacity');
  const record = {operationId,binding:structuredClone(binding),depositAddress:deposit.address,depositScriptHex:deposit.scriptPubKeyHex,
    createdHeight,state:'DEPOSIT_ADDRESS_ISSUED',deposit:null,plan:null,signedBurnHex:null,broadcastAttempted:false,broadcastAccepted:false,
    burnEvidence:null,attestationDraftHex:null,attestation:null,priorAttestations:[],solanaPacket:null,mintReceipt:null,exception:null,retired:false};
  state.operations.push(record); return structuredClone(record);
}
export function recordBurnDeposits(state,id,observations) {
  const op=burnJournalRecord(state,id);
  check(Array.isArray(observations) && observations.length<=64,'BurnJournalObservationsRejected');
  const seen=new Set();
  for(const o of observations) {
    check(o && Object.keys(o).sort().join()==='amountAtomic,blockHash,confirmations,height,txid,vout','BurnJournalObservationFields');
    burnHash(o.txid); burnAmount(o.amountAtomic); integer(o.vout); check(o.vout<=0xffffffff); integer(o.confirmations); integer(o.height);
    if(o.blockHash!==null) burnHash(o.blockHash);
    check(o.confirmations===0 ? o.blockHash===null&&o.height===0 : o.blockHash!==null&&o.height>0,'BurnJournalObservationFinalityShape');
    check(!seen.has(`${o.txid}:${o.vout}`),'BurnJournalDuplicateObservation'); seen.add(`${o.txid}:${o.vout}`);
  }
  const matching=op.deposit ? observations.find(o=>o.txid===op.deposit.txid&&o.vout===op.deposit.vout) : undefined;
  const other=observations.filter(o=>!op.deposit||o.txid!==op.deposit.txid||o.vout!==op.deposit.vout);
  if(op.retired) {
    if(other.length) op.exception={reason:'LATE_DEPOSIT_TO_RETIRED_ADDRESS',deposits:structuredClone(other)};
    return;
  }
  if(observations.length>1) {
    op.exception={reason:op.broadcastAttempted?'STRAY_DEPOSIT_AFTER_BURN':'MULTIPLE_DEPOSITS_REQUIRE_REVIEW',deposits:structuredClone(observations)};
    if(!op.broadcastAttempted)return;
  }
  if(op.plan!==null) {
    if(!matching || matching.amountAtomic!==op.deposit.amountAtomic || matching.blockHash!==op.deposit.blockHash || matching.confirmations<12) {
      state.paused=true; state.pauseReason='ACCEPTED_DEPOSIT_BASIS_CHANGED';
      op.exception={reason:state.pauseReason,deposits:structuredClone(observations)};
    }else op.deposit.confirmations=matching.confirmations;
    return;
  }
  if(op.exception) return; // No automatic economic repair of an ambiguity.
  const next=observations[0];
  if(!next) { op.deposit=null; op.state='DEPOSIT_ADDRESS_ISSUED'; return; }
  for(const otherOp of state.operations) if(otherOp.operationId!==id && otherOp.deposit?.txid===next.txid && otherOp.deposit?.vout===next.vout)
    throw new Error('BurnJournalDepositAlreadyConsumed');
  op.deposit=structuredClone(next); op.state=next.confirmations>=12?'DEPOSIT_FINALIZED':'DEPOSIT_OBSERVED';
}
export function retainBurnPlan(state,id,plan) {
  const op=burnJournalRecord(state,id);
  check(!state.paused&&!op.exception&&!op.retired,'BurnJournalAdmissionStopped');
  check(op.deposit && op.deposit.confirmations>=12,'BurnJournalDepositNotFinal');
  if(op.plan) { check(same(op.plan,plan),'BurnJournalPlanChanged'); return; }
  check(plan.operationId===id && plan.inputs[0].txid===op.deposit.txid && plan.inputs[0].vout===op.deposit.vout &&
    plan.inputs[0].amountAtomic===op.deposit.amountAtomic && plan.inputs[0].scriptPubKeyHex===op.depositScriptHex,'BurnJournalDepositBindingChanged');
  validateNativeBurnTransaction({rawTransactionHex:plan.unsignedTransactionHex,operationId:id,inputs:plan.inputs,
    operationalScriptHex:plan.operationalScriptHex,expectedFeeAtomic:plan.feeAtomic,maximumFeeAtomic:plan.maximumFeeAtomic});
  const incoming=new Set(plan.inputs.map(i=>`${i.txid}:${i.vout}`));
  for(const prior of state.operations) if(prior.plan) check(!prior.plan.inputs.some(i=>incoming.has(`${i.txid}:${i.vout}`)),'BurnJournalInputAlreadyReserved');
  const committed=state.operations.filter(o=>o.plan).reduce((n,o)=>n+BigInt(o.deposit.amountAtomic),0n);
  check(committed+burnAmount(op.deposit.amountAtomic)<=MAX_KPEPE_SUPPLY_ATOMIC,'BurnJournalMonetaryCapExceeded');
  op.plan=structuredClone(plan);op.state='BURN_READY';
}
export function retainSignedBurn(state,id,signed) {
  const op=burnJournalRecord(state,id);
  check(!state.paused&&!op.exception&&op.plan,'BurnJournalAdmissionStopped');
  if(op.signedBurnHex!==null) { check(op.signedBurnHex===signed,'BurnJournalSecondBurnRejected');return; }
  check(parseNativeTransactionHex(signed).strippedHex===op.plan.unsignedTransactionHex,'BurnJournalSignedBurnChanged');
  verifyNativeBurnSignatures({rawTransactionHex:signed,inputs:op.plan.inputs});
  op.signedBurnHex=signed;
}
export function markBurnBroadcast(state,id,accepted=false) {
  check(typeof accepted==='boolean','BurnJournalBroadcastFlagRejected');
  const op=burnJournalRecord(state,id); check(op.signedBurnHex!==null,'BurnJournalPersistSignedBurnFirst');
  if(!op.broadcastAttempted) check(!state.paused&&!op.exception,'BurnJournalAdmissionStopped');
  op.broadcastAttempted=true;op.broadcastAccepted ||= accepted;
  if(!op.burnEvidence) op.state='BURN_BROADCAST';
}
export function retainFinalBurn(state,id,evidence) {
  const op=burnJournalRecord(state,id);check(op.broadcastAttempted&&op.plan,'BurnJournalBurnNotBroadcast');
  encodeFinalizedBurnEvidence(evidence);
  check(sameBinding(evidence.binding,op.binding)&&evidence.operationId===id&&evidence.burn.txid===op.plan.txid&&
    evidence.deposit.txid===op.deposit.txid&&evidence.deposit.vout===op.deposit.vout&&evidence.amountAtomic===op.deposit.amountAtomic&&
    evidence.depositBlockHash===op.deposit.blockHash&&evidence.depositHeight===op.deposit.height,'BurnJournalEvidenceChanged');
  if(op.burnEvidence) { check(same(op.burnEvidence,evidence),'BurnJournalEvidenceChanged');return; }
  for(const prior of state.operations) if(prior.burnEvidence) check(prior.burnEvidence.burn.txid!==evidence.burn.txid,'BurnJournalBurnEvidenceReused');
  op.burnEvidence=structuredClone(evidence);op.state='BURN_FINALIZED';
}
export function prepareBurnAuthorization(state,id,encodedMessageHex) {
  const op=burnJournalRecord(state,id);check(op.burnEvidence&&state.deliveryPolicy,'BurnJournalAttestationNotAuthorized');
  check(typeof encodedMessageHex==='string'&&/^[0-9a-f]+$/u.test(encodedMessageHex),'BurnJournalAttestationEncoding');
  const message=decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex,'hex'));
  assertBurnMessageContext(message,state.deliveryPolicy.context);
  check(encodeFinalizedBurnEvidence(message.burnEvidence).equals(encodeFinalizedBurnEvidence(op.burnEvidence)),'BurnJournalAttestationEvidenceChanged');
  if(op.attestationDraftHex===encodedMessageHex)return;
  if(op.attestationDraftHex!==null){
    const prior=decodeCanonicalBridgeMessage(Buffer.from(op.attestationDraftHex,'hex'));
    check(!op.mintReceipt&&message.validFrom>prior.validUntil&&op.priorAttestations.length<7&&
      (op.solanaPacket??[]).filter(r=>r.packet.kind==='CLAIM').every(r=>['EXPIRED_UNSEEN','FINALIZED_FAILED'].includes(r.outcome)),
    'BurnJournalPriorAuthorizationUnresolved');
    if(op.attestation)op.priorAttestations.push(op.attestation);
  }
  op.attestationDraftHex=encodedMessageHex;op.attestation=null;op.state='BURN_FINALIZED';
}
export function retainBurnAttestation(state,id,attestation) {
  const op=burnJournalRecord(state,id);check(op.burnEvidence&&state.deliveryPolicy,'BurnJournalAttestationNotAuthorized');
  check(attestation&&Object.keys(attestation).sort().join()==='attestations,encodedMessageHex','BurnJournalAttestationFields');
  check(op.attestationDraftHex===attestation.encodedMessageHex,'BurnJournalPersistAuthorizationFirst');
  verifyBurnAttestationPair(attestation.attestations,attestation.encodedMessageHex,state.deliveryPolicy.context.attesters);
  if(op.attestation){check(same(op.attestation,attestation),'BurnJournalAttestationChanged');return;}
  op.attestation=structuredClone(attestation);op.state='ATTESTED';
}
export function burnPacketAttestation(op,packet) {
  if(packet.kind==='ATA')return null;
  const found=[...op.priorAttestations,op.attestation].filter(Boolean).find(a=>
    decodeCanonicalBridgeMessage(Buffer.from(a.encodedMessageHex,'hex')).messageDigestHex===packet.messageDigestHex);
  check(found,'BurnJournalPacketAuthorizationMissing');return found;
}
export function retainBurnSolanaPacket(state,id,packet) {
  const op=burnJournalRecord(state,id);check(!state.paused&&state.deliveryPolicy,'BurnJournalAdmissionStopped');
  check(packet.kind==='ATA' ? op.plan&&!op.broadcastAttempted : op.burnEvidence&&op.attestation,'BurnJournalPacketNotAuthorized');
  verifyBurnSolanaPacket(packet,state.deliveryPolicy.context,op.binding,state.deliveryPolicy.feePayerHex,op.attestation);
  op.solanaPacket??=[];
  const known=op.solanaPacket.find(p=>p.packet.signature===packet.signature);
  if(known){check(same(known.packet,packet),'BurnJournalPacketChanged');return;}
  const history=op.solanaPacket.filter(p=>p.packet.kind===packet.kind),last=history.at(-1);
  const newReceipt=last&&packet.kind==='RECEIPT'&&last.packet.messageDigestHex!==packet.messageDigestHex&&last.outcome==='FINALIZED';
  check(history.length<8&&(!last||newReceipt||['EXPIRED_UNSEEN','FINALIZED_FAILED'].includes(last.outcome)),'BurnJournalAmbiguousSolanaPacket');
  if(last)check(BigInt(packet.lastValidBlockHeight)>BigInt(last.packet.lastValidBlockHeight)&&packet.recentBlockhash!==last.packet.recentBlockhash,'BurnJournalPacketExpiryNotAdvanced');
  op.solanaPacket.push({packet:structuredClone(packet),outcome:'UNRESOLVED',sendAttempts:0,observedSlot:'0'});
}
export function markBurnSolanaPacket(state,id,signature,{outcome,sendAttempts,observedSlot}) {
  const op=burnJournalRecord(state,id),row=op.solanaPacket?.find(p=>p.packet.signature===signature);
  check(row&&['UNRESOLVED','FINALIZED','FINALIZED_FAILED','EXPIRED_UNSEEN'].includes(outcome),'BurnJournalPacketOutcomeRejected');
  check(row.outcome==='UNRESOLVED'||row.outcome===outcome,'BurnJournalPacketOutcomeChanged');
  integer(sendAttempts);check(sendAttempts>=row.sendAttempts&&sendAttempts<=32,'BurnJournalPacketAttemptsRejected');
  check(burnUint(observedSlot)>=burnUint(row.observedSlot),'BurnJournalPacketSlotRegressed');
  row.outcome=outcome;row.sendAttempts=sendAttempts;row.observedSlot=observedSlot;
}
export function retainBurnMint(state,id,receipt) {
  const op=burnJournalRecord(state,id); check(op.burnEvidence!==null,'BurnJournalNoFinalizedBurnNoMint');
  check(receipt&&Object.keys(receipt).sort().join()==='amountAtomic,commitment,destination,mint,operationId,signature,slot','BurnJournalMintFieldsRejected');
  check(receipt && receipt.operationId===id && receipt.amountAtomic===op.deposit.amountAtomic && receipt.destination===op.binding.destination && receipt.mint===op.binding.mint,
    'BurnJournalMintBindingChanged');
  check(typeof receipt.signature==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(receipt.signature)&&receipt.commitment==='finalized','BurnJournalMintNotFinal');
  burnUint(receipt.slot);
  if(op.mintReceipt) {check(same(op.mintReceipt,receipt),'BurnJournalSecondMintRejected');return;}
  op.mintReceipt=structuredClone(receipt);op.state='MINTED';
}
export function completeBurnOperation(state,id) {
  const op=burnJournalRecord(state,id);check(op.mintReceipt&&op.burnEvidence,'BurnJournalCompletionEvidenceMissing');
  op.state='COMPLETED';op.retired=true;
}
export function burnJournalAccounting(state) {
  let finalized=0n,minted=0n,completed=0n,committed=0n;
  for(const op of state.operations) {
    if(op.plan) committed+=burnAmount(op.deposit.amountAtomic);
    if(op.burnEvidence) finalized+=burnAmount(op.burnEvidence.amountAtomic);
    if(op.mintReceipt) minted+=burnAmount(op.mintReceipt.amountAtomic);
    if(op.state==='COMPLETED') completed+=burnAmount(op.mintReceipt.amountAtomic);
  }
  check(minted<=finalized&&finalized<=committed&&committed<=MAX_KPEPE_SUPPLY_ATOMIC,'BurnJournalConservationFailure');
  return Object.freeze({finalizedNativeBurnAtomic:finalized.toString(),pendingFinalizedBurnAtomic:(finalized-minted).toString(),
    mintedAtomic:minted.toString(),completedAtomic:completed.toString(),committedBurnAtomic:committed.toString()});
}
export function reconcileBurnAccounting(state,{finalizedNativeBurnAtomic,bridgeIssuedAtomic,mintSupplyAtomic}) {
  const journal=burnJournalAccounting(state), actualBurn=burnUint(finalizedNativeBurnAtomic),issued=burnUint(bridgeIssuedAtomic),live=burnUint(mintSupplyAtomic);
  const mismatch=issued>MAX_KPEPE_SUPPLY_ATOMIC||issued>actualBurn||live>issued||
    actualBurn!==BigInt(journal.finalizedNativeBurnAtomic)||issued!==BigInt(journal.mintedAtomic);
  if(mismatch) {state.paused=true;state.pauseReason='BURN_MINT_RECONCILIATION_MISMATCH';throw new Error(state.pauseReason);}
  return Object.freeze({state:'MATCH',...journal,bridgeIssuedAtomic:issued.toString(),mintSupplyAtomic:live.toString(),directSolanaBurnAtomic:(issued-live).toString()});
}

export function validateBurnJournalState(input) {
  check(input&&Object.keys(input).sort().join()==='deliveryPolicy,deployment,nativeScan,operations,pauseReason,paused,protocol','BurnJournalFieldsRejected');
  check(input.protocol===BURN_JOURNAL_PROTOCOL&&typeof input.paused==='boolean'&&typeof input.pauseReason==='string'&&
    /^[A-Z0-9_]{1,96}$/u.test(input.pauseReason),'BurnJournalVersionRejected');
  check(Array.isArray(input.operations)&&input.operations.length<=512,'BurnJournalStorageCapacity');
  const reconstructed={protocol:BURN_JOURNAL_PROTOCOL,deployment:structuredClone(input.deployment),deliveryPolicy:structuredClone(input.deliveryPolicy),nativeScan:structuredClone(input.nativeScan),paused:false,pauseReason:'VALIDATING',operations:[]};
  const sample={...input.deployment,destination:'01'.repeat(32),nonce:'02'.repeat(32)};
  validateBurnBinding(sample);
  if(input.deliveryPolicy!==null){
    check(input.deliveryPolicy&&Object.keys(input.deliveryPolicy).sort().join()==='context,feePayerHex','BurnJournalDeliveryPolicyRejected');
    const context=validateBurnContext(input.deliveryPolicy.context);burnHash(input.deliveryPolicy.feePayerHex);
    check(Object.entries(input.deployment).every(([k,v])=>context.deployment[k]===v),'BurnJournalDeliveryDeploymentChanged');
  }
  if(input.nativeScan!==null){
    const scan=input.nativeScan;check(scan&&Object.keys(scan).sort().join()==='hash,height,recent','BurnJournalCursorRejected');
    integer(scan.height);burnHash(scan.hash);check(Array.isArray(scan.recent)&&scan.recent.length>0&&scan.recent.length<=13,'BurnJournalCursorRejected');
    scan.recent.forEach((v,i)=>{check(Object.keys(v).sort().join()==='hash,height'&&v.height===scan.height-scan.recent.length+1+i,'BurnJournalCursorRejected');burnHash(v.hash);});
    check(scan.recent.at(-1).hash===scan.hash,'BurnJournalCursorRejected');
  }
  for(const op of input.operations) {
    check(op&&Object.keys(op).sort().join()==='attestation,attestationDraftHex,binding,broadcastAccepted,broadcastAttempted,burnEvidence,createdHeight,deposit,depositAddress,depositScriptHex,exception,mintReceipt,operationId,plan,priorAttestations,retired,signedBurnHex,solanaPacket,state','BurnJournalRecordFieldsRejected');
    const issued=issueBurnDeposit(reconstructed,op.binding,op.createdHeight);
    check(issued.operationId===op.operationId&&issued.depositAddress===op.depositAddress&&issued.depositScriptHex===op.depositScriptHex,'BurnJournalDestinationChanged');
    if(op.deposit) recordBurnDeposits(reconstructed,op.operationId,[op.deposit]);
    if(op.plan) retainBurnPlan(reconstructed,op.operationId,op.plan);
    if(op.signedBurnHex) retainSignedBurn(reconstructed,op.operationId,op.signedBurnHex);
    check(typeof op.broadcastAttempted==='boolean'&&typeof op.broadcastAccepted==='boolean'&&(!op.broadcastAccepted||op.broadcastAttempted),'BurnJournalBroadcastFlagRejected');
    if(op.broadcastAttempted) markBurnBroadcast(reconstructed,op.operationId,op.broadcastAccepted);
    if(op.burnEvidence) retainFinalBurn(reconstructed,op.operationId,op.burnEvidence);
    check(Array.isArray(op.priorAttestations)&&op.priorAttestations.length<=7,'BurnJournalAuthorizationCapacity');
    check(op.solanaPacket===null||Array.isArray(op.solanaPacket)&&op.solanaPacket.length<=24,'BurnJournalPacketCapacity');
    const pendingPackets=[...(op.solanaPacket??[])];
    const replayPackets=digest=>{
      const builtRecord=burnJournalRecord(reconstructed,op.operationId);
      // ATA setup predates burn. Recheck the cryptographic packet without
      // pretending a reload creates a new authorization to prepare it.
      for(const row of pendingPackets.filter(row=>row.packet.messageDigestHex===digest)){
        check(row&&Object.keys(row).sort().join()==='observedSlot,outcome,packet,sendAttempts','BurnJournalPacketRowFields');
        const broadcast=builtRecord.broadcastAttempted;
        if(row.packet.kind==='ATA')builtRecord.broadcastAttempted=false;
        retainBurnSolanaPacket(reconstructed,op.operationId,row.packet);
        builtRecord.broadcastAttempted=broadcast;
        markBurnSolanaPacket(reconstructed,op.operationId,row.packet.signature,row);
        pendingPackets.splice(pendingPackets.indexOf(row),1);
      }
    };
    replayPackets(null);
    for(const authorization of [...op.priorAttestations,...(op.attestation?[op.attestation]:[])]){
      prepareBurnAuthorization(reconstructed,op.operationId,authorization.encodedMessageHex);
      retainBurnAttestation(reconstructed,op.operationId,authorization);
      replayPackets(decodeCanonicalBridgeMessage(Buffer.from(authorization.encodedMessageHex,'hex')).messageDigestHex);
    }
    if(op.attestationDraftHex!==null)prepareBurnAuthorization(reconstructed,op.operationId,op.attestationDraftHex);
    check(pendingPackets.length===0,'BurnJournalPacketAuthorizationMissing');
    if(op.mintReceipt) retainBurnMint(reconstructed,op.operationId,op.mintReceipt);
    if(op.retired) completeBurnOperation(reconstructed,op.operationId);
    const built=burnJournalRecord(reconstructed,op.operationId);
    check(built.state===op.state&&built.retired===op.retired,'BurnJournalTransitionRejected');
    if(op.exception!==null) {
      check(op.exception&&Object.keys(op.exception).sort().join()==='deposits,reason'&&
        ['LATE_DEPOSIT_TO_RETIRED_ADDRESS','STRAY_DEPOSIT_AFTER_BURN','MULTIPLE_DEPOSITS_REQUIRE_REVIEW','ACCEPTED_DEPOSIT_BASIS_CHANGED'].includes(op.exception.reason)&&
        Array.isArray(op.exception.deposits)&&op.exception.deposits.length<=64,'BurnJournalExceptionRejected');
      built.exception=structuredClone(op.exception);
    }
  }
  reconstructed.paused=input.paused;reconstructed.pauseReason=input.pauseReason;
  burnJournalAccounting(reconstructed);
  return structuredClone(reconstructed);
}
