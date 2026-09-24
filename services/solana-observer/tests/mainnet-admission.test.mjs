// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Isolated parser/RPC fixtures only; no production credentials or transactions.
import assert from "node:assert/strict";
import test from "node:test";
import { mainnetDeploymentFixture as fixture } from "../../../tests/integration/deployment-fixture.mjs";
import { SOLANA_MAINNET_GENESIS, SOLANA_DEVNET_GENESIS } from "../../../shared/network-identity.mjs";
import { LocalDeploymentRpc, validateDeploymentManifest, verifyDeploymentSnapshot } from "../deployment-integrity.mjs";


import { base58Decode, base58Encode } from "../../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { BurnSolanaRpc } from '../burn-solana-rpc.mjs';
import { validateBurnContext } from '../../bridge-validator/burn-context.mjs';
import { burnFixture } from '../../../native/burn/tests/burn-fixture.mjs';

const bytes = key => Buffer.from(base58Decode(key)), h = n => Buffer.alloc(32, n);
const options = { endpoint: "https://rpc.example.invalid/private-test-marker", expectedGenesis: SOLANA_MAINNET_GENESIS };
const mutateAccount = (snapshot, index, offset) => {
  const b = Buffer.from(snapshot.accounts[index].data[0], "base64"); b[offset] ^= 1; snapshot.accounts[index].data[0] = b.toString("base64");
};

test("burn conversion cannot enable Mainnet by relabeling TEST configuration", () => {
  const f = burnFixture();
  try {
    assert.throws(() => new BurnSolanaRpc({ ...options, environment: 'mainnet' }), /BurnSolanaProtectedMainnetEndpointRequired/);
    assert.throws(() => new BurnSolanaRpc({ ...options, environment: 'devnet' }), /BurnSolanaGenesisRejected/);
    assert.throws(() => validateBurnContext({ ...f.context, environment: 'mainnet' }));
  } finally { f.destroy(); }
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
