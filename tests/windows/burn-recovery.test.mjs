// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Ephemeral TEST certificate and Mainnet-shaped synthetic state; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash,X509Certificate} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {exportBurnRecovery,restoreBurnRecovery} from '../../services/bridge-validator/burn-recovery.mjs';
import {verifyRecoveryCertificate} from '../../shared/windows/cms-recovery.mjs';
import {burnFixture} from '../../native/burn/tests/burn-fixture.mjs';
import {initialBurnAuthorizations,ProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {initialBurnAttesterState} from '../../services/attesters/protected-burn-attester.mjs';
import {ProtectedBurnJournal} from '../../services/bridge-validator/protected-burn-journal.mjs';
import {stableJson} from '../../shared/protocol/canonical-message.mjs';
if(process.platform!=='win32')throw Error('WINDOWS_BURN_RECOVERY_REQUIRES_WINDOWS');
const hash=b=>createHash('sha256').update(b).digest('hex');
test('public-certificate CMS export restores signed pending burn under fresh DPAPI roots, paused, with no plaintext snapshot',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-test-recovery-')),f=burnFixture({mainnet:true}),sid=windowsCurrentServiceSid();
  const repoRoot=path.resolve(import.meta.dirname,'../..');
  const openssl=process.env.KINGPEPE_TEST_OPENSSL??path.join(process.env.ProgramFiles,'Git','usr','bin','openssl.exe');
  assert(existsSync(openssl),'Reviewed OpenSSL is required for the real encrypted recovery test');
  const opensslSha256=hash(readFileSync(openssl)),certificateFile=path.join(root,'TEST-public.pem'),testKey=path.join(root,'TEST-private.pem');
  const command=(args,input)=>spawnSync(openssl,args,{input,windowsHide:true,encoding:'buffer',maxBuffer:32*1024*1024,timeout:30000});
  // Only random TEST RSA material; never production recovery key generation.
  let generated=command(['req','-x509','-newkey','rsa:4096','-noenc','-keyout',testKey,'-out',certificateFile,'-sha256','-days','1',
    '-subj','/CN=KINGPEPE-TEST-RECOVERY-ONLY','-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,keyEncipherment']);
  assert.equal(generated.status,0);generated.stdout.fill(0);generated.stderr.fill(0);
  const certificateSha256=hash(new X509Certificate(readFileSync(certificateFile)).raw);
  t.after(()=>{f.destroy();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('kingpepe-test-recovery-'));rmSync(root,{recursive:true});});
  t.mock.method(globalThis,'fetch',async()=>{throw Error('NO_NETWORK_IN_RECOVERY_DRILL');});
  f.finalize();f.state.paused=true;f.state.pauseReason='TEST_RECOVERY_CAPTURE';
  const signer=JSON.parse(initialBurnAuthorizations(f.binding.burnPublicKey));
  signer.authorizations.push({binding:f.binding,operationId:f.id,plan:f.plan,planDigest:hash(JSON.stringify(f.plan)),signedHex:f.state.operations[0].signedBurnHex});
  const store=(name,role,purpose,payload)=>{
    const options={root:path.join(root,name),repoRoot,context:{role,purpose,serviceSid:sid,environment:'mainnet',nativeGenesis:f.binding.nativeGenesis,
      solanaDeployment:f.binding.solanaDeployment,instanceId:randomBytes(32).toString('hex'),keyEpoch:1}};
    try{WindowsProtectedStore.create(options,payload).close();}finally{payload.fill(0);}return options;
  };
  const stores={burnKey:store('burn-key','BURN_SIGNER','native-burn-key',Buffer.from(f.root)),burnState:store('burn-state','BURN_SIGNER','native-burn-authorizations',Buffer.from(JSON.stringify(signer))),
    journal:store('journal','BRIDGE_VALIDATOR','burn-operations',Buffer.from(JSON.stringify(f.state))),payer:store('payer','FEE_PAYER','fee-payer-seed',Buffer.from(f.payer))};
  for(const [i,role] of ['ATTESTER_A','ATTESTER_B'].entries()){
    stores['attesterKey'+i]=store('attester-key-'+i,role,'attester-seed',Buffer.from(f.attesters[i]));
    const state=JSON.parse(initialBurnAttesterState(f.context,role));state.records.push({operationId:f.id,binding:f.binding,planDigest:hash(stableJson(f.plan)),
      depositKey:`${f.deposit.txid}:0`,burnKey:`${f.plan.txid}:0`,amountAtomic:f.deposit.amountAtomic,messageHex:null,attestation:null});
    stores['attesterState'+i]=store('attester-state-'+i,role,'burn-attester-authorizations',Buffer.from(JSON.stringify(state)));
  }
  const configuration={runtime:{stores,policy:f.policy,solanaEndpoint:'ENV:SOLANA_MAINNET_RPC_URL',
    nativeVerifierExecutable:path.join(root,'unused-test-verifier.exe'),feePolicy:{},
    nativeRpcStore:store('native-rpc','NATIVE_OBSERVER','native-rpc-auth',Buffer.from(JSON.stringify({endpoint:'http://127.0.0.1:18443',username:'TEST',password:randomBytes(32).toString('hex')}))),
    solanaRpcStore:store('solana-rpc','BRIDGE_VALIDATOR','solana-rpc-url',Buffer.from('https://test-recovery.invalid.example/'))},
    accessTokenStore:store('token','BRIDGE_VALIDATOR','service-auth',randomBytes(32)),port:54012,intervalMs:1000,productionReady:false,mainnetActivation:'DISABLED'};
  const options={configuration,sourceSha:'12'.repeat(20),certificateFile,certificateSha256,openssl,opensslSha256};
  assert.throws(()=>verifyRecoveryCertificate({certificateFile,certificateSha256:'00'.repeat(32)}),/Rejected/);
  await assert.rejects(exportBurnRecovery({...options,opensslSha256:'00'.repeat(32)}),/Rejected/);
  const encrypted=await exportBurnRecovery(options);assert.equal(encrypted.receipt.offlineCopy,'NOT_PROVISIONED');
  assert.equal(encrypted.receipt.plaintextWrittenToFile,false);assert.equal(encrypted.receipt.recoveryPrivateMaterialReceived,false);
  assert.equal(encrypted.receipt.operations,1);
  const printed=command(['cms','-cmsout','-inform','DER','-print'],encrypted.ciphertext);
  assert.equal(printed.status,0);const structure=printed.stdout.toString('utf8');
  assert.match(structure,/id-smime-ct-authEnvelopedData/);assert.match(structure,/aes-256-gcm/);assert.match(structure,/rsaesOaep/);assert.match(structure,/sha256/);
  printed.stdout.fill(0);printed.stderr.fill(0);
  const decrypted=command(['cms','-decrypt','-binary','-inform','DER','-recip',certificateFile,'-inkey',testKey],encrypted.ciphertext);
  assert.equal(decrypted.status,0);const plaintext=decrypted.stdout;
  try{
    assert.equal(hash(plaintext),encrypted.receipt.plaintextSha256);
    const restored=restoreBurnRecovery({plaintext,expectedPlaintextSha256:encrypted.receipt.plaintextSha256,root:path.join(root,'replacement'),repoRoot});
    assert.equal(restored.recoveryState,'PAUSED_CHAIN_REVIEW_REQUIRED');assert.equal(restored.burnPublicKey,f.binding.burnPublicKey);
    assert.equal(restored.productionReady,false);assert.equal(restored.operations,1);
    const journal=await ProtectedBurnJournal.open(new WindowsProtectedStore(restored.configuration.runtime.stores.journal));
    try{const s=journal.read();assert.equal(s.paused,true);assert.equal(s.pauseReason,'RECOVERY_CHAIN_REVIEW_REQUIRED');
      assert.deepEqual(s.operations,f.state.operations);assert.deepEqual(s.mainnetControl,f.state.mainnetControl);}finally{await journal.close();}
    const signing=await ProtectedNativeBurnSigner.open({keyStore:new WindowsProtectedStore(restored.configuration.runtime.stores.burnKey),authorizationStore:new WindowsProtectedStore(restored.configuration.runtime.stores.burnState)});
    try{assert.equal(signing.inspect(f.id).signedHex,f.state.operations[0].signedBurnHex);}finally{await signing.close();}
    assert.throws(()=>restoreBurnRecovery({plaintext,expectedPlaintextSha256:encrypted.receipt.plaintextSha256,root:path.join(root,'replacement'),repoRoot}),/ExistingDestination/);
    const changed=Buffer.from(plaintext);changed[changed.length-2]^=1;
    try{assert.throws(()=>restoreBurnRecovery({plaintext:changed,expectedPlaintextSha256:encrypted.receipt.plaintextSha256,root:path.join(root,'bad'),repoRoot}),/DigestMismatch/);}finally{changed.fill(0);}
  }finally{plaintext.fill(0);decrypted.stderr.fill(0);}
  const tampered=Buffer.from(encrypted.ciphertext);tampered[tampered.length-1]^=1;
  const denied=command(['cms','-decrypt','-binary','-inform','DER','-recip',certificateFile,'-inkey',testKey],tampered);
  assert.notEqual(denied.status,0);denied.stdout.fill(0);denied.stderr.fill(0);tampered.fill(0);encrypted.ciphertext.fill(0);
  assert(!readdirSync(root).some(name=>/snapshot|plaintext/u.test(name)));
});
