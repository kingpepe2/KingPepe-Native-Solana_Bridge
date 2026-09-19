// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic public identities only. No signing, network or Mainnet transaction.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { base58Encode, base58Decode } from "../solana-deposit-claim-transaction-plan.mjs";
import { buildMainnetSolanaSetupTransactionPlan, buildMainnetModeTransactionPlan } from "../mainnet-solana-setup-plan.mjs";
import { decodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN, SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS,
  mainnetDeploymentIdentity } from "../../../shared/network-identity.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58, SYSTEM_PROGRAM_ID_BASE58 } from "../localnet-solana-setup-plan.mjs";
const h = label => createHash("sha256").update("SyntheticMainnetSetup:" + label).digest();
const k = label => base58Encode(h(label));
function fixture() {
  const keys = { manager: k("manager"), transceiver: k("transceiver"), mint: k("mint") };
  return { environment: "mainnet", cluster: "mainnet", solanaGenesis: SOLANA_MAINNET_GENESIS,
    nativeGenesisHex: NATIVE_MAINNET_GENESIS, nativeNetwork: NATIVE_MAINNET_DOMAIN, protocolId: 1,
    solanaDeploymentHex: mainnetDeploymentIdentity(keys), managerProgramIdBase58: keys.manager, transceiverProgramIdBase58: keys.transceiver,
    mintBase58: keys.mint, feePayerBase58: k("payer"), recentBlockhashBase58: k("blockhash"), lastValidBlockHeight: "91234",
    attesterPublicKeysHex: [h("attester a").toString("hex"), h("attester b").toString("hex")],
    decimals: 8, nativeDecimals: 8, policyEpoch: 1, keyEpoch: 1, mintRentLamports: "1461600" };
}
function modeInput(mode) {
  const { attesterPublicKeysHex, decimals, nativeDecimals, policyEpoch, keyEpoch, mintRentLamports, ...c } = fixture();
  return { ...c, mode };
}

test("Mainnet setup and mode bytes equal the vectors decoded by the actual Rust programs", () => {
  const vectors = readFileSync(new URL("../../../solana/modules/bridge-messages/vectors/mainnet-setup-v1.txt", import.meta.url), "utf8")
    .trim().split(/\r?\n/u);
  const plan = buildMainnetSolanaSetupTransactionPlan(fixture());
  const bytes = [plan.instructions[3], plan.instructions[2], ...["PAUSED", "CONTROLLED", "ACTIVE"]
    .map(mode => buildMainnetModeTransactionPlan(modeInput(mode)).instructions[0])];
  assert.deepEqual(bytes.map(i => Buffer.from(i.dataBase64, "base64").toString("hex")), vectors);
});
// Decode the actual legacy message, independently of the plan's descriptors.
function decodeMessage(plan) {
  const b = Buffer.from(plan.messageBase64, "base64"); let p = 0;
  const take = n => { assert(p + n <= b.length); const v = b.subarray(p, p + n); p += n; return v; };
  const short = () => { let n = 0, shift = 0, x; do { assert(shift < 21); x = take(1)[0]; n += (x & 127) * 2 ** shift; shift += 7; } while (x & 128); return n; };
  const header = [...take(3)], keys = Array.from({ length: short() }, () => base58Encode(take(32))), blockhash = base58Encode(take(32));
  const instructions = Array.from({ length: short() }, () => ({ program: keys[take(1)[0]], accounts: [...take(short())].map(i => keys[i]), data: take(short()) }));
  assert.equal(p, b.length); return { header, keys, blockhash, instructions };
}

