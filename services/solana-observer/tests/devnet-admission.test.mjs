// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEVNET_SOLANA_GENESIS, isTestSolanaCluster, devnetRpcEndpoint } from "../../../shared/solana-test-network.mjs";
import { SolanaLocalRpcClient, sanitizedRpcDiagnostic } from "../../bridge-validator/solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimRpcClient } from "../solana-deposit-claim-observer.mjs";
import { LocalDeploymentRpc, devnetTestManifest, validateDeploymentManifest, verifyDeploymentSnapshot } from "../deployment-integrity.mjs";
import { deploymentFixture } from "../../../tests/integration/deployment-fixture.mjs";
import { FinalizedWithdrawalReader, requireFinalizedWithdrawal } from "../finalized-withdrawal.mjs";
import { base58Encode, base58Decode } from "../../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { encodeBridgeAbi, paddedDestination } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { deriveWithdrawalRecordPdaHex } from "../solana-withdrawal-observer.mjs";

const endpoint = "https://rpc.example.invalid/configured-locally";
const options = { endpoint, environment: "devnet", expectedGenesis: DEVNET_SOLANA_GENESIS };

test("Devnet transport is explicit, HTTPS and genesis-bound; local defaults and Mainnet remain closed", () => {
  for (const Client of [SolanaLocalRpcClient, SolanaDepositClaimRpcClient, LocalDeploymentRpc]) {
    assert.throws(() => new Client({ endpoint }));
    assert.doesNotThrow(() => new Client(options));
    for (const change of [{ environment: "mainnet" }, { expectedGenesis: undefined }, { expectedGenesis: "wrong-network" },
      { endpoint: "http://rpc.example.invalid/" }, { endpoint: "https://rpc.example.invalid/#fragment" }]) {
      assert.throws(() => new Client({ ...options, ...change }));
    }
  }
  assert(isTestSolanaCluster({}));
  assert(isTestSolanaCluster({ environment: "devnet", cluster: "devnet", solanaGenesis: DEVNET_SOLANA_GENESIS }));
  for (const value of [{ environment: "devnet", cluster: "devnet" }, { environment: "localnet", cluster: "devnet" },
    { environment: "mainnet", cluster: "mainnet", solanaGenesis: DEVNET_SOLANA_GENESIS }]) assert(!isTestSolanaCluster(value));
  assert.throws(() => devnetRpcEndpoint("invalid-private-endpoint", DEVNET_SOLANA_GENESIS),
    e => e.message === "DevnetRpcEndpointRejected" && !String(e.stack).includes("invalid-private-endpoint"));
});

test("every Devnet send checks actual genesis, including direct calls, retries and changed endpoints", async () => {
  let genesis = DEVNET_SOLANA_GENESIS; const calls = [];
  const rpc = new SolanaLocalRpcClient({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, endpoint); assert.equal(init.redirect, "error");
    const input = JSON.parse(init.body); calls.push(input.method);
    return Response.json({ jsonrpc: "2.0", id: input.id, result: input.method === "getGenesisHash" ? genesis : "submitted" });
  } });
  await rpc.call("sendTransaction", ["test-packet"]);
  await rpc.call("sendTransaction", ["same-test-packet"]);
  assert.deepEqual(calls, ["getGenesisHash", "sendTransaction", "getGenesisHash", "sendTransaction"]);
  genesis = "wrong-network";
  await assert.rejects(rpc.call("sendTransaction", ["never-submitted"]), e => e.integrityCode === "SOLANA_GENESIS_CHANGED");
  assert.equal(calls.at(-1), "getGenesisHash"); assert.equal(calls.filter(x => x === "sendTransaction").length, 2);
  const before = calls.length;
  await assert.rejects(rpc.requestAirdrop("1".repeat(32), "1"), /DevnetAutomaticAirdropDisabled/u);
  assert.equal(calls.length, before);
});

