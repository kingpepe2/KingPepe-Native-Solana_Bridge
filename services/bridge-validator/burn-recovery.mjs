// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Manual quiescent export/import, not a background backup or rollback service.
// Plaintext exists in process memory and inherited pipes only. Export does not
// certify that an encrypted copy has been removed from the server.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {schnorr} from '@noble/curves/secp256k1.js';
import {ed25519} from '@noble/curves/ed25519.js';
import {WindowsProtectedStore,normalizeProtectedContext,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {validateRuntimeStateRoot} from '../../shared/runtime-path-boundary.mjs';
import {encryptRecoveryCms} from '../../shared/windows/cms-recovery.mjs';
import {validateBurnJournalState} from './burn-journal-state.mjs';
import {validateBurnContext} from './burn-context.mjs';
const PROTOCOL='KINGPEPE_QUIESCENT_BURN_RECOVERY_V1';
const check=(v,c='BurnRecoveryRejected')=>{if(!v)throw Error(c);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const hex=b=>Buffer.from(b).toString('hex');
const SPECS=Object.freeze({burnKey:['BURN_SIGNER','native-burn-key'],burnState:['BURN_SIGNER','native-burn-authorizations'],
  journal:['BRIDGE_VALIDATOR','burn-operations'],payer:['FEE_PAYER','fee-payer-seed'],
  attesterKey0:['ATTESTER_A','attester-seed'],attesterState0:['ATTESTER_A','burn-attester-authorizations'],
  attesterKey1:['ATTESTER_B','attester-seed'],attesterState1:['ATTESTER_B','burn-attester-authorizations'],
  nativeRpc:['NATIVE_OBSERVER','native-rpc-auth'],solanaRpc:['BRIDGE_VALIDATOR','solana-rpc-url'],accessToken:['BRIDGE_VALIDATOR','service-auth']});
const names=Object.keys(SPECS).sort();
const storeOptions=c=>({...c.runtime.stores,nativeRpc:c.runtime.nativeRpcStore,solanaRpc:c.runtime.solanaRpcStore,accessToken:c.accessTokenStore});
const canonical=b=>{const s=b.toString('utf8'),value=JSON.parse(s);check(JSON.stringify(value)===s);return value;};
function inspect(bundle){
  check(bundle&&Object.keys(bundle).sort().join()==='configuration,createdAt,protocol,sourceSha,stores'&&bundle.protocol===PROTOCOL&&
    /^[0-9a-f]{40}$/u.test(bundle.sourceSha)&&typeof bundle.createdAt==='string'&&Number.isFinite(Date.parse(bundle.createdAt)));
  const c=bundle.configuration,context=validateBurnContext(c?.runtime?.policy?.context);
  check(context.environment==='mainnet'&&c.productionReady===false&&c.mainnetActivation==='DISABLED');
  check(Object.keys(bundle.stores).sort().join()===names.join()&&Object.keys(storeOptions(c)).sort().join()===names.join());
  const payloads={},identities=new Set();
  try{
    for(const name of names){
      const row=bundle.stores[name],options=storeOptions(c)[name];
      check(row&&Object.keys(row).sort().join()==='context,payloadBase64,revision');
      const sc=normalizeProtectedContext(row.context);
      check(JSON.stringify(sc)===JSON.stringify(normalizeProtectedContext(options.context))&&sc.role===SPECS[name][0]&&sc.purpose===SPECS[name][1]&&
        sc.environment==='mainnet'&&sc.nativeGenesis===context.deployment.nativeGenesis&&sc.solanaDeployment===context.deployment.solanaDeployment&&
        sc.keyEpoch===context.keyEpoch&&sc.serviceSid===bundle.stores.journal.context.serviceSid&&
        /^[1-9][0-9]{0,19}$/u.test(row.revision)&&BigInt(row.revision)<=0xffffffffffffffffn&&
        typeof row.payloadBase64==='string'&&row.payloadBase64.length<=1398104&&!identities.has(sc.instanceId));
      identities.add(sc.instanceId);const bytes=Buffer.from(row.payloadBase64,'base64');payloads[name]=bytes;
      check(bytes.toString('base64')===row.payloadBase64&&bytes.length<=1048576);
    }
    const journal=validateBurnJournalState(canonical(payloads.journal));
    check(journal.paused===true,'BurnRecoveryQuiescentPauseRequired');
    check(JSON.stringify(journal.deliveryPolicy?.context)===JSON.stringify(context)&&journal.deliveryPolicy?.feePayerHex===c.runtime.policy.feePayerHex);
    for(const name of ['burnKey','payer','attesterKey0','attesterKey1','accessToken'])check(payloads[name].length===32);
    check(hex(schnorr.getPublicKey(payloads.burnKey))===context.deployment.burnPublicKey&&hex(ed25519.getPublicKey(payloads.payer))===c.runtime.policy.feePayerHex);
    for(let i=0;i<2;i++)check(hex(ed25519.getPublicKey(payloads['attesterKey'+i]))===context.attesters[i]);
    check(new Set(['burnKey','payer','attesterKey0','attesterKey1'].map(n=>hex(payloads[n]))).size===4);
    const signer=canonical(payloads.burnState);
    check(signer.protocol==='KINGPEPE_SINGLE_KEY_BURN_SIGNER_V1'&&signer.publicKeyHex===context.deployment.burnPublicKey&&Array.isArray(signer.authorizations));
    for(let i=0;i<2;i++){
      const state=canonical(payloads['attesterState'+i]);check(state.protocol==='KINGPEPE_FINALIZED_BURN_ATTESTER_V1'&&
        state.role===SPECS['attesterState'+i][0]&&JSON.stringify(state.context)===JSON.stringify(context)&&Array.isArray(state.records));
    }
    // Missing signing reservations cannot be repaired by regenerating keys or
    // dropping pending operations. Runtime validators check the full records.
    for(const op of journal.operations){
      const signed=signer.authorizations.find(r=>r.operationId===op.operationId);
      if(op.signedBurnHex!==null)check(signed?.signedHex===op.signedBurnHex,'BurnRecoverySigningStateMissing');
      if(op.attestation!==null)for(let i=0;i<2;i++)check(canonical(payloads['attesterState'+i]).records.some(r=>r.operationId===op.operationId),'BurnRecoveryAttesterStateMissing');
    }
    const rpc=canonical(payloads.nativeRpc);check(Object.keys(rpc).sort().join()==='endpoint,password,username');
    const endpoint=new URL(payloads.solanaRpc.toString('utf8'));check(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password&&!endpoint.hash);
    return {context,journal,payloads};
  }catch(error){Object.values(payloads).forEach(b=>b.fill(0));throw error;}
}
export async function exportBurnRecovery({configuration,sourceSha,certificateFile,certificateSha256,openssl,opensslSha256}){
  const rows={},stores=[],leases=[];let plaintext,inspected;
  try{
    const options=storeOptions(configuration);check(Object.keys(options).sort().join()===names.join());
    check(new Set(names.map(n=>path.resolve(options[n].root).toLowerCase())).size===names.length);
    for(const name of names){
      const store=new WindowsProtectedStore(options[name]);stores.push(store);leases.push(await store.acquireLease());
      const {revision,payload}=store.read();
      try{rows[name]={context:store.context,revision,payloadBase64:payload.toString('base64')};}finally{payload.fill(0);}
    }
    const bundle={protocol:PROTOCOL,sourceSha,createdAt:new Date().toISOString(),configuration:structuredClone(configuration),stores:rows};
    inspected=inspect(bundle);leases.forEach(l=>l.assertHeld());
    plaintext=Buffer.from(JSON.stringify(bundle));
    const result=encryptRecoveryCms({plaintext,certificateFile,certificateSha256,openssl,opensslSha256});
    leases.forEach(l=>l.assertHeld());
    return {...result,receipt:{...result.receipt,sourceSha,solanaDeployment:inspected.context.deployment.solanaDeployment,
      burnPublicKey:inspected.context.deployment.burnPublicKey,operations:inspected.journal.operations.length,
      journalRevision:rows.journal.revision,plaintextWrittenToFile:false,restoreVerified:false}};
  }finally{
    plaintext?.fill(0);Object.values(inspected?.payloads??{}).forEach(b=>b.fill(0));
    for(const row of Object.values(rows))row.payloadBase64='';
    let closeFailed=false;
    for(const lease of leases.reverse())try{await lease.close();}catch{closeFailed=true;}
    stores.forEach(s=>s.close());if(closeFailed)throw Error('BurnRecoveryLeaseReleaseFailed');
  }
}
// The offline recovery operator decrypts CMS in memory. Only the decoded
// snapshot enters this importer; the recovery private key stays offline.
// A new empty destination is mandatory. Existing production state is untouched.
export function restoreBurnRecovery({plaintext,expectedPlaintextSha256,root,repoRoot}){
  check(Buffer.isBuffer(plaintext)&&plaintext.length<=24*1024*1024&&/^[0-9a-f]{64}$/u.test(expectedPlaintextSha256)&&
    hash(plaintext)===expectedPlaintextSha256,'BurnRecoverySnapshotDigestMismatch');
  const bundle=canonical(plaintext),inspected=inspect(bundle);
  try{
    root=validateRuntimeStateRoot(root,repoRoot);check(!existsSync(root),'BurnRecoveryExistingDestinationPreserved');
    const serviceSid=windowsCurrentServiceSid();mkdirSync(root,{recursive:false});check(readdirSync(root).length===0);
    const configuration=structuredClone(bundle.configuration),newOptions={};
    inspected.journal.paused=true;inspected.journal.pauseReason='RECOVERY_CHAIN_REVIEW_REQUIRED';
    inspected.payloads.journal.fill(0);inspected.payloads.journal=Buffer.from(JSON.stringify(inspected.journal));
    for(const name of names){
      const context={...bundle.stores[name].context,serviceSid};
      const options={root:path.join(root,name),repoRoot,context};
      WindowsProtectedStore.create(options,inspected.payloads[name]).close();newOptions[name]=options;
    }
    configuration.runtime.stores=Object.fromEntries(names.filter(n=>!['nativeRpc','solanaRpc','accessToken'].includes(n)).map(n=>[n,newOptions[n]]));
    configuration.runtime.nativeRpcStore=newOptions.nativeRpc;configuration.runtime.solanaRpcStore=newOptions.solanaRpc;configuration.accessTokenStore=newOptions.accessToken;
    return {configuration,sourceSha:bundle.sourceSha,burnPublicKey:inspected.context.deployment.burnPublicKey,
      operations:inspected.journal.operations.length,productionReady:false,mainnetActivation:'DISABLED',
      recoveryState:'PAUSED_CHAIN_REVIEW_REQUIRED',historicalStorageRevisions:Object.fromEntries(names.map(n=>[n,bundle.stores[n].revision]))};
  }finally{Object.values(inspected.payloads).forEach(b=>b.fill(0));for(const row of Object.values(bundle.stores))row.payloadBase64='';}
}
