// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {ed25519} from '@noble/curves/ed25519.js';
import {burnFixture} from './burn-fixture.mjs';
import {decodeCanonicalBridgeMessage} from '../../../shared/protocol/canonical-message.mjs';
import {prepareBurnAuthorization,retainBurnAttestation,retainBurnSolanaPacket,markBurnSolanaPacket,validateBurnJournalState,burnPacketAttestation,recordBurnDeposits,retainBurnMint,completeBurnOperation} from '../../../services/bridge-validator/burn-journal-state.mjs';
import {associatedTokenCreationMessage,burnSolanaPlanOptions,verifyBurnSolanaPacket} from '../../../services/relayer/burn-solana-signer.mjs';
import {base58Encode,prepareSignedLocalnetSolanaDepositClaimTransaction,prepareSignedLocalnetSolanaDepositReceiptTransaction} from '../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {validateBurnSolanaPolicy,verifyBurnDeploymentSnapshot} from '../../../services/solana-observer/burn-solana-adapter.mjs';
import {BurnSolanaRpc} from '../../../services/solana-observer/burn-solana-rpc.mjs';
import {validateRegtestBurnNetwork} from '../burn-evidence.mjs';
import {REGTEST_GENESIS} from '../../node/native-raw-evidence.mjs';
import {DEVNET_SOLANA_GENESIS} from '../../../shared/solana-test-network.mjs';
async function packet(f,authorization,kind,block=1) {
  const recentBlockhash=base58Encode(Buffer.alloc(32,block)),lastValidBlockHeight=String(300+block);
  const config={...burnSolanaPlanOptions({context:f.context,binding:f.binding,feePayerHex:f.policy.feePayerHex,...authorization,recentBlockhash,lastValidBlockHeight}),
    feePayerSigner:{publicKeyHex:f.policy.feePayerHex,sign:bytes=>ed25519.sign(bytes,f.payer)}};
  const raw=await (kind==='CLAIM'?prepareSignedLocalnetSolanaDepositClaimTransaction:prepareSignedLocalnetSolanaDepositReceiptTransaction)(config);
  return {kind,recentBlockhash,lastValidBlockHeight,messageDigestHex:decodeCanonicalBridgeMessage(Buffer.from(authorization.encodedMessageHex,'hex')).messageDigestHex,
    preparedTransactionBase64:raw.preparedTransactionBase64,signature:raw.signatures[0].signatureBase58};
}
test('private Devnet process binding requires a valid endpoint and cannot enable another cluster',()=>{
  const previous=process.env.SOLANA_DEVNET_RPC_URL;
  const options={environment:'devnet',endpoint:'ENV:SOLANA_DEVNET_RPC_URL',expectedGenesis:DEVNET_SOLANA_GENESIS};
  try{
    delete process.env.SOLANA_DEVNET_RPC_URL;
    assert.throws(()=>new BurnSolanaRpc(options),/^Error: DevnetRpcEndpointRejected$/);
    process.env.SOLANA_DEVNET_RPC_URL='https://devnet.invalid.example/';
    assert.doesNotThrow(()=>new BurnSolanaRpc(options));
    assert.throws(()=>new BurnSolanaRpc({...options,environment:'mainnet'}),/GenesisRejected/);
    assert.throws(()=>new BurnSolanaRpc({...options,environment:'localnet'}),/EndpointRejected/);
    assert.throws(()=>new BurnSolanaRpc({...options,expectedGenesis:base58Encode(Buffer.alloc(32,77))}),/GenesisRejected/);
    process.env.SOLANA_DEVNET_RPC_URL='invalid-private-value';
    assert.throws(()=>new BurnSolanaRpc(options),/^Error: DevnetRpcEndpointRejected$/);
  }finally{if(previous===undefined)delete process.env.SOLANA_DEVNET_RPC_URL;else process.env.SOLANA_DEVNET_RPC_URL=previous;}
});

test('Native catch-up waits without conflating synchronization with a wrong network',()=>{
  const ready={chain:'regtest',initialblockdownload:false,blocks:12,headers:12};
  assert.equal(validateRegtestBurnNetwork(ready,REGTEST_GENESIS),ready);
  for(const patch of [{headers:13},{initialblockdownload:true}])
    assert.throws(()=>validateRegtestBurnNetwork({...ready,...patch},REGTEST_GENESIS),/^Error: BURN_NATIVE_SYNCHRONIZING$/);
  for(const patch of [{initialblockdownload:undefined},{headers:11},{blocks:-1},{blocks:12.5}])
    assert.throws(()=>validateRegtestBurnNetwork({...ready,...patch},REGTEST_GENESIS),/CHAIN_STATE_REJECTED/);
  assert.throws(()=>validateRegtestBurnNetwork({...ready,chain:'main'},REGTEST_GENESIS),/NETWORK_MISMATCH/);
  assert.throws(()=>validateRegtestBurnNetwork({...ready,headers:13},'ff'.repeat(32)),/NETWORK_MISMATCH/);
});

