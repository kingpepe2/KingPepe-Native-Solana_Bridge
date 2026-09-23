// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Owned Windows DPAPI + real REGTEST/local-validator regression. No production
// or retained runtime, key, journal or ledger is opened by this harness.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {spawn,fork,execFileSync} from 'node:child_process';
import {mkdirSync,existsSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {ed25519} from '@noble/curves/ed25519.js';
import {schnorr} from '@noble/curves/secp256k1.js';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {validateRuntimeStateRoot} from '../../shared/runtime-path-boundary.mjs';
import {NativeRpcClient} from '../../native/node/native-rpc-client.mjs';
import {REGTEST_GENESIS} from '../../native/node/native-raw-evidence.mjs';
import {RegtestNativeBurnVerifier} from '../../native/burn/burn-evidence.mjs';
import {RegtestBurnObserver} from '../../native/burn/burn-observer.mjs';
import {NativeBurnFeePolicy} from '../../native/burn/burn-fees.mjs';
import {nativeBurnSourceFeePolicy} from '../../native/burn/burn-source-policy.mjs';
import {burnOperationalDestination} from '../../native/burn/burn-key.mjs';
import {initialBurnAuthorizations,ProtectedNativeBurnSigner} from '../../native/burn/protected-burn-signer.mjs';
import {initialBurnAttesterState,ProtectedBurnAttester} from '../../services/attesters/protected-burn-attester.mjs';
import {ProtectedBurnSolanaSigner} from '../../services/relayer/burn-solana-signer.mjs';
import {ProtectedBurnJournal} from '../../services/bridge-validator/protected-burn-journal.mjs';
import {initialBurnJournal} from '../../services/bridge-validator/burn-journal-state.mjs';
import {BurnRuntime} from '../../services/bridge-validator/burn-runtime.mjs';
import {runBurnService} from '../../services/bridge-validator/burn-service.mjs';
import {BurnSolanaAdapter} from '../../services/solana-observer/burn-solana-adapter.mjs';
import {base58Decode,base58Encode,findProgramAddress} from '../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {prepareSignedLocalnetSolanaSetupTransaction,LOCALNET_MANAGER_PROGRAM_ID_BASE58 as MANAGER,LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58 as TRANSCEIVER,SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN} from '../../services/bridge-validator/localnet-solana-setup-plan.mjs';
import {DEPLOYMENT_MONITOR_PROTOCOL,UPGRADEABLE_LOADER} from '../../services/solana-observer/deployment-integrity.mjs';
import {parseNativeTransactionHex} from '../../native/node/native-taproot-transaction.mjs';

assert.equal(process.platform,'win32','RealDpapiHarnessRequiresWindows');
const repoRoot=path.resolve(import.meta.dirname,'../..'),root=validateRuntimeStateRoot(process.env.KINGPEPE_BURN_TEST_ROOT,repoRoot);
assert(!existsSync(root),'FreshOwnedExternalRootRequired');
const nativeVerifier=process.env.KINGPEPE_TEST_NATIVE_VERIFIER,artifactRoot=process.env.KINGPEPE_BURN_SBF_ROOT;
assert(path.isAbsolute(nativeVerifier??'')&&path.isAbsolute(artifactRoot??''));
const wslProfile=process.env.KINGPEPE_TEST_WSL_PROFILE;assert(typeof wslProfile==='string'&&wslProfile.startsWith('/mnt/')&&!/[\r\n\0]/u.test(wslProfile));
const sid=windowsCurrentServiceSid();mkdirSync(root,{recursive:false});
execFileSync('icacls.exe',[root,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});
writeFileSync(path.join(root,'OWNED-BURN-TEST'),'Owned disposable REGTEST/local-validator, no Mainnet.\n',{flag:'wx'});
const tag=randomBytes(16).toString('hex'),ledgerParent=process.env.KINGPEPE_TEST_LEDGER_PARENT;
assert(typeof ledgerParent==='string'&&ledgerParent.startsWith('/var/tmp/')&&!/[\r\n\0]/u.test(ledgerParent));
const linuxLedger=`${ledgerParent}/${tag}`;
writeFileSync(path.join(root,'owned-validator-ledger.txt'),linuxLedger+'\n',{flag:'wx'});
const report={scope:'WINDOWS_DPAPI_REAL_REGTEST_LOCAL_VALIDATOR',checks:[],events:[],productionReady:false,mainnetActivation:'DISABLED'};
const save=()=>writeFileSync(path.join(root,'evidence.json'),JSON.stringify(report,null,2)+'\n');
const pass=name=>{report.checks.push(name);save();process.stdout.write(name+'=PASS\n');};
const hex=b=>Buffer.from(b).toString('hex'),rand=()=>randomBytes(32).toString('hex');
const keys=Array.from({length:7},()=>ed25519.utils.randomSecretKey()),[payer,mintKey,tokenKey,recipient,attesterA,attesterB,upgrade]=keys;
const rootKey=schnorr.utils.randomSecretKey(),pub=k=>hex(ed25519.getPublicKey(k)),address=k=>base58Encode(ed25519.getPublicKey(k));
const toLinux=v=>'/mnt/'+v[0].toLowerCase()+v.slice(2).replaceAll('\\','/');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const nodeRoot=path.join(root,'native');mkdirSync(nodeRoot);
const logs=[],children=[],proxies=[];let rpc,nativePort,nativeEndpoint,solanaEndpoint,runtimeNativeEndpoint,runtimeSolanaEndpoint,journal,burnSigner,attesters=[],solanaSigner,runtime,policy,stores;
let loseNativeBroadcast=true,loseSolanaClaim=false,nativeResponsesLost=0,solanaResponsesLost=0,serviceController,serviceTask;
let delayedFinalizedSnapshot=false;const priorClaimSnapshots=new Map();
const nativeBroadcastIds=new Set();
const freePort=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
async function freeRpcPair(){
  for(let n=0;n<20;n++){
    const port=await freePort();if(port>=65535)continue;const s=createServer();
    try{s.listen(port+1,'127.0.0.1');await once(s,'listening');await new Promise(r=>s.close(r));return port;}
    catch{s.close();}
  }
  throw new Error('TestRpcPortPairUnavailable');
}
async function lossyTestRpc(target,kind){
  // TEST-only transport fault: forward the actual request, then discard one
  // successful response. The service must recover from chain state, not mocks.
  const server=createHttpServer(async(req,res)=>{
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert(size<=2000000);chunks.push(chunk);}
      const body=Buffer.concat(chunks),request=JSON.parse(body.toString('utf8'));
      const response=await fetch(target,{method:'POST',headers:{'content-type':'application/json',...(req.headers.authorization?{authorization:req.headers.authorization}:{})},
        body,signal:AbortSignal.timeout(30000)});
      const bytes=Buffer.from(await response.arrayBuffer()),value=JSON.parse(bytes.toString('utf8'));
      if(kind==='solana'&&request.method==='getMultipleAccounts'&&request.params[0].length===12&&!value.error){
        const key=JSON.stringify(request.params[0]),prior=priorClaimSnapshots.get(key),result=value.result;
        if(result.value[8]===null)priorClaimSnapshots.set(key,structuredClone(result));
        else if(!delayedFinalizedSnapshot&&solanaResponsesLost===1&&prior&&prior.context.slot>=(request.params[1]?.minContextSlot??0)){
          // A genuine earlier finalized response remains valid at minContextSlot.
          // Deliver it once while the next deployment read sees the landed mint.
          // This reproduces Devnet's finality advance between two RPC reads.
          delayedFinalizedSnapshot=true;report.delayedFinalizedSnapshot={priorSlot:prior.context.slot,currentSlot:result.context.slot};save();
          res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify({...value,result:prior}));return;
        }
      }
      if(kind==='native'&&request.method==='sendrawtransaction'&&!value.error){
        nativeBroadcastIds.add(value.result);
        if(loseNativeBroadcast){loseNativeBroadcast=false;nativeResponsesLost++;report.lostNativeResponseAt=new Date().toISOString();res.destroy();return;}
      }
      if(kind==='solana'&&request.method==='sendTransaction'&&loseSolanaClaim&&!value.error){
        loseSolanaClaim=false;solanaResponsesLost++;res.destroy();return;
      }
      res.writeHead(response.status,{'content-type':'application/json'});res.end(bytes);
    }catch{if(!res.destroyed){res.writeHead(503);res.end('{"error":"TEST_TRANSPORT_UNAVAILABLE"}');}}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));proxies.push(server);return `http://127.0.0.1:${server.address().port}`;
}
function startLinux(name,command){
  const log=openSync(path.join(root,name+'.log'),'wx'),pidFile=toLinux(path.join(root,name+'.pid'));logs.push(log);
  const lifecycle=name==='solana'?`export KINGPEPE_TEST_LIFECYCLE_ACTIVE=1 KINGPEPE_DEV_RUN_ID=${tag} KINGPEPE_TEST_SOURCE_ROOT=${quote(toLinux(repoRoot))}\n`:'';
  const script=`set -e\n. ${quote(wslProfile)}\n${lifecycle}echo $$ > ${quote(pidFile)}\nexec ${command.map(quote).join(' ')}`;
  const child=spawn('wsl.exe',['--exec','bash','-lc',script],{windowsHide:true,stdio:['ignore',log,log]});children.push({name,child,pidFile});return child;
}
async function native(method,params=[],wallet=''){
  const auth=readFileSync(path.join(nodeRoot,'regtest','.cookie'),'utf8').trim();
  const response=await fetch(nativeEndpoint+(wallet?'/wallet/'+wallet:''),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{'content-type':'application/json',authorization:'Basic '+Buffer.from(auth).toString('base64')},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const v=await response.json();if(v.error)throw new Error(`TestNative:${method}:${v.error.code}`);assert(response.ok);return v.result;
}
async function solana(method,params=[]){
  const response=await fetch(solanaEndpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const v=await response.json();if(v.error){const e=new Error(`TestSolana:${method}:${v.error.code}`);e.safeLogs=(v.error.data?.logs??[]).filter(s=>s.startsWith('Program '));throw e;}assert(response.ok);return v.result;
}
async function waitFinal(signature){
  for(let n=0;n<180;n++){const s=(await solana('getSignatureStatuses',[[signature],{searchTransactionHistory:true}])).value[0];
    if(s?.confirmationStatus==='finalized'){assert.equal(s.err,null);return s;}await delay(250);}
  throw new Error('TestFinalityTimeout');
}
async function closeRuntime(){await journal?.close();await burnSigner?.close();for(const a of attesters)await a.close();solanaSigner?.close();journal=burnSigner=solanaSigner=null;attesters=[];runtime=null;}
async function openRuntime(){
  rpc=new NativeRpcClient({endpoint:runtimeNativeEndpoint,authCookieFile:path.join(nodeRoot,'regtest','.cookie'),repoRoot});
  const verifier=new RegtestNativeBurnVerifier({rpc,executable:nativeVerifier});
  journal=await ProtectedBurnJournal.open(new WindowsProtectedStore(stores.journal));
  burnSigner=await ProtectedNativeBurnSigner.open({keyStore:new WindowsProtectedStore(stores.burnKey),authorizationStore:new WindowsProtectedStore(stores.burnState)});
  for(const [i,role] of ['ATTESTER_A','ATTESTER_B'].entries())attesters.push(await ProtectedBurnAttester.open({role,context:policy.context,
    keyStore:new WindowsProtectedStore(stores['attesterKey'+i]),authorizationStore:new WindowsProtectedStore(stores['attesterState'+i]),
    verifier:new RegtestNativeBurnVerifier({rpc:new NativeRpcClient({endpoint:runtimeNativeEndpoint,authCookieFile:path.join(nodeRoot,'regtest','.cookie'),repoRoot}),executable:nativeVerifier})}));
  solanaSigner=new ProtectedBurnSolanaSigner({store:new WindowsProtectedStore(stores.payer),context:policy.context,feePayerHex:policy.feePayerHex});
const fees=new NativeBurnFeePolicy({rpc,policy:nativeBurnSourceFeePolicy()});
  runtime=new BurnRuntime({journal,observer:new RegtestBurnObserver(rpc),verifier,fees,burnSigner,attesters,solana:new BurnSolanaAdapter({policy,endpoint:runtimeSolanaEndpoint}),solanaSigner,
    onEvent:event=>{report.events.push(event);save();
      if(event.event==='PROCESSING_HELD'&&event.operationId){
        const op=journal.read().operations.find(o=>o.operationId===event.operationId);
        // Signed TEST packets contain public evidence, not key material. Keep
        // failed execution diagnostics private alongside this owned TEST run.
        writeFileSync(path.join(root,'held-operation-diagnostic.json'),JSON.stringify({event,solanaEndpoint,operationId:event.operationId,state:op?.state,packet:op?.solanaPacket?.at(-1)?.packet??null}));
      }
      if(event.event==='RECEIPT_BROADCAST'&&solanaResponsesLost===0)loseSolanaClaim=true;
    }});
}
try{
  nativePort=await freePort();const solanaPort=await freeRpcPair(),faucetPort=await freePort();nativeEndpoint=`http://127.0.0.1:${nativePort}`;solanaEndpoint=`http://127.0.0.1:${solanaPort}`;
  const nativeChild=startLinux('native',['kingpeped','-regtest','-server=1','-datadir='+toLinux(nodeRoot),'-txindex=1','-listen=0','-connect=0','-dnsseed=0','-discover=0','-listenonion=0',
    '-rpcbind=127.0.0.1','-rpcallowip=127.0.0.1','-rpcport='+nativePort,'-acceptnonstdtxn=0','-datacarrier=1','-fallbackfee=0.00001000']);
  const validator=startLinux('solana',['solana-test-validator','--ledger',linuxLedger,'--bind-address','127.0.0.1','--rpc-port',String(solanaPort),'--faucet-port',String(faucetPort),
    '--limit-ledger-size','100000','--quiet','--upgradeable-program',MANAGER,toLinux(path.join(artifactRoot,'kingpepe_bridge.so')),address(upgrade),
    '--upgradeable-program',TRANSCEIVER,toLinux(path.join(artifactRoot,'kingpepe_transceiver.so')),address(upgrade)]);
  for(let n=0;n<240;n++){assert.equal(nativeChild.exitCode,null);assert.equal(validator.exitCode,null);
    try{assert.equal((await native('getblockchaininfo')).chain,'regtest');assert.equal(await solana('getHealth'),'ok');break;}catch(e){if(n===239)throw e;await delay(500);}}
  assert.equal(await native('getblockhash',[0]),REGTEST_GENESIS);const genesis=await solana('getGenesisHash');
  assert(!['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].includes(genesis));pass('ISOLATED_ACTUAL_NETWORKS');
  runtimeNativeEndpoint=await lossyTestRpc(nativeEndpoint,'native');runtimeSolanaEndpoint=await lossyTestRpc(solanaEndpoint,'solana');
  await waitFinal(await solana('requestAirdrop',[address(payer),10_000_000_000]));
  const deployment=rand(),context={environment:'localnet',deployment:{protocolId:1,nativeNetwork:8000111,nativeGenesis:REGTEST_GENESIS,solanaGenesis:hex(base58Decode(genesis)),solanaDeployment:deployment,
    bridgeProgram:hex(base58Decode(MANAGER)),transceiverProgram:hex(base58Decode(TRANSCEIVER)),mint:pub(mintKey),burnPublicKey:hex(schnorr.getPublicKey(rootKey))},keyEpoch:1,policyEpoch:1,attesters:[pub(attesterA),pub(attesterB)]};
  const block=(await solana('getLatestBlockhash',[{commitment:'finalized'}])).value,signer=k=>({publicKeyHex:pub(k),sign:bytes=>ed25519.sign(bytes,k)});
  const setup=await prepareSignedLocalnetSolanaSetupTransaction({environment:'localnet',cluster:'localnet',managerProgramIdBase58:MANAGER,transceiverProgramIdBase58:TRANSCEIVER,
    solanaDeploymentHex:deployment,nativeGenesisHex:REGTEST_GENESIS,protocolId:1,nativeNetwork:8000111,mintHex:pub(mintKey),recipientTokenAccountHex:pub(tokenKey),recipientTokenAccountOwnerHex:pub(recipient),
    feePayerHex:pub(payer),recentBlockhashBase58:block.blockhash,lastValidBlockHeight:String(block.lastValidBlockHeight),attesterPublicKeysHex:context.attesters,decimals:8,nativeDecimals:8,keyEpoch:1,policyEpoch:1,
    mintRentLamports:String(await solana('getMinimumBalanceForRentExemption',[82])),tokenAccountRentLamports:String(await solana('getMinimumBalanceForRentExemption',[165])),
    feePayerSigner:signer(payer),mintSigner:signer(mintKey),recipientTokenAccountSigner:signer(tokenKey)});
  await waitFinal(await solana('sendTransaction',[setup.preparedTransactionBase64,{encoding:'base64',preflightCommitment:'finalized',skipPreflight:false}]));
  const pd=(seed,program)=>findProgramAddress([Buffer.from(seed),ed25519.getPublicKey(mintKey)],base58Decode(program)).base58;
  const program=id=>({id,loader:UPGRADEABLE_LOADER,programData:findProgramAddress([base58Decode(id)],base58Decode(UPGRADEABLE_LOADER)).base58,upgradeAuthority:address(upgrade),deploymentSlot:'0'});
  const manifest={protocol:DEPLOYMENT_MONITOR_PROTOCOL,environment:'localnet',sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),identityVersion:1,
    nativeGenesisHex:REGTEST_GENESIS,solanaGenesis:genesis,solanaDeploymentHex:deployment,minimumSlot:'0',maximumStallMs:60000,manager:program(MANAGER),transceiver:program(TRANSCEIVER),
    mint:{id:address(mintKey),tokenProgram:TOKEN,authority:pd('kingpepe-mint-authority',MANAGER),decimals:8},
    config:{bridgePda:pd('kingpepe-bridge-state',MANAGER),transceiverPda:pd('kingpepe-transceiver-config',TRANSCEIVER),policyEpoch:1,keyEpoch:1,protocolId:1,nativeNetwork:8000111,
      attesters:[address(attesterA),address(attesterB)],depositsPaused:false,transceiverActive:true}};
  const artifact=file=>{const data=readFileSync(path.join(artifactRoot,file));return {sha256:createHash('sha256').update(data).digest('hex'),byteLength:data.length};};
  policy={context,manifest,feePayerHex:pub(payer),artifacts:{manager:artifact('kingpepe_bridge.so'),transceiver:artifact('kingpepe_transceiver.so')}};
  assert.equal((await new BurnSolanaAdapter({policy,endpoint:solanaEndpoint}).deployment()).mintSupplyAtomic,'0');pass('CURRENT_SBF_ZERO_SUPPLY_ENROLLMENT');
  report.artifacts=policy.artifacts;report.sourceScope='UNCOMMITTED_WORKTREE_TEST_NOT_EXACT_SHA_CI';
  const binding={...context.deployment,destination:pub(recipient),nonce:rand()};stores={};
  function store(name,role,purpose,payload){const options={root:path.join(root,'protected',name),repoRoot,context:{role,purpose,serviceSid:sid,environment:'localnet',nativeGenesis:REGTEST_GENESIS,solanaDeployment:deployment,instanceId:rand(),keyEpoch:1}};
    const created=WindowsProtectedStore.create(options,payload);created.close();stores[name]=options;}
  mkdirSync(path.join(root,'protected'));store('burnKey','BURN_SIGNER','native-burn-key',rootKey);store('burnState','BURN_SIGNER','native-burn-authorizations',initialBurnAuthorizations(binding.burnPublicKey));
  store('payer','FEE_PAYER','fee-payer-seed',payer);
  for(const [i,seed] of [attesterA,attesterB].entries()){const role=['ATTESTER_A','ATTESTER_B'][i];store('attesterKey'+i,role,'attester-seed',seed);store('attesterState'+i,role,'burn-attester-authorizations',initialBurnAttesterState(context,role));}
  store('journal','BRIDGE_VALIDATOR','burn-operations',Buffer.from(JSON.stringify(initialBurnJournal(binding,{context,feePayerHex:pub(payer)}))));
  writeFileSync(path.join(root,'private-test-references.json'),JSON.stringify({stores,policy}));
  keys.forEach(k=>k.fill(0));rootKey.fill(0);
  const password=rand();await native('createwallet',{wallet_name:'user',passphrase:password,load_on_startup:true});await native('walletpassphrase',[password,3600],'user');
  const mining=await native('getnewaddress',['burn-runtime-proof','bech32m'],'user'),mine=count=>native('generatetoaddress',[count,mining]);await mine(21);
  const fees=burnOperationalDestination(binding);await native('sendtoaddress',[fees.address,'0.01000000'],'user');await mine(12);
  await openRuntime();await runtime.cycle();assert.equal(runtime.status().reconciliation,'MATCH');await runtime.resumeReviewedTestRuntime();
  const created=await runtime.createOperation({destinationHex:binding.destination,nonce:binding.nonce});report.operationId=created.operationId;
  assert.deepEqual(await runtime.createOperation({destinationHex:binding.destination,nonce:binding.nonce}),created);pass('DESTINATION_BOUND_BEFORE_SINGLE_USE_ADDRESS');
  await native('sendtoaddress',[created.depositAddress,'0.00100000'],'user');await mine(1);await runtime.cycle();
  assert.equal(runtime.operation(created.operationId).depositConfirmations,1);assert.equal(journal.read().operations[0].plan,null);pass('NO_BURN_BEFORE_DEPOSIT_FINALITY');
  await closeRuntime();await openRuntime();await runtime.cycle();
  assert.equal(runtime.operation(created.operationId).destinationHex,binding.destination);assert.equal(journal.read().operations[0].plan,null);pass('RESTART_BEFORE_FINALITY_PRESERVES_BINDING_NO_BURN');
  await mine(11);
  for(let n=0;n<120;n++){await runtime.cycle();const status=runtime.status();assert.notEqual(status.state,'PAUSED',JSON.stringify(status));if(runtime.operation(created.operationId).burnTxid)break;await delay(300);}
  const burned=runtime.operation(created.operationId);assert(burned.burnTxid,'AutomaticBurnDidNotRun');
  assert.equal(burned.state,'BURN_BROADCAST');assert.equal((await new BurnSolanaAdapter({policy,endpoint:solanaEndpoint}).deployment()).mintSupplyAtomic,'0');
  report.burnTxid=burned.burnTxid;report.depositTxid=burned.depositTxid;
  const record=journal.read().operations[0],raw=parseNativeTransactionHex(await rpc.getRawTransaction(burned.burnTxid,false));
  assert.equal(raw.outputs[0].amountAtomic,'100000');assert.equal(record.plan.inputs[0].amountAtomic,'100000');
  assert.equal(BigInt(record.plan.inputs[1].amountAtomic)-BigInt(raw.outputs[1].amountAtomic),BigInt(record.plan.feeAtomic));
  report.amounts={deposit:'100000',burn:raw.outputs[0].amountAtomic,minerFee:record.plan.feeAtomic,operationalChange:raw.outputs[1].amountAtomic};pass('AUTOMATIC_TWO_INPUT_BURN_NO_USER_FEE_DEDUCTION');
  assert.equal(nativeResponsesLost,1);await closeRuntime();await openRuntime();await runtime.cycle();
  assert.equal(runtime.operation(created.operationId).burnTxid,report.burnTxid);assert.equal(nativeBroadcastIds.size,1);pass('LOST_NATIVE_RESPONSE_AND_RESTART_RECOVER_SAME_BURN');
  await mine(11);await runtime.cycle();assert.equal(journal.read().operations[0].burnEvidence,null);assert.equal((await new BurnSolanaAdapter({policy,endpoint:solanaEndpoint}).deployment()).mintSupplyAtomic,'0');pass('NO_MINT_AT_ELEVEN_BURN_CONFIRMATIONS');
  // The child is deliberately terminated after persisting finalized burn
  // evidence, before it can attest or mint. Recovery uses another process.
  await closeRuntime();await mine(1);
  const recoveryFile=path.join(root,'recovery-actor-private.json');
  writeFileSync(recoveryFile,JSON.stringify({nativeRpcOptions:{endpoint:runtimeNativeEndpoint,authCookieFile:path.join(nodeRoot,'regtest','.cookie'),repoRoot},
    nativeVerifierExecutable:nativeVerifier,policy,solanaEndpoint:runtimeSolanaEndpoint,stores,
    feePolicy:nativeBurnSourceFeePolicy()}),{flag:'wx'});
  let persistedBurn=false;
  const actor=fork(path.join(repoRoot,'tests/windows/burn-runtime-actor.mjs'),[recoveryFile],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const stopped=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{actor.kill();reject(new Error('CrashAfterBurnTestTimeout'));},60000);
    actor.on('error',reject);
    actor.on('message',data=>{
      if(data.ready)actor.send({id:1,command:'cycle',input:null});
      if(data.error){clearTimeout(timeout);actor.kill();reject(new Error(data.error));}
      if(data.event){report.events.push(data.event);save();
        if(data.event.event==='BURN_FINALIZED'){persistedBurn=true;actor.kill('SIGKILL');}}
    });
    actor.once('exit',()=>{clearTimeout(timeout);resolve();});
  });
  await stopped;assert(persistedBurn,'FinalizedBurnCrashBoundaryNotReached');
  assert.equal((await new BurnSolanaAdapter({policy,endpoint:solanaEndpoint}).deployment()).mintSupplyAtomic,'0');
  pass('REAL_PROCESS_CRASH_AFTER_FINALIZED_BURN_BEFORE_MINT');
  await openRuntime();assert.equal(journal.read().operations[0].burnEvidence.burn.txid,report.burnTxid);
  for(let n=0;n<160;n++){await runtime.cycle();const status=runtime.status();assert.notEqual(status.state,'PAUSED',JSON.stringify(status));
    if(runtime.operation(created.operationId).state==='COMPLETED')break;await delay(300);}
  const completed=runtime.operation(created.operationId);assert.equal(completed.state,'COMPLETED',JSON.stringify(runtime.status()));
  assert.equal(completed.burnTxid,report.burnTxid);assert.equal(completed.destinationHex,binding.destination);assert.equal(runtime.status().accounting.completedAtomic,'100000');
  report.solanaSignature=completed.solanaSignature;report.amounts.minted=journal.read().operations[0].mintReceipt.amountAtomic;
  assert.equal(report.amounts.minted,report.amounts.burn);pass('RESTART_AFTER_BURN_RECOVERS_ONE_MINT');
  assert.equal(solanaResponsesLost,1);assert.equal(nativeBroadcastIds.size,1);pass('LOST_SOLANA_CLAIM_RESPONSE_RECOVERS_EXACTLY_ONCE');
  assert(delayedFinalizedSnapshot,'FinalizedSnapshotRaceNotExercised');pass('FINALIZED_CLAIM_AND_ISSUANCE_READ_RACE_RECOVERS_WITHOUT_FALSE_PAUSE');
  await closeRuntime();await openRuntime();await runtime.cycle();await runtime.cycle();
  assert.equal(runtime.operation(created.operationId).state,'COMPLETED');assert.equal(journal.read().operations.length,1);
  assert.equal((await new BurnSolanaAdapter({policy,endpoint:solanaEndpoint}).deployment()).mintSupplyAtomic,'100000');pass('COMPLETED_RESTART_NO_SECOND_BURN_OR_MINT');
  await native('sendtoaddress',[created.depositAddress,'0.00001000'],'user');await mine(1);await runtime.cycle();
  assert.equal(runtime.operation(created.operationId).exception,'LATE_DEPOSIT_TO_RETIRED_ADDRESS');assert.equal(runtime.status().accounting.completedAtomic,'100000');pass('LATE_DEPOSIT_RECORDED_WITHOUT_BURN_OR_MINT');
  await closeRuntime();
  // Exercise the actual continuously running authenticated service rather
  // than advancing its processing loop explicitly from the test harness.
  const accessToken=randomBytes(32),port=await freePort(),tokenStore={root:path.join(root,'protected','service-auth'),repoRoot,
    context:{role:'BRIDGE_VALIDATOR',purpose:'service-auth',serviceSid:sid,environment:'localnet',nativeGenesis:REGTEST_GENESIS,solanaDeployment:deployment,instanceId:rand(),keyEpoch:1}};
  WindowsProtectedStore.create(tokenStore,accessToken).close();
  const serviceFile=path.join(root,'service-private.json');
  writeFileSync(serviceFile,JSON.stringify({runtime:JSON.parse(readFileSync(recoveryFile,'utf8')),accessTokenStore:tokenStore,port,intervalMs:1000,productionReady:false,mainnetActivation:'DISABLED'}),{flag:'wx'});
  const auth='Bearer '+accessToken.toString('hex');accessToken.fill(0);
  const api=async(route,input)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:input?'POST':'GET',headers:{authorization:auth,'content-type':'application/json'},
    ...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.json();};
  let listening=false;serviceController=new AbortController();
  serviceTask=runBurnService(serviceFile,{signal:serviceController.signal,log:event=>{if(event.event==='TEST_SERVICE_LISTENING')listening=true;report.events.push(event);save();}});
  // Install the rejection handler immediately while still surfacing failures.
  let serviceError;serviceTask.catch(error=>{serviceError=error;});
  for(let n=0;n<600&&!listening;n++){if(serviceError)throw serviceError;await delay(100);}
  assert(listening,'AutomaticServiceDidNotListen');
  const request={walletChain:'solana:localnet',destination:base58Encode(Buffer.from(binding.destination,'hex')),clientNonce:rand()};
  const automatic=await api('/operations',request);assert.notEqual(automatic.depositAddress,created.depositAddress);
  assert.equal((await api('/operations',request)).operationId,automatic.operationId);
  await native('sendtoaddress',[automatic.depositAddress,'0.00100000'],'user');await mine(12);
  let auto;
  for(let n=0;n<150;n++){if(serviceError)throw serviceError;auto=await api('/operations/'+automatic.operationId);if(auto.burnTxid)break;await delay(500);}
  assert(auto.burnTxid,'AutomaticDaemonDidNotBurn');assert.equal((await api('/bridge/status')).supply.bridgedSupplyAtomic,'100000');
  // Persist-before-broadcast exposes the intended TXID before the RPC has
  // accepted it. Mine only once the actual Native mempool contains that TX.
  let accepted=false;for(let n=0;n<100;n++){if((await native('getrawmempool')).includes(auto.burnTxid)){accepted=true;break;}await delay(200);}
  assert(accepted,'AutomaticBurnNotAcceptedByNativeNode');
  await mine(12);
  for(let n=0;n<240;n++){if(serviceError)throw serviceError;auto=await api('/operations/'+automatic.operationId);if(auto.state==='COMPLETED')break;await delay(500);}
  assert.equal(auto.state,'COMPLETED');assert.equal(auto.destination,request.destination);assert.equal(auto.amountAtomic,'100000');
  const status=await api('/bridge/status');assert.equal(status.supply.bridgedSupplyAtomic,'200000');assert.equal(status.supply.remainingSupplyAtomic,'2099999999800000');
  assert.equal(status.productionReady,false);assert.equal(status.mainnetActivation,'DISABLED');
  report.automaticServiceOperation={operationId:auto.operationId,depositTxid:auto.depositTxid,burnTxid:auto.burnTxid,solanaSignature:auto.solanaSignature,amountAtomic:auto.amountAtomic};
  pass('REAL_AUTOMATIC_SERVICE_HTTP_FLOW_AND_COUNTER_REFRESH');
  const ambiguous=await api('/operations',{...request,clientNonce:rand()});
  await native('sendtoaddress',[ambiguous.depositAddress,'0.00100000'],'user');await native('sendtoaddress',[ambiguous.depositAddress,'0.00100000'],'user');await mine(12);
  let held;for(let n=0;n<80;n++){held=await api('/operations/'+ambiguous.operationId);if(held.exception)break;await delay(250);}
  assert.equal(held.exception,'MULTIPLE_DEPOSITS_REQUIRE_REVIEW');assert.equal(held.burnTxid,null);
  let stable;for(let n=0;n<100;n++){stable=await api('/bridge/status');assert.notEqual(stable.state,'PAUSED');if(stable.supply.state==='READY')break;await delay(500);}
  assert.equal(stable.supply.bridgedSupplyAtomic,'200000');
  pass('MULTIPLE_ACTIVE_DEPOSITS_HELD_WITHOUT_AGGREGATION');
  serviceController.abort();await serviceTask;serviceTask=null;await openRuntime();await runtime.pause();await closeRuntime();
  // A launch argument left in a supervisor must never unpause an existing
  // operator/critical stop. Only initial empty TEST admission can use it.
  listening=false;serviceController=new AbortController();serviceTask=runBurnService(serviceFile,{resumeReviewedTest:true,signal:serviceController.signal,log:event=>{if(event.event==='TEST_SERVICE_LISTENING')listening=true;}});
  serviceTask.catch(error=>{serviceError=error;});
  for(let n=0;n<600&&!listening;n++){if(serviceError)throw serviceError;await delay(100);}
  assert.equal((await api('/bridge/status')).state,'PAUSED');pass('SERVICE_RESTART_PRESERVES_EXPLICIT_PAUSE');
  serviceController.abort();await serviceTask;serviceTask=null;
  const operationTimes=operationId=>Object.fromEntries(['DEPOSIT_FINALITY_REACHED','BURN_CONSTRUCTED','BURN_BROADCAST'].map(event=>[event,
    report.events.find(e=>e.event===event&&e.operationId===operationId)?.at??null]));
  const times=operationTimes(report.operationId);
  report.automaticBurn={operationId:report.operationId,...times,broadcastResponseIntentionallyLost:true,broadcastObservedAt:report.lostNativeResponseAt,
    latencyMilliseconds:Date.parse(report.lostNativeResponseAt)-Date.parse(times.DEPOSIT_FINALITY_REACHED)};
  const daemonTimes=operationTimes(auto.operationId);
  report.automaticServiceOperation.timing={...daemonTimes,latencyMilliseconds:Date.parse(daemonTimes.BURN_BROADCAST)-Date.parse(daemonTimes.DEPOSIT_FINALITY_REACHED)};
  report.result='PASS';save();
}catch(error){
  report.result='FAIL';report.failure={code:error.message,stack:error.stack?.split('\n').slice(0,6),safeLogs:error.safeLogs};save();
  if(existsSync(path.join(root,'held-operation-diagnostic.json'))){
    try{const diagnostic=JSON.parse(readFileSync(path.join(root,'held-operation-diagnostic.json')));
      if(diagnostic.packet){const result=await solana('simulateTransaction',[diagnostic.packet.preparedTransactionBase64,{encoding:'base64',commitment:'finalized',sigVerify:false,replaceRecentBlockhash:true}]);
        writeFileSync(path.join(root,'packet-simulation.json'),JSON.stringify({err:result.value.err,unitsConsumed:result.value.unitsConsumed,logs:result.value.logs},null,2));}}
    catch{} // Original failure remains authoritative; no transaction is sent.
  }
  throw error;
}
finally{
  serviceController?.abort();if(serviceTask)try{await serviceTask;}catch{}
  await closeRuntime();keys.forEach(k=>k.fill(0));rootKey.fill(0);
  try{await native('stop');}catch{
    if(nativePort)try{execFileSync('wsl.exe',['--exec','bash','-lc',`. ${quote(wslProfile)}\nkingpepe-cli -regtest -datadir=${quote(toLinux(nodeRoot))} -rpcport=${nativePort} stop`],{windowsHide:true,stdio:'pipe',timeout:10000});}catch{}
  }
  for(const server of proxies){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  for(const item of children){
    if(item.name==='solana'&&item.child.exitCode===null){
      // WSL shell/wrapper PIDs can exit before the detached validator. Address
      // only this fresh run's admin socket; never terminate by process name.
      const cleanup=`import pathlib,socket,json,sys\np=pathlib.Path(sys.argv[1])\nassert p.parent==pathlib.Path(sys.argv[2]) and not p.is_symlink()\n`+
        `with socket.socket(socket.AF_UNIX) as s:\n s.settimeout(5)\n s.connect(str(p/'admin.rpc'))\n s.sendall(b'{"jsonrpc":"2.0","id":1,"method":"exit","params":[]}\\n')\n r=json.loads(s.recv(4096))\n assert r.get('id')==1 and 'error' not in r\n`;
      try{execFileSync('wsl.exe',['--exec','python3','-',linuxLedger,ledgerParent],{input:cleanup,windowsHide:true,stdio:['pipe','pipe','pipe'],timeout:10000});report.validatorShutdown='ADMIN_EXIT_ACKNOWLEDGED';}
      catch{report.validatorShutdown='REQUIRES_OWNED_PROCESS_INSPECTION';}
    }
    if(item.child.exitCode===null)await Promise.race([once(item.child,'exit'),delay(15000)]);
  }
  for(const log of logs)closeSync(log);save();
}
