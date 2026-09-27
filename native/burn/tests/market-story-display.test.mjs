// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MARKET} from '../../../integrations/explorer/web/market-identities.js';
import {nativeActivity} from '../../../integrations/explorer/web/network-story-model.js';
import {chartSeries,formatMarket,displayHealth,overviewMetrics} from '../../../integrations/explorer/web/market-display-model.js';
import {forwardProgress} from '../../../integrations/explorer/web/bridge-presentation.js';
const root=new URL('../../../integrations/explorer/',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
test('market/story identities are fixed and display dependencies cannot sign or manage orders',()=>{
 assert.equal(MARKET.mint,'4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW');assert.equal(MARKET.order,'8YoMW5kvYy1C3BFsLggADbQVFNmP6DpMBpQUbo4sptW2');
 for(const file of ['web/market-display.js','web/market-display-model.js','web/network-story.js','web/network-story-model.js','src/market-chain.js','src/market-live.js']){
  const src=read(file).replace("from '../web/bridge-vendor/base.js'",'');
  assert.doesNotMatch(src,/from ['"][^'"]*(?:bridge-|signer|journal)|window\.solana|sendRawTransaction|signAndSendTransaction|secretKey|privateKey|process\.env/);
 }
 assert.doesNotMatch(read('web/network-story.js'),/<(?:button|form|input)\b|the first|guaranteed (?:profit|return)/i);
 const market=read('web/market-display.js');assert.doesNotMatch(market,/orca/i);assert.equal((market.match(/<article /g)??[]).length,1);
 const compose=read('web/bridge-market.js');assert(compose.includes('/kingpepe-bridge-banner-4c6e94d9.jpg'));assert(compose.includes('page.append(banner,root)'));
});
test('market history remains real-only and native activity fails honestly without affecting Bridge progress',()=>{
 const now=Date.now(),s={network:'KingPepe Mainnet',ticker:'KPEPE',timestamp:Math.floor(now/1000),node:{reachable:true,synced:true,height:300000,lastBlockTime:Math.floor(now/1000)-30}};
 assert.equal(nativeActivity(s,now).state,'RECENT_BLOCKS');assert.equal(nativeActivity(s,now+91000).state,'STALE');assert.equal(nativeActivity(null,now).state,'UNAVAILABLE');
 assert.equal(chartSeries([],'ALL',now).type,'EMPTY');assert.equal(formatMarket(null),'—');assert.equal(formatMarket(0),'0');assert.equal(displayHealth(null,now),'UNAVAILABLE');
 assert.equal(forwardProgress({state:'BURN_READY',executionFunding:{status:'ADDITIONAL_SOL_REQUIRED',burnCommitted:false}}).steps[2].state,'pending');
});
test('USD overview remains read-only and does not invent missing capitalization or liquidity',()=>{
 assert.deepEqual(overviewMetrics(null),{priceUsd:null,marketCapUsd:null,liquidityUsd:null});
 const ui=read('web/market-display.js');assert(ui.includes('Mkt Cap'));assert(ui.includes('Raydium reported TVL'));assert(ui.includes('Price USD'));assert(ui.includes('outstanding Solana KPEPE supply'));
});
test('funding UI remains runtime-gated and preserves the no-global-backstop integration',()=>{
 const ui=read('web/bridge.js');assert(ui.includes("executionPolicy==='USER_FUNDED'"));assert(ui.includes("funding.status==='ADDITIONAL_SOL_REQUIRED'"));assert(ui.includes('funds remain reserved for mint completion'));
 assert.doesNotMatch(ui,/0\.031477560|0\.024310646/);assert(ui.includes('Connect Phantom'));
 const release=JSON.parse(read('market-story-release.json'));assert.equal(release.economicBaseSourceSha,'5876620b53c66fec38927ea0857a1b19094dd4fc');assert.equal(release.activatesFundingPolicy,false);
 assert.deepEqual(release.marketVenues,['RAYDIUM']);assert.equal(release.originalBannerPreserved,true);
});
