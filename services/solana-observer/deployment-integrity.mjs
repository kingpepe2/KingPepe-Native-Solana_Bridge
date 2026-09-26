// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { encodeBridgeAbi, decodeBridgeAbi } from "../../shared/protocol/solana-bridge-abi.mjs";
import { createHash } from "node:crypto";
import { isTestSolanaCluster, devnetRpcEndpoint, assertDevnetGenesis } from "../../shared/solana-test-network.mjs";
import { assertMainnetDeploymentFields, SOLANA_MAINNET_GENESIS, mainnetRpcEndpoint, assertMainnetSolanaGenesis } from "../../shared/network-identity.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { base58Decode, base58Encode, findProgramAddress } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN } from "../bridge-validator/localnet-solana-setup-plan.mjs";

export const DEPLOYMENT_MONITOR_PROTOCOL = "KINGPEPE_DEPLOYMENT_MONITOR_V2";
export const LEGACY_LOADER = "BPFLoader2111111111111111111111111111111111";
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const MAX_PROGRAM_BYTES = 2_097_152, MAX_RESPONSE_BYTES = 8_388_608;
const MAINNET_RPC = Symbol("Explicit Mainnet deployment RPC");
const HASH = /^[0-9a-f]{64}$/u;
const fail = code => { throw new Error(code); };
const check = (ok, code = "DeploymentInputRejected") => { if (!ok) fail(code); };
export const deploymentDigest = bytes => createHash("sha256").update(bytes).digest("hex");
function keys(v, names) { check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join()); }
function hash(v) { check(typeof v === "string" && HASH.test(v)); return v; }
function uint(v) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v) && BigInt(v) <= 0xffff_ffff_ffff_ffffn); return BigInt(v); }
function key(v) { check(typeof v === "string" && v.length >= 32 && v.length <= 44); const bytes = base58Decode(v); check(bytes.length === 32 && base58Encode(bytes) === v); return bytes; }
function bounded(v, max) { check(Number.isSafeInteger(v) && v >= 0 && v <= max); return v; }

function immutable(value) { for (const v of Object.values(value)) if (v && typeof v === "object") immutable(v); return Object.freeze(value); }
function canonical(v) { if (Array.isArray(v)) return v.map(canonical); if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])); return v; }

