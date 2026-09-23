// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NativeRpcClient } from "../native-rpc-client.mjs";
import { collectMainnetEvidence, encodeMainnetEvidence, encodeMainnetEvidenceAtCheckpoint,
  encodeRegtestEvidence } from "../native-raw-evidence.mjs";
import { NATIVE_MAINNET_GENESIS, NATIVE_REGTEST_GENESIS } from "../../../shared/network-identity.mjs";

const vector = JSON.parse(readFileSync(new URL("../../proof/vectors/mainnet-header-merkle.json", import.meta.url), "utf8"));
const headerId = header => createHash("sha256").update(createHash("sha256").update(Buffer.from(header, "hex")).digest()).digest().reverse().toString("hex");
const h = n => n.toString(16).padStart(2, "0").repeat(32);

test("Mainnet Borsh envelope matches Rust's historical Mainnet proof including retargets", () => {
  assert.equal(createHash("sha256").update(encodeMainnetEvidence(vector.input)).digest("hex"), vector.digest);
  assert.throws(() => encodeRegtestEvidence(vector.input), /WRONG_GENESIS/);
  assert.throws(() => encodeMainnetEvidence({ ...vector.input, genesisHash: NATIVE_REGTEST_GENESIS }), /WRONG_GENESIS/);
  const long = { ...vector.input, tipHeight: 4097, headers: Array(4097).fill(vector.input.headers[0]) };
  assert(encodeMainnetEvidence(long).length > 4096 * 80);
  assert.throws(() => encodeRegtestEvidence({ ...long, genesisHash: NATIVE_REGTEST_GENESIS }), /COUNT_INVALID/);
});

function sourceModel() {
  const headers = [...vector.input.headers], hashes = [NATIVE_MAINNET_GENESIS, ...headers.map(headerId)];
  let height = 239, batches = 0;
  const rpc = {
    getBlockchainInfo: async () => ({ chain: "main", initialblockdownload: false, blocks: height, headers: height,
      bestblockhash: hashes[height], chainwork: vector.input.chainworkHex }),
    call: async (method, params) => ({ result: method === "getblockhash" ? hashes[params[0]] : hashes[height] }),
    getHeadersByHeight: async (start, count) => { batches++; return headers.slice(start-1, start-1+count)
      .map((header, i) => ({ height: start+i, hash: hashes[start+i], header })); },
    getRawTransaction: async () => ({ hex: vector.input.proofs[0].rawTransactionHex, blockhash: hashes[1] }),
    getBlock: async () => ({ height: 1, hash: hashes[1], tx: vector.input.proofs[0].transactionIds }),
  };
  return { rpc, height: n => { height = n; }, batches: () => batches,
    replaceTip: () => { const bytes = Buffer.from(headers[height-1], "hex"); bytes[79] ^= 1;
      headers[height-1] = bytes.toString("hex"); hashes[height] = headerId(headers[height-1]); } };
}

test("bounded Mainnet header cache reuses a stable prefix and discards replaced evidence", async () => {
  const source = sourceModel(), options = { rpc: source.rpc, transactionIds: [vector.input.proofs[0].transactionIds[0]], minimumConfirmations: 12 };
  await collectMainnetEvidence(options); assert.equal(source.batches(), 2);
  await collectMainnetEvidence(options); assert.equal(source.batches(), 2);
  source.height(241); const full = await collectMainnetEvidence(options); assert.equal(source.batches(), 3);
  assert.equal(createHash("sha256").update(encodeMainnetEvidence(full)).digest("hex"), vector.digest);
  const checkpoint = { protocol: "KINGPEPE_MAINNET_ACCEPTANCE_CHECKPOINT_V2", genesis: NATIVE_MAINNET_GENESIS,
    tipHash: full.tipHash, tipHeight: full.tipHeight, chainworkHex: full.chainworkHex, minimumConfirmations: 12,
    transactionBlockHints: { [vector.input.proofs[0].transactionIds[0]]: headerId(full.headers[0]) }, evidenceDigestHex: vector.digest };
  assert.deepEqual(encodeMainnetEvidenceAtCheckpoint(full, checkpoint), encodeMainnetEvidence(full));
  assert.throws(() => encodeMainnetEvidenceAtCheckpoint(full, { ...checkpoint, transactionBlockHints: {} }), /BLOCK_HINT_CHANGED/);
  assert.throws(() => encodeMainnetEvidenceAtCheckpoint(full, { ...checkpoint,
    transactionBlockHints: { [vector.input.proofs[0].transactionIds[0]]: h(2) } }), /BLOCK_HINT_CHANGED/);
  source.replaceTip(); const changed = await collectMainnetEvidence(options); assert.equal(source.batches(), 4);
  assert.throws(() => encodeMainnetEvidenceAtCheckpoint(changed, checkpoint), /CHECKPOINT_REJECTED/);
});

