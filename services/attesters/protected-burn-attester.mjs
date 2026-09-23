// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Each attester independently reads Native chain evidence. Reserved capacity and
// immutable burn attribution persist before a deposit may be irreversibly burnt.
import {createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519.js';
import {assertWindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {RegtestNativeBurnVerifier,requireFinalizedNativeBurn} from '../../native/burn/burn-evidence.mjs';
import {burnOperationId,burnAmount,requireBurn as check,encodeFinalizedBurnEvidence} from '../../native/burn/burn-protocol.mjs';
import {decodeCanonicalBridgeMessage,stableJson} from '../../shared/protocol/canonical-message.mjs';
import {MAX_KPEPE_SUPPLY_ATOMIC} from '../../shared/monetary-supply.mjs';
import {validateBurnContext,assertBurnBindingContext,assertBurnMessageContext} from '../bridge-validator/burn-context.mjs';
import {ATTESTATION_PROTOCOL,ATTESTATION_MODE,BURN_SIGNED_BYTES,verifyProjectAttestation} from './burn-attestation-codec.mjs';

export const BURN_ATTESTER_JOURNAL='KINGPEPE_FINALIZED_BURN_ATTESTER_V1';
const instances=new WeakSet(),hash=v=>createHash('sha256').update(stableJson(v)).digest('hex');
export function requireProtectedBurnAttester(value){check(instances.has(value),'ProtectedBurnAttesterRequired');}
export function initialBurnAttesterState(context,role){return Buffer.from(JSON.stringify({protocol:BURN_ATTESTER_JOURNAL,context:validateBurnContext(context),role,records:[]}));}
export class ProtectedBurnAttester {
  #key;#store;#lease;#verifier;#context;#role;#publicKey;#busy=false;#closed=false;
  static async open({keyStore,authorizationStore,verifier,context,role}) {
    const c=validateBurnContext(context);check(['ATTESTER_A','ATTESTER_B'].includes(role),'BurnAttesterRoleRejected');
    assertWindowsProtectedStore(keyStore,role,'attester-seed');assertWindowsProtectedStore(authorizationStore,role,'burn-attester-authorizations');
    check(verifier instanceof RegtestNativeBurnVerifier,'IndependentBurnVerifierRequired');
    for(const store of [keyStore,authorizationStore])check(store.context.environment===c.environment&&
      store.context.nativeGenesis===c.deployment.nativeGenesis&&store.context.solanaDeployment===c.deployment.solanaDeployment&&store.context.keyEpoch===c.keyEpoch,'BurnAttesterStorageContext');
    const self=new ProtectedBurnAttester();self.#key=keyStore;self.#store=authorizationStore;self.#context=c;self.#role=role;self.#verifier=verifier;
    self.#lease=await authorizationStore.acquireLease();
    try{
      const {payload}=keyStore.read();try{check(payload.length===32,'BurnAttesterKeyRejected');self.#publicKey=Buffer.from(ed25519.getPublicKey(payload)).toString('hex');}finally{payload.fill(0);}
      check(self.#publicKey===c.attesters[['ATTESTER_A','ATTESTER_B'].indexOf(role)],'BurnAttesterKeyMismatch');
      self.#read();instances.add(self);return self;
    }catch(error){await self.close();throw error;}
  }
  get publicKeyHex(){return this.#publicKey;}
  get role(){return this.#role;}
  #read(){
    check(!this.#closed,'BurnAttesterClosed');this.#lease.assertHeld();const {revision,payload}=this.#store.read();
    try{
      const text=payload.toString('utf8'),s=JSON.parse(text);
      check(JSON.stringify(s)===text&&Object.keys(s).sort().join()==='context,protocol,records,role'&&
        s.protocol===BURN_ATTESTER_JOURNAL&&stableJson(s.context)===stableJson(this.#context)&&s.role===this.#role&&Array.isArray(s.records)&&s.records.length<=256,'BurnAttesterStateRejected');
      const ops=new Set(),deposits=new Set(),burns=new Set();let committed=0n;
      for(const r of s.records){
        check(r&&Object.keys(r).sort().join()==='amountAtomic,attestation,binding,burnKey,depositKey,messageHex,operationId,planDigest'&&
          r.operationId===burnOperationId(r.binding)&&/^[0-9a-f]{64}$/u.test(r.planDigest)&&
          /^[0-9a-f]{64}:[0-9]{1,10}$/u.test(r.depositKey)&&/^[0-9a-f]{64}:0$/u.test(r.burnKey),'BurnAttesterRecordRejected');
        assertBurnBindingContext(r.binding,this.#context);
        check(!ops.has(r.operationId)&&!deposits.has(r.depositKey)&&!burns.has(r.burnKey),'BurnAttesterReplayConflict');
        ops.add(r.operationId);deposits.add(r.depositKey);burns.add(r.burnKey);committed+=burnAmount(r.amountAtomic);
        if(r.messageHex!==null){const m=decodeCanonicalBridgeMessage(Buffer.from(r.messageHex,'hex'));assertBurnMessageContext(m,this.#context);
          check(m.operationIdHex===r.operationId&&m.depositOutpointText===r.depositKey&&`${m.burnEvidence.burn.txid}:0`===r.burnKey&&m.amountAtomic.toString()===r.amountAtomic,'BurnAttesterEvidenceChanged');}
        if(r.attestation!==null)check(r.messageHex!==null&&r.attestation.attesterPublicKeyHex===this.#publicKey&&r.attestation.role===this.#role&&
          verifyProjectAttestation(r.attestation,r.messageHex),'BurnAttesterSignatureChanged');
      }
      check(committed<=MAX_KPEPE_SUPPLY_ATOMIC,'BurnAttesterMonetaryCapExceeded');return {state:s,revision};
    }finally{payload.fill(0);}
  }
  #write(state,revision){const payload=Buffer.from(JSON.stringify(state));try{this.#lease.assertHeld();this.#store.write(payload,revision);}finally{payload.fill(0);}}
  ready(){this.#read();const {payload}=this.#key.read();try{check(payload.length===32,'BurnAttesterKeyUnavailable');return this.#publicKey;}finally{payload.fill(0);}}
  async reserve({binding,plan}) {
    check(!this.#busy,'BurnAttesterBusy');this.#busy=true;
    try{
      assertBurnBindingContext(binding,this.#context);
      await this.#verifier.verifyDepositAdmission({binding,plan});
      const {state,revision}=this.#read(),id=burnOperationId(binding),known=state.records.find(r=>r.operationId===id);
      if(known){check(known.planDigest===hash(plan),'BurnAttesterReplacementRejected');return;}
      const row={operationId:id,binding:structuredClone(binding),planDigest:hash(plan),depositKey:`${plan.inputs[0].txid}:${plan.inputs[0].vout}`,
        burnKey:`${plan.txid}:0`,amountAtomic:plan.inputs[0].amountAtomic,messageHex:null,attestation:null};
      check(!state.records.some(r=>r.depositKey===row.depositKey||r.burnKey===row.burnKey),'BurnAttesterReplayConflict');
      check(state.records.reduce((n,r)=>n+burnAmount(r.amountAtomic),0n)+burnAmount(row.amountAtomic)<=MAX_KPEPE_SUPPLY_ATOMIC,'BurnAttesterMonetaryCapExceeded');
      // Reserve enough bounded DPAPI capacity for every eventual signed record.
      check(state.records.length<256&&Buffer.byteLength(JSON.stringify(state))+7000*(state.records.filter(r=>r.attestation===null).length+1)<1_000_000,'BurnAttesterStorageCapacity');
      state.records.push(row);this.#write(state,revision);
    }finally{this.#busy=false;}
  }
  async attest({binding,plan,encodedMessageHex}) {
    check(!this.#busy,'BurnAttesterBusy');this.#busy=true;
    try{
      const m=decodeCanonicalBridgeMessage(Buffer.from(encodedMessageHex,'hex'));assertBurnMessageContext(m,this.#context);
      check(m.operationIdHex===burnOperationId(binding),'BurnAttesterOperationChanged');
      const final=await this.#verifier.verifyFinalizedBurn({binding,plan});requireFinalizedNativeBurn(final,binding,plan);
      check(encodeFinalizedBurnEvidence(m.burnEvidence).toString('hex')===final.evidenceHex,'BurnAttesterRawEvidenceMismatch');
      const now=BigInt(Math.floor(Date.now()/1000));check(m.validFrom<=now&&now<=m.validUntil,'BurnAttesterMessageExpired');
      let {state,revision}=this.#read();const row=state.records.find(r=>r.operationId===m.operationIdHex);
      check(row&&row.planDigest===hash(plan),'BurnAttesterReservationRequired');
      if(row.attestation&&row.messageHex===encodedMessageHex)return structuredClone(row.attestation);
      if(row.messageHex!==null&&row.messageHex!==encodedMessageHex){
        const prior=decodeCanonicalBridgeMessage(Buffer.from(row.messageHex,'hex'));
        check(prior.validUntil<now&&encodeFinalizedBurnEvidence(prior.burnEvidence).equals(encodeFinalizedBurnEvidence(m.burnEvidence)),'BurnAttesterAuthorizationChanged');
      }
      row.messageHex=encodedMessageHex;row.attestation=null;this.#write(state,revision);
      ({state,revision}=this.#read());const current=state.records.find(r=>r.operationId===m.operationIdHex);
      const {payload}=this.#key.read();let signatureHex;
      try{signatureHex=Buffer.from(ed25519.sign(m.encoded,payload)).toString('hex');}finally{payload.fill(0);}
      current.attestation={protocol:ATTESTATION_PROTOCOL,mode:ATTESTATION_MODE,role:this.#role,keyEpoch:m.keyEpoch,policyEpoch:m.policyEpoch,
        attesterPublicKeyHex:this.#publicKey,messageDigestHex:m.messageDigestHex,operationIdHex:m.operationIdHex,
        signedBytes:BURN_SIGNED_BYTES,signatureHex,state:'VERIFIED_READY'};
      this.#write(state,revision);return structuredClone(current.attestation);
    }finally{this.#busy=false;}
  }
  async close(){this.#closed=true;await this.#lease?.close();this.#key?.close();this.#store?.close();}
}
