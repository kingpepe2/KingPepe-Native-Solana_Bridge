// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MARKET} from '../../../integrations/explorer/web/market-identities.js';
import {nativeActivity} from '../../../integrations/explorer/web/network-story-model.js';
import {forwardProgress} from '../../../integrations/explorer/web/bridge-presentation.js';
const root=new URL('../../../integrations/explorer/',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('market/story identities are fixed and display dependencies cannot sign or manage orders',()=>{
 assert.equal(MARKET.mint,'4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW');assert.equal(MARKET.order,'8YoMW5kvYy1C3BFsLggADbQVFNmP6DpMBpQUbo4sptW2');
 for(const file of ['web/market-summary.js','web/network-story.js','web/network-story-model.js','src/market-chain.js','src/market-live.js']){
  const src=read(file).replace("from '../web/bridge-vendor/base.js'",'');
  assert.doesNotMatch(src,/from ['"][^'"]*(?:bridge-|signer|journal)|window\.solana|sendRawTransaction|signAndSendTransaction|secretKey|privateKey|process\.env/);
 }
 assert.doesNotMatch(read('web/network-story.js'),/<(?:button|form|input)\b|the first|guaranteed (?:profit|return)/i);
 const compose=read('web/bridge-market.js');assert(compose.includes('/kingpepe-bridge-banner-4c6e94d9.jpg'));assert(compose.includes('page.append(banner,root)'));
 assert(compose.includes('root.append(bridge,story)'));assert.doesNotMatch(compose,/bridge-column|market-column/);
 assert.doesNotMatch(read('web/bridge-layout.css'),/position:\s*sticky|bridge-column|market-column/);
});
test('native activity fails honestly without affecting Bridge progress',()=>{
 const now=Date.now(),s={network:'KingPepe Mainnet',ticker:'KPEPE',timestamp:Math.floor(now/1000),node:{reachable:true,synced:true,height:300000,lastBlockTime:Math.floor(now/1000)-30}};
 assert.equal(nativeActivity(s,now).state,'RECENT_BLOCKS');assert.equal(nativeActivity(s,now+91000).state,'STALE');assert.equal(nativeActivity(null,now).state,'UNAVAILABLE');
 assert.equal(forwardProgress({state:'BURN_READY',executionFunding:{status:'ADDITIONAL_SOL_REQUIRED',burnCommitted:false}}).steps[2].state,'pending');
 assert(forwardProgress(null).steps.every(step=>step.state==='pending'));
});
test('funding UI remains runtime-gated and preserves the no-global-backstop integration',()=>{
 const ui=read('web/bridge.js');assert(ui.includes("executionPolicy==='USER_FUNDED'"));assert(ui.includes("funding.status==='ADDITIONAL_SOL_REQUIRED'"));assert(ui.includes('funds remain reserved for mint completion'));
 assert.doesNotMatch(ui,/0\.031477560|0\.024310646/);assert(ui.includes('Connect Phantom'));
 // This page is retained with the disabled policy and is not deployed; production serves reserve-gateway/web.
 const release=JSON.parse(read('reserve-gateway/release.json'));assert.equal(release.userFunded,'DISABLED');assert(release.notDeployed.includes('integrations/explorer/web/bridge.js'));
});
