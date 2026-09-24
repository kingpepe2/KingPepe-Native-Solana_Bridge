// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Local protected preparation under the dedicated Windows service identity.
// No RPC, wallet funding, operation, transaction, listener or activation.
import {randomBytes} from 'node:crypto';import {existsSync,mkdirSync} from 'node:fs';import path from 'node:path';
import {schnorr} from '@noble/curves/secp256k1.js';import {ed25519} from '@noble/curves/ed25519.js';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {validateRuntimeStateRoot} from '../../shared/runtime-path-boundary.mjs';
import {NATIVE_MAINNET_GENESIS,NATIVE_MAINNET_DOMAIN,SOLANA_MAINNET_GENESIS,mainnetDeploymentIdentity,mainnetRpcEndpoint} from '../../shared/network-identity.mjs';
import {base58Decode,base58Encode} from './solana-deposit-claim-transaction-plan.mjs';
import {initialBurnAuthorizations} from '../../native/burn/protected-burn-signer.mjs';
import {initialBurnAttesterState} from '../attesters/protected-burn-attester.mjs';
import {initialBurnJournal} from './burn-journal-state.mjs';
import {validateBurnContext} from './burn-context.mjs';
import {burnOperationalDestination} from '../../native/burn/burn-key.mjs';
const check=v=>{if(!v)throw Error('MainnetBurnPreparationRejected');},hex=b=>Buffer.from(b).toString('hex');
export function prepareMainnetBurnStores({root,repoRoot,expectedServiceSid,explorerSid,identities,feePayer,attesters,imports}){
  const sid=windowsCurrentServiceSid();check(sid===expectedServiceSid&&sid!==explorerSid&&/^S-1-5-/u.test(explorerSid));
  check(identities&&Object.keys(identities).sort().join()==='manager,mint,transceiver'&&Array.isArray(attesters)&&attesters.length===2);
  for(const value of [...Object.values(identities),feePayer,...attesters])check(base58Decode(value).length===32&&base58Encode(base58Decode(value))===value);
  check(new Set([...Object.values(identities),feePayer,...attesters]).size===6);
  check(imports&&Object.keys(imports).sort().join()==='attesterA,attesterB,nativeRpc,solanaPayer,solanaRpc');
  for(const name of ['attesterA','attesterB','solanaPayer'])check(Buffer.isBuffer(imports[name])&&imports[name].length===32);
  check(base58Encode(ed25519.getPublicKey(imports.solanaPayer))===feePayer&&
    [imports.attesterA,imports.attesterB].every((seed,i)=>base58Encode(ed25519.getPublicKey(seed))===attesters[i]));
  check(Buffer.isBuffer(imports.nativeRpc)&&imports.nativeRpc.length<=8192&&Buffer.isBuffer(imports.solanaRpc)&&imports.solanaRpc.length<=2048);
  let native;try{native=JSON.parse(imports.nativeRpc.toString('utf8'));}catch{throw Error('MainnetBurnPreparationRejected');}
  check(native&&Object.keys(native).sort().join()==='endpoint,password,username'&&typeof native.username==='string'&&/^[^:\r\n\0]{1,256}$/u.test(native.username)&&
    typeof native.password==='string'&&/^[^\r\n\0]{1,1024}$/u.test(native.password));
  let endpoint;try{endpoint=new URL(native.endpoint);}catch{throw Error('MainnetBurnPreparationRejected');}
  check(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'&&Number(endpoint.port)>=1024&&endpoint.pathname==='/'&&!endpoint.search&&!endpoint.hash&&!endpoint.username&&!endpoint.password);
  mainnetRpcEndpoint(imports.solanaRpc.toString('utf8'),SOLANA_MAINNET_GENESIS);
  root=validateRuntimeStateRoot(root,repoRoot);check(!existsSync(root));
  const burnSecret=schnorr.utils.randomSecretKey(),token=randomBytes(32);let publicKey;
  try{
    publicKey=hex(schnorr.getPublicKey(burnSecret));
    check(![imports.solanaPayer,imports.attesterA,imports.attesterB].some(seed=>Buffer.from(burnSecret).equals(seed)));
    const deployment={protocolId:1,nativeNetwork:NATIVE_MAINNET_DOMAIN,nativeGenesis:NATIVE_MAINNET_GENESIS,
      solanaGenesis:hex(base58Decode(SOLANA_MAINNET_GENESIS)),solanaDeployment:mainnetDeploymentIdentity(identities),
      bridgeProgram:hex(base58Decode(identities.manager)),transceiverProgram:hex(base58Decode(identities.transceiver)),mint:hex(base58Decode(identities.mint)),burnPublicKey:publicKey};
    const context=validateBurnContext({environment:'mainnet',deployment,policyEpoch:1,keyEpoch:1,attesters:attesters.map(v=>hex(base58Decode(v)))}),feePayerHex=hex(base58Decode(feePayer));
    mkdirSync(root,{recursive:false});
    const store=(name,role,purpose,source)=>{
      const payload=Buffer.from(source),options={root:path.join(root,name),repoRoot,context:{role,purpose,serviceSid:sid,environment:'mainnet',
        nativeGenesis:NATIVE_MAINNET_GENESIS,solanaDeployment:deployment.solanaDeployment,instanceId:randomBytes(32).toString('hex'),keyEpoch:1}};
      try{WindowsProtectedStore.create(options,payload).close();return options;}finally{payload.fill(0);}
    };
    const journal=initialBurnJournal({...deployment,destination:'01'.repeat(32),nonce:'02'.repeat(32)},{context,feePayerHex});
    const stores={burnKey:store('burn-key','BURN_SIGNER','native-burn-key',burnSecret),burnState:store('burn-state','BURN_SIGNER','native-burn-authorizations',initialBurnAuthorizations(publicKey)),
      journal:store('journal','BRIDGE_VALIDATOR','burn-operations',Buffer.from(JSON.stringify(journal))),payer:store('payer','FEE_PAYER','fee-payer-seed',imports.solanaPayer)};
    for(const [i,role] of ['ATTESTER_A','ATTESTER_B'].entries()){
      stores['attesterKey'+i]=store('attester-key-'+i,role,'attester-seed',imports[['attesterA','attesterB'][i]]);
      stores['attesterState'+i]=store('attester-state-'+i,role,'burn-attester-authorizations',initialBurnAttesterState(context,role));
    }
    return {state:'PROTECTED_KEYS_AND_PAUSED_JOURNAL_PROGRAM_VERIFICATION_PENDING',context,feePayerHex,stores,
      nativeRpcStore:store('native-rpc','NATIVE_OBSERVER','native-rpc-auth',imports.nativeRpc),
      solanaRpcStore:store('solana-rpc','BRIDGE_VALIDATOR','solana-rpc-url',imports.solanaRpc),accessTokenStore:store('service-auth','BRIDGE_VALIDATOR','service-auth',token),
      operationalFeeAddress:burnOperationalDestination(deployment).address,depositAddressesIssued:0,transactionsSubmitted:0,
      offlineRecoveryBackup:'NOT_PROVISIONED',productionReady:false,mainnetActivation:'DISABLED'};
  }finally{burnSecret.fill(0);token.fill(0);}
}
