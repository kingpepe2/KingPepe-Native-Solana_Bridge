// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEVNET_SOLANA_GENESIS, isTestSolanaCluster, devnetRpcEndpoint } from "../../../shared/solana-test-network.mjs";
import { SolanaLocalRpcClient } from "../../bridge-validator/solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimRpcClient } from "../solana-deposit-claim-observer.mjs";
import { LocalDeploymentRpc, devnetTestManifest, validateDeploymentManifest, verifyDeploymentSnapshot } from "../deployment-integrity.mjs";
import { deploymentFixture } from "../../../tests/integration/deployment-fixture.mjs";

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
