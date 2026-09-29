// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Tests of the gateway's reconnection to the Bridge. Scripted loader and clock; no Bridge, no chain.
import {stageProduction} from './explorer-production-stage.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const {src}=stageProduction(),load=f=>import(pathToFileURL(path.join(src,f)).href);
const {createBridgeConnection,RETRY_FIRST_MS,RETRY_LIMIT_MS}=await load('bridge-connection.js'),{createBridgeGateway}=await load('bridge.js');
const {base58}=await import(pathToFileURL(path.join(src,'../web/bridge-vendor/base.js')).href);
const settle=()=>new Promise(r=>setImmediate(r));
// A clock and a timer list the test advances by hand.
function world(results){
  let time=1_000_000;const timers=[],events=[],calls=[];
  const connection=createBridgeConnection({now:()=>time,schedule:(task,ms)=>{timers.push({at:time+ms,ms,task});},report:e=>events.push(e),
    load:async()=>{calls.push(time);const next=results.length>1?results.shift():results[0];if(next instanceof Error)throw next;return typeof next==='function'?next():next;}});
  return {connection,timers,events,calls,advance:async ms=>{time+=ms;for(const t of timers.splice(0).filter(t=>t.at<=time?true:(timers.push(t),false)))t.task();await settle();await settle();},now:()=>time};
}
const backendValue={client:{},validators:{}};

