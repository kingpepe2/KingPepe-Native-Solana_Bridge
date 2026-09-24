// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,rmSync,statSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {schnorr} from '@noble/curves/secp256k1.js';
import {WindowsProtectedStore,windowsCurrentServiceSid,normalizeProtectedContext} from '../../shared/windows/protected-store.mjs';
import {initialBurnAuthorizations,ProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {ProtectedBurnJournal} from '../../services/bridge-validator/protected-burn-journal.mjs';
import {initialBurnJournal,issueBurnDeposit} from '../../services/bridge-validator/burn-journal-state.mjs';
import {REGTEST_GENESIS} from '../../native/node/native-raw-evidence.mjs';
if(process.platform!=='win32')throw new Error('WINDOWS_BURN_PROTECTION_TEST_REQUIRES_WINDOWS');
const repoRoot=path.resolve(import.meta.dirname,'../..'),sid=windowsCurrentServiceSid();
const h=n=>n.toString(16).padStart(2,'0').repeat(32);
test('DPAPI burn key and forward journal remain encrypted, role-bound and recoverable under the same account',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-burn-protection-')),seed=schnorr.utils.randomSecretKey();
  const publicKeyHex=Buffer.from(schnorr.getPublicKey(seed)).toString('hex');
  const binding={protocolId:1,nativeNetwork:8000111,nativeGenesis:REGTEST_GENESIS,solanaGenesis:h(2),solanaDeployment:h(8),bridgeProgram:h(3),transceiverProgram:h(4),mint:h(5),destination:h(6),burnPublicKey:publicKeyHex,nonce:h(7)};
  const context=(role,purpose)=>({role,purpose,serviceSid:sid,environment:'localnet',nativeGenesis:REGTEST_GENESIS,solanaDeployment:binding.solanaDeployment,instanceId:randomBytes(32).toString('hex'),keyEpoch:1});
  const options=(name,role,purpose)=>({root:path.join(root,name),repoRoot,context:context(role,purpose)});
  const keyOptions=options('burn-key','BURN_SIGNER','native-burn-key'),authOptions=options('authorizations','BURN_SIGNER','native-burn-authorizations');
  const journalOptions=options('journal','BRIDGE_VALIDATOR','burn-operations');
  let signer,journal;
  t.after(async()=>{await signer?.close();await journal?.close();seed.fill(0);
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('kingpepe-burn-protection-'));
    rmSync(root,{recursive:true});});
  const key=WindowsProtectedStore.create(keyOptions,seed),authorizations=WindowsProtectedStore.create(authOptions,initialBurnAuthorizations(publicKeyHex));
  const initial=initialBurnJournal(binding);initial.paused=false;initial.pauseReason='TEST_REVIEWED';
  const store=WindowsProtectedStore.create(journalOptions,Buffer.from(JSON.stringify(initial)));
  signer=await ProtectedNativeBurnSigner.open({keyStore:key,authorizationStore:authorizations});
  journal=await ProtectedBurnJournal.open(store);
  assert.equal(signer.publicKeyHex,publicKeyHex);
  assert.throws(()=>signer.sign({binding,plan:{},admission:{}}),/VerifiedBurnDepositAdmissionRequired/);
  const operation=journal.update(state=>issueBurnDeposit(state,binding,21));
  assert.equal(journal.read().operations[0].operationId,operation.operationId);
  // The exclusive lease deliberately prevents file reads while held. Close the
  // stores before inspecting their encrypted at-rest files, then reopen below.
  await signer.close();await journal.close();signer=null;journal=null;
  const allFiles=directory=>readdirSync(directory).flatMap(name=>{const file=path.join(directory,name);return statSync(file).isDirectory()?allFiles(file):[file];});
  for(const file of allFiles(root)){
    const contents=readFileSync(file);assert.equal(contents.includes(Buffer.from(seed)),false);assert.equal(contents.includes(Buffer.from(seed).toString('hex')),false);
  }
  assert.throws(()=>normalizeProtectedContext({...keyOptions.context,role:'BRIDGE_VALIDATOR'}),/RolePurpose/);
  signer=await ProtectedNativeBurnSigner.open({keyStore:new WindowsProtectedStore(keyOptions),authorizationStore:new WindowsProtectedStore(authOptions)});
  journal=await ProtectedBurnJournal.open(new WindowsProtectedStore(journalOptions));
  assert.equal(signer.publicKeyHex,publicKeyHex);
  assert.equal(journal.read().operations[0].depositAddress,operation.depositAddress);
  assert.equal(journal.read().operations[0].binding.destination,binding.destination);
  journal.pause('TEST_PAUSE');assert.equal(journal.read().paused,true);
  // Same-account storage/ACL recovery is proven here. Actual runtime isolation
  // needs separate evidence; this does not certify server-loss recovery.
});
