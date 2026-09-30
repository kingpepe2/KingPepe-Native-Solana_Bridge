// Public display policy; never used for Bridge admission or transaction decisions.
export const NATIVE_NETWORK = Object.freeze({
  name: 'KingPepe Mainnet', ticker: 'KPEPE',
  genesis: '00000a00a75c7ed12c71b9a8b73c01576009d62a0a606c0a1ef37b043c520fb2',
  freshnessMs: 90_000, recentBlockMs: 600_000,
});

export function nativeActivity(snapshot, now = Date.now()) {
  const unknown = {state:'UNAVAILABLE', label:'Network data unavailable', height:null, blockTime:null,
    message:'Mining is the native network’s consensus mechanism. Current block activity could not be verified.'};
  const node = snapshot?.node;
  if (snapshot?.network !== NATIVE_NETWORK.name || snapshot?.ticker !== NATIVE_NETWORK.ticker ||
      node?.reachable !== true || !Number.isSafeInteger(snapshot.timestamp) ||
      !Number.isSafeInteger(node.height) || node.height < 0 || !Number.isSafeInteger(node.lastBlockTime) ||
      node.lastBlockTime <= 0 || snapshot.timestamp * 1000 > now + 15_000 || node.lastBlockTime * 1000 > now + 15_000) return unknown;
  const height = node.height, blockTime = node.lastBlockTime * 1000;
  if (now - snapshot.timestamp * 1000 > NATIVE_NETWORK.freshnessMs) return {...unknown, state:'STALE',
    label:'Network observation stale', height, blockTime, message:'The last observation is out of date. Current mining activity is not confirmed.'};
  if (node.synced !== true) return {...unknown, state:'SYNCING', label:'Observer synchronizing', height, blockTime,
    message:'The public node is synchronizing. Recent network activity is not confirmed by this observation.'};
  if (now - blockTime > NATIVE_NETWORK.recentBlockMs) return {...unknown, state:'WAITING', label:'Awaiting a recent block', height, blockTime,
    message:'No block within the recent-activity window. This does not establish that mining has stopped.'};
  return {state:'RECENT_BLOCKS', label:'Recent mining activity observed', height, blockTime,
    message:'Mining continues on the native KingPepe network. The synchronized public node has observed a recent block.'};
}

// ---- Story display models. Every value shown comes from a public read; nothing is fixed here
// except the protocol's decimals. A value that fails its check is shown as unavailable.

export const ATOMIC = 100_000_000n, MAX_SUPPLY_ATOMIC = 2_100_000_000_000_000n;
const atomicString = value => typeof value === 'string' && /^(0|[1-9]\d{0,17})$/u.test(value) && BigInt(value) <= MAX_SUPPLY_ATOMIC;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function formatCount(value) { return value === null ? '—' : Math.round(value).toLocaleString('en-US'); }
export function formatKpepe(atomic, digits = 0) {
  if (atomic === null) return '—';
  return (Number(atomic) / 1e8).toLocaleString('en-US', {maximumFractionDigits: digits});
}
export function formatHashrate(hps) {
  if (hps === null) return '—';
  const units = ['H/s','kH/s','MH/s','GH/s','TH/s','PH/s','EH/s']; let i = 0, v = hps;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return v.toLocaleString('en-US', {maximumFractionDigits: v >= 100 ? 0 : 2}) + ' ' + units[i];
}
export function formatDifficulty(value) {
  if (value === null) return '—';
  return value >= 1e6 ? value.toLocaleString('en-US', {maximumFractionDigits: 0}) : value.toLocaleString('en-US', {maximumFractionDigits: 1});
}

// GET /api/v1/network: chain parameters of the native node.
export function networkStats(network) {
  const none = {height:null, difficulty:null, hashrate:null, bestHash:null, blockInterval:null};
  if (network?.chain !== 'main' || network?.network !== NATIVE_NETWORK.name || network?.ticker !== NATIVE_NETWORK.ticker) return none;
  return {
    height: Number.isSafeInteger(network.blocks) && network.blocks >= 0 ? network.blocks : null,
    difficulty: finite(network.difficulty) && network.difficulty > 0 ? network.difficulty : null,
    hashrate: finite(network.hashrate) ? network.hashrate : null,
    bestHash: typeof network.bestBlockHash === 'string' && /^[0-9a-f]{64}$/u.test(network.bestBlockHash) ? network.bestBlockHash : null,
    blockInterval: Number.isSafeInteger(network.blockIntervalSeconds) && network.blockIntervalSeconds > 0 ? network.blockIntervalSeconds : null,
  };
}

