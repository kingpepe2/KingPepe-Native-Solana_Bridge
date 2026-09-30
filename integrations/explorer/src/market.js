// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Informational market data only. No wallet, chain RPC or signing dependencies.
import { OFFICIAL_KPEPE_MINT } from '../web/bridge-mainnet.js';
import { base58 } from '../web/bridge-vendor/base.js';

export const MARKET_TTL_MS = 30_000;
export const MARKET_STALE_MS = 300_000;
const SOURCE = 'DEX_SCREENER';
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const QUOTES = new Set([SOL, USDC]);
const URL = 'https://api.dexscreener.com/token-pairs/v1/solana/' + OFFICIAL_KPEPE_MINT;
// Hourly candles of the selected pool, as the indexer recorded them. Hours without a trade have no candle.
const HISTORY_SOURCE = 'GECKOTERMINAL_POOL_OHLCV_1H';
const historyUrl = pair => 'https://api.geckoterminal.com/api/v2/networks/solana/pools/' + pair + '/ohlcv/hour?aggregate=1&limit=168&currency=usd&token=base';
export const HISTORY_WINDOW_MS = 604_800_000, HISTORY_TTL_MS = 600_000, SUPPLY_RETAIN_MS = 900_000;
export const SUPPLY_BASIS = 'NATIVE_UNSPENT_PLUS_SOLANA_MINT_SUPPLY';
const ATOMIC = 100_000_000n, MAX_SUPPLY_ATOMIC = 21_000_000n * ATOMIC;
const SCALE = 10n ** 24n;
const MAX_DECIMAL = 10n ** 48n;
// Discovery: the smallest official pool that is reported at all. Reliability:
// the depth from which its price is published as reliable. Below that the
// price is shown, and labelled as an indicative low-liquidity price.
export const MIN_LIQUIDITY_USD = 10n, RELIABLE_LIQUIDITY_USD = 1000n;
const MIN_LIQUIDITY = MIN_LIQUIDITY_USD * SCALE, RELIABLE_LIQUIDITY = RELIABLE_LIQUIDITY_USD * SCALE;
const FIELDS = ['priceUsd', 'priceSol', 'priceChange24hPct', 'volume24hUsd', 'totalVolume24hUsd', 'liquidityUsd', 'quoteLiquidityUsd',
  'marketCapUsd', 'circulatingSupply', 'supply', 'fdvUsd', 'dex', 'pairAddress', 'lastTradeAt'];
// Published amounts keep six decimal places; arithmetic keeps all of them.
const CENT = SCALE / 1_000_000n, rounded = n => n === null ? null : n - n % CENT;

