// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit Native raw header/Merkle verification plus separately identified
// fully-validating-node RPC observations. No keys or broadcasting authority.
import { createHash } from "node:crypto";
import { serialize, deserialize } from "borsh";
import { spawn } from "node:child_process";
import path from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { createLocalTaprootSighashEvidences, parseNativeTransactionHex,
  taprootKeyPathSighashDefault, taprootScriptPathSighashDefault } from "./native-taproot-transaction.mjs";
import { verifyTaprootControlBlock } from "./native-tapscript.mjs";
import { NATIVE_MAINNET_GENESIS } from "../../shared/network-identity.mjs";

export const REGTEST_GENESIS = "352a1a62f7880d325da6d3fe2e62272cd0ce735a7ba003eae4fb59d2a175a8b9";
export const MAX_RAW_EVIDENCE_BYTES = 8_000_000;
const MAX_HEADERS = 4096;
const MAX_TRANSACTIONS = 16;
const MAX_BLOCK_TXIDS = 65_536;
const CHECKPOINT_PROTOCOL = "KINGPEPE_REGTEST_ACCEPTANCE_CHECKPOINT_V1";
const REGTEST_PROFILE = Object.freeze({ genesis: REGTEST_GENESIS, chain: "regtest", network: "regtest", maximumHeaders: MAX_HEADERS,
  maximumBytes: MAX_RAW_EVIDENCE_BYTES, checkpointProtocol: CHECKPOINT_PROTOCOL, command: "--regtest-verify", timeoutMs: 15_000 });
const MAINNET_PROFILE = Object.freeze({ genesis: NATIVE_MAINNET_GENESIS, chain: "main", network: "mainnet", maximumHeaders: 1_000_000,
  maximumBytes: 96_000_000, checkpointProtocol: "KINGPEPE_MAINNET_ACCEPTANCE_CHECKPOINT_V1", command: "--mainnet-verify", timeoutMs: 120_000 });