test('expired claim recovery retains prior packets and signatures, never rewrites burn or destination',async t=>{
  const f=burnFixture();t.after(f.destroy);f.finalize();const first=f.authorize();
  prepareBurnAuthorization(f.state,f.id,first.encodedMessageHex);retainBurnAttestation(f.state,f.id,first);
  const claim=await packet(f,first,'CLAIM');retainBurnSolanaPacket(f.state,f.id,claim);
  assert.deepEqual(validateBurnJournalState(f.state),f.state);
  const second=f.authorize('3701','7301');
  assert.throws(()=>prepareBurnAuthorization(f.state,f.id,second.encodedMessageHex),/PriorAuthorizationUnresolved/);
  markBurnSolanaPacket(f.state,f.id,claim.signature,{outcome:'EXPIRED_UNSEEN',sendAttempts:1,observedSlot:'20'});
  assert.throws(()=>prepareBurnAuthorization(f.state,f.id,f.authorize('3600','7200').encodedMessageHex),/PriorAuthorizationUnresolved/);
  prepareBurnAuthorization(f.state,f.id,second.encodedMessageHex);retainBurnAttestation(f.state,f.id,second);
  const next=await packet(f,second,'CLAIM',2);retainBurnSolanaPacket(f.state,f.id,next);
  const reloaded=validateBurnJournalState(f.state),op=reloaded.operations[0];
  assert.equal(op.priorAttestations.length,1);assert.equal(op.solanaPacket.length,2);
  assert.equal(burnPacketAttestation(op,claim).encodedMessageHex,first.encodedMessageHex);
  assert.equal(op.plan.txid,f.plan.txid);assert.equal(op.binding.destination,f.binding.destination);
  assert.throws(()=>verifyBurnSolanaPacket(claim,f.context,f.binding,f.policy.feePayerHex,second));
  assert.throws(()=>markBurnSolanaPacket(reloaded,f.id,claim.signature,{outcome:'UNRESOLVED',sendAttempts:2,observedSlot:'21'}));
});
test('already-finalized receipt renewal is safe only after unresolved claims expire',async t=>{
  const f=burnFixture();t.after(f.destroy);f.finalize();const a=f.authorize();
  prepareBurnAuthorization(f.state,f.id,a.encodedMessageHex);retainBurnAttestation(f.state,f.id,a);
  const old=await packet(f,a,'RECEIPT');retainBurnSolanaPacket(f.state,f.id,old);
  markBurnSolanaPacket(f.state,f.id,old.signature,{outcome:'FINALIZED',sendAttempts:1,observedSlot:'10'});
  const b=f.authorize('3701','7301');prepareBurnAuthorization(f.state,f.id,b.encodedMessageHex);retainBurnAttestation(f.state,f.id,b);
  retainBurnSolanaPacket(f.state,f.id,await packet(f,b,'RECEIPT',2));assert.deepEqual(validateBurnJournalState(f.state),f.state);
});
test('another payment after burn remains an exception while the already-burned original retains its mint obligation',t=>{
  const f=burnFixture();t.after(f.destroy);f.finalize();
  recordBurnDeposits(f.state,f.id,[f.deposit,{...f.deposit,txid:'ab'.repeat(32)}]);
  assert.equal(f.state.operations[0].exception.reason,'STRAY_DEPOSIT_AFTER_BURN');
  assert.equal(f.state.operations[0].burnEvidence.amountAtomic,f.deposit.amountAtomic);
  retainBurnMint(f.state,f.id,{operationId:f.id,amountAtomic:f.deposit.amountAtomic,destination:f.binding.destination,mint:f.binding.mint,signature:'2'.repeat(88),slot:'21',commitment:'finalized'});
  completeBurnOperation(f.state,f.id);assert.equal(validateBurnJournalState(f.state).operations[0].retired,true);
});
test('automatic ATA resolution signs exact wallet/Mint with no user token-account choice',t=>{
  const f=burnFixture();t.after(f.destroy);const recentBlockhash=base58Encode(Buffer.alloc(32,3));
  const {message,ata}=associatedTokenCreationMessage({binding:f.binding,feePayerHex:f.policy.feePayerHex,recentBlockhash});
  const signature=ed25519.sign(message,f.payer),p={kind:'ATA',recentBlockhash,lastValidBlockHeight:'300',messageDigestHex:null,
    signature:base58Encode(signature),preparedTransactionBase64:Buffer.concat([Buffer.of(1),Buffer.from(signature),message]).toString('base64')};
  verifyBurnSolanaPacket(p,f.context,f.binding,f.policy.feePayerHex,null);assert(ata.length>=32);
  assert.throws(()=>verifyBurnSolanaPacket(p,f.context,{...f.binding,destination:f.policy.feePayerHex},f.policy.feePayerHex,null));
  assert.throws(()=>verifyBurnSolanaPacket({...p,messageDigestHex:'ab'.repeat(32)},f.context,f.binding,f.policy.feePayerHex,null));
});
test('pre-burn deployment verification rejects changed program bytes, supply beyond cap and wrong network',t=>{
  const f=burnFixture();t.after(f.destroy);validateBurnSolanaPolicy(f.policy);assert.equal(verifyBurnDeploymentSnapshot(f.policy,f.snapshot).mintSupplyAtomic,'0');
  const changed=structuredClone(f.snapshot),data=Buffer.from(changed.accounts[5].data[0],'base64');data[data.length-1]^=1;changed.accounts[5].data[0]=data.toString('base64');
  assert.throws(()=>verifyBurnDeploymentSnapshot(f.policy,changed),/ARTIFACT_CHANGED/);
  for(const supply of [1n,2100000000000001n]){const s=structuredClone(f.snapshot),m=Buffer.from(s.accounts[2].data[0],'base64');m.writeBigUInt64LE(supply,36);s.accounts[2].data[0]=m.toString('base64');assert.throws(()=>verifyBurnDeploymentSnapshot(f.policy,s),/SUPPLY_CRITICAL/);}
  assert.throws(()=>validateBurnSolanaPolicy({...f.policy,context:{...f.context,environment:'mainnet'}}));
  assert.throws(()=>verifyBurnDeploymentSnapshot(f.policy,{...f.snapshot,genesis:base58Encode(Buffer.alloc(32,77))}));
});
test('private TEST Solana transport validates actual genesis and sanitizes credential-bearing RPC errors',async t=>{
  const f=burnFixture();t.after(f.destroy);let wrong=false,error=false,instructionError=null;
  const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const input=JSON.parse(body);
    const result=input.method==='getGenesisHash'?(wrong?base58Encode(Buffer.alloc(32,77)):f.manifest.solanaGenesis):{context:{slot:10},value:f.snapshot.accounts};
    res.end(JSON.stringify(error?{jsonrpc:'2.0',id:input.id,error:{code:instructionError?-32002:-32000,message:'secret-rpc-credential',
      ...(instructionError?{data:{err:{InstructionError:[2,instructionError]}}}:{})}}:{jsonrpc:'2.0',id:input.id,result}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const rpc=new BurnSolanaRpc({environment:'localnet',endpoint:`http://127.0.0.1:${server.address().port}`,expectedGenesis:f.manifest.solanaGenesis});
  assert.equal(await rpc.genesis(),f.manifest.solanaGenesis);wrong=true;await assert.rejects(rpc.genesis(),/NETWORK_MISMATCH/);
  wrong=false;error=true;await assert.rejects(rpc.genesis(),e=>e.message==='BURN_SOLANA_RPC_UNAVAILABLE'&&e.rpcCode===-32000&&!JSON.stringify(e).includes('secret-rpc'));
  instructionError='ProgramFailedToComplete';await assert.rejects(rpc.genesis(),e=>e.message==='BURN_SOLANA_PROGRAM_REJECTED'&&e.instructionFailure==='2:ProgramFailedToComplete');
  instructionError='PrivateCredentialValue';await assert.rejects(rpc.genesis(),e=>e.message==='BURN_SOLANA_PROGRAM_REJECTED'&&e.instructionFailure==='2:UnknownInstructionError'&&!JSON.stringify(e).includes('PrivateCredential'));
  assert.throws(()=>new BurnSolanaRpc({environment:'mainnet',endpoint:'https://invalid.example',expectedGenesis:f.manifest.solanaGenesis}));
});
