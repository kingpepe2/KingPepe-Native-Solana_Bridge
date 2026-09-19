// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Isolated parser/RPC fixtures only; no production credentials or transactions.
import assert from "node:assert/strict";
import test from "node:test";
import { mainnetDeploymentFixture as fixture } from "../../../tests/integration/deployment-fixture.mjs";
import { SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS } from "../../../shared/network-identity.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot } from "../deployment-integrity.mjs";


import { base58Decode, base58Encode } from "../../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SolanaLocalRpcClient } from "../../bridge-validator/solana-deposit-claim-submitter.mjs";
import { SolanaDepositClaimObserver, SolanaDepositClaimRpcClient } from "../solana-deposit-claim-observer.mjs";
import { solanaDeliveryFixture } from "../../../tests/integration/solana-delivery-fixture.mjs";
import { validateSolanaDepositDelivery } from "../../relayer/solana-deposit-delivery.mjs";

const bytes = key => Buffer.from(base58Decode(key)), h = n => Buffer.alloc(32, n);
const options = { endpoint: "https://rpc.example.invalid/private-test-marker", expectedGenesis: SOLANA_MAINNET_GENESIS };
const mutateAccount = (snapshot, index, offset) => {
  const b = Buffer.from(snapshot.accounts[index].data[0], "base64"); b[offset] ^= 1; snapshot.accounts[index].data[0] = b.toString("base64");
};

test("Mainnet claim RPC defaults to read-only and cannot bypass network, preflight or endpoint admission", async t => {
  assert.throws(() => new SolanaLocalRpcClient({ ...options, environment: "mainnet" }), /EnvironmentRejected/);
  for (const mutation of [{ environment: "devnet" }, { expectedGenesis: SOLANA_DEVNET_GENESIS }, { expectedGenesis: undefined },
    { endpoint: "http://127.0.0.1:8899" }, { fetchImpl: async () => {} }, { productionBroadcastAuthorized: "true" }])
    assert.throws(() => SolanaLocalRpcClient.createMainnet({ ...options, ...mutation }));
  const calls = [];
  let genesis = SOLANA_MAINNET_GENESIS, afterRead = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "error");
    const { id, method, params } = JSON.parse(init.body); calls.push(method);
    if (method === "sendTransaction") assert.deepEqual(params[1], { encoding: "base64", maxRetries: 0, skipPreflight: false, preflightCommitment: "finalized" });
    const result = method === "getGenesisHash" ? genesis : method === "sendTransaction" ? base58Encode(Buffer.alloc(64, 1)) : 100;
    if (method === "getBlockHeight" && afterRead) genesis = SOLANA_DEVNET_GENESIS;
    return Response.json({ jsonrpc: "2.0", id, result });
  });
  const readonly = SolanaLocalRpcClient.createMainnet(options);
  await assert.rejects(readonly.sendTransaction("AQ=="), /MainnetBroadcastNotAuthorized/);
  await assert.rejects(readonly.call("sendTransaction", ["AQ==", {}]), /MainnetBroadcastNotAuthorized/);
  await assert.rejects(readonly.call("requestAirdrop", []), /MainnetAirdropForbidden/);
  assert.deepEqual(calls, []);
  assert.equal(await readonly.getBlockHeight(), 100n);
  assert.deepEqual(calls.splice(0), ["getGenesisHash", "getBlockHeight", "getGenesisHash"]);
  const allowed = SolanaLocalRpcClient.createMainnet({ ...options, productionBroadcastAuthorized: true });
  await assert.rejects(allowed.sendTransaction("AQ==", { skipPreflight: true }), /MainnetSubmissionPolicyRejected/);
  await assert.rejects(allowed.call("sendTransaction", ["AQ==", { encoding: "base64", maxRetries: 0, skipPreflight: false }]), /MainnetSubmissionPolicyRejected/);
  genesis = SOLANA_DEVNET_GENESIS;
  await assert.rejects(allowed.sendTransaction("AQ=="), /SOLANA_GENESIS_CHANGED/); assert.deepEqual(calls.splice(0), ["getGenesisHash"]);
  genesis = SOLANA_MAINNET_GENESIS;
  await allowed.sendTransaction("AQ=="); // Synthetic transport only, never a real RPC.
  assert.deepEqual(calls.splice(0), ["getGenesisHash", "sendTransaction", "getGenesisHash"]);
  afterRead = true; await assert.rejects(readonly.getBlockHeight(), /SOLANA_GENESIS_CHANGED/);
});

