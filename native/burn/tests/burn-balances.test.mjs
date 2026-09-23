// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {burnFixture} from './burn-fixture.mjs';
import {BurnSolanaAdapter} from '../../../services/solana-observer/burn-solana-adapter.mjs';
import {base58Encode} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';

test('public burn wallet balances verify finalized exact-Mint accounts and current program bytes',async t=>{
  const f=burnFixture();t.after(f.destroy);
  const address=base58Encode(Buffer.from(f.binding.destination,'hex')),tokenAddress=base58Encode(Buffer.alloc(32,98));
  const token=Buffer.alloc(165);Buffer.from(f.binding.mint,'hex').copy(token);Buffer.from(f.binding.destination,'hex').copy(token,32);
  token.writeBigUInt64LE(100000n,64);token[108]=1;
  let owner='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',wrongGenesis=false,wrongArtifact=false,discoveryCount=1;
  const methods=[];
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const input=JSON.parse(body);methods.push(input);
    let result;
    if(input.method==='getGenesisHash')result=wrongGenesis?base58Encode(Buffer.alloc(32,77)):f.manifest.solanaGenesis;
    else if(input.method==='getTokenAccountsByOwner')result={context:{slot:Number(f.snapshot.slot)},value:Array.from({length:discoveryCount},()=>({pubkey:tokenAddress}))};
    else {
      assert.equal(input.method,'getMultipleAccounts');assert.equal(input.params[1].commitment,'finalized');
      const accounts=structuredClone(f.snapshot.accounts);
      if(wrongArtifact){const bytes=Buffer.from(accounts[5].data[0],'base64');bytes[bytes.length-1]^=1;accounts[5].data[0]=bytes.toString('base64');}
      result={context:{slot:Number(f.snapshot.slot)},value:[...accounts,{lamports:1234567891,executable:false},
        ...(discoveryCount?[{owner,executable:false,data:[token.toString('base64'),'base64']}]:[])]};
    }
    res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const adapter=new BurnSolanaAdapter({policy:f.policy,endpoint:`http://127.0.0.1:${server.address().port}`});
  const good=await adapter.publicBalance(address);assert.equal(good.kpepeAtomic,'100000');assert.equal(good.solLamports,'1234567891');
  assert.equal(good.mint,f.manifest.mint.id);assert.deepEqual(methods.find(r=>r.method==='getTokenAccountsByOwner').params[1],{mint:f.manifest.mint.id});
  for(const offset of [0,32,108]){token[offset]^=1;await assert.rejects(adapter.publicBalance(address));token[offset]^=1;}
  owner='11111111111111111111111111111111';await assert.rejects(adapter.publicBalance(address));owner='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  discoveryCount=17;await assert.rejects(adapter.publicBalance(address));discoveryCount=2;await assert.rejects(adapter.publicBalance(address));discoveryCount=1;
  wrongArtifact=true;await assert.rejects(adapter.publicBalance(address),/ARTIFACT_CHANGED/);wrongArtifact=false;
  wrongGenesis=true;await assert.rejects(adapter.publicBalance(address),/NETWORK_MISMATCH/);wrongGenesis=false;
  discoveryCount=0;assert.equal((await adapter.publicBalance(address)).kpepeAtomic,'0');
});
