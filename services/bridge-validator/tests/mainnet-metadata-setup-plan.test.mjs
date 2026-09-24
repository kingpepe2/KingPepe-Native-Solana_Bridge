// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Unsigned public fixtures. No production signer or RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {base58Encode,base58Decode} from '../solana-deposit-claim-transaction-plan.mjs';
import {buildMainnetMetadataSetupPlans,TOKEN_METADATA_PROGRAM} from '../mainnet-metadata-setup-plan.mjs';
import {decodeBridgeAbi} from '../../../shared/protocol/solana-bridge-abi.mjs';
import {NATIVE_MAINNET_GENESIS,NATIVE_MAINNET_DOMAIN,SOLANA_MAINNET_GENESIS,mainnetDeploymentIdentity} from '../../../shared/network-identity.mjs';
const h=name=>createHash('sha256').update('PublicMetadataFixture:'+name).digest(),k=name=>base58Encode(h(name));
function fixture(){const keys={manager:k('manager'),transceiver:k('transceiver'),mint:k('mint')};return {
  environment:'mainnet',cluster:'mainnet',solanaGenesis:SOLANA_MAINNET_GENESIS,protocolId:1,nativeNetwork:NATIVE_MAINNET_DOMAIN,
  nativeGenesisHex:NATIVE_MAINNET_GENESIS,solanaDeploymentHex:mainnetDeploymentIdentity(keys),managerProgramIdBase58:keys.manager,
  transceiverProgramIdBase58:keys.transceiver,mintBase58:keys.mint,feePayerBase58:k('payer'),recentBlockhashBase58:k('block'),lastValidBlockHeight:'123',
  attesterPublicKeysHex:[h('attester-a').toString('hex'),h('attester-b').toString('hex')],decimals:8,nativeDecimals:8,policyEpoch:1,keyEpoch:1,
  mintRentLamports:'1461600',metadataUri:'https://kingpepe.net/metadata/kpepe-mainnet.json'};}
function decode(plan){const bytes=Buffer.from(plan.messageBase64,'base64');let cursor=0;
  const take=n=>{assert(cursor+n<=bytes.length);const b=bytes.subarray(cursor,cursor+n);cursor+=n;return b;};
  const short=()=>{let n=0,s=0,b;do{assert(s<21);b=take(1)[0];n+=(b&127)*2**s;s+=7;}while(b&128);return n;};
  const header=[...take(3)],keys=Array.from({length:short()},()=>base58Encode(take(32)));take(32);
  const instructions=Array.from({length:short()},()=>({program:keys[take(1)[0]],accounts:[...take(short())].map(i=>keys[i]),data:take(short())}));
  assert.equal(cursor,bytes.length);return {header,keys,instructions};}
test('Mint creation and metadata finish atomically with zero supply, no freeze authority and Bridge mint authority',()=>{
  const c=fixture(),p=buildMainnetMetadataSetupPlans(c),wire=decode(p.mintAndMetadata);
  assert.equal(p.initialSupplyAtomic,'0');assert.equal(p.freezeAuthority,null);assert.equal(p.decimals,8);
  assert.equal(wire.header[0],2);assert.deepEqual(wire.keys.slice(0,2),[c.feePayerBase58,c.mintBase58]);
  assert.equal(wire.instructions.length,4);const [create,initialize,metadata,authority]=wire.instructions;
  assert.equal(create.data.readBigUInt64LE(12),82n);assert.deepEqual([...initialize.data.subarray(0,2)],[20,8]);
  assert.equal(base58Encode(initialize.data.subarray(2,34)),c.mintBase58);assert.equal(initialize.data[34],0);
  assert.equal(metadata.program,TOKEN_METADATA_PROGRAM);assert.equal(metadata.data[0],33);
  assert.deepEqual(metadata.accounts,[p.metadata,c.mintBase58,c.mintBase58,c.feePayerBase58,c.mintBase58,'11111111111111111111111111111111']);
  let cursor=1;const text=()=>{const size=metadata.data.readUInt32LE(cursor);cursor+=4;const v=metadata.data.subarray(cursor,cursor+size).toString();cursor+=size;return v;};
  assert.equal(text(),'KingPepe');assert.equal(text(),'KPEPE');assert.equal(text(),c.metadataUri);
  assert.deepEqual([...metadata.data.subarray(cursor)],[0,0,0,0,0,1,0]);
  assert.deepEqual([...authority.data.subarray(0,3)],[6,0,1]);assert.equal(base58Encode(authority.data.subarray(3)),p.mintAuthority);
  assert.deepEqual(authority.accounts,[c.mintBase58,c.mintBase58]);
  assert(p.mintAndMetadata.packetBytes<=1232);
  assert.equal(p.mintAndMetadata.preparedTransactionBase64,undefined);
});
test('separate enrollment initializes only the exact paused forward configuration and cannot mint',()=>{
  const c=fixture(),p=buildMainnetMetadataSetupPlans(c),wire=decode(p.pausedEnrollment);
  assert.equal(wire.instructions.length,2);assert.equal(wire.header[0],2);
  const [receiver,manager]=wire.instructions;
  assert.equal(receiver.program,c.transceiverProgramIdBase58);assert.equal(manager.program,c.managerProgramIdBase58);
  const r=decodeBridgeAbi('TransceiverInitialize',receiver.data),b=decodeBridgeAbi('BridgeInitialize',manager.data);
  assert.equal(r.config.nativeNetwork,NATIVE_MAINNET_DOMAIN);assert.equal(b.binding.environment,2);
  assert.deepEqual(Buffer.from(b.binding.mint),Buffer.from(base58Decode(c.mintBase58)));
  assert.equal(b.policy.depositsPaused,true);assert.equal(b.policy.mainnetActivationEnabled,false);
  assert(p.pausedEnrollment.packetBytes<=1232);
});
test('metadata setup rejects foreign hosts, credentials, oversized data, identities and decimal substitutions',()=>{
  const c=fixture(),credentialUrl=new URL(c.metadataUri);credentialUrl.username='public-fixture';credentialUrl.password='invalid-fixture';
  for(const metadataUri of ['http://kingpepe.net/metadata/a.json','https://elsewhere.example/metadata/a.json',
    credentialUrl.href,'https://kingpepe.net/metadata/a.json?credential=invalid',
    'https://kingpepe.net/metadata/'+ 'a'.repeat(200)+'.json'])assert.throws(()=>buildMainnetMetadataSetupPlans({...c,metadataUri}));
  for(const patch of [{cluster:'devnet'},{decimals:9},{mintBase58:k('different-mint')},{unexpected:'value'}])
    assert.throws(()=>buildMainnetMetadataSetupPlans({...c,...patch}));
});