// A supplied, reviewed manifest is mandatory. This never learns/approves an
// arbitrary deployment from the RPC response. No production default is offered.
export function validateDeploymentManifest(input) {
  const m = structuredClone(input);
  keys(m, ["protocol", "environment", "sourceSha", "identityVersion", "nativeGenesisHex", "solanaGenesis", "solanaDeploymentHex", "minimumSlot", "maximumStallMs", "manager", "transceiver", "mint", "config"]);
  check(m.protocol === DEPLOYMENT_MONITOR_PROTOCOL && ["localnet", "devnet", "mainnet"].includes(m.environment) && (m.environment === "mainnet" ||
    isTestSolanaCluster({ ...m, cluster: m.environment })));
  if (m.environment === "devnet") check(m.nativeGenesisHex === REGTEST_GENESIS && m.config?.nativeNetwork === 8_000_111 && m.mint?.decimals === 8);
  check(typeof m.sourceSha === "string" && /^[0-9a-f]{40}$/u.test(m.sourceSha));
  check(bounded(m.identityVersion, 0xffff_ffff) > 0); hash(m.nativeGenesisHex); hash(m.solanaDeploymentHex); key(m.solanaGenesis); uint(m.minimumSlot);
  check(bounded(m.maximumStallMs, 300000) >= 1000);
  for (const p of [m.manager, m.transceiver]) {
    keys(p, ["id", "loader", "programData", "upgradeAuthority", "deploymentSlot"]);
    key(p.id); check([LEGACY_LOADER, UPGRADEABLE_LOADER].includes(p.loader));
    if (p.loader === LEGACY_LOADER) check(p.programData === null && p.upgradeAuthority === null && p.deploymentSlot === null);
    else {
      check(p.programData === findProgramAddress([key(p.id)], key(UPGRADEABLE_LOADER)).base58);
      if (p.upgradeAuthority !== null) key(p.upgradeAuthority);
      uint(p.deploymentSlot);
    }
  }
  keys(m.mint, ["id", "tokenProgram", "authority", "decimals"]);
  key(m.mint.id); check(m.mint.tokenProgram === TOKEN); bounded(m.mint.decimals, 18);
  check(m.mint.authority === findProgramAddress([Buffer.from("kingpepe-mint-authority"), key(m.mint.id)], key(m.manager.id)).base58);
  keys(m.config, ["bridgePda", "transceiverPda", "policyEpoch", "keyEpoch", "protocolId", "nativeNetwork", "attesters", "depositsPaused", "transceiverActive",
    ...(m.environment === "mainnet" ? ["mainnetProgramState", "mainnetActivationEnabled"] : [])]);
  check(m.config.bridgePda === findProgramAddress([Buffer.from("kingpepe-bridge-state"), key(m.mint.id)], key(m.manager.id)).base58);
  check(m.config.transceiverPda === findProgramAddress([Buffer.from("kingpepe-transceiver-config"), key(m.mint.id)], key(m.transceiver.id)).base58);
  for (const name of ["policyEpoch", "keyEpoch", "protocolId", "nativeNetwork"]) bounded(m.config[name], 0xffff_ffff);
  for (const name of ["depositsPaused", "transceiverActive"]) check(typeof m.config[name] === "boolean");
  check(Array.isArray(m.config.attesters) && m.config.attesters.length === 2 && m.config.attesters[0] !== m.config.attesters[1]);
  m.config.attesters.forEach(key);
  if (m.environment === "mainnet") {
    assertMainnetDeploymentFields({ protocolId: m.config.protocolId, nativeNetwork: m.config.nativeNetwork, nativeGenesis: m.nativeGenesisHex,
      solanaDeployment: m.solanaDeploymentHex, managerProgramId: Buffer.from(key(m.manager.id)).toString("hex"),
      transceiverProgramId: Buffer.from(key(m.transceiver.id)).toString("hex"), mint: Buffer.from(key(m.mint.id)).toString("hex") });
    check(m.solanaGenesis === SOLANA_MAINNET_GENESIS && m.mint.decimals === 8 && m.config.policyEpoch > 0 && m.config.keyEpoch > 0,
      "MainnetDeploymentBindingRejected");
    // ProgramState encodes Uninitialized as 0 and Phase0Disabled as 1.
    // An enrolled Mainnet deployment must never admit the uninitialized state.
    check([1, 4, 5].includes(m.config.mainnetProgramState) &&
      m.config.mainnetActivationEnabled === (m.config.mainnetProgramState === 5) &&
      (m.config.mainnetProgramState !== 1 || m.config.depositsPaused), "MainnetDeploymentModeRejected");
    check([m.manager, m.transceiver].every(p => p.loader === UPGRADEABLE_LOADER && p.upgradeAuthority !== null) &&
      m.manager.upgradeAuthority === m.transceiver.upgradeAuthority, "MainnetUpgradeAuthorityBindingRejected");
  }
  const addresses = deploymentAddresses(m); check(new Set(addresses).size === addresses.length);
  return immutable(canonical(m));
}
export function deploymentManifestDigest(manifest) { return deploymentDigest(Buffer.from(JSON.stringify(validateDeploymentManifest(manifest)))); }

