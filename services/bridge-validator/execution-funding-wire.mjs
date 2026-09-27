// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Exact, public SOL payment/refund messages. No authority changes or token instructions.
import {createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519.js';
import {base58Decode,base58Encode,shortvecEncode} from './solana-deposit-claim-transaction-plan.mjs';
import {requireBurn as check} from '../../native/burn/burn-protocol.mjs';
export const EXECUTION_MEMO_PROGRAM='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SYSTEM='11111111111111111111111111111111',ED='Ed25519SigVerify111111111111111111111111111';
const bytes=s=>Buffer.from(base58Decode(s)),sv=n=>Buffer.from(shortvecEncode(n));
export function executionDigest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function executionLamports(value){check(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/u.test(value)&&BigInt(value)<=0xffffffffffffffffn,'ExecutionLamportsRejected');return BigInt(value);}
export function executionPublicKey(value){const b=bytes(value);check(b.length===32&&base58Encode(b)===value,'ExecutionPublicKeyRejected');return b;}
export function executionTransferMessage({source,destination,lamports,blockhash,memo}){
 const from=executionPublicKey(source),to=executionPublicKey(destination),block=executionPublicKey(blockhash);
 check(source!==destination&&executionLamports(lamports)>0n&&typeof memo==='string'&&/^[A-Z0-9_:a-f-]{1,240}$/u.test(memo),'ExecutionTransferRejected');
 const keys=[from,to,bytes(SYSTEM),bytes(EXECUTION_MEMO_PROGRAM)],data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(BigInt(lamports),4);
 const text=Buffer.from(memo);
 return Buffer.concat([Buffer.from([1,0,2]),sv(keys.length),...keys,block,sv(2),Buffer.from([2,2,0,1]),sv(data.length),data,Buffer.from([3,1,0]),sv(text.length),text]);
}
export function executionPaymentMemo(id,quoteId){return `KPEPE_SOL_EXECUTION_V1:${id}:${quoteId}`;}
export function executionRefundMemo(id,sequence){return `KPEPE_SOL_REFUND_V1:${id}:${sequence}`;}
export function executionUnsignedTransaction(message){return Buffer.concat([Buffer.of(1),Buffer.alloc(64),message]).toString('base64');}
export function executionPaymentMessage(quote){return executionTransferMessage({source:quote.destination,destination:quote.recipient,lamports:quote.amountLamports,blockhash:quote.recentBlockhash,memo:executionPaymentMemo(quote.operationId,quote.quoteId)});}
export function verifyExecutionSignedMessage(packet,message,signer){
 check(typeof packet==='string'&&packet.length<=1800,'ExecutionPacketRejected');
 const raw=Buffer.from(packet,'base64');check(raw.toString('base64')===packet&&raw.length<=1232&&raw[0]===1&&raw.subarray(65).equals(message),'ExecutionMessageChanged');
 check(ed25519.verify(raw.subarray(1,65),message,executionPublicKey(signer),{zip215:false}),'ExecutionSignatureRejected');
 return base58Encode(raw.subarray(1,65));
}
export function verifyExecutionPayment({quote,signature,transaction}){
 check(transaction&&transaction.meta?.err===null&&Number.isSafeInteger(transaction.slot)&&transaction.slot>=quote.createdSlot&&Array.isArray(transaction.transaction),'ExecutionPaymentNotFinalized');
 const expected=verifyExecutionSignedMessage(transaction.transaction[0],executionPaymentMessage(quote),quote.destination);
 check(expected===signature&&Number.isSafeInteger(transaction.meta.fee)&&transaction.meta.fee>=0,'ExecutionPaymentSignatureChanged');
 // The caller obtains this transaction only at finalized commitment on the bound genesis.
 return {signature,quoteId:quote.quoteId,operationId:quote.operationId,amountLamports:quote.amountLamports,paymentFeeLamports:String(transaction.meta.fee),slot:transaction.slot};
}
export function executionFeeMessages({payer,recipient,blockhash}){
 const transfer=executionTransferMessage({source:payer,destination:recipient,lamports:'1',blockhash,memo:'KPEPE_EXECUTION_FEE_ESTIMATE'});
 // Fee-only template: one payer signature and two Ed25519 precompile verifications.
 // It is never signed, simulated as execution evidence, or submitted.
 const receipt=Buffer.concat([Buffer.from([1,0,1,2]),executionPublicKey(payer),bytes(ED),executionPublicKey(blockhash),Buffer.from([2,1,0,1,1,1,0,1,1])]);
 return {single:transfer,receipt};
}
