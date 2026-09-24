// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';
import {base58Encode,base58Decode} from '../solana-deposit-claim-transaction-plan.mjs';
import {SOLANA_MAINNET_GENESIS} from '../../../shared/network-identity.mjs';
import {PROGRAM_LOADER,buildMainnetProgramStep,inspectMainnetProgramUpload,mainnetProgramWriteChunkSize} from '../mainnet-program-plan.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){const artifact=Buffer.concat([Buffer.from([127,69,76,70]),randomBytes(2000)]),address=()=>base58Encode(randomBytes(32));
  return {artifact,c:{environment:'mainnet',genesis:SOLANA_MAINNET_GENESIS,program:address(),buffer:address(),feePayer:address(),upgradeAuthority:address(),artifactSha256:hash(artifact)},blockhash:address()};}
const account=(data,executable=false)=>({owner:PROGRAM_LOADER,executable,data:[data.toString('base64'),'base64']});
test('initial deployment plans bind reviewed identities, distinct signers, artifact and exact packet limit',()=>{
  const {artifact,c,blockhash}=fixture();assert.equal(mainnetProgramWriteChunkSize(c,artifact),916);
  const make=o=>buildMainnetProgramStep({configuration:c,artifact,recentBlockhash:blockhash,...o});
  const create=make({step:'CREATE_BUFFER',bufferFundingLamports:'1000000000'});assert.deepEqual(create.requiredSigners,[c.feePayer,c.buffer]);
  const write=make({step:'WRITE',offset:0});assert.equal(write.packetBytes,1232);assert.deepEqual(write.requiredSigners,[c.feePayer,c.upgradeAuthority]);
  assert.equal(make({step:'DEPLOY',programRentLamports:'1000000'}).requiredSigners.length,3);
  assert.throws(()=>make({step:'UPGRADE'}),/InitialProgramStep/);assert.throws(()=>make({step:'WRITE',offset:1}));
  assert.throws(()=>make({step:'WRITE',offset:0,configuration:{...c,environment:'devnet'}}),/Cluster/);
  assert.throws(()=>make({step:'WRITE',offset:0,configuration:{...c,artifactSha256:'00'.repeat(32)}}),/Artifact/);
});
test('resume skips matching writes and verified programs; wrong authority/code never triggers redeployment',()=>{
  const {artifact,c}=fixture(),base={configuration:c,artifact,programAccount:null,programDataAccount:null,bufferAccount:null};
  assert.equal(inspectMainnetProgramUpload(base).state,'CREATE_BUFFER');
  const buffer=Buffer.alloc(artifact.length+37);buffer.writeUInt32LE(1);buffer[4]=1;Buffer.from(base58Decode(c.upgradeAuthority)).copy(buffer,5);
  let result=inspectMainnetProgramUpload({...base,bufferAccount:account(buffer)});assert.deepEqual(result.writes,[0,916,1832]);
  artifact.subarray(0,916).copy(buffer,37);result=inspectMainnetProgramUpload({...base,bufferAccount:account(buffer)});assert.deepEqual(result.writes,[916,1832]);
  artifact.copy(buffer,37);result=inspectMainnetProgramUpload({...base,bufferAccount:account(buffer)});assert.equal(result.state,'DEPLOY');
  const p=Buffer.alloc(36),d=Buffer.alloc(artifact.length+45);p.writeUInt32LE(2);Buffer.from(base58Decode(result.programData)).copy(p,4);
  d.writeUInt32LE(3);d.writeBigUInt64LE(123n,4);d[12]=1;Buffer.from(base58Decode(c.upgradeAuthority)).copy(d,13);artifact.copy(d,45);
  const deployed={...base,programAccount:account(p,true),programDataAccount:account(d)};
  assert.equal(inspectMainnetProgramUpload(deployed).state,'DEPLOYED_VERIFIED');
  d[45]^=1;assert.throws(()=>inspectMainnetProgramUpload({...deployed,programDataAccount:account(d)}),/ArtifactOrAuthority/);
  buffer[5]^=1;assert.throws(()=>inspectMainnetProgramUpload({...base,bufferAccount:account(buffer)}),/BufferAuthority/);
});
