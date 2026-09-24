// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real initial-loader deployment on a fresh owned LOCAL validator only.
// No Native chain, retained TEST state, Mainnet RPC or production key is opened.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {createServer} from 'node:net';import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';import path from 'node:path';
import {ed25519} from '@noble/curves/ed25519.js';
import {validateRuntimeStateRoot} from '../../shared/runtime-path-boundary.mjs';
import {SOLANA_MAINNET_GENESIS,NATIVE_MAINNET_GENESIS,NATIVE_MAINNET_DOMAIN,mainnetDeploymentIdentity} from '../../shared/network-identity.mjs';
import {base58Encode,base58Decode,shortvecEncode} from '../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {sourceIdentity} from '../../scripts/source-identity.mjs';
import {decodeBridgeAbi} from '../../shared/protocol/solana-bridge-abi.mjs';
import {buildMainnetProgramStep,inspectMainnetProgramUpload} from '../../services/bridge-validator/mainnet-program-plan.mjs';
import {buildMainnetSolanaSetupTransactionPlan,buildMainnetExistingMintInitializationPlan} from '../../services/bridge-validator/mainnet-solana-setup-plan.mjs';
const repoRoot=path.resolve(import.meta.dirname,'../..'),root=validateRuntimeStateRoot(process.env.KINGPEPE_DEPLOYMENT_TEST_ROOT,repoRoot);
assert(process.platform==='linux'&&!existsSync(root));
const artifactRoot=process.env.KINGPEPE_BURN_SBF_ROOT;assert(path.isAbsolute(artifactRoot??''));
const runId=randomBytes(16).toString('hex'),ledger=path.join(validateRuntimeStateRoot(process.env.KINGPEPE_TEST_LEDGER_PARENT,repoRoot),runId);
assert(!existsSync(ledger));mkdirSync(root,{mode:0o700});
const keys=Array.from({length:9},()=>ed25519.utils.randomSecretKey()),[payer,authority,bridge,transceiver,bridgeBuffer,transceiverBuffer,mint,attesterA,attesterB]=keys;
const pub=k=>base58Encode(ed25519.getPublicKey(k)),hash=b=>createHash('sha256').update(b).digest('hex');
const report={scope:'ISOLATED_LOCAL_MAINNET_DEPLOYMENT_INSTRUCTIONS',...sourceIdentity(repoRoot),artifacts:[],checks:[],mainnetTransactions:0,productionReady:false,mainnetActivation:'DISABLED'};
const pass=name=>{report.checks.push(name);writeFileSync(path.join(root,'evidence.json'),JSON.stringify(report,null,2));console.log(name+'=PASS');};
const freePort=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;};
async function rpcPair(){for(let i=0;i<20;i++){const p=await freePort();if(p>=65535)continue;const s=createServer();try{s.listen(p+1,'127.0.0.1');await once(s,'listening');await new Promise(r=>s.close(r));return p;}catch{s.close();}}throw Error('TEST_PORT_UNAVAILABLE');}
let child,log,endpoint;const signerKeys=new Map(keys.map(k=>[pub(k),k]));
async function rpc(method,params=[]){assert(new URL(endpoint).hostname==='127.0.0.1');
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const r=await response.json();assert(response.ok&&!r.error,`LOCAL_RPC_${method}_${r.error?.code??''}`);return r.result;}
async function finalized(signatures){for(let i=0;i<240;i++){const result=(await rpc('getSignatureStatuses',[signatures,{searchTransactionHistory:true}])).value;
  for(const item of result)if(item)assert.equal(item.err,null);if(result.every(s=>s?.confirmationStatus==='finalized'))return;await delay(250);}throw Error('LOCAL_FINALITY_TIMEOUT');}
function packet(plan){const message=Buffer.from(plan.messageBase64,'base64');const signatures=plan.requiredSigners.map(address=>{
  const seed=signerKeys.get(address);assert(seed);return Buffer.from(ed25519.sign(message,seed));});
  return {packet:Buffer.concat([Buffer.from([signatures.length]),...signatures,message]),signature:base58Encode(signatures[0])};}
