// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { base58 } from '../web/bridge-vendor/base.js';

// The frozen SDK's reads support Mainnet, but its operation request helper is
// TEST-only. Keep those reads and use the same narrow user API with the exact
// server-selected chain. This does not grant admission: the gateway and private
// runtime both recheck activation, and only the runtime persists/issues addresses.
export function createGatewayBridgeClient({ createReadClient, network, endpoint, accessToken, fetchImpl = fetch }) {
  const reader = createReadClient({ endpoint, accessToken, fetchImpl });
  const fundingPost=async(id,action,input)=>{
    if(!/^[0-9a-f]{64}$/u.test(id)||!['execution-quote','execution-payment'].includes(action)||
      (action==='execution-quote'?Object.keys(input).length!==0:Object.keys(input).join()!=='signature'||typeof input.signature!=='string'||base58.decode(input.signature).length!==64))throw Error('BridgeOperationFieldsRejected');
    try{const response=await fetchImpl(new URL(`/operations/${id}/${action}`,endpoint),{method:'POST',redirect:'error',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(8000)});
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw Error('ResponseTooLarge');chunks.push(chunk);}if(!response.ok)throw Error('RequestNotAccepted');
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
    }catch{throw Error('BridgeRequestFailedCheckStatusBeforeRetry');}
  };
  if (!['solana:devnet', 'solana:mainnet'].includes(network?.walletChain)) throw Error('BridgeConfigurationRejected');
  return Object.freeze({ ...reader,refreshExecutionQuote:(id,input)=>fundingPost(id,'execution-quote',input),verifyExecutionPayment:(id,input)=>fundingPost(id,'execution-payment',input), createOperation: async input => {
    if (!input || Object.keys(input).sort().join() !== 'clientNonce,destination,walletChain' ||
        input.walletChain !== network.walletChain || typeof input.clientNonce !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(input.clientNonce) || /^0+$/u.test(input.clientNonce) ||
        typeof input.destination !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(input.destination))
      throw Error('BridgeOperationFieldsRejected');
    const key = base58.decode(input.destination);
    if (key.length !== 32 || base58.encode(key) !== input.destination) throw Error('BridgeOperationFieldsRejected');
    try {
      const response = await fetchImpl(new URL('/operations', endpoint), { method: 'POST', redirect: 'error',
        headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 65536) throw Error('ResponseTooLarge'); chunks.push(chunk);
      }
      if (!response.ok) throw Error('RequestNotAccepted');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { throw Error('BridgeRequestFailedCheckStatusBeforeRetry'); }
  } });
}