test("Mainnet claim RPC keeps private provider errors out of diagnostics", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error(options.endpoint); });
  const rpc = SolanaLocalRpcClient.createMainnet(options);
  await assert.rejects(rpc.getBlockHeight(), error => !JSON.stringify(error).includes("private-test-marker") && /SolanaRpcTransportUnavailable/.test(error.message));
});

test("Mainnet finalized claim observer requires full configured domain and rejects another cluster before observation", async t => {
  const { manifest: m } = fixture(4);
  const config = { environment: "mainnet", cluster: "mainnet", solanaGenesis: m.solanaGenesis, protocolId: m.config.protocolId,
    nativeNetwork: m.config.nativeNetwork, nativeGenesis: m.nativeGenesisHex, solanaDeployment: m.solanaDeploymentHex,
    managerProgramIdHex: bytes(m.manager.id).toString("hex"), transceiverProgramIdHex: bytes(m.transceiver.id).toString("hex"), mintHex: bytes(m.mint.id).toString("hex"), nativeDecimals: 8 };
  assert.throws(() => new SolanaDepositClaimObserver({ ...options, config }), /ExplicitFactoryRequired/);
  for (const mutation of [{ environment: "devnet" }, { cluster: "devnet" }, { nativeGenesis: h(3).toString("hex") },
    { solanaDeployment: h(9).toString("hex") }, { nativeNetwork: 8000111 }, { mintHex: h(4).toString("hex") }, { nativeDecimals: 9 }])
    assert.throws(() => SolanaDepositClaimObserver.createMainnet({ ...options, config: { ...config, ...mutation } }));
  assert.throws(() => SolanaDepositClaimObserver.createMainnet({ ...options, config, rpcClient: {} }));
  const rpc = SolanaDepositClaimRpcClient.createMainnet(options), seen = [];
  let genesis = SOLANA_DEVNET_GENESIS, flip = false;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body); seen.push(method);
    if (method !== "getGenesisHash") assert.equal(params.at(-1).commitment, "finalized");
    const result = method === "getGenesisHash" ? genesis : null;
    if (method === "getTransaction" && flip) genesis = SOLANA_DEVNET_GENESIS;
    return Response.json({ jsonrpc: "2.0", id, result });
  });
  const observer = SolanaDepositClaimObserver.createMainnet({ ...options, config });
  await assert.rejects(observer.observeProtectedFinalizedDepositClaim({}, SOLANA_MAINNET_GENESIS), /SOLANA_GENESIS_CHANGED/);
  assert.deepEqual(seen.splice(0), ["getGenesisHash"]);
  genesis = SOLANA_MAINNET_GENESIS; flip = true;
  await assert.rejects(rpc.getSignedTransaction(base58Encode(Buffer.alloc(64, 2))), /SOLANA_GENESIS_CHANGED/);
  assert.deepEqual(seen, ["getGenesisHash", "getTransaction", "getGenesisHash"]);
});

test("Mainnet receipt and claim packets retain exact Borsh, attester, Mint, program and fee-payer binding", async () => {
  const f = await solanaDeliveryFixture({ mainnet: true });
  for (const kind of ["RECEIPT", "CLAIM"]) {
    const packet = await f.delivery(kind), verified = validateSolanaDepositDelivery(packet, f.policy);
    assert.equal(verified.message.deployment.nativeNetwork, f.policy.operationPolicy.nativeNetwork);
    for (const mutate of [p => { p.encodedMessageHex += "00"; }, p => { p.attestations[0].signatureHex = "00".repeat(64); },
      p => { p.recentBlockhash = f.policy.manifest.mint.id; }, p => { const wire = Buffer.from(p.preparedTransactionBase64, "base64"); wire[100] ^= 1; p.preparedTransactionBase64 = wire.toString("base64"); }]) {
      const changed = structuredClone(packet); mutate(changed); assert.throws(() => validateSolanaDepositDelivery(changed, f.policy));
    }
    for (const mutate of [p => { p.operationPolicy.nativeGenesis = h(3).toString("hex"); }, p => { p.operationPolicy.solanaGenesis = SOLANA_DEVNET_GENESIS; },
      p => { p.operationPolicy.mint = h(4).toString("hex"); }, p => { p.operationPolicy.managerProgramId = h(5).toString("hex"); },
      p => { p.feePayerPublicKey = base58Encode(h(9)); }]) {
      const changed = structuredClone(f.policy); mutate(changed); assert.throws(() => validateSolanaDepositDelivery(packet, changed));
    }
  }
});