const MAINNET_VERIFIER = Symbol("MainnetNativeEvidenceVerifier");
const MAINNET_HEADER_CACHE = new WeakMap();
const VERIFIED_CHAINS = new WeakSet(), VERIFIED_RESERVES = new WeakMap(), OBSERVED_SPENT_RESERVES = new WeakMap();
const headerId = raw => createHash("sha256").update(createHash("sha256").update(hex(raw, 80)).digest()).digest().reverse().toString("hex");
const knownGenesis = value => [REGTEST_GENESIS, NATIVE_MAINNET_GENESIS].includes(value);
export function requireVerifiedNativeChain(value, genesis) { if (!knownGenesis(genesis) || !VERIFIED_CHAINS.has(value) || value.genesis !== genesis) throw new Error("RAW_NATIVE_VERIFIED_CHAIN_REQUIRED"); }
export function requireVerifiedNativeReserve(value, genesis) { if (!knownGenesis(genesis) || !VERIFIED_RESERVES.has(value) || value.reserveBasis.genesis !== genesis) throw new Error("RAW_NATIVE_VERIFIED_RESERVE_REQUIRED"); }
export function requireVerifiedRegtestChain(value) { requireVerifiedNativeChain(value, REGTEST_GENESIS); }
export function requireVerifiedRegtestReserve(value) { requireVerifiedNativeReserve(value, REGTEST_GENESIS); }
export function verifiedReserveChain(value, genesis = REGTEST_GENESIS) { requireVerifiedNativeReserve(value, genesis); return VERIFIED_RESERVES.get(value); }
// A generic RPC error or a caller-created object is not evidence of a deficit.
// Only the verified sweep path below can produce this capability. UTXO absence
// still relies on the configured validating node; it is not a cryptographic
// proof of the node's honesty or a proof of the spending transaction itself.
export function observedSpentNativeReserve(error, genesis) {
  const value = OBSERVED_SPENT_RESERVES.get(error);
  return knownGenesis(genesis) && value?.reserveBasis.genesis === genesis ? value : undefined;
}
export function observedSpentRegtestReserve(error) { return observedSpentNativeReserve(error, REGTEST_GENESIS); }
function verifiedChain(bundle, verified, observedAt) {
  const result = Object.freeze({ ...verified, genesis: bundle.genesisHash, chainworkHex: bundle.chainworkHex, observedAt,
    headerHashes: Object.freeze([bundle.genesisHash, ...bundle.headers.map(headerId)]),
    canonicalChoiceTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION" });
  VERIFIED_CHAINS.add(result); return result;
}

const hashSchema = { array: { type: "u8", len: 32 } };
export const NATIVE_EVIDENCE_SCHEMA = { struct: {
  magic: { array: { type: "u8", len: 8 } },
  genesisHash: hashSchema, tipHash: hashSchema, tipHeight: "u32",
  // Big-endian Native chainwork commitment represented as opaque 32 bytes.
  chainwork: hashSchema, minimumConfirmations: "u32",
  headers: { array: { type: { array: { type: "u8", len: 80 } } } },
  proofs: { array: { type: { struct: {
    transaction: { array: { type: "u8" } }, blockHeight: "u32", transactionIndex: "u32",
    transactionIds: { array: { type: hashSchema } },
  } } } },
} };
export const NATIVE_VERIFICATION_SCHEMA = { struct: {
  magic: { array: { type: "u8", len: 8 } }, digest: hashSchema, tipHash: hashSchema,
  tipHeight: "u32", transactions: "u32",
} };

export function encodeRegtestEvidence(bundle) {
  return encodeNativeEvidence(bundle, REGTEST_PROFILE);
}
export function encodeMainnetEvidence(bundle) { return encodeNativeEvidence(bundle, MAINNET_PROFILE); }
function encodeNativeEvidence(bundle, profile) {
  if (bundle?.genesisHash !== profile.genesis) throw new Error("RAW_NATIVE_WRONG_GENESIS");
  const headers = boundedArray(bundle.headers, profile.maximumHeaders);
  const proofs = boundedArray(bundle.proofs, MAX_TRANSACTIONS);
  if (headers.length !== bundle.tipHeight) throw new Error("RAW_NATIVE_HEADER_COUNT_MISMATCH");
  let byteLength = 120 + headers.length * 80;
  const wireProofs = proofs.map((proof) => {
    const transaction = hex(proof.rawTransactionHex, undefined, 4_000_000);
    const ids = boundedArray(proof.transactionIds, MAX_BLOCK_TXIDS);
    const transactionIndex = integer(proof.transactionIndex, MAX_BLOCK_TXIDS - 1);
    if (transactionIndex >= ids.length) throw new Error("RAW_NATIVE_MERKLE_INDEX_INVALID");
    byteLength += 16 + transaction.length + ids.length * 32;
    if (byteLength > profile.maximumBytes) throw new Error("RAW_NATIVE_EVIDENCE_TOO_LARGE");
    return { transaction, blockHeight: positive(proof.blockHeight, profile.maximumHeaders), transactionIndex,
      transactionIds: ids.map(txid => hex(txid, 32)) };
  });
  const packet = Buffer.from(serialize(NATIVE_EVIDENCE_SCHEMA, {
    magic: Buffer.from("KPNEVD02"), genesisHash: hex(profile.genesis, 32), tipHash: hex(bundle.tipHash, 32),
    tipHeight: integer(bundle.tipHeight, profile.maximumHeaders), chainwork: hex(bundle.chainworkHex, 32),
    minimumConfirmations: positive(bundle.minimumConfirmations, MAX_HEADERS),
    headers: headers.map(header => hex(header, 80)), proofs: wireProofs,
  }));
  if (packet.length !== byteLength) throw new Error("RAW_NATIVE_EVIDENCE_LENGTH");
  return packet;
}

export function decodeNativeVerificationResult(packet) {
  return decodeVerificationResult(packet, REGTEST_PROFILE);
}
function decodeVerificationResult(packet, profile) {
  if (!(packet instanceof Uint8Array) || packet.length !== 80) throw new Error("RAW_NATIVE_VERIFICATION_FAILED");
  const value = deserialize(NATIVE_VERIFICATION_SCHEMA, packet);
  if (!Buffer.from(value.magic).equals(Buffer.from("KPNEVR02")) ||
      !Buffer.from(serialize(NATIVE_VERIFICATION_SCHEMA, value)).equals(Buffer.from(packet))) {
    throw new Error("RAW_NATIVE_VERIFICATION_FAILED");
  }
  return Object.freeze({ digestHex: Buffer.from(value.digest).toString("hex"),
    tipHash: Buffer.from(value.tipHash).toString("hex"),
    tipHeight: positive(value.tipHeight, profile.maximumHeaders), transactions: positive(value.transactions, MAX_TRANSACTIONS) });
}

// Re-encode a retained acceptance basis from CURRENT canonical raw data. This
// encoder is not proof: both the current branch and this prefix must still pass
// the independent Rust verifier. UTXO availability is checked at the CURRENT tip.
export function encodeRegtestEvidenceAtCheckpoint(bundle, checkpoint) {
  return encodeEvidenceAtCheckpoint(bundle, checkpoint, REGTEST_PROFILE);
}
export function encodeMainnetEvidenceAtCheckpoint(bundle, checkpoint) { return encodeEvidenceAtCheckpoint(bundle, checkpoint, MAINNET_PROFILE); }
function encodeEvidenceAtCheckpoint(bundle, checkpoint, profile) {
  const c = structuredClone(checkpoint), b = structuredClone(bundle);
  const fields = ["protocol", "genesis", "tipHash", "tipHeight", "chainworkHex", "minimumConfirmations", "evidenceDigestHex"];
  if (!c || Array.isArray(c) || Object.keys(c).sort().join() !== fields.sort().join() ||
      c.protocol !== profile.checkpointProtocol || c.genesis !== profile.genesis || b.genesisHash !== c.genesis ||
      c.minimumConfirmations !== b.minimumConfirmations ||
      positive(c.tipHeight, profile.maximumHeaders) > b.tipHeight || c.tipHeight > b.headers.length ||
      c.tipHash !== headerId(b.headers[c.tipHeight - 1]) ||
      b.proofs.some(proof => proof.blockHeight > c.tipHeight)) throw new Error("RAW_NATIVE_ACCEPTANCE_CHECKPOINT_REJECTED");
  for (const name of ["tipHash", "chainworkHex", "evidenceDigestHex"]) {
    if (typeof c[name] !== "string" || !/^[0-9a-f]{64}$/u.test(c[name])) throw new Error("RAW_NATIVE_ACCEPTANCE_CHECKPOINT_REJECTED");
  }
  const packet = encodeNativeEvidence({ ...b, tipHash: c.tipHash, tipHeight: c.tipHeight,
    chainworkHex: c.chainworkHex, headers: b.headers.slice(0, c.tipHeight) }, profile);
  if (createHash("sha256").update(packet).digest("hex") !== c.evidenceDigestHex) throw new Error("RAW_NATIVE_ACCEPTANCE_DIGEST_CHANGED");
  return packet;
}

export async function collectRegtestEvidence({ rpc, transactionIds, minimumConfirmations }) {
  return collectNativeEvidence({ rpc, transactionIds, minimumConfirmations }, REGTEST_PROFILE);
}
export async function collectMainnetEvidence(options) { return collectNativeEvidence(options, MAINNET_PROFILE); }
async function collectNativeEvidence({ rpc, transactionIds, minimumConfirmations, transactionBlockHints = {} }, profile) {
  const expectedIds = boundedArray(transactionIds, MAX_TRANSACTIONS).map((id) => hex(id, 32).toString("hex"));
  if (new Set(expectedIds).size !== expectedIds.length) throw new Error("RAW_NATIVE_DUPLICATE_TRANSACTION");
  if (!transactionBlockHints || Array.isArray(transactionBlockHints) || Object.keys(transactionBlockHints).some(id => !expectedIds.includes(id)))
    throw new Error("RAW_NATIVE_BLOCK_HINT_REJECTED");
  const info = await rpc.getBlockchainInfo();
  if (info?.chain !== profile.chain || info.initialblockdownload !== false || info.headers !== info.blocks) {
    throw new Error("RAW_NATIVE_SOURCE_NOT_READY");
  }
  const tipHeight = positive(info.blocks, profile.maximumHeaders);
  const tipHash = hex(info.bestblockhash, 32).toString("hex");
  const genesisHash = (await rpc.call("getblockhash", [0])).result;
  if (genesisHash !== profile.genesis) throw new Error("RAW_NATIVE_WRONG_GENESIS");
  const { headers, hashes } = profile === MAINNET_PROFILE ? await collectMainnetHeaders(rpc, tipHeight) : { headers: [], hashes: [genesisHash] };
  if (profile === REGTEST_PROFILE) for (let height = 1; height <= tipHeight; height += 1) {
      const blockHash = hex((await rpc.call("getblockhash", [height])).result, 32).toString("hex");
      hashes.push(blockHash);
      headers.push(hex(await rpc.getBlockHeader(blockHash, false), 80).toString("hex"));
    }
  if (hashes[tipHeight] !== tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
  const proofs = [];
  for (const txid of expectedIds) {
    const hint = transactionBlockHints[txid] === undefined ? undefined : hex(transactionBlockHints[txid], 32).toString("hex");
    const transaction = await rpc.getRawTransaction(txid, true, hint);
    const raw = hex(transaction?.hex, undefined, 4_000_000).toString("hex");
    if (parseNativeTransactionHex(raw).txidHex !== txid) throw new Error("RAW_NATIVE_TRANSACTION_SUBSTITUTED");
    if (transaction.blockhash === undefined) throw new Error("RAW_NATIVE_TRANSACTION_UNCONFIRMED");
    const blockHash = hex(transaction.blockhash, 32).toString("hex");
    if (hint !== undefined && hint !== blockHash) throw new Error("RAW_NATIVE_BLOCK_SUBSTITUTED");
    const block = await rpc.getBlock(blockHash, 1);
    const blockHeight = positive(block?.height, profile.maximumHeaders);
    if (hashes[blockHeight] !== blockHash || block.hash !== blockHash) throw new Error("RAW_NATIVE_BLOCK_SUBSTITUTED");
    const ids = boundedArray(block.tx, MAX_BLOCK_TXIDS).map((id) => hex(id, 32).toString("hex"));
    const transactionIndex = ids.indexOf(txid);
    if (transactionIndex < 0) throw new Error("RAW_NATIVE_MERKLE_MEMBERSHIP_MISSING");
    proofs.push({ rawTransactionHex: raw, blockHeight, transactionIndex, transactionIds: ids });
  }
  if ((await rpc.call("getbestblockhash", [])).result !== tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
  return { genesisHash, tipHash, tipHeight, chainworkHex: hex(info.chainwork, 32).toString("hex"),
    minimumConfirmations, headers, proofs };
}

export function verifyRegtestEvidencePacket({ executable, packet }) {
  return verifyNativeEvidencePacket({ executable, packet }, REGTEST_PROFILE);
}
export function verifyMainnetEvidencePacket(options) { return verifyNativeEvidencePacket(options, MAINNET_PROFILE); }
function verifyNativeEvidencePacket({ executable, packet }, profile) {
  if (typeof executable !== "string" || !path.isAbsolute(executable)) throw new Error("RAW_NATIVE_VERIFIER_PATH_REQUIRED");
  if (!(packet instanceof Uint8Array) || packet.length > profile.maximumBytes) throw new Error("RAW_NATIVE_EVIDENCE_TOO_LARGE");
  // Copy before spawning: asynchronous signing policy must not observe mutable bytes.
  const snapshot = Buffer.from(packet);
  const digestHex = createHash("sha256").update(snapshot).digest("hex");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [profile.command], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    let captured = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill();
      reject(new Error("RAW_NATIVE_VERIFICATION_FAILED"));
    };
    const timer = setTimeout(fail, profile.timeoutMs);
    child.on("error", fail);
    child.stdin.on("error", fail);
    for (const [stream, capture] of [[child.stdout, true], [child.stderr, false]]) {
      stream.on("data", (data) => {
        captured += data.length;
        if (captured > 1024) { fail(); return; }
        if (capture) output.push(Buffer.from(data));
      });
    }
    child.on("close", (code) => {
      if (settled) return;
      let result;
      try { result = decodeVerificationResult(Buffer.concat(output), profile); } catch { fail(); return; }
      if (code !== 0 || result.digestHex !== digestHex) { fail(); return; }
      settled = true; clearTimeout(timer);
      resolve(Object.freeze({ status: "RAW_HEADERS_AND_MERKLE_VALIDATED", ...result,
        utxoTrust: "SEPARATE_NODE_RPC_OBSERVATION_REQUIRED" }));
    });
    child.stdin.end(snapshot);
  });
}

// Public header cache only, bounded to the Mainnet verifier ceiling. It grants
// no verification capability: every returned packet still passes Rust from
// genesis. Reorgs discard the changed suffix; independent reads cannot race a
// partially populated cache. No second index or economic database is created.
async function collectMainnetHeaders(rpc, tipHeight) {
  let cache = MAINNET_HEADER_CACHE.get(rpc);
  if (!cache) { cache = { headers: [], hashes: [NATIVE_MAINNET_GENESIS], busy: false }; MAINNET_HEADER_CACHE.set(rpc, cache); }
  if (cache.busy) throw new Error("RAW_NATIVE_HEADER_READ_IN_PROGRESS");
  cache.busy = true;
  try {
    let common = Math.min(tipHeight, cache.headers.length);
    if (common && (await rpc.call("getblockhash", [common])).result !== cache.hashes[common]) {
      let low = 0, high = common;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((await rpc.call("getblockhash", [middle])).result === cache.hashes[middle]) low = middle;
        else high = middle - 1;
      }
      common = low;
    }
    cache.headers.length = common; cache.hashes.length = common + 1;
    for (let start = common + 1; start <= tipHeight; start += 128) {
      const count = Math.min(128, tipHeight - start + 1), rows = await rpc.getHeadersByHeight(start, count);
      if (!Array.isArray(rows) || rows.length !== count) throw new Error("RAW_NATIVE_HEADER_BATCH_REJECTED");
      for (const [index, row] of rows.entries()) {
        const header = hex(row?.header, 80).toString("hex"), hash = headerId(header);
        const parent = Buffer.from(header.slice(8, 72), "hex").reverse().toString("hex");
        if (row.height !== start + index || row.hash !== hash || parent !== cache.hashes.at(-1)) throw new Error("RAW_NATIVE_HEADER_BATCH_REJECTED");
        cache.headers.push(header); cache.hashes.push(hash);
      }
    }
    return { headers: cache.headers.slice(), hashes: cache.hashes.slice() };
  } finally { cache.busy = false; }
}