// Bounded decimal arithmetic; never route market arithmetic through binary floats.
function decimal(value, signed = false) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const m = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!m || (!signed && m[1])) return null;
  const exponent = Number(m[4] || 0), fraction = m[3] || '';
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 48 || fraction.length > 48) return null;
  let n = BigInt(m[2] + fraction), shift = 24 + exponent - fraction.length;
  if (shift >= 0) n *= 10n ** BigInt(shift);
  else { const divisor = 10n ** BigInt(-shift); if (n % divisor) return null; n /= divisor; }
  if (n > MAX_DECIMAL) return null;
  return m[1] ? -n : n;
}
function format(n) {
  if (n === null) return null;
  const sign = n < 0n ? '-' : '', value = n < 0n ? -n : n;
  const fraction = (value % SCALE).toString().padStart(24, '0').replace(/0+$/, '');
  return sign + value / SCALE + (fraction ? '.' + fraction : '');
}
const positive = n => n !== null && n > 0n;
const ratio = (a, b) => positive(a) && positive(b) ? a * SCALE / b : null;
function publicKey(value) {
  try { return typeof value === 'string' && value.length <= 44 && base58.decode(value).length === 32 && base58.encode(base58.decode(value)) === value; }
  catch { return false; }
}
function empty(state, updatedAt = null) {
  return { coin: 'KingPepe', symbol: 'KPEPE', network: 'solana', mint: OFFICIAL_KPEPE_MINT,
    tradingActive: false, priceReliable: false, selection: null, ...Object.fromEntries(FIELDS.map(k => [k, null])),
    circulatingSupplyBasis: SUPPLY_BASIS, pools: [], history7d: noHistory(null),
    source: SOURCE, scope: 'selected_pair', state, stale: state === 'UNAVAILABLE', updatedAt, checkedAt: null };
}
// The price source: this exact Raydium pool (Raydium CPMM, official Mint against wrapped SOL).
// Every check below applies to it as to any other pool.
export const PRIMARY_POOL = 'J3QJDVzWrrPZmSABXicoftFewFFinZuuAhC9vqBRrXbi', PRIMARY_DEX = 'raydium';
const noHistory = pair => ({ source: HISTORY_SOURCE, pairAddress: pair, coverage: 'NONE', from: null, to: null, points: [] });
// A pool of the exact official Mint against SOL or USDC, whatever it is called.
function official(pair) {
  if (!pair || pair.chainId !== 'solana' || !publicKey(pair.pairAddress) ||
      typeof pair.dexId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(pair.dexId)) return null;
  const direct = pair.baseToken?.address === OFFICIAL_KPEPE_MINT && QUOTES.has(pair.quoteToken?.address);
  const inverse = pair.quoteToken?.address === OFFICIAL_KPEPE_MINT && QUOTES.has(pair.baseToken?.address);
  return direct || inverse ? { direct, inverse } : null;
}
function candidate(pair) {
  const side = official(pair); if (!side) return null;
  const { direct, inverse } = side;
  const liquidity = decimal(pair.liquidity?.usd), base = decimal(pair.liquidity?.base), quote = decimal(pair.liquidity?.quote);
  if (![liquidity, base, quote].every(positive)) return null;
  const usd = decimal(pair.priceUsd), native = decimal(pair.priceNative);
  const price = direct ? usd : ratio(usd, native);
  if (!positive(price) || price > MAX_DECIMAL) return null;
  // Depth is what stands on the SOL or USDC side. KPEPE valued at its own pool
  // price is not depth: a pool holding only KPEPE has none, whatever its
  // reported total. A pool counts for at most twice its quote side.
  const counter = direct ? (positive(native) ? quote * usd / native : null) : base * usd / SCALE;
  if (!positive(counter) || counter > MAX_DECIMAL) return null;
  const depth = counter * 2n < liquidity ? counter * 2n : liquidity;
  if (depth < MIN_LIQUIDITY) return null;
  const reliable = depth >= RELIABLE_LIQUIDITY;
  const sol = direct && pair.quoteToken.address === SOL ? native : inverse && pair.baseToken.address === SOL ? ratio(SCALE, native) : null;
  const volume = decimal(pair.volume?.h24), change = direct ? decimal(pair.priceChange?.h24, true) : null;
  const buys = decimal(pair.txns?.h24?.buys), sells = decimal(pair.txns?.h24?.sells);
  const activity = buys !== null && sells !== null ? buys + sells : 0n;
  const created = decimal(pair.pairCreatedAt);
  return { liquidity: depth, volume, activity, address: pair.pairAddress, dex: pair.dexId, price,
    createdAt: positive(created) && created % SCALE === 0n ? Number(created / SCALE) : null,
    data: { state: reliable ? 'ACTIVE' : 'LOW_LIQUIDITY_MARKET', tradingActive: true, priceReliable: reliable,
      priceUsd: format(price), priceSol: positive(sol) ? format(sol) : null,
      priceChange24hPct: change !== null && change >= -100n * SCALE ? format(change) : null,
      volume24hUsd: format(volume), liquidityUsd: format(liquidity), quoteLiquidityUsd: format(rounded(counter)), marketCapUsd: null,
      // A valuation of 21,000,000 KPEPE at a price a few dollars can move is not published.
      fdvUsd: reliable ? format(price * 21_000_000n) : null, dex: pair.dexId, pairAddress: pair.pairAddress, lastTradeAt: null } };
}
function select(pairs) {
  if (!Array.isArray(pairs) || pairs.length > 1000) throw new Error('Invalid market response');
  // Ambiguous duplicate pool records are ineligible, regardless of input order.
  const counts = new Map();
  for (const p of pairs) if (p?.pairAddress) counts.set(p.pairAddress, (counts.get(p.pairAddress) || 0) + 1);
  const unique = pairs.filter(p => counts.get(p?.pairAddress) === 1);
  const eligible = unique.map(candidate).filter(Boolean);
  // 24-hour volume of every verified official pool, each pool once. A pool that
  // appears twice in the answer is ambiguous and is counted not at all.
  const pools = unique.filter(official).map(p => ({ dex: p.dexId, pairAddress: p.pairAddress, volume: decimal(p.volume?.h24), liquidity: decimal(p.liquidity?.usd) }))
    .filter(p => p.volume !== null).sort((a, b) => a.volume === b.volume ? (a.pairAddress < b.pairAddress ? -1 : 1) : a.volume > b.volume ? -1 : 1).slice(0, 50);
  const total = pools.reduce((sum, p) => sum + p.volume, 0n);
  const desc = (a, b) => a === b ? 0 : a > b ? -1 : 1;
  eligible.sort((a, b) => desc(a.liquidity, b.liquidity) || desc(a.volume ?? -1n, b.volume ?? -1n) ||
    desc(a.activity, b.activity) || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  // The official Raydium pool is the source whenever it gives a valid current
  // price. Another verified pool is used only when it does not, and says so.
  const primary = eligible.find(p => p.address === PRIMARY_POOL && p.dex === PRIMARY_DEX);
  const best = primary ?? eligible[0];
  if (!best) return null;
  return { data: { ...best.data, selection: primary ? 'PRIMARY_RAYDIUM_POOL' : 'FALLBACK_POOL', totalVolume24hUsd: pools.length && total <= MAX_DECIMAL ? format(total) : null,
    pools: pools.map(p => ({ dex: p.dex, pairAddress: p.pairAddress, volume24hUsd: format(p.volume), liquidityUsd: positive(p.liquidity) ? format(p.liquidity) : null })) },
    price: best.price, createdAt: best.createdAt };
}
// Genuine observations only: the candles the indexer holds for this exact pool
// inside the last seven days, closing prices, nothing filled in between.
function history(body, pair, createdAt, time) {
  const meta = body?.meta, list = body?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length > 1000 || meta?.base?.address !== OFFICIAL_KPEPE_MINT || !QUOTES.has(meta?.quote?.address)) throw new Error('Invalid history');
  const points = new Map();
  for (const row of list) {
    if (!Array.isArray(row) || row.length !== 6) throw new Error('Invalid history');
    const at = decimal(row[0]), close = decimal(row[4]), volume = decimal(row[5]);
    if (!positive(at) || at % SCALE !== 0n || !positive(close) || close > MAX_DECIMAL || volume === null) throw new Error('Invalid history');
    const t = Number(at / SCALE) * 1000;
    if (!Number.isSafeInteger(t) || t > time + 300_000) throw new Error('Invalid history');
    if (t >= time - HISTORY_WINDOW_MS) points.set(t, { t, priceUsd: format(rounded(close)), volumeUsd: format(rounded(volume)) });
  }
  const sorted = [...points.values()].sort((a, b) => a.t - b.t);
  if (!sorted.length) return noHistory(pair);
  // Full only for a pool that already existed seven days ago. Otherwise the period since it began.
  return { source: HISTORY_SOURCE, pairAddress: pair, coverage: createdAt !== null && createdAt <= time - HISTORY_WINDOW_MS ? 'FULL' : 'PARTIAL',
    from: new Date(sorted[0].t).toISOString(), to: new Date(sorted.at(-1).t).toISOString(), points: sorted };
}
const kpepe = atomic => (atomic / ATOMIC) + '.' + (atomic % ATOMIC).toString().padStart(8, '0');
// Native KPEPE that is burned for the Bridge leaves the Native unspent set, and
// the same amount is minted on Solana. What exists is therefore what is unspent
// on Native plus what is outstanding on Solana. Nothing is counted twice, and
// the sum can never exceed the 21,000,000 maximum.
function economicSupply(value) {
  const amount = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(v) ? BigInt(v) : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
  const native = amount(value?.nativeAtomic), solana = amount(value?.solanaAtomic);
  if (native === null || solana === null || native + solana === 0n || native + solana > MAX_SUPPLY_ATOMIC) return null;
  return { atomic: native + solana, supply: { nativeKpepe: kpepe(native), solanaKpepe: kpepe(solana), nativeHeight: Number.isSafeInteger(value.nativeHeight) ? value.nativeHeight : null } };
}
async function readPairs(response) {
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '') ||
      Number(response.headers.get('content-length')) > 1_048_576) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Market unavailable');
  }
  if (!response.body) throw new Error('Empty market response');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.length; if (bytes > 1_048_576) throw new Error('Market response too large');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'), (key, value, context) => {
    if (typeof value === 'number') {
      if (!context?.source) throw new Error('Exact numeric decoding unavailable');
      return context.source;
    }
    return value;
  });
}

