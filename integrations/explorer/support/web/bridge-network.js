// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Presentation follows the authenticated backend. There is no network selector.
const check = value => { if (!value) throw new Error('BRIDGE_NETWORK'); };
const networks = [
  Object.freeze({ kingpepeNetwork: 'REGTEST', solanaNetwork: 'DEVNET', walletChain: 'solana:devnet', environment: 'devnet', nativeHrp: 'rkpepe', test: true }),
  Object.freeze({ kingpepeNetwork: 'MAINNET', solanaNetwork: 'MAINNET', walletChain: 'solana:mainnet', environment: 'mainnet', nativeHrp: 'kpepe', test: false }),
];
export function bridgeNetwork(value) {
  const network = networks.find(n => value?.kingpepeNetwork === n.kingpepeNetwork && value.solanaNetwork === n.solanaNetwork);
  check(network && (value.walletChain === undefined || value.walletChain === network.walletChain));
  return network;
}
export function assertPublicNetwork(value) {
  const network = bridgeNetwork(value);
  check(value.walletChain === network.walletChain && ['ACTIVE', 'PAUSED', 'PENDING'].includes(value.state));
  if (value.state === 'PENDING') check(!network.test && value.activation === 'PENDING' && value.depositsAccepted === false);
  const active = !network.test && value.state === 'ACTIVE';
  check(value.productionReady === active && value.mainnetActivation === (active ? 'ENABLED' : 'DISABLED'));
  check(value.decimals === 8 && value.symbol === 'KPEPE' && value.bridgeFeeAtomic === '0');
  return network;
}
export function operationStorageKey(network, mint) {
  check(networks.includes(network) && typeof mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(mint));
  // Burn operations are isolated from reserve-backed operations and other Mints.
  return 'kingpepe.burn.' + network.environment + '.' + mint + '.operationId';
}
export function publicRequestFormat(network) {
  check(networks.includes(network));
  return network.test ? 'KINGPEPE_PUBLIC_TEST_REQUEST_V1' : 'KINGPEPE_PUBLIC_MAINNET_REQUEST_V1';
}
