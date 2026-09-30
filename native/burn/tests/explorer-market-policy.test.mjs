// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Tests of the market price policy against the staged Explorer. Provider
// responses are fixtures; one of them is the provider's real answer of 2026-09-29.
import {stageProduction} from './explorer-production-stage.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {pathToFileURL} from 'node:url';
const {src,web}=stageProduction(),load=(root,f)=>import(pathToFileURL(path.join(root,f)).href);
const {createMarketService,MIN_LIQUIDITY_USD,RELIABLE_LIQUIDITY_USD}=await load(src,'market.js'),{withSelectedMarket,liveMarketResponse}=await load(src,'market-live.js');
const {createSnapshotHandler}=await load(src,'snapshot.js'),{marketOperation}=await load(src,'api/market-schema.js');
const {MARKET}=await load(web,'market-identities.js');
const MINT='4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW',SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ORCA='CYtvrp8wg5sSoGPxzqMdpfqDpvidmvgTSy3jkuzMLz7G',RAYDIUM='J3QJDVzWrrPZmSABXicoftFewFFinZuuAhC9vqBRrXbi',TRACKED='AuzzLQ6KTiRyZPE5AVHynigeY9fPkNfBBbjyNcPE3xjh';
const real=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'explorer-market-fixture-20260929.json'),'utf8'));
// SOL at 120 USD: priceUsd = priceNative * 120.
const pair=(change={})=>({chainId:'solana',dexId:'orca',pairAddress:ORCA,baseToken:{address:MINT,name:'KingPepe',symbol:'KPEPE'},quoteToken:{address:SOL,symbol:'SOL'},priceNative:'0.05',priceUsd:'6',
  liquidity:{usd:24,base:2,quote:0.1},volume:{h24:0.5},priceChange:{h24:-1.5},txns:{h24:{buys:1,sells:1}},...change});
async function market(pairs,{fail=false,supply=null}={}){
  const service=createMarketService({readSupply:async()=>supply,fetchImpl:async()=>{if(fail)throw Error('down');return new Response(JSON.stringify(pairs),{headers:{'content-type':'application/json'}});}});
  return (await service.getMarket()).value;
}
const numeric=v=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)&&Number(v)>0;

