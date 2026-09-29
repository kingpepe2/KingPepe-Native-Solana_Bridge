// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// The public gateway publishes the runtime's minimum; it never sets its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {base58,bech32m} from '@scure/base';
import {burnFixture} from './burn-fixture.mjs';
import {EXECUTION_RECIPIENT,EXECUTION_GENESIS} from '../../../integrations/explorer/web/bridge-execution.js';
const mint='4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW',MINIMUM='100000000000';
function stage(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-explorer-minimum-')),overlay=path.resolve(import.meta.dirname,'../../../integrations/explorer');
 cpSync(path.join(overlay,'support'),root,{recursive:true});for(const dir of ['src','web'])cpSync(path.join(overlay,dir),path.join(root,dir),{recursive:true});
 mkdirSync(path.join(root,'web/bridge-vendor'),{recursive:true});writeFileSync(path.join(root,'package.json'),' {"type":"module"}');
 writeFileSync(path.join(root,'web/bridge-vendor/base.js'),`export {base58,bech32,bech32m} from ${JSON.stringify(import.meta.resolve('@scure/base'))};`);
 writeFileSync(path.join(root,'web/bridge-mainnet.js'),`export const OFFICIAL_KPEPE_MINT=${JSON.stringify(mint)},MAINNET_BASELINE_SOURCE='TEST_BASELINE';`);
 writeFileSync(path.join(root,'src/config.js'),`export const SECURITY={trustCloudflareIP:false,rateWindowMs:60000,rateMax:100,burst:10,corsAllowOrigins:[],maxResponseBytes:65536,requestTimeoutMs:1000};`);
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('kingpepe-explorer-minimum-'));rmSync(root,{recursive:true});});return root;
}
test('the gateway publishes the runtime minimum and a held deposit exactly as the runtime reports them',async t=>{
 const root=stage(t),f=burnFixture();t.after(f.destroy);const {createBridgeGateway}=await import(pathToFileURL(path.join(root,'src/bridge.js')).href);
 const destination=base58.encode(Buffer.from(f.binding.destination,'hex')),depositAddress=bech32m.encode('kpepe',[1,...bech32m.toWords(new Uint8Array(32).fill(9))]);
 const status={architecture:'ONE_WAY_AUTOMATIC_BURN_AND_MINT',state:'ACTIVE',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',
  productionReady:true,mainnetActivation:'ENABLED',decimals:8,symbol:'KPEPE',mint,bridgeFeeAtomic:'0',nativeDepositConfirmations:12,nativeBurnConfirmations:12,
  executionPolicy:'LEGACY_OPERATOR_FUNDED',executionFundingReady:true,depositAmountModel:'EXACT_RECEIVED',minimumDepositAtomic:MINIMUM,reserveCommittedLamports:'0',reserveActiveCommitments:0,maxConcurrentExecutingOperations:1,executionSlot:'AVAILABLE',
  supply:{state:'READY',source:'CANONICAL_COMPLETED_FINALIZED_NATIVE_BURN_MINT_ACCOUNTING',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',mint,decimals:8,
   maxSupplyAtomic:'2100000000000000',bridgedSupplyAtomic:'0',remainingSupplyAtomic:'2100000000000000',liveMintSupplyAtomic:'0',observedAt:Date.now()}};
 const op={operationId:f.id,direction:'NativeToSolana',state:'DEPOSIT_FINALIZED',destination,depositAddress,amountAtomic:'99900000000',depositTxid:'ab'.repeat(32),depositConfirmations:12,
  requiredDepositConfirmations:12,burnTxid:null,burnAmountAtomic:null,burnConfirmations:null,requiredBurnConfirmations:12,solanaSignature:null,mint,exception:null,retired:false,
  minimumDepositAtomic:MINIMUM,depositBelowMinimum:true,remainingDepositAtomic:'100000000',reserveCommitted:false,executionSlot:'NOT_REQUESTED'};
 const network={environment:'mainnet',kingpepeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',test:false,activationAllowed:true};
 const validators={network,mint,executionRecipient:EXECUTION_RECIPIENT,executionGenesis:EXECUTION_GENESIS,publicKey:v=>assert.equal(base58.decode(v).length,32),signature:v=>assert.equal(base58.decode(v).length,64),
  nativeAddress:v=>assert.equal(bech32m.decode(v).prefix,'kpepe'),operationId:()=>f.id,operationBinding:()=>{}};
 const client={getBridgeStatus:async()=>status,getOperationStatus:async()=>op};
 const gateway=createBridgeGateway({backend:async()=>({client,validators})}),server=createServer((req,res)=>void gateway(req,res,new URL(req.url,'http://127.0.0.1')));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const get=async route=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/bridge${route}`);return {status:response.status,body:await response.json().catch(()=>null)};};
 let published=await get('/status');assert.equal(published.status,200);
 assert.equal(published.body.minimumDepositAtomic,MINIMUM);assert.equal(published.body.bridgeFeeAtomic,'0');assert.equal(published.body.executionPolicy,'LEGACY_OPERATOR_FUNDED');
 // Internal reserve bookkeeping is not part of the public status.
 assert.equal(Object.hasOwn(published.body,'reserveCommittedLamports'),false);assert.equal(Object.hasOwn(published.body,'reserveActiveCommitments'),false);
 let shown=await get('/operations/'+f.id);assert.equal(shown.status,200);
 assert.equal(shown.body.depositBelowMinimum,true);assert.equal(shown.body.minimumDepositAtomic,MINIMUM);assert.equal(shown.body.remainingDepositAtomic,'100000000');
 assert.equal(shown.body.amountAtomic,'99900000000');assert.equal(shown.body.burnTxid,null);assert.equal(Object.hasOwn(shown.body,'reserveCommitted'),false);
 // A held deposit can never be shown as burned, minted or miscounted.
 for(const change of [{burnTxid:'cd'.repeat(32)},{solanaSignature:base58.encode(new Uint8Array(64).fill(7))},{remainingDepositAtomic:'0'},{remainingDepositAtomic:'100000001'},
  {depositBelowMinimum:'yes'},{minimumDepositAtomic:'0'},{amountAtomic:null}]){
  Object.assign(op,change);assert.notEqual((await get('/operations/'+f.id)).status,200,JSON.stringify(change));
  Object.assign(op,{burnTxid:null,solanaSignature:null,remainingDepositAtomic:'100000000',depositBelowMinimum:true,minimumDepositAtomic:MINIMUM,amountAtomic:'99900000000'});
 }
 Object.assign(op,{amountAtomic:MINIMUM,depositBelowMinimum:false,remainingDepositAtomic:'0'});
 shown=await get('/operations/'+f.id);assert.equal(shown.status,200);assert.equal(shown.body.depositBelowMinimum,false);
 Object.assign(op,{remainingDepositAtomic:'1'});assert.notEqual((await get('/operations/'+f.id)).status,200);
 Object.assign(op,{remainingDepositAtomic:'0'});
 // Busy is public; whose operation is executing is not.
 assert.equal(published.body.executionSlot,'AVAILABLE');assert.equal(published.body.maxConcurrentExecutingOperations,1);
 status.executionSlot='BRIDGE_BUSY';assert.equal((await get('/status')).body.executionSlot,'BRIDGE_BUSY');
 for(const change of [{executionSlot:'BUSY'},{executionSlot:null},{maxConcurrentExecutingOperations:2},{maxConcurrentExecutingOperations:undefined}]){
  const before={executionSlot:status.executionSlot,maxConcurrentExecutingOperations:status.maxConcurrentExecutingOperations};Object.assign(status,change);
  assert.notEqual((await get('/status')).status,200,JSON.stringify(change));Object.assign(status,before);}
 Object.assign(op,{executionSlot:'WAITING_FOR_EXECUTION_SLOT'});shown=await get('/operations/'+f.id);assert.equal(shown.body.executionSlot,'WAITING_FOR_EXECUTION_SLOT');
 // A waiting operation can never be shown as burned, minted or under the minimum.
 for(const change of [{burnTxid:'cd'.repeat(32),burnAmountAtomic:MINIMUM},{solanaSignature:base58.encode(new Uint8Array(64).fill(7))},{depositBelowMinimum:true,amountAtomic:'99900000000',remainingDepositAtomic:'100000000'},{executionSlot:'QUEUED'}]){
  const before=structuredClone(op);Object.assign(op,change);assert.notEqual((await get('/operations/'+f.id)).status,200,JSON.stringify(change));Object.assign(op,before);}
 // A runtime that publishes no minimum is shown with the Native dust floor only.
 delete status.minimumDepositAtomic;published=await get('/status');assert.equal(published.body.minimumDepositAtomic,'330');
 for(const minimumDepositAtomic of ['0','-1',330,'1.5',null]){status.minimumDepositAtomic=minimumDepositAtomic;assert.notEqual((await get('/status')).status,200);}
});
