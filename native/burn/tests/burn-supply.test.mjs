// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {publicBurnSupply} from '../../../services/bridge-validator/burn-user-api.mjs';
const status=n=>({environment:'devnet',nativeNetwork:'REGTEST',solanaNetwork:'DEVNET',mintHex:'01'.repeat(32),reconciliation:'MATCH',
  accounting:{completedAtomic:n,mintedAtomic:n,finalizedNativeBurnAtomic:n,liveMintSupplyAtomic:n,observedAt:Date.now()}});
test('counter uses completed burn/mint accounting only, exact remaining units and bounded percentages',()=>{
  for(const [amount,remaining,percentage] of [['0','2100000000000000','0'],['100000000','2099999900000000','0'],['1050000000000000','1050000000000000','5000'],['2100000000000000','0','10000']]){
    const s=publicBurnSupply(status(amount));assert.equal(s.bridgedSupplyAtomic,amount);assert.equal(s.remainingSupplyAtomic,remaining);assert.equal(s.percentageBasisPoints,percentage);
  }
  const pending=status('0');pending.accounting.finalizedNativeBurnAtomic='100000';assert.equal(publicBurnSupply(pending).bridgedSupplyAtomic,'0');
  pending.accounting.mintedAtomic='100000';assert.equal(publicBurnSupply(pending).bridgedSupplyAtomic,'0');
  pending.accounting.completedAtomic='100000';assert.equal(publicBurnSupply(pending).bridgedSupplyAtomic,'100000');
});
test('counter rejects above-cap, unverified and unconserved accounting; no private field is projected',()=>{
  assert.throws(()=>publicBurnSupply(status('2100000000000001')),/CapExceeded/);
  assert.throws(()=>publicBurnSupply({...status('1'),accounting:{...status('1').accounting,finalizedNativeBurnAtomic:'0'}}),/Conservation/);
  for(const bad of [1,0.1,'1e8','-1','01'])assert.throws(()=>publicBurnSupply(status(bad)));
  assert.equal(publicBurnSupply({...status('0'),reconciliation:null}).state,'UNAVAILABLE');
  assert.equal(publicBurnSupply({...status('0'),accounting:{...status('0').accounting,observedAt:Date.now()-30001}}).state,'UNAVAILABLE');
  const s=publicBurnSupply({...status('1'),token:'test-private-sentinel',rpcCredential:'test-private-sentinel'});
  assert(!JSON.stringify(s).includes('test-private-sentinel'));
});
test('TEST and future production counter projections reject mixed network accounting',()=>{
  const testData=publicBurnSupply(status('2'));assert.equal(testData.environment,'devnet');
  const production={...status('3'),environment:'mainnet',nativeNetwork:'MAINNET',solanaNetwork:'MAINNET'};
  assert.equal(publicBurnSupply(production).bridgedSupplyAtomic,'3');
  for(const mutation of [{nativeNetwork:'MAINNET'},{solanaNetwork:'MAINNET'},{environment:'mainnet'}])assert.throws(()=>publicBurnSupply({...status('2'),...mutation}),/NetworkMismatch/);
});
