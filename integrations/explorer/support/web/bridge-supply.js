// Public, read-only display of completed reconciled issuance. No mint authority.
import { OFFICIAL_KPEPE_MINT, MAINNET_BASELINE_SOURCE } from './bridge-mainnet.js';
export const MAX_SUPPLY_ATOMIC = 2100000000000000n;
export const ACCOUNTING_DISPLAY_LIMIT_MS = 120000;
const uint = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) throw new Error('SUPPLY_UNAVAILABLE');
  return BigInt(value);
};
export function validateSupply(value, expected, now = Date.now()) {
  if (!value || value.state === 'UNAVAILABLE') return { state: 'UNAVAILABLE' };
  const pairs = [['REGTEST', 'DEVNET', 'solana:devnet'], ['MAINNET', 'MAINNET', 'solana:mainnet']];
  const baseline = value.source === MAINNET_BASELINE_SOURCE && expected.state === 'PENDING' &&
    expected.kingpepeNetwork === 'MAINNET' && expected.mint === OFFICIAL_KPEPE_MINT &&
    value.bridgedSupplyAtomic === '0' && value.liveMintSupplyAtomic === '0';
  if (!pairs.some(p => p.join() === [expected.kingpepeNetwork, expected.solanaNetwork, expected.walletChain].join()) ||
      value.state !== 'READY' || (!baseline && value.source !== 'CANONICAL_COMPLETED_FINALIZED_NATIVE_BURN_MINT_ACCOUNTING') || value.decimals !== 8 ||
      value.nativeNetwork !== expected.kingpepeNetwork || value.solanaNetwork !== expected.solanaNetwork || value.mint !== expected.mint ||
      value.environment !== (expected.kingpepeNetwork === 'REGTEST' ? 'devnet' : 'mainnet') ||
      !Number.isSafeInteger(value.observedAt) || value.observedAt > now + 5000 || now - value.observedAt > 30000)
    throw new Error('SUPPLY_UNAVAILABLE');
  const max = uint(value.maxSupplyAtomic), bridged = uint(value.bridgedSupplyAtomic), remaining = uint(value.remainingSupplyAtomic), live = uint(value.liveMintSupplyAtomic);
  if (max !== MAX_SUPPLY_ATOMIC || bridged > max || live > max || remaining !== max - bridged) throw new Error('SUPPLY_ACCOUNTING_ERROR');
  // Rebuild an allowlisted response. Unknown internal fields never reach users.
  return { state: 'READY', source: value.source, ...Object.fromEntries(['nativeNetwork', 'solanaNetwork', 'environment', 'mint'].map(k => [k, value[k]])),
    decimals: 8, maxSupplyAtomic: max.toString(), bridgedSupplyAtomic: bridged.toString(), remainingSupplyAtomic: remaining.toString(),
    liveMintSupplyAtomic: live.toString(), observedAt: value.observedAt };
}
export function supplyDisplay(supply) {
  const amount = raw => { const n = uint(raw), whole = (n / 100000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
    const fraction = (n % 100000000n).toString().padStart(8, '0').replace(/0+$/u, ''); return whole + (fraction ? '.' + fraction : ''); };
  const bridged = uint(supply.bridgedSupplyAtomic), max = uint(supply.maxSupplyAtomic), remaining = uint(supply.remainingSupplyAtomic);
  if (max !== MAX_SUPPLY_ATOMIC || bridged > max || remaining !== max - bridged) throw new Error('SUPPLY_ACCOUNTING_ERROR');
  const basisPoints = bridged * 10000n / max;
  const percentage = bridged > 0n && basisPoints === 0n ? '<0.01%' : (basisPoints / 100n).toString() + '.' + (basisPoints % 100n).toString().padStart(2, '0') + '%';
  return { bridged: amount(supply.bridgedSupplyAtomic), remaining: amount(supply.remainingSupplyAtomic), percentage, basisPoints: basisPoints.toString() };
}

// Display-only memory. Nothing here grants transfer admission or changes the
// runtime's 30-second economic gate. Display age includes network transit time.
export function createAccountingDisplay({ now = Date.now } = {}) {
  let snapshot = null, identity = null, verifying = false, issued = 0, applied = 0;
  let newestVerifiedAt = -1, invalidatedThrough = -1;
  const clear = () => { invalidatedThrough = Math.max(invalidatedThrough, newestVerifiedAt); snapshot = null; verifying = false; };
  const accept = request => {
    if (!Number.isSafeInteger(request) || request <= applied || request > issued) return false;
    applied = request; return true;
  };
  function displaySupply(value, expected) {
    const age = now() - value?.observedAt;
    if (!Number.isSafeInteger(value?.observedAt) || age < -5000 || age > ACCOUNTING_DISPLAY_LIMIT_MS)
      throw new Error('SUPPLY_UNAVAILABLE');
    // A response can cross 30 seconds in transit. Its original verification is
    // still usable only as a bounded, visibly stale display, never as admission.
    return validateSupply(value, expected, value.observedAt);
  }
  function retain(value) {
    if (value.observedAt <= invalidatedThrough || value.observedAt < newestVerifiedAt) return false;
    if (snapshot && value.observedAt === snapshot.observedAt && JSON.stringify(value) !== JSON.stringify(snapshot)) {
      clear(); throw new Error('SUPPLY_ACCOUNTING_CHANGED');
    }
    newestVerifiedAt = value.observedAt; snapshot = Object.freeze(value);
    return true;
  }
  function current() {
    if (!snapshot) return { state: 'UNAVAILABLE' };
    const age = now() - snapshot.observedAt;
    if (age < -5000 || age > ACCOUNTING_DISPLAY_LIMIT_MS) { clear(); return { state: 'UNAVAILABLE' }; }
    return { state: verifying || age > 30000 ? 'STALE' : 'READY', supply: snapshot };
  }
  return Object.freeze({
    begin: () => ++issued,
    current,
    receive(request, status, expected) {
      if (!accept(request)) return current();
      try {
        const key = JSON.stringify([expected.kingpepeNetwork, expected.solanaNetwork, expected.walletChain, expected.mint]);
        if (identity !== null && identity !== key) { clear(); throw new Error('SUPPLY_IDENTITY_CHANGED'); }
        identity = key;
        const failed = [status, status?.supply].some(v => v &&
          (v.reconciliation != null && v.reconciliation !== 'MATCH' ||
           v.burnMintConservation != null && v.burnMintConservation !== 'PASS'));
        if (failed || status?.accountingRefreshState === 'UNAVAILABLE') { clear(); return current(); }
        if (status?.accountingRefreshState === 'VERIFYING' && status.state === 'PAUSED' && status.supply?.state === 'UNAVAILABLE') {
          if (status.lastVerifiedSupply !== undefined) {
            // Explicitly stale gateway memory, never a fresh accounting source.
            // Validate the unchanged schema at its original verification time;
            // the separate bound above never permits extending that timestamp.
            const value = displaySupply(status.lastVerifiedSupply, expected);
            if (value.state !== 'READY') throw new Error('SUPPLY_UNAVAILABLE');
            retain(value);
          }
          verifying = true; return current();
        }
        if (status?.accountingRefreshState !== 'VERIFIED' || status.state !== 'ACTIVE') { clear(); return current(); }
        const value = displaySupply(status.supply, expected);
        if (value.state !== 'READY') { clear(); return current(); }
        if (!retain(value)) return current();
        verifying = false;
        return current();
      } catch (error) { clear(); throw error; }
    },
    failure(request, transient = false) {
      if (!accept(request)) return current();
      if (transient) verifying = true; else clear();
      return current();
    },
  });
}
