// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// KingPepe consensus/emission provenance: docs/security/monetary-supply.md.
export const KPEPE_DECIMALS = 8;
export const MAX_KPEPE_SUPPLY_ATOMIC = 21_000_000n * 100_000_000n;
const U128 = (1n << 128n) - 1n;
export function supplyInteger(value) {
  if (!['string', 'bigint'].includes(typeof value) || !/^(0|[1-9][0-9]{0,38})$/u.test(String(value)) || BigInt(value) > U128)
    throw new Error('SupplyIntegerRejected');
  return BigInt(value);
}
// Accounting arithmetic only. The caller must independently verify Native
// backing and the exact deployment; browser values are never authority.
export function checkedRepresentedMint(current, requested, eligibleBacking) {
  const before = supplyInteger(current), amount = supplyInteger(requested), backing = supplyInteger(eligibleBacking);
  const next = before + amount;
  if (next > U128) throw new Error('SupplyArithmeticOverflow');
  if (amount === 0n) throw new Error('SupplyMintAmountRejected');
  if (next > MAX_KPEPE_SUPPLY_ATOMIC) throw new Error('SupplyMonetaryCapExceeded');
  if (next > backing) throw new Error('SupplyEligibleBackingExceeded');
  return next;
}

// Completed cumulative issuance, not pending requests or circulating token
// supply. Ordinary holder burns do not undo a completed Native deposit.
export function completedSupplyCounter({ environment, mint, completedAtomic, reconciliation, observedAt }, now = Date.now()) {
  const networks = { devnet: ['REGTEST', 'DEVNET', 'solana:devnet'], mainnet: ['MAINNET', 'MAINNET', 'solana:mainnet'] };
  if (!Object.hasOwn(networks, environment) || typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(mint)) throw new Error('SupplyNetworkRejected');
  if (!Number.isSafeInteger(observedAt) || observedAt > now || now - observedAt > 30000 || reconciliation?.state !== 'MATCH') throw new Error('SupplyReconciliationUnavailable');
  const completed = supplyInteger(completedAtomic), reserve = supplyInteger(reconciliation.canonicalReserve);
  const live = supplyInteger(reconciliation.mintedSupply), burns = supplyInteger(reconciliation.unclaimedDirectBurnDifference);
  const pending = supplyInteger(reconciliation.authorizedUnmintedCredits), issued = live + burns;
  if (issued > MAX_KPEPE_SUPPLY_ATOMIC || completed > MAX_KPEPE_SUPPLY_ATOMIC) throw new Error('SupplyMonetaryCapExceeded');
  if (completed > issued || issued + pending !== reserve || live > reserve) throw new Error('SupplyEligibleBackingExceeded');
  const [kingpepeNetwork, solanaNetwork, walletChain] = networks[environment];
  return Object.freeze({ state: 'AVAILABLE', basis: 'COMPLETED_RECONCILED_FORWARD_ISSUANCE', kingpepeNetwork, solanaNetwork, walletChain, mint,
    decimals: KPEPE_DECIMALS, maxSupplyAtomic: MAX_KPEPE_SUPPLY_ATOMIC.toString(), bridgedSupplyAtomic: completed.toString(),
    remainingSupplyAtomic: (MAX_KPEPE_SUPPLY_ATOMIC - completed).toString(), liveMintSupplyAtomic: live.toString(), observedAt });
}
