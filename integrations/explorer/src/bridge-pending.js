// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Read-only pre-activation presentation. No wallet, signer, loopback token or
// operation methods are loaded by this backend. It cannot activate the Bridge.
import { base58 } from '../web/bridge-vendor/base.js';
import { OFFICIAL_KPEPE_MINT, MAINNET_BASELINE_SOURCE } from '../web/bridge-mainnet.js';
const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MINT_PDA = 'DigqtVexs6EDwvZ3wDASNykyj4SpTZzyGEvFtzya7QKr';
const check = value => { if (!value) throw Error('MAINNET_BASELINE_UNAVAILABLE'); };

export function createPendingMainnetBackend(config, { fetchImpl = fetch, now = Date.now } = {}) {
  check(Object.keys(config).sort().join() ===
    'kingpepeNetwork,mainnetActivation,mode,officialMint,productionReady,solanaNetwork,walletChain');
  check(config.mode === 'MAINNET_ACTIVATION_PENDING' && config.officialMint === OFFICIAL_KPEPE_MINT &&
    config.kingpepeNetwork === 'MAINNET' && config.solanaNetwork === 'MAINNET' &&
    config.walletChain === 'solana:mainnet' && config.productionReady === false && config.mainnetActivation === 'DISABLED');
  let sequence = 0, checkedAt = -Infinity, supply = { state: 'UNAVAILABLE' }, inFlight;
  async function rpc(method, params = []) {
    const id = ++sequence;
    // Fixed public, credential-free, server-side read-only RPC. Browser inputs
    // cannot select an endpoint, method, account, commitment or network.
    const response = await fetchImpl('https://api.mainnet-beta.solana.com', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    check(response.ok);
    const text = await response.text(); check(text.length <= 16384);
    const value = JSON.parse(text); check(value.jsonrpc === '2.0' && value.id === id && !value.error);
    return value.result;
  }
  async function refresh() {
    try {
      const [genesis, account] = await Promise.all([
        rpc('getGenesisHash'), rpc('getAccountInfo', [OFFICIAL_KPEPE_MINT, { encoding: 'base64', commitment: 'finalized' }]),
      ]);
      check(genesis === GENESIS && Number.isSafeInteger(account?.context?.slot) && account.context.slot >= 450075833);
      const mint = account.value;
      check(mint?.owner === TOKEN && mint.executable === false && Array.isArray(mint.data) && mint.data[1] === 'base64');
      const bytes = Buffer.from(mint.data[0], 'base64');
      check(bytes.length === 82 && bytes.toString('base64') === mint.data[0] &&
        bytes.readUInt32LE(0) === 1 && base58.encode(bytes.subarray(4, 36)) === MINT_PDA &&
        bytes.readBigUInt64LE(36) === 0n && bytes[44] === 8 && bytes[45] === 1 && bytes.readUInt32LE(46) === 0);
      // Only the verified zero baseline is supported here. Once issuance starts,
      // the deployed runtime's canonical burn/mint accounting must replace it.
      supply = { state: 'READY', source: MAINNET_BASELINE_SOURCE, environment: 'mainnet',
        nativeNetwork: 'MAINNET', solanaNetwork: 'MAINNET', mint: OFFICIAL_KPEPE_MINT, decimals: 8,
        maxSupplyAtomic: '2100000000000000', bridgedSupplyAtomic: '0', remainingSupplyAtomic: '2100000000000000',
        liveMintSupplyAtomic: '0', observedAt: now() };
    } catch { supply = { state: 'UNAVAILABLE' }; }
    checkedAt = now();
  }
  return Object.freeze({ activationPending: true, async getPublicStatus() {
    if (now() - checkedAt >= 10000) {
      inFlight ??= refresh().finally(() => { inFlight = undefined; });
      await inFlight;
    }
    return { architecture: 'ONE_WAY_AUTOMATIC_BURN_AND_MINT', network: 'MAINNET',
      direction: 'NATIVE_TO_SOLANA', mode: 'BURN_AND_MINT', activation: 'PENDING', depositsAccepted: false,
      state: 'PENDING', kingpepeNetwork: 'MAINNET', solanaNetwork: 'MAINNET', walletChain: 'solana:mainnet',
      productionReady: false, mainnetActivation: 'DISABLED', decimals: 8, symbol: 'KPEPE', mint: OFFICIAL_KPEPE_MINT,
      bridgeFeeAtomic: '0', nativeDepositConfirmations: 12, nativeBurnConfirmations: 12, supply: { ...supply } };
  } });
}