export class LocalNativeEvidenceVerifier {
  #rpc;
  #executable;
  #profile;
  constructor({ rpc, executable }, mode) {
    if (mode !== undefined && mode !== MAINNET_VERIFIER) throw new Error("RAW_NATIVE_VERIFIER_MODE_REJECTED");
    this.#rpc = rpc; this.#executable = executable; this.#profile = mode === MAINNET_VERIFIER ? MAINNET_PROFILE : REGTEST_PROFILE;
  }
  static createMainnet(options) { return new LocalNativeEvidenceVerifier(options, MAINNET_VERIFIER); }
  get nativeGenesis() { return this.#profile.genesis; }
  #collect(options) { return collectNativeEvidence({ rpc: this.#rpc, ...options }, this.#profile); }
  #verify(bundle) { return verifyNativeEvidencePacket({ executable: this.#executable, packet: encodeNativeEvidence(bundle, this.#profile) }, this.#profile); }
  #confirmations(value) {
    const required = positive(value, MAX_HEADERS);
    if (this.#profile === MAINNET_PROFILE && required < 12) throw new Error("RAW_NATIVE_MAINNET_FINALITY_POLICY_REQUIRED");
    return required;
  }

  async #verifyCurrentAndAccepted(bundle, checkpoint) {
    const current = await this.#verify(bundle);
    let verified = current;
    if (checkpoint !== undefined) {
      const packet = encodeEvidenceAtCheckpoint(bundle, checkpoint, this.#profile);
      if (createHash("sha256").update(packet).digest("hex") !== current.digestHex) {
        verified = await verifyNativeEvidencePacket({ executable: this.#executable, packet }, this.#profile);
      }
    }
    const acceptedCheckpoint = Object.freeze({ protocol: this.#profile.checkpointProtocol, genesis: this.#profile.genesis,
      tipHash: verified.tipHash, tipHeight: verified.tipHeight,
      chainworkHex: checkpoint?.chainworkHex ?? bundle.chainworkHex,
      minimumConfirmations: bundle.minimumConfirmations, evidenceDigestHex: verified.digestHex });
    return { current, verified, acceptedCheckpoint };
  }

  // Verify the CURRENT branch even when a previously accepted transaction has
  // disappeared from it. A current coinbase anchors a real Merkle proof; it is
  // never a deposit or a reserve credit. The independent Rust verifier checks
  // the complete bounded header sequence and declared chainwork.
  async observeChain() {
    const observedAt = Date.now(), info = await this.#rpc.getBlockchainInfo();
    if (info?.chain !== this.#profile.chain || info.initialblockdownload !== false || info.headers !== info.blocks) throw new Error("RAW_NATIVE_SOURCE_NOT_READY");
    const block = await this.#rpc.getBlock(hex(info.bestblockhash, 32).toString("hex"), 1);
    const ids = boundedArray(block?.tx, MAX_BLOCK_TXIDS);
    if (ids.length === 0) throw new Error("RAW_NATIVE_SOURCE_NOT_READY");
    const bundle = await this.#collect({ transactionIds: [ids[0]], minimumConfirmations: 1,
      transactionBlockHints: { [ids[0]]: hex(info.bestblockhash, 32).toString("hex") } });
    const verified = await this.#verify(bundle);
    if ((await this.#rpc.call("getbestblockhash", [])).result !== verified.tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
    return verifiedChain(bundle, verified, observedAt);
  }

  async verifySweepSigning({ inputs, minimumConfirmations, unsignedTransactionHex, reserveAmountAtomic, feeAtomic, reserveScriptHex, intent, tapscriptSpends, acceptedCheckpoint }) {
    const expected = structuredClone({ inputs, minimumConfirmations, unsignedTransactionHex, reserveAmountAtomic, feeAtomic, reserveScriptHex, intent, tapscriptSpends, acceptedCheckpoint });
    const verified = await this.verifyInputs(expected);
    const tx = parseNativeTransactionHex(expected.unsignedTransactionHex);
    const inputIds = expected.inputs.map((input) => `${input.txid}:${input.vout}`);
    if (tx.inputs.length !== inputIds.length || tx.inputs.some((input, index) => input.outpoint !== inputIds[index])
      || tx.outputs.length !== 1 || tx.outputs[0].amountAtomic !== expected.reserveAmountAtomic
      || tx.outputs[0].scriptPubKeyHex !== expected.reserveScriptHex) throw new Error("RAW_NATIVE_SWEEP_SUBSTITUTED");
    const evidences = createLocalTaprootSighashEvidences({
      unsignedNativeTransactionHex: expected.unsignedTransactionHex,
      spentOutputs: expected.inputs.map((input) => ({ amountAtomic: input.amountAtomic, scriptPubKeyHex: input.scriptPubKeyHex })),
      proofFingerprintHex: verified.digestHex, reserveAmountAtomic: expected.reserveAmountAtomic,
      nativeMinerFeeAtomic: expected.feeAtomic, expectedRecipientScriptPubKeyHex: expected.reserveScriptHex,
      expectedChangeScriptPubKeyHex: expected.reserveScriptHex,
      tapscriptSpends: expected.tapscriptSpends,
    });
    const evidence = evidences[expected.intent.signingInputIndex];
    if (!evidence || expected.intent.purpose !== "RESERVE_SWEEP" || expected.intent.nativeNetwork !== this.#profile.network
      || expected.intent.nativeGenesisHash !== this.#profile.genesis || expected.intent.unsignedNativeTransactionId !== tx.txidHex
      || expected.intent.taprootSighashHex !== evidence.taprootSighashHex || expected.intent.proofFingerprint !== verified.digestHex
      || expected.intent.amountAtomic !== expected.reserveAmountAtomic || expected.intent.feeAtomic !== expected.feeAtomic
      || expected.intent.recipientScriptPubKeyHex !== expected.reserveScriptHex || expected.intent.changeAtomic !== "0"
      || expected.intent.changeScriptPubKeyHex !== expected.reserveScriptHex
      || expected.intent.transactionCommitment !== evidence.transactionCommitment
      || expected.intent.reserveCommitment !== evidence.reserveCommitment
      || JSON.stringify(expected.intent.outputCommitments) !== JSON.stringify(evidence.outputCommitments)
      || JSON.stringify(expected.intent.inputOutpoints) !== JSON.stringify(inputIds)) throw new Error("RAW_NATIVE_SIGNING_INTENT_SUBSTITUTED");
    return verified;
  }

  async verifyInputs({ inputs, minimumConfirmations, acceptedCheckpoint }) {
    this.#confirmations(minimumConfirmations);
    const requested = structuredClone(boundedArray(inputs, MAX_TRANSACTIONS));
    const checkpoint = structuredClone(acceptedCheckpoint);
    const bundle = await this.#collect({
      transactionIds: [...new Set(requested.map((input) => input.txid))], minimumConfirmations: 1 });
    const { current, verified, acceptedCheckpoint: acceptance } = await this.#verifyCurrentAndAccepted(bundle, checkpoint);
    const transactions = bundle.proofs.map((proof) => parseNativeTransactionHex(proof.rawTransactionHex));
    for (const input of requested) {
      const tx = transactions.find((candidate) => candidate.txidHex === input.txid);
      const proof = bundle.proofs[transactions.indexOf(tx)];
      const output = tx?.outputs[integer(input.vout, 0xffff_ffff)];
      if (output?.amountAtomic !== input.amountAtomic || output.scriptPubKeyHex !== input.scriptPubKeyHex) {
        throw new Error("RAW_NATIVE_INPUT_SUBSTITUTED");
      }
      const required = this.#confirmations(input.minimumConfirmations ?? minimumConfirmations);
      if (verified.tipHeight - proof.blockHeight + 1 < required) throw new Error("RAW_NATIVE_INPUT_FINALITY_INSUFFICIENT");
      const utxo = await this.#rpc.getUtxoObservation({ txid: input.txid, vout: input.vout, decimals: 8, includeMempool: true });
      if (!utxo.unspent || utxo.coinbase || utxo.bestBlockHash !== current.tipHash
        || utxo.valueAtomic !== input.amountAtomic || utxo.scriptPubKeyHex !== input.scriptPubKeyHex
        || utxo.confirmations < required) {
        throw new Error("RAW_NATIVE_INPUT_NOT_AVAILABLE");
      }
    }
    if ((await this.#rpc.call("getbestblockhash", [])).result !== current.tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
    return Object.freeze({ ...verified, acceptedCheckpoint: acceptance,
      currentTipHash: current.tipHash, currentTipHeight: current.tipHeight,
      utxoTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION" });
  }


  async verifyReserve({ deposit, feeInputs, sweepTxid, reserveVout, reserveScriptHex, feeAtomic, minimumConfirmations, tapscriptSpends, acceptedCheckpoint }) {
    const observedAt = Date.now();
    const expected = structuredClone({ deposit, feeInputs, sweepTxid, reserveVout, reserveScriptHex, feeAtomic, minimumConfirmations, tapscriptSpends, acceptedCheckpoint });
    if (!Array.isArray(expected.feeInputs) || expected.feeInputs.length > MAX_TRANSACTIONS - 2) throw new Error("RAW_NATIVE_COUNT_INVALID");
    const inputs = [expected.deposit, ...expected.feeInputs];
    const bundle = await this.#collect({
      transactionIds: [...new Set([...inputs.map((input) => input.txid), expected.sweepTxid])],
      minimumConfirmations: this.#confirmations(expected.minimumConfirmations) });
    const { current, verified, acceptedCheckpoint: acceptance } = await this.#verifyCurrentAndAccepted(bundle, expected.acceptedCheckpoint);
    const transactions = bundle.proofs.map((proof) => parseNativeTransactionHex(proof.rawTransactionHex));
    const sweep = transactions.find((tx) => tx.txidHex === expected.sweepTxid);
    const inputIds = inputs.map((input) => `${input.txid}:${integer(input.vout, 0xffff_ffff)}`);
    if (!sweep || new Set(inputIds).size !== inputIds.length || sweep.inputs.length !== inputIds.length
      || sweep.inputs.some((input, index) => input.outpoint !== inputIds[index])
      || sweep.outputs.length !== 1 || expected.reserveVout !== 0) throw new Error("RAW_NATIVE_SWEEP_SUBSTITUTED");
    let total = 0n;
    for (const input of inputs) {
      const tx = transactions.find((candidate) => candidate.txidHex === input.txid);
      const output = tx?.outputs[input.vout];
      if (output?.amountAtomic !== input.amountAtomic || output.scriptPubKeyHex !== input.scriptPubKeyHex) throw new Error("RAW_NATIVE_INPUT_SUBSTITUTED");
      total += atomic(input.amountAtomic);
    }
    const output = sweep.outputs[0];
    if (output.amountAtomic !== expected.deposit.amountAtomic || output.scriptPubKeyHex !== expected.reserveScriptHex
      || total - atomic(output.amountAtomic) !== atomic(expected.feeAtomic)) throw new Error("RAW_NATIVE_SWEEP_VALUE_MISMATCH");
    const witnessSignatures = verifyRegtestSweepSignatures({ sweep, inputs, tapscriptSpends: expected.tapscriptSpends,
      reserveScriptHex: expected.reserveScriptHex });
    const basis = txid => { const proof = bundle.proofs.find(p => parseNativeTransactionHex(p.rawTransactionHex).txidHex === txid);
      return Object.freeze({ txid, height: proof.blockHeight, blockHash: headerId(bundle.headers[proof.blockHeight - 1]) }); };
    const reserveBasis = Object.freeze({ genesis: this.#profile.genesis, chainworkHex: bundle.chainworkHex,
      deposit: Object.freeze({ ...basis(expected.deposit.txid), vout: expected.deposit.vout }),
      sweep: Object.freeze({ ...basis(sweep.txidHex), vout: expected.reserveVout }),
      amountAtomic: output.amountAtomic, reserveScriptHex: output.scriptPubKeyHex });
    const utxo = await this.#rpc.getUtxoObservation({ txid: sweep.txidHex, vout: 0, decimals: 8, includeMempool: true });
    if (utxo.unspent === false) {
      // Exclude mempool spends before classifying canonical reserve loss. The
      // creating sweep's inclusion, exact inputs/output/fees and all signatures
      // have already passed independent raw verification at this same tip.
      const canonical = await this.#rpc.getUtxoObservation({ txid: sweep.txidHex, vout: 0, decimals: 8, includeMempool: false });
      if ((await this.#rpc.call("getbestblockhash", [])).result !== current.tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
      if (canonical.unspent === false) {
        const error = new Error("RAW_NATIVE_RESERVE_SPENT");
        OBSERVED_SPENT_RESERVES.set(error, Object.freeze({ reserveBasis, chain: verifiedChain(bundle, current, observedAt),
          utxoTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION" }));
        throw error;
      }
    }
    if (!utxo.unspent || utxo.coinbase || utxo.bestBlockHash !== current.tipHash
      || utxo.valueAtomic !== output.amountAtomic || utxo.scriptPubKeyHex !== output.scriptPubKeyHex
      || utxo.confirmations < expected.minimumConfirmations) throw new Error("RAW_NATIVE_RESERVE_NOT_AVAILABLE");
    if ((await this.#rpc.call("getbestblockhash", [])).result !== current.tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
    const result = Object.freeze({ ...verified, acceptedCheckpoint: acceptance,
      currentTipHash: current.tipHash, currentTipHeight: current.tipHeight, witnessSignatures, utxoTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION",
      reserveBasis });
    VERIFIED_RESERVES.set(result, verifiedChain(bundle, current, observedAt)); return result;
  }
}

// Verify actual witness bytes separately: a legacy txid alone does not commit
// its witness. This is not full Native script/block validation or a UTXO proof.
export function verifyRegtestSweepSignatures({ sweep, inputs, tapscriptSpends, reserveScriptHex }) {
  if (typeof reserveScriptHex !== "string" || !/^5120[0-9a-f]{64}$/u.test(reserveScriptHex)
    || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > MAX_TRANSACTIONS || inputs.length !== sweep.inputs.length
    || (tapscriptSpends !== undefined && (!Array.isArray(tapscriptSpends) || tapscriptSpends.length !== inputs.length))) {
    throw new Error("RAW_NATIVE_SWEEP_WITNESS_INVALID");
  }
  const publicKey = Buffer.from(reserveScriptHex.slice(4), "hex");
  const spentOutputs = inputs.map(({ amountAtomic, scriptPubKeyHex }) => ({ amountAtomic, scriptPubKeyHex }));
  let scriptPathInputs = 0;
  for (const [index, input] of sweep.inputs.entries()) {
    const script = tapscriptSpends?.[index];
    if (input.witness.length !== (script === undefined ? 1 : 4) || input.witness[0]?.length !== 64) {
      throw new Error("RAW_NATIVE_SWEEP_WITNESS_INVALID");
    }
    if (script === undefined) {
      if (spentOutputs[index].scriptPubKeyHex !== reserveScriptHex) throw new Error("RAW_NATIVE_SWEEP_WITNESS_INVALID");
    } else {
      if (!/^82012088a820[0-9a-f]{64}8820[0-9a-f]{64}ac$/u.test(script.scriptHex)
        || script.scriptHex.slice(-66, -2) !== reserveScriptHex.slice(4)
        || input.witness[1].length !== 32 || Buffer.from(input.witness[1]).toString("hex") !== script.publicPreimageHex
        || createHash("sha256").update(Buffer.from(input.witness[1])).digest("hex") !== script.scriptHex.slice(12, 76)
        || Buffer.from(input.witness[2]).toString("hex") !== script.scriptHex
        || Buffer.from(input.witness[3]).toString("hex") !== script.controlBlockHex) {
        throw new Error("RAW_NATIVE_SWEEP_WITNESS_INVALID");
      }
      verifyTaprootControlBlock({ ...script, scriptPubKeyHex: spentOutputs[index].scriptPubKeyHex });
      scriptPathInputs++;
    }
    const hash = (script === undefined ? taprootKeyPathSighashDefault : taprootScriptPathSighashDefault)({
      transaction: sweep, spentOutputs, inputIndex: index, ...(script === undefined ? {} : { scriptHex: script.scriptHex }) });
    if (!schnorr.verify(Uint8Array.from(input.witness[0]), Buffer.from(hash.sigHashHex, "hex"), publicKey)) {
      throw new Error("RAW_NATIVE_SWEEP_SIGNATURE_INVALID");
    }
  }
  return Object.freeze({ scriptPathInputs, keyPathInputs: inputs.length - scriptPathInputs });
}

function hex(value, length, maximum = length) {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0
    || value.length > maximum * 2 || (length !== undefined && value.length !== length * 2)
    || !/^[0-9a-f]+$/iu.test(value)) throw new Error("RAW_NATIVE_HEX_INVALID");
  return Buffer.from(value, "hex");
}
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error("RAW_NATIVE_COUNT_INVALID");
  return value;
}
function positive(value, maximum) { if (integer(value, maximum) === 0) throw new Error("RAW_NATIVE_COUNT_INVALID"); return value; }
function boundedArray(value, maximum) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw new Error("RAW_NATIVE_COUNT_INVALID");
  return value;
}
function atomic(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value) || BigInt(value) > 0xffff_ffff_ffff_ffffn) throw new Error("RAW_NATIVE_ATOMIC_INVALID");
  return BigInt(value);
}
