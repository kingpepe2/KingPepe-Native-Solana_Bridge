// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Offline protected preparation. This module has no RPC or transaction sender.
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { WindowsProtectedStore, assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { mainnetDeploymentIdentity, NATIVE_MAINNET_GENESIS, SOLANA_MAINNET_GENESIS } from "../../shared/network-identity.mjs";

const names = ["manager", "transceiver", "mint"];
export function prepareMainnetProgramIdentities({ root, repoRoot, serviceSid, instanceId }) {
  const seeds = names.map(() => randomBytes(32)); let payload;
  try {
    const publicKeys = Object.fromEntries(names.map((name, n) => [name, base58.encode(ed25519.getPublicKey(seeds[n]))]));
    const solanaDeployment = mainnetDeploymentIdentity(publicKeys);
    const options = { root, repoRoot, context: { role: "FEE_PAYER", purpose: "mainnet-deployment-keys", serviceSid,
      environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS, solanaDeployment, instanceId, keyEpoch: 1 } };
    payload = Buffer.from(JSON.stringify(Object.fromEntries(names.map((name, n) => [name, seeds[n].toString("hex")]))));
    const store = WindowsProtectedStore.create(options, payload);
    try { return Object.freeze({ options, ...preparedMainnetProgramIdentities(store) }); } finally { store.close(); }
  } finally { seeds.forEach(seed => seed.fill(0)); payload?.fill(0); }
}

export function preparedMainnetProgramIdentities(store) {
  assertWindowsProtectedStore(store, "FEE_PAYER", "mainnet-deployment-keys");
  const { payload } = store.read(); const seeds = [];
  try {
    const values = JSON.parse(payload.toString("utf8"));
    if (!values || Object.keys(values).sort().join() !== [...names].sort().join()) throw new Error();
    const publicKeys = Object.fromEntries(names.map(name => {
      if (typeof values[name] !== "string" || !/^[0-9a-f]{64}$/u.test(values[name])) throw new Error();
      const seed = Buffer.from(values[name], "hex"); seeds.push(seed);
      return [name, base58.encode(ed25519.getPublicKey(seed))];
    }));
    const solanaDeployment = mainnetDeploymentIdentity(publicKeys);
    if (store.context.environment !== "mainnet" || store.context.nativeGenesis !== NATIVE_MAINNET_GENESIS ||
        store.context.solanaDeployment !== solanaDeployment) throw new Error();
    return Object.freeze({ status: "PREPARED_NOT_DEPLOYED", network: "mainnet", solanaGenesis: SOLANA_MAINNET_GENESIS,
      nativeGenesis: NATIVE_MAINNET_GENESIS, publicKeys: Object.freeze(publicKeys), solanaDeployment,
      productionReady: false, mainnetActivation: "DISABLED", transactionsSubmitted: 0 });
  } catch { throw new Error("PreparedMainnetIdentityRejected"); }
  finally { payload.fill(0); seeds.forEach(seed => seed.fill(0)); }
}

export function prepareMainnetRoleSeed(options) {
  if (options.context?.environment !== "mainnet" || options.context.nativeGenesis !== NATIVE_MAINNET_GENESIS ||
      !["attester-seed", "bridge-journal-key"].includes(options.context.purpose)) throw new Error("MainnetRolePreparationRejected");
  const seed = randomBytes(32);
  try {
    const store = WindowsProtectedStore.create(options, seed);
    try { return Object.freeze({ state: "PREPARED_NOT_ACTIVATED", role: store.context.role,
      publicKey: options.context.purpose === "attester-seed" ? base58.encode(ed25519.getPublicKey(seed)) : null }); }
    finally { store.close(); }
  } finally { seed.fill(0); }
}
