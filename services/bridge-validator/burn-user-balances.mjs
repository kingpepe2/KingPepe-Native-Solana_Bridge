// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Read-only public addresses; no wallet secrets or RPC forwarding.
import {NativeRpcClient,SOURCE_READY} from '../../native/node/native-rpc-client.mjs';
import {nativeIdentity} from '../../shared/network-identity.mjs';
import {scriptFromWitnessAddress} from '../../native/node/witness-address.mjs';
import {BurnSolanaAdapter} from '../solana-observer/burn-solana-adapter.mjs';
import {base58Decode,base58Encode} from './solana-deposit-claim-transaction-plan.mjs';
import {stableJson} from '../../shared/protocol/canonical-message.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';
export class BurnUserBalances {
  #native;#solana;#cache=new Map();#busy=false;#next=0;
  constructor({nativeRpc,solana}) {
    check(nativeRpc instanceof NativeRpcClient&&solana instanceof BurnSolanaAdapter,'BurnBalanceConcreteAdaptersRequired');
    this.#native=nativeRpc;this.#solana=solana;
  }
  assertBurnContext(context){check(stableJson(context)===stableJson(this.#solana.policy.context),'BurnBalanceContextMismatch');}
  async read(network,address){
    check(network==='native'||network==='solana','BurnBalanceNetworkRejected');
    const identity=nativeIdentity(this.#solana.policy.context.environment);
    if(network==='native'){scriptFromWitnessAddress(address,identity.hrp);address=address.toLowerCase();}
    else{check(typeof address==='string'&&base58Decode(address).length===32&&base58Encode(base58Decode(address))===address,'BurnBalanceAddressRejected');}
    const key=network+':'+address,time=Date.now(),cached=this.#cache.get(key);
    if(cached&&time>=cached.at&&time-cached.at<20000)return structuredClone(cached.value);
    check(!this.#busy&&time>=this.#next,'BurnBalanceRetryLater');this.#busy=true;this.#next=time+1000;
    try{
      let value;
      if(network==='solana')value=await this.#solana.publicBalance(address);
      else {
        const observe=()=>this.#native.getSourceSnapshot({expectedNetwork:identity.rpcChain,expectedGenesisHash:identity.genesis});
        const before=await observe();check(before.state===SOURCE_READY,'BurnBalanceNetworkRejected');
        const balance=await (identity.environment==='mainnet'?this.#native.scanMainnetAddressBalance(address):this.#native.scanAddressBalance(address)),after=await observe();
        check(after.state===SOURCE_READY&&before.bestHash===after.bestHash&&balance.bestBlockHash===after.bestHash,'BurnBalanceSourceChanged');
        value={address,network:identity.network.toUpperCase(),decimals:8,amountAtomic:balance.amountAtomic,kind:'CONFIRMED_UTXO'};
      }
      if(this.#cache.size>=128)this.#cache.delete(this.#cache.keys().next().value);
      this.#cache.set(key,{at:Date.now(),value});return structuredClone(value);
    }finally{this.#busy=false;}
  }
}
