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
