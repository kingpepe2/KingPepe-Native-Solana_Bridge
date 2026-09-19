// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Bounded RPC fixtures, not real-chain evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { BridgeUserBalances } from "../user-balances.mjs";
import { NativeRpcClient } from "../../../native/node/native-rpc-client.mjs";
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";
import { witnessAddressFromScript } from "../../../native/node/witness-address.mjs";
import { LocalDeploymentRpc } from "../../solana-observer/deployment-integrity.mjs";
import { deploymentFixture, mainnetDeploymentFixture } from "../../../tests/integration/deployment-fixture.mjs";
import { DEVNET_SOLANA_GENESIS } from "../../../shared/solana-test-network.mjs";
import { NATIVE_MAINNET_GENESIS, SOLANA_MAINNET_GENESIS } from "../../../shared/network-identity.mjs";
import { base58Encode, base58Decode } from "../solana-deposit-claim-transaction-plan.mjs";
const key = n => base58Encode(Buffer.alloc(32, n)), hash = "12".repeat(32), address = key(22), tokenAddress = key(23);
const nativeAddress = witnessAddressFromScript("0014" + "13".repeat(20));
function fixture(t, mainnet = false) {
  const { manifest, snapshot } = mainnet ? mainnetDeploymentFixture() : deploymentFixture();
  const lookupAddress = mainnet ? witnessAddressFromScript("0014" + "13".repeat(20), "kpepe") : nativeAddress;
  if (!mainnet) {
    manifest.environment = "devnet"; manifest.solanaGenesis = DEVNET_SOLANA_GENESIS; manifest.config.nativeNetwork = 8000111;
    snapshot.genesis = DEVNET_SOLANA_GENESIS;
    const bridge = Buffer.from(snapshot.accounts[3].data[0], "base64"); bridge[9] = 3; bridge[10] = 1; snapshot.accounts[3].data[0] = bridge.toString("base64");
    const transceiver = Buffer.from(snapshot.accounts[4].data[0], "base64"); transceiver.writeUInt32LE(8000111, 141); snapshot.accounts[4].data[0] = transceiver.toString("base64");
  }
  const bytes = Buffer.alloc(165); Buffer.from(base58Decode(manifest.mint.id)).copy(bytes); Buffer.from(base58Decode(address)).copy(bytes, 32);
  bytes.writeBigUInt64LE(9007199254740993n, 64); bytes[108] = 1;
  const token = { owner: manifest.mint.tokenProgram, executable: false, data: [bytes.toString("base64"), "base64"] };
  const state = { time: 10000, calls: [], chain: mainnet ? "main" : "regtest", genesis: manifest.nativeGenesisHex, best: hash, scanBest: hash, amount: "90071992.54740993",
    solanaGenesis: manifest.solanaGenesis, lamports: 1234567891, token, addresses: [tokenAddress], snapshot, scanSuccess: true };
  const native = new NativeRpcClient({ fetchFn: async (_url, options) => {
    const r = JSON.parse(options.body); state.calls.push(r);
    if (r.method === "scantxoutset") {
      assert.deepEqual(r.params, ["start", [{ desc: `addr(${lookupAddress})` }]]);
      if (state.changeNativeAfterScan) state.genesis = REGTEST_GENESIS;
      return new Response(`{"id":${r.id},"error":null,"result":{"success":${state.scanSuccess},"bestblock":"${state.scanBest}","total_amount":${state.amount}}}`);
    }
    const result = r.method === "getblockchaininfo" ? { chain: state.chain, bestblockhash: state.best, blocks: 10, headers: 10, chainwork: "12", initialblockdownload: false } : state.genesis;
    assert(["getblockchaininfo", "getblockhash"].includes(r.method)); return Response.json({ id: r.id, result, error: null });
  } });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const r = JSON.parse(options.body); state.calls.push(r); let result;
    if (r.method === "getGenesisHash") result = state.solanaGenesis;
    else if (r.method === "getTokenAccountsByOwner") {
      assert.equal(r.params[0], address); assert.deepEqual(r.params[1], { mint: manifest.mint.id }); assert.equal(r.params[2].commitment, "finalized");
      result = { context: { slot: 10 }, value: state.addresses.map(pubkey => ({ pubkey })) };
    } else {
      assert.equal(r.method, "getMultipleAccounts"); assert.equal(r.params[1].commitment, "finalized");
      result = { context: { slot: state.snapshot.slot }, value: [...state.snapshot.accounts,
        { owner: "11111111111111111111111111111111", executable: false, lamports: state.lamports }, ...state.addresses.map(() => state.token)] };
    }
    return Response.json({ jsonrpc: "2.0", id: r.id, result });
  });
  const solana = mainnet ? LocalDeploymentRpc.createMainnet({ endpoint: "https://mainnet.invalid/", expectedGenesis: SOLANA_MAINNET_GENESIS }) :
    new LocalDeploymentRpc({ endpoint: "https://devnet.invalid/", environment: "devnet", expectedGenesis: DEVNET_SOLANA_GENESIS });
  const options = { nativeRpc: native, solanaRpc: solana, manifest, now: () => state.time };
  const reader = mainnet ? BridgeUserBalances.createMainnet(options) : new BridgeUserBalances(options);
  return { state, reader, native, manifest, solana, options, nativeAddress: lookupAddress };
}
test("read-only balances bind configured Devnet Mint, owner and exact u64 token units", async t => {
  const f = fixture(t), b = await f.reader.read("solana", address);
  assert.equal(b.solLamports, "1234567891"); assert.equal(b.kpepeAtomic, "9007199254740993"); assert.equal(b.mint, f.manifest.mint.id);
  assert.equal(b.chain, "solana:devnet"); assert.equal(b.tokenAccounts[0].address, tokenAddress);
  assert(!f.state.calls.some(c => /send|sign|mint|burn|stop/iu.test(c.method)));
  const count = f.state.calls.length; b.tokenAccounts.length = 0;
  assert.equal((await f.reader.read("solana", address)).tokenAccounts.length, 1); assert.equal(f.state.calls.length, count);
});
test("REGTEST lookup keeps JSON amount lexemes exact and only returns confirmed public balance", async t => {
  const f = fixture(t); assert.equal((await f.reader.read("native", nativeAddress)).amountAtomic, "9007199254740993");
  for (const [amount, expected] of [["0.00000000", "0"], ["0.00000001", "1"], ["184467440737.09551615", "18446744073709551615"]]) {
    f.state.time += 21000; f.state.amount = amount; assert.equal((await f.reader.read("native", nativeAddress)).amountAtomic, expected);
  }
  for (const amount of ["-1", "1e8", "0.000000001", "184467440737.09551616"]) {
    f.state.time += 21000; f.state.amount = amount; await assert.rejects(f.reader.read("native", nativeAddress));
  }
});
for (const [name, change] of [
  ["wrong Native network", s => { s.chain = "main"; }], ["wrong Native genesis", s => { s.genesis = "11".repeat(32); }],
  ["scan tip changed", s => { s.scanBest = "11".repeat(32); }], ["incomplete scan", s => { s.scanSuccess = false; }],
]) test("balance rejects " + name, async t => { const f = fixture(t); change(f.state); await assert.rejects(f.reader.read("native", nativeAddress)); });
for (const mainnet of [false, true]) for (const [name, change] of [
  ["wrong Solana genesis", s => { s.solanaGenesis = key(99); }], ["wrong account.owner", s => { s.token.owner = key(99); }],
  ["wrong Mint", s => { const b = Buffer.from(s.token.data[0], "base64"); b[0] ^= 1; s.token.data[0] = b.toString("base64"); }],
  ["wrong token authority", s => { const b = Buffer.from(s.token.data[0], "base64"); b[32] ^= 1; s.token.data[0] = b.toString("base64"); }],
  ["frozen token", s => { const b = Buffer.from(s.token.data[0], "base64"); b[108] = 2; s.token.data[0] = b.toString("base64"); }],
  ["unsafe SOL integer", s => { s.lamports = Number.MAX_SAFE_INTEGER + 1; }],
  ["duplicate discovery", s => { s.addresses.push(tokenAddress); }], ["excessive discovery", s => { s.addresses = Array.from({ length: 17 }, (_, i) => key(i + 30)); }],
  ["stale bank", s => { s.snapshot.slot = 0; }],
]) test((mainnet ? "Mainnet " : "") + "balance rejects " + name, async t => { const f = fixture(t, mainnet); change(f.state); await assert.rejects(f.reader.read("solana", address)); });
test("missing token account is explicit, and burst/network/address overrides fail closed", async t => {
  const f = fixture(t); f.state.addresses = [];
  assert.deepEqual((await f.reader.read("solana", address)).tokenAccounts, []);
  await assert.rejects(f.reader.read("native", nativeAddress)); // Global bounded request interval.
  for (const [network, target] of [["mainnet", address], ["native", witnessAddressFromScript("0014" + "13".repeat(20), "kpepe")], ["solana", "../status"]])
    await assert.rejects(f.reader.read(network, target));
  assert.throws(() => new BridgeUserBalances({ nativeRpc: f.native, solanaRpc: f.solana, manifest: { ...f.manifest, environment: "localnet" } }));
});
test("balance reader binds the same deployment/program/policy as the user-operation service", t => {
  const f = fixture(t), m = f.manifest, hex = key => Buffer.from(base58Decode(key)).toString("hex");
  const policy = { environment: "devnet", nativeGenesis: m.nativeGenesisHex, solanaGenesis: m.solanaGenesis, solanaDeployment: m.solanaDeploymentHex,
    mint: hex(m.mint.id), managerProgramId: hex(m.manager.id), transceiverProgramId: hex(m.transceiver.id),
    ...Object.fromEntries(["protocolId", "nativeNetwork", "keyEpoch", "policyEpoch"].map(key => [key, m.config[key]])) };
  f.reader.assertPolicy(policy);
  for (const [key, value] of Object.entries(policy)) assert.throws(() => f.reader.assertPolicy({ ...policy, [key]: typeof value === "number" ? value + 1 : "changed" }));
});

