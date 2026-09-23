// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {BurnRuntime,burnRuntimeErrorCode} from '../../../services/bridge-validator/burn-runtime.mjs';
import {BurnUserApi} from '../../../services/bridge-validator/burn-user-api.mjs';
import {listenBurnUserApi} from '../../../services/bridge-validator/burn-user-http.mjs';
import {base58Encode} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {burnFixture} from './burn-fixture.mjs';

function publicFixture(t) {
  const f=burnFixture();t.after(f.destroy);const calls=[];
  // Transport fixture only. No signer, RPC, verifier or real operation is used.
  const runtime=Object.create(BurnRuntime.prototype);
  runtime.publicContext=()=>f.context;
  runtime.status=()=>({architecture:'ONE_WAY_AUTOMATIC_BURN_AND_MINT',state:'HEALTHY',environment:'localnet',nativeNetwork:'REGTEST',solanaNetwork:'LOCALNET',
    mintHex:f.binding.mint,reconciliation:'MATCH',accounting:{completedAtomic:'0',mintedAtomic:'0',finalizedNativeBurnAtomic:'0',liveMintSupplyAtomic:'0',observedAt:Date.now()},privateConfig:'PRIVATE_TEST_SENTINEL'});
  const op={operationId:f.id,state:'DEPOSIT_ADDRESS_ISSUED',destinationHex:f.binding.destination,mintHex:f.binding.mint,depositAddress:f.state.operations[0].depositAddress,
    amountAtomic:null,depositTxid:null,depositConfirmations:0,requiredDepositConfirmations:12,burnTxid:null,burnAmountAtomic:null,burnConfirmations:null,
    requiredBurnConfirmations:12,solanaSignature:null,exception:null,retired:false};
  runtime.createOperation=async input=>{calls.push(input);return op;};
  runtime.operation=id=>{if(id!==f.id)throw new Error('BurnJournalOperationUnknown');return op;};
  return {f,calls,runtime,api:new BurnUserApi({runtime}),input:{clientNonce:f.binding.nonce,destination:base58Encode(Buffer.from(f.binding.destination,'hex')),walletChain:'solana:localnet'}};
}

test('public operation creation accepts only a bound wallet and nonce, never browser amounts or signing inputs',async t=>{
  const {f,calls,api,input}=publicFixture(t);
  const result=await api.createOperation(input);assert.equal(result.destination,input.destination);assert.equal(result.amountAtomic,null);
  assert.deepEqual(calls,[{destinationHex:f.binding.destination,nonce:f.binding.nonce}]);
  for(const change of [{amountAtomic:'100'},{rawTransaction:'00'},{rpc:'https://invalid.example'},{privateKey:'PRIVATE_TEST_SENTINEL'},
    {walletChain:'solana:mainnet'},{destination:'invalid'}])await assert.rejects(api.createOperation({...input,...change}));
  assert.equal(calls.length,1);assert.equal(api.getOperationStatus('00'.repeat(32)),null);
  assert(!JSON.stringify(api.getBridgeStatus()).includes('PRIVATE_TEST_SENTINEL'));
});

test('authenticated loopback surface rejects reverse/admin/RPC routes, foreign origins, oversized requests and secret errors',async t=>{
  const {api,input,runtime}=publicFixture(t),token=randomBytes(32);
  const server=await listenBurnUserApi({api,accessToken:token});t.after(()=>{server.closeAllConnections();server.close();token.fill(0);});
  const endpoint=`http://127.0.0.1:${server.address().port}`,headers={authorization:'Bearer '+token.toString('hex'),'content-type':'application/json'};
  const request=(route,options={})=>fetch(endpoint+route,{headers,...options});
  assert.equal((await request('/bridge/status',{headers:{}})).status,403);
  assert.equal((await request('/bridge/status',{headers:{...headers,origin:'https://invalid.example'}})).status,403);
  // fetch owns Host; use the HTTP client to actually send the hostile header.
  const badHost=await new Promise((resolve,reject)=>{const req=httpRequest(endpoint+'/bridge/status',{headers:{...headers,host:'invalid.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(badHost,403);
  const status=await (await request('/bridge/status')).json();assert.equal(status.supply.bridgedSupplyAtomic,'0');assert.equal(status.productionReady,false);
  for(const route of ['/withdraw','/withdrawals','/payout','/burn','/sign','/rpc','/pause','/resume','/deposits/request','/deposits/submit']){
    const response=await request(route,{method:'POST',body:'{}'});assert.equal(response.status,404);
  }
  assert.equal((await request('/operations',{method:'POST',body:JSON.stringify(input)})).status,200);
  assert.equal((await request('/operations',{method:'POST',body:'x'.repeat(2049)})).status,413);
  assert.equal((await request('/operations',{method:'POST',headers:{...headers,'content-type':'text/plain'},body:'{}'})).status,415);
  runtime.createOperation=async()=>{throw new Error('PRIVATE_TEST_SENTINEL');};
  const failure=await request('/operations',{method:'POST',body:JSON.stringify(input)});assert.equal(failure.status,400);assert(!(await failure.text()).includes('PRIVATE_TEST_SENTINEL'));
  for(let n=0;n<15;n++){
    const response=await request('/operations',{method:'POST',body:'{}'});
    if(n===14)assert.equal(response.status,429);
  }
});

test('runtime diagnostics retain structured failure codes without RPC bodies or credentials',()=>{
  assert.equal(burnRuntimeErrorCode(new Error('NativeRpcRejected:getblockhash:-5')),'NATIVE_RPC_UNAVAILABLE');
  assert.equal(burnRuntimeErrorCode(new Error('NativeRpcUnavailable:getblockhash')),'NATIVE_RPC_UNAVAILABLE');
  assert.equal(burnRuntimeErrorCode(new Error('BURN_MINT_RECONCILIATION_MISMATCH')),'BURN_MINT_RECONCILIATION_MISMATCH');
  const privateUrl=new URL('https://invalid.example');privateUrl.username='test-user';privateUrl.password='PRIVATE_TEST_SENTINEL';
  assert.equal(burnRuntimeErrorCode(new Error(privateUrl.href)),'BURN_VALIDATION_FAILED');
});