test("Mainnet setup wire creates only an eight-decimal zero-supply Mint and paused forward configurations", () => {
  const c = fixture(), plan = buildMainnetSolanaSetupTransactionPlan(c), wire = decodeMessage(plan);
  assert.deepEqual(wire.header, [2, 0, 5]);
  assert.deepEqual(wire.keys.slice(0, 2), [c.feePayerBase58, c.mintBase58]);
  assert.equal(wire.blockhash, c.recentBlockhashBase58); assert.equal(wire.instructions.length, 4);
  const [create, mint, transceiver, bridge] = wire.instructions;
  assert.equal(create.program, SYSTEM_PROGRAM_ID_BASE58); assert.deepEqual(create.accounts, wire.keys.slice(0, 2));
  assert.equal(create.data.readUInt32LE(0), 0); assert.equal(create.data.readBigUInt64LE(4), 1461600n);
  assert.equal(create.data.readBigUInt64LE(12), 82n); assert.equal(base58Encode(create.data.subarray(20)), SPL_TOKEN_PROGRAM_ID_BASE58);
  assert.equal(mint.program, SPL_TOKEN_PROGRAM_ID_BASE58); assert.deepEqual(mint.accounts, [c.mintBase58]);
  assert.equal(mint.data.length, 35); assert.deepEqual([...mint.data.subarray(0, 2)], [20, 8]);
  assert.equal(base58Encode(mint.data.subarray(2, 34)), plan.mintAuthority); assert.equal(mint.data[34], 0);
  assert.equal(bridge.program, c.managerProgramIdBase58); assert.equal(transceiver.program, c.transceiverProgramIdBase58);
  assert.deepEqual(bridge.accounts, [plan.pdas.bridgeState, c.mintBase58, SPL_TOKEN_PROGRAM_ID_BASE58, c.feePayerBase58, SYSTEM_PROGRAM_ID_BASE58]);
  assert.deepEqual(transceiver.accounts, [plan.pdas.transceiverConfig, c.mintBase58, c.feePayerBase58, SYSTEM_PROGRAM_ID_BASE58]);
  const receiver = decodeBridgeAbi("TransceiverInitialize", transceiver.data), manager = decodeBridgeAbi("BridgeInitialize", bridge.data);
  assert.equal(receiver.config.nativeNetwork, NATIVE_MAINNET_DOMAIN); assert.equal(Buffer.from(receiver.config.nativeGenesis).toString("hex"), NATIVE_MAINNET_GENESIS);
  assert.equal(Buffer.from(receiver.config.solanaDeployment).toString("hex"), c.solanaDeploymentHex);
  assert.equal(manager.binding.environment, 2); assert.equal(base58Encode(Buffer.from(manager.binding.mint)), c.mintBase58);
  assert.deepEqual(manager.policy, { policyEpoch: 1, keyEpoch: 1, depositsPaused: true, hardStop: false, mainnetActivationEnabled: false });
  assert.equal(plan.initialSupplyAtomic, "0"); assert.equal(plan.freezeAuthority, null);
  assert.equal(plan.productionReady, false); assert.equal(plan.mainnetActivation, "DISABLED");
  assert(129 + Buffer.from(plan.messageBase64, "base64").length <= 1232);
  assert.equal(plan.preparedTransactionBase64, undefined); assert.equal(plan.signatures, undefined);
});

