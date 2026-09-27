// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { base58 } from './bridge-vendor/base.js';
export const WALLET_CHAIN = 'solana:devnet';
// Explicit server-selected deployment context. The active TEST page continues
// using the legacy Devnet exports until verified Mainnet configuration exists.
export function createWalletBindings(chain) {
  if (!['solana:devnet', 'solana:mainnet'].includes(chain)) throw new Error('WRONG_CHAIN');
  return Object.freeze({ chain,
    compatible: wallet => compatible(wallet, chain),
    account: (wallet, accounts) => networkAccount(wallet, accounts, chain),
    balance: (value, address, mint) => networkBalance(value, address, mint, chain),
  });
}
export function formatBalance(value, decimals = 8) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/u.test(value) || BigInt(value) > 0xffffffffffffffffn || ![8, 9].includes(decimals)) throw new Error('BALANCE');
  const n = BigInt(value), scale = 10n ** BigInt(decimals);
  return `${n / scale}.${(n % scale).toString().padStart(decimals, '0')}`;
}
export const shortAddress = address => address.slice(0, 4) + '…' + address.slice(-4);
export const rejectedByUser = error => error?.code === 4001 || error?.code === 'ACTION_REJECTED' || error?.name === 'WalletConnectionRejectedError';
export const wrongWalletNetwork = error => error?.message === 'WRONG_CHAIN' || error?.code === 'UNSUPPORTED_CHAIN' || /unsupported chain|chain.*not supported|wrong (?:chain|network)|network mismatch|(?:devnet|mainnet) (?:is )?required/iu.test(error?.message ?? '');
export function walletCompatible(wallet) {
  return compatible(wallet, WALLET_CHAIN);
}
function compatible(wallet, chain) {
  return Boolean(wallet?.chains?.includes(chain) && wallet.features?.['standard:connect'] && wallet.features?.['standard:events']);
}
export function devnetAccount(wallet, accounts) {
  return networkAccount(wallet, accounts, WALLET_CHAIN);
}
function networkAccount(wallet, accounts, chain) {
  if (!compatible(wallet, chain) || !Array.isArray(accounts)) throw new Error('WRONG_CHAIN');
  const account = accounts.find(a => a.chains?.includes(chain));
  if (!account || !(account.publicKey instanceof Uint8Array) || account.publicKey.length !== 32 || base58.encode(account.publicKey) !== account.address) throw new Error('WRONG_CHAIN');
  return account;
}
export function validateWalletBalance(value, address, mint) {
  return networkBalance(value, address, mint, WALLET_CHAIN);
}
function networkBalance(value, address, mint, chain) {
  if (value?.address !== address || value.chain !== chain || value.mint !== mint || value.decimals !== 8 || value.commitment !== 'finalized' ||
      !Array.isArray(value.tokenAccounts) || value.tokenAccounts.length > 16) throw new Error('BALANCE');
  formatBalance(value.solLamports, 9); formatBalance(value.kpepeAtomic);
  let total = 0n; const addresses = new Set();
  for (const a of value.tokenAccounts) {
    if (typeof a.address !== 'string' || base58.decode(a.address).length !== 32 || addresses.has(a.address)) throw new Error('BALANCE');
    addresses.add(a.address); formatBalance(a.amountAtomic); total += BigInt(a.amountAtomic);
  }
  if (total.toString() !== value.kpepeAtomic) throw new Error('BALANCE');
  return value;
}
