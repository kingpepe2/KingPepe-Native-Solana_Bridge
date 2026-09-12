// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Encoder/source-boundary models. Real PoW/Merkle checks run in Rust and the
// pinned Native REGTEST/local-validator integration job, not in these fixtures.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { serialize } from "borsh";
import { collectRegtestEvidence, encodeRegtestEvidence, encodeRegtestEvidenceAtCheckpoint, MAX_RAW_EVIDENCE_BYTES,
  REGTEST_GENESIS, verifyRegtestEvidencePacket, observedSpentRegtestReserve,
  decodeNativeVerificationResult, NATIVE_VERIFICATION_SCHEMA } from "../native-raw-evidence.mjs";
import { parseNativeTransactionHex } from "../native-taproot-transaction.mjs";

const h = (byte) => byte.repeat(32);
const raw = `0200000001${h("07")}0000000000ffffffff018813000000000000015100000000`;
const txid = parseNativeTransactionHex(raw).txidHex;
const bundle = () => ({ genesisHash: REGTEST_GENESIS, tipHash: h("08"), tipHeight: 1,
  chainworkHex: h("00"), minimumConfirmations: 1, headers: ["09".repeat(80)],
  proofs: [{ rawTransactionHex: raw, blockHeight: 1, transactionIndex: 0, transactionIds: [txid] }] });

test("Native Borsh envelope and verification response match fixed Rust vectors", () => {
  const vector = JSON.parse(readFileSync(new URL("../../proof/vectors/borsh-v2.json", import.meta.url), "utf8"));
  const packet = encodeRegtestEvidence(vector.input);
  assert.equal(packet.toString("hex"), vector.encodedHex);
  assert.equal(createHash("sha256").update(packet).digest("hex"), vector.digest);
  const response = Buffer.from(serialize(NATIVE_VERIFICATION_SCHEMA, {
    magic: Buffer.from("KPNEVR02"), digest: Buffer.from(vector.digest, "hex"),
    tipHash: Buffer.from(vector.input.tipHash, "hex"), tipHeight: vector.input.tipHeight, transactions: 1,
  }));
  assert.equal(response.toString("hex"), vector.responseHex);
  assert.equal(createHash("sha256").update(response).digest("hex"), vector.responseDigest);
  assert.deepEqual(decodeNativeVerificationResult(response), { digestHex: vector.digest,
    tipHash: vector.input.tipHash, tipHeight: 1, transactions: 1 });
  for (let length = 0; length < response.length; length++) {
    assert.throws(() => decodeNativeVerificationResult(response.subarray(0, length)), /RAW_NATIVE_/);
  }
  assert.throws(() => decodeNativeVerificationResult(Buffer.concat([response, Buffer.from([0])])), /RAW_NATIVE_/);
  for (const offset of [0, 7, 72, 76]) {
    const bad = Buffer.from(response); bad[offset] ^= 0x80;
    if (offset >= 72) bad.fill(0xff, offset, offset + 4);
    assert.throws(() => decodeNativeVerificationResult(bad), /RAW_NATIVE_/);
  }
});

test("caller-created errors and copied fields cannot claim a verified spent reserve", () => {
  for (const value of [undefined, null, "RAW_NATIVE_RESERVE_SPENT", new Error("RAW_NATIVE_RESERVE_SPENT"),
    { reserveBasis: {}, chain: {}, utxoTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION" }]) {
    assert.equal(observedSpentRegtestReserve(value), undefined);
  }
});

function rpcModel(overrides = {}) {
  return { getBlockchainInfo: async () => ({ chain: "regtest", initialblockdownload: false, blocks: 1, headers: 1,
    bestblockhash: h("08"), chainwork: h("00") }),
  call: async (method, params) => ({ result: method === "getblockhash" && params[0] === 0 ? REGTEST_GENESIS : h("08") }),
  getBlockHeader: async () => "09".repeat(80),
  getRawTransaction: async () => ({ hex: raw, blockhash: h("08") }),
  getBlock: async () => ({ height: 1, hash: h("08"), tx: [txid] }), ...overrides };
}

function checkpointFixture() {
  const b = bundle(); b.tipHash = createHash("sha256").update(createHash("sha256").update(Buffer.from(b.headers[0], "hex")).digest()).digest().reverse().toString("hex");
  const packet = encodeRegtestEvidence(b);
  const checkpoint = { protocol: "KINGPEPE_REGTEST_ACCEPTANCE_CHECKPOINT_V1", genesis: REGTEST_GENESIS,
    tipHash: b.tipHash, tipHeight: b.tipHeight, chainworkHex: b.chainworkHex, minimumConfirmations: b.minimumConfirmations,
    evidenceDigestHex: createHash("sha256").update(packet).digest("hex") };
  return { b, packet, checkpoint };
}

test("retained acceptance encoding reproduces the exact prefix as the current tip advances", () => {
  const { b, packet, checkpoint } = checkpointFixture();
  const advanced = { ...b, tipHash: h("02"), tipHeight: 2, chainworkHex: h("03"), headers: [...b.headers, "04".repeat(80)] };
  const repeated = encodeRegtestEvidenceAtCheckpoint(advanced, checkpoint);
  assert.deepEqual(repeated, packet); assert.notDeepEqual(encodeRegtestEvidence(advanced), packet);
  checkpoint.evidenceDigestHex = h("05"); assert.deepEqual(repeated, packet);
  assert.equal(repeated.status, undefined, "EncodingIsNotConsensusVerification");
});

test("acceptance checkpoint rejects domain, field, prefix, finality and digest substitution", () => {
  const { b, checkpoint } = checkpointFixture();
  for (const change of [{ genesis: h("01") }, { protocol: "old" }, { tipHeight: 2 }, { tipHash: h("01") },
    { minimumConfirmations: 2 }, { evidenceDigestHex: h("01") }, { chainworkHex: h("01") }, { approved: true }]) {
    assert.throws(() => encodeRegtestEvidenceAtCheckpoint(b, { ...checkpoint, ...change }), /RAW_NATIVE_/u);
  }
  const changed = structuredClone(b); changed.proofs[0].blockHeight = 2;
  assert.throws(() => encodeRegtestEvidenceAtCheckpoint(changed, checkpoint), /RAW_NATIVE_/u);
  changed.proofs[0].blockHeight = 1; changed.proofs[0].rawTransactionHex = raw.replace("8813", "8913");
  assert.throws(() => encodeRegtestEvidenceAtCheckpoint(changed, checkpoint), /RAW_NATIVE_/u);
});

test("raw evidence packet has fixed-width canonical fields and immutable encoded bytes", () => {
  const input = bundle();
  const encoded = encodeRegtestEvidence(input);
  assert.equal(encoded.subarray(0, 8).toString(), "KPNEVD02");
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
