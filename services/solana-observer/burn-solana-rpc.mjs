// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Private network-bound transport. Mainnet endpoints enter only through the
// protected launcher's process configuration, never a browser or public file.
import {devnetRpcEndpoint,DEVNET_SOLANA_GENESIS} from '../../shared/solana-test-network.mjs';
import {mainnetRpcEndpoint,SOLANA_MAINNET_GENESIS} from '../../shared/network-identity.mjs';
import {base58Decode} from '../bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';
import {assertWindowsProtectedStore} from '../../shared/windows/protected-store.mjs';
const METHODS=new Set(['getGenesisHash','getHealth','getMultipleAccounts','getAccountInfo','getLatestBlockhash','getBlockHeight',
  'getMinimumBalanceForRentExemption','getSignatureStatuses','getTransaction','getBalance','getTokenAccountsByOwner','getFeeForMessage','getSlot','getBlockTime','sendTransaction']);
export class BurnSolanaRpc {
  #endpoint;#genesis;#id=0;
  constructor({environment,endpoint,expectedGenesis}) {
    check(['localnet','devnet','mainnet'].includes(environment),'BurnSolanaEnvironmentRejected');
    check(base58Decode(expectedGenesis).length===32,'BurnSolanaGenesisRejected');
    if(environment==='devnet'){
      check(expectedGenesis===DEVNET_SOLANA_GENESIS,'BurnSolanaGenesisRejected');
      // The private service file may name this fixed TEST-only process
      // binding. A protected launcher supplies its value in memory, keeping
      // the credential-bearing URL out of configuration files and argv.
      const value=endpoint==='ENV:SOLANA_DEVNET_RPC_URL'?process.env.SOLANA_DEVNET_RPC_URL:endpoint;
      this.#endpoint=devnetRpcEndpoint(value,expectedGenesis);
    }
    else if(environment==='mainnet'){
      check(expectedGenesis===SOLANA_MAINNET_GENESIS,'BurnSolanaGenesisRejected');
      if(endpoint==='ENV:SOLANA_MAINNET_RPC_URL')this.#endpoint=mainnetRpcEndpoint(process.env.SOLANA_MAINNET_RPC_URL,expectedGenesis);
      else{
        // A concrete DPAPI store is admitted, never a URL or browser-shaped
        // object. Service composition also binds its deployment and SID.
        try{assertWindowsProtectedStore(endpoint,'BRIDGE_VALIDATOR','solana-rpc-url');}
        catch{throw Error('BurnSolanaProtectedMainnetEndpointRequired');}
        check(endpoint.context.environment==='mainnet','BurnSolanaProtectedMainnetEndpointRequired');
        const {payload}=endpoint.read();
        try{check(payload.length<=4096,'BurnSolanaProtectedMainnetEndpointRequired');this.#endpoint=mainnetRpcEndpoint(payload.toString('utf8'),expectedGenesis);}
        finally{payload.fill(0);}
      }
    }else {
      let u;try{u=new URL(endpoint);}catch{throw new Error('BurnSolanaEndpointRejected');}
      check(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Number(u.port)>=1024&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password,'BurnSolanaEndpointRejected');
      this.#endpoint=u.href;
    }
    this.#genesis=expectedGenesis;
  }
  async #request(method,params) {
    check(METHODS.has(method)&&Array.isArray(params),'BurnSolanaMethodRejected');const id=++this.#id;check(Number.isSafeInteger(id),'BurnSolanaRequestIdExhausted');
    const body=JSON.stringify({jsonrpc:'2.0',id,method,params});check(Buffer.byteLength(body)<=65536,'BurnSolanaRequestLimit');
    let rpcCode,instructionFailure;
    try{
      const response=await fetch(this.#endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body});
      check(response.body,'BurnSolanaNoResponse');const reader=response.body.getReader(),parts=[];let size=0;
      try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;check(size<=8_388_608,'BurnSolanaResponseLimit');parts.push(value);}}
      finally{await reader.cancel();}
      const result=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(Number.isSafeInteger(result?.error?.code))rpcCode=result.error.code;
      const instruction=result?.error?.data?.err?.InstructionError;
      if(rpcCode===-32002&&Array.isArray(instruction)&&instruction.length===2&&Number.isInteger(instruction[0])&&instruction[0]>=0&&instruction[0]<32){
        const detail=instruction[1];
        const known=new Set(['ProgramFailedToComplete','ComputationalBudgetExceeded','InvalidInstructionData','InvalidAccountData',
          'InvalidArgument','IncorrectProgramId','MissingRequiredSignature','InsufficientFunds','AccountAlreadyInitialized',
          'UninitializedAccount','NotEnoughAccountKeys','AccountNotRentExempt','InvalidSeeds','ArithmeticOverflow']);
        if(typeof detail==='string')instructionFailure=`${instruction[0]}:${known.has(detail)?detail:'UnknownInstructionError'}`;
        else if(detail&&Object.keys(detail).join()==='Custom'&&Number.isInteger(detail.Custom)&&detail.Custom>=0&&detail.Custom<=0xffffffff)
          instructionFailure=`${instruction[0]}:Custom:${detail.Custom}`;
      }
      check(response.ok&&result?.jsonrpc==='2.0'&&result.id===id&&Object.hasOwn(result,'result')&&!Object.hasOwn(result,'error'),'BurnSolanaRpcFailure');return result.result;
    }catch{const error=new Error(instructionFailure?'BURN_SOLANA_PROGRAM_REJECTED':'BURN_SOLANA_RPC_UNAVAILABLE');
      error.rpcMethod=method;if(rpcCode!==undefined)error.rpcCode=rpcCode;if(instructionFailure)error.instructionFailure=instructionFailure;throw error;}
  }
  async genesis(){const genesis=await this.#request('getGenesisHash',[]);check(genesis===this.#genesis,'BURN_SOLANA_NETWORK_MISMATCH');return genesis;}
  async call(method,params=[]) {
    check(METHODS.has(method)&&method!=='getGenesisHash'&&Array.isArray(params),'BurnSolanaMethodRejected');
    if(method==='sendTransaction') {
      const [packet,options]=params;
      check(params.length===2&&typeof packet==='string'&&packet.length>0&&Buffer.from(packet,'base64').length<=1232&&
        Buffer.from(packet,'base64').toString('base64')===packet&&options&&Object.keys(options).sort().join()===
        'encoding,maxRetries,preflightCommitment,skipPreflight'&&options.encoding==='base64'&&options.skipPreflight===false&&
        options.preflightCommitment==='finalized'&&options.maxRetries===0,'BurnSolanaSubmissionPolicyRejected');
    }
    await this.genesis();const result=await this.#request(method,params);await this.genesis();return result;
  }
  async snapshot(addresses,minimumSlot='0') {
    check(Array.isArray(addresses)&&addresses.length>0&&addresses.length<=100&&new Set(addresses).size===addresses.length&&
      addresses.every(a=>base58Decode(a).length===32)&&/^(0|[1-9][0-9]{0,15})$/u.test(minimumSlot),'BurnSolanaSnapshotInput');
    const result=await this.call('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'finalized',minContextSlot:Number(minimumSlot)}]);
    check(Number.isSafeInteger(result?.context?.slot)&&BigInt(result.context.slot)>=BigInt(minimumSlot)&&Array.isArray(result.value)&&result.value.length===addresses.length,'BurnSolanaSnapshotRejected');
    return {genesis:this.#genesis,slot:result.context.slot,accounts:result.value};
  }
  async latestBlockhash(){
    const r=await this.call('getLatestBlockhash',[{commitment:'finalized'}]);
    check(base58Decode(r?.value?.blockhash).length===32&&Number.isSafeInteger(r.value.lastValidBlockHeight)&&r.value.lastValidBlockHeight>0,'BurnSolanaBlockhashRejected');
    return {recentBlockhash:r.value.blockhash,lastValidBlockHeight:String(r.value.lastValidBlockHeight)};
  }
  async signatureStatus(signature){
    check(base58Decode(signature).length===64,'BurnSolanaSignatureRejected');const r=await this.call('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);
    check(Array.isArray(r?.value)&&r.value.length===1,'BurnSolanaStatusRejected');const status=r.value[0];
    if(status!==null)check(Number.isSafeInteger(status.slot)&&status.slot>=0&&Object.hasOwn(status,'err')&&['processed','confirmed','finalized'].includes(status.confirmationStatus),'BurnSolanaStatusRejected');
    return status;
  }
  async finalizedHeight(){const n=await this.call('getBlockHeight',[{commitment:'finalized'}]);check(Number.isSafeInteger(n)&&n>=0,'BurnSolanaHeightRejected');return BigInt(n);}
  async clock(){
    const slot=await this.call('getSlot',[{commitment:'finalized'}]);check(Number.isSafeInteger(slot)&&slot>0,'BurnSolanaClockRejected');
    const time=await this.call('getBlockTime',[slot]);
    check(Number.isSafeInteger(time)&&time>0&&Math.abs(Math.floor(Date.now()/1000)-time)<=120,'BURN_SOLANA_CLOCK_UNAVAILABLE');return BigInt(time);
  }
  async send(packet){
    check(typeof packet==='string'&&Buffer.from(packet,'base64').length<=1232,'BurnSolanaPacketRejected');
    return this.call('sendTransaction',[packet,{encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0}]);
  }
}
