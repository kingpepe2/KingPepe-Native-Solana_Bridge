// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// The Explorer integration recorded here is the one production serves: every
// file matches the release manifest, the Bridge page shows the Bridge and the
// network story only, and the market price comes from the official Raydium pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stageProduction,overlay} from './explorer-production-stage.mjs';
const repository=path.resolve(overlay,'../..'),binary=p=>/\.(?:webp|png|jpg)$/u.test(p),read=p=>binary(p)?fs.readFileSync(p):fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const release=JSON.parse(read(path.join(overlay,'reserve-gateway/release.json'))),stage=stageProduction();
const walk=(dir,base=dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name),base):[path.relative(base,path.join(dir,e.name)).replaceAll('\\','/')]);
test('every recorded file is present, unchanged, and is the file production composes',()=>{
 assert.equal(release.schemaVersion,1);assert.deepEqual(release.overlayOrder,['support','src','web','reserve-gateway']);
 assert.equal(new Set(release.files.map(f=>f.deployed)).size,release.files.length);
 for(const file of release.files){
  assert.match(file.repository,/^integrations\/explorer\/(?:support\/|reserve-gateway\/)?(?:src|web)\//u);assert.match(file.sha256,/^[0-9a-f]{64}$/u);
  const recorded=createHash('sha256').update(read(path.join(repository,file.repository))).digest('hex');assert.equal(recorded,file.sha256,file.repository);
  assert.equal(createHash('sha256').update(read(path.join(stage.root,file.deployed))).digest('hex'),file.sha256,'staged '+file.deployed);
 }
 // Nothing under the integration is unaccounted for: recorded as deployed, or named as not deployed.
 const known=new Set([...release.files.map(f=>f.repository),...release.notDeployed,'integrations/explorer/reserve-gateway/release.json']);
 for(const file of walk(overlay))assert(known.has('integrations/explorer/'+file),file);
 for(const file of release.notDeployed)assert(fs.existsSync(path.join(repository,file)),file);
});
test('the Bridge page shows the Bridge and the network story, and no market information',()=>{
 assert.deepEqual(release.bridgePage,{route:'/bridge',sections:['BRIDGE','NETWORK_STORY'],marketInformation:'NONE'});
 const compose=read(path.join(stage.web,'bridge-market.js'));
 assert(compose.includes('root.append(bridge,story)'));assert(compose.includes('/kingpepe-bridge-banner-4c6e94d9.jpg'));
 assert.deepEqual([...compose.matchAll(/from\s*'([^']+)'/gu)].map(m=>m[1].split('?')[0]),['./bridge.js','./network-story.js']);
 // Followed through every import, the Bridge page reaches no market module and no market route.
 const seen=new Set(),queue=['bridge-market.js'];
 while(queue.length){const file=queue.shift();if(seen.has(file))continue;seen.add(file);const p=path.join(stage.web,file);if(!fs.existsSync(p)||file.startsWith('bridge-vendor/'))continue;
  for(const m of read(p).matchAll(/(?:from\s*|import\s*\(\s*)'(\.[^']+)'/gu))queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1].split('?')[0])));}
 assert(seen.has('bridge.js')&&seen.has('network-story.js')&&seen.size>5);
 for(const file of seen){assert.doesNotMatch(file,/market-(?:summary|display)/u,file);
  if(fs.existsSync(path.join(stage.web,file))&&!file.startsWith('bridge-vendor/'))assert.doesNotMatch(read(path.join(stage.web,file)),/\/api\/v1\/(?:market|snapshot)/u,file);}
 for(const file of ['web/market-display.js','web/market-display-model.js','web/market-display.css','web/bridge-execution.js']){
  assert(release.removedFromProduction.includes(file),file);assert.equal(release.files.some(f=>f.deployed===file),false,file);}
 for(const file of walk(overlay))assert.doesNotMatch(file,/market-display/u,file);
 assert.doesNotMatch(read(path.join(stage.web,'bridge-layout.css')),/\.market-(?!wide)|position:\s*sticky/u);
});
test('the deployed gateway and page carry no user-funding surface',async()=>{
 assert.equal(release.executionPolicy,'LEGACY_OPERATOR_FUNDED');assert.equal(release.userFunded,'DISABLED');assert.equal(release.maxConcurrentExecutingOperations,1);
 assert.equal(release.minimumDepositAtomic,'100000000000');assert.equal(release.bridgeFeeAtomic,'0');
 for(const file of ['src/bridge.js','src/bridge-client.js','src/bridge-backend.js','web/bridge.js','web/bridge-presentation.js'])
  assert.doesNotMatch(read(path.join(stage.root,file)),/execution-quote|execution-payment|refreshExecutionQuote|verifyExecutionPayment|bridge-execution|AWAITING_EXECUTION_FUNDING/u,file);
 const {createBridgeGateway}=await import(pathToFileURL(path.join(stage.src,'bridge.js')).href);assert.equal(typeof createBridgeGateway,'function');
});
test('the market price is read from the official Raydium pool; display files cannot sign or manage orders',()=>{
 assert.equal(release.market.primaryDex,'raydium');assert.equal(release.market.primaryPool,'J3QJDVzWrrPZmSABXicoftFewFFinZuuAhC9vqBRrXbi');assert.equal(release.market.shownOn,'MAIN_PAGE');
 const market=read(path.join(stage.src,'market.js'));assert(market.includes("PRIMARY_POOL = 'J3QJDVzWrrPZmSABXicoftFewFFinZuuAhC9vqBRrXbi'"));assert(market.includes("PRIMARY_DEX = 'raydium'"));
 for(const file of ['web/market-summary.js','web/network-story.js','web/network-story-model.js','src/market.js','src/market-chain.js','src/market-live.js','src/snapshot.js'])
  assert.doesNotMatch(read(path.join(stage.root,file)),/window\.solana|sendRawTransaction|signAndSendTransaction|sendTransaction|secretKey|privateKey|process\.env/u,file);
});