test("Devnet provider exceptions and error bodies never escape through RPC diagnostics", async () => {
  const rpc = new SolanaLocalRpcClient({ ...options, fetchImpl: async () => { throw new Error("private-provider-detail"); } });
  await assert.rejects(rpc.getBlockHeight(), e => e.kind === "SolanaRpcTransportUnavailable" && !String(e.stack).includes("private-provider-detail"));
  const rejected = new SolanaLocalRpcClient({ ...options, fetchImpl: async (_url, init) => Response.json({ jsonrpc: "2.0",
    id: JSON.parse(init.body).id, error: { code: -32000, message: "private-provider-detail" } }) });
  await assert.rejects(rejected.getBlockHeight(), e => e.kind === "SolanaRpcRejected" && e.code === -32000 && !String(e.stack).includes("private-provider-detail"));
});

test("a denied account-scan method exposes numeric diagnostics only and never returns an empty result", async t => {
  const manifest = devnetTestManifest(JSON.parse(readFileSync(new URL("../../../docs/deployment/devnet.json", import.meta.url))));
  let status = 400; const methods = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const input = JSON.parse(init.body); methods.push(input.method);
    if (input.method === "getGenesisHash") return Response.json({ jsonrpc: "2.0", id: input.id, result: DEVNET_SOLANA_GENESIS });
    assert.equal(input.method, "getProgramAccounts");
    return Response.json({ jsonrpc: "2.0", id: input.id, error: { code: -32600, message: "private-provider-detail", data: endpoint } }, { status });
  });
  const rpc = new LocalDeploymentRpc(options);
  for (status of [400, 200]) await assert.rejects(rpc.withdrawalRecordAccounts(manifest), error => {
    assert.equal(error.message, "DeploymentSourceUnavailable");
    assert.deepEqual(sanitizedRpcDiagnostic(error), { httpStatus: status, rpcCode: -32600 });
    assert(!String(error.stack).includes(endpoint) && !String(error.stack).includes("private-provider-detail"));
    assert.equal(error.cause, undefined); return true;
  });
  assert.deepEqual(methods, ["getGenesisHash", "getProgramAccounts", "getGenesisHash", "getProgramAccounts"]);
});

const testSignature = n => { const bytes = Buffer.alloc(64); bytes.writeUInt32LE(n); return base58Encode(bytes); };
test("Devnet history uses finalized pages, including failed-signature cursors, and reaches the enrollment boundary", async t => {
  const manifest = devnetTestManifest(JSON.parse(readFileSync(new URL("../../../docs/deployment/devnet.json", import.meta.url))));
  const minimum = Number(manifest.minimumSlot), row = (n, slot) => ({ signature: testSignature(n), slot, err: null, confirmationStatus: "finalized" });
  let page = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    if (method === "getGenesisHash") return Response.json({ jsonrpc: "2.0", id, result: DEVNET_SOLANA_GENESIS });
    assert.equal(method, "getSignaturesForAddress"); assert.equal(params[0], manifest.manager.id);
    assert.equal(params[1].commitment, "finalized"); assert.equal(params[1].minContextSlot, minimum); assert.equal(params[1].limit, 64);
    assert.equal(params[1].before, page === 0 ? undefined : testSignature(64));
    const rows = page++ === 0 ? Array.from({ length: 64 }, (_, i) => ({ ...row(i + 1, minimum + 64 - i), err: i === 63 ? "AccountNotFound" : null }))
      : [row(65, minimum), row(66, minimum - 1)];
    return Response.json({ jsonrpc: "2.0", id, result: rows });
  });
  const signatures = await new LocalDeploymentRpc(options).finalizedProgramSignatures(manifest);
  assert.equal(page, 2); assert.equal(signatures.length, 64);
  assert(!signatures.includes(testSignature(64))); assert.equal(signatures.at(-1), testSignature(65));
});

test("incomplete, duplicated, backwards-ordered or unfinalized history fails closed", async t => {
  const manifest = devnetTestManifest(JSON.parse(readFileSync(new URL("../../../docs/deployment/devnet.json", import.meta.url))));
  const minimum = Number(manifest.minimumSlot), row = (n, slot = minimum) => ({ signature: testSignature(n), slot, err: null, confirmationStatus: "finalized" });
  let rows;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { id, method } = JSON.parse(init.body);
    assert(["getGenesisHash", "getSignaturesForAddress"].includes(method));
    return Response.json({ jsonrpc: "2.0", id, result: method === "getGenesisHash" ? DEVNET_SOLANA_GENESIS : rows });
  });
  for (rows of [[], [row(1, minimum + 1)], [row(1, minimum + 1), row(1)], [row(1), row(2, minimum + 1)],
    [{ ...row(1), confirmationStatus: "confirmed" }], [{ ...row(1), slot: String(minimum) }]]) {
    await assert.rejects(new LocalDeploymentRpc(options).finalizedProgramSignatures(manifest), /WithdrawalDiscoveryHistory/u);
  }
});

