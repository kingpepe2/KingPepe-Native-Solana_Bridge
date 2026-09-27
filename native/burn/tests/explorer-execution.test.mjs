// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Exercises the release overlay with public, synthetic wallet/API fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {base58,bech32m} from '@scure/base';
import {burnFixture} from './burn-fixture.mjs';
import {executionBudget} from '../../../services/bridge-validator/execution-funding-state.mjs';
import {executionDigest,executionPaymentMessage,executionUnsignedTransaction} from '../../../services/bridge-validator/execution-funding-wire.mjs';
import {EXECUTION_RECIPIENT,EXECUTION_GENESIS} from '../../../integrations/explorer/web/bridge-execution.js';
const mint='4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW';
function stage(t){
 const root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-explorer-funding-')),overlay=path.resolve(import.meta.dirname,'../../../integrations/explorer');
 cpSync(path.join(overlay,'support'),root,{recursive:true});for(const dir of ['src','web'])cpSync(path.join(overlay,dir),path.join(root,dir),{recursive:true});
 mkdirSync(path.join(root,'web/bridge-vendor'),{recursive:true});writeFileSync(path.join(root,'package.json'),' {"type":"module"}');
 writeFileSync(path.join(root,'web/bridge-vendor/base.js'),`export {base58,bech32,bech32m} from ${JSON.stringify(import.meta.resolve('@scure/base'))};`);
 writeFileSync(path.join(root,'web/bridge-mainnet.js'),`export const OFFICIAL_KPEPE_MINT=${JSON.stringify(mint)},MAINNET_BASELINE_SOURCE='TEST_BASELINE';`);
 writeFileSync(path.join(root,'web/bridge-vendor/wallets.js'),'export const getWallets=()=>globalThis.__kingpepeTestWalletRegistry;');
 writeFileSync(path.join(root,'src/config.js'),`export const SECURITY={trustCloudflareIP:false,rateWindowMs:60000,rateMax:100,burst:10,corsAllowOrigins:[],maxResponseBytes:65536,requestTimeoutMs:1000};`);
 t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('kingpepe-explorer-funding-'));rmSync(root,{recursive:true});});return root;
}
function fixture(t){
 const f=burnFixture();t.after(f.destroy);const destination=base58.encode(Buffer.from(f.binding.destination,'hex'));
 const budget=executionBudget({rents:{0:'650240',73:'1021080',165:'1488440',211:'1722120',240:'1869440'},fees:{single:'5000',receipt:'15000',payment:'5000',refund:'5000'},ataExists:true});
 const quote={version:1,operationId:f.id,destination,recipient:EXECUTION_RECIPIENT,genesis:EXECUTION_GENESIS,createdAt:Date.now(),createdSlot:100,recentBlockhash:base58.encode(new Uint8Array(32).fill(22)),lastValidBlockHeight:'300',amountLamports:budget.depositLamports,budget};quote.quoteId=executionDigest(quote);quote.unsignedTransactionBase64=executionUnsignedTransaction(executionPaymentMessage(quote));
 const executionFunding={policy:'USER_FUNDED',status:'AWAITING_EXECUTION_FUNDING',burnCommitted:false,fundedLamports:'0',actualCostLamports:'0',refundedLamports:'0',remainderLamports:'0',operatorContributionLamports:'0',expiresAt:null,paymentSignatures:[],refundSignatures:[],quote,depositAddressIssued:false};
 const op={operationId:f.id,direction:'NativeToSolana',state:'AWAITING_EXECUTION_FUNDING',destination,depositAddress:null,amountAtomic:null,depositTxid:null,depositConfirmations:0,requiredDepositConfirmations:12,burnTxid:null,burnAmountAtomic:null,burnConfirmations:null,requiredBurnConfirmations:12,solanaSignature:null,mint,exception:null,retired:false,executionFunding};
 const status={architecture:'ONE_WAY_AUTOMATIC_BURN_AND_MINT',state:'ACTIVE',environment:'mainnet',nativeNetwork:'MAINNET',kingpepeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',productionReady:true,mainnetActivation:'ENABLED',decimals:8,symbol:'KPEPE',mint,bridgeFeeAtomic:'0',nativeDepositConfirmations:12,nativeBurnConfirmations:12,executionPolicy:'USER_FUNDED',executionFundingReady:true,depositAmountModel:'EXACT_RECEIVED',minimumDepositAtomic:'330',
 supply:{state:'READY',source:'CANONICAL_COMPLETED_FINALIZED_NATIVE_BURN_MINT_ACCOUNTING',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',mint,decimals:8,maxSupplyAtomic:'2100000000000000',bridgedSupplyAtomic:'0',remainingSupplyAtomic:'2100000000000000',liveMintSupplyAtomic:'0',observedAt:Date.now()}};
 return {f,op,status,quote};
}
test('production gateway carries pending funding without issuing an address and binds payment callbacks to their operation',async t=>{
 const root=stage(t),{f,op,status}=fixture(t),{createBridgeGateway}=await import(pathToFileURL(path.join(root,'src/bridge.js')).href);const calls=[];
 const network={environment:'mainnet',kingpepeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',test:false,activationAllowed:true};
 const validators={network,mint,executionRecipient:EXECUTION_RECIPIENT,executionGenesis:EXECUTION_GENESIS,publicKey:v=>assert.equal(base58.decode(v).length,32),signature:v=>assert.equal(base58.decode(v).length,64),nativeAddress:v=>assert.equal(bech32m.decode(v).prefix,'kpepe'),operationId:()=>f.id,operationBinding:(value,input)=>assert.equal(value.destination,input.destination)};
 const client={getBridgeStatus:async()=>status,getOperationStatus:async()=>op,createOperation:async()=>op,refreshExecutionQuote:async(id,input)=>{calls.push({id,input});return op;},verifyExecutionPayment:async(id,input)=>{calls.push({id,input});return op;}};
 const gateway=createBridgeGateway({backend:async()=>({client,validators})}),server=createServer((req,res)=>void gateway(req,res,new URL(req.url,'http://127.0.0.1')));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const endpoint=`http://127.0.0.1:${server.address().port}/api/v1/bridge`,post=(route,body,origin='https://kingpepe.net')=>fetch(endpoint+route,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 const created=await post('/operations',{clientNonce:f.binding.nonce,destination:op.destination,walletChain:'solana:mainnet'});assert.equal(created.status,200);const value=await created.json();assert.equal(value.depositAddress,null);assert.equal(value.executionFunding.quote.recipient,EXECUTION_RECIPIENT);
 const signature=base58.encode(new Uint8Array(64).fill(7));assert.equal((await post(`/operations/${f.id}/execution-payment`,{signature,destination:EXECUTION_RECIPIENT})).status,400);assert.equal(calls.length,0);
 assert.equal((await post(`/operations/${f.id}/execution-payment`,{signature},'https://untrusted.invalid')).status,403);
 status.state='PENDING';status.productionReady=false;status.mainnetActivation='DISABLED';status.supply={state:'UNAVAILABLE',reason:'ACCOUNTING_NOT_VERIFIED',environment:'mainnet'};
 assert.equal((await post(`/operations/${f.id}/execution-payment`,{signature})).status,200);assert.deepEqual(calls,[{id:f.id,input:{signature}}]);
 assert.equal((await post(`/operations/${f.id}/execution-quote`,{})).status,409);
});
class Element {
 constructor(){this.children=[];this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.dataset={};this.nodes=new Map();}
 set innerHTML(text){this.html=text;for(const match of text.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/gu)){const e=new Element();e.hidden=/\bhidden\b/u.test(match[0]);e.disabled=/\bdisabled\b/u.test(match[0]);this.nodes.set('#'+match[1],e);}}
 get innerHTML(){return this.html;}
 querySelector(id){return this.nodes.get(id)??null;}
 replaceChildren(...rows){this.children=rows;}
 append(...rows){this.children.push(...rows);}
 setAttribute(){}
}
test('actual Bridge UI requires explicit Phantom payment before revealing a Native address; rejection is safe',async t=>{
 const root=stage(t),{f,op,status,quote}=fixture(t),view=new Element(),storage=new Map(),walletCalls=[];let reject=true,requests=0;
 const account={address:op.destination,publicKey:Uint8Array.from(Buffer.from(f.binding.destination,'hex')),chains:['solana:mainnet']};
 const wallet={name:'Phantom',chains:['solana:mainnet'],features:{'standard:connect':{connect:async()=>({accounts:[account]})},'standard:events':{on:()=>()=>{}},'solana:signAndSendTransaction':{signAndSendTransaction:async input=>{walletCalls.push(input);if(reject)throw Object.assign(Error('Cancelled'),{code:4001});return [{signature:new Uint8Array(64).fill(7)}];}}}};
 const globals={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,__kingpepeTestWalletRegistry:globalThis.__kingpepeTestWalletRegistry};
 Object.assign(globalThis,{document:{title:'Test',createElement:()=>new Element(),querySelector:()=>null,getElementById:()=>null,addEventListener(){},removeEventListener(){}},window:{location:{origin:'https://kingpepe.net',pathname:'/bridge',hash:''},scrollTo(){},addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},__kingpepeTestWalletRegistry:{get:()=>[wallet],on:()=>()=>{}}});
 let dispose;t.after(()=>{dispose?.();for(const [k,v] of Object.entries(globals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
  const route=String(url).replace('/api/v1/bridge','');let value;
  if(route==='/status')value=status;
  else if(route.startsWith('/balances/'))value={address:op.destination,chain:'solana:mainnet',mint,decimals:8,solLamports:'1000000000',kpepeAtomic:'0',tokenAccounts:[],commitment:'finalized'};
  else if(route==='/operations'){requests++;value=op;}
  else if(route.endsWith('/execution-quote'))value=op;
  else if(route.endsWith('/execution-payment')){const input=JSON.parse(options.body);op.executionFunding={...op.executionFunding,status:'PAID_VERIFIED',fundedLamports:quote.amountLamports,remainderLamports:quote.amountLamports,paymentSignatures:[input.signature],quote:null,depositAddressIssued:true};op.state='DEPOSIT_ADDRESS_ISSUED';op.depositAddress=bech32m.encode('kpepe',[1,...bech32m.toWords(new Uint8Array(32).fill(9))]);value=op;}
  else value=op;return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 });
 const {renderBridge}=await import(pathToFileURL(path.join(root,'web/bridge.js')).href);dispose=renderBridge(view);
 const wait=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(r=>setTimeout(r,5));assert(predicate(),'UI fixture did not reach expected state');};
 await wait(()=>!!view.children[0]?.querySelector('#br-pay'));const page=view.children[0],get=n=>page.querySelector('#br-'+n);
 get('connect').onclick();assert.equal(get('wallets').children.length,1);get('wallets').children[0].onclick();
 await wait(()=>requests===1&&!get('pay').disabled);assert.equal(get('deposit').hidden,true);assert.match(get('execution-cost').textContent,/0\.005678720 SOL/u);assert.equal(walletCalls.length,0);
 get('pay').onclick();await wait(()=>walletCalls.length===1&&!get('pay').disabled);assert.match(get('notice').textContent,/cancelled/u);assert.equal(get('deposit').hidden,true);assert.equal(requests,1);
 reject=false;get('pay').onclick();await wait(()=>get('deposit').hidden===false);
 assert.equal(walletCalls.length,2);assert(Buffer.from(walletCalls[1].transaction).equals(Buffer.from(quote.unsignedTransactionBase64,'base64')));assert.equal(get('execution-status').textContent,'Execution funding: PAID / VERIFIED');assert.equal(requests,1);assert.equal(get('destination-address').textContent,account.address);
});