test("explicit Mainnet balance reader verifies both networks, exact Mint and paused deployment without signing", async t => {
  const f = fixture(t, true);
  assert.throws(() => new BridgeUserBalances(f.options));
  assert.throws(() => BridgeUserBalances.createMainnet({ ...f.options, manifest: { ...f.manifest, solanaGenesis: DEVNET_SOLANA_GENESIS } }));
  assert.throws(() => BridgeUserBalances.createMainnet({ ...f.options, solanaRpc: new LocalDeploymentRpc({
    endpoint: "https://devnet.invalid/", environment: "devnet", expectedGenesis: DEVNET_SOLANA_GENESIS }) }));
  const s = await f.reader.read("solana", address);
  assert.equal(s.chain, "solana:mainnet"); assert.equal(s.mint, f.manifest.mint.id);
  assert.equal(s.kpepeAtomic, "9007199254740993"); assert.equal(s.solLamports, "1234567891");
  f.state.time += 21000;
  assert.deepEqual(await f.reader.read("native", f.nativeAddress), { address: f.nativeAddress, network: "MAINNET", decimals: 8,
    amountAtomic: "9007199254740993", kind: "CONFIRMED_UTXO" });
  assert(!f.state.calls.some(c => /send|sign|mint|burn|stop/iu.test(c.method)));
  await assert.rejects(f.reader.read("native", nativeAddress));
  await assert.rejects(f.native.scanAddressBalance(f.nativeAddress));
  const m = f.manifest, hex = key => Buffer.from(base58Decode(key)).toString("hex");
  const p = { environment: "mainnet", nativeGenesis: m.nativeGenesisHex, solanaGenesis: m.solanaGenesis, solanaDeployment: m.solanaDeploymentHex,
    mint: hex(m.mint.id), managerProgramId: hex(m.manager.id), transceiverProgramId: hex(m.transceiver.id),
    ...Object.fromEntries(["protocolId", "nativeNetwork", "keyEpoch", "policyEpoch"].map(k => [k, m.config[k]])) };
  f.reader.assertPolicy(p);
  for (const [k, v] of Object.entries(p)) assert.throws(() => f.reader.assertPolicy({ ...p, [k]: typeof v === "number" ? v + 1 : "changed" }));
});

for (const [name, change] of [
  ["REGTEST chain", s => { s.chain = "regtest"; }], ["REGTEST genesis", s => { s.genesis = REGTEST_GENESIS; }],
  ["genesis changed during scan", s => { s.changeNativeAfterScan = true; }], ["unstable tip", s => { s.scanBest = "11".repeat(32); }],
  ["incomplete scan", s => { s.scanSuccess = false; }], ["nonexact amount", s => { s.amount = "0.000000001"; }],
]) test("Mainnet public Native balance rejects " + name, async t => {
  const f = fixture(t, true); assert.equal(f.state.genesis, NATIVE_MAINNET_GENESIS); change(f.state);
  await assert.rejects(f.reader.read("native", f.nativeAddress));
});