let supplyReader = async () => null;
// Set once by the API: the Native unspent total and the finalized Solana Mint supply.
export function configureMarketSupply(reader) { if (typeof reader !== 'function') throw new Error('Supply reader required'); supplyReader = reader; }
export function createMarketService({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000, readSupply = () => supplyReader() } = {}) {
  let lastGood = null, goodAt = null, checkedAt = null, retryAt = 0, inFlight = null, failed = false;
  let past = null, pastAt = 0, known = null, knownAt = 0;
  const bounded = (work, ms) => { let timer; return Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), ms); })]).finally(() => clearTimeout(timer)); };
  async function readHistory(pair, createdAt) {
    if (past?.pairAddress === pair && now() - pastAt < HISTORY_TTL_MS && now() >= pastAt) return past;
    try {
      const controller = new AbortController();
      const value = await bounded((async () => history(await readPairs(await fetchImpl(historyUrl(pair), { method: 'GET', redirect: 'error',
        signal: controller.signal, headers: { accept: 'application/json' } })), pair, createdAt, now()))(), timeoutMs).catch(error => { controller.abort(); throw error; });
      past = value; pastAt = now(); return value;
    } catch {
      // An earlier genuine answer for this pool is kept for an hour; otherwise there is no history to show.
      return past?.pairAddress === pair && now() - pastAt < 3_600_000 && now() >= pastAt ? past : noHistory(pair);
    }
  }
  async function readEconomicSupply() {
    try { const value = economicSupply(await bounded(Promise.resolve().then(readSupply), 10_000)); if (value) { known = value; knownAt = now(); } } catch { /* the last known supply is kept below */ }
    return known && now() - knownAt <= SUPPLY_RETAIN_MS && now() >= knownAt ? known : null;
  }
  async function refresh() {
    const controller = new AbortController(); let timer;
    try {
      const work = (async () => {
        const response = await fetchImpl(URL, { method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { accept: 'application/json' } });
        return select(await readPairs(response));
      })();
      const selected = await Promise.race([work, new Promise((resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Market timeout')); }, timeoutMs);
      })]);
      clearTimeout(timer);
      let data = null;
      if (selected) {
        const [held, past7d] = await Promise.all([readEconomicSupply(), readHistory(selected.data.pairAddress, selected.createdAt)]);
        const cap = held ? selected.price * held.atomic / ATOMIC : null;
        data = { ...selected.data, history7d: past7d, circulatingSupply: held ? kpepe(held.atomic) : null, supply: held?.supply ?? null,
          marketCapUsd: cap !== null && cap <= MAX_DECIMAL ? format(cap - cap % (SCALE / 100n)) : null };
      }
      goodAt = now(); const stamp = new Date(goodAt).toISOString();
      lastGood = { ...empty(data ? data.state : 'NO_MARKET', stamp), ...(data || {}) };
      failed = false;
    } catch { failed = true; }
    finally { clearTimeout(timer); checkedAt = now(); retryAt = checkedAt + MARKET_TTL_MS; }
  }
  return {
    async getMarket() {
      if (now() >= retryAt || checkedAt === null) {
        inFlight ??= refresh().finally(() => { inFlight = null; });
        await inFlight;
      }
      const time = now(), age = goodAt === null ? Infinity : time - goodAt;
      let value;
      if (lastGood && age >= 0 && age < MARKET_TTL_MS && !failed) value = { ...lastGood };
      else if (lastGood && age >= 0 && age <= MARKET_STALE_MS) value = { ...lastGood, state: lastGood.state === 'NO_MARKET' ? 'NO_MARKET' : 'STALE', stale: true, priceReliable: false };
      else value = empty('UNAVAILABLE', lastGood?.updatedAt ?? null);
      value.checkedAt = checkedAt === null ? null : new Date(checkedAt).toISOString();
      return { value, ttlSec: value.stale ? 0 : Math.max(0, Math.min(5, Math.floor((MARKET_TTL_MS - age) / 1000))) };
    },
  };
}

const market = createMarketService();
export function marketResponse(query = {}) {
  if (Object.keys(query).length) { const error = new Error('Market endpoint does not accept query parameters'); error.kind = 'input'; throw error; }
  return market.getMarket();
}
