// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Public payment bytes only. Wallet Standard owns all signing material.
export const EXECUTION_RECIPIENT='47EPgcpqc11Bo3ghi22LrTA2AERFLnuXccnZhTqoEkFb';
export const EXECUTION_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const check=v=>{if(!v)throw Error('EXECUTION_PAYMENT_REJECTED');};
const amount=v=>{check(typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/u.test(v)&&BigInt(v)<=0xffffffffffffffffn);return BigInt(v);};
const concat=(...rows)=>Uint8Array.from(rows.flatMap(r=>[...r]));
const sv=n=>n<128?Uint8Array.of(n):Uint8Array.of((n&127)|128,n>>7);
export async function validateExecutionQuote(q,{base58,operationId,destination,recipient=EXECUTION_RECIPIENT,genesis=EXECUTION_GENESIS}){
 check(q&&q.version===1&&q.operationId===operationId&&/^[a-f0-9]{64}$/u.test(operationId)&&q.destination===destination&&q.recipient===recipient&&q.genesis===genesis);
 check(Object.keys(q).sort().join()==='amountLamports,budget,createdAt,createdSlot,destination,genesis,lastValidBlockHeight,operationId,quoteId,recentBlockhash,recipient,unsignedTransactionBase64,version');
 const {quoteId,unsignedTransactionBase64,...original}=q;
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(original))))].map(b=>b.toString(16).padStart(2,'0')).join('');check(digest===quoteId);
 const key=s=>{const b=base58.decode(s);check(b.length===32&&base58.encode(b)===s);return b;};
 const n=amount(q.amountLamports);check(n>0n&&q.destination!==q.recipient);amount(q.lastValidBlockHeight);
 check(Number.isSafeInteger(q.createdAt)&&Number.isSafeInteger(q.createdSlot));
 const b=q.budget;for(const k of ['accountRentLamports','networkFeeLamports','priorityFeeLamports','retryAllowanceLamports','refundAllowanceLamports','depositLamports','paymentFeeLamports','walletDebitLamports'])amount(b[k]);
 check(BigInt(b.depositLamports)===BigInt(b.accountRentLamports)+BigInt(b.networkFeeLamports)+BigInt(b.priorityFeeLamports)+BigInt(b.retryAllowanceLamports)+BigInt(b.refundAllowanceLamports)&&n<=BigInt(b.depositLamports));
 const data=new Uint8Array(12),dv=new DataView(data.buffer);dv.setUint32(0,2,true);dv.setBigUint64(4,n,true);
 const memo=new TextEncoder().encode(`KPEPE_SOL_EXECUTION_V1:${operationId}:${quoteId}`);
 const message=concat([1,0,2,4],key(destination),key(recipient),key('11111111111111111111111111111111'),key('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),key(q.recentBlockhash),[2,2,2,0,1,12],data,[3,1,0],sv(memo.length),memo);
 const expected=concat([1],new Uint8Array(64),message),actual=Uint8Array.from(atob(unsignedTransactionBase64),c=>c.charCodeAt(0));
 check(actual.length===expected.length&&actual.every((v,i)=>v===expected[i]));return actual;
}
export async function signExecutionPayment({wallet,account,operation,base58}){
 check(account?.address===operation.destination&&account.chains?.includes('solana:mainnet')&&wallet?.chains?.includes('solana:mainnet'));
 const feature=wallet.features?.['solana:signAndSendTransaction'];check(typeof feature?.signAndSendTransaction==='function');
 const transaction=await validateExecutionQuote(operation.executionFunding?.quote,{base58,operationId:operation.operationId,destination:account.address});
 const results=await feature.signAndSendTransaction({account,chain:'solana:mainnet',transaction,options:{preflightCommitment:'finalized',skipPreflight:false,maxRetries:0}});
 check(Array.isArray(results)&&results.length===1&&results[0].signature instanceof Uint8Array&&results[0].signature.length===64);
 return base58.encode(results[0].signature);
}
