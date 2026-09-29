// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { OFFICIAL_KPEPE_MINT } from '../../web/bridge-mainnet.js';

const amount = description => ({ type: 'string', nullable: true, pattern: '^\\d+(\\.\\d+)?$', description });
const timestamp = description => ({ type: 'string', format: 'date-time', nullable: true, description });
const properties = {
  coin: { type: 'string', enum: ['KingPepe'] },
  symbol: { type: 'string', enum: ['KPEPE'] },
  network: { type: 'string', enum: ['solana'] },
  mint: { type: 'string', enum: [OFFICIAL_KPEPE_MINT] },
  tradingActive: { type: 'boolean', description: 'A qualifying liquid market was found at updatedAt. Check state and stale before using prices; false with UNAVAILABLE does not prove trading has stopped.' },
  priceReliable: { type: 'boolean', description: 'True only in state ACTIVE: the selected pool holds at least USD 1,000 of depth. False for LOW_LIQUIDITY_MARKET, where the price is real and current but a trade of a few dollars can move it; treat it as indicative.' },
  priceUsd: amount('USD per KPEPE in the selected pair.'),
  priceSol: amount('SOL per KPEPE when the selected pair is against wrapped SOL; otherwise null.'),
  priceChange24hPct: { type: 'string', nullable: true, pattern: '^-?\\d+(\\.\\d+)?$', description: '24-hour USD price change percentage for KPEPE, when supplied for that token. Null for an inverse pair.' },
  volume24hUsd: amount('24-hour USD volume of the selected pair, not an aggregate. "0" is known zero volume; null means unavailable.'),
  totalVolume24hUsd: amount('24-hour USD volume summed over every verified pool of the official Mint against SOL or USDC, each pool once. Pools listed in pools.'),
  pools: { type: 'array', maxItems: 50, description: 'The verified official pools whose volume is summed, largest first.', items: { type: 'object', additionalProperties: false,
    required: ['dex', 'pairAddress', 'volume24hUsd', 'liquidityUsd'], properties: { dex: { type: 'string' }, pairAddress: { type: 'string' }, volume24hUsd: amount('24-hour USD volume of this pool.'), liquidityUsd: amount('Provider USD liquidity of this pool.') } } },
  liquidityUsd: amount('USD liquidity of the selected pair as the provider reports it, not an aggregate.'),
  quoteLiquidityUsd: amount('USD value of the SOL or USDC side of the selected pair. Selection and reliability use at most twice this amount, so that KPEPE valued at its own price is never counted as depth.'),
  marketCapUsd: amount('priceUsd multiplied by circulatingSupply. With priceReliable false this is an indicative figure: the price it uses can be moved by a small trade. Provider market-cap estimates are not used.'),
  circulatingSupply: amount('KPEPE in existence: unspent on KingPepe Native plus outstanding on Solana. KPEPE burned on Native for the Bridge is not in the Native unspent set, so nothing is counted twice. Includes Team and pool inventory.'),
  circulatingSupplyBasis: { type: 'string', enum: ['NATIVE_UNSPENT_PLUS_SOLANA_MINT_SUPPLY'] },
  supply: { type: 'object', nullable: true, additionalProperties: false, required: ['nativeKpepe', 'solanaKpepe', 'nativeHeight'], properties: {
    nativeKpepe: amount('Unspent KPEPE on KingPepe Native.'), solanaKpepe: amount('Finalized supply of the official Solana Mint.'), nativeHeight: { type: 'integer', nullable: true } } },
  history7d: { type: 'object', additionalProperties: false, required: ['source', 'pairAddress', 'coverage', 'from', 'to', 'points'], description: 'Hourly closing prices of the selected pool inside the last seven days, as recorded by the indexer. Hours without a trade have no point; nothing is interpolated. Not included in snapshot.market.', properties: {
    source: { type: 'string', enum: ['GECKOTERMINAL_POOL_OHLCV_1H'] }, pairAddress: { type: 'string', nullable: true }, coverage: { type: 'string', enum: ['FULL', 'PARTIAL', 'NONE'], description: 'FULL: the pool existed for the whole seven days. PARTIAL: the pool is younger; the period since it began. NONE: no observation is available.' },
    from: timestamp('Time of the first point.'), to: timestamp('Time of the last point.'), points: { type: 'array', maxItems: 168, items: { type: 'object', additionalProperties: false, required: ['t', 'priceUsd', 'volumeUsd'],
      properties: { t: { type: 'integer', description: 'Start of the hour, milliseconds.' }, priceUsd: amount('Closing price of the hour.'), volumeUsd: amount('Volume of the hour.') } } } } },
  fdvUsd: amount('Null unless priceReliable. Selected USD price multiplied by the existing maximum KingPepe supply of 21,000,000 KPEPE. This is a valuation estimate, not circulating market cap or an additional Solana supply allowance.'),
  dex: { type: 'string', nullable: true, description: 'Selected pair DEX identifier.' },
  selection: { type: 'string', nullable: true, enum: ['PRIMARY_RAYDIUM_POOL', 'FALLBACK_POOL', null], description: 'PRIMARY_RAYDIUM_POOL: the official Raydium pool J3QJDVzWrrPZmSABXicoftFewFFinZuuAhC9vqBRrXbi. FALLBACK_POOL: that pool gave no valid current price, and the deepest other verified pool of the official Mint is shown instead.' },
  pairAddress: { type: 'string', nullable: true, description: 'Selected Solana pool address.' },
  lastTradeAt: timestamp('Null: the selected provider does not supply the last-trade timestamp. Pool creation time is not a trade time.'),
  source: { type: 'string', enum: ['DEX_SCREENER'] },
  scope: { type: 'string', enum: ['selected_pair'] },
  state: { type: 'string', enum: ['ACTIVE', 'LOW_LIQUIDITY_MARKET', 'NO_MARKET', 'STALE', 'UNAVAILABLE'], description: 'ACTIVE: a selected official pool with at least USD 1,000 of depth. LOW_LIQUIDITY_MARKET: a selected official pool with at least USD 10 and less than USD 1,000; its price is published with priceReliable false. NO_MARKET means no qualifying market was returned, not a zero price. STALE preserves a previous observation for at most five minutes. UNAVAILABLE clears all market values.' },
  stale: { type: 'boolean', description: 'True for stale or unavailable observations.' },
  updatedAt: timestamp('Time of the last successful provider observation; not the last trade time. Null before any successful observation.'),
  checkedAt: timestamp('Time of the latest refresh attempt, including failed attempts.'),
};

