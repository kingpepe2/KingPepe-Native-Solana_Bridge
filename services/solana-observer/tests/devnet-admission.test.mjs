// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { DEVNET_SOLANA_GENESIS, isTestSolanaCluster, devnetRpcEndpoint } from "../../../shared/solana-test-network.mjs";
import { BurnSolanaRpc } from "../burn-solana-rpc.mjs";
import { LocalDeploymentRpc, devnetTestManifest, validateDeploymentManifest, verifyDeploymentSnapshot } from "../deployment-integrity.mjs";
import { deploymentFixture } from "../../../tests/integration/deployment-fixture.mjs";


const endpoint = "https://rpc.example.invalid/configured-locally";
const options = { endpoint, environment: "devnet", expectedGenesis: DEVNET_SOLANA_GENESIS };

test("Devnet transport is explicit, HTTPS and genesis-bound; local defaults and Mainnet remain closed", () => {
  for (const Client of [BurnSolanaRpc, LocalDeploymentRpc]) {
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

test("every Devnet send checks actual genesis before and after, including retries and endpoint changes", async t => {
  let genesis = DEVNET_SOLANA_GENESIS, changeAfterSend = false; const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, endpoint); assert.equal(init.redirect, 'error');
    const input = JSON.parse(init.body); calls.push(input.method);
    const result = input.method === 'getGenesisHash' ? genesis : 'submitted';
    if(input.method === 'sendTransaction') {
      assert.deepEqual(input.params[1], {encoding:'base64',skipPreflight:false,preflightCommitment:'finalized',maxRetries:0});
      if(changeAfterSend)genesis = 'wrong-network';
    }
    return Response.json({jsonrpc:'2.0',id:input.id,result});
  });
  const rpc = new BurnSolanaRpc(options);
  await rpc.send('AQ=='); await rpc.send('AQ==');
  assert.deepEqual(calls.splice(0), ['getGenesisHash','sendTransaction','getGenesisHash','getGenesisHash','sendTransaction','getGenesisHash']);
  for(const bad of [{encoding:'base64',skipPreflight:true,preflightCommitment:'finalized',maxRetries:0},
    {encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}])
    await assert.rejects(rpc.call('sendTransaction',['AQ==',bad]), /SubmissionPolicyRejected/);
  await assert.rejects(rpc.call('requestAirdrop',[]), /MethodRejected/);
  assert.deepEqual(calls,[]);
  genesis = 'wrong-network'; await assert.rejects(rpc.send('AQ=='), /BURN_SOLANA_NETWORK_MISMATCH/);
  assert.deepEqual(calls.splice(0), ['getGenesisHash']);
  genesis = DEVNET_SOLANA_GENESIS; changeAfterSend = true;
  await assert.rejects(rpc.send('AQ=='), /BURN_SOLANA_NETWORK_MISMATCH/);
  assert.deepEqual(calls, ['getGenesisHash','sendTransaction','getGenesisHash']);
});

test("Devnet provider exceptions and error bodies never escape through RPC diagnostics", async t => {
  const rpc = new BurnSolanaRpc(options);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-provider-detail'); });
  await assert.rejects(rpc.finalizedHeight(), e => e.message === 'BURN_SOLANA_RPC_UNAVAILABLE' && !String(e.stack).includes('private-provider-detail'));
  t.mock.method(globalThis, 'fetch', async (_url, init) => Response.json({jsonrpc:'2.0',id:JSON.parse(init.body).id,
    error:{code:-32000,message:'private-provider-detail'}}));
  await assert.rejects(rpc.finalizedHeight(), e => e.rpcCode === -32000 && !String(e.stack).includes('private-provider-detail'));
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
  const { manifest: m } = deploymentFixture();
  // Synthetic enrollment parser fixture, never evidence of a real deployment.
  const record = { schema: "KINGPEPE_ONE_WAY_DEVNET_DEPLOYMENT/V1", scope: "DEVNET_TEST_ONLY",
    borshSchemaVersion: 4, canonicalMagic: "KPBRMSG4", initialSupplyAtomic: "0", freezeAuthority: null,
    productionReady: false, mainnetActivation: "DISABLED", sourceSha: m.sourceSha,
    nativeGenesis: m.nativeGenesisHex, solanaGenesis: DEVNET_SOLANA_GENESIS, solanaDeploymentHex: m.solanaDeploymentHex,
    managerProgram: m.manager.id, transceiverProgram: m.transceiver.id, mint: m.mint.id, tokenProgram: m.mint.tokenProgram,
    decimals: m.mint.decimals, upgradeAuthority: m.manager.upgradeAuthority, protocolId: 1, nativeNetwork: 8_000_111,
    policyEpoch: 1, keyEpoch: 1, attesters: m.config.attesters,
    pdas: { managerProgramData: m.manager.programData, transceiverProgramData: m.transceiver.programData,
      mintAuthority: m.mint.authority, bridgePda: m.config.bridgePda, transceiverPda: m.config.transceiverPda },
    transactions: { managerDeployment: { slot: 1 }, transceiverDeployment: { slot: 1 }, mintAndConfigEnrollment: { slot: 2 } } };
  const manifest = devnetTestManifest(record);
  assert.equal(manifest.environment, "devnet"); assert.equal(manifest.manager.id, record.managerProgram);
  assert.equal(manifest.sourceSha, record.sourceSha); assert.equal(manifest.config.protocolId, 1);
  for (const change of [{ productionReady: true }, { mainnetActivation: "ENABLED" }, { borshSchemaVersion: 1 }, { borshSchemaVersion: 2 }, { borshSchemaVersion: 3 }, { canonicalMagic: "KPEPBRG2" },
    { freezeAuthority: record.upgradeAuthority }, { solanaGenesis: "1".repeat(32) }]) assert.throws(() => devnetTestManifest({ ...record, ...change }));
});
