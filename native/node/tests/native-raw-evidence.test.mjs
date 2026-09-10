// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Encoder/source-boundary models. Real PoW/Merkle checks run in Rust and the
// pinned Native REGTEST/local-validator integration job, not in these fixtures.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { collectRegtestEvidence, encodeRegtestEvidence, MAX_RAW_EVIDENCE_BYTES,
  REGTEST_GENESIS, verifyRegtestEvidencePacket } from "../native-raw-evidence.mjs";
import { parseNativeTransactionHex } from "../native-taproot-transaction.mjs";

const h = (byte) => byte.repeat(32);
const raw = `0200000001${h("07")}0000000000ffffffff018813000000000000015100000000`;
const txid = parseNativeTransactionHex(raw).txidHex;
const bundle = () => ({ genesisHash: REGTEST_GENESIS, tipHash: h("08"), tipHeight: 1,
  chainworkHex: h("00"), minimumConfirmations: 1, headers: ["09".repeat(80)],
  proofs: [{ rawTransactionHex: raw, blockHeight: 1, transactionIndex: 0, transactionIds: [txid] }] });

function rpcModel(overrides = {}) {
  return { getBlockchainInfo: async () => ({ chain: "regtest", initialblockdownload: false, blocks: 1, headers: 1,
    bestblockhash: h("08"), chainwork: h("00") }),
  call: async (method, params) => ({ result: method === "getblockhash" && params[0] === 0 ? REGTEST_GENESIS : h("08") }),
  getBlockHeader: async () => "09".repeat(80),
  getRawTransaction: async () => ({ hex: raw, blockhash: h("08") }),
  getBlock: async () => ({ height: 1, hash: h("08"), tx: [txid] }), ...overrides };
}

test("raw evidence packet has fixed-width canonical fields and immutable encoded bytes", () => {
  const input = bundle();
  const encoded = encodeRegtestEvidence(input);
  assert.equal(encoded.subarray(0, 8).toString(), "KPNEVD01");
  assert.equal(encoded.subarray(8, 40).toString("hex"), REGTEST_GENESIS);
  assert.equal(encoded.readUInt32LE(72), 1);
  assert.equal(encoded.readUInt32LE(108), 1);
  assert.equal(encoded.readUInt32LE(112), 1);
  assert.equal(encoded.subarray(116, 196).toString("hex"), input.headers[0]);
  assert.equal(encoded.readUInt32LE(196), 1);
  const copy = Buffer.from(encoded);
  input.headers[0] = "ff".repeat(80);
  assert.deepEqual(encoded, copy);
  assert.notDeepEqual(encodeRegtestEvidence(input), copy);
});

test("raw evidence encoder rejects wrong network, malformed widths, Unicode and resource abuse", () => {
  for (const patch of [{ genesisHash: h("01") }, { headers: [] }, { headers: ["aéz"] },
    { tipHeight: 2 }, { minimumConfirmations: 0 }, { proofs: [] }, { chainworkHex: "01" },
    { headers: Array(4097).fill("09".repeat(80)), tipHeight: 4097 }]) {
    assert.throws(() => encodeRegtestEvidence({ ...bundle(), ...patch }), /RAW_NATIVE_/u);
  }
  const oversized = bundle();
  oversized.proofs[0].transactionIds = Array(65_537).fill(txid);
  assert.throws(() => encodeRegtestEvidence(oversized), /RAW_NATIVE_COUNT_INVALID/u);
  const index = bundle(); index.proofs[0].transactionIndex = 1;
  assert.throws(() => encodeRegtestEvidence(index), /RAW_NATIVE_MERKLE_INDEX_INVALID/u);
});

test("collector obtains raw data and does not relabel RPC fields as validated proofs", async () => {
  const result = await collectRegtestEvidence({ rpc: rpcModel(), transactionIds: [txid], minimumConfirmations: 1 });
  assert.deepEqual(result, bundle());
  assert.equal(result.proofVerified, undefined);
  assert.equal(result.status, undefined);
});

