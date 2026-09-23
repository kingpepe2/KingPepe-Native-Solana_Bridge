// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ed25519} from '@noble/curves/ed25519.js';
import {encodeBurnMessage,decodeBurnMessage,burnMessageDigest,BURN_MESSAGE_LENGTH} from '../../../shared/protocol/burn-message.mjs';
import {encodeFinalizedBurnEvidence,burnOperationId,nativeBurnScript} from '../burn-protocol.mjs';
const v=JSON.parse(readFileSync(new URL('../../../solana/modules/bridge-messages/vectors/burn-borsh-v4.json',import.meta.url)));
test('Rust/TypeScript use the identical complete canonical burn evidence, message and digest',()=>{
  const encoded=encodeBurnMessage(v.message);
  assert.equal(encoded.length,BURN_MESSAGE_LENGTH);assert.equal(encoded.toString('hex'),v.messageHex);
  assert.equal(encodeFinalizedBurnEvidence(v.message.evidence).toString('hex'),v.evidenceHex);
  assert.equal(burnOperationId(v.message.evidence.binding),v.operationId);
  assert.equal(nativeBurnScript(v.message.evidence),v.burnScript);
  assert.equal(burnMessageDigest(encoded),v.messageDigest);
  assert.deepEqual(decodeBurnMessage(encoded),v.message);
  assert.throws(()=>decodeBurnMessage(Buffer.concat([encoded,Buffer.of(0)])),/LengthRejected/);
  assert.throws(()=>decodeBurnMessage(encoded.subarray(1)),/LengthRejected/);
  const wrong=Buffer.from(encoded);wrong[8]=3;assert.throws(()=>decodeBurnMessage(wrong),/DomainRejected/);
});
test('actual signed canonical bytes reject mutations of every burn/network/recipient/context byte',()=>{
  const secret=ed25519.utils.randomSecretKey();
  try{
    const publicKey=ed25519.getPublicKey(secret),encoded=encodeBurnMessage(v.message),signature=ed25519.sign(encoded,secret);
    assert.equal(ed25519.verify(signature,encoded,publicKey),true);
    for(let index=0;index<encoded.length;index++){
      const changed=Buffer.from(encoded);changed[index]^=1;
      assert.equal(ed25519.verify(signature,changed,publicKey),false,`signed byte ${index}`);
    }
    assert.equal(ed25519.verify(signature,encoded,ed25519.getPublicKey(ed25519.utils.randomSecretKey())),false);
  }finally{secret.fill(0);}
});
