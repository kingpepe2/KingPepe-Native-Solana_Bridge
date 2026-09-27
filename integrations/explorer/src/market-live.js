// Independent public market reader. Outbound RPC methods and accounts are fixed here.
// No environment credential loading, private runtime imports, writes or transaction submission.
import {MARKET,FRESHNESS} from '../web/market-identities.js';
import {RAYDIUM_ACCOUNT_KEYS,decodeRaydiumAccounts,decodeTrades} from './market-chain.js';
const RPCS=Object.freeze(['https://solana-rpc.publicnode.com','https://api.mainnet-beta.solana.com']);
const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const METHODS=new Set(['getGenesisHash','getMultipleAccounts','getSignaturesForAddress','getTransaction']);
const DAY=86400000;
const validSig=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s);
const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
async function json(fetcher,url,options={}){
  const controller=new AbortController();let timer;
  const work=(async()=>{const r=await fetcher(url,{...options,redirect:'error',signal:controller.signal});if(!r.ok)throw Error('SOURCE_UNAVAILABLE');
    const reader=r.body.getReader();let total=0;const chunks=[];
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>2*1024*1024){await reader.cancel();throw Error('SOURCE_TOO_LARGE');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));})();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('SOURCE_TIMEOUT'));},7000);})]);}
  finally{clearTimeout(timer);}
}
export function createLiveMarket({fetcher=globalThis.fetch,now=Date.now}={}){
  let chain=null,chainAttempt=0,chainFlight=null,historyAttempt=0,historyFlight=null,statsAttempt=0,statsFlight=null,statistics=null,usd=null;
  const verifiedRpc=new Map(),records=new Map(),retryAfter=new Map();
  const venues=[MARKET.raydium].map(pool=>({pool,signatures:new Map(),latest:[],cursor:null,oldest:null,complete:false,headAt:0,gap:false}));
  async function rpc(method,params){
    if(!METHODS.has(method))throw Error('READ_ONLY_METHOD_REQUIRED');
    for(const endpoint of RPCS)try{
      const call=async(m,p)=>{const r=await json(fetcher,endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})});if(r.error||!('result'in r))throw Error('RPC_UNAVAILABLE');return r.result;};
      if(now()-(verifiedRpc.get(endpoint)??0)>300000){if(await call('getGenesisHash',[])!==GENESIS)throw Error('WRONG_NETWORK');verifiedRpc.set(endpoint,now());}
      return await call(method,params);
    }catch{}
    throw Error('MARKET_RPC_UNAVAILABLE');
  }
  async function accounts(){try{chain=decodeRaydiumAccounts(await rpc('getMultipleAccounts',[RAYDIUM_ACCOUNT_KEYS,{commitment:'finalized',encoding:'base64'}]),now());}catch{}finally{chainFlight=null;}}
  async function history(){
    try{
      for(const v of venues){
        try{
          const head=await rpc('getSignaturesForAddress',[v.pool,{limit:100,commitment:'finalized'}]);
          if(!Array.isArray(head)||head.length>100)throw Error('BAD_HISTORY');
          // A full page without overlap after an earlier head can conceal missed activity.
          if(v.headAt&&head.length===100&&!head.some(x=>v.signatures.has(x.signature)))v.gap=true;
          const ingest=list=>{for(const s of list){if(!validSig(s.signature)||s.confirmationStatus!=='finalized'||!Number.isInteger(s.blockTime))throw Error('UNFINALIZED_HISTORY');
            if(s.blockTime*1000>now()+5000)throw Error('INVALID_TIME');v.signatures.set(s.signature,s);}
            if(list.length){v.oldest=Math.min(v.oldest??Infinity,...list.map(x=>x.blockTime*1000));}};
          ingest(head);v.latest=head.map(s=>s.signature);v.headAt=now();
          if(!v.cursor){if(head.length)v.cursor=head.at(-1).signature;if(head.length<100)v.complete=true;}
          if(!v.complete&&v.oldest>now()-7*DAY&&v.signatures.size<2000){
            const tail=await rpc('getSignaturesForAddress',[v.pool,{limit:100,before:v.cursor,commitment:'finalized'}]);
            if(!Array.isArray(tail)||tail.length>100)throw Error('BAD_HISTORY');ingest(tail);if(tail.length)v.cursor=tail.at(-1).signature;if(tail.length<100)v.complete=true;
          }
          if(v.signatures.size>2000){const sorted=[...v.signatures.values()].sort((a,b)=>b.slot-a.slot);if(sorted[2000].blockTime*1000>=now()-DAY)v.gap=true;
            v.signatures=new Map(sorted.slice(0,2000).map(s=>[s.signature,s]));v.complete=false;v.oldest=Math.min(...[...v.signatures.values()].map(s=>s.blockTime*1000));}
        }catch{v.headAt=0;}
      }
      const todo=[...new Map(venues.flatMap(v=>[...v.signatures.values()].map(s=>[s.signature,s]))).values()]
        .filter(s=>!records.has(s.signature)&&(retryAfter.get(s.signature)??0)<=now()).sort((a,b)=>b.slot-a.slot).slice(0,24);
      // Two bounded readers; clients share one in-flight refresh. Failed reads are retried next refresh.
      let i=0;async function worker(){while(i<todo.length){const s=todo[i++];if(s.err){records.set(s.signature,{trades:[],time:s.blockTime*1000,decoded:true});continue;}
        try{const tx=await rpc('getTransaction',[s.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]);if(!tx)throw Error('TRANSACTION_UNAVAILABLE');
          const trades=decodeTrades(tx,s.signature,now(),true);records.set(s.signature,{trades,time:s.blockTime*1000,decoded:true});
        }catch{retryAfter.set(s.signature,now()+300000); /* Unverified records never become fills; retry without starving backfill. */ }
      }}
      await Promise.all([worker(),worker()]);
      for(const [sig,r]of records)if(r.time<now()-7*DAY)records.delete(sig);
      for(const v of venues)for(const [sig,s]of v.signatures)if(s.blockTime*1000<now()-7*DAY)v.signatures.delete(sig);
      const retained=new Set(venues.flatMap(v=>[...v.signatures.keys()]));
      for(const sig of records.keys())if(!retained.has(sig))records.delete(sig);
      for(const sig of retryAfter.keys())if(!retained.has(sig))retryAfter.delete(sig);
    }finally{historyFlight=null;}
  }
  async function stats(){
    const results=await Promise.allSettled([
      json(fetcher,'https://api-v3.raydium.io/pools/info/ids?ids='+MARKET.raydium),
      json(fetcher,'https://api.exchange.coinbase.com/products/SOL-USD/ticker'),
    ]);
    const [r,c]=results.map(x=>x.status==='fulfilled'?x.value:null),at=now();let raydium=null;
    const p=r?.success&&r.data?.length===1?r.data[0]:null;
    if(p?.id===MARKET.raydium&&p.mintA?.address===MARKET.wsol&&p.mintB?.address===MARKET.mint)raydium={tvlUsd:finite(p.tvl),volume24hUsd:finite(p.day?.volume),source:'RAYDIUM_API_ESTIMATE'};
    if(raydium)statistics={observedAt:at,raydium,orca:null};
    const price=finite(c?.price),bid=finite(c?.bid),ask=finite(c?.ask),time=Date.parse(c?.time);
    if(price>0&&bid>0&&ask>=bid&&(ask-bid)/bid<.02&&Math.abs(at-time)<60000)usd={price,observedAt:at,tradeAt:time,source:'COINBASE_SOL_USD_LAST_TRADE'};
    statsFlight=null;
  }
  function kick(){const at=now();
    if(!chainFlight&&(!chainAttempt||at-chainAttempt>=30000)){chainAttempt=at;chainFlight=accounts();}
    if(!historyFlight&&(!historyAttempt||at-historyAttempt>=60000)){historyAttempt=at;historyFlight=history();}
    if(!statsFlight&&(!statsAttempt||at-statsAttempt>=60000)){statsAttempt=at;statsFlight=stats().catch(()=>{statsFlight=null;});}
  }
  function snapshot(){
    const at=now(),age=chain?at-chain.observedAt:Infinity,usable=age<=FRESHNESS.retainMs,live=age<=FRESHNESS.accountsMs;
    const raydium=usable?chain.raydium:null;
    const feedFresh=venues.every(v=>v.headAt>0&&at-v.headAt<=FRESHNESS.historyMs);
    const headKnown=venues.every(v=>v.latest.every(s=>records.has(s)));
    const covered=feedFresh&&venues.every(v=>!v.gap&&(v.complete||v.oldest!==null&&v.oldest<=at-DAY)&&[...v.signatures.values()].filter(s=>s.blockTime*1000>=at-DAY).every(s=>records.has(s.signature)));
    const trades=usable?[...records.values()].flatMap(r=>r.trades).filter(t=>t.venue==='RAYDIUM'&&raydium&&t.timestamp>=at-7*DAY).sort((a,b)=>b.timestamp-a.timestamp||b.slot-a.slot):[];
    const last=trades[0]??null,order=raydium?.order;
    const currentAsk=live&&['ACTIVE','PARTIALLY_FILLED'].includes(order?.status)&&raydium.status==='ACTIVE'?Number(order.askSol):null;
    // Preference is explicit. No executable quote is claimed without a verified executable source.
    const latest=feedFresh&&headKnown?last:null;
    const priceSol=latest?.priceSol??currentAsk??raydium?.referencePriceSol??null;
    const priceType=latest?'LAST_FINALIZED_TRADE':currentAsk!==null?'TRACKED_ORDER_ASK':priceSol!==null?'POOL_REFERENCE':'UNAVAILABLE';
    const priceAt=latest?.timestamp??(usable?chain.observedAt:null);
    const usdLive=usd&&at-usd.tradeAt<=FRESHNESS.usdMs;
    const daily=trades.filter(t=>t.timestamp>=at-DAY),ps=daily.map(t=>t.priceSol);
    // Raydium pool trade metrics sum actual swaps, not provider estimates. No extrapolation.
    const stats24h={changePct:covered&&daily.length>=2?(daily[0].priceSol/daily.at(-1).priceSol-1)*100:null,
      changeBasis:'FIRST_TO_LAST_OBSERVED_TRADE_IN_24H',volumeSol:covered?daily.reduce((s,t)=>s+Number(t.sol),0):null,
      highSol:covered&&ps.length?Math.max(...ps):null,lowSol:covered&&ps.length?Math.min(...ps):null,tradeCount:covered?daily.length:null};
    return {version:1,mode:'DISPLAY_ONLY',venues:['RAYDIUM'],mint:MARKET.mint,network:'MAINNET',marketHealth:!usable?'UNAVAILABLE':!live?'STALE':raydium&&feedFresh&&['ACTIVE','PARTIALLY_FILLED','FILLED'].includes(order?.status)?'LIVE':'PARTIAL',
      timestamp:at,observedAt:usable?chain.observedAt:null,slot:usable?chain.slot:null,freshness:FRESHNESS,priceSol,priceType,priceAt,
      priceUsd:priceSol!==null&&usdLive?priceSol*usd.price:null,usdSource:usdLive?usd:null,stats24h,
      lastTrade:last,trackedAskSol:currentAsk,bestBuyQuote:null,trades:trades.slice(0,500),history:{observedAt:Math.min(...venues.map(v=>v.headAt)),health:feedFresh?'FRESH':'UNAVAILABLE',complete24h:covered,headVerified:headKnown&&feedFresh,scope:'VERIFIED_POOL_SWAP_EVENTS',retentionDays:7},
      raydium,orca:null,statistics:statistics&&at-statistics.observedAt<=FRESHNESS.statisticsMs?statistics:null};
  }
  return {get(){kick();return snapshot();},peek:snapshot,async settled(){await Promise.allSettled([chainFlight,historyFlight,statsFlight]);return snapshot();}};
}
const market=createLiveMarket();
export function liveMarketResponse(query={}){if(Object.keys(query).length)throw Object.assign(Error('This market display has no parameters.'),{kind:'input'});return {value:market.get(),ttlSec:5};}
