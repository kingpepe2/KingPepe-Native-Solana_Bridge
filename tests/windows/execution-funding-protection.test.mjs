// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real DPAPI and signers with synthetic keys and a mocked read/broadcast transport.
// No Mainnet endpoint or production protected store is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {ed25519} from '@noble/curves/ed25519.js';
import {base58} from '@scure/base';
import {WindowsProtectedStore,windowsCurrentServiceSid} from '../../shared/windows/protected-store.mjs';
import {ProtectedBurnJournal} from '../../services/bridge-validator/protected-burn-journal.mjs';
import {ProtectedBurnSolanaSigner} from '../../services/relayer/burn-solana-signer.mjs';
import {BurnSolanaAdapter} from '../../services/solana-observer/burn-solana-adapter.mjs';
import {ExecutionFundingController} from '../../services/bridge-validator/execution-funding-controller.mjs';
import {createExecutionIntent,executionRecord,publicExecutionFunding,executionTotals} from '../../services/bridge-validator/execution-funding-state.mjs';
import {executionPaymentMessage} from '../../services/bridge-validator/execution-funding-wire.mjs';
import {burnOperationId} from '../../native/burn/burn-protocol.mjs';
import {burnFixture} from '../../native/burn/tests/burn-fixture.mjs';
if(process.platform!=='win32')throw Error('WINDOWS_EXECUTION_PROTECTION_REQUIRES_WINDOWS');
test('protected payment recovery, exact refund signer and restart preserve liabilities without plaintext keys',async t=>{
 const f=burnFixture(),root=mkdtempSync(path.join(os.tmpdir(),'kingpepe-execution-protection-')),repoRoot=path.resolve(import.meta.dirname,'../..'),sid=windowsCurrentServiceSid();let journal,signer;
 const options=(name,role,purpose)=>({root:path.join(root,name),repoRoot,context:{role,purpose,serviceSid:sid,environment:f.context.environment,nativeGenesis:f.binding.nativeGenesis,solanaDeployment:f.binding.solanaDeployment,instanceId:randomBytes(32).toString('hex'),keyEpoch:1}});
 const jopt=options('journal','BRIDGE_VALIDATOR','burn-operations'),sopt=options('payer','FEE_PAYER','fee-payer-seed');
 t.after(async()=>{signer?.close();await journal?.close();f.destroy();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('kingpepe-execution-protection-'));rmSync(root,{recursive:true});});
 journal=await ProtectedBurnJournal.open(WindowsProtectedStore.create(jopt,Buffer.from(JSON.stringify(f.state))));
 signer=new ProtectedBurnSolanaSigner({store:WindowsProtectedStore.create(sopt,Buffer.from(f.payer)),context:f.context,feePayerHex:f.policy.feePayerHex});signer.bindExecutionJournal(journal);
 let balance=1000000000,height=100,slot=1000;const transactions=new Map(),history=[],sent=[];
 const rpcResult=(method,params)=>{
  if(method==='getGenesisHash')return f.manifest.solanaGenesis;
  if(method==='getMultipleAccounts')return {context:{slot},value:[{owner:'11111111111111111111111111111111',executable:false,data:['','base64'],lamports:balance},null]};
  if(method==='getBalance')return {context:{slot},value:balance};
  if(method==='getMinimumBalanceForRentExemption')return 1000000+params[0]*5000;
  if(method==='getLatestBlockhash')return {context:{slot},value:{blockhash:base58.encode(new Uint8Array(32).fill(22)),lastValidBlockHeight:300}};
  if(method==='getBlockHeight')return height;
  if(method==='getFeeForMessage')return {context:{slot},value:Buffer.from(params[0],'base64').length<200?15000:5000};
  if(method==='getSignaturesForAddress')return history.slice(0,params[1].limit);
  if(method==='getTransaction')return transactions.get(params[0])??null;
  if(method==='getSignatureStatuses'){const tx=transactions.get(params[0][0]);return {context:{slot},value:[tx?{slot:tx.slot,confirmationStatus:'finalized',err:tx.meta.err}:null]};}
  if(method==='sendTransaction'){const raw=Buffer.from(params[0],'base64');assert.equal(params[1].skipPreflight,false);sent.push(params[0]);return base58.encode(raw.subarray(1,65));}
  throw Error('UNEXPECTED_TEST_RPC_METHOD');
 };
 t.mock.method(globalThis,'fetch',async(_url,request)=>{const r=JSON.parse(request.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result:rpcResult(r.method,r.params)}));});
 const solana=new BurnSolanaAdapter({policy:f.policy,endpoint:'http://127.0.0.1:54111/'});let controller=new ExecutionFundingController({journal,solana,signer});
 await controller.activate();assert.equal(journal.read().execution.legacyIds[0],f.id);
 const binding={...f.binding,nonce:'ab'.repeat(32)},id=burnOperationId(binding);
 journal.update(s=>createExecutionIntent(s,binding,Date.now(),20));await controller.quote(id);const quote=publicExecutionFunding(journal.read(),id).quote;
 await controller.synchronize();await controller.issueFundedAddresses();assert.equal(journal.read().operations.length,1);
 const message=executionPaymentMessage(quote),sig=ed25519.sign(message,f.wallet),signature=base58.encode(sig);
 const tx={slot:++slot,meta:{err:null,fee:5000},transaction:[Buffer.concat([Buffer.of(1),Buffer.from(sig),message]).toString('base64'),'base64']};
 transactions.set(signature,tx);history.unshift({slot,signature});balance+=Number(quote.amountLamports);
 // Lost browser callback: only the finalized chain history supplies the credit.
 await controller.synchronize();await controller.issueFundedAddresses();assert.equal(journal.read().operations.length,2);assert.equal(executionRecord(journal.read(),id).payments.length,1);
 await controller.payment(id,signature);assert.equal(executionRecord(journal.read(),id).payments.length,1);
 assert.throws(()=>signer.prepareExecutionRefund({operationId:id,sequence:0,amountLamports:'1',feeLamports:'5000',recentBlockhash:quote.recentBlockhash,lastValidBlockHeight:'300'}),/NotAuthorized/);
 journal.update(s=>{const r=executionRecord(s,id);r.createdAt=1;r.fundedAt=2;});
 await controller.refunds({nativeClear:false});assert.equal(sent.length,0);
 await controller.refunds({nativeClear:true});assert.equal(sent.length,1);const pending=executionRecord(journal.read(),id).refunds[0];
 assert.equal(pending.destination,quote.destination);assert.equal(pending.source,quote.recipient);assert.equal(pending.outcome,'UNRESOLVED');
 signer.close();signer=null;await journal.close();journal=null;
 const files=d=>readdirSync(d).flatMap(n=>{const p=path.join(d,n);return statSync(p).isDirectory()?files(p):[p];});
 for(const file of files(root)){const data=readFileSync(file);assert(!data.includes(Buffer.from(f.payer)));assert(!data.includes(Buffer.from(f.payer).toString('hex')));}
 journal=await ProtectedBurnJournal.open(new WindowsProtectedStore(jopt));signer=new ProtectedBurnSolanaSigner({store:new WindowsProtectedStore(sopt),context:f.context,feePayerHex:f.policy.feePayerHex});signer.bindExecutionJournal(journal);
 controller=new ExecutionFundingController({journal,solana,signer});await controller.synchronize();await controller.refunds({nativeClear:true});assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
 const refundTx={slot:++slot,meta:{err:null,fee:5000},transaction:[pending.preparedTransactionBase64,'base64']};transactions.set(pending.signature,refundTx);history.unshift({slot,signature:pending.signature});balance-=Number(pending.amountLamports)+5000;
 await controller.synchronize();await controller.refunds({nativeClear:true});assert.equal(sent.length,2);assert.equal(executionTotals(executionRecord(journal.read(),id)).liability,0n);
 assert.equal(journal.read().paused,false);assert.equal(journal.read().operations[1].binding.destination,binding.destination);
 // Returning below the reserve prevents every new irreversible admission.
 balance=1;await assert.rejects(controller.quote(id),/QuoteNotAllowed/);assert.equal(sent.length,2);
});
