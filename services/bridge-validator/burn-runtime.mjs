// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Automatic TEST burn -> mint. All economic adapters are concrete, protected
// instances; public callers cannot replace a verifier, signer or RPC endpoint.
import {ed25519} from '@noble/curves/ed25519.js';
import {RegtestBurnObserver} from '../../native/burn/burn-observer.mjs';
import {RegtestNativeBurnVerifier} from '../../native/burn/burn-evidence.mjs';
import {NativeBurnFeePolicy} from '../../native/burn/burn-fees.mjs';
import {burnOperationalDestination} from '../../native/burn/burn-key.mjs';
import {burnOperationId,burnHash,encodeFinalizedBurnEvidence,requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {requireProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {requireProtectedBurnAttester} from '../attesters/protected-burn-attester.mjs';
import {requireProtectedBurnSolanaSigner} from '../relayer/burn-solana-signer.mjs';
import {requireBurnSolanaAdapter} from '../solana-observer/burn-solana-adapter.mjs';
import {requireProtectedBurnJournal} from './protected-burn-journal.mjs';
import {validateBurnContext} from './burn-context.mjs';
import {encodeBurnMessage} from '../../shared/protocol/burn-message.mjs';
import {decodeCanonicalBridgeMessage,stableJson} from '../../shared/protocol/canonical-message.mjs';
import {burnJournalRecord,issueBurnDeposit,recordBurnDeposits,retainBurnPlan,retainSignedBurn,markBurnBroadcast,
  retainFinalBurn,prepareBurnAuthorization,retainBurnAttestation,retainBurnSolanaPacket,markBurnSolanaPacket,burnPacketAttestation,
  retainBurnMint,completeBurnOperation,burnJournalAccounting,reconcileBurnAccounting} from './burn-journal-state.mjs';

const PENDING=new Set(['BURN_SOLANA_RPC_UNAVAILABLE','BURN_SOLANA_OPERATIONAL_FUNDING_REQUIRED','BURN_OPERATIONAL_FEE_FUNDING_REQUIRED',
  'BURN_SOLANA_EXECUTION_PENDING','BURN_SOLANA_CLOCK_UNAVAILABLE','BURN_SOLANA_FEE_QUOTE_UNAVAILABLE',
  'BURN_FEE_POLICY_EXCEPTION','NativeFeeOperatorReviewRequired','NativeFeeEstimateUnavailable','NativeFeeObservationRejected',
  'NativeBurnInputUnavailable','NativeBurnSourceChanged','NativeEvidenceTipChanged','BURN_NATIVE_DISCOVERY_CHANGED',
  'BURN_MEMPOOL_CHANGED_RETRY','BURN_FEE_DISCOVERY_UNAVAILABLE','BURN_INPUT_SPENT_OR_AMBIGUOUS',
  'BURN_NATIVE_SYNCHRONIZING','RAW_NATIVE_SOURCE_SYNCHRONIZING','RAW_NATIVE_SOURCE_CHANGED']);
export function burnRuntimeErrorCode(error) {
  const text=typeof error?.message==='string'?error.message:'';
  if(/^NativeRpcRejected:[a-z0-9]+:-?[0-9]+$/u.test(text))return 'NATIVE_RPC_UNAVAILABLE';
  if(/^NativeRpc(?:Unavailable|Timeout|Connection|Request|Transport|Response)/u.test(text))return 'NATIVE_RPC_UNAVAILABLE';
  return /^[A-Za-z][A-Za-z0-9_]{0,95}$/u.test(text)?text:'BURN_VALIDATION_FAILED';
}
const message=hex=>decodeCanonicalBridgeMessage(Buffer.from(hex,'hex'));
const sameEvidence=(a,b)=>encodeFinalizedBurnEvidence(a).equals(encodeFinalizedBurnEvidence(b));
export class BurnRuntime {
  #journal;#observer;#verifier;#fees;#burnSigner;#attesters;#solana;#solanaSigner;#context;#tail=Promise.resolve();#event;
  #health={state:'STARTING',reconciliation:null,reason:'INITIAL_VERIFICATION_REQUIRED'};
  #observed=new Map();
  #accountingVerifiedAt=0;#liveMintSupplyAtomic=null;
  constructor({journal,observer,verifier,fees,burnSigner,attesters,solana,solanaSigner,onEvent=()=>{}}) {
    requireProtectedBurnJournal(journal);requireProtectedNativeBurnSigner(burnSigner);requireBurnSolanaAdapter(solana);requireProtectedBurnSolanaSigner(solanaSigner);
    check(observer instanceof RegtestBurnObserver&&verifier instanceof RegtestNativeBurnVerifier&&fees instanceof NativeBurnFeePolicy,'ConcreteBurnAdaptersRequired');
    check(Array.isArray(attesters)&&attesters.length===2,'BurnRuntimeAttestersRequired');attesters.forEach(requireProtectedBurnAttester);
    this.#context=validateBurnContext(solana.policy.context);
    check(burnSigner.publicKeyHex===this.#context.deployment.burnPublicKey&&solanaSigner.publicKeyHex===solana.policy.feePayerHex&&
      attesters.every((a,i)=>a.role===['ATTESTER_A','ATTESTER_B'][i]&&a.publicKeyHex===this.#context.attesters[i]),'BurnRuntimeRoleBinding');
    const state=journal.read();check(state.deliveryPolicy&&stableJson(state.deliveryPolicy.context)===stableJson(this.#context)&&
      state.deliveryPolicy.feePayerHex===solana.policy.feePayerHex,'BurnRuntimeJournalBinding');
    this.#journal=journal;this.#observer=observer;this.#verifier=verifier;this.#fees=fees;this.#burnSigner=burnSigner;
    this.#attesters=attesters;this.#solana=solana;this.#solanaSigner=solanaSigner;this.#event=onEvent;
  }
  #exclusive(task){const next=this.#tail.then(task,task);this.#tail=next.catch(()=>{});return next;}
  #emit(event,id,extra={}){this.#event(Object.freeze({event,operationId:id,at:new Date().toISOString(),...extra}));}
  #op(id){return burnJournalRecord(this.#journal.read(),id);}
  #update(fn){return this.#journal.update(fn);}
  publicContext(){return structuredClone(this.#context);}
  #stopOn(error,id=null){
    const code=burnRuntimeErrorCode(error),pending=PENDING.has(code)||code==='NATIVE_RPC_UNAVAILABLE';
    // Persist the sanitized exact reason: a restart must not erase why the
    // service stopped irreversible processing. Never persist an RPC body.
    if(!pending)this.#journal.pause(code.toUpperCase());
    this.#health={state:pending?'PENDING':'PAUSED',reconciliation:null,reason:code};
    this.#emit('PROCESSING_HELD',id,{reason:code,...(Number.isSafeInteger(error?.rpcCode)?{rpcCode:error.rpcCode}:{}),
      ...(/^[a-zA-Z]{1,40}$/u.test(error?.rpcMethod??'')?{rpcMethod:error.rpcMethod}:{}),
      ...(/^[0-9]{1,2}:[A-Za-z]{1,64}(?::[0-9]{1,10})?$/u.test(error?.instructionFailure??'')?{instructionFailure:error.instructionFailure}:{})});
    return {state:this.#health.state,reason:code};
  }
  async #discover(){
    const scan=await this.#observer.discover(this.#journal.read());
    this.#update(state=>{for(const row of scan.observations)recordBurnDeposits(state,row.id,row.observations);state.nativeScan=scan.cursor;});
    for(const row of scan.observations)this.#observed.set(row.id,{...(this.#observed.get(row.id)??{}),deposits:row.observations});
    return scan;
  }
  createOperation({destinationHex,nonce}) {
    return this.#exclusive(async()=>{
      burnHash(destinationHex);burnHash(nonce);
      // Connected Wallet Standard account is the recipient. An off-curve PDA
      // or an internal authority is not accepted as an interactive wallet.
      ed25519.Point.fromBytes(Buffer.from(destinationHex,'hex'));
      check(![this.#context.deployment.burnPublicKey,...this.#context.attesters,this.#solanaSigner.publicKeyHex,
        this.#context.deployment.bridgeProgram,this.#context.deployment.transceiverProgram,this.#context.deployment.mint].includes(destinationHex),'BurnDestinationRoleOverlap');
      const binding={...this.#context.deployment,destination:destinationHex,nonce},id=burnOperationId(binding),state=this.#journal.read();
      const known=state.operations.find(op=>op.operationId===id);if(known)return this.operation(id);
      check(this.#health.state==='HEALTHY'&&!state.paused&&Date.now()>=this.#accountingVerifiedAt&&
        Date.now()-this.#accountingVerifiedAt<=30000,'BurnGatewayNotReady');
      const native=await this.#observer.network();await this.#solana.deployment();this.#solanaSigner.ready();this.#attesters.forEach(a=>a.ready());
      this.#update(s=>issueBurnDeposit(s,binding,native.height));this.#emit('DEPOSIT_ADDRESS_ISSUED',id);return this.operation(id);
    });
  }
  operation(id) {
    const op=this.#op(burnHash(id)),live=this.#observed.get(id);
    return {operationId:id,state:op.state,destinationHex:op.binding.destination,depositAddress:op.depositAddress,
      amountAtomic:op.deposit?.amountAtomic??null,depositTxid:op.deposit?.txid??null,depositConfirmations:op.deposit?.confirmations??0,
      requiredDepositConfirmations:12,burnTxid:op.broadcastAttempted?op.plan.txid:null,burnAmountAtomic:op.burnEvidence?.amountAtomic??null,
      burnConfirmations:live?.burnConfirmations??null,requiredBurnConfirmations:12,solanaSignature:op.mintReceipt?.signature??null,
      mintHex:op.binding.mint,exception:op.exception?.reason??null,retired:op.retired};
  }
  status() {
    const state=this.#journal.read(),fresh=Date.now()>=this.#accountingVerifiedAt&&Date.now()-this.#accountingVerifiedAt<=30000;
    return {architecture:'ONE_WAY_AUTOMATIC_BURN_AND_MINT',environment:this.#context.environment,
      nativeNetwork:'REGTEST',solanaNetwork:this.#context.environment.toUpperCase(),mintHex:this.#context.deployment.mint,
      paused:state.paused,...structuredClone(this.#health),productionReady:false,mainnetActivation:'DISABLED',
      accounting:this.#health.reconciliation==='MATCH'&&fresh?{...burnJournalAccounting(state),observedAt:this.#accountingVerifiedAt,liveMintSupplyAtomic:this.#liveMintSupplyAtomic}:null};
  }
  // Operator-only local method. No public gateway route exposes resume/pause.
  resumeReviewedTestRuntime() {
    return this.#exclusive(async()=>{
      check(this.#health.reconciliation==='MATCH','BurnRuntimeReviewIncomplete');
      this.#update(state=>{check(!state.operations.some(op=>op.exception?.reason==='ACCEPTED_DEPOSIT_BASIS_CHANGED'),'BurnRuntimeContradictionUnresolved');
        state.paused=false;state.pauseReason='REVIEWED_TEST_RUNTIME';});
      this.#health={state:'HEALTHY',reconciliation:'MATCH',reason:null};
    });
  }
  pause(){return this.#exclusive(()=>{this.#journal.pause('OPERATOR_PAUSE');this.#health={state:'PAUSED',reconciliation:this.#health.reconciliation,reason:'OPERATOR_PAUSE'};});}
  cycle(){return this.#exclusive(async()=>{
    try{
      const scan=await this.#discover();
      if(!scan.caughtUp){this.#health={state:'PENDING',reconciliation:null,reason:'NATIVE_DISCOVERY_CATCHING_UP'};return this.status();}
      // Read/recover already-submitted transactions before comparing issuance.
      // A lost success response must not become an unexplained-supply alert.
      let finalized=0n;
      for(const op of this.#journal.read().operations){
        if(!op.broadcastAttempted)continue;
        const burn=await this.#observer.burnStatus(op.plan);this.#observed.set(op.operationId,{...(this.#observed.get(op.operationId)??{}),burnConfirmations:burn.confirmations});
        if(op.burnEvidence)check(burn.found&&burn.confirmations>=12,'FINALIZED_BURN_DISAPPEARED');
        if(!burn.found||burn.confirmations<12)continue;
        const proof=await this.#verifier.verifyFinalizedBurn({binding:op.binding,plan:op.plan});
        if(op.burnEvidence)check(sameEvidence(op.burnEvidence,proof.evidence),'FINALIZED_BURN_CHANGED');
        else {this.#update(state=>retainFinalBurn(state,op.operationId,proof.evidence));this.#emit('BURN_FINALIZED',op.operationId);}
        finalized+=BigInt(proof.evidence.amountAtomic);
        if(!await this.#recoverMint(this.#op(op.operationId))){this.#health={state:'PENDING',reconciliation:null,reason:'SOLANA_EXECUTION_RECOVERY_PENDING'};return this.status();}
      }
      let deployed=await this.#solana.deployment();
      if(burnJournalAccounting(this.#journal.read()).mintedAtomic!==deployed.managerMintedAtomic){
        // Finalization can advance between the claim read above and this
        // issuance snapshot. The snapshot advances the adapter's minimum slot;
        // recover journaled claims again at or after that slot before comparing.
        const priorIssued=BigInt(deployed.managerMintedAtomic);
        for(const op of this.#journal.read().operations){
          if(op.burnEvidence&&!await this.#recoverMint(op)){
            this.#health={state:'PENDING',reconciliation:null,reason:'SOLANA_EXECUTION_RECOVERY_PENDING'};return this.status();
          }
        }
        deployed=await this.#solana.deployment();
        const issued=BigInt(deployed.managerMintedAtomic),minted=BigInt(burnJournalAccounting(this.#journal.read()).mintedAtomic);
        // A further increase while recovering may require another cycle. This
        // is unavailable accounting, never healthy or permission to burn/mint.
        // Stable unexplained issuance, decreases and excess burn backing still
        // reach the critical reconciliation check below.
        if(issued>priorIssued&&issued>minted&&issued<=finalized){
          this.#health={state:'PENDING',reconciliation:null,reason:'SOLANA_FINALIZED_SNAPSHOT_ADVANCED'};return this.status();
        }
      }
      reconcileBurnAccounting(this.#journal.read(),{finalizedNativeBurnAtomic:finalized.toString(),bridgeIssuedAtomic:deployed.managerMintedAtomic,mintSupplyAtomic:deployed.mintSupplyAtomic});
      for(const op of this.#journal.read().operations)if(op.state==='MINTED'){
        this.#update(state=>completeBurnOperation(state,op.operationId));this.#emit('COMPLETED',op.operationId);
      }
      this.#accountingVerifiedAt=Date.now();this.#liveMintSupplyAtomic=deployed.mintSupplyAtomic;
      const paused=this.#journal.read().paused;
      this.#health={state:paused?'PAUSED':'HEALTHY',reconciliation:'MATCH',reason:paused?this.#journal.read().pauseReason:null};
      if(paused)return this.status();
      for(const op of this.#journal.read().operations){
        if(op.retired||op.exception&&!op.broadcastAttempted)continue;
        try{await this.#advance(op.operationId);}
        catch(error){this.#stopOn(error,op.operationId);break;}
        if(this.#journal.read().paused)break;
      }
      return this.status();
    }catch(error){this.#stopOn(error);return this.status();}
  });}
  async #recoverMint(op) {
    if(!op.attestation)return true;
    const observed=await this.#solana.observe(op.binding,op.plan,op.attestation);
    if(!observed.claimExists){check(!op.mintReceipt,'FINALIZED_MINT_DISAPPEARED');return true;}
    const packets=(op.solanaPacket??[]).filter(row=>row.packet.kind==='CLAIM'&&row.packet.messageDigestHex===message(op.attestation.encodedMessageHex).messageDigestHex);
    check(packets.length>0,'UNJOURNALED_SOLANA_MINT');
    for(const row of packets){
      const status=await this.#solana.packetStatus(row.packet,op.binding,op.plan,op.attestation);
      if(status.status?.confirmationStatus==='finalized'&&status.status.err===null){
        const receipt=await this.#solana.mintReceipt(op,row.packet,status.observed);
        this.#update(state=>{markBurnSolanaPacket(state,op.operationId,row.packet.signature,{outcome:'FINALIZED',sendAttempts:row.sendAttempts,observedSlot:status.observed.slot});retainBurnMint(state,op.operationId,receipt);});return true;
      }
    }
    return false;
  }
  async #packet(id,kind,nativeAdmission=null,finalizedBurn=null) {
    let op=this.#op(id),rows=(op.solanaPacket??[]).filter(row=>row.packet.kind===kind&&
      (kind==='ATA'||row.packet.messageDigestHex===message(op.attestation.encodedMessageHex).messageDigestHex));
    let row=rows.at(-1);
    if(row){
      const attestation=burnPacketAttestation(op,row.packet),status=await this.#solana.packetStatus(row.packet,op.binding,op.plan,attestation);
      if(status.exists){
        if(kind==='CLAIM')return await this.#recoverMint(op);
        this.#update(state=>markBurnSolanaPacket(state,id,row.packet.signature,{outcome:'FINALIZED',sendAttempts:row.sendAttempts,observedSlot:status.observed.slot}));return true;
      }
      if(row.outcome==='FINALIZED')throw new Error('FINALIZED_SOLANA_ACCOUNT_DISAPPEARED');
      if(status.status?.confirmationStatus==='finalized'&&status.status.err!==null||status.expired){
        const outcome=status.expired?'EXPIRED_UNSEEN':'FINALIZED_FAILED';
        this.#update(state=>markBurnSolanaPacket(state,id,row.packet.signature,{outcome,sendAttempts:row.sendAttempts,observedSlot:status.observed.slot}));row=null;
      }else if(status.status!==null)return false;
    }
    if(!row){
      op=this.#op(id);const recent=await this.#solana.latestBlockhash();
      const packet=await this.#solanaSigner.prepare({kind,binding:op.binding,plan:op.plan,nativeAdmission,finalizedBurn,attestation:op.attestation,...recent});
      this.#update(state=>retainBurnSolanaPacket(state,id,packet));row=this.#op(id).solanaPacket.at(-1);
    }
    check(row.sendAttempts<32,'SOLANA_RETRY_REVIEW_REQUIRED');
    this.#update(state=>markBurnSolanaPacket(state,id,row.packet.signature,{outcome:'UNRESOLVED',sendAttempts:row.sendAttempts+1,observedSlot:row.observedSlot}));
    await this.#solana.send(row.packet,op.binding,burnPacketAttestation(this.#op(id),row.packet));this.#emit(`${kind}_BROADCAST`,id,{signature:row.packet.signature});return false;
  }
  async #advance(id) {
    let op=this.#op(id);
    if(!op.plan){
      if(!op.deposit||op.deposit.confirmations<12)return;
      this.#emit('DEPOSIT_FINALITY_REACHED',id);
      const operational=burnOperationalDestination(op.binding),reserved=new Set(this.#journal.read().operations.flatMap(o=>o.plan?.inputs.map(i=>`${i.txid}:${i.vout}`)??[]));
      const feeCoins=await this.#observer.operationalCoins(operational.scriptPubKeyHex,reserved);
      const {plan}=await this.#fees.selectPlan({operationId:id,deposit:{txid:op.deposit.txid,vout:op.deposit.vout,amountAtomic:op.deposit.amountAtomic,scriptPubKeyHex:op.depositScriptHex},
        operationalScriptHex:operational.scriptPubKeyHex,feeCoins});
      await this.#verifier.verifyDepositAdmission({binding:op.binding,plan});
      this.#update(state=>retainBurnPlan(state,id,plan));this.#emit('BURN_CONSTRUCTED',id,{txid:plan.txid});op=this.#op(id);
    }
    if(!op.burnEvidence){
      const known=await this.#observer.burnStatus(op.plan);
      if(known.found){check(op.broadcastAttempted,'UNJOURNALED_NATIVE_BURN');return;}
      check(!op.exception,'BURN_DEPOSIT_EXCEPTION');
      this.#solanaSigner.ready();this.#attesters.forEach(a=>a.ready());
      for(const attester of this.#attesters)await attester.reserve({binding:op.binding,plan:op.plan});
      const gate=await this.#solana.preBurn(op.binding,op.plan,burnJournalAccounting(this.#journal.read()).mintedAtomic);
      if(!gate.ataExists){const admission=await this.#verifier.verifyDepositAdmission({binding:op.binding,plan:op.plan});await this.#packet(id,'ATA',admission);return;}
      // Recheck arrivals immediately before the irreversible step. Address
      // issuance is single-use; another payment is never silently aggregated.
      const scan=await this.#discover();if(!scan.caughtUp)return;op=this.#op(id);
      check(!this.#journal.read().paused&&!op.exception,'BURN_DEPOSIT_EXCEPTION');
      await this.#fees.verifyBeforeBroadcast(op.plan);
      const admission=await this.#verifier.verifyDepositAdmission({binding:op.binding,plan:op.plan});
      if(!op.signedBurnHex){const signed=this.#burnSigner.sign({binding:op.binding,plan:op.plan,admission});this.#update(state=>retainSignedBurn(state,id,signed));op=this.#op(id);}
      this.#update(state=>markBurnBroadcast(state,id));
      await this.#observer.broadcast(op.plan,op.signedBurnHex,this.#fees.maximumRateAtomicPerKvB);
      this.#update(state=>markBurnBroadcast(state,id,true));this.#emit('BURN_BROADCAST',id,{txid:op.plan.txid});return;
    }
    if(op.mintReceipt)return;
    const final=await this.#verifier.verifyFinalizedBurn({binding:op.binding,plan:op.plan});check(sameEvidence(final.evidence,op.burnEvidence),'FINALIZED_BURN_CHANGED');
    const clock=await this.#solana.clock(),now=BigInt(Math.floor(Date.now()/1000));
    if(op.attestationDraftHex&&message(op.attestationDraftHex).validUntil<clock&&message(op.attestationDraftHex).validUntil<now){
      for(const row of op.solanaPacket??[]){
        if(row.packet.kind==='ATA'||row.outcome!=='UNRESOLVED')continue;
        const status=await this.#solana.packetStatus(row.packet,op.binding,op.plan,burnPacketAttestation(op,row.packet));
        if(status.observed.claimExists){await this.#recoverMint(op);return;}
        const outcome=status.exists?'FINALIZED':status.expired?'EXPIRED_UNSEEN':status.status?.confirmationStatus==='finalized'&&status.status.err!==null?'FINALIZED_FAILED':null;
        if(outcome)this.#update(state=>markBurnSolanaPacket(state,id,row.packet.signature,{outcome,sendAttempts:row.sendAttempts,observedSlot:status.observed.slot}));else return;
      }
      op=this.#op(id);
    }
    if(!op.attestationDraftHex||message(op.attestationDraftHex).validUntil<clock&&message(op.attestationDraftHex).validUntil<now){
      const earliest=(clock<now?clock:now)-1n,priorEnd=op.attestationDraftHex?message(op.attestationDraftHex).validUntil:0n;
      const validFrom=earliest>priorEnd?earliest:priorEnd+1n,validUntil=(clock>now?clock:now)+3600n;
      const bytes=encodeBurnMessage({evidence:op.burnEvidence,keyEpoch:this.#context.keyEpoch,policyEpoch:this.#context.policyEpoch,validFrom,validUntil});
      this.#update(state=>prepareBurnAuthorization(state,id,bytes.toString('hex')));op=this.#op(id);
    }
    if(!op.attestation){
      const attestations=[];for(const attester of this.#attesters)attestations.push(await attester.attest({binding:op.binding,plan:op.plan,encodedMessageHex:op.attestationDraftHex}));
      this.#update(state=>retainBurnAttestation(state,id,{encodedMessageHex:op.attestationDraftHex,attestations}));this.#emit('ATTESTED',id);op=this.#op(id);
    }
    if(message(op.attestation.encodedMessageHex).validUntil<=now+30n)return;
    if(!await this.#packet(id,'RECEIPT',null,final))return;
    await this.#packet(id,'CLAIM',null,final);
  }
}