test("Devnet history discovery still verifies the exact Borsh withdrawal, BurnChecked, token delta and record", async () => {
  const { manifest: m, snapshot } = deploymentFixture();
  m.environment = "devnet"; m.solanaGenesis = DEVNET_SOLANA_GENESIS; m.config.nativeNetwork = 8_000_111; snapshot.genesis = DEVNET_SOLANA_GENESIS;
  const bridge = Buffer.from(snapshot.accounts[3].data[0], "base64"), transceiver = Buffer.from(snapshot.accounts[4].data[0], "base64");
  bridge[9] = 3; bridge[10] = 1; transceiver.writeUInt32LE(8_000_111, 141);
  snapshot.accounts[3].data[0] = bridge.toString("base64"); snapshot.accounts[4].data[0] = transceiver.toString("base64");
  const bytes = value => Buffer.from(base58Decode(value)), h = n => Buffer.alloc(32, n), authority = base58Encode(h(7)), source = base58Encode(h(8));
  const encoded = Buffer.from(encodeCanonicalBridgeMessage({ action: "WithdrawalRequest", direction: "SolanaToNative",
    deployment: { protocolId: m.config.protocolId, nativeNetwork: m.config.nativeNetwork, nativeGenesis: m.nativeGenesisHex,
      solanaDeployment: m.solanaDeploymentHex, managerProgramId: bytes(m.manager.id), transceiverProgramId: bytes(m.transceiver.id), mint: bytes(m.mint.id) },
    depositOutpoint: { txid: h(0), vout: 0 }, withdrawalId: h(9), amountAtomic: 20n, feeAtomic: 1n, destination: Buffer.concat([Buffer.from([0x51, 0x20]), h(10)]),
    policyEpoch: 1, keyEpoch: 1, nonce: h(11), validFrom: 1n, validUntil: 100n, evidenceDigest: h(12) }));
  const message = decodeCanonicalBridgeMessage(encoded), record = base58Encode(Buffer.from(deriveWithdrawalRecordPdaHex(bytes(m.manager.id).toString("hex"), message.withdrawalIdHex), "hex"));
  const burn = { tokenProgramId: bytes(m.mint.tokenProgram), mint: bytes(m.mint.id), authority: bytes(authority), amountAtomic: 20n, decimals: 8 };
  const wire = encodeBridgeAbi("RecordWithdrawal", { tag: 3, message: encoded, burn });
  const recordBytes = encodeBridgeAbi("WithdrawalRecord", { magic: Buffer.from("KPBWDR01"), version: 1, withdrawalId: message.withdrawalId,
    operationId: message.operationId, messageDigest: Buffer.from(message.messageDigestHex, "hex"), grossAmountAtomic: 20n, feeAtomic: 1n,
    nativeDestination: paddedDestination(Buffer.from(message.destinationHex, "hex")), burnAuthority: bytes(authority) });
  const signature = testSignature(70), enrollment = testSignature(71), tokenAmount = amount => [{ accountIndex: 1, mint: m.mint.id, owner: authority, uiTokenAmount: { amount, decimals: 8 } }];
  const burnBytes = Buffer.alloc(10); burnBytes[0] = 15; burnBytes.writeBigUInt64LE(20n, 1); burnBytes[9] = 8;
  const tx = { slot: 10, blockTime: 50, version: "legacy", transaction: { signatures: [signature], message: {
    header: { numRequiredSignatures: 1 }, accountKeys: [authority, source, m.config.bridgePda, record, m.mint.id, m.mint.tokenProgram,
      m.config.transceiverPda, "SysvarC1ock11111111111111111111111111111111", "11111111111111111111111111111111", m.manager.id],
    instructions: [{ programIdIndex: 9, accounts: [2, 3, 1, 4, 0, 5, 6, 7, 8], data: base58Encode(wire) }] } },
    meta: { err: null, preTokenBalances: tokenAmount("20"), postTokenBalances: tokenAmount("0"),
      innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 5, accounts: [1, 4, 0], data: base58Encode(burnBytes) }] }] } };
  class FixtureRpc extends LocalDeploymentRpc {
    constructor() { super(options); }
    async snapshot() { return structuredClone(snapshot); }
    async finalizedProgramSignatures() { return [signature, enrollment]; }
    async withdrawalRecordAccounts() { throw new Error("AccountScanMustNotBeCalled"); }
    async finalizedTransaction(sig) {
      if (sig === signature) return structuredClone(tx);
      const other = structuredClone(tx); other.transaction.signatures = [enrollment]; other.transaction.message.instructions[0] = { programIdIndex: 9, accounts: [], data: "1" };
      return other;
    }
    async snapshotWithAdditionalAccounts(_manifest, accounts) {
      assert.deepEqual(accounts, [record]); return { ...structuredClone(snapshot), accounts: [...structuredClone(snapshot.accounts),
        { owner: m.manager.id, executable: false, data: [recordBytes.toString("base64"), "base64"] }] };
    }
  }
  const reader = new FinalizedWithdrawalReader({ rpc: new FixtureRpc(), manifest: m });
  const [receipt] = await reader.discover([]); assert.equal(requireFinalizedWithdrawal(receipt).operationId, message.operationIdHex);
  assert.deepEqual(await reader.discover([message.operationIdHex]), []);
  tx.meta.postTokenBalances = tokenAmount("1"); await assert.rejects(reader.discover([]), /WithdrawalTokenDeltaMismatch/u);
  tx.meta.postTokenBalances = tokenAmount("0"); tx.transaction.message.instructions[0].data = base58Encode(Buffer.from([3]));
  await assert.rejects(reader.discover([]), /WithdrawalInstructionMalformed/u);
  tx.transaction.message.instructions[0].data = base58Encode(wire); recordBytes[73] ^= 1;
  await assert.rejects(reader.discover([]), /WithdrawalRecordMismatch/u);
});

