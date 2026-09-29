// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Gateway tests for the address-request timeout. The staged gateway and client
// run against a scripted runtime on loopback. No Bridge, no chain, no keys.
import {stageProduction} from './explorer-production-stage.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import path from 'node:path';import fs from 'node:fs';import {pathToFileURL} from 'node:url';import {setTimeout as delay} from 'node:timers/promises';
const {src}=stageProduction(),load=f=>import(pathToFileURL(path.join(src,f)).href);
const {createBridgeGateway}=await load('bridge.js'),{createGatewayBridgeClient,upstreamTimeoutMs,CREATE_OPERATION_TIMEOUT_MS,READ_TIMEOUT_MS}=await load('bridge-client.js');
const {base58,bech32m}=await import(pathToFileURL(path.join(src,'../web/bridge-vendor/base.js')).href);
const MINT='4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW',key=n=>base58.encode(new Uint8Array(32).fill(n)),hex=n=>n.toString(16).padStart(2,'0').repeat(32);
const address=n=>bech32m.encode('kpepe',[1,...bech32m.toWords(new Uint8Array(32).fill(n))]);
// As in the Bridge, the identity of a request binds its nonce AND its destination.
const mix=(nonce,wallet)=>(nonce*31+wallet)&0xff,issued=(nonce,wallet=7)=>address(mix(nonce,wallet));
const network={environment:'mainnet',kingpepeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',test:false,activationAllowed:true};
// A scripted runtime: one journal, single flight, an address issued after `latencyMs`.
function runtime({latencyMs=0}={}){
  const state={operations:new Map(),creates:0,created:0,busy:false,latencyMs,requests:[]};
  const status=()=>({architecture:'ONE_WAY_AUTOMATIC_BURN_AND_MINT',state:'ACTIVE',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',productionReady:true,mainnetActivation:'ENABLED',
    decimals:8,symbol:'KPEPE',mint:MINT,bridgeFeeAtomic:'0',nativeDepositConfirmations:12,nativeBurnConfirmations:12,executionPolicy:'LEGACY_OPERATOR_FUNDED',executionFundingReady:true,depositAmountModel:'EXACT_RECEIVED',
    minimumDepositAtomic:'100000000000',reserveCommittedLamports:'0',reserveActiveCommitments:0,maxConcurrentExecutingOperations:1,executionSlot:state.busy?'BRIDGE_BUSY':'AVAILABLE',reserveState:'SUFFICIENT',
    supply:{state:'READY',source:'CANONICAL_COMPLETED_FINALIZED_NATIVE_BURN_MINT_ACCOUNTING',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',mint:MINT,decimals:8,maxSupplyAtomic:'2100000000000000',
      bridgedSupplyAtomic:'0',remainingSupplyAtomic:'2100000000000000',liveMintSupplyAtomic:'0',observedAt:Date.now()}});
  // The identity of a request is its destination and nonce, derived on the server side.
  const identity=input=>{const n=mix(Buffer.from(input.clientNonce,'hex')[0],base58.decode(input.destination)[0]);return {operationId:hex(n),depositAddress:address(n)};};
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):undefined;state.requests.push(req.method+' '+req.url);
    const json=(code,value)=>{if(!res.destroyed){res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));}};
    if(req.headers.authorization!=='Bearer '+'a'.repeat(64))return json(401,{error:'UNAUTHORIZED'});
    if(req.url==='/bridge/status')return json(200,status());
    if(req.method==='GET'&&req.url.startsWith('/operations/')){const op=state.operations.get(req.url.slice(12));return op?json(200,op):json(404,{error:'OPERATION_NOT_FOUND'});}
    if(req.method==='POST'&&req.url==='/operations'){state.creates++;await delay(state.latencyMs);const id=identity(body);
      if(state.operations.has(id.operationId))return json(200,state.operations.get(id.operationId));
      if(state.busy)return json(409,{error:'BRIDGE_BUSY'});
      state.busy=true;state.created++;const op={operationId:id.operationId,direction:'NativeToSolana',state:'DEPOSIT_ADDRESS_ISSUED',destination:body.destination,depositAddress:id.depositAddress,amountAtomic:null,depositTxid:null,depositConfirmations:0,
        requiredDepositConfirmations:12,burnTxid:null,burnAmountAtomic:null,burnConfirmations:null,requiredBurnConfirmations:12,solanaSignature:null,mint:MINT,exception:null,retired:false,
        minimumDepositAtomic:'100000000000',depositBelowMinimum:false,remainingDepositAtomic:'0',reserveCommitted:false,executionSlot:'NOT_REQUESTED'};
      state.operations.set(id.operationId,op);return json(200,op);}
    json(404,{error:'NOT_FOUND'});
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({state,identity,endpoint:'http://127.0.0.1:'+server.address().port,close:()=>{server.closeAllConnections();server.close();}})));
}
// The gateway composed exactly as bridge-backend.js composes it, without the protected token store.
async function gateway(t,options={},gatewayOptions={}){
  const upstream=await runtime(options);
  const read=({endpoint,accessToken,fetchImpl})=>{const get=async route=>{const r=await fetchImpl(new URL(route,endpoint),{method:'GET',headers:{authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(30000)}),v=await r.json();
    if(r.status===404&&v.error==='OPERATION_NOT_FOUND')return null;if(!r.ok)throw Error('RequestNotAccepted');return v;};
    return {getBridgeStatus:()=>get('/bridge/status'),getOperationStatus:id=>get('/operations/'+id)};};
  const client=createGatewayBridgeClient({createReadClient:read,network,endpoint:upstream.endpoint,accessToken:'a'.repeat(64),
    fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(upstreamTimeoutMs(init))])})});
  const validators={network,mint:MINT,publicKey:v=>assert.equal(base58.decode(v).length,32),signature:v=>assert.equal(base58.decode(v).length,64),nativeAddress:v=>assert.equal(bech32m.decode(v).prefix,'kpepe'),
    operationId:input=>upstream.identity(input).operationId,operationBinding:(op,input)=>{assert.equal(op.destination,input.destination);assert.equal(op.depositAddress,upstream.identity(input).depositAddress);}};
  const handler=createBridgeGateway({backend:async()=>({client,validators}),approvedOrigin:'https://kingpepe.net',mutationLimit:100,readLimit:1000,...gatewayOptions});
  const server=http.createServer((req,res)=>void handler(req,res,new URL(req.url,'http://127.0.0.1')));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();upstream.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api/v1/bridge';
  const call=async(route,body)=>{const at=Date.now(),r=await fetch(base+route,body===undefined?{}:{method:'POST',headers:{origin:'https://kingpepe.net','content-type':'application/json'},body:JSON.stringify(body)});
    return {status:r.status,body:await r.json().catch(()=>null),ms:Date.now()-at};};
  return {upstream,call,request:(n,wallet=7)=>({clientNonce:hex(n),destination:key(wallet),walletChain:'solana:mainnet'})};
}

