// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic isolated identities; never production key generation or RPC.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {ed25519} from '@noble/curves/ed25519.js';
import {prepareMainnetBurnStores} from '../../services/bridge-validator/mainnet-burn-preparation.mjs';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {ProtectedBurnJournal} from '../../services/bridge-validator/protected-burn-journal.mjs';
import {ProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {base58Encode} from '../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
test('dedicated-identity preparation preserves supplied payer/attesters, creates no operation and cannot replace existing custody',async t=>{
  const parent=mkdtempSync(path.join(os.tmpdir(),'kingpepe-test-custody-')),sid=windowsCurrentServiceSid(),repoRoot=path.resolve(import.meta.dirname,'../..');
  const seeds=Array.from({length:6},()=>Buffer.from(ed25519.utils.randomSecretKey())),pub=s=>base58Encode(ed25519.getPublicKey(s));
  t.after(()=>{seeds.forEach(s=>s.fill(0));assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert(path.basename(parent).startsWith('kingpepe-test-custody-'));rmSync(parent,{recursive:true});});
  t.mock.method(globalThis,'fetch',async()=>{throw Error('NO_NETWORK_IN_CUSTODY_TEST');});
  const options={root:path.join(parent,'state'),repoRoot,expectedServiceSid:sid,explorerSid:'S-1-5-21-100-100-100-100',
    identities:{manager:pub(seeds[0]),transceiver:pub(seeds[1]),mint:pub(seeds[2])},feePayer:pub(seeds[3]),attesters:[pub(seeds[4]),pub(seeds[5])],
    imports:{solanaPayer:seeds[3],attesterA:seeds[4],attesterB:seeds[5],nativeRpc:Buffer.from(JSON.stringify({endpoint:'http://127.0.0.1:18443/',username:'TEST',password:randomBytes(32).toString('hex')})),solanaRpc:Buffer.from('https://custody-test.invalid.example/')}};
  assert.throws(()=>prepareMainnetBurnStores({...options,explorerSid:sid}),/Rejected/);assert(!existsSync(options.root));
  assert.throws(()=>prepareMainnetBurnStores({...options,feePayer:pub(seeds[0])}),/Rejected/);assert(!existsSync(options.root));
  assert.throws(()=>prepareMainnetBurnStores({...options,imports:{...options.imports,nativeRpc:Buffer.from(JSON.stringify({endpoint:'http://127.0.0.1:18443/',username:'invalid:user',password:'TEST'}))}}),/Rejected/);assert(!existsSync(options.root));
  const prepared=prepareMainnetBurnStores(options);assert.equal(prepared.productionReady,false);assert.equal(prepared.offlineRecoveryBackup,'NOT_PROVISIONED');
  assert.equal(prepared.depositAddressesIssued,0);assert.match(prepared.operationalFeeAddress,/^kpepe1p/u);
  const journal=await ProtectedBurnJournal.open(new WindowsProtectedStore(prepared.stores.journal));
  try{assert.equal(journal.read().paused,true);assert.equal(journal.read().mainnetControl.mode,'PREPARED');assert.deepEqual(journal.read().operations,[]);}finally{await journal.close();}
  const signer=await ProtectedNativeBurnSigner.open({keyStore:new WindowsProtectedStore(prepared.stores.burnKey),authorizationStore:new WindowsProtectedStore(prepared.stores.burnState)});
  try{assert.equal(signer.publicKeyHex,prepared.context.deployment.burnPublicKey);}finally{await signer.close();}
  assert.throws(()=>prepareMainnetBurnStores(options),/Rejected/);
  options.imports.nativeRpc.fill(0);options.imports.solanaRpc.fill(0);
});
