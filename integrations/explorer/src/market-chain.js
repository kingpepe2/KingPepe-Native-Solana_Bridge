// Read-only decoders. Layouts reviewed against official Raydium ed7c84a and Orca 408c945.
// No signer, transaction builder, private journal or Bridge runtime dependencies.
import {createHash} from 'node:crypto';
import {base58} from '../web/bridge-vendor/base.js';
import {MARKET} from '../web/market-identities.js';
export const PROGRAMS=Object.freeze({raydium:'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',orca:'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',token:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'});
export const TICK='BSuQRtDjp6d1pMBGma1KuLzNyXME1m1UBq2eAPEEGf9H';
export const VAULTS=Object.freeze(['59oNBEiucV8aGKTfqWxDK316eTEYRHTZnovpspo6HZFD','DEUdEqUa8QDcnqq9oBm7oD2UzBTxExUue7VV6FhWY9qD','5Nc5fRbKRLoXouCBCJHsFer6MGnX8VV2dnkRxtvYLyM4','4BgxvCYDyCYXtd89hDKFa3nyZtxWaX3m4GWTWdWiw8u5']);
export const ACCOUNT_KEYS=Object.freeze([MARKET.mint,MARKET.raydium,MARKET.order,TICK,MARKET.orca,...VAULTS]);
// The current dashboard reads Raydium only. The legacy decoder remains compatible
// with earlier snapshots, but no Orca account is requested by the live reader.
export const RAYDIUM_ACCOUNT_KEYS=Object.freeze([MARKET.mint,MARKET.raydium,MARKET.order,TICK,...VAULTS.slice(0,2)]);
const Q=1n<<64n,INITIAL=1000n*100000000n;
const check=(ok)=>{if(!ok)throw Error('MARKET_IDENTITY_OR_LAYOUT_UNVERIFIED');};
export const discriminator=(type,name)=>createHash('sha256').update(type+':'+name).digest().subarray(0,8);
const pub=(b,o)=>base58.encode(b.subarray(o,o+32));
const u128=(b,o)=>b.readBigUInt64LE(o)+(b.readBigUInt64LE(o+8)<<64n);
export function decimal(value,places){const n=BigInt(value),d=10n**BigInt(places);return (n/d)+'.'+(n%d).toString().padStart(places,'0');}
function data(a,program,length,name){check(a?.owner===program&&!a.executable&&a.data?.[1]==='base64');const b=Buffer.from(a.data[0],'base64');check(b.length===length);if(name)check(b.subarray(0,8).equals(discriminator('account',name)));return b;}
function vault(a,mint,owner){const b=data(a,PROGRAMS.token,165);check(pub(b,0)===mint&&pub(b,32)===owner&&b[108]===1);return b.readBigUInt64LE(64);}
const price=sqrt=>{check(sqrt>0n);return 10**(8-9)/(Number(sqrt)/2**64)**2;};
export function decodeOrder(account,tickAccount){
  if(!account)return {status:'ACCOUNT_UNAVAILABLE',askSol:null,remainingKpepe:null,filledKpepe:null,claimableWsol:null,settledWsol:null};
  const b=data(account,PROGRAMS.raydium,173,'LimitOrderState'),t=data(tickAccount,PROGRAMS.raydium,10240,'TickArrayState');
  check(pub(b,8)===MARKET.raydium&&pub(b,40)===MARKET.orderOwner&&b.readInt32LE(72)===0&&b[76]===0);
  check(pub(t,8)===MARKET.raydium&&t.readInt32LE(40)===0&&t.readInt32LE(44)===0);
  const phase=b.readBigUInt64LE(77),total=b.readBigUInt64LE(85),filled=b.readBigUInt64LE(93),base=b.readBigUInt64LE(101),paid=b.readBigUInt64LE(109),ratio=u128(b,125),tp=t.readBigUInt64LE(160),tr=u128(t,184);
  check(total===INITIAL&&filled<=total&&tp>=phase);
  let remaining,output;
  if(base===0n){check(filled===total);remaining=0n;output=0n;check(paid===0n);}
  else {
    // A changed/decreased order needs another reviewed computation segment; never guess.
    check(base===total&&ratio===Q);
    if(tp===phase){check(filled===0n&&paid===0n);remaining=total;output=0n;}
    else if(tp===phase+1n){check(tr<=ratio);const n=base*tr;remaining=n/ratio;const f=base-remaining;output=f===0n?0n:f-(n%ratio===0n?0n:1n);}
    else {remaining=0n;output=base;}
    check(output>=paid&&total-remaining>=filled);
  }
  const effectiveFilled=total-remaining;
  return {status:remaining===0n?'FILLED':effectiveFilled>0n?'PARTIALLY_FILLED':'ACTIVE',askSol:'0.100000000',initialKpepe:'1000.00000000',remainingKpepe:decimal(remaining,8),filledKpepe:decimal(effectiveFilled,8),claimableWsol:decimal(output-paid,9),
    // Full settlement resets the program counter; historical cumulative settlement is not in this field.
    settledWsol:base===0n?null:decimal(paid,9),settledScope:'CURRENT_COMPUTATION_SEGMENT',tick:0};
}
export function decodeAccounts(result,now){
  check(Number.isSafeInteger(result?.context?.slot)&&result.value?.length===ACCOUNT_KEYS.length);
  const [mint,ray,order,tick,orca,...v]=result.value;
  const m=data(mint,PROGRAMS.token,82);check(m[44]===8&&m[45]===1&&m.readUInt32LE(46)===0);
  const out={observedAt:now,slot:result.context.slot,mint:MARKET.mint,raydium:null,orca:null};
  try{
    const b=data(ray,PROGRAMS.raydium,1544,'PoolState');
    check(pub(b,73)===MARKET.wsol&&pub(b,105)===MARKET.mint&&b[233]===9&&b[234]===8&&b.readUInt16LE(235)===60);
    check(pub(b,137)===VAULTS[0]&&pub(b,169)===VAULTS[1]);
    const sol=vault(v[0],MARKET.wsol,MARKET.raydium),kpepe=vault(v[1],MARKET.mint,MARKET.raydium);
    out.raydium={pool:MARKET.raydium,status:(b[389]&16)?'SWAPS_DISABLED':'ACTIVE',referencePriceSol:price(u128(b,253)),liquidityUnits:u128(b,237).toString(),tick:b.readInt32LE(269),vaultSol:decimal(sol,9),vaultKpepe:decimal(kpepe,8),order:{address:MARKET.order,owner:MARKET.orderOwner}};
    try{Object.assign(out.raydium.order,decodeOrder(order,tick));}catch{out.raydium.order.status='UNVERIFIED';}
  }catch{}
  try{
    const b=data(orca,PROGRAMS.orca,653,'Whirlpool');
    check(pub(b,101)===MARKET.wsol&&pub(b,181)===MARKET.mint&&b.readUInt16LE(41)===32896);
    check(pub(b,133)===VAULTS[2]&&pub(b,213)===VAULTS[3]);
    const sol=vault(v[2],MARKET.wsol,MARKET.orca),kpepe=vault(v[3],MARKET.mint,MARKET.orca),liquidity=u128(b,49);
    out.orca={pool:MARKET.orca,status:liquidity>0n?'ACTIVE':'NO_ACTIVE_LIQUIDITY',referencePriceSol:price(u128(b,65)),liquidityUnits:liquidity.toString(),tick:b.readInt32LE(81),vaultSol:decimal(sol,9),vaultKpepe:decimal(kpepe,8),feePct:b.readUInt16LE(45)/10000};
  }catch{}
  check(out.raydium||out.orca);return out;
}
export const EXCLUDED_PARTICIPANTS=Object.freeze([MARKET.orderOwner,'21ySRMngN5PJk1b9aB2xdUcHkw17LbJy8yq4zZmBDhvx','Ea1BQMJeaRtXArcBEz4Y28gzvuxhZdTfTV6XVaJnN3Pg']);
export function decodeRaydiumAccounts(result,now){
  check(result?.value?.length===RAYDIUM_ACCOUNT_KEYS.length);
  const [mint,ray,order,tick,sol,kpepe]=result.value;
  return decodeAccounts({...result,value:[mint,ray,order,tick,null,sol,kpepe,null,null]},now);
}
const sigValid=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s);
export function decodeTrades(tx,signature,now,raydiumOnly=false){
  check(sigValid(signature)&&tx?.transaction?.signatures?.[0]===signature&&Number.isSafeInteger(tx.slot));
  check(tx.meta&&tx.meta.err===null&&Number.isInteger(tx.blockTime)&&tx.blockTime*1000<=now+5000);
  const keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])].map(k=>typeof k==='string'?k:k.pubkey);
  if(EXCLUDED_PARTICIPANTS.some(k=>keys.includes(k)))return [];
  const logs=tx.meta.logMessages;check(Array.isArray(logs)&&logs.length<=5000&&!logs.some(x=>/truncat/i.test(x)));
  const stack=[],trades=[];let n=0;
  for(const line of logs){
    const invoke=/^Program (\w+) invoke \[(\d+)\]$/.exec(line),end=/^Program (\w+) (?:success|failed:.*)$/.exec(line);
    if(invoke){check(Number(invoke[2])===stack.length+1);stack.push(invoke[1]);continue;}
    if(end){check(stack.pop()===end[1]);continue;}
    if(!line.startsWith('Program data: '))continue;
    const b=Buffer.from(line.slice(14),'base64');let venue,sol,kpepe,buy,pool;
    if(stack.at(-1)===PROGRAMS.raydium&&b.subarray(0,8).equals(discriminator('event','SwapEvent'))){
      check(b.length===221&&b[168]<=1);pool=pub(b,8);if(pool!==MARKET.raydium)continue;
      check(b.readBigUInt64LE(144)===0n&&b.readBigUInt64LE(160)===0n);
      venue='RAYDIUM';sol=b.readBigUInt64LE(136);kpepe=b.readBigUInt64LE(152);buy=b[168]===1;
    }else if(!raydiumOnly&&stack.at(-1)===PROGRAMS.orca&&b.subarray(0,8).equals(discriminator('event','Traded'))){
      check(b.length===121&&b[40]<=1);pool=pub(b,8);if(pool!==MARKET.orca)continue;
      check(b.readBigUInt64LE(89)===0n&&b.readBigUInt64LE(97)===0n);
      venue='ORCA';buy=b[40]===1;sol=b.readBigUInt64LE(buy?73:81);kpepe=b.readBigUInt64LE(buy?81:73);
    }else continue;
    check(keys.includes(pool)&&sol>0n&&kpepe>0n);
    // Pair identity is verified by the independent finalized account snapshot before publication.
    const balances=[...(tx.meta.preTokenBalances??[]),...(tx.meta.postTokenBalances??[])];
    check(balances.some(x=>x.mint===MARKET.mint&&x.uiTokenAmount?.decimals===8)&&balances.some(x=>x.mint===MARKET.wsol&&x.uiTokenAmount?.decimals===9));
    trades.push({id:signature+':'+n++,signature,slot:tx.slot,timestamp:tx.blockTime*1000,venue,pool,side:buy?'BUY':'SELL',kpepe:decimal(kpepe,8),sol:decimal(sol,9),priceSol:Number(sol)/Number(kpepe)/10});
  }
  check(stack.length===0);return trades;
}