test("Mainnet deployment observations bind complete genesis/domain, modes, authority, Mint and zero start", () => {
  for (const state of [0, 4, 5]) {
    const { manifest, snapshot } = fixture(state);
    assert.equal(verifyDeploymentSnapshot(manifest, snapshot).mintSupplyAtomic, "0");
    for (const [index, offset] of [[3, 9], [3, 10], [3, 75], [3, 264], [4, 145], [5, 13], [2, 4], [2, 44], [2, 46]]) {
      const changed = structuredClone(snapshot); mutateAccount(changed, index, offset);
      assert.throws(() => verifyDeploymentSnapshot(manifest, changed), e => e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED");
    }
    for (const mutation of [{ nativeGenesisHex: h(4).toString("hex") }, { solanaGenesis: SOLANA_DEVNET_GENESIS },
      { solanaDeploymentHex: h(7).toString("hex") }, { environment: "localnet" }, { environment: undefined },
      { config: { ...manifest.config, nativeNetwork: 8000111 } }, { config: { ...manifest.config, mainnetActivationEnabled: state !== 5 } }])
      assert.throws(() => validateDeploymentManifest({ ...manifest, ...mutation }));
  }
  const { manifest, snapshot } = fixture();
  for (const [index, offset] of [[2, 36], [3, 265]]) {
    const changed = structuredClone(snapshot); mutateAccount(changed, index, offset);
    assert.throws(() => verifyDeploymentSnapshot(manifest, changed), e => e.violation === "MAINNET_ZERO_START");
  }
  assert.throws(() => validateDeploymentManifest({ ...manifest, config: { ...manifest.config, depositsPaused: false } }), /MainnetDeploymentModeRejected/);
});

test("explicit Mainnet RPC uses HTTPS and rechecks genesis before and after finalized observations", async t => {
  assert.throws(() => new LocalDeploymentRpc({ ...options, environment: "mainnet" }), /DeploymentEnvironmentRejected/);
  for (const change of [{ environment: "devnet" }, { expectedGenesis: SOLANA_DEVNET_GENESIS }, { expectedGenesis: undefined },
    { endpoint: "http://127.0.0.1:8899" }, { endpoint: "https://rpc.example.invalid/#fragment" }])
    assert.throws(() => LocalDeploymentRpc.createMainnet({ ...options, ...change }));
  const { manifest, snapshot } = fixture(), rpc = LocalDeploymentRpc.createMainnet(options), calls = [];
  let genesis = SOLANA_MAINNET_GENESIS, changeAfterRead = false, failed = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, options.endpoint); assert.equal(init.redirect, "error");
    const { id, method, params } = JSON.parse(init.body); calls.push(method);
    if (failed) throw new Error(options.endpoint);
    let result;
    if (method === "getGenesisHash") result = genesis;
    else if (method === "getMultipleAccounts") {
      assert.equal(params[1].commitment, "finalized"); result = { context: { slot: 10 }, value: snapshot.accounts };
      if (changeAfterRead) genesis = SOLANA_DEVNET_GENESIS;
    } else if (method === "getTransaction") { assert.equal(params[1].commitment, "finalized"); result = null; }
    else throw new Error("UnexpectedReadOnlyMethod");
    return Response.json({ jsonrpc: "2.0", id, result });
  });
  assert.equal(verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest)).mintSupplyAtomic, "0");
  assert.deepEqual(calls.splice(0), ["getGenesisHash", "getMultipleAccounts", "getGenesisHash"]);
  changeAfterRead = true; await assert.rejects(rpc.snapshot(manifest), /SOLANA_GENESIS_CHANGED/);
  calls.length = 0; await assert.rejects(rpc.finalizedTransaction(base58Encode(Buffer.alloc(64, 1))), /SOLANA_GENESIS_CHANGED/);
  assert.deepEqual(calls, ["getGenesisHash"]);
  genesis = SOLANA_MAINNET_GENESIS; failed = true; await assert.rejects(rpc.genesis(), /^Error: DeploymentSourceUnavailable$/);

});
