// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// REGTEST-only raw header/Merkle verification plus separately identified
// fully-validating-node RPC observations. No keys or broadcasting authority.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { schnorr } from "@noble/curves/secp256k1.js";
import { createLocalTaprootSighashEvidences, parseNativeTransactionHex,
  taprootKeyPathSighashDefault, taprootScriptPathSighashDefault } from "./native-taproot-transaction.mjs";
import { verifyTaprootControlBlock } from "./native-tapscript.mjs";

export const REGTEST_GENESIS = "352a1a62f7880d325da6d3fe2e62272cd0ce735a7ba003eae4fb59d2a175a8b9";
export const MAX_RAW_EVIDENCE_BYTES = 8_000_000;
const MAX_HEADERS = 4096;
const MAX_TRANSACTIONS = 16;
const MAX_BLOCK_TXIDS = 65_536;

export function encodeRegtestEvidence(bundle) {
  if (bundle?.genesisHash !== REGTEST_GENESIS) throw new Error("RAW_NATIVE_WRONG_GENESIS");
  const headers = boundedArray(bundle.headers, MAX_HEADERS);
  const proofs = boundedArray(bundle.proofs, MAX_TRANSACTIONS);
  if (headers.length !== bundle.tipHeight) throw new Error("RAW_NATIVE_HEADER_COUNT_MISMATCH");
  const parts = [Buffer.from("KPNEVD01"), hex(REGTEST_GENESIS, 32), hex(bundle.tipHash, 32),
    u32(bundle.tipHeight), hex(bundle.chainworkHex, 32), u32(positive(bundle.minimumConfirmations, MAX_HEADERS)), u32(headers.length)];
  let byteLength = parts.reduce((sum, part) => sum + part.length, 0);
  const push = (part) => {
    byteLength += part.length;
    if (byteLength > MAX_RAW_EVIDENCE_BYTES) throw new Error("RAW_NATIVE_EVIDENCE_TOO_LARGE");
    parts.push(part);
  };
  for (const header of headers) push(hex(header, 80));
  push(u32(proofs.length));
  for (const proof of proofs) {
    const raw = hex(proof.rawTransactionHex, undefined, 4_000_000);
    const txids = boundedArray(proof.transactionIds, MAX_BLOCK_TXIDS);
    const index = integer(proof.transactionIndex, MAX_BLOCK_TXIDS - 1);
    if (index >= txids.length) throw new Error("RAW_NATIVE_MERKLE_INDEX_INVALID");
    push(u32(raw.length)); push(raw); push(u32(positive(proof.blockHeight, MAX_HEADERS)));
    push(u32(index)); push(u32(txids.length));
    for (const txid of txids) push(hex(txid, 32));
  }
  return Buffer.concat(parts, byteLength);
}

export async function collectRegtestEvidence({ rpc, transactionIds, minimumConfirmations }) {
  const expectedIds = boundedArray(transactionIds, MAX_TRANSACTIONS).map((id) => hex(id, 32).toString("hex"));
  if (new Set(expectedIds).size !== expectedIds.length) throw new Error("RAW_NATIVE_DUPLICATE_TRANSACTION");
  const info = await rpc.getBlockchainInfo();
  if (info?.chain !== "regtest" || info.initialblockdownload !== false || info.headers !== info.blocks) {
    throw new Error("RAW_NATIVE_SOURCE_NOT_READY");
  }
  const tipHeight = positive(info.blocks, MAX_HEADERS);
  const tipHash = hex(info.bestblockhash, 32).toString("hex");
  const genesisHash = (await rpc.call("getblockhash", [0])).result;
  if (genesisHash !== REGTEST_GENESIS) throw new Error("RAW_NATIVE_WRONG_GENESIS");
  const headers = [];
  const hashes = [genesisHash];
  for (let height = 1; height <= tipHeight; height += 1) {
    const blockHash = hex((await rpc.call("getblockhash", [height])).result, 32).toString("hex");
    hashes.push(blockHash);
    headers.push(hex(await rpc.getBlockHeader(blockHash, false), 80).toString("hex"));
  }
  if (hashes[tipHeight] !== tipHash) throw new Error("RAW_NATIVE_SOURCE_CHANGED");
  const proofs = [];
  for (const txid of expectedIds) {
    const transaction = await rpc.getRawTransaction(txid, true);
    const raw = hex(transaction?.hex, undefined, 4_000_000).toString("hex");
    if (parseNativeTransactionHex(raw).txidHex !== txid) throw new Error("RAW_NATIVE_TRANSACTION_SUBSTITUTED");
    const blockHash = hex(transaction.blockhash, 32).toString("hex");
    const block = await rpc.getBlock(blockHash, 1);
    const blockHeight = positive(block?.height, MAX_HEADERS);
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
  if (typeof executable !== "string" || !path.isAbsolute(executable)) throw new Error("RAW_NATIVE_VERIFIER_PATH_REQUIRED");
  if (!(packet instanceof Uint8Array) || packet.length > MAX_RAW_EVIDENCE_BYTES) throw new Error("RAW_NATIVE_EVIDENCE_TOO_LARGE");
  // Copy before spawning: asynchronous signing policy must not observe mutable bytes.
  const snapshot = Buffer.from(packet);
  const digestHex = createHash("sha256").update(snapshot).digest("hex");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["--regtest-verify"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let captured = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill();
      reject(new Error("RAW_NATIVE_VERIFICATION_FAILED"));
    };
    const timer = setTimeout(fail, 15_000);
    child.on("error", fail);
    child.stdin.on("error", fail);
    for (const [stream, capture] of [[child.stdout, true], [child.stderr, false]]) {
      stream.on("data", (data) => {
        captured += data.length;
        if (captured > 1024) { fail(); return; }
        if (capture) output += data.toString("utf8");
      });
    }
    child.on("close", (code) => {
      if (settled) return;
      const match = /^KPNEV_OK_V1 ([0-9a-f]{64}) ([0-9a-f]{64}) ([1-9][0-9]{0,3}) ([1-9][0-9]?)\r?\n$/u.exec(output);
      if (code !== 0 || !match || match[1] !== digestHex
        || Number(match[3]) > MAX_HEADERS || Number(match[4]) > MAX_TRANSACTIONS) { fail(); return; }
      settled = true; clearTimeout(timer);
      resolve(Object.freeze({ status: "RAW_HEADERS_AND_MERKLE_VALIDATED", digestHex,
        tipHash: match[2], tipHeight: positive(Number(match[3]), MAX_HEADERS),
        transactions: positive(Number(match[4]), MAX_TRANSACTIONS),
        utxoTrust: "SEPARATE_NODE_RPC_OBSERVATION_REQUIRED" }));
    });
    child.stdin.end(snapshot);
  });
}

