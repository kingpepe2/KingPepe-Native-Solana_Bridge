// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { deploymentFixture } from "../../../tests/integration/deployment-fixture.mjs";
import { validateDeploymentManifest, verifyDeploymentSnapshot, deploymentManifestDigest, LocalDeploymentRpc } from "../deployment-integrity.mjs";

test("deployment parser binds exact domain/loader/config and exact atomic counters", () => {
  const { manifest, snapshot } = deploymentFixture();
  const mint = Buffer.from(snapshot.accounts[2].data[0], "base64"); mint.writeBigUInt64LE(9007199254740993n, 36); snapshot.accounts[2].data[0] = mint.toString("base64");
  assert.equal(verifyDeploymentSnapshot(manifest, snapshot).mintSupplyAtomic, "9007199254740993");
  const pinned = validateDeploymentManifest(manifest); assert(Object.isFrozen(pinned.config));
  const before = deploymentManifestDigest(pinned); manifest.config.keyEpoch++; assert.equal(deploymentManifestDigest(pinned), before);
  assert.equal(verifyDeploymentSnapshot(pinned, snapshot).trust, "RPC_OBSERVATION");
});
const byte = (snapshot, i, offset) => { const b = Buffer.from(snapshot.accounts[i].data[0], "base64"); b[offset] ^= 1; snapshot.accounts[i].data[0] = b.toString("base64"); };
for (const [name, mutate] of [
  ["program owner", s => { s.accounts[0].owner = s.accounts[2].owner; }],
  ["executable flag", s => { s.accounts[0].executable = false; }],
  ["ProgramData address", s => byte(s, 0, 4)], ["loader discriminator", s => byte(s, 5, 0)],
  ["ProgramData executable", s => { s.accounts[5].executable = true; }],
  ["executable layout", s => byte(s, 5, 45)], ["upgrade authority", s => byte(s, 5, 13)],
  ["deployment slot", s => byte(s, 5, 4)], ["mint authority", s => byte(s, 2, 4)],
  ["freeze authority", s => byte(s, 2, 46)], ["mint precision", s => byte(s, 2, 44)],
  ["token program", s => { s.accounts[2].owner = s.accounts[3].owner; }],
  ["config epoch", s => byte(s, 3, 258)], ["config version", s => byte(s, 3, 8)],
  ["transceiver attester", s => byte(s, 4, 177)], ["Native genesis", s => byte(s, 4, 145)],
  ["Solana deployment", s => byte(s, 3, 75)], ["missing program", s => { s.accounts[0] = null; }],
]) test("deployment mismatch rejects: " + name, () => {
  const { manifest, snapshot } = deploymentFixture(); mutate(snapshot);
  assert.throws(() => verifyDeploymentSnapshot(manifest, snapshot), e => e.integrityCode === "SOLANA_DEPLOYMENT_CHANGED");
});
test("manifest substitution, trailing fields, wrong environment, aliasing and stale source reject", () => {
  const { manifest, snapshot } = deploymentFixture();
  for (const mutate of [m => { m.environment = "mainnet"; }, m => { m.extra = true; }, m => { m.manager.programData = m.transceiver.programData; },
    m => { m.config.bridgePda = m.mint.id; }, m => { m.mint.tokenProgram = m.manager.id; }, m => { m.config.attesters[1] = m.config.attesters[0]; }]) {
    const m = structuredClone(manifest); mutate(m); assert.throws(() => validateDeploymentManifest(m));
  }
  assert.throws(() => verifyDeploymentSnapshot({ ...manifest, minimumSlot: "11" }, snapshot), /DeploymentSourceStale/u);
  assert.throws(() => verifyDeploymentSnapshot(manifest, { ...snapshot, slot: Number.MAX_SAFE_INTEGER + 1 }));
  const malformed = structuredClone(snapshot); malformed.accounts[0].data[0] += " "; assert.throws(() => verifyDeploymentSnapshot(manifest, malformed), /DeploymentAccountMalformed/u);
});

test("real bounded HTTP reader enforces endpoint, RPC identity, bank context and malformed/outage rejection", async t => {
  const { manifest, snapshot } = deploymentFixture(); let mode = "valid", calls = 0;
  const server = http.createServer(async (request, response) => {
    let input = ""; for await (const b of request) input += b; const v = JSON.parse(input); calls++;
    assert(["getGenesisHash", "getMultipleAccounts"].includes(v.method));
    if (v.method === "getMultipleAccounts") assert.deepEqual(v.params[1], { commitment: "finalized", encoding: "base64", minContextSlot: 1 });
    const result = v.method === "getGenesisHash" ? snapshot.genesis : { context: { slot: snapshot.slot }, value: snapshot.accounts };
    if (mode === "malformed") { response.end("{"); return; }
    if (mode === "oversized") { response.end(" ".repeat(8_388_609)); return; }
    if (mode === "redirect") { response.writeHead(302, { location: "/elsewhere" }); response.end(); return; }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: mode === "wrong-id" ? v.id + 1 : v.id, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`, rpc = new LocalDeploymentRpc({ endpoint });
  assert.equal(verifyDeploymentSnapshot(manifest, await rpc.snapshot(manifest)).slot, "10"); assert.equal(calls, 3);
  for (mode of ["malformed", "wrong-id", "oversized", "redirect"]) await assert.rejects(rpc.snapshot(manifest), /DeploymentSourceUnavailable/u);
  for (const endpoint of ["https://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:8000/x", "http://127.0.0.1:8000/?x=1"]) assert.throws(() => new LocalDeploymentRpc({ endpoint }));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await assert.rejects(rpc.snapshot(manifest));
});
