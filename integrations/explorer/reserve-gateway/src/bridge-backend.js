// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Load only private, server-side configuration. No plaintext credential fallback.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bridgeProfile, verifyMainnetGatewayDeployment } from './bridge-profile.js';
import { createPendingMainnetBackend } from './bridge-pending.js';
import { createGatewayBridgeClient, upstreamTimeoutMs } from './bridge-client.js';

function configuredPath() {
  if (process.platform !== 'win32') return process.env.KPE_BRIDGE_CONFIG;
  // A long-running Windows supervisor may predate a User environment update.
  // Read only this reference at startup; credentials remain in protected storage.
  try {
    const result = execFileSync(path.join(process.env.SystemRoot, 'System32', 'reg.exe'),
      ['query', 'HKCU\\Environment', '/v', 'KPE_BRIDGE_CONFIG'],
      { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
    const current = /^\s*KPE_BRIDGE_CONFIG\s+REG_SZ\s+([^\r\n]+)$/mu.exec(result)?.[1].trim();
    if (current) return current;
  } catch { /* The explicit process reference remains usable without a User entry. */ }
  return process.env.KPE_BRIDGE_CONFIG;
}

export async function loadBridgeBackend(configFile = configuredPath()) {
  if (!configFile) return null;
  const check = value => { if (!value) throw new Error('BridgeConfigurationRejected'); };
  check(path.isAbsolute(configFile));
  const file = fs.realpathSync(configFile), stat = fs.statSync(file);
  check(stat.isFile() && stat.size <= 16384);
  // A private configuration cannot live in this checkout or its public web tree.
  const explorerRoot = path.resolve(import.meta.dirname, '..');
  const outside = root => { const relative = path.relative(root, file); return path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep); };
  check(outside(explorerRoot));
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.mode === 'MAINNET_ACTIVATION_PENDING') return createPendingMainnetBackend(config);
  const network = bridgeProfile(config);
  check(path.isAbsolute(config.bridgeSourceRoot));
  const source = fs.realpathSync(config.bridgeSourceRoot);
  check(outside(source));
  const module = relative => import(pathToFileURL(path.join(source, relative)).href);
  const [{ createBridgeClient }, { burnDepositDestination }, { scriptFromWitnessAddress }, { validateBurnSolanaPolicy },
    { WindowsProtectedStore }, { base58Decode, base58Encode }] = await Promise.all([
    module('solana/ts/sdk/client.mjs'), module('native/burn/burn-key.mjs'), module('native/node/witness-address.mjs'),
    module('services/solana-observer/burn-solana-adapter.mjs'), module('shared/windows/protected-store.mjs'),
    module('services/bridge-validator/solana-deposit-claim-transaction-plan.mjs'),
  ]);
  const policy = validateBurnSolanaPolicy(config.policy), deployment = policy.context.deployment;
  check(policy.context.environment === network.environment);
  const options = config.accessTokenStore;
  check(options?.context?.role === 'BRIDGE_VALIDATOR' && options.context.purpose === 'service-auth' &&
    options.context.environment === network.environment && options.context.nativeGenesis === deployment.nativeGenesis &&
    options.context.solanaDeployment === deployment.solanaDeployment);
  const protectedStore = new WindowsProtectedStore(options);
  let secret;
  try {
    secret = protectedStore.read().payload; check(secret.length === 32 && secret.some(value => value !== 0));
    const client = createGatewayBridgeClient({ createReadClient: createBridgeClient, network, endpoint: config.endpoint, accessToken: secret.toString('hex'),
      fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(upstreamTimeoutMs(init))]) }) });
    const mint = base58Encode(Buffer.from(deployment.mint, 'hex'));
    if (!network.test) {
      check(config.productionFeePayer === '47EPgcpqc11Bo3ghi22LrTA2AERFLnuXccnZhTqoEkFb');
      await verifyMainnetGatewayDeployment(client, network, mint, config.productionFeePayer);
    }
    const operationIdentity = input => burnDepositDestination({ ...deployment,
      destination: Buffer.from(base58Decode(input.destination)).toString('hex'), nonce: input.clientNonce });
    return { client, validators: {
      mint, network,
      operationId: input => operationIdentity(input).operationId,
      publicKey: value => { check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value));
        const bytes = base58Decode(value); check(bytes.length === 32 && base58Encode(bytes) === value); },
      nativeAddress: address => scriptFromWitnessAddress(address, network.nativeHrp),
      operationBinding: (operation, input) => {
        const expected = operationIdentity(input);
        check(operation.operationId === expected.operationId && operation.depositAddress === expected.address && operation.destination === input.destination);
      },
      signature: value => { check(typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value) && base58Decode(value).length === 64); },

    } };
  } finally { secret?.fill(0); protectedStore.close(); }
}