export const marketOperation = {
  summary: 'Official Solana KPEPE market data',
  description: 'Read-only and unauthenticated. Fixed official Mint ' + OFFICIAL_KPEPE_MINT +
    '. No query parameters are accepted. All market numbers are decimal strings or null. ' +
    'Uses the official Raydium pool; another qualifying pair of the official Mint against wrapped SOL or USDC only if that pool gives no valid current price. Prices are never blended. ' +
    'A pool of the official Mint with at least USD 10 of depth is reported; below USD 1,000 it is reported as LOW_LIQUIDITY_MARKET with priceReliable false. Before a qualifying market exists, ' +
    'tradingActive is false and all market values are null. Refreshes at most once per 30 seconds on demand. ' +
    'Provider failures return a clearly stale observation for at most five minutes, then unavailable values. ' +
    'Prices are informational provider observations, not executable quotes or guaranteed valuations. ' +
    'Solana KPEPE represents Native KPEPE burned through the one-way 1:1 Bridge; the 21M maximum is not doubled.',
  parameters: [], security: [],
  responses: {
    200: { description: 'Market observation, no market, or isolated upstream unavailability.', content: {
      'application/json': { schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
        example: { coin: 'KingPepe', symbol: 'KPEPE', network: 'solana', mint: OFFICIAL_KPEPE_MINT,
          tradingActive: false, priceReliable: false, priceUsd: null, priceSol: null, priceChange24hPct: null, volume24hUsd: null,
          selection: null, totalVolume24hUsd: null, pools: [], liquidityUsd: null, quoteLiquidityUsd: null, marketCapUsd: null, circulatingSupply: null,
          circulatingSupplyBasis: 'NATIVE_UNSPENT_PLUS_SOLANA_MINT_SUPPLY', supply: null,
          history7d: { source: 'GECKOTERMINAL_POOL_OHLCV_1H', pairAddress: null, coverage: 'NONE', from: null, to: null, points: [] }, fdvUsd: null, dex: null, pairAddress: null, lastTradeAt: null,
          source: 'DEX_SCREENER', scope: 'selected_pair', state: 'NO_MARKET', stale: false,
          updatedAt: '2026-09-25T00:00:00.000Z', checkedAt: '2026-09-25T00:00:00.000Z' } },
    } },
    400: { description: 'Query parameters are not accepted.' },
    405: { description: 'Read-only endpoint: only GET and OPTIONS are supported.' },
    429: { description: 'Public API rate limit reached.' },
  },
};