test('the limits: 30 seconds for the one address request, 8 for every read, 32 and 10 at the gateway, none unlimited',()=>{
  assert.equal(CREATE_OPERATION_TIMEOUT_MS,30000);assert.equal(READ_TIMEOUT_MS,8000);
  assert.equal(upstreamTimeoutMs({method:'POST'}),30000);for(const init of [{method:'GET'},{},undefined,{method:'post'}])assert.equal(upstreamTimeoutMs(init),8000);
  for(const mutationTimeoutMs of [Infinity,0,9999,60001,NaN,'32000',null])assert.throws(()=>createBridgeGateway({mutationTimeoutMs}),String(mutationTimeoutMs));
  createBridgeGateway({});createBridgeGateway({mutationTimeoutMs:60000});
  const gatewaySource=fs.readFileSync(path.join(src,'bridge.js'),'utf8'),backend=fs.readFileSync(path.join(src,'bridge-backend.js'),'utf8');
  assert(gatewaySource.includes('timeoutMs = 10000, mutationTimeoutMs = 32000,'));assert(gatewaySource.includes('mutation ? mutationTimeoutMs : timeoutMs'));
  assert(backend.includes('AbortSignal.timeout(upstreamTimeoutMs(init))'));assert.equal(backend.includes('AbortSignal.timeout(8000)'),false);
});
for(const seconds of [5,10,20])test('address creation taking '+seconds+' seconds succeeds, with one address',{concurrency:true},async t=>{
  const g=await gateway(t,{latencyMs:seconds*1000}),r=await g.call('/operations',g.request(9));
  assert.equal(r.status,200,JSON.stringify(r.body));assert(r.ms>=seconds*1000&&r.ms<seconds*1000+4000,String(r.ms));
  assert.equal(r.body.depositAddress,issued(9));assert.equal(r.body.destination,key(7));assert.equal(r.body.state,'DEPOSIT_ADDRESS_ISSUED');assert.equal(r.body.minimumDepositAtomic,'100000000000');
  assert.equal(g.upstream.state.created,1);assert.equal(g.upstream.state.creates,1);
  // Issued: busy for everyone else, who is refused without the runtime being asked to create anything.
  assert.equal((await g.call('/status')).body.executionSlot,'BRIDGE_BUSY');
  const other=await g.call('/operations',g.request(10,8));assert.equal(other.status,409);assert.equal(other.body.code,'BRIDGE_BUSY');assert.deepEqual(Object.keys(other.body).sort(),['code','error','message']);
  assert.equal(g.upstream.state.creates,1);assert.equal(g.upstream.state.created,1);assert.equal(JSON.stringify(other.body).includes(issued(9)),false);
});
test('the timeout is still enforced: a runtime that does not answer in 30 seconds is given up on, within the bound',{concurrency:true},async t=>{
  const g=await gateway(t,{latencyMs:36000}),r=await g.call('/operations',g.request(9));
  assert.notEqual(r.status,200);assert(r.ms>=29000&&r.ms<=33500,String(r.ms));assert.equal(r.body.error,true);assert.equal(JSON.stringify(r.body).includes(issued(9)),false);
  // Reads were never slowed: status answers at once while that request was pending and after it.
  const s=await g.call('/status');assert.equal(s.status,200);assert(s.ms<2000);
  // The address the runtime did create afterwards is returned to the same request identity, not created again.
  await delay(7000);g.upstream.state.latencyMs=0;const again=await g.call('/operations',g.request(9));
  assert.equal(again.status,200);assert.equal(again.body.depositAddress,issued(9));assert.equal(g.upstream.state.created,1);assert.equal(g.upstream.state.creates,1,'recovered through the read path');
});
test('the same request identity always returns the same operation and address, and never a second one',async t=>{
  const g=await gateway(t),first=await g.call('/operations',g.request(9));assert.equal(first.status,200);
  for(let n=0;n<5;n++){const r=await g.call('/operations',g.request(9));assert.equal(r.status,200);assert.deepEqual(r.body,first.body);}
  const together=await Promise.all([1,2].map(()=>g.call('/operations',g.request(9))));for(const r of together){assert.equal(r.status,200);assert.equal(r.body.operationId,first.body.operationId);}
  assert.equal(g.upstream.state.created,1);assert.equal(g.upstream.state.creates,1);assert.equal(g.upstream.state.operations.size,1);
  // A different nonce or wallet is a different request, and is refused while this one holds the Bridge.
  for(const request of [g.request(10),g.request(9,8),g.request(11,8)]){const r=await g.call('/operations',request);assert.equal(r.status,409);assert.equal(r.body.code,'BRIDGE_BUSY');}
  assert.equal(g.upstream.state.created,1);assert.equal(g.upstream.state.operations.size,1);
});
test('two people at the same moment: one address, the other is told the Bridge is busy',async t=>{
  const g=await gateway(t,{latencyMs:1500}),[a,b]=await Promise.all([g.call('/operations',g.request(9)),g.call('/operations',g.request(10,8))]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);assert.equal([a,b].find(r=>r.status===409).body.code,'BRIDGE_BUSY');assert.equal(g.upstream.state.created,1);
});
test('requests waiting for an address never take the slots that status and tracking need',async t=>{
  const g=await gateway(t,{latencyMs:3000}),waiting=[g.call('/operations',g.request(9)),g.call('/operations',g.request(10,8))];await delay(500);
  const third=await g.call('/operations',g.request(11,6));assert.equal(third.status,429);
  for(let n=0;n<6;n++){const s=await g.call('/status');assert.equal(s.status,200);}
  assert.equal((await g.call('/operations/'+hex(1))).status,404);
  const answers=await Promise.all(waiting);assert.deepEqual(answers.map(r=>r.status).sort(),[200,409]);
  // Released afterwards. Which of the two was admitted depends on arrival; its own request is repeated.
  const admitted=answers[0].status===200?g.request(9):g.request(10,8);
  assert.equal((await g.call('/operations',admitted)).status,200);assert.equal(g.upstream.state.created,1);
});
test('reads keep their limit of 10 seconds at the gateway',{concurrency:true},async t=>{
  const g=await gateway(t),slow=http.createServer(()=>{});await new Promise(r=>slow.listen(0,'127.0.0.1',r));t.after(()=>{slow.closeAllConnections();slow.close();});
  // A runtime that accepts the connection and never answers a read.
  const silent=createGatewayBridgeClient({createReadClient:({endpoint,fetchImpl})=>({getBridgeStatus:async()=>(await fetchImpl(new URL('/bridge/status',endpoint),{method:'GET',signal:AbortSignal.timeout(30000)})).json(),getOperationStatus:async()=>null}),
    network,endpoint:'http://127.0.0.1:'+slow.address().port,accessToken:'a'.repeat(64),fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([init.signal,AbortSignal.timeout(upstreamTimeoutMs(init))])})});
  const at=Date.now();await assert.rejects(silent.getBridgeStatus());const ms=Date.now()-at;assert(ms>=7500&&ms<=9500,String(ms));
});
