// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real REGTEST/local-validator protocol regression. Ephemeral TEST keys exist
// only in this process; this is not a plaintext fallback for the Windows service.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {createServer,createConnection} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {ed25519} from '@noble/curves/ed25519.js';
import {schnorr} from '@noble/curves/secp256k1.js';
import {validateRuntimeStateRoot} from '../../shared/runtime-path-boundary.mjs';
import {sourceIdentity} from '../../scripts/source-identity.mjs';
import {NativeRpcClient} from '../../native/node/native-rpc-client.mjs';
import {REGTEST_GENESIS} from '../../native/node/native-raw-evidence.mjs';
import {RegtestNativeBurnVerifier,requireBurnDepositAdmission,requireFinalizedNativeBurn} from '../../native/burn/burn-evidence.mjs';
import {burnDepositDestination,burnOperationalDestination,signNativeBurnWithKey} from '../../native/burn/burn-key.mjs';
import {NativeBurnFeePolicy} from '../../native/burn/burn-fees.mjs';
import {nativeBurnSourceFeePolicy} from '../../native/burn/burn-source-policy.mjs';
import {parseNativeTransactionHex} from '../../native/node/native-taproot-transaction.mjs';
import {encodeBurnMessage} from '../../shared/protocol/burn-message.mjs';
import {decodeCanonicalBridgeMessage} from '../../shared/protocol/canonical-message.mjs';
import {BurnSolanaAdapter,burnSolanaAddresses} from '../../services/solana-observer/burn-solana-adapter.mjs';
import {fundEmptyTestAccounts} from './support/fund-empty-test-accounts.mjs';
import {ATTESTATION_PROTOCOL,ATTESTATION_MODE,BURN_SIGNED_BYTES,verifyBurnAttestationPair} from '../../services/attesters/burn-attestation-codec.mjs';
import {associatedTokenCreationMessage,burnSolanaPlanOptions,verifyBurnSolanaPacket} from '../../services/relayer/burn-solana-signer.mjs';
import {base58Encode,base58Decode,findProgramAddress,prepareSignedLocalnetSolanaDepositClaimTransaction,prepareSignedLocalnetSolanaDepositReceiptTransaction} from '../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs';
import {prepareSignedLocalnetSolanaSetupTransaction,LOCALNET_MANAGER_PROGRAM_ID_BASE58 as MANAGER,LOCALNET_TRANSCEIVER_PROGRAM_ID_BASE58 as TRANSCEIVER,SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN} from '../../services/bridge-validator/localnet-solana-setup-plan.mjs';
import {DEPLOYMENT_MONITOR_PROTOCOL,UPGRADEABLE_LOADER} from '../../services/solana-observer/deployment-integrity.mjs';
import {initialBurnJournal,issueBurnDeposit,recordBurnDeposits,retainBurnPlan,retainSignedBurn,markBurnBroadcast,retainFinalBurn,
  prepareBurnAuthorization,retainBurnAttestation,retainBurnMint,completeBurnOperation,validateBurnJournalState,reconcileBurnAccounting} from '../../services/bridge-validator/burn-journal-state.mjs';

