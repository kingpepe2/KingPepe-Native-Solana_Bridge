// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Bounded REGTEST discovery. Observations never substitute for the independent
// raw header/Merkle verifier required before burn or attestation.
import {createHash} from 'node:crypto';
import {NativeRpcClient} from '../node/native-rpc-client.mjs';
import {parseNativeTransactionHex} from '../node/native-taproot-transaction.mjs';
import {burnHash,requireBurn as check,nativeAmountRpcString,validateNativeBurnTransaction} from './burn-protocol.mjs';
import {verifyNativeBurnSignatures} from './burn-key.mjs';
import {validateRegtestBurnNetwork} from './burn-evidence.mjs';

const sha256d=b=>createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
function merkle(ids) {
  let level=ids.map(id=>Buffer.from(burnHash(id),'hex').reverse());
  check(level.length>0&&new Set(ids).size===ids.length,'BurnObserverBlockTransactionsRejected');
  while(level.length>1){const next=[];for(let n=0;n<level.length;n+=2)next.push(sha256d(Buffer.concat([level[n],level[n+1]??level[n]])));level=next;}
  return level[0];
}
function remembered(op) {
  const rows=[...(op.deposit?[op.deposit]:[]),...(op.exception?.deposits??[])];
  return [...new Map(rows.map(v=>[`${v.txid}:${v.vout}`,v])).values()];
}
export class RegtestBurnObserver {
  #rpc;
  constructor(rpc){check(rpc instanceof NativeRpcClient,'NativeBurnRpcRequired');this.#rpc=rpc;}
  async network(){
    const c=await this.#rpc.getBlockchainInfo();
    validateRegtestBurnNetwork(c,(await this.#rpc.call('getblockhash',[0])).result);
    return {height:c.blocks,hash:burnHash(c.bestblockhash)};
  }
  async discover(state) {
    const tip=await this.network();if(state.operations.length===0)return {tip,cursor:state.nativeScan,observations:[],caughtUp:true};
    const observations=new Map(state.operations.map(op=>[op.operationId,new Map()]));
    // Refresh known deposits from authoritative chain membership, including
    // already-spent originals and retired addresses. Missing unfinalized coins
    // do not become mint credit; a changed accepted basis pauses in the journal.
    for(const op of state.operations)for(const prior of remembered(op)) {
      let tx;
      try{tx=await this.#rpc.getRawTransaction(prior.txid,true);}catch(e){if(e.rpcCode===-5)continue;throw e;}
      if(tx.confirmations<0)continue;
      const raw=parseNativeTransactionHex(tx.hex);check(raw.txidHex===prior.txid,'BURN_DEPOSIT_TRANSACTION_CHANGED');
      const out=raw.outputs[prior.vout];check(out?.scriptPubKeyHex===op.depositScriptHex&&out.amountAtomic===prior.amountAtomic,'BURN_DEPOSIT_TRANSACTION_CHANGED');
      let height=0,blockHash=null,confirmations=0;
      if(tx.blockhash){const header=(await this.#rpc.call('getblockheader',[tx.blockhash,true])).result;
        if(header.confirmations<0)continue;blockHash=burnHash(tx.blockhash);height=header.height;confirmations=tip.height-height+1;
        check(height>0&&confirmations>0&&(await this.#rpc.call('getblockhash',[height])).result===blockHash,'BURN_NATIVE_DISCOVERY_CHANGED');}
      observations.get(op.operationId).set(`${prior.txid}:${prior.vout}`,{txid:prior.txid,vout:prior.vout,amountAtomic:out.amountAtomic,height,blockHash,confirmations});
    }
    let cursor=structuredClone(state.nativeScan);
    if(cursor===null){const height=Math.max(0,Math.min(...state.operations.map(o=>o.createdHeight))-1);
      const hash=burnHash((await this.#rpc.call('getblockhash',[height])).result);cursor={height,hash,recent:[{height,hash}]};}
    if(cursor.height>tip.height||(await this.#rpc.call('getblockhash',[cursor.height])).result!==cursor.hash){
      let common;
      for(const item of [...cursor.recent].reverse())if(item.height<=tip.height&&(await this.#rpc.call('getblockhash',[item.height])).result===item.hash){common=item;break;}
      check(common,'BURN_NATIVE_REORG_BEYOND_FINALITY');cursor={...common,recent:cursor.recent.filter(v=>v.height<=common.height)};
    }
    const byScript=new Map(state.operations.map(op=>[op.depositScriptHex,op]));
    const accept=(tx,height,blockHash)=>{
      for(const [vout,out] of tx.outputs.entries()) {
        const op=byScript.get(out.scriptPubKeyHex);if(!op||BigInt(out.amountAtomic)===0n)continue;
        // Discovery records the payment; independent admission rejects coinbase
        // inputs for this operation without stopping unrelated users' discovery.
        const rows=observations.get(op.operationId);check(rows.size<64||rows.has(`${tx.txidHex}:${vout}`),'BURN_DEPOSIT_OBSERVATION_CAPACITY');
        rows.set(`${tx.txidHex}:${vout}`,{txid:tx.txidHex,vout,amountAtomic:out.amountAtomic,height,blockHash,confirmations:height===0?0:tip.height-height+1});
      }
    };
    const end=Math.min(tip.height,cursor.height+64);
    for(let height=cursor.height+1;height<=end;height++){
      const hash=burnHash((await this.#rpc.call('getblockhash',[height])).result),block=(await this.#rpc.call('getblock',[hash,1])).result;
      const header=Buffer.from((await this.#rpc.call('getblockheader',[hash,false])).result,'hex');
      check(header.length===80&&sha256d(header).reverse().toString('hex')===hash&&
        header.subarray(4,36).reverse().toString('hex')===cursor.hash&&Array.isArray(block.tx)&&block.tx.length<=100000&&
        merkle(block.tx).equals(header.subarray(36,68)),'BURN_NATIVE_BLOCK_REJECTED');
      for(const id of block.tx){const raw=parseNativeTransactionHex(await this.#rpc.getRawTransaction(id,false,hash));check(raw.txidHex===id,'BURN_NATIVE_TRANSACTION_REJECTED');accept(raw,height,hash);}
      cursor={height,hash,recent:[...cursor.recent,{height,hash}].slice(-13)};
    }
    const pool=(await this.#rpc.call('getrawmempool',[false])).result;
    check(Array.isArray(pool)&&pool.length<=4096,'BURN_MEMPOOL_DISCOVERY_INCOMPLETE');
    for(const id of pool){
      let tx;try{tx=parseNativeTransactionHex(await this.#rpc.getRawTransaction(id,false));}catch(e){if(e.rpcCode===-5)throw new Error('BURN_MEMPOOL_CHANGED_RETRY');throw e;}
      check(tx.txidHex===id,'BURN_MEMPOOL_TRANSACTION_REJECTED');accept(tx,0,null);
    }
    check((await this.network()).hash===tip.hash,'BURN_NATIVE_DISCOVERY_CHANGED');
    return {tip,cursor,observations:[...observations].map(([id,rows])=>({id,observations:[...rows.values()]})),caughtUp:cursor.height===tip.height};
  }
  async operationalCoins(scriptPubKeyHex,reserved) {
    check(/^5120[0-9a-f]{64}$/u.test(scriptPubKeyHex),'BurnOperationalScriptRejected');
    const tip=await this.network(),scan=(await this.#rpc.call('scantxoutset',['start',[`raw(${scriptPubKeyHex})`]])).result;
    check(scan?.success===true&&scan.bestblock===tip.hash&&Array.isArray(scan.unspents)&&scan.unspents.length<=4096,'BURN_FEE_DISCOVERY_UNAVAILABLE');
    const coins=[];
    for(const u of scan.unspents){
      if(reserved.has(`${u.txid}:${u.vout}`))continue;
      const coin=await this.#rpc.getUtxoObservation({txid:u.txid,vout:u.vout,includeMempool:true});
      if(!coin.unspent||coin.coinbase||coin.confirmations<12)continue;
      const tx=parseNativeTransactionHex(await this.#rpc.getRawTransaction(u.txid,false)),out=tx.outputs[u.vout];
      check(tx.txidHex===u.txid&&out?.scriptPubKeyHex===scriptPubKeyHex&&out.amountAtomic===coin.valueAtomic,'BURN_FEE_COIN_CHANGED');
      coins.push({txid:u.txid,vout:u.vout,amountAtomic:out.amountAtomic,scriptPubKeyHex});
    }
    return coins.sort((a,b)=>BigInt(a.amountAtomic)<BigInt(b.amountAtomic)?-1:BigInt(a.amountAtomic)>BigInt(b.amountAtomic)?1:a.txid.localeCompare(b.txid));
  }
  async burnStatus(plan) {
    await this.network();let tx;
    try{tx=await this.#rpc.getRawTransaction(plan.txid,true);}catch(e){if(e.rpcCode===-5)return {found:false,confirmations:0};throw e;}
    const parsed=parseNativeTransactionHex(tx.hex);check(parsed.txidHex===plan.txid&&parsed.strippedHex===plan.unsignedTransactionHex,'BURN_TRANSACTION_CHANGED');
    verifyNativeBurnSignatures({rawTransactionHex:tx.hex,inputs:plan.inputs});
    return {found:tx.confirmations===undefined||tx.confirmations>=0,confirmations:tx.confirmations??0,rawTransactionHex:tx.hex};
  }
  async broadcast(plan,signedHex,maximumRateAtomicPerKvB) {
    await this.network();const known=await this.burnStatus(plan);if(known.found)return plan.txid;
    check(parseNativeTransactionHex(signedHex).strippedHex===plan.unsignedTransactionHex,'BURN_TRANSACTION_CHANGED');
    validateNativeBurnTransaction({rawTransactionHex:signedHex,operationId:plan.operationId,inputs:plan.inputs,operationalScriptHex:plan.operationalScriptHex,
      expectedFeeAtomic:plan.feeAtomic,maximumFeeAtomic:plan.maximumFeeAtomic});verifyNativeBurnSignatures({rawTransactionHex:signedHex,inputs:plan.inputs});
    for(const input of plan.inputs){const coin=await this.#rpc.getUtxoObservation({...input,includeMempool:true});check(coin.unspent&&coin.valueAtomic===input.amountAtomic,'BURN_INPUT_SPENT_OR_AMBIGUOUS');}
    const txid=(await this.#rpc.call('sendrawtransaction',[signedHex,nativeAmountRpcString(maximumRateAtomicPerKvB),plan.maxburnamount])).result;
    check(txid===plan.txid,'BURN_BROADCAST_ID_MISMATCH');return txid;
  }
}