test('connected at the first attempt: exactly as before, one load and no timer',async()=>{
  const w=world([backendValue]);assert.equal(await w.connection.backend(),backendValue);await settle();
  assert.deepEqual([w.calls.length,w.timers.length,w.connection.status().state],[1,0,'CONNECTED']);
  for(let i=0;i<50;i++)assert.equal(await w.connection.backend(),backendValue);await w.advance(3_600_000);
  assert.equal(w.calls.length,1);assert.deepEqual(w.events.map(e=>e.event),['BRIDGE_GATEWAY_CONNECTED']);
});
test('a failed start recovers by itself: 5, 10, 20, 40 seconds, then every 60',async()=>{
  const w=world([Error('down'),Error('down'),Error('down'),Error('down'),Error('down'),Error('down'),Error('down'),backendValue]);
  assert.equal(await w.connection.backend(),null);await settle();assert.equal(w.connection.status().state,'RETRYING');
  const delays=[];for(let i=0;i<7;i++){assert.equal(w.timers.length,1,'never more than one retry scheduled');const t=w.timers[0];delays.push(t.ms);
    // Nothing happens before its time.
    await w.advance(t.ms-1);assert.equal(w.calls.length,i+1);assert.equal(await w.connection.backend(),null);await w.advance(1);assert.equal(w.calls.length,i+2);}
  assert.deepEqual(delays,[5000,10000,20000,40000,60000,60000,60000]);assert.equal(RETRY_FIRST_MS,5000);assert.equal(RETRY_LIMIT_MS,60000);
  assert.equal(await w.connection.backend(),backendValue);assert.equal(w.connection.status().state,'CONNECTED');assert.equal(w.timers.length,0);
  await w.advance(3_600_000);assert.equal(w.calls.length,8);
  assert.deepEqual(w.events.at(-1),{event:'BRIDGE_GATEWAY_CONNECTED',attempts:8,afterFailures:7});
});
test('requests never start attempts, and are never held up by a retry',async()=>{
  let release;const w=world([Error('down'),()=>new Promise(r=>{release=r;})]);
  assert.equal(await w.connection.backend(),null);await settle();
  // A thousand requests while waiting: not one more attempt.
  for(let i=0;i<1000;i++)assert.equal(await w.connection.backend(),null);assert.equal(w.calls.length,1);assert.equal(w.timers.length,1);
  await w.advance(5000);assert.equal(w.calls.length,2);
  // The second attempt is in flight and slow: a request answers at once, and no parallel attempt starts.
  const at=Date.now();assert.equal(await w.connection.backend(),null);assert(Date.now()-at<100);await w.advance(120000);assert.equal(w.calls.length,2);
  release(backendValue);await settle();await settle();assert.equal(await w.connection.backend(),backendValue);
});
test('an attempt that never answers is given up on and repeated; no configuration is not retried',async()=>{
  let calls=0;const timers=[];
  const c=createBridgeConnection({loadLimitMs:1000,schedule:(task,ms)=>timers.push({task,ms}),load:()=>{calls++;return calls===1?new Promise(()=>{}):backendValue;}});
  assert.equal(await c.backend(),null);assert.equal(c.status().state,'RETRYING');assert.deepEqual(timers.map(t=>t.ms),[5000]);
  timers[0].task();await settle();await settle();assert.equal(await c.backend(),backendValue);
  const w=world([null]);assert.equal(await w.connection.backend(),null);await settle();assert.equal(w.connection.status().state,'NOT_CONFIGURED');assert.equal(w.timers.length,0);await w.advance(3_600_000);assert.equal(w.calls.length,1);
  for(const options of [{},{load:'x'},{load:()=>1,firstDelayMs:10},{load:()=>1,firstDelayMs:5000,limitDelayMs:1000},{load:()=>1,loadLimitMs:1}])assert.throws(()=>createBridgeConnection(options));
});
test('through the gateway: 503 while the Bridge is unreachable, 200 by itself once it answers',async t=>{
  const MINT='4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW',network={environment:'mainnet',kingpepeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',test:false,activationAllowed:true};
  const status={architecture:'ONE_WAY_AUTOMATIC_BURN_AND_MINT',state:'ACTIVE',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',walletChain:'solana:mainnet',productionReady:true,mainnetActivation:'ENABLED',decimals:8,symbol:'KPEPE',mint:MINT,
    bridgeFeeAtomic:'0',nativeDepositConfirmations:12,nativeBurnConfirmations:12,executionPolicy:'LEGACY_OPERATOR_FUNDED',minimumDepositAtomic:'100000000000',maxConcurrentExecutingOperations:1,executionSlot:'AVAILABLE',
    supply:{state:'READY',source:'CANONICAL_COMPLETED_FINALIZED_NATIVE_BURN_MINT_ACCOUNTING',environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET',mint:MINT,decimals:8,maxSupplyAtomic:'2100000000000000',bridgedSupplyAtomic:'1019917878842194',remainingSupplyAtomic:'1080082121157806',liveMintSupplyAtomic:'1019917835555747',observedAt:Date.now()}};
  const connected={client:{getBridgeStatus:async()=>({...status,supply:{...status.supply,observedAt:Date.now()}}),getOperationStatus:async()=>null},validators:{network,mint:MINT,publicKey:v=>assert.equal(base58.decode(v).length,32)}};
  const w=world([Error('Bridge not answering'),Error('Bridge not answering'),connected]);
  const gateway=createBridgeGateway({backend:()=>w.connection.backend(),readLimit:1000}),server=http.createServer((req,res)=>void gateway(req,res,new URL(req.url,'http://127.0.0.1')));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const get=async()=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/v1/bridge/status');return [r.status,await r.json()];};
  let [code,body]=await get();assert.equal(code,503);assert.deepEqual(body,{error:true,message:'Bridge temporarily unavailable.'});
  await w.advance(5000);[code]=await get();assert.equal(code,503);
  await w.advance(10000);[code,body]=await get();assert.equal(code,200);
  // What is published is what the Bridge reports: nothing of it comes from the connection.
  assert.deepEqual([body.state,body.minimumDepositAtomic,body.bridgeFeeAtomic,body.executionSlot,body.maxConcurrentExecutingOperations,body.supply.bridgedSupplyAtomic],['ACTIVE','100000000000','0','AVAILABLE',1,'1019917878842194']);
  for(let i=0;i<5;i++)assert.equal((await get())[0],200);assert.equal(w.calls.length,3);
});
test('the connection module only schedules and reports; it never talks to the Bridge or a chain itself',()=>{
  const module=fs.readFileSync(path.join(src,'bridge-connection.js'),'utf8');
  for(const forbidden of ['fetch(','sendTransaction','createOperation','writeFile','child_process','process.exit','while (true)','for (;;)','setInterval'])assert.equal(module.includes(forbidden),false,forbidden);
});