const repoRoot=path.resolve(import.meta.dirname,'../..'),root=validateRuntimeStateRoot(process.env.KINGPEPE_BURN_TEST_ROOT,repoRoot);
assert(!existsSync(root),'FreshOwnedExternalRootRequired');
const nativeVerifier=process.env.KINGPEPE_TEST_NATIVE_VERIFIER,artifactRoot=process.env.KINGPEPE_BURN_SBF_ROOT;
assert(path.isAbsolute(nativeVerifier??'')&&path.isAbsolute(artifactRoot??''));
assert.match(execFileSync('kingpeped',['--version'],{encoding:'utf8'}),/v31\.1\.0/u);
mkdirSync(root,{mode:0o700});
writeFileSync(path.join(root,'OWNED-BURN-TEST'),'Isolated REGTEST/local-validator only.\n',{flag:'wx',mode:0o600});
const hex=b=>Buffer.from(b).toString('hex'),rand=()=>randomBytes(32).toString('hex'),pub=k=>hex(ed25519.getPublicKey(k)),address=k=>base58Encode(ed25519.getPublicKey(k));
const keys=Array.from({length:7},()=>ed25519.utils.randomSecretKey()),[payer,mintKey,tokenKey,recipient,attesterA,attesterB,upgrade]=keys;
const rootKey=schnorr.utils.randomSecretKey(),report={scope:'REAL_REGTEST_LOCAL_VALIDATOR_BURN_PROTOCOL',checks:[],productionReady:false,mainnetActivation:'DISABLED'};
const save=()=>writeFileSync(path.join(root,'evidence.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const pass=name=>{report.checks.push(name);save();process.stdout.write(name+'=PASS\n');};
const runId=randomBytes(16).toString('hex'),nodeRoot=path.join(root,'native');
const ledger=process.env.KINGPEPE_TEST_LEDGER_PARENT
  ?path.join(validateRuntimeStateRoot(process.env.KINGPEPE_TEST_LEDGER_PARENT,repoRoot),runId):path.join(root,'solana-ledger');
assert(!existsSync(ledger),'FreshOwnedLedgerRequired');mkdirSync(nodeRoot,{mode:0o700});
writeFileSync(path.join(root,'owned-ledger.txt'),ledger+'\n',{flag:'wx',mode:0o600});
const children=[],logs=[];let nativeEndpoint,solanaEndpoint,nativeReady=false;
const freePort=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
async function pair(){for(let n=0;n<20;n++){const p=await freePort();if(p>=65535)continue;const s=createServer();try{s.listen(p+1,'127.0.0.1');await once(s,'listening');await new Promise(r=>s.close(r));return p;}catch{s.close();}}throw new Error('TestPortsUnavailable');}
function start(name,exe,args){const fd=openSync(path.join(root,name+'.log'),'wx',0o600);logs.push(fd);
  const child=spawn(exe,args,{windowsHide:true,stdio:['ignore',fd,fd],env:{...process.env,KINGPEPE_TEST_LIFECYCLE_ACTIVE:'1',KINGPEPE_DEV_RUN_ID:runId,KINGPEPE_TEST_SOURCE_ROOT:repoRoot}});children.push(child);return child;}
async function native(method,params=[],wallet=''){
  const response=await fetch(nativeEndpoint+(wallet?'/wallet/'+wallet:''),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',
    authorization:'Basic '+Buffer.from(readFileSync(path.join(nodeRoot,'regtest','.cookie'),'utf8').trim()).toString('base64')},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const v=await response.json();if(v.error)throw new Error(`TestNative:${method}:${v.error.code}`);assert(response.ok);return v.result;
}
async function solana(method,params=[]){
  const response=await fetch(solanaEndpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const v=await response.json();if(v.error)throw new Error(`TestSolana:${method}:${v.error.code}`);assert(response.ok);return v.result;
}
async function finalized(signature){for(let n=0;n<240;n++){
  const status=(await solana('getSignatureStatuses',[[signature],{searchTransactionHistory:true}])).value[0];
  if(status?.confirmationStatus==='finalized'){assert.equal(status.err,null);return status;}await delay(250);
}throw new Error('TestSolanaFinalityTimeout');}
try{
  const nativePort=await freePort(),solanaPort=await pair(),faucetPort=await freePort();nativeEndpoint=`http://127.0.0.1:${nativePort}`;solanaEndpoint=`http://127.0.0.1:${solanaPort}`;
  start('native','kingpeped',['-regtest','-server=1','-datadir='+nodeRoot,'-txindex=1','-listen=0','-connect=0','-dnsseed=0','-discover=0','-listenonion=0',
    '-rpcbind=127.0.0.1','-rpcallowip=127.0.0.1','-rpcport='+nativePort,'-acceptnonstdtxn=0','-datacarrier=1','-fallbackfee=0.00001000']);
  start('solana','solana-test-validator',['--ledger',ledger,'--bind-address','127.0.0.1','--rpc-port',String(solanaPort),'--faucet-port',String(faucetPort),'--quiet','--limit-ledger-size','100000',
    '--upgradeable-program',MANAGER,path.join(artifactRoot,'kingpepe_bridge.so'),address(upgrade),'--upgradeable-program',TRANSCEIVER,path.join(artifactRoot,'kingpepe_transceiver.so'),address(upgrade)]);
  for(let n=0;n<240;n++){assert(children.every(c=>c.exitCode===null),'OwnedTestProcessExited');try{
    assert.equal((await native('getblockchaininfo')).chain,'regtest');nativeReady=true;assert.equal(await solana('getHealth'),'ok');break;
  }catch(e){if(n===239)throw e;await delay(500);}}
  assert.equal(await native('getblockhash',[0]),REGTEST_GENESIS);const genesis=await solana('getGenesisHash');
  assert(!['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','EtWTRABZaYq6iMfeYKouRu166VU2xqa1'].includes(genesis));pass('ACTUAL_ISOLATED_NETWORKS');
  await finalized(await solana('requestAirdrop',[address(payer),10_000_000_000]));
  const deployment=rand(),context={environment:'localnet',deployment:{protocolId:1,nativeNetwork:8000111,nativeGenesis:REGTEST_GENESIS,solanaGenesis:hex(base58Decode(genesis)),solanaDeployment:deployment,
    bridgeProgram:hex(base58Decode(MANAGER)),transceiverProgram:hex(base58Decode(TRANSCEIVER)),mint:pub(mintKey),burnPublicKey:hex(schnorr.getPublicKey(rootKey))},keyEpoch:1,policyEpoch:1,attesters:[pub(attesterA),pub(attesterB)]};
  const latest=(await solana('getLatestBlockhash',[{commitment:'finalized'}])).value,signer=k=>({publicKeyHex:pub(k),sign:bytes=>ed25519.sign(bytes,k)});
  const setup=await prepareSignedLocalnetSolanaSetupTransaction({environment:'localnet',cluster:'localnet',managerProgramIdBase58:MANAGER,transceiverProgramIdBase58:TRANSCEIVER,
    solanaDeploymentHex:deployment,nativeGenesisHex:REGTEST_GENESIS,protocolId:1,nativeNetwork:8000111,mintHex:pub(mintKey),recipientTokenAccountHex:pub(tokenKey),recipientTokenAccountOwnerHex:pub(recipient),
    feePayerHex:pub(payer),recentBlockhashBase58:latest.blockhash,lastValidBlockHeight:String(latest.lastValidBlockHeight),attesterPublicKeysHex:context.attesters,decimals:8,nativeDecimals:8,keyEpoch:1,policyEpoch:1,
    mintRentLamports:String(await solana('getMinimumBalanceForRentExemption',[82])),tokenAccountRentLamports:String(await solana('getMinimumBalanceForRentExemption',[165])),
    feePayerSigner:signer(payer),mintSigner:signer(mintKey),recipientTokenAccountSigner:signer(tokenKey)});
  await finalized(await solana('sendTransaction',[setup.preparedTransactionBase64,{encoding:'base64',preflightCommitment:'finalized',skipPreflight:false}]));
  const pd=(seed,program)=>findProgramAddress([Buffer.from(seed),ed25519.getPublicKey(mintKey)],base58Decode(program)).base58;
  const program=id=>({id,loader:UPGRADEABLE_LOADER,programData:findProgramAddress([base58Decode(id)],base58Decode(UPGRADEABLE_LOADER)).base58,upgradeAuthority:address(upgrade),deploymentSlot:'0'});
  const source=sourceIdentity(repoRoot);
  const manifest={protocol:DEPLOYMENT_MONITOR_PROTOCOL,environment:'localnet',sourceSha:source.sourceSha,identityVersion:1,
    nativeGenesisHex:REGTEST_GENESIS,solanaGenesis:genesis,solanaDeploymentHex:deployment,minimumSlot:'0',maximumStallMs:60000,manager:program(MANAGER),transceiver:program(TRANSCEIVER),
    mint:{id:address(mintKey),tokenProgram:TOKEN,authority:pd('kingpepe-mint-authority',MANAGER),decimals:8},
    config:{bridgePda:pd('kingpepe-bridge-state',MANAGER),transceiverPda:pd('kingpepe-transceiver-config',TRANSCEIVER),policyEpoch:1,keyEpoch:1,protocolId:1,nativeNetwork:8000111,
      attesters:[address(attesterA),address(attesterB)],depositsPaused:false,transceiverActive:true}};
  const artifact=file=>{const bytes=readFileSync(path.join(artifactRoot,file));return {sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length};};
  const policy={context,manifest,feePayerHex:pub(payer),artifacts:{manager:artifact('kingpepe_bridge.so'),transceiver:artifact('kingpepe_transceiver.so')}};
  report.sourceSha=manifest.sourceSha;report.artifacts=policy.artifacts;
  report.exactSource=source.exactSource;
  const adapter=new BurnSolanaAdapter({policy,endpoint:solanaEndpoint});assert.equal((await adapter.deployment()).mintSupplyAtomic,'0');pass('EXACT_ARTIFACTS_ZERO_SUPPLY');
  const binding={...context.deployment,destination:pub(recipient),nonce:rand()},depositAddress=burnDepositDestination(binding),operational=burnOperationalDestination(binding);
  let state=initialBurnJournal(binding,{context,feePayerHex:pub(payer)});state.paused=false;state.pauseReason='TEST_REVIEWED';
  const id=depositAddress.operationId;issueBurnDeposit(state,binding,0);
  const password=rand();await native('createwallet',{wallet_name:'user',passphrase:password,load_on_startup:true});await native('walletpassphrase',[password,3600],'user');
  const mining=await native('getnewaddress',['burn-chain-regression','bech32m'],'user'),mine=n=>native('generatetoaddress',[n,mining]);await mine(21);
  const depositTxid=await native('sendtoaddress',[depositAddress.address,'0.00100000'],'user'),feeTxid=await native('sendtoaddress',[operational.address,'0.01000000'],'user');await mine(1);
  const rpc=new NativeRpcClient({endpoint:nativeEndpoint,authCookieFile:path.join(nodeRoot,'regtest','.cookie'),repoRoot});
  const verifier=new RegtestNativeBurnVerifier({rpc,executable:nativeVerifier}),fees=new NativeBurnFeePolicy({rpc,policy:nativeBurnSourceFeePolicy()});
  const coin=async(txid,scriptPubKeyHex)=>{const tx=parseNativeTransactionHex(await rpc.getRawTransaction(txid,false)),vout=tx.outputs.findIndex(o=>o.scriptPubKeyHex===scriptPubKeyHex);assert(vout>=0);return {txid,vout,amountAtomic:tx.outputs[vout].amountAtomic,scriptPubKeyHex};};
  const deposit=await coin(depositTxid,depositAddress.scriptPubKeyHex),feeCoin=await coin(feeTxid,operational.scriptPubKeyHex);
  const {plan}=await fees.selectPlan({operationId:id,deposit,operationalScriptHex:operational.scriptPubKeyHex,feeCoins:[feeCoin]});
  await assert.rejects(verifier.verifyDepositAdmission({binding,plan}));assert.equal((await adapter.deployment()).mintSupplyAtomic,'0');pass('DEPOSIT_OBSERVATION_CANNOT_AUTHORIZE_BURN_OR_MINT');
  await mine(11);const admission=await verifier.verifyDepositAdmission({binding,plan});requireBurnDepositAdmission(admission,binding,plan);
  const futureAccounts=burnSolanaAddresses(binding,plan);
  for(const signature of await fundEmptyTestAccounts({rpc:solana,payer,addresses:Object.values(futureAccounts)}))await finalized(signature);
  await adapter.preBurn(binding,plan,'0');
  pass('PREFUNDED_EMPTY_OPERATION_ACCOUNTS_ARE_NOT_CLAIMS');
  const ataBlock=await adapter.latestBlockhash(),ata=associatedTokenCreationMessage({binding,feePayerHex:pub(payer),...ataBlock});
  const ataSig=ed25519.sign(ata.message,payer);await finalized(await solana('sendTransaction',[Buffer.concat([Buffer.of(1),Buffer.from(ataSig),ata.message]).toString('base64'),{encoding:'base64',preflightCommitment:'finalized',skipPreflight:false}]));
  // Admission is refreshed after ATA finality before the irreversible TEST burn.
  requireBurnDepositAdmission(await verifier.verifyDepositAdmission({binding,plan}),binding,plan);
  await fees.verifyBeforeBroadcast(plan);const signed=signNativeBurnWithKey({rootSecret:rootKey,binding,plan});
  await assert.rejects(rpc.call('sendrawtransaction',[signed,'0.10000000','0.00099999']),/sendrawtransaction:-25/);pass('MAXBURNAMOUNT_ONE_UNIT_OVERAGE_REJECTED');
  assert.equal((await rpc.call('sendrawtransaction',[signed,'0.10000000',plan.maxburnamount])).result,plan.txid);
  await assert.rejects(verifier.verifyFinalizedBurn({binding,plan}));assert.equal((await adapter.deployment()).mintSupplyAtomic,'0');pass('BROADCAST_IS_NOT_MINT_AUTHORIZATION');
  const burnBlock=(await mine(1))[0];await mine(10);await assert.rejects(verifier.verifyFinalizedBurn({binding,plan}));
  await native('invalidateblock',[burnBlock]);await assert.rejects(verifier.verifyFinalizedBurn({binding,plan}));pass('ELEVEN_CONFIRMATIONS_AND_ORPHANED_BURN_REJECTED');
  await native('reconsiderblock',[burnBlock]);await mine(1);
  const final=await verifier.verifyFinalizedBurn({binding,plan});requireFinalizedNativeBurn(final,binding,plan);
  assert.equal(final.burnConfirmations,12);assert.equal(final.evidence.amountAtomic,deposit.amountAtomic);
  assert.equal((await rpc.getUtxoObservation({txid:plan.txid,vout:0,includeMempool:true})).unspent,false);
  await assert.rejects(verifier.verifyDepositAdmission({binding,plan}));pass('FINALIZED_EXACT_BURN_UNSPENDABLE_NO_SECOND_BURN');
  recordBurnDeposits(state,id,[{...final.evidence.deposit,amountAtomic:deposit.amountAtomic,blockHash:final.evidence.depositBlockHash,height:final.evidence.depositHeight,confirmations:24}]);
  retainBurnPlan(state,id,plan);retainSignedBurn(state,id,signed);markBurnBroadcast(state,id,true);retainFinalBurn(state,id,final.evidence);
  state=validateBurnJournalState(JSON.parse(JSON.stringify(state)));
  assert.equal(reconcileBurnAccounting(state,{finalizedNativeBurnAtomic:deposit.amountAtomic,bridgeIssuedAtomic:'0',mintSupplyAtomic:'0'}).pendingFinalizedBurnAtomic,deposit.amountAtomic);
  pass('FINALIZED_BURN_RELOAD_RETAINS_PENDING_MINT_OBLIGATION');
  const now=await adapter.clock(),encoded=encodeBurnMessage({evidence:final.evidence,policyEpoch:1,keyEpoch:1,validFrom:String(now-60n),validUntil:String(now+3600n)}),message=decodeCanonicalBridgeMessage(encoded);
  const attestation={encodedMessageHex:hex(encoded),attestations:[attesterA,attesterB].map((seed,i)=>({protocol:ATTESTATION_PROTOCOL,mode:ATTESTATION_MODE,role:['ATTESTER_A','ATTESTER_B'][i],keyEpoch:1,policyEpoch:1,
    attesterPublicKeyHex:pub(seed),messageDigestHex:message.messageDigestHex,operationIdHex:id,signedBytes:BURN_SIGNED_BYTES,signatureHex:hex(ed25519.sign(encoded,seed)),state:'VERIFIED_READY'}))};
  verifyBurnAttestationPair(attestation.attestations,attestation.encodedMessageHex,context.attesters);
  const receiptAddress=burnSolanaAddresses(binding,plan,attestation).receipt;
  for(const signature of await fundEmptyTestAccounts({rpc:solana,payer,addresses:[receiptAddress]}))await finalized(signature);
  const prefunded=await adapter.observe(binding,plan,attestation);
  assert.equal(prefunded.receiptExists,false);assert.equal(prefunded.claimExists,false);
  prepareBurnAuthorization(state,id,attestation.encodedMessageHex);retainBurnAttestation(state,id,attestation);
  async function packet(kind){const block=await adapter.latestBlockhash(),options={...burnSolanaPlanOptions({context,binding,feePayerHex:pub(payer),...attestation,...block}),feePayerSigner:signer(payer)};
    const signedPacket=await(kind==='CLAIM'?prepareSignedLocalnetSolanaDepositClaimTransaction:prepareSignedLocalnetSolanaDepositReceiptTransaction)(options);
    const p={kind,...block,messageDigestHex:message.messageDigestHex,preparedTransactionBase64:signedPacket.preparedTransactionBase64,signature:signedPacket.signatures[0].signatureBase58};
    verifyBurnSolanaPacket(p,context,binding,pub(payer),attestation);return p;}
  const receipt=await packet('RECEIPT');await finalized(await adapter.send(receipt,binding,attestation));
  pass('PREFUNDED_EMPTY_RECEIPT_INITIALIZES_AFTER_FINALIZED_BURN');
  assert.equal((await adapter.deployment()).mintSupplyAtomic,'0');pass('ATTESTATION_RECEIPT_ALONE_DOES_NOT_MINT');
  const claim=await packet('CLAIM');await finalized(await adapter.send(claim,binding,attestation));
  const claimExecution=await solana('getTransaction',[claim.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  writeFileSync(path.join(root,'prefunded-claim-execution.json'),JSON.stringify(claimExecution,null,2)+'\n');
  assert.equal(claimExecution.meta.innerInstructions[0].instructions.length,10);
  // Deliberately ignore submission result as a service would after a lost reply.
  const reopened=new BurnSolanaAdapter({policy,endpoint:solanaEndpoint}),observed=await reopened.observe(binding,plan,attestation);
  const mint=await reopened.mintReceipt(state.operations[0],claim,observed);retainBurnMint(state,id,mint);completeBurnOperation(state,id);
  assert.equal(observed.managerMintedAtomic,deposit.amountAtomic);assert.equal(observed.mintSupplyAtomic,deposit.amountAtomic);
  assert.equal(observed.destinationBalanceAtomic,deposit.amountAtomic);pass('FINALIZED_EXACT_MINT_TO_ORIGINAL_WALLET');
  const replay=await packet('CLAIM');await assert.rejects(adapter.send(replay,binding,attestation));
  assert.equal((await adapter.deployment()).mintSupplyAtomic,deposit.amountAtomic);pass('CLAIM_REPLAY_REJECTED_NO_SECOND_MINT');
  const mismatch=structuredClone(state);assert.throws(()=>reconcileBurnAccounting(mismatch,{finalizedNativeBurnAtomic:'0',bridgeIssuedAtomic:deposit.amountAtomic,mintSupplyAtomic:deposit.amountAtomic}));assert(mismatch.paused);pass('CRITICAL_ACCOUNTING_MISMATCH_PAUSES');
  const accounting=reconcileBurnAccounting(state,{finalizedNativeBurnAtomic:final.evidence.amountAtomic,bridgeIssuedAtomic:observed.managerMintedAtomic,mintSupplyAtomic:observed.mintSupplyAtomic});
  assert.equal(accounting.state,'MATCH');assert.equal(accounting.pendingFinalizedBurnAtomic,'0');
  const raw=parseNativeTransactionHex(signed);assert.equal(raw.outputs[0].amountAtomic,deposit.amountAtomic);
  assert.equal(BigInt(feeCoin.amountAtomic)-BigInt(raw.outputs[1].amountAtomic),BigInt(plan.feeAtomic));
  report.operation={operationId:id,depositTxid,burnTxid:plan.txid,burnVout:0,burnScriptHex:plan.burnScriptHex,depositAtomic:deposit.amountAtomic,burnAtomic:final.evidence.amountAtomic,
    mintAtomic:mint.amountAtomic,minerFeeAtomic:plan.feeAtomic,changeAtomic:plan.changeAtomic,virtualBytes:plan.virtualBytes,solanaSignature:claim.signature,canonicalMessageHex:hex(encoded)};
  report.accounting=accounting;report.state='COMPLETED';pass('EXACT_DEPOSIT_BURN_MINT_SEPARATE_FEES_RECONCILIATION');
}catch(error){report.state='FAIL';report.failure=error.message;save();throw error;}
finally{
  keys.forEach(k=>k.fill(0));rootKey.fill(0);
  if(nativeReady)try{await native('stop');}catch{/* Owned process fallback below; no unrelated PID. */}
  if(existsSync(path.join(ledger,'admin.rpc')))try{
    await new Promise((resolve,reject)=>{const socket=createConnection({path:path.join(ledger,'admin.rpc')});
      socket.setTimeout(5000,()=>socket.destroy(new Error('OwnedValidatorShutdownTimeout')));
      socket.on('error',reject);socket.on('connect',()=>socket.write('{"jsonrpc":"2.0","id":1,"method":"exit","params":[]}\n'));
      socket.once('data',()=>{socket.end();resolve();});});
  }catch{report.validatorShutdown='REQUIRES_OWNED_PROCESS_INSPECTION';save();}
  for(const child of children)if(child.exitCode===null)child.kill('SIGINT');
  for(const child of children)if(child.exitCode===null)await Promise.race([once(child,'exit'),delay(10000).then(()=>{if(child.exitCode===null)child.kill('SIGTERM');})]);
  logs.forEach(closeSync);
}