async function send(plan){const p=packet(plan);assert(p.packet.length<=1232);const signature=await rpc('sendTransaction',[p.packet.toString('base64'),{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);assert.equal(signature,p.signature);return signature;}
try{
  const port=await rpcPair(),faucet=await freePort();endpoint=`http://127.0.0.1:${port}`;log=openSync(path.join(root,'validator.log'),'wx',0o600);
  child=spawn('solana-test-validator',['--ledger',ledger,'--bind-address','127.0.0.1','--rpc-port',String(port),'--faucet-port',String(faucet),'--quiet','--limit-ledger-size','100000'],
    {stdio:['ignore',log,log],env:{...process.env,KINGPEPE_TEST_LIFECYCLE_ACTIVE:'1',KINGPEPE_DEV_RUN_ID:runId,KINGPEPE_TEST_SOURCE_ROOT:repoRoot}});
  writeFileSync(path.join(root,'owned-ledger.txt'),ledger);
  for(let i=0;i<180;i++){assert.equal(child.exitCode,null);try{assert.equal(await rpc('getHealth'),'ok');break;}catch(error){if(i===179)throw error;await delay(500);}}
  const genesis=await rpc('getGenesisHash');assert.notEqual(genesis,SOLANA_MAINNET_GENESIS);assert.notEqual(genesis,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
  await finalized([await rpc('requestAirdrop',[pub(payer),10000000000])]);
  const latest=async()=>(await rpc('getLatestBlockhash',[{commitment:'finalized'}])).value;
  const rent=async n=>String(await rpc('getMinimumBalanceForRentExemption',[n]));
  for(const [name,program,buffer] of [['kingpepe_bridge',bridge,bridgeBuffer],['kingpepe_transceiver',transceiver,transceiverBuffer]]){
    const artifact=readFileSync(path.join(artifactRoot,name+'.so')),configuration={environment:'mainnet',genesis:SOLANA_MAINNET_GENESIS,program:pub(program),buffer:pub(buffer),feePayer:pub(payer),upgradeAuthority:pub(authority),artifactSha256:hash(artifact)};
    let blockhash=(await latest()).blockhash;
    const step=extra=>buildMainnetProgramStep({configuration,artifact,recentBlockhash:blockhash,...extra});
    const init=step({step:'CREATE_BUFFER',bufferFundingLamports:await rent(artifact.length+45)}),pda=init.programData;
    const inspect=async()=>{const a=(await rpc('getMultipleAccounts',[[pub(program),pda,pub(buffer)],{encoding:'base64',commitment:'finalized'}])).value;
      return inspectMainnetProgramUpload({configuration,artifact,programAccount:a[0],programDataAccount:a[1],bufferAccount:a[2]});};
    assert.equal((await inspect()).state,'CREATE_BUFFER');await finalized([await send(init)]);
    let state=await inspect();assert.equal(state.state,'WRITE');blockhash=(await latest()).blockhash;
    await finalized([await send(step({step:'WRITE',offset:state.writes[0]}))]);
    state=await inspect();assert(!state.writes.includes(0));pass(name.toUpperCase()+'_RESUMES_EXISTING_BUFFER');
    const signatures=[];
    for(let i=0;i<state.writes.length;i+=8){blockhash=(await latest()).blockhash;signatures.push(...await Promise.all(state.writes.slice(i,i+8).map(offset=>send(step({step:'WRITE',offset})))));}
    for(let i=0;i<signatures.length;i+=128)await finalized(signatures.slice(i,i+128));
    assert.equal((await inspect()).state,'DEPLOY');blockhash=(await latest()).blockhash;
    await finalized([await send(step({step:'DEPLOY',programRentLamports:await rent(36)}))]);
    const deployed=await inspect();assert.equal(deployed.state,'DEPLOYED_VERIFIED');assert.equal(deployed.writes.length,0);
    report.artifacts.push({name,bytes:artifact.length,sha256:hash(artifact),deploymentSlot:deployed.deploymentSlot});
    pass(name.toUpperCase()+'_FROZEN_BYTES_AUTHORITY_AND_DEPLOYMENT_VERIFIED');
  }
  const ids={manager:pub(bridge),transceiver:pub(transceiver),mint:pub(mint)},recent=await latest();
  const common={environment:'mainnet',cluster:'mainnet',solanaGenesis:SOLANA_MAINNET_GENESIS,protocolId:1,nativeNetwork:NATIVE_MAINNET_DOMAIN,nativeGenesisHex:NATIVE_MAINNET_GENESIS,
    solanaDeploymentHex:mainnetDeploymentIdentity(ids),managerProgramIdBase58:ids.manager,transceiverProgramIdBase58:ids.transceiver,mintBase58:ids.mint,feePayerBase58:pub(payer),
    recentBlockhashBase58:recent.blockhash,lastValidBlockHeight:String(recent.lastValidBlockHeight),attesterPublicKeysHex:[attesterA,attesterB].map(k=>Buffer.from(ed25519.getPublicKey(k)).toString('hex')),
    decimals:8,nativeDecimals:8,policyEpoch:1,keyEpoch:1};
  const initial=buildMainnetSolanaSetupTransactionPlan({...common,mintRentLamports:await rent(82)});
  // Create the isolated zero-supply Mint first, mirroring the actual production
  // ordering. This TEST transaction omits both program initialization calls.
  const mintInstructions=initial.instructions.slice(0,2);
  const mintMessage=Buffer.concat([Buffer.from([2,0,5]),Buffer.from(shortvecEncode(initial.accountKeys.length)),...initial.accountKeys.map(k=>Buffer.from(base58Decode(k))),
    Buffer.from(base58Decode(recent.blockhash)),Buffer.from(shortvecEncode(mintInstructions.length)),...mintInstructions.map(i=>{
      const data=Buffer.from(i.dataBase64,'base64');return Buffer.concat([Buffer.from([i.programIdIndex]),Buffer.from(shortvecEncode(i.accountIndexes.length)),Buffer.from(i.accountIndexes),Buffer.from(shortvecEncode(data.length)),data]);})]);
  await finalized([await send({...initial,messageBase64:mintMessage.toString('base64')})]);
  const existing=buildMainnetExistingMintInitializationPlan(common);
  assert.deepEqual(existing.instructions.map(i=>i.role),['transceiverInitialize','bridgeInitialize']);
  await finalized([await send(existing)]);pass('EXISTING_MINT_INITIALIZATION_PRESERVES_MINT');
  // The local fixture is already initialized. Reinitialization fails simulation
  // and is never sent, preserving the one existing Mint and config accounts.
  const simulated=await rpc('simulateTransaction',[packet(existing).packet.toString('base64'),{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true}]);
  assert.notEqual(simulated.value.err,null);pass('ALREADY_INITIALIZED_CONFIG_IS_NOT_RESUBMITTED');
  const mintAccount=(await rpc('getAccountInfo',[pub(mint),{encoding:'base64',commitment:'finalized'}])).value;
  const mintBytes=Buffer.from(mintAccount.data[0],'base64');assert.equal(mintBytes.readBigUInt64LE(36),0n);assert.equal(mintBytes[44],8);assert.equal(mintBytes.readUInt32LE(46),0);
  assert.equal(base58Encode(mintBytes.subarray(4,36)),initial.mintAuthority);
  const configAccounts=(await rpc('getMultipleAccounts',[[existing.pdas.bridgeState,existing.pdas.transceiverConfig],{encoding:'base64',commitment:'finalized'}])).value;
  assert.equal(configAccounts[0].owner,ids.manager);assert.equal(configAccounts[1].owner,ids.transceiver);
  const bridgeState=decodeBridgeAbi('BridgeState',Buffer.from(configAccounts[0].data[0],'base64'));
  const transceiverState=decodeBridgeAbi('TransceiverState',Buffer.from(configAccounts[1].data[0],'base64'));
  assert.equal(bridgeState.config.binding.environment,2);assert.equal(bridgeState.config.policy.depositsPaused,true);
  assert.equal(bridgeState.config.policy.mainnetActivationEnabled,false);assert.equal(bridgeState.config.policy.hardStop,false);
  assert.equal(bridgeState.config.initialSupply,0n);assert.equal(bridgeState.mintedSupply,0n);
  assert.equal(base58Encode(Buffer.from(bridgeState.config.binding.mint)),ids.mint);assert.equal(base58Encode(Buffer.from(transceiverState.config.mint)),ids.mint);
  assert.equal(base58Encode(Buffer.from(transceiverState.config.managerProgramId)),ids.manager);
  assert.deepEqual(transceiverState.config.authorizedAttesters.map(a=>Buffer.from(a).toString('hex')),common.attesterPublicKeysHex);
  pass('ZERO_SUPPLY_MINT_AND_PAUSED_MAINNET_CONFIGURATION');
  report.result='PASS';writeFileSync(path.join(root,'evidence.json'),JSON.stringify(report,null,2));
}finally{
  keys.forEach(k=>k.fill(0));
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([once(child,'exit'),delay(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(log!==undefined)closeSync(log);
}