// Consume the reviewed public enrollment record. Never enroll identities from
// whatever the RPC happens to return, or substitute the runtime source SHA for
// the separately pinned on-chain program source.
export function devnetTestManifest(record) {
  check(record?.schema === "KINGPEPE_ONE_WAY_DEVNET_DEPLOYMENT/V1" && record.scope === "DEVNET_TEST_ONLY" &&
    record.borshSchemaVersion === 4 && record.canonicalMagic === "KPBRMSG4" && record.initialSupplyAtomic === "0" &&
    record.freezeAuthority === null && record.productionReady === false && record.mainnetActivation === "DISABLED", "DevnetEnrollmentRecordRejected");
  const program = (name, id) => ({ id, loader: UPGRADEABLE_LOADER, programData: record.pdas[name + "ProgramData"],
    upgradeAuthority: record.upgradeAuthority, deploymentSlot: String(record.transactions[name + "Deployment"].slot) });
  return validateDeploymentManifest({ protocol: DEPLOYMENT_MONITOR_PROTOCOL, environment: "devnet", sourceSha: record.sourceSha,
    identityVersion: 1, nativeGenesisHex: record.nativeGenesis, solanaGenesis: record.solanaGenesis,
    solanaDeploymentHex: record.solanaDeploymentHex, minimumSlot: String(record.transactions.mintAndConfigEnrollment.slot), maximumStallMs: 60000,
    manager: program("manager", record.managerProgram), transceiver: program("transceiver", record.transceiverProgram),
    mint: { id: record.mint, tokenProgram: record.tokenProgram, authority: record.pdas.mintAuthority, decimals: record.decimals },
    config: { bridgePda: record.pdas.bridgePda, transceiverPda: record.pdas.transceiverPda,
      policyEpoch: record.policyEpoch, keyEpoch: record.keyEpoch, protocolId: record.protocolId, nativeNetwork: record.nativeNetwork,
      attesters: record.attesters, depositsPaused: false, transceiverActive: true } });
}

export function deploymentAddresses(m) { return [m.manager.id, m.transceiver.id, m.mint.id, m.config.bridgePda, m.config.transceiverPda,
  ...[m.manager, m.transceiver].filter(p => p.programData !== null).map(p => p.programData)]; }

function expectedConfig(m) {
  const c = m.config, h = v => Buffer.from(v, "hex");
  // The cumulative issued counter is mutable and grants no authority.
  const bridge = encodeBridgeAbi("BridgeState", {
    magic: Buffer.from("KPBSTAT1"), version: 2, state: m.environment === "mainnet" ? c.mainnetProgramState : m.environment === "devnet" ? 3 : 2,
    config: { binding: { environment: m.environment === "mainnet" ? 2 : m.environment === "devnet" ? 1 : 0, managerProgramId: key(m.manager.id), transceiverProgramId: key(m.transceiver.id),
      solanaDeployment: h(m.solanaDeploymentHex), mint: key(m.mint.id), tokenProgramId: key(TOKEN),
      mintAuthorityPda: key(m.mint.authority), decimals: m.mint.decimals, nativeDecimals: m.mint.decimals },
      freezeTag: 0, freezeKey: Buffer.alloc(32), initialSupply: 0n,
      policy: { policyEpoch: c.policyEpoch, keyEpoch: c.keyEpoch, depositsPaused: c.depositsPaused,
        hardStop: false, mainnetActivationEnabled: m.environment === "mainnet" && c.mainnetActivationEnabled } },
    mintedSupply: 0n,
  }).subarray(0, 265);
  const transceiver = encodeBridgeAbi("TransceiverState", { magic: Buffer.from("KPTCFG02"), version: 1,
    config: { transceiverProgramId: key(m.transceiver.id), managerProgramId: key(m.manager.id), mint: key(m.mint.id),
      solanaDeployment: h(m.solanaDeploymentHex), protocolId: c.protocolId, nativeNetwork: c.nativeNetwork,
      nativeGenesis: h(m.nativeGenesisHex), authorizedAttesters: c.attesters.map(key),
      active: c.transceiverActive, keyEpoch: c.keyEpoch } });
  return { bridge, transceiver };
}
function accountData(a) {
  check(a && typeof a === "object" && typeof a.executable === "boolean", "DeploymentAccountMalformed");
  key(a.owner);
  check(Array.isArray(a.data) && a.data.length === 2 && a.data[1] === "base64" && typeof a.data[0] === "string" && a.data[0].length <= 2_796_264, "DeploymentAccountMalformed");
  const b = Buffer.from(a.data[0], "base64"); check(b.toString("base64") === a.data[0], "DeploymentAccountMalformed");
  return b;
}
function different(code, actual, violation) { const error = new Error(code); error.integrityCode = code; error.violation = violation; error.evidenceDigest = deploymentDigest(Buffer.from(JSON.stringify(canonical(actual)))); throw error; }

