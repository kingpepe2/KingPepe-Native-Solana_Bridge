// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { base58Decode, base58Encode, findProgramAddress } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN } from "../bridge-validator/localnet-solana-setup-plan.mjs";
import { requireIntegrityGuard } from "../supervisor/protected-integrity.mjs";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";

export const DEPLOYMENT_MONITOR_PROTOCOL = "KINGPEPE_DEPLOYMENT_MONITOR_V2";
export const LEGACY_LOADER = "BPFLoader2111111111111111111111111111111111";
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const MAX_PROGRAM_BYTES = 2_097_152, MAX_RESPONSE_BYTES = 8_388_608;
const HASH = /^[0-9a-f]{64}$/u;
const fail = code => { throw new Error(code); };
const check = (ok, code = "DeploymentInputRejected") => { if (!ok) fail(code); };
export const deploymentDigest = bytes => createHash("sha256").update(bytes).digest("hex");
function keys(v, names) { check(v && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join()); }
function hash(v) { check(typeof v === "string" && HASH.test(v)); return v; }
function uint(v) { check(typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(v) && BigInt(v) <= 0xffff_ffff_ffff_ffffn); return BigInt(v); }
function key(v) { check(typeof v === "string" && v.length >= 32 && v.length <= 44); const bytes = base58Decode(v); check(bytes.length === 32 && base58Encode(bytes) === v); return bytes; }
function bounded(v, max) { check(Number.isSafeInteger(v) && v >= 0 && v <= max); return v; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(bounded(v, 0xffff_ffff)); return b; }
function immutable(value) { for (const v of Object.values(value)) if (v && typeof v === "object") immutable(v); return Object.freeze(value); }
function canonical(v) { if (Array.isArray(v)) return v.map(canonical); if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])); return v; }

// A supplied, reviewed manifest is mandatory. This never learns/approves an
// arbitrary deployment from the RPC response. No production default is offered.
export function validateDeploymentManifest(input) {
  const m = structuredClone(input);
  keys(m, ["protocol", "environment", "sourceSha", "identityVersion", "nativeGenesisHex", "solanaGenesis", "solanaDeploymentHex", "minimumSlot", "maximumStallMs", "manager", "transceiver", "mint", "config"]);
  check(m.protocol === DEPLOYMENT_MONITOR_PROTOCOL && m.environment === "localnet");
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
  keys(m.config, ["bridgePda", "transceiverPda", "policyEpoch", "keyEpoch", "protocolId", "nativeNetwork", "attesters", "depositsPaused", "withdrawalsPaused", "transceiverActive"]);
  check(m.config.bridgePda === findProgramAddress([Buffer.from("kingpepe-bridge-state"), key(m.mint.id)], key(m.manager.id)).base58);
  check(m.config.transceiverPda === findProgramAddress([Buffer.from("kingpepe-transceiver-config"), key(m.mint.id)], key(m.transceiver.id)).base58);
  for (const name of ["policyEpoch", "keyEpoch", "protocolId", "nativeNetwork"]) bounded(m.config[name], 0xffff_ffff);
  for (const name of ["depositsPaused", "withdrawalsPaused", "transceiverActive"]) check(typeof m.config[name] === "boolean");
  check(Array.isArray(m.config.attesters) && m.config.attesters.length === 2 && m.config.attesters[0] !== m.config.attesters[1]);
  m.config.attesters.forEach(key);
  const addresses = deploymentAddresses(m); check(new Set(addresses).size === addresses.length);
  return immutable(canonical(m));
}
export function deploymentManifestDigest(manifest) { return deploymentDigest(Buffer.from(JSON.stringify(validateDeploymentManifest(manifest)))); }
export function deploymentAddresses(m) { return [m.manager.id, m.transceiver.id, m.mint.id, m.config.bridgePda, m.config.transceiverPda,
  ...[m.manager, m.transceiver].filter(p => p.programData !== null).map(p => p.programData)]; }