test("Mainnet enrollment rejects missing or substituted networks, identities, decimals and caller policy overrides", () => {
  const bad = [c => { c.environment = "devnet"; }, c => { c.cluster = "localnet"; }, c => { c.solanaGenesis = SOLANA_DEVNET_GENESIS; },
    c => { c.nativeGenesisHex = h("wrong genesis").toString("hex"); }, c => { c.nativeNetwork = 8000111; }, c => { c.protocolId = 2; },
    c => { c.managerProgramIdBase58 = k("substituted manager"); }, c => { c.transceiverProgramIdBase58 = k("substituted transceiver"); },
    c => { c.mintBase58 = k("substituted mint"); }, c => { c.solanaDeploymentHex = h("wrong deployment").toString("hex"); },
    c => { c.feePayerBase58 = c.mintBase58; }, c => { c.decimals = 9; }, c => { c.nativeDecimals = 9; },
    c => { c.attesterPublicKeysHex[1] = c.attesterPublicKeysHex[0]; }, c => { c.attesterPublicKeysHex.pop(); },
    c => { c.attesterPublicKeysHex[0] = Buffer.from(base58Decode(c.feePayerBase58)).toString("hex"); },
    c => { c.initialSupplyAtomic = "1"; }, c => { c.freezeAuthority = k("freeze"); }, c => { c.depositsPaused = false; },
    c => { c.mainnetActivationEnabled = true; }, c => { c.tokenProgramIdBase58 = k("wrong token"); },
    c => { c.recipientTokenAccountBase58 = k("test recipient"); }, c => { c.rpc = "https://example.invalid"; }];
  for (const mutate of bad) { const c = fixture(); mutate(c); assert.throws(() => buildMainnetSolanaSetupTransactionPlan(c)); }
  for (const name of Object.keys(fixture())) { const c = fixture(); delete c[name]; assert.throws(() => buildMainnetSolanaSetupTransactionPlan(c)); }
});

test("Mainnet rent and block-height encoding is integer-only, bounded, and preserves u64 precision", () => {
  const c = fixture(); c.mintRentLamports = "18446744073709551615";
  assert.equal(decodeMessage(buildMainnetSolanaSetupTransactionPlan(c)).instructions[0].data.readBigUInt64LE(4), (1n << 64n) - 1n);
  for (const name of ["mintRentLamports", "lastValidBlockHeight"]) for (const value of [0, 1000, "0", "01", "1.1", "1e6", "-1", "18446744073709551616"]) {
    assert.throws(() => buildMainnetSolanaSetupTransactionPlan({ ...fixture(), [name]: value }));
  }
  for (const name of ["policyEpoch", "keyEpoch"]) for (const value of [0, 1.5, "1", 4294967296])
    assert.throws(() => buildMainnetSolanaSetupTransactionPlan({ ...fixture(), [name]: value }));
});

test("Mainnet mode wire requires the exact Mint enrollment signature and contains no economic instruction", () => {
  for (const [mode, tag] of [["PAUSED", 0], ["CONTROLLED", 1], ["ACTIVE", 2]]) {
    const c = modeInput(mode), plan = buildMainnetModeTransactionPlan(c), wire = decodeMessage(plan);
    assert.deepEqual(wire.header, [2, 1, 1]); assert.equal(wire.instructions.length, 1);
    assert.equal(wire.instructions[0].program, c.managerProgramIdBase58);
    assert.deepEqual(wire.instructions[0].accounts, [plan.bridgeState, c.mintBase58]);
    assert.deepEqual([...wire.instructions[0].data], [4, tag]);
    assert.deepEqual(plan.requiredSigners, [c.feePayerBase58, c.mintBase58]);
    assert.equal(plan.scope, "UNSIGNED_MAINNET_PREPARATION"); assert.equal(plan.productionReady, undefined);
  }
  for (const mode of ["RUNNING", "mainnet", 1, null]) assert.throws(() => buildMainnetModeTransactionPlan(modeInput(mode)));
  assert.throws(() => buildMainnetModeTransactionPlan({ ...modeInput("ACTIVE"), amountAtomic: "1" }));
  assert.throws(() => buildMainnetModeTransactionPlan({ ...modeInput("ACTIVE"), cluster: "devnet" }));
});

test("changing the caller's public configuration cannot mutate prepared Mainnet bytes", () => {
  const c = fixture(), plan = buildMainnetSolanaSetupTransactionPlan(c), before = JSON.stringify(plan);
  c.attesterPublicKeysHex[0] = h("changed signer").toString("hex"); c.mintBase58 = k("changed mint");
  assert.equal(JSON.stringify(plan), before); assert(Object.isFrozen(plan)); assert(Object.isFrozen(plan.instructions));
  assert.throws(() => { plan.instructions[0].accountIndexes[0] = 8; });
});