// GET /api/v1/supply: the native UTXO set total. Burned coins have already left it.
export function nativeSupply(supply) {
  if (supply?.ticker !== NATIVE_NETWORK.ticker || supply?.decimals !== 8) return {circulatingAtomic:null, height:null};
  const sats = supply.circulatingSats;
  return {
    circulatingAtomic: Number.isSafeInteger(sats) && sats >= 0 && BigInt(sats) <= MAX_SUPPLY_ATOMIC ? BigInt(sats) : null,
    height: Number.isSafeInteger(supply.height) && supply.height >= 0 ? supply.height : null,
  };
}

// GET /api/v1/bridge/status: the runtime's published policy and verified accounting. The
// accounting is shown only while it is fresh; the page never keeps a stale number.
export const ACCOUNTING_DISPLAY_LIMIT_MS = 120_000;
export function bridgePolicy(status, mint, now = Date.now()) {
  const none = {minimumAtomic:null, feeAtomic:null, depositConfirmations:null, burnConfirmations:null, singleFlight:null, busy:null,
    bridgedAtomic:null, maxAtomic:null, accountingVerified:false};
  if (status?.architecture !== 'ONE_WAY_AUTOMATIC_BURN_AND_MINT' || status?.mint !== mint || status?.decimals !== 8) return none;
  const count = value => Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : null;
  const result = {...none,
    minimumAtomic: atomicString(status.minimumDepositAtomic) && BigInt(status.minimumDepositAtomic) > 0n ? BigInt(status.minimumDepositAtomic) : null,
    feeAtomic: atomicString(status.bridgeFeeAtomic) ? BigInt(status.bridgeFeeAtomic) : null,
    depositConfirmations: count(status.nativeDepositConfirmations), burnConfirmations: count(status.nativeBurnConfirmations),
    singleFlight: status.maxConcurrentExecutingOperations === 1 ? true : Number.isSafeInteger(status.maxConcurrentExecutingOperations) ? false : null,
    busy: status.executionSlot === 'BRIDGE_BUSY' ? true : status.executionSlot === 'AVAILABLE' ? false : null,
  };
  const supply = status.supply, observed = supply?.observedAt;
  if (supply?.state === 'READY' && status.accountingRefreshState === 'VERIFIED' && supply.mint === mint && supply.decimals === 8 &&
      Number.isSafeInteger(observed) && observed <= now + 5_000 && now - observed <= ACCOUNTING_DISPLAY_LIMIT_MS &&
      atomicString(supply.bridgedSupplyAtomic) && atomicString(supply.maxSupplyAtomic) && atomicString(supply.remainingSupplyAtomic) &&
      BigInt(supply.bridgedSupplyAtomic) + BigInt(supply.remainingSupplyAtomic) === BigInt(supply.maxSupplyAtomic) && BigInt(supply.maxSupplyAtomic) === MAX_SUPPLY_ATOMIC) {
    result.bridgedAtomic = BigInt(supply.bridgedSupplyAtomic); result.maxAtomic = BigInt(supply.maxSupplyAtomic); result.accountingVerified = true;
  }
  return result;
}

// One economic supply: native coins still unspent plus the Solana coins that crossed after an
// equal native burn. The burn amount equals the bridged amount and is never added a second time.
export function supplyPicture(native, bridge) {
  const max = MAX_SUPPLY_ATOMIC, nativeAtomic = native?.circulatingAtomic ?? null, bridgedAtomic = bridge?.bridgedAtomic ?? null;
  const total = nativeAtomic !== null && bridgedAtomic !== null ? nativeAtomic + bridgedAtomic : null;
  const share = value => value === null ? null : Math.min(100, Number(value * 10_000n / max) / 100);
  return {maxAtomic: max, nativeAtomic, bridgedAtomic, burnedForBridgeAtomic: bridgedAtomic, totalAtomic: total !== null && total <= max ? total : null,
    nativeShare: share(nativeAtomic), bridgedShare: share(bridgedAtomic), conserved: total === null ? null : total <= max};
}
