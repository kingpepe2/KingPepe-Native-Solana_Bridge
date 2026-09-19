// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Informational public balances only. No journal, wallet signing or RPC forwarding.
import { NativeRpcClient, SOURCE_READY } from "../../native/node/native-rpc-client.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { scriptFromWitnessAddress } from "../../native/node/witness-address.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot } from "../solana-observer/deployment-integrity.mjs";
import { base58Decode } from "./solana-deposit-claim-transaction-plan.mjs";
import { publicKey } from "../../solana/ts/sdk/bridge.mjs";
import { DEVNET_SOLANA_GENESIS } from "../../shared/solana-test-network.mjs";
const check = value => { if (!value) throw new Error("UserBalanceUnavailable"); };
export class BridgeUserBalances {
  #native; #solana; #manifest; #cache = new Map(); #busy = false; #now; #nextRead = 0;
  constructor({ nativeRpc, solanaRpc, manifest, now = Date.now }) {
    check(nativeRpc instanceof NativeRpcClient && solanaRpc instanceof LocalDeploymentRpc && typeof now === "function");
    const m = validateDeploymentManifest(manifest);
    check(m.environment === "devnet" && m.solanaGenesis === DEVNET_SOLANA_GENESIS && m.nativeGenesisHex === REGTEST_GENESIS);
    this.#native = nativeRpc; this.#solana = solanaRpc; this.#manifest = m; this.#now = now;
  }
  assertPolicy(policy) {
    const hex = key => Buffer.from(base58Decode(key)).toString("hex"), m = this.#manifest;
    check(policy.environment === "devnet" && policy.nativeGenesis === this.#manifest.nativeGenesisHex &&
      policy.solanaGenesis === this.#manifest.solanaGenesis && policy.solanaDeployment === this.#manifest.solanaDeploymentHex &&
      policy.mint === hex(m.mint.id) && policy.managerProgramId === hex(m.manager.id) && policy.transceiverProgramId === hex(m.transceiver.id) &&
      ["protocolId", "nativeNetwork", "keyEpoch", "policyEpoch"].every(key => policy[key] === m.config[key]));
  }
  async read(network, address) {
    check(network === "solana" || network === "native");
    if (network === "solana") publicKey(address); else { scriptFromWitnessAddress(address); address = address.toLowerCase(); }
    const key = network + ":" + address, time = this.#now(), cached = this.#cache.get(key);
    if (cached && time >= cached.time && time - cached.time < 20000) return structuredClone(cached.value);
    // One bounded lookup at a time, including after a caller times out. No
    // unbounded scan queue or repeated public-triggered UTXO scans.
    check(!this.#busy && time >= this.#nextRead); this.#busy = true; this.#nextRead = time + 1000;
    try {
      const value = network === "solana" ? await this.#readSolana(address) : await this.#readNative(address);
      if (this.#cache.size >= 128) this.#cache.delete(this.#cache.keys().next().value);
      this.#cache.set(key, { time: this.#now(), value }); return structuredClone(value);
    } finally { this.#busy = false; }
  }
  async #readNative(address) {
    const observe = () => this.#native.getSourceSnapshot({ expectedNetwork: "regtest", expectedGenesisHash: REGTEST_GENESIS });
    const before = await observe(); check(before.state === SOURCE_READY);
    const balance = await this.#native.scanAddressBalance(address), after = await observe();
    check(after.state === SOURCE_READY && before.bestHash === after.bestHash && balance.bestBlockHash === after.bestHash);
    return { address, network: "REGTEST", decimals: 8, amountAtomic: balance.amountAtomic, kind: "CONFIRMED_UTXO" };
  }
  async #readSolana(address) {
    const m = this.#manifest, discovered = await this.#solana.finalizedUserTokenAddresses(m, address);
    const snapshot = await this.#solana.snapshotWithAdditionalAccounts(m, [address, ...discovered.addresses], discovered.slot);
    const offset = 1 + discovered.addresses.length;
    check(Array.isArray(snapshot.accounts) && snapshot.accounts.length > offset);
    verifyDeploymentSnapshot(m, { ...snapshot, accounts: snapshot.accounts.slice(0, -offset) });
    const wallet = snapshot.accounts.at(-offset), lamports = wallet?.lamports ?? (wallet === null ? 0 : undefined);
    check(Number.isSafeInteger(lamports) && lamports >= 0 && (!wallet || wallet.executable === false));
    let total = 0n;
    const tokenAccounts = discovered.addresses.map((tokenAddress, i) => {
      const a = snapshot.accounts[snapshot.accounts.length - discovered.addresses.length + i];
      check(a?.owner === m.mint.tokenProgram && a.executable === false && Array.isArray(a.data) &&
        a.data.length === 2 && a.data[1] === "base64" && typeof a.data[0] === "string" && a.data[0].length === 220);
      const bytes = Buffer.from(a.data[0], "base64");
      check(bytes.length === 165 && bytes.toString("base64") === a.data[0] && bytes[108] === 1 &&
        bytes.subarray(0, 32).equals(Buffer.from(base58Decode(m.mint.id))) && bytes.subarray(32, 64).equals(Buffer.from(base58Decode(address))));
      const amount = bytes.readBigUInt64LE(64); total += amount; check(total <= 0xffffffffffffffffn);
      return { address: tokenAddress, amountAtomic: amount.toString() };
    });
    return { address, chain: "solana:devnet", mint: m.mint.id, decimals: 8, solLamports: BigInt(lamports).toString(),
      kpepeAtomic: total.toString(), tokenAccounts, commitment: "finalized" };
  }
}