// Pure validation is shared with real local-validator regressions. Its return
// value is RPC_OBSERVATION, never a chain proof or a signing capability.
export function verifyDeploymentSnapshot(manifest, snapshot) {
  const m = validateDeploymentManifest(manifest), addresses = deploymentAddresses(m);
  check(snapshot && Number.isSafeInteger(snapshot.slot) && snapshot.slot >= 0 && Array.isArray(snapshot.accounts) && snapshot.accounts.length === addresses.length, "DeploymentSnapshotMalformed");
  key(snapshot.genesis);
  if (snapshot.genesis !== m.solanaGenesis) different("SOLANA_GENESIS_CHANGED", { genesis: snapshot.genesis });
  if (BigInt(snapshot.slot) < uint(m.minimumSlot)) fail("DeploymentSourceStale");
  const accounts = new Map(addresses.map((address, i) => [address, snapshot.accounts[i]]));
  for (const p of [m.manager, m.transceiver]) {
    const a = accounts.get(p.id);
    if (a === null) different("SOLANA_DEPLOYMENT_CHANGED", { absent: p.id }, "PROGRAM_ABSENT");
    let b = accountData(a), slot;
    if (a.owner !== p.loader || !a.executable) different("SOLANA_DEPLOYMENT_CHANGED", a, "PROGRAM_EXECUTABLE_OR_LOADER");
    if (p.loader === UPGRADEABLE_LOADER) {
      if (b.length !== 36 || b.readUInt32LE() !== 2 || base58Encode(b.subarray(4)) !== p.programData) different("SOLANA_DEPLOYMENT_CHANGED", a, "PROGRAMDATA_BINDING");
      const data = accounts.get(p.programData);
      if (data === null) different("SOLANA_DEPLOYMENT_CHANGED", { absent: p.programData }, "PROGRAMDATA_ABSENT");
      b = accountData(data);
      if (data.owner !== UPGRADEABLE_LOADER || data.executable || b.length <= 49 || b.length > MAX_PROGRAM_BYTES + 45 || b.readUInt32LE() !== 3 || ![0, 1].includes(b[12])) different("SOLANA_DEPLOYMENT_CHANGED", data, "PROGRAMDATA_LAYOUT");
      slot = b.readBigUInt64LE(4).toString();
      const authority = b[12] === 0 ? null : base58Encode(b.subarray(13, 45));
      if (slot !== p.deploymentSlot || authority !== p.upgradeAuthority) different("SOLANA_DEPLOYMENT_CHANGED", data, "UPGRADE_AUTHORITY_OR_SLOT");
      b = b.subarray(45);
    }
    // Identity and the accepted deployment slot detect unauthorized upgrades.
    // Binary hashes belong to build/release evidence, not runtime enrollment.
    if (b.length <= 4 || b.length > MAX_PROGRAM_BYTES || b.subarray(0, 4).toString("hex") !== "7f454c46") different("SOLANA_DEPLOYMENT_CHANGED", { program: p.id, slot: slot ?? null }, "PROGRAM_LAYOUT");
  }
  const mint = accounts.get(m.mint.id), bridge = accounts.get(m.config.bridgePda), transceiver = accounts.get(m.config.transceiverPda);
  if (!mint) different("SOLANA_DEPLOYMENT_CHANGED", { missingMint: true }, "MISSING_MINT");
  const mintBytes = accountData(mint);
  if (mint.owner !== TOKEN || mint.executable || mintBytes.length !== 82 || mintBytes.readUInt32LE() !== 1 ||
      base58Encode(mintBytes.subarray(4, 36)) !== m.mint.authority || mintBytes[44] !== m.mint.decimals || mintBytes[45] !== 1) different("SOLANA_DEPLOYMENT_CHANGED", mint, "MINT_BINDING");
  if (mintBytes.readUInt32LE(46) !== 0 || mintBytes.subarray(50).some(byte => byte !== 0)) different("SOLANA_DEPLOYMENT_CHANGED", mint, "FREEZE_AUTHORITY");
  if (!bridge || !transceiver) different("SOLANA_DEPLOYMENT_CHANGED", { missingConfiguration: true }, "CONFIGURATION_ABSENT");
  const bridgeBytes = accountData(bridge), transceiverBytes = accountData(transceiver), expected = expectedConfig(m);
  if (bridge.owner !== m.manager.id || bridge.executable || bridgeBytes.length !== 281 || !bridgeBytes.subarray(0, 265).equals(expected.bridge)) different("SOLANA_DEPLOYMENT_CHANGED", bridge, "BRIDGE_CONFIGURATION");
  if (transceiver.owner !== m.transceiver.id || transceiver.executable || !transceiverBytes.equals(expected.transceiver)) different("SOLANA_DEPLOYMENT_CHANGED", transceiver, "TRANSCEIVER_CONFIGURATION");
  const bridgeState = decodeBridgeAbi("BridgeState", bridgeBytes);
  if (m.environment === "mainnet" && m.config.mainnetProgramState === 1 &&
      (mintBytes.readBigUInt64LE(36) !== 0n || bridgeState.mintedSupply !== 0n))
    different("SOLANA_DEPLOYMENT_CHANGED", { initialSupplyNotZero: true }, "MAINNET_ZERO_START");
  return Object.freeze({ protocol: DEPLOYMENT_MONITOR_PROTOCOL, trust: "RPC_OBSERVATION", slot: String(snapshot.slot),
    genesis: snapshot.genesis, manifestDigest: deploymentManifestDigest(m), snapshotDigest: deploymentDigest(Buffer.from(JSON.stringify(canonical(snapshot)))),
    mintSupplyAtomic: mintBytes.readBigUInt64LE(36).toString(), managerMintedAtomic: bridgeState.mintedSupply.toString() });
}

