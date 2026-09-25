// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Local-validator adversarial fixture: anyone can pre-fund an unused PDA.
import assert from 'node:assert/strict';
import {ed25519} from '@noble/curves/ed25519.js';
import {base58Decode,base58Encode} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {SOLANA_MAINNET_GENESIS,SOLANA_DEVNET_GENESIS} from '../../../shared/network-identity.mjs';

export async function fundEmptyTestAccounts({rpc,payer,addresses}) {
  const genesis=await rpc('getGenesisHash');
  assert(![SOLANA_MAINNET_GENESIS,SOLANA_DEVNET_GENESIS,'4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'].includes(genesis));
  const lamports=await rpc('getMinimumBalanceForRentExemption',[0]);
  assert(Number.isSafeInteger(lamports)&&lamports>0);
  const signatures=[];
  for(const address of addresses){
    assert.equal((await rpc('getAccountInfo',[address,{commitment:'finalized'}])).value,null);
    const {blockhash}=(await rpc('getLatestBlockhash',[{commitment:'finalized'}])).value;
    const data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(BigInt(lamports),4);
    const message=Buffer.concat([Buffer.from([1,0,1,3]),Buffer.from(ed25519.getPublicKey(payer)),Buffer.from(base58Decode(address)),
      Buffer.alloc(32),Buffer.from(base58Decode(blockhash)),Buffer.from([1,2,2,0,1,12]),data]);
    const signature=Buffer.from(ed25519.sign(message,payer));
    const packet=Buffer.concat([Buffer.of(1),signature,message]);
    const sent=await rpc('sendTransaction',[packet.toString('base64'),{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);
    assert.equal(sent,base58Encode(signature));signatures.push(sent);
  }
  return signatures;
}
