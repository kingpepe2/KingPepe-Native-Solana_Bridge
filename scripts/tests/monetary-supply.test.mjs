// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_KPEPE_SUPPLY_ATOMIC as CAP, checkedRepresentedMint, completedSupplyCounter } from '../../shared/monetary-supply.mjs';
import { compareDepositAccounting } from '../../services/reconciliation/deposit-reconciliation.mjs';
const mint = '11111111111111111111111111111111';
function counter(n, extra = {}) {
  return { environment: 'devnet', mint, completedAtomic: n.toString(), observedAt: 1000,
    reconciliation: { state: 'MATCH', canonicalReserve: n.toString(), mintedSupply: n.toString(), unclaimedDirectBurnDifference: '0', authorizedUnmintedCredits: '0' }, ...extra };
}
test('eight-decimal monetary ceiling uses exact integer Native units', () => {
  assert.equal(CAP, 2100000000000000n);
  for (const n of [CAP - 1n, CAP]) assert.equal(checkedRepresentedMint(n - 1n, 1n, n), n);
  assert.throws(() => checkedRepresentedMint(CAP, 1n, CAP + 1n), /CapExceeded/);
  assert.throws(() => checkedRepresentedMint(99n, 2n, 100n), /BackingExceeded/);
  assert.equal(checkedRepresentedMint(99n, 1n, 100n), 100n);
  assert.throws(() => checkedRepresentedMint((1n << 128n) - 1n, 1n, '0'), /Overflow/);
  for (const n of [1, '1.0', '-1', '01', '1e8', (1n << 128n)]) assert.throws(() => checkedRepresentedMint(n, 1n, CAP));
});
test('counter derives zero, normal and cap totals only from completed reconciled issuance', () => {
  for (const n of [0n, 101000000n, CAP - 1n, CAP]) {
    const c = completedSupplyCounter(counter(n), 1000);
    assert.equal(c.bridgedSupplyAtomic, n.toString()); assert.equal(c.remainingSupplyAtomic, (CAP - n).toString());
  }
  const input = counter(20n); input.reconciliation = { state: 'MATCH', canonicalReserve: '100', mintedSupply: '40', unclaimedDirectBurnDifference: '10', authorizedUnmintedCredits: '50' };
  assert.equal(completedSupplyCounter(input, 1000).bridgedSupplyAtomic, '20'); // pending and not-completed mints excluded
});
test('counter rejects over-cap, under-backed, stale, missing and mixed network facts', () => {
  assert.throws(() => completedSupplyCounter(counter(CAP + 1n), 1000), /CapExceeded/);
  const input = counter(100n); input.reconciliation.canonicalReserve = '99';
  assert.throws(() => completedSupplyCounter(input, 1000), /BackingExceeded/);
  for (const environment of ['localnet', 'MAINNET', 'testnet', 'unknown']) assert.throws(() => completedSupplyCounter(counter(0n, { environment }), 1000));
  assert.equal(completedSupplyCounter(counter(0n), 1000).walletChain, 'solana:devnet');
  assert.equal(completedSupplyCounter(counter(0n, { environment: 'mainnet' }), 1000).walletChain, 'solana:mainnet');
  for (const extra of [{ reconciliation: null }, { observedAt: 1001 }, { observedAt: -30000 }]) assert.throws(() => completedSupplyCounter(counter(0n, extra), 1000));
});
test('coherent over-cap reconciliation produces the critical incident used by the automatic pause', () => {
  for (const n of [CAP + 1n, (1n << 64n) - 1n]) assert.throws(() => compareDepositAccounting(
    { canonicalReserve: n.toString(), authorizedUnmintedCredits: '0', mintedSupply: n.toString() },
    { canonicalReserve: n.toString(), managerMintedAtomic: n.toString(), mintSupplyAtomic: n.toString() }),
    e => e.incident?.reason === 'MONETARY_SUPPLY_CAP_EXCEEDED');
  const n = CAP.toString();
  assert.equal(compareDepositAccounting({ canonicalReserve: n, authorizedUnmintedCredits: '0', mintedSupply: n },
    { canonicalReserve: n, managerMintedAtomic: n, mintSupplyAtomic: n }).mintedSupply, n);
});