test('the thresholds: 10 to be reported, 1000 to be reliable',()=>{assert.equal(MIN_LIQUIDITY_USD,10n);assert.equal(RELIABLE_LIQUIDITY_USD,1000n);});
test('the provider\'s real answer: both official pools qualify, the official Raydium pool is the source, low liquidity is said',async()=>{
  const v=await market(real);
  assert.equal(v.state,'LOW_LIQUIDITY_MARKET');assert.equal(v.priceReliable,false);assert.equal(v.tradingActive,true);assert.equal(v.mint,MINT);
  assert.equal(v.dex,'raydium');assert.equal(v.pairAddress,RAYDIUM);assert.equal(v.selection,'PRIMARY_RAYDIUM_POOL');assert.equal(v.priceUsd,'5.16');assert.equal(v.priceSol,'0.04318');assert.equal(v.liquidityUsd,'14.48');assert.equal(v.volume24hUsd,'0.46');
  assert(numeric(v.quoteLiquidityUsd)&&Number(v.quoteLiquidityUsd)>6.5&&Number(v.quoteLiquidityUsd)<8,v.quoteLiquidityUsd);assert.equal(v.fdvUsd,null);assert.equal(v.marketCapUsd,null);assert.equal(v.stale,false);
  // Each alone qualifies.
  const orca=await market(real.filter(p=>p.pairAddress===ORCA)),raydium=await market(real.filter(p=>p.pairAddress===RAYDIUM));
  assert.deepEqual([orca.dex,orca.pairAddress,orca.state,orca.selection,orca.priceUsd],['orca',ORCA,'LOW_LIQUIDITY_MARKET','FALLBACK_POOL','5.5']);
  assert.deepEqual([raydium.dex,raydium.pairAddress,raydium.state,raydium.priceUsd,raydium.priceSol,raydium.liquidityUsd],['raydium',RAYDIUM,'LOW_LIQUIDITY_MARKET','5.16','0.04318','14.48']);
  // Selection does not depend on the order of the answer.
  assert.equal((await market([...real].reverse())).pairAddress,RAYDIUM);
  assert.deepEqual(Object.keys(v).sort(),Object.keys(marketOperation.responses[200].content['application/json'].schema.properties).sort());
});
test('an official pool above 10 USD qualifies; below it, or without real depth, it does not',async()=>{
  assert.equal((await market([pair({liquidity:{usd:10.5,base:0.875,quote:0.04375}})])).state,'LOW_LIQUIDITY_MARKET');
  for(const liquidity of [{usd:9.99,base:0.83,quote:0.0416},{usd:5,base:0.4,quote:0.02},{usd:0.5,base:0.04,quote:0.002},{usd:0,base:0,quote:0},{usd:24,base:2,quote:0},{usd:24,base:0,quote:0.1}]){
    const v=await market([pair({liquidity})]);assert.equal(v.state,'NO_MARKET',JSON.stringify(liquidity));assert.equal(v.priceUsd,null);assert.equal(v.priceReliable,false);assert.equal(v.tradingActive,false);}
  // Reliable from 1000 USD of real depth.
  const deep=await market([pair({liquidity:{usd:1200,base:100,quote:5}})]);assert.equal(deep.state,'ACTIVE');assert.equal(deep.priceReliable,true);assert.equal(deep.fdvUsd,'126000000');
  assert.equal((await market([pair({liquidity:{usd:998,base:83,quote:4.158}})])).state,'LOW_LIQUIDITY_MARKET');
});
test('KPEPE valued at its own price is never depth: the tracked one-sided pool cannot be selected or made reliable',async()=>{
  // As an indexer reports the tracked pool: 9,000,997 KPEPE and 0.0005 SOL, "11.9 million USD".
  const oneSided=pair({dexId:'raydium',pairAddress:TRACKED,priceNative:'0.1',priceUsd:'12',liquidity:{usd:11900828,base:9000997.9,quote:0.000524195}});
  assert.equal((await market([oneSided])).state,'NO_MARKET');
  const v=await market([oneSided,...real]);assert.equal(v.pairAddress,RAYDIUM);assert.equal(v.priceUsd,'5.16');assert.equal(v.priceReliable,false);
  // A reported total far above the quote side counts for twice the quote side only.
  const inflated=await market([pair({liquidity:{usd:5000,base:800,quote:0.1}})]);assert.equal(inflated.state,'LOW_LIQUIDITY_MARKET');assert.equal(inflated.priceReliable,false);assert.equal(inflated.quoteLiquidityUsd,'12');
  // The deeper quote side wins over the larger reported total.
  const chosen=await market([pair({pairAddress:'FDCi3TTmPGL7ky8aR3Dz8KTjyJ5JdtR2uMV25VMyCSkD',dexId:'pumpswap',liquidity:{usd:900,base:140,quote:0.2}}),pair({liquidity:{usd:60,base:5,quote:0.25}})]);assert.equal(chosen.pairAddress,ORCA);
});
test('only the exact official Mint against SOL or USDC, whatever the name or ticker says',async()=>{
  const other='DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  for(const change of [{baseToken:{address:other,name:'KingPepe',symbol:'KPEPE'}},{baseToken:{address:MINT.slice(0,-1)+'X',name:'KingPepe',symbol:'KPEPE'}},{baseToken:{name:'KingPepe',symbol:'KPEPE'}},
    {quoteToken:{address:other,symbol:'SOL'}},{quoteToken:{address:MINT,symbol:'SOL'}},{chainId:'ethereum'},{pairAddress:'not-a-pool'},{pairAddress:null},{dexId:'Orca!'},{dexId:''},
    {priceUsd:'0'},{priceUsd:'-6'},{priceUsd:null},{priceUsd:'abc'},{priceNative:'0'},{priceNative:null},{liquidity:null},{liquidity:{usd:'NaN',base:2,quote:0.1}}]){
    const v=await market([pair(change)]);assert.equal(v.state,'NO_MARKET',JSON.stringify(change));assert.equal(v.priceUsd,null);}
  // The ticker is irrelevant: the official Mint under any name is the official Mint.
  assert.equal((await market([pair({baseToken:{address:MINT,name:'Something',symbol:'XYZ'}})])).state,'LOW_LIQUIDITY_MARKET');
  // USDC quote, and the official Mint on the quote side.
  const usdc=await market([pair({quoteToken:{address:USDC,symbol:'USDC'},priceNative:'6',priceUsd:'6',liquidity:{usd:24,base:2,quote:12}})]);assert.equal(usdc.priceUsd,'6');assert.equal(usdc.priceSol,null);assert.equal(usdc.quoteLiquidityUsd,'12');
  const inverse=await market([pair({baseToken:{address:SOL,symbol:'SOL'},quoteToken:{address:MINT,symbol:'KPEPE'},priceNative:'20',priceUsd:'120',liquidity:{usd:24,base:0.1,quote:2}})]);
  assert.equal(inverse.priceUsd,'6');assert.equal(inverse.priceSol,'0.05');assert.equal(inverse.quoteLiquidityUsd,'12');assert.equal(inverse.state,'LOW_LIQUIDITY_MARKET');
  // The same pool twice in one answer is ambiguous and is not used.
  assert.equal((await market([pair(),pair({priceUsd:'60'})])).state,'NO_MARKET');
  assert.equal((await market([],{fail:true})).state,'UNAVAILABLE');
});