test("Mainnet observer rejects a responding wrong chain and cannot lower the approved finality", async () => {
  const source = sourceModel(); source.rpc.getBlockchainInfo = async () => ({ chain: "regtest", initialblockdownload: false, blocks: 241, headers: 241 });
  await assert.rejects(collectMainnetEvidence({ rpc: source.rpc, transactionIds: [h(1)], minimumConfirmations: 12 }), /RAW_NATIVE_WRONG_NETWORK/);
  for (const minimumConfirmations of [1, 11]) await assert.rejects(
    collectMainnetEvidence({ rpc: source.rpc, transactionIds: [h(1)], minimumConfirmations }), /FINALITY_POLICY_REQUIRED/);
});

test("optional block locations are lookup hints and cannot substitute transaction membership", async () => {
  const { rpc } = sourceModel(), txid = vector.input.proofs[0].transactionIds[0];
  const options = { rpc, transactionIds: [txid], minimumConfirmations: 12 };
  await assert.rejects(collectMainnetEvidence({ ...options, transactionBlockHints: { [h(1)]: h(2) } }), /BLOCK_HINT_REJECTED/);
  await assert.rejects(collectMainnetEvidence({ ...options, transactionBlockHints: { [txid]: h(2) } }), /BLOCK_SUBSTITUTED/);
});

test("a no-index Mainnet proof rereads retained spent transaction blocks and rejects substituted membership", async () => {
  const { rpc } = sourceModel(), txid = vector.input.proofs[0].transactionIds[0], block = headerId(vector.input.headers[0]);
  const read = rpc.getRawTransaction, hints = { [txid]: block };
  rpc.getRawTransaction = async (id, verbose, hint) => {
    assert.equal(id, txid); assert.equal(verbose, true);
    if (hint === undefined) throw new Error("NativeRpcRejected:getrawtransaction:-5");
    assert.equal(hint, block); return read();
  };
  // Reopened public checkpoint hints do not need the original UTXO or txindex.
  const options = { rpc, transactionIds: [txid], minimumConfirmations: 12 };
  await assert.rejects(collectMainnetEvidence(options), /getrawtransaction:-5/);
  const first = await collectMainnetEvidence({ ...options, transactionBlockHints: hints });
  const reopened = await collectMainnetEvidence({ ...options, transactionBlockHints: JSON.parse(JSON.stringify(hints)) });
  assert.deepEqual(encodeMainnetEvidence(first), encodeMainnetEvidence(reopened));
  rpc.getBlock = async () => ({ height: 1, hash: block, tx: [h(3)] });
  await assert.rejects(collectMainnetEvidence({ ...options, transactionBlockHints: hints }), /MEMBERSHIP_MISSING/);
});



test("Native header batching is bounded, read-only, order-safe and rejects ambiguous replies", async () => {
  let mode = "valid", calls = 0;
  const rpc = new NativeRpcClient({ fetchFn: async (_url, options) => {
    const requests = JSON.parse(options.body); calls++;
    assert(requests.length <= 128); assert.equal(options.redirect, "error");
    assert(requests.every(r => ["getblockhash", "getblockheader"].includes(r.method)));
    let replies = requests.map(r => ({ id: r.id, error: null, result: r.method === "getblockhash" ? h(r.params[0]) : "01".repeat(80) })).reverse();
    if (mode === "missing") replies.pop();
    if (mode === "duplicate") replies[0] = replies[1];
    if (mode === "error") replies[0].error = { code: -1, message: "PRIVATE_PROVIDER_DIAGNOSTIC" };
    return new Response(JSON.stringify(replies), { status: 200 });
  } });
  assert.deepEqual((await rpc.getHeadersByHeight(1,2)).map(r => r.hash), [h(1),h(2)]);
  assert.equal(calls, 2);
  for (const count of [0,129,-1,1.5]) await assert.rejects(rpc.getHeadersByHeight(1,count), /HeaderRangeRejected/);
  for (const value of ["missing", "duplicate", "error"]) { mode=value; await assert.rejects(rpc.getHeadersByHeight(1,2), /^Error: NativeRpcInvalidEnvelope:getblockhash$/); }
});
