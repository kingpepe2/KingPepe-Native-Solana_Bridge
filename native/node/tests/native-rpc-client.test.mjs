import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  NativeRpcClient,
  RPC_OBSERVATION,
  SOURCE_READY,
  SOURCE_REJECTED,
  createNativeRegtestRpcClient,
  decimalCoinsToAtomic,
  normalizeEndpoint,
  readAuthorizationHeaderFromCookieFile,
} from "../native-rpc-client.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const GENESIS = h("kingpepe-regtest-genesis");
const BEST_BLOCK = h("kingpepe-regtest-best-block");
const TXID = h("kingpepe-regtest-utxo");

for (const method of ["getblockchaininfo", "sendrawtransaction"]) test("Native RPC refuses redirected " + method + " without contacting another endpoint", async () => {
  let forwarded = 0;
  const destination = http.createServer((request, response) => {
    forwarded++; let body = "";
    request.on("data", bytes => { body += bytes; });
    request.on("end", () => { const input = JSON.parse(body); writeJson(response, { id: input.id, result: "synthetic", error: null }); });
  });
  await new Promise(resolve => destination.listen(0, "127.0.0.1", resolve));
  const redirect = http.createServer((request, response) => {
    request.resume(); response.writeHead(307, { location: "http://127.0.0.1:" + destination.address().port }); response.end();
  });
  await new Promise(resolve => redirect.listen(0, "127.0.0.1", resolve));
  try {
    const client = new NativeRpcClient({ endpoint: "http://127.0.0.1:" + redirect.address().port });
    await assert.rejects(client.call(method, method === "sendrawtransaction" ? ["00"] : []));
    assert.equal(forwarded, 0, "RedirectMustNotReceiveRpcBody");
  } finally {
    for (const server of [redirect, destination]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test("ordinary RPC adapter cannot invoke local forced-fork test controls", async () => {
  let contacted = false;
  const client = new NativeRpcClient({ fetchFn: async () => { contacted = true; throw new Error("UnexpectedRequest"); } });
  for (const method of ["invalidateblock", "generateblock", "reconsiderblock"]) {
    await assert.rejects(client.call(method, []), /NativeRpcMethodNotAllowed/u);
  }
  assert.equal(contacted, false);
});

test("source snapshot uses loopback RPC observation without claiming local validation", async () => {
  const requests = [];
  await withRpcServer(
    async ({ endpoint }) => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kingpepe-native-rpc-"));
      const authCookieFile = path.join(tempRoot, ".cookie");
      const cookieLine = `_cookie:${randomUUID()}`;
      writeFileSync(authCookieFile, `${cookieLine}\n`, "utf8");
      const client = createNativeRegtestRpcClient({
        endpoint,
        repoRoot: REPO_ROOT,
        authCookieFile,
      });

      const snapshot = await client.getSourceSnapshot({
        expectedNetwork: "regtest",
        expectedGenesisHash: GENESIS,
      });

      assert.equal(snapshot.protocol, "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_SOURCE_SNAPSHOT/V1");
      assert.equal(snapshot.trust, RPC_OBSERVATION);
      assert.equal(snapshot.state, SOURCE_READY);
      assert.equal(snapshot.reason, "NATIVE_SOURCE_RPC_OBSERVED");
      assert.equal(snapshot.network, "regtest");
      assert.equal(snapshot.genesisHash, GENESIS);
      assert.equal(snapshot.bestHash, BEST_BLOCK);
      assert.equal(snapshot.bestHeight, 44);
      assert.equal(snapshot.headers, 44);
      assert.equal(snapshot.inInitialBlockDownload, false);
      assert.equal(snapshot.stale, false);
      assert.equal(snapshot.endpoint.startsWith("http://127.0.0.1:"), true);
      const expectedAuth = `Basic ${Buffer.from(cookieLine, "utf8").toString("base64")}`;
      assert.equal(requests[0].authorization, expectedAuth);
    },
    { requests },
  );
});

test("source snapshot rejects wrong network or genesis", async () => {
  await withRpcServer(async ({ endpoint }) => {
    const client = createNativeRegtestRpcClient({ endpoint });
    const wrongNetwork = await client.getSourceSnapshot({
      expectedNetwork: "main",
      expectedGenesisHash: GENESIS,
    });
    assert.equal(wrongNetwork.state, SOURCE_REJECTED);
    assert.equal(wrongNetwork.reason, "NATIVE_NETWORK_MISMATCH");

    const wrongGenesis = await client.getSourceSnapshot({
      expectedNetwork: "regtest",
      expectedGenesisHash: h("wrong-genesis"),
    });
    assert.equal(wrongGenesis.state, SOURCE_REJECTED);
    assert.equal(wrongGenesis.reason, "NATIVE_GENESIS_MISMATCH");
  });
});

test("UTXO observation parses exact atomic amount from raw JSON text", async () => {
  await withRpcServer(async ({ endpoint }) => {
    const client = createNativeRegtestRpcClient({ endpoint });
    const observation = await client.getUtxoObservation({
      txid: TXID,
      vout: 1,
      decimals: 8,
    });

    assert.equal(observation.protocol, "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_UTXO_OBSERVATION/V1");
    assert.equal(observation.trust, RPC_OBSERVATION);
    assert.equal(observation.unspent, true);
    assert.equal(observation.valueAtomic, "123456789");
    assert.equal(observation.scriptPubKeyHex, "5120" + h("deposit-script").slice(0, 64));
    assert.equal(observation.confirmations, 9);
    assert.equal(observation.coinbase, false);
  });
});

test("spent or missing UTXO stays unspent=false without inventing value", async () => {
  await withRpcServer(async ({ endpoint }) => {
    const client = createNativeRegtestRpcClient({ endpoint });
    const observation = await client.getUtxoObservation({
      txid: h("spent-utxo"),
      vout: 2,
    });
    assert.deepEqual(observation, {
      protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_UTXO_OBSERVATION/V1",
      adapterProtocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_ADAPTER/V1",
      trust: RPC_OBSERVATION,
      outpoint: { txid: h("spent-utxo"), vout: 2 },
      unspent: false,
    });
  });
});

test("endpoint, method, and auth boundaries fail closed", async () => {
  assert.throws(() => normalizeEndpoint("ftp://127.0.0.1:18443"), /NativeRpcEndpointProtocolRejected/u);
  const invalidEndpoint = new URL("http://127.0.0.1:18443");
  // Disposable, in-memory rejection inputs; never credentials for a service.
  invalidEndpoint.username = randomUUID();
  invalidEndpoint.password = randomUUID();
  assert.throws(() => normalizeEndpoint(invalidEndpoint.toString()), /NativeRpcEndpointCredentialsRejected/u);
  assert.throws(() => normalizeEndpoint("http://192.0.2.10:18443"), /NativeRpcEndpointMustBeLoopback/u);
  assert.throws(
    () => readAuthorizationHeaderFromCookieFile(path.join(REPO_ROOT, "not-tracked.cookie"), REPO_ROOT),
    /NativeRpcAuthCookieInsideRepositoryRejected/u,
  );
  const client = new NativeRpcClient({
    endpoint: "http://127.0.0.1:18443",
    fetchFn: async () => {
      throw new Error("should not call network");
    },
  });
  await assert.rejects(() => client.call("dumpprivkey"), /NativeRpcMethodNotAllowed:dumpprivkey/u);
});

test("amount conversion rejects precision loss and scientific notation", () => {
  assert.equal(decimalCoinsToAtomic("0", 8), 0n);
  assert.equal(decimalCoinsToAtomic("1.23456789", 8), 123456789n);
  assert.equal(decimalCoinsToAtomic("2.5", 8), 250000000n);
  assert.throws(() => decimalCoinsToAtomic("0.000000001", 8), /NativeRpcAmountPrecisionLoss/u);
  assert.throws(() => decimalCoinsToAtomic("1e-8", 8), /NativeRpcAmountNonCanonical/u);
});

test("RPC errors are reported without echoing auth material", async () => {
  await withRpcServer(
    async ({ endpoint }) => {
      const client = createNativeRegtestRpcClient({ endpoint });
      await assert.rejects(
        () => client.call("getrawtransaction", [TXID, false]),
        (error) => {
          assert.match(error.message, /NativeRpcRejected:getrawtransaction:-5/u);
          return true;
        },
      );
    },
    { failMethod: "getrawtransaction" },
  );
});

test("RPC responses enforce byte bounds, request identity and strict UTF-8 before authorization", async () => {
  for (const response of [new Response("x".repeat(65)), new Response("{}", { headers: { "content-length": "65" } })]) {
    const client = new NativeRpcClient({ maximumResponseBytes: 64, fetchFn: async () => response });
    await assert.rejects(() => client.getBlockchainInfo(), /NativeRpcResponseTooLarge/u);
  }
  for (const text of ['{"id":2,"result":true}', '{"id":1}', '[]']) {
    const client = new NativeRpcClient({ fetchFn: async () => new Response(text) });
    await assert.rejects(() => client.getBlockchainInfo(), /NativeRpcInvalidEnvelope/u);
  }
  const invalid = new NativeRpcClient({ fetchFn: async () => new Response(Uint8Array.of(0xff)) });
  await assert.rejects(() => invalid.getBlockchainInfo(), /NativeRpcInvalidUtf8/u);
  assert.throws(() => new NativeRpcClient({ maximumResponseBytes: 16_000_001 }), /NativeRpcResponseLimitTooLarge/u);
});

test("Native legacy HTTP errors preserve only bounded request-matched numeric RPC codes", async () => {
  for (const [status, code] of [[400, -32600], [404, -32601], [500, -5]]) {
    const client = new NativeRpcClient({ fetchFn: async () => new Response(JSON.stringify({ id: 1,
      result: null, error: { code, message: "UNTRUSTED_DIAGNOSTIC" } }), { status }) });
    await assert.rejects(client.call("getrawtransaction", [TXID, true]),
      { message: `NativeRpcRejected:getrawtransaction:${code}` });
  }
});

test("HTTP and malformed RPC failures cannot be reclassified as transaction-not-found or success", async () => {
  const cases = [
    [500, JSON.stringify({ id: 1, result: true, error: null }), "NativeRpcHttpFailure"],
    [500, "UNTRUSTED_DIAGNOSTIC", "NativeRpcHttpFailure"],
    [503, JSON.stringify({ id: 1, error: { code: -5 } }), "NativeRpcHttpFailure"],
    [401, JSON.stringify({ id: 1, error: { code: -5 } }), "NativeRpcHttpFailure"],
    [500, JSON.stringify({ id: 2, error: { code: -5 } }), "NativeRpcInvalidEnvelope"],
    ...[200, 500].flatMap((status) => ["UNTRUSTED_DIAGNOSTIC", {}, 1.5, 0x8000_0000].map((code) =>
      [status, JSON.stringify({ id: 1, error: { code } }), "NativeRpcInvalidEnvelope"])),
  ];
  for (const [status, body, kind] of cases) {
    const client = new NativeRpcClient({ fetchFn: async () => new Response(body, { status }) });
    await assert.rejects(client.call("getrawtransaction", [TXID, true]),
      (error) => error.code === kind && !error.message.includes("UNTRUSTED_DIAGNOSTIC"));
  }
  const oversized = new NativeRpcClient({ maximumResponseBytes: 64, fetchFn: async () => new Response("x".repeat(65), { status: 500 }) });
  await assert.rejects(oversized.getBlockchainInfo(), /NativeRpcResponseTooLarge/u);
});

async function withRpcServer(callback, options = {}) {
  const requests = options.requests ?? [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) body += chunk;
    const envelope = JSON.parse(body);
    requests.push({
      method: envelope.method,
      params: envelope.params,
      authorization: request.headers.authorization,
    });

    if (envelope.method === options.failMethod) {
      writeJson(response, { jsonrpc: "1.0", id: envelope.id, error: { code: -5, message: "not found" } });
      return;
    }

    writeJson(response, {
      jsonrpc: "1.0",
      id: envelope.id,
      result: rpcResult(envelope.method, envelope.params),
      error: null,
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}`;
    await callback({ endpoint, requests });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function rpcResult(method, params) {
  switch (method) {
    case "getblockchaininfo":
      return {
        chain: "regtest",
        blocks: 44,
        headers: 44,
        bestblockhash: BEST_BLOCK,
        initialblockdownload: false,
        chainwork: "00" + h("chainwork").slice(0, 62),
      };
    case "getblockhash":
      assert.deepEqual(params, [0]);
      return GENESIS;
    case "gettxout":
      if (params[0] === h("spent-utxo")) return null;
      return {
        bestblock: BEST_BLOCK,
        confirmations: 9,
        value: 1.23456789,
        scriptPubKey: {
          hex: "5120" + h("deposit-script").slice(0, 64),
        },
        coinbase: false,
      };
    case "sendrawtransaction":
      return h("broadcast-txid");
    case "stop":
      return "KingPepe stopping";
    default:
      return {};
  }
}

function writeJson(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function h(label) {
  return Buffer.from(label.padEnd(32, "\0")).toString("hex").slice(0, 64);
}