// What the tracked pool reported on 2026-09-29: a last trade at 0.10025 SOL, two days old.
const lastTrade={id:'x:0',signature:'3aSuHFFHhtNGFjuL1GwFkgfkpc4AP7uxnrdQyxP4JVcnqWHHwLz2kQa9EhhtHxpAQfP9HHR7tUCQGbp1cPDTEzbj',slot:451188975,timestamp:Date.now()-2*86400000,venue:'RAYDIUM',pool:TRACKED,side:'BUY',kpepe:'0.00997500',sol:'0.001000000',priceSol:0.10025062656641603};
const live=(change={})=>({version:1,mode:'DISPLAY_ONLY',venues:['RAYDIUM'],mint:MINT,network:'MAINNET',marketHealth:'LIVE',timestamp:Date.now(),observedAt:Date.now()-5000,slot:451745000,freshness:{},priceSol:0.10025062656641603,priceType:'LAST_FINALIZED_TRADE',priceAt:lastTrade.timestamp,
  priceUsd:11.925814536340852,usdSource:{price:118.96,observedAt:Date.now(),tradeAt:Date.now(),source:'COINBASE_SOL_USD_LAST_TRADE'},solanaSupply:{atomic:'1019917835555747',kpepe:'10199178.35555747',decimals:8,source:'FINALIZED_MINT_ACCOUNT'},marketCapUsd:121633000,
  marketCapBasis:'OUTSTANDING_SOLANA_SUPPLY_AT_DISPLAYED_PRICE',stats24h:{changePct:null,volumeSol:0,highSol:null,lowSol:null,tradeCount:0},lastTrade,trackedAskSol:0.1,bestBuyQuote:null,trades:[lastTrade],
  history:{observedAt:Date.now()-5000,health:'FRESH',complete24h:true,headVerified:true},raydium:{pool:TRACKED,status:'ACTIVE',referencePriceSol:0.1,vaultSol:'0.000524195',vaultKpepe:'9000997.90847169',order:{address:MARKET.order,owner:MARKET.orderOwner,status:'PARTIALLY_FILLED',askSol:'0.100000000'}},orca:null,statistics:null,...change});

