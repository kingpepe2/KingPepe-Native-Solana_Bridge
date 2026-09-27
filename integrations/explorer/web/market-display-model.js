import {MARKET,FRESHNESS} from './market-identities.js';
export const TIMEFRAMES=Object.freeze({ '1H':3600000,'4H':14400000,'1D':86400000,'1W':604800000,ALL:Infinity });
export const PRICE_LABELS=Object.freeze({LAST_FINALIZED_TRADE:'Last finalized trade',TRACKED_ORDER_ASK:'Tracked order ask',POOL_REFERENCE:'Pool reference price',UNAVAILABLE:'Price unavailable'});
export function validateMarket(value){
  if(value?.mode!=='DISPLAY_ONLY'||value.mint!==MARKET.mint||value.network!=='MAINNET'||!Number.isFinite(value.timestamp)||!Array.isArray(value.trades)||value.trades.length>500)throw Error('INVALID_MARKET');
  if(value.raydium&&(value.raydium.pool!==MARKET.raydium||value.raydium.order?.address!==MARKET.order||value.raydium.order?.owner!==MARKET.orderOwner))throw Error('INVALID_MARKET');
  if(value.orca&&value.orca.pool!==MARKET.orca)throw Error('INVALID_MARKET');
  for(const t of value.trades)if(!['BUY','SELL'].includes(t.side)||!['RAYDIUM','ORCA'].includes(t.venue)||t.pool!==(t.venue==='RAYDIUM'?MARKET.raydium:MARKET.orca)||!/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(t.signature)||!(Number(t.kpepe)>0)||!(Number(t.sol)>0)||!(t.priceSol>0)||!Number.isFinite(t.timestamp)||t.timestamp>value.timestamp+5000)throw Error('INVALID_TRADE');
  return value;
}
export function displayHealth(data,now=Date.now()){
  if(!data?.observedAt||now-data.observedAt>FRESHNESS.retainMs||data.timestamp>now+10000)return 'UNAVAILABLE';
  if(now-data.observedAt>FRESHNESS.accountsMs||now-data.timestamp>FRESHNESS.accountsMs)return 'STALE';
  return ['LIVE','PARTIAL','STALE'].includes(data.marketHealth)?data.marketHealth:'UNAVAILABLE';
}
export function formatMarket(value,decimals=6){if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return '—';return Number(value).toLocaleString('en-US',{maximumFractionDigits:decimals});}
export function chartSeries(trades,frame,now=Date.now()){
  const width=TIMEFRAMES[frame]??Infinity;
  const points=trades.filter(t=>t.timestamp>=now-width&&t.timestamp<=now&&Number.isFinite(t.priceSol)&&t.priceSol>0).sort((a,b)=>a.timestamp-b.timestamp||a.slot-b.slot);
  if(points.length<2||points.at(-1).timestamp===points[0].timestamp)return {type:'EMPTY',points:[]};
  const bucket=frame==='1H'?300000:frame==='4H'?900000:frame==='1D'?3600000:14400000,groups=new Map();
  for(const p of points){const t=Math.floor(p.timestamp/bucket)*bucket,g=groups.get(t);if(!g)groups.set(t,{time:t,open:p.priceSol,high:p.priceSol,low:p.priceSol,close:p.priceSol,count:1});else{g.high=Math.max(g.high,p.priceSol);g.low=Math.min(g.low,p.priceSol);g.close=p.priceSol;g.count++;}}
  // Only actual trade buckets; never interpolate empty candles or generate movement.
  const candles=[...groups.values()];
  return points.length>=12&&candles.length>=4?{type:'CANDLES',points,candles}:{type:'LINE',points};
}
