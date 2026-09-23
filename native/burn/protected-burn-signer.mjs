// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Dedicated single-key signer on existing DPAPI storage. No Mainnet admission.
import {createHash} from 'node:crypto';
import {schnorr} from '@noble/curves/secp256k1.js';
import {assertWindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
import {REGTEST_GENESIS} from '../node/native-raw-evidence.mjs';
import {requireBurnDepositAdmission} from './burn-evidence.mjs';
import {requireBurn as check,burnOperationId,validateNativeBurnTransaction} from './burn-protocol.mjs';
import {signNativeBurnWithKey,verifyNativeBurnSignatures} from './burn-key.mjs';
import {parseNativeTransactionHex} from '../node/native-taproot-transaction.mjs';

export const BURN_SIGNER_PROTOCOL='KINGPEPE_SINGLE_KEY_BURN_SIGNER_V1';
const instances=new WeakSet(),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function requireProtectedNativeBurnSigner(value){check(instances.has(value),'ProtectedNativeBurnSignerRequired');}
export function initialBurnAuthorizations(publicKeyHex){return Buffer.from(JSON.stringify({protocol:BURN_SIGNER_PROTOCOL,publicKeyHex,authorizations:[]}));}
export class ProtectedNativeBurnSigner {
  #key;#authorizations;#lease;#publicKey;#busy=false;#closed=false;
  static async open({keyStore,authorizationStore}) {
    assertWindowsProtectedStore(keyStore,'BURN_SIGNER','native-burn-key');
    assertWindowsProtectedStore(authorizationStore,'BURN_SIGNER','native-burn-authorizations');
    const k=keyStore.context,a=authorizationStore.context;
    check(['localnet','devnet'].includes(k.environment)&&k.nativeGenesis===REGTEST_GENESIS,'BurnSignerTestBindingRequired');
    for(const field of ['environment','nativeGenesis','solanaDeployment','serviceSid','keyEpoch'])check(k[field]===a[field],'BurnSignerContextChanged');
    const instance=new ProtectedNativeBurnSigner();instance.#key=keyStore;instance.#authorizations=authorizationStore;
    instance.#lease=await authorizationStore.acquireLease();
    try{
      const {payload}=keyStore.read();
      try{check(payload.length===32,'BurnKeyEncodingRejected');instance.#publicKey=Buffer.from(schnorr.getPublicKey(payload)).toString('hex');}
      finally{payload.fill(0);}
      instance.#read();instances.add(instance);return instance;
    }catch(error){await instance.close();throw error;}
  }
  get publicKeyHex(){return this.#publicKey;}
  #read(){
    check(!this.#closed,'BurnSignerClosed');this.#lease.assertHeld();
    const {revision,payload}=this.#authorizations.read();
    try{
      const text=payload.toString('utf8'),state=JSON.parse(text);
      check(JSON.stringify(state)===text&&Object.keys(state).sort().join()==='authorizations,protocol,publicKeyHex'&&
        state.protocol===BURN_SIGNER_PROTOCOL&&state.publicKeyHex===this.#publicKey&&Array.isArray(state.authorizations)&&state.authorizations.length<=512,'BurnSignerStateRejected');
      const ids=new Set(),coins=new Set();
      for(const row of state.authorizations){
        check(row&&Object.keys(row).sort().join()==='binding,operationId,plan,planDigest,signedHex'&&row.binding.burnPublicKey===this.#publicKey&&
          row.operationId===burnOperationId(row.binding)&&row.planDigest===hash(row.plan)&&!ids.has(row.operationId),'BurnSignerStateRejected');
        validateNativeBurnTransaction({rawTransactionHex:row.plan.unsignedTransactionHex,operationId:row.operationId,inputs:row.plan.inputs,
          operationalScriptHex:row.plan.operationalScriptHex,expectedFeeAtomic:row.plan.feeAtomic,maximumFeeAtomic:row.plan.maximumFeeAtomic});
        ids.add(row.operationId);
        for(const input of row.plan.inputs){const id=`${input.txid}:${input.vout}`;check(!coins.has(id),'BurnSignerInputReused');coins.add(id);}
        if(row.signedHex!==null){check(parseNativeTransactionHex(row.signedHex).strippedHex===row.plan.unsignedTransactionHex,'BurnSignerSignedBytesChanged');verifyNativeBurnSignatures({rawTransactionHex:row.signedHex,inputs:row.plan.inputs});}
      }
      return {revision,state};
    }finally{payload.fill(0);}
  }
  #write(state,revision){const payload=Buffer.from(JSON.stringify(state));try{this.#lease.assertHeld();return this.#authorizations.write(payload,revision).revision;}finally{payload.fill(0);}}
  inspect(operationId){return structuredClone(this.#read().state.authorizations.find(a=>a.operationId===operationId)??null);}
  sign({binding,plan,admission}) {
    check(!this.#busy,'BurnSignerBusy');this.#busy=true;
    try{
      requireBurnDepositAdmission(admission,binding,plan);
      check(binding.burnPublicKey===this.#publicKey&&binding.nativeGenesis===this.#key.context.nativeGenesis&&binding.solanaDeployment===this.#key.context.solanaDeployment,'BurnSignerBindingChanged');
      let {revision,state}=this.#read();
      const operationId=burnOperationId(binding),planDigest=hash(plan);
      let row=state.authorizations.find(a=>a.operationId===operationId);
      if(row){check(row.planDigest===planDigest,'BurnSignerReplacementRejected');if(row.signedHex!==null)return row.signedHex;}
      else{
        const reserved=new Set(state.authorizations.flatMap(a=>a.plan.inputs.map(i=>`${i.txid}:${i.vout}`)));
        check(state.authorizations.length<512&&!plan.inputs.some(i=>reserved.has(`${i.txid}:${i.vout}`)),'BurnSignerInputOrStorageUnavailable');
        row={operationId,binding:structuredClone(binding),plan:structuredClone(plan),planDigest,signedHex:null};state.authorizations.push(row);
        revision=this.#write(state,revision);
      }
      const {payload}=this.#key.read();
      try{row.signedHex=signNativeBurnWithKey({rootSecret:payload,binding,plan});}finally{payload.fill(0);}
      this.#write(state,revision);return row.signedHex;
    }finally{this.#busy=false;}
  }
  async close(){this.#closed=true;await this.#lease?.close();this.#key?.close();this.#authorizations?.close();}
}
