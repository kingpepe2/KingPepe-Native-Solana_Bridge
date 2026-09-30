// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { base58 } from '../web/bridge-vendor/base.js';

// The frozen SDK's reads support Mainnet, but its operation request helper is
// TEST-only. Keep those reads and use the same narrow user API with the exact
// server-selected chain. This does not grant admission: the gateway and private
// runtime both recheck activation, and only the runtime persists/issues addresses.
// The runtime creates an operation between two of its accounting cycles, which
// takes up to about 20 seconds. Only this one request waits that long; it stays
// bounded, and every read keeps its own shorter limit.
export const CREATE_OPERATION_TIMEOUT_MS = 30000, READ_TIMEOUT_MS = 8000;
export const upstreamTimeoutMs = init => init?.method === 'POST' ? CREATE_OPERATION_TIMEOUT_MS : READ_TIMEOUT_MS;
export function createGatewayBridgeClient({ createReadClient, network, endpoint, accessToken, fetchImpl = fetch }) {
  const reader = createReadClient({ endpoint, accessToken, fetchImpl });
  if (!['solana:devnet', 'solana:mainnet'].includes(network?.walletChain)) throw Error('BridgeConfigurationRejected');
  return Object.freeze({ ...reader, createOperation: async input => {
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
        body: JSON.stringify(input), signal: AbortSignal.timeout(CREATE_OPERATION_TIMEOUT_MS) });
      let size = 0; const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length; if (size > 65536) throw Error('ResponseTooLarge'); chunks.push(chunk);
      }
      if (!response.ok) throw Error('RequestNotAccepted');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { throw Error('BridgeRequestFailedCheckStatusBeforeRetry'); }
  } });
}