export class LocalDeploymentRpc {
  #endpoint; #id = 0; #environment;
  static createMainnet(options) {
    check(options && (options.environment === undefined || options.environment === "mainnet"), "DeploymentEnvironmentRejected");
    return new LocalDeploymentRpc({ ...options, environment: "mainnet" }, MAINNET_RPC);
  }
  constructor({ endpoint, environment = "localnet", expectedGenesis }, capability) {
    check(["localnet", "devnet"].includes(environment) || environment === "mainnet" && capability === MAINNET_RPC, "DeploymentEnvironmentRejected");
    this.#environment = environment;
    if (environment === "mainnet") { this.#endpoint = mainnetRpcEndpoint(endpoint, expectedGenesis); return; }
    if (environment === "devnet") { this.#endpoint = devnetRpcEndpoint(endpoint, expectedGenesis); return; }
    const u = new URL(endpoint);
    check(u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port && Number(u.port) >= 1024 && u.pathname === "/" && !u.username && !u.password && !u.search && !u.hash, "DeploymentLocalEndpointRequired");
    this.#endpoint = u.href;
  }
  assertEnvironment(environment) { check(environment === this.#environment, "DeploymentEnvironmentMismatch"); }
  async #call(method, params) {
    const id = ++this.#id; let httpStatus, rpcCode;
    try {
      const response = await fetch(this.#endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      httpStatus = response.status;
      check(response.body, "DeploymentSourceUnavailable");
      const reader = response.body.getReader(); let size = 0; const parts = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; check(size <= MAX_RESPONSE_BYTES, "DeploymentResponseLimit"); parts.push(value); } }
      finally { await reader.cancel(); }
      const v = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (v?.jsonrpc === "2.0" && v.id === id && Number.isSafeInteger(v.error?.code)) rpcCode = v.error.code;
      check(response.ok && v?.jsonrpc === "2.0" && v.id === id && Object.hasOwn(v, "result") && !Object.hasOwn(v, "error"), "DeploymentSourceUnavailable"); return v.result;
    } catch {
      // Retain only bounded numeric diagnostics, never the endpoint, provider
      // message/body or original exception (which may contain credentials).
      const error = new Error("DeploymentSourceUnavailable");
      if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) error.httpStatus = httpStatus;
      if (Number.isSafeInteger(rpcCode)) error.code = rpcCode;
      throw error;
    }
  }
  async genesis() {
    const result = await this.#call("getGenesisHash", []); key(result);
    if (this.#environment === "devnet") assertDevnetGenesis(result);
    if (this.#environment === "mainnet") assertMainnetSolanaGenesis(result);
    return result;
  }
  async finalizedTransaction(signature) {
    check(typeof signature === "string" && signature.length <= 88 && base58Decode(signature).length === 64, "DeploymentTransactionSignatureRejected");
    if (this.#environment !== "localnet") await this.genesis();
    const result = await this.#call("getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
    if (this.#environment === "mainnet") await this.genesis();
    return result;
  }
  async finalizedUserTokenAddresses(manifest, owner) {
    const m = validateDeploymentManifest(manifest); key(owner);
    check(m.environment === this.#environment, "DeploymentEnvironmentMismatch");
    const genesis = await this.genesis();
    const result = await this.#call("getTokenAccountsByOwner", [owner, { mint: m.mint.id },
      { commitment: "finalized", encoding: "base64", dataSlice: { offset: 0, length: 0 }, minContextSlot: Number(m.minimumSlot) }]);
    check(genesis === await this.genesis() && genesis === m.solanaGenesis, "DeploymentEndpointChangedDuringRead");
    check(Number.isSafeInteger(result?.context?.slot) && BigInt(result.context.slot) >= uint(m.minimumSlot) &&
      Array.isArray(result.value) && result.value.length <= 16, "UserTokenLookupUnavailable");
    const addresses = result.value.map(row => { key(row?.pubkey); return row.pubkey; });
    check(new Set(addresses).size === addresses.length, "UserTokenLookupMalformed");
    // Discovery is not authority/balance proof. Re-read raw accounts and the
    // configured deployment together before presenting any result to a user.
    return { addresses, slot: String(result.context.slot) };
  }



  async snapshot(manifest, minimumSlot = manifest.minimumSlot) {
    return this.snapshotWithAdditionalAccounts(manifest, [], minimumSlot);
  }
  async snapshotWithAdditionalAccounts(manifest, additionalAccounts, minimumSlot = manifest.minimumSlot) {
    const m = validateDeploymentManifest(manifest); check(uint(minimumSlot) <= BigInt(Number.MAX_SAFE_INTEGER));
    check(m.environment === this.#environment, "DeploymentEnvironmentMismatch");
    check(Array.isArray(additionalAccounts) && additionalAccounts.length <= 64);
    const addresses = [...deploymentAddresses(m), ...additionalAccounts];
    addresses.forEach(key); check(new Set(addresses).size === addresses.length);
    const genesis = await this.genesis();
    // One bank/context for deployment, Mint/counters and optional claim accounts.
    const v = await this.#call("getMultipleAccounts", [addresses, { commitment: "finalized", encoding: "base64", minContextSlot: Number(minimumSlot) }]);
    check(genesis === await this.genesis(), "DeploymentEndpointChangedDuringRead");
    return { genesis, slot: v?.context?.slot, accounts: v?.value };
  }
}

// Real protected service wrapper. A plain callback or config boolean cannot
// stand in for the authenticated supervisor or persistent progress store.