test('/market, /market/live and snapshot.market publish one and the same observation',async()=>{
  const selected=await market(real),read=async()=>({value:selected,ttlSec:5});
  const merged=(await liveMarketResponse({},read,()=>live())).value;
  assert.deepEqual(merged.selectedMarket,selected);assert.equal(merged.priceType,'SELECTED_DEX_POOL');assert.equal(merged.priceUsd,5.16);assert.equal(merged.priceSol,0.04318);assert.equal(merged.priceReliable,false);
  assert.equal(String(merged.priceUsd),selected.priceUsd);assert.equal(String(merged.priceSol),selected.priceSol);assert.equal(merged.priceAt,Date.parse(selected.updatedAt));assert.equal(merged.mint,MINT);
  // The last trade of the tracked pool is history. It sets nothing, however recent.
  for(const trade of [lastTrade,{...lastTrade,timestamp:Date.now()-1000}]){
    const v=withSelectedMarket(live({lastTrade:trade,trades:[trade],priceAt:trade.timestamp}),selected);
    assert.equal(v.priceUsd,5.16);assert.equal(v.priceSol,0.04318);assert.notEqual(v.priceSol,trade.priceSol);assert.equal(v.priceType,'SELECTED_DEX_POOL');assert.equal(v.usdSource,null);
    assert.equal(v.marketCapUsd,null);assert.deepEqual(v.lastTrade,trade);assert.equal(v.trades.length,1);}
  for(const v of [JSON.stringify(merged.priceUsd),JSON.stringify(merged.priceSol),JSON.stringify(merged.marketCapUsd)])assert.equal(/11\.9|0\.1002/.test(v),false,v);
  // No selected market: no price from anywhere else.
  for(const none of [await market([]),await market([],{fail:true}),null]){const v=withSelectedMarket(live(),none);assert.equal(v.priceUsd,null);assert.equal(v.priceSol,null);assert.equal(v.priceType,'UNAVAILABLE');assert.equal(v.priceReliable,false);assert.equal(v.marketCapUsd,null);}
  // A reliable price does carry the indicative valuation.
  const deep=withSelectedMarket(live(),await market([pair({liquidity:{usd:1200,base:100,quote:5}})],{supply:{nativeAtomic:'1031082521157806',solanaAtomic:'1019917835555747',nativeHeight:303339}}));
  assert.equal(deep.priceReliable,true);assert.equal(deep.marketCapUsd,Number(deep.selectedMarket.marketCapUsd));assert.equal(deep.selectedMarket.marketCapUsd,'123060021.4');
  await assert.rejects(liveMarketResponse({a:'1'},read,()=>live()));
  // The snapshot: the same object, and every Native field exactly as it was.
  const native={tip:{height:303315,hash:'00'.repeat(32)},prev:[],mempool:{count:0},network:{hashrate:17008073581903.78,difficulty:226398.7887783098,blocks:303315,connections:2},history:[1,2],serverTime:1790713000000,clients:3};
  const before=structuredClone(native);let body,status;const res={destroyed:false,writableEnded:false,headersSent:false,setHeader(){},getHeader(){},removeHeader(){},writeHead(code){status=code;},end(text){body=text;}};
  await createSnapshotHandler(()=>native,read)({method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'},url:'/api/v1/snapshot'},res);
  const snapshot=JSON.parse(body);assert.equal(status,200);const {history7d,...observation}=selected;assert.deepEqual(snapshot.market,observation);assert.equal(Object.hasOwn(snapshot.market,'history7d'),false);const {market:_m,...rest}=snapshot;assert.deepEqual(rest,before);assert.deepEqual(native,before);
  assert.deepEqual(Object.keys(snapshot),['tip','prev','mempool','network','history','serverTime','clients','market']);
});
test('the official Raydium pool is the source; Orca only when Raydium gives no valid current price',async()=>{
  const raydium=real.find(p=>p.pairAddress===RAYDIUM),orca=real.find(p=>p.pairAddress===ORCA);
  // Raydium is used although Orca is deeper, and however much deeper.
  for(const list of [[orca,raydium],[raydium,orca],[{...orca,liquidity:{usd:900,base:80,quote:3.8}},raydium]]){const v=await market(list);assert.equal(v.pairAddress,RAYDIUM);assert.equal(v.dex,'raydium');assert.equal(v.selection,'PRIMARY_RAYDIUM_POOL');assert.equal(v.priceUsd,'5.16');}
  // Raydium without a valid current price: Orca, and it says fallback.
  for(const change of [{priceUsd:null},{priceUsd:'0'},{priceNative:null},{liquidity:{usd:9.5,base:0.9,quote:0.04}},{liquidity:{usd:14.48,base:1.4,quote:0}},{liquidity:null},{chainId:'ethereum'},
    {baseToken:{address:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',name:'KingPepe',symbol:'KPEPE'}},{quoteToken:{address:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'}}]){
    const v=await market([{...raydium,...change},orca]);assert.equal(v.pairAddress,ORCA,JSON.stringify(change));assert.equal(v.selection,'FALLBACK_POOL');assert.equal(v.priceUsd,'5.5');assert.equal(v.priceReliable,false);}
  assert.equal((await market([orca])).selection,'FALLBACK_POOL');assert.equal((await market([raydium,raydium,orca])).pairAddress,ORCA);
  // Another pool that merely calls itself Raydium, or the same address under another DEX, is not the official pool.
  const other=await market([{...raydium,pairAddress:'AuzzLQ6KTiRyZPE5AVHynigeY9fPkNfBBbjyNcPE3xjh',liquidity:{usd:16,base:1.5,quote:0.07}},orca]);assert.equal(other.selection,'FALLBACK_POOL');assert.equal(other.pairAddress,ORCA);
  assert.equal((await market([{...raydium,dexId:'orca'}])).selection,'FALLBACK_POOL');
  // Neither: no price, from anywhere.
  const none=await market([{...raydium,priceUsd:null},{...orca,priceUsd:null}]);assert.equal(none.state,'NO_MARKET');assert.equal(none.priceUsd,null);assert.equal(none.selection,null);
  // Reliability is judged as before: the Raydium pool is reliable only with real depth.
  assert.equal((await market([{...raydium,liquidity:{usd:1500,base:145,quote:6.3}},orca])).state,'ACTIVE');
});
