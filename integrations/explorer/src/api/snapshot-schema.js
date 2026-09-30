// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { marketOperation } from './market-schema.js';

const nativeObject = description => ({ type: 'object', nullable: true, additionalProperties: true, description });
export const snapshotOperation = {
  summary: 'Combined Native blockchain and official Solana KPEPE market snapshot',
  description: 'Existing Native fields retain their names, types and meanings. The additive market object ' +
    'contains the same observation and decimal-string/null fields as GET /api/v1/market, including state, ' +
    'stale, updatedAt and checkedAt. Both endpoints share the same market cache and refresh. ' +
    'A market-provider outage returns a stale or unavailable market object while preserving Native data. ' +
    'Native statistics and market observations have independent observation times. ' +
    'The dedicated /api/v1/market endpoint remains available and documented separately.',
  parameters: [], security: [],
  responses: { 200: { description: 'Current Native snapshot with a shared market observation.', content: {
    'application/json': { schema: {
      type: 'object', additionalProperties: true,
      required: ['tip', 'prev', 'mempool', 'network', 'history', 'serverTime', 'clients', 'market'],
      properties: {
        tip: nativeObject('Current Native block information; null while unavailable.'),
        prev: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Recent previous Native blocks.' },
        mempool: nativeObject('Existing Native mempool statistics.'),
        network: nativeObject('Existing Native network statistics, including height, difficulty and hashrate.'),
        history: { type: 'object', additionalProperties: true, description: 'Existing recent Native history series.' },
        serverTime: { type: 'integer', description: 'Existing server timestamp in Unix seconds.' },
        clients: { type: 'integer', description: 'Existing live-client count.' },
        market: marketOperation.responses[200].content['application/json'].schema,
      },
    } },
  } } },
};
