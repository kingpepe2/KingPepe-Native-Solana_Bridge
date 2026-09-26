// Differential wire-format regression: the independent consensus verifier and
// all source/finality checks remain unchanged by this encoding optimization.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {serialize,deserialize} from 'borsh';
import {encodeMainnetEvidence,encodeRegtestEvidence,NATIVE_EVIDENCE_SCHEMA} from '../native-raw-evidence.mjs';
import {NATIVE_MAINNET_GENESIS} from '../../../shared/network-identity.mjs';
const vector=JSON.parse(readFileSync(new URL('../../proof/vectors/borsh-v2.json',import.meta.url),'utf8'));
const bytes=value=>Buffer.from(value,'hex');
function reference(b){return Buffer.from(serialize(NATIVE_EVIDENCE_SCHEMA,{
  magic:Buffer.from('KPNEVD02'),genesisHash:bytes(b.genesisHash),tipHash:bytes(b.tipHash),tipHeight:b.tipHeight,
  chainwork:bytes(b.chainworkHex),minimumConfirmations:b.minimumConfirmations,headers:b.headers.map(bytes),
  proofs:b.proofs.map(p=>({transaction:bytes(p.rawTransactionHex),blockHeight:p.blockHeight,transactionIndex:p.transactionIndex,transactionIds:p.transactionIds.map(bytes)})),
}));}
test('bulk codec exactly matches canonical Borsh for every field, multiple proofs and independent decoded roundtrip',()=>{
  for(const count of [1,2,16]){
    const b=structuredClone(vector.input);b.headers=Array(64).fill(b.headers[0]);b.tipHeight=64;b.minimumConfirmations=12;
    b.proofs=Array.from({length:count},(_,i)=>({...b.proofs[0],blockHeight:i+1,transactionIndex:i,transactionIds:Array.from({length:i+1},(_,j)=>j.toString(16).padStart(64,'0'))}));
    const packet=encodeRegtestEvidence(b);assert.deepEqual(packet,reference(b));
    assert.deepEqual(Buffer.from(serialize(NATIVE_EVIDENCE_SCHEMA,deserialize(NATIVE_EVIDENCE_SCHEMA,packet))),packet);
    const copy=Buffer.from(packet);b.headers[0]='ff'.repeat(80);b.proofs[0].transactionIds[0]='ee'.repeat(32);assert.deepEqual(packet,copy);
  }
});
test('Mainnet-sized header envelope has exactly the unchanged canonical byte encoding',()=>{
  const b={...structuredClone(vector.input),genesisHash:NATIVE_MAINNET_GENESIS,tipHeight:300000,minimumConfirmations:12};
  b.headers=Array(b.tipHeight).fill(b.headers[0]);assert.deepEqual(encodeMainnetEvidence(b),reference(b));
});
test('bulk copies cannot accept malformed headers, transactions, proof indices or policy widths',()=>{
  for(const change of [b=>b.headers[0]='xx'.repeat(80),b=>b.headers[0]='00'.repeat(79),b=>b.proofs[0].rawTransactionHex='abc',
    b=>b.proofs[0].transactionIds[0]='00'.repeat(31),b=>b.proofs[0].transactionIndex=1,b=>b.proofs[0].blockHeight=0,
    b=>b.minimumConfirmations=0,b=>b.tipHash='00',b=>b.tipHeight=2,b=>b.chainworkHex='00']){
    const b=structuredClone(vector.input);change(b);assert.throws(()=>encodeRegtestEvidence(b),/RAW_NATIVE_/u);
  }
});