function expectedConfig(m) {
  const c = m.config, h = v => Buffer.from(v, "hex");
  // Exactly the existing Rust account codec, excluding only the two mutable
  // economic u128 counters in Manager state. Neither counter is an authority.
  const bridge = Buffer.concat([Buffer.from("KPBSTAT1"), Buffer.from([1, 2, 0]), key(m.manager.id), key(m.transceiver.id),
    h(m.solanaDeploymentHex), key(m.mint.id), key(TOKEN), key(m.mint.authority), Buffer.from([m.mint.decimals, m.mint.decimals, 0]),
    Buffer.alloc(32 + 16), u32(c.policyEpoch), u32(c.keyEpoch), Buffer.from([Number(c.depositsPaused), Number(c.withdrawalsPaused), 0, 0])]);
  const transceiver = Buffer.concat([Buffer.from("KPTCFG02"), Buffer.from([1]), key(m.transceiver.id), key(m.manager.id), key(m.mint.id),
    h(m.solanaDeploymentHex), u32(c.protocolId), u32(c.nativeNetwork), h(m.nativeGenesisHex), ...c.attesters.map(key),
    Buffer.from([Number(c.transceiverActive)]), u32(c.keyEpoch)]);
  check(bridge.length === 266 && transceiver.length === 246); return { bridge, transceiver };
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
  if (bridge.owner !== m.manager.id || bridge.executable || bridgeBytes.length !== 298 || !bridgeBytes.subarray(0, 266).equals(expected.bridge)) different("SOLANA_DEPLOYMENT_CHANGED", bridge, "BRIDGE_CONFIGURATION");
  if (transceiver.owner !== m.transceiver.id || transceiver.executable || !transceiverBytes.equals(expected.transceiver)) different("SOLANA_DEPLOYMENT_CHANGED", transceiver, "TRANSCEIVER_CONFIGURATION");
  const u128 = (b, offset) => (b.readBigUInt64LE(offset) + (b.readBigUInt64LE(offset + 8) << 64n)).toString();
  return Object.freeze({ protocol: DEPLOYMENT_MONITOR_PROTOCOL, trust: "RPC_OBSERVATION", slot: String(snapshot.slot),
    genesis: snapshot.genesis, manifestDigest: deploymentManifestDigest(m), snapshotDigest: deploymentDigest(Buffer.from(JSON.stringify(canonical(snapshot)))),
    mintSupplyAtomic: mintBytes.readBigUInt64LE(36).toString(), managerMintedAtomic: u128(bridgeBytes, 266), burnedUnpaidAtomic: u128(bridgeBytes, 282) });
}