export class LocalNativeEvidenceVerifier {
  #rpc;
  #executable;
  constructor({ rpc, executable }) { this.#rpc = rpc; this.#executable = executable; }

  async verifySweepSigning({ inputs, minimumConfirmations, unsignedTransactionHex, reserveAmountAtomic, feeAtomic, reserveScriptHex, intent, tapscriptSpends }) {
    const expected = structuredClone({ inputs, minimumConfirmations, unsignedTransactionHex, reserveAmountAtomic, feeAtomic, reserveScriptHex, intent, tapscriptSpends });
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
    if (!evidence || expected.intent.purpose !== "RESERVE_SWEEP" || expected.intent.nativeNetwork !== "regtest"
      || expected.intent.nativeGenesisHash !== REGTEST_GENESIS || expected.intent.unsignedNativeTransactionId !== tx.txidHex
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

  async verifyInputs({ inputs, minimumConfirmations }) {
    const requested = structuredClone(boundedArray(inputs, MAX_TRANSACTIONS));
    const bundle = await collectRegtestEvidence({ rpc: this.#rpc,
      transactionIds: [...new Set(requested.map((input) => input.txid))], minimumConfirmations: 1 });
    const packet = encodeRegtestEvidence(bundle);
    const verified = await verifyRegtestEvidencePacket({ executable: this.#executable, packet });
    const transactions = bundle.proofs.map((proof) => parseNativeTransactionHex(proof.rawTransactionHex));
    for (const input of requested) {
      const tx = transactions.find((candidate) => candidate.txidHex === input.txid);
      const proof = bundle.proofs[transactions.indexOf(tx)];
      const output = tx?.outputs[integer(input.vout, 0xffff_ffff)];
      if (output?.amountAtomic !== input.amountAtomic || output.scriptPubKeyHex !== input.scriptPubKeyHex) {
        throw new Error("RAW_NATIVE_INPUT_SUBSTITUTED");
      }
      const required = positive(input.minimumConfirmations ?? minimumConfirmations, MAX_HEADERS);
      if (bundle.tipHeight - proof.blockHeight + 1 < required) throw new Error("RAW_NATIVE_INPUT_FINALITY_INSUFFICIENT");
      const utxo = await this.#rpc.getUtxoObservation({ txid: input.txid, vout: input.vout, decimals: 8, includeMempool: true });
      if (!utxo.unspent || utxo.coinbase || utxo.bestBlockHash !== verified.tipHash
        || utxo.valueAtomic !== input.amountAtomic || utxo.scriptPubKeyHex !== input.scriptPubKeyHex
        || utxo.confirmations < required) {
        throw new Error("RAW_NATIVE_INPUT_NOT_AVAILABLE");
      }
    }
    return Object.freeze({ ...verified, utxoTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION" });
  }

  async verifyReserve({ deposit, feeInputs, sweepTxid, reserveVout, reserveScriptHex, feeAtomic, minimumConfirmations, tapscriptSpends }) {
    const expected = structuredClone({ deposit, feeInputs, sweepTxid, reserveVout, reserveScriptHex, feeAtomic, minimumConfirmations, tapscriptSpends });
    if (!Array.isArray(expected.feeInputs) || expected.feeInputs.length > MAX_TRANSACTIONS - 2) throw new Error("RAW_NATIVE_COUNT_INVALID");
    const inputs = [expected.deposit, ...expected.feeInputs];
    const bundle = await collectRegtestEvidence({ rpc: this.#rpc,
      transactionIds: [...new Set([...inputs.map((input) => input.txid), expected.sweepTxid])],
      minimumConfirmations: positive(expected.minimumConfirmations, MAX_HEADERS) });
    const packet = encodeRegtestEvidence(bundle);
    const verified = await verifyRegtestEvidencePacket({ executable: this.#executable, packet });
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
    const utxo = await this.#rpc.getUtxoObservation({ txid: sweep.txidHex, vout: 0, decimals: 8, includeMempool: true });
    if (!utxo.unspent || utxo.coinbase || utxo.bestBlockHash !== verified.tipHash
      || utxo.valueAtomic !== output.amountAtomic || utxo.scriptPubKeyHex !== output.scriptPubKeyHex
      || utxo.confirmations < expected.minimumConfirmations) throw new Error("RAW_NATIVE_RESERVE_NOT_AVAILABLE");
    return Object.freeze({ ...verified, witnessSignatures, utxoTrust: "CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION" });
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
function u32(value) { const out = Buffer.alloc(4); out.writeUInt32LE(integer(value, 0xffff_ffff)); return out; }
function atomic(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value) || BigInt(value) > 0xffff_ffff_ffff_ffffn) throw new Error("RAW_NATIVE_ATOMIC_INVALID");
  return BigInt(value);
}