test("Devnet snapshot binds the existing Borsh DevnetTesting state and rejects local/wrong-network substitution", () => {
  const { manifest, snapshot } = deploymentFixture();
  manifest.environment = "devnet"; manifest.solanaGenesis = DEVNET_SOLANA_GENESIS; manifest.config.nativeNetwork = 8_000_111;
  snapshot.genesis = DEVNET_SOLANA_GENESIS;
  const bridge = Buffer.from(snapshot.accounts[3].data[0], "base64"), transceiver = Buffer.from(snapshot.accounts[4].data[0], "base64");
  bridge[9] = 3; bridge[10] = 1; transceiver.writeUInt32LE(8_000_111, 141);
  snapshot.accounts[3].data[0] = bridge.toString("base64"); snapshot.accounts[4].data[0] = transceiver.toString("base64");
  assert.equal(verifyDeploymentSnapshot(manifest, snapshot).mintSupplyAtomic, "0");
  assert.throws(() => validateDeploymentManifest({ ...manifest, environment: undefined }));
  assert.throws(() => validateDeploymentManifest({ ...manifest, solanaGenesis: "1".repeat(32) }));
  bridge[9] = 2; snapshot.accounts[3].data[0] = bridge.toString("base64");
  assert.throws(() => verifyDeploymentSnapshot(manifest, snapshot), e => e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED");
});

test("runtime manifest comes from the reviewed public deployment record, not RPC enrollment", () => {
  const record = JSON.parse(readFileSync(new URL("../../../docs/deployment/devnet.json", import.meta.url)));
  const manifest = devnetTestManifest(record);
  assert.equal(manifest.environment, "devnet"); assert.equal(manifest.manager.id, record.managerProgram);
  assert.equal(manifest.sourceSha, record.sourceSha); assert.equal(manifest.config.protocolId, 1);
  for (const change of [{ productionReady: true }, { mainnetActivation: "ENABLED" }, { borshSchemaVersion: 1 },
    { freezeAuthority: record.upgradeAuthority }, { solanaGenesis: "1".repeat(32) }]) assert.throws(() => devnetTestManifest({ ...record, ...change }));
});
