// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { bridgeNetwork } from '../web/bridge-network.js';
import { createWalletBindings } from '../web/bridge-wallet.js';
const check = value => { if (!value) throw new Error('BridgeConfigurationRejected'); };
export function bridgeProfile(config) {
  const network = bridgeNetwork(config);
  check(typeof config.productionReady === 'boolean' &&
    config.mainnetActivation === (config.productionReady ? 'ENABLED' : 'DISABLED'));
  if (network.test) check(config.productionReady === false);
  else check(config.mainnetDeploymentVerified === true);
  return Object.freeze({ ...network, activationAllowed: config.productionReady });
}
export async function verifyMainnetGatewayDeployment(client, profile, mint, address) {
  if (profile.test) return;
  // The retained authenticated balance reader independently verifies the actual
  // finalized deployment snapshot (cluster, programs, owners, Mint and configs).
  // A private boolean or an empty prepared manifest alone cannot enable this UI.
  createWalletBindings(profile.walletChain).balance(await client.getSolanaBalance(address), address, mint);
}