export class LocalDeploymentRpc {
  #endpoint; #id = 0;
  constructor({ endpoint }) {
    const u = new URL(endpoint);
    check(u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port && Number(u.port) >= 1024 && u.pathname === "/" && !u.username && !u.password && !u.search && !u.hash, "DeploymentLocalEndpointRequired");
    this.#endpoint = u.href;
  }
  async #call(method, params) {
    const id = ++this.#id;
    try {
      const response = await fetch(this.#endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      check(response.ok && response.body, "DeploymentSourceUnavailable");
      const reader = response.body.getReader(); let size = 0; const parts = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; check(size <= MAX_RESPONSE_BYTES, "DeploymentResponseLimit"); parts.push(value); } }
      finally { await reader.cancel(); }
      const v = JSON.parse(Buffer.concat(parts).toString("utf8"));
      check(v?.jsonrpc === "2.0" && v.id === id && Object.hasOwn(v, "result") && !Object.hasOwn(v, "error"), "DeploymentSourceUnavailable"); return v.result;
    } catch { fail("DeploymentSourceUnavailable"); }
  }
  async genesis() { const result = await this.#call("getGenesisHash", []); key(result); return result; }
  async finalizedTransaction(signature) {
    check(typeof signature === "string" && signature.length <= 88 && base58Decode(signature).length === 64, "DeploymentTransactionSignatureRejected");
    return this.#call("getTransaction", [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
  }
  async withdrawalRecordAccounts(manifest) {
    const m = validateDeploymentManifest(manifest);
    const v = await this.#call("getProgramAccounts", [m.manager.id, { commitment: "finalized", encoding: "base64", withContext: true,
      filters: [{ dataSize: 283 }, { memcmp: { offset: 0, bytes: base58Encode(Buffer.from("KPBWDR01")) } }] }]);
    check(Number.isSafeInteger(v?.context?.slot) && BigInt(v.context.slot) >= uint(m.minimumSlot) && Array.isArray(v.value) && v.value.length <= 256, "WithdrawalDiscoveryUnavailable");
    check(new Set(v.value.map(a => a?.pubkey)).size === v.value.length, "WithdrawalDiscoveryMalformed");
    return v.value.map(v => {
      key(v.pubkey); const bytes = accountData(v.account);
      check(v.account.owner === m.manager.id && !v.account.executable && bytes.length === 283 && bytes.subarray(0, 8).toString() === "KPBWDR01" && bytes[8] === 1, "WithdrawalDiscoveryMalformed");
      return { address: v.pubkey, data: bytes };
    });
  }
  async finalizedSignatures(address) {
    key(address);
    const v = await this.#call("getSignaturesForAddress", [address, { commitment: "finalized", limit: 64 }]);
    check(Array.isArray(v) && v.length <= 64, "WithdrawalDiscoveryUnavailable");
    for (const r of v) check(typeof r?.signature === "string" && r.signature.length <= 88 && base58Decode(r.signature).length === 64 &&
      Number.isSafeInteger(r.slot) && r.slot >= 0 && Object.hasOwn(r, "err"), "WithdrawalDiscoveryMalformed");
    return v.filter(r => r.err === null).map(r => r.signature);
  }
  async snapshot(manifest, minimumSlot = manifest.minimumSlot) {
    return this.snapshotWithAdditionalAccounts(manifest, [], minimumSlot);
  }
  async snapshotWithAdditionalAccounts(manifest, additionalAccounts, minimumSlot = manifest.minimumSlot) {
    const m = validateDeploymentManifest(manifest); check(uint(minimumSlot) <= BigInt(Number.MAX_SAFE_INTEGER));
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
export class ProtectedSolanaDeploymentMonitor {
  #manifest; #rpc; #guard; #store; #lease; #busy = false; #closed = false; #digest; #stopped = false;
  static async open({ manifest, rpc, integrity, store }) {
    const self = new ProtectedSolanaDeploymentMonitor(); self.#manifest = validateDeploymentManifest(manifest);
    requireIntegrityGuard(integrity, "SOLANA_OBSERVER"); check(rpc instanceof LocalDeploymentRpc);
    assertWindowsProtectedStore(store, "SOLANA_OBSERVER", "chain-progress");
    integrity.assertDeployment({ environment: "localnet", nativeGenesis: self.#manifest.nativeGenesisHex, solanaDeployment: self.#manifest.solanaDeploymentHex, keyEpoch: self.#manifest.config.keyEpoch });
    check(store.context.environment === "localnet" && store.context.nativeGenesis === self.#manifest.nativeGenesisHex && store.context.solanaDeployment === self.#manifest.solanaDeploymentHex && store.context.keyEpoch === self.#manifest.config.keyEpoch);
    self.#digest = deploymentManifestDigest(self.#manifest); self.#guard = integrity; self.#rpc = rpc; self.#store = store;
    try { self.#lease = await store.acquireLease(); self.#progress(); return self; }
    catch (error) {
      try { if (error.integrityCode === "SOLANA_PROGRESS_INTEGRITY") await integrity.report(self.#digest, error.integrityCode, error.evidenceDigest); }
      finally { await self.close(); }
      fail("DeploymentProgressUnavailable");
    }
  }
  static initialProgress(manifest) {
    const m = validateDeploymentManifest(manifest);
    return Buffer.from(JSON.stringify({ protocol: DEPLOYMENT_MONITOR_PROTOCOL, manifestDigest: deploymentManifestDigest(m), genesis: m.solanaGenesis, minimumSlot: m.minimumSlot, observedAt: 0, lastAdvanceAt: 0, snapshotDigest: null }));
  }
  #progress() {
    check(!this.#closed && this.#lease, "DeploymentProgressUnavailable"); this.#lease.assertHeld();
    let r;
    try { r = this.#store.read(); } catch (error) {
      if (error.message === "ProtectedStateRollbackDetected") different("SOLANA_PROGRESS_INTEGRITY", { reason: "RETAINED_REVISION_ROLLBACK" }); throw error;
    }
    let v;
    try {
    v = JSON.parse(r.payload.toString("utf8"));
    keys(v, ["protocol", "manifestDigest", "genesis", "minimumSlot", "observedAt", "lastAdvanceAt", "snapshotDigest"]);
    check(v.protocol === DEPLOYMENT_MONITOR_PROTOCOL && v.manifestDigest === this.#digest && v.genesis === this.#manifest.solanaGenesis && uint(v.minimumSlot) >= uint(this.#manifest.minimumSlot), "DeploymentProgressRollback");
    check(Number.isSafeInteger(v.observedAt) && v.observedAt <= Date.now() && v.observedAt >= 0, "DeploymentClockRollback");
    check(Number.isSafeInteger(v.lastAdvanceAt) && v.lastAdvanceAt >= 0 && v.lastAdvanceAt <= v.observedAt, "DeploymentClockRollback");
    check(v.snapshotDigest === null || HASH.test(v.snapshotDigest)); return { value: v, revision: r.revision };
    } catch { different("SOLANA_PROGRESS_INTEGRITY", { authenticatedPayloadDigest: deploymentDigest(r.payload) }); }
    finally { r.payload.fill(0); }
  }
  async poll() {
    check(!this.#busy && !this.#closed, "DeploymentMonitorUnavailable"); this.#busy = true;
    let ticket;
    try {
      const old = this.#progress(); ticket = await this.#guard.beginSourceCheck(this.#digest);
      const snapshot = await this.#rpc.snapshot(this.#manifest, old.value.minimumSlot);
      const result = verifyDeploymentSnapshot(this.#manifest, snapshot);
      check(uint(result.slot) >= uint(old.value.minimumSlot), "DeploymentSourceStale");
      if (old.value.snapshotDigest !== null && result.slot === old.value.minimumSlot && old.value.snapshotDigest !== result.snapshotDigest) different("FINALIZED_SOLANA_CONFLICT", { prior: old.value.snapshotDigest, next: result.snapshotDigest, slot: result.slot });
      const lastAdvanceAt = old.value.snapshotDigest === null || uint(result.slot) > uint(old.value.minimumSlot) ? Date.now() : old.value.lastAdvanceAt;
      check(Date.now() - lastAdvanceAt <= this.#manifest.maximumStallMs, "DeploymentSourceStale");
      const bytes = Buffer.from(JSON.stringify({ ...old.value, minimumSlot: result.slot, observedAt: Date.now(), lastAdvanceAt, snapshotDigest: result.snapshotDigest }));
      try { this.#lease.assertHeld(); this.#store.write(bytes, old.revision); } finally { bytes.fill(0); }
      const global = await this.#guard.finishSourceCheck(ticket, { state: "OBSERVED_MATCH", evidenceDigest: result.snapshotDigest }); ticket = undefined;
      if (global.state === "HARD_STOP_INTEGRITY") this.#stopped = true;
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "OBSERVED_MATCH", ...result });
    } catch (error) {
      if (["SOLANA_GENESIS_CHANGED", "SOLANA_DEPLOYMENT_CHANGED", "FINALIZED_SOLANA_CONFLICT", "SOLANA_PROGRESS_INTEGRITY"].includes(error?.integrityCode)) {
        this.#stopped = true;
        await this.#guard.report(this.#digest, error.integrityCode, error.evidenceDigest);
        return Object.freeze({ state: "HARD_STOP_INTEGRITY", reason: error.integrityCode });
      }
      // Malformed/outage/stale observations suspend authorization; they are not
      // fabricated accounting deficits or acknowledged durable incidents.
      if (ticket) {
        try { await this.#guard.finishSourceCheck(ticket, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: this.#digest }); } catch { /* No health permission is renewed by a failed report. */ }
      }
      return Object.freeze({ state: this.#stopped ? "HARD_STOP_INTEGRITY" : "WAITING_FOR_DEPENDENCY", reason: "DEPLOYMENT_OBSERVATION_UNAVAILABLE" });
    } finally { this.#busy = false; }
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isSafeInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 30000);
    while (!signal.aborted && !this.#closed) { await onStatus(await this.poll()); try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) fail("DeploymentMonitorInterrupted"); } }
  }
  async close() { this.#closed = true; await this.#lease?.close(); this.#store?.close(); }
}