test("collector rejects IBD, unknown IBD, wrong genesis, stale source and changed chain", async () => {
  const defaults = await rpcModel().getBlockchainInfo();
  for (const patch of [{ initialblockdownload: true }, { initialblockdownload: undefined },
    { headers: 2 }, { blocks: 4097, headers: 4097 }, { chain: "main" }]) {
    await assert.rejects(() => collectRegtestEvidence({ rpc: rpcModel({ getBlockchainInfo: async () => ({ ...defaults, ...patch }) }),
      transactionIds: [txid], minimumConfirmations: 1 }), /RAW_NATIVE_/u);
  }
  for (const methodToChange of ["genesis", "getbestblockhash"]) {
    const original = rpcModel();
    const rpc = rpcModel({ call: async (method, params) => (
      method === methodToChange || (methodToChange === "genesis" && method === "getblockhash" && params[0] === 0)
        ? { result: h("ff") } : original.call(method, params)) });
    await assert.rejects(() => collectRegtestEvidence({ rpc, transactionIds: [txid], minimumConfirmations: 1 }),
      /RAW_NATIVE_WRONG_GENESIS|RAW_NATIVE_SOURCE_CHANGED/u);
  }
});

test("collector rejects substituted transaction, block and missing or duplicated proof identity", async () => {
  for (const overrides of [
    { getRawTransaction: async () => ({ hex: raw.replace("8813", "8913"), blockhash: h("08") }) },
    { getBlock: async () => ({ height: 1, hash: h("ff"), tx: [txid] }) },
    { getBlock: async () => ({ height: 1, hash: h("08"), tx: [h("ff")] }) },
  ]) {
    await assert.rejects(() => collectRegtestEvidence({ rpc: rpcModel(overrides), transactionIds: [txid], minimumConfirmations: 1 }), /RAW_NATIVE_/u);
  }
  await assert.rejects(() => collectRegtestEvidence({ rpc: rpcModel(), transactionIds: [txid, txid], minimumConfirmations: 1 }),
    /RAW_NATIVE_DUPLICATE_TRANSACTION/u);
});

test("collector identifies unconfirmed transactions without mistaking parser or RPC failure for finality", async () => {
  await assert.rejects(() => collectRegtestEvidence({ rpc: rpcModel({ getRawTransaction: async () => ({ hex: raw }) }),
    transactionIds: [txid], minimumConfirmations: 1 }), { message: "RAW_NATIVE_TRANSACTION_UNCONFIRMED" });
  await assert.rejects(() => collectRegtestEvidence({ rpc: rpcModel({ getRawTransaction: async () => ({ hex: "zz" }) }),
    transactionIds: [txid], minimumConfirmations: 1 }), { message: "RAW_NATIVE_HEX_INVALID" });
  const failure = new Error("RPC_TEST_OUTAGE");
  await assert.rejects(() => collectRegtestEvidence({ rpc: rpcModel({ getRawTransaction: async () => { throw failure; } }),
    transactionIds: [txid], minimumConfirmations: 1 }), (error) => error === failure);
});

test("external verifier failures are bounded and redacted; no fallback to a caller verification flag", async () => {
  const executable = path.join(os.tmpdir(), "kingpepe-nonexistent-evidence-binary");
  assert.throws(() => verifyRegtestEvidencePacket({ executable: "relative-tool", packet: Buffer.alloc(0) }), /PATH_REQUIRED/u);
  assert.throws(() => verifyRegtestEvidencePacket({ executable, packet: Buffer.alloc(MAX_RAW_EVIDENCE_BYTES + 1) }), /TOO_LARGE/u);
  await assert.rejects(() => verifyRegtestEvidencePacket({ executable, packet: encodeRegtestEvidence(bundle()) }),
    (error) => error.message === "RAW_NATIVE_VERIFICATION_FAILED" && !error.message.includes(executable));
});
