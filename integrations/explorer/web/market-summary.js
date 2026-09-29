// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// DISPLAY ONLY. One GET to the fixed public market endpoint; no wallet, no transaction.
import {MARKET} from './market-identities.js';
const RETAIN_MS=300000,WEEK_MS=604800000;
const amount=v=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)&&v.length<=80?Number(v):null;
// $5.42 · $0.96 · $1.2K · $55.8M. The API keeps the full precision.
export function formatUsd(value){
  if(value===null||value===undefined||!Number.isFinite(value)||value<0)return '—';
  for(const [limit,unit] of [[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']])if(value>=limit){const n=value/limit;return '$'+(n>=100?n.toFixed(0):n>=10?n.toFixed(1):n.toFixed(2)).replace(/\.0+$|(\.\d*?[1-9])0+$/u,'$1')+unit;}
  if(value>=1)return '$'+value.toFixed(2);
  if(value===0)return '$0.00';
  return '$'+Number(value.toPrecision(3)).toString();
}
export function formatSupply(value){
  if(value===null||!Number.isFinite(value)||value<=0)return '—';
  return value>=1e6?(value/1e6).toFixed(2)+'M':value>=1e3?(value/1e3).toFixed(1)+'K':value.toFixed(0);
}
// What may be shown, from exactly what the API published for the official Mint.
export function summaryModel(market,now=Date.now()){
  const none={state:'UNAVAILABLE',price:null,reliable:false,warning:null,marketCap:null,supply:null,volume:null,pools:0,dex:null,pairAddress:null,history:{coverage:'NONE',points:[],caption:'Not enough price history yet'}};
  if(!market||market.mint!==MARKET.mint||market.network!=='solana')return none;
  if(market.state==='NO_MARKET')return {...none,state:'NO_MARKET'};
  if(!['ACTIVE','LOW_LIQUIDITY_MARKET','STALE'].includes(market.state)||typeof market.priceReliable!=='boolean'||market.priceReliable!==(market.state==='ACTIVE'))return none;
  const at=Date.parse(market.updatedAt),price=amount(market.priceUsd);
  if(!Number.isFinite(at)||at>now+10000||now-at>RETAIN_MS||!(price>0)||typeof market.pairAddress!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(market.pairAddress))return none;
  if(market.selection==='PRIMARY_RAYDIUM_POOL'&&(market.pairAddress!=='J3QJDVzWrrPZmSABXicoftFewFFinZuuAhC9vqBRrXbi'||market.dex!=='raydium'))return none;
  const supply=amount(market.circulatingSupply),cap=amount(market.marketCapUsd);
  // The valuation is shown only if it is the published price times the published supply.
  const marketCap=supply>0&&supply<=21000000&&cap!==null&&Math.abs(cap-price*supply)<=Math.max(0.01,price*supply*1e-9)?cap:null;
  const pools=Array.isArray(market.pools)?market.pools.filter(p=>typeof p?.pairAddress==='string'&&amount(p.volume24hUsd)!==null):[];
  const total=amount(market.totalVolume24hUsd),sum=pools.reduce((s,p)=>s+amount(p.volume24hUsd),0);
  const volume=total!==null&&pools.length&&Math.abs(total-sum)<=Math.max(0.01,sum*1e-9)?total:amount(market.volume24hUsd);
  const h=market.history7d,raw=h&&h.pairAddress===market.pairAddress&&Array.isArray(h.points)?h.points:[];
  // Genuine observations inside the last seven days, in order. Nothing is added between them.
  const points=raw.map(p=>({t:p?.t,price:amount(p?.priceUsd)})).filter(p=>Number.isSafeInteger(p.t)&&p.t<=now+300000&&p.t>=now-WEEK_MS&&p.price>0).sort((a,b)=>a.t-b.t).slice(-168);
  const day=t=>new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const coverage=points.length<2?'NONE':h.coverage==='FULL'?'FULL':'PARTIAL';
  return {state:market.state,price,reliable:market.priceReliable,warning:market.state==='STALE'?'Stale':market.priceReliable?null:'Low liquidity',marketCap,supply:marketCap===null?null:supply,volume,pools:pools.length,
    dex:market.dex,pairAddress:market.pairAddress,fallback:market.selection==='FALLBACK_POOL',history:{coverage,points:coverage==='NONE'?[]:points,
      caption:coverage==='FULL'?'Last 7 days':coverage==='PARTIAL'?'Since '+day(points[0].t)+' · market is younger than 7 days':'Not enough price history yet'}};
}
export function renderMarketSummary(host){
  const root=document.createElement('section');root.className='kpm';root.setAttribute('aria-label','KPEPE market summary');root.dataset.state='LOADING';
  root.innerHTML=`
    <div class="kpm-tile kpm-price"><span class="kpm-label">KPEPE/USD</span><strong class="kpm-value" data-kpm="price">—</strong><span class="kpm-badge" data-kpm="warning" hidden></span><span class="kpm-note" data-kpm="source">Checking the official market…</span></div>
    <div class="kpm-tile kpm-history"><span class="kpm-label">7 Day</span><div class="kpm-chart" data-kpm="chart" role="img" aria-label="Not enough price history yet"></div><span class="kpm-note" data-kpm="history">—</span></div>
    <div class="kpm-tile"><span class="kpm-label">Market Cap</span><strong class="kpm-value" data-kpm="cap">—</strong><span class="kpm-note" data-kpm="cap-note">—</span></div>
    <div class="kpm-tile"><span class="kpm-label">24h Vol</span><strong class="kpm-value" data-kpm="volume">—</strong><span class="kpm-note" data-kpm="volume-note">—</span></div>`;
  host.replaceChildren(root);
  const $=key=>root.querySelector('[data-kpm="'+key+'"]'),text=(key,value)=>{$(key).textContent=value;};
  let market=null,stopped=false,timer,controller;
  function chart(history){
    const box=$('chart');box.replaceChildren();box.setAttribute('aria-label',history.points.length?'KPEPE/USD, '+history.points.length+' hourly observations, '+history.caption:history.caption);
    if(history.points.length<2)return;
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),p=history.points,w=240,hgt=64,pad=4;
    svg.setAttribute('viewBox','0 0 '+w+' '+hgt);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
    // A logarithmic scale keeps an early outlier from flattening everything after it.
    const v=p.map(x=>Math.log(x.price)),min=Math.min(...v),max=Math.max(...v),span=max-min||1,t0=p[0].t,t1=p.at(-1).t;
    const x=t=>pad+(t-t0)/(t1-t0)*(w-2*pad),y=n=>hgt-pad-(n-min)/span*(hgt-2*pad);
    const line=document.createElementNS(ns,'polyline');line.setAttribute('points',p.map((q,i)=>x(q.t).toFixed(1)+','+y(v[i]).toFixed(1)).join(' '));line.setAttribute('class',p.at(-1).price>=p[0].price?'kpm-line kpm-up':'kpm-line kpm-down');svg.append(line);
    for(const [i,q] of p.entries()){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',x(q.t).toFixed(1));dot.setAttribute('cy',y(v[i]).toFixed(1));dot.setAttribute('r','1.6');dot.setAttribute('class','kpm-dot');svg.append(dot);}
    box.append(svg);
  }
  function paint(){
    const m=summaryModel(market);root.dataset.state=m.state;
    text('price',formatUsd(m.price));const badge=$('warning');badge.hidden=!m.warning;badge.textContent=m.warning??'';
    text('source',m.price!==null?(m.reliable?'Current DEX price':'Indicative price')+' · '+({orca:'Orca',raydium:'Raydium'}[m.dex]??m.dex)+' pool'+(m.fallback?' (fallback)':''):m.state==='NO_MARKET'?'No official market is reported':'Market data unavailable');
    text('cap',formatUsd(m.marketCap));text('cap-note',m.marketCap!==null?formatSupply(m.supply)+' KPEPE · Native + Solana'+(m.reliable?'':' · indicative'):'—');
    text('volume',formatUsd(m.volume));text('volume-note',m.volume!==null?(m.pools>1?m.pools+' official pools':m.pools===1?'1 official pool':'Selected pool'):'—');
    text('history',m.history.caption);chart(m.history);
  }
  async function refresh(){
    if(stopped)return;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch('/api/v1/market',{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('UNAVAILABLE');const next=await response.json();if(!stopped)market=next;}
    catch{}finally{clearTimeout(timeout);if(!stopped){paint();timer=setTimeout(refresh,30000);}}
  }
  paint();void refresh();
  return ()=>{stopped=true;clearTimeout(timer);controller?.abort();};
}
