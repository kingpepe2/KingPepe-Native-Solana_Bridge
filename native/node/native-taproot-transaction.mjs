import { bridgeInputDigest } from "../../shared/protocol/bridge-inputs.mjs";
import { createHash } from "node:crypto";
import { tapLeafHashHex, verifyTaprootControlBlock } from "./native-tapscript.mjs";
import {
  bytesToHex,
  hexToBytes,
} from "../../shared/protocol/canonical-message.mjs";

export const LOCAL_NATIVE_TAPROOT_TRANSACTION_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_TAPROOT_TRANSACTION/V1";
export const LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE/V1";
export const LOCAL_NATIVE_TAPROOT_SIGHASH_VALIDATED =
  "LOCALLY_VALIDATED_NATIVE_SIGHASH";
export const SIGHASH_DEFAULT = 0x00;

// Small deterministic key-path payout builder. No wallet key or RPC signing.
export function createUnsignedNativePayout({ inputs, outputs }) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 8 ||
      !Array.isArray(outputs) || outputs.length < 1 || outputs.length > 2) throw new Error("NativePayoutShapeRejected");
  const ids = new Set();
  const nativeInputs = inputs.map(input => {
    if (!/^[0-9a-f]{64}$/u.test(input?.txid ?? "") || !Number.isInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff ||
        ids.has(`${input.txid}:${input.vout}`)) throw new Error("NativePayoutInputRejected");
    ids.add(`${input.txid}:${input.vout}`);
    return { serializedOutpoint: Buffer.concat([Buffer.from(input.txid, "hex").reverse(), uint32LE(input.vout)]), scriptSig: Buffer.alloc(0), sequence: 0xffffffff };
  });
  for (const output of outputs) {
    canonicalUintDecimal(output.amountAtomic, "payout output");
    if (BigInt(output.amountAtomic) === 0n || !/^(?:0014[0-9a-f]{40}|0020[0-9a-f]{64}|5120[0-9a-f]{64})$/u.test(output.scriptPubKeyHex)) throw new Error("NativePayoutOutputRejected");
  }
  const raw = serializeNativeTransactionParts({ version: 2, inputs: nativeInputs, outputs, lockTime: 0 });
  return parseNativeTransactionHex(raw.toString("hex")).rawHex;
}

const MAX_NATIVE_TRANSACTION_BYTES = 4_000_000;
const MAX_NATIVE_TRANSACTION_INPUTS = 100_000;
const MAX_NATIVE_TRANSACTION_OUTPUTS = 500_000;
const MAX_NATIVE_TRANSACTION_WITNESS_ITEMS = 100_000;

export function createLocalTaprootSighashEvidence(input) {
  const value = requireObject(input, "input");
  const transaction = parseNativeTransactionHex(value.unsignedNativeTransactionHex);
  const spentOutputs = normalizeSpentOutputs(value.spentOutputs, transaction.inputs.length);
  const signingInputIndex = checkedNonNegativeSafeInteger(value.signingInputIndex, "signingInputIndex");
  if (signingInputIndex >= transaction.inputs.length) {
    throw new Error("NativeTaprootSigningInputIndexOutOfRange");
  }
  const signingSpentOutput = spentOutputs[signingInputIndex];
  if (!isP2trScriptPubKeyHex(signingSpentOutput.scriptPubKeyHex)) {
    throw new Error("NativeTaprootSigningInputMustSpendP2tr");
  }
  const expectedRecipientScriptPubKeyHex =
    value.expectedRecipientScriptPubKeyHex === undefined
      ? undefined
      : normalizeNonEmptyHex(value.expectedRecipientScriptPubKeyHex, "expectedRecipientScriptPubKeyHex");
  const expectedChangeScriptPubKeyHex =
    value.expectedChangeScriptPubKeyHex === undefined
      ? expectedRecipientScriptPubKeyHex
      : normalizeNonEmptyHex(value.expectedChangeScriptPubKeyHex, "expectedChangeScriptPubKeyHex");
  const reserveAmountAtomic = canonicalUintDecimal(value.reserveAmountAtomic, "reserveAmountAtomic");
  const nativeMinerFeeAtomic = canonicalUintDecimal(value.nativeMinerFeeAtomic, "nativeMinerFeeAtomic");
  const reserveOutput = findUniqueReserveOutput({
    transaction,
    reserveAmountAtomic,
    expectedRecipientScriptPubKeyHex,
  });
  const changeAtomic = calculateChangeAtomic({
    transaction,
    reserveOutputIndex: reserveOutput.index,
    expectedChangeScriptPubKeyHex,
  });
  const computedFeeAtomic = transactionFeeAtomic(transaction, spentOutputs);
  if (computedFeeAtomic !== nativeMinerFeeAtomic) {
    throw new Error("NativeTaprootSighashFeeMismatch");
  }

  const tapscriptSpend = value.tapscriptSpend;
  if (tapscriptSpend !== undefined) {
    verifyTaprootControlBlock({ ...tapscriptSpend, scriptPubKeyHex: signingSpentOutput.scriptPubKeyHex });
  }
  const sighash = (tapscriptSpend === undefined ? taprootKeyPathSighashDefault : taprootScriptPathSighashDefault)({
    transaction,
    spentOutputs,
    inputIndex: signingInputIndex,
    ...(tapscriptSpend === undefined ? {} : { scriptHex: tapscriptSpend.scriptHex }),
  });
  const outputCommitments = transaction.outputs.map((output, index) =>
    bridgeInputDigest("IndexedOutput", { index, amountAtomic: output.amountAtomic, scriptPubKeyHex: output.scriptPubKeyHex }),
  );

  return Object.freeze({
    protocol: LOCAL_NATIVE_TAPROOT_SIGHASH_EVIDENCE_PROTOCOL,
    state: LOCAL_NATIVE_TAPROOT_SIGHASH_VALIDATED,
    unsignedNativeTransactionFingerprintHex: sha256Hex(transaction.raw),
    nativeSweepTxidHex: transaction.txidHex,
    unsignedNativeTransactionId: transaction.txidHex,
    transactionCommitment: bridgeInputDigest("TransactionCommitment", {
      protocol: `${LOCAL_NATIVE_TAPROOT_TRANSACTION_PROTOCOL}/TRANSACTION_COMMITMENT`,
      txidHex: transaction.txidHex,
      inputOutpoints: transaction.inputs.map((entry) => entry.outpoint),
      outputCommitments,
      shaPrevouts: sighash.precomputed.shaPrevouts,
      shaAmounts: sighash.precomputed.shaAmounts,
      shaScriptPubKeys: sighash.precomputed.shaScriptPubKeys,
      shaSequences: sighash.precomputed.shaSequences,
      shaOutputs: sighash.precomputed.shaOutputs,
    }),
    taprootSighashHex: sighash.sigHashHex,
    taprootSigMsgWithEpochHex: sighash.sigMsgWithEpochHex,
    proofFingerprintHex: normalizeHash32(value.proofFingerprintHex, "proofFingerprintHex"),
    signingInputIndex,
    ...(tapscriptSpend === undefined ? {} : { tapscriptSpend: Object.freeze({
      scriptHex: tapscriptSpend.scriptHex, controlBlockHex: tapscriptSpend.controlBlockHex,
      ...(tapscriptSpend.publicPreimageHex === undefined ? {} : { publicPreimageHex: tapscriptSpend.publicPreimageHex }),
    }) }),
    recipientScriptPubKeyHex: reserveOutput.output.scriptPubKeyHex,
    changeScriptPubKeyHex: expectedChangeScriptPubKeyHex ?? reserveOutput.output.scriptPubKeyHex,
    changeAtomic,
    nativeMinerFeeAtomic,
    reserveAmountAtomic,
    inputOutpoints: Object.freeze(transaction.inputs.map((entry) => entry.outpoint)),
    spentOutputCommitments: Object.freeze(
      spentOutputs.map((output, index) =>
        bridgeInputDigest("IndexedOutput", { index, amountAtomic: output.amountAtomic, scriptPubKeyHex: output.scriptPubKey }),
      ),
    ),
    outputCommitments: Object.freeze(outputCommitments),
    reserveCommitment: outputCommitments[reserveOutput.index],
  });
}

export function createLocalTaprootSighashEvidences(input) {
  const value = requireObject(input, "input");
  const transaction = parseNativeTransactionHex(value.unsignedNativeTransactionHex);
  if (value.tapscriptSpends !== undefined && (!Array.isArray(value.tapscriptSpends) || value.tapscriptSpends.length !== transaction.inputs.length)) {
    throw new Error("NativeTaprootScriptSpendsLengthMismatch");
  }
  return Object.freeze(
    transaction.inputs.map((_, index) =>
      createLocalTaprootSighashEvidence({
        ...value,
        signingInputIndex: index,
        tapscriptSpend: value.tapscriptSpends?.[index],
      }),
    ),
  );
}

export function taprootKeyPathSighashDefault(input) {
  return taprootDefaultSighash(input, 0);
}

export function taprootScriptPathSighashDefault(input) {
  return taprootDefaultSighash(input, 1);
}

function taprootDefaultSighash(input, expectedExtension) {
  const value = requireObject(input, "input");
  const transaction =
    typeof value.transaction === "string"
      ? parseNativeTransactionHex(value.transaction)
      : normalizeParsedTransaction(value.transaction);
  const spentOutputs = normalizeSpentOutputs(value.spentOutputs, transaction.inputs.length);
  const inputIndex = checkedNonNegativeSafeInteger(value.inputIndex, "inputIndex");
  if (inputIndex >= transaction.inputs.length) {
    throw new Error("NativeTaprootSighashInputIndexOutOfRange");
  }
  const hashType = checkedByte(value.hashType ?? SIGHASH_DEFAULT, "hashType");
  if (hashType !== SIGHASH_DEFAULT) {
    throw new Error("NativeTaprootSighashOnlyDefaultSupported");
  }
  const extFlag = checkedNonNegativeSafeInteger(value.extFlag ?? expectedExtension, "extFlag");
  if (extFlag !== expectedExtension) {
    throw new Error("NativeTaprootSighashExtensionsUnsupported");
  }
  if (value.annex !== undefined) {
    throw new Error("NativeTaprootSighashAnnexUnsupported");
  }
  if (value.codeSeparatorPosition !== undefined && value.codeSeparatorPosition !== 0xffff_ffff) {
    throw new Error("NativeTaprootCodeSeparatorUnsupported");
  }
  const extension = extFlag === 0 ? Buffer.alloc(0) : Buffer.concat([
    Buffer.from(tapLeafHashHex(value.scriptHex), "hex"), Buffer.of(0), uint32LE(0xffff_ffff),
  ]);

  const precomputed = taprootPrecomputedHashes(transaction, spentOutputs);
  const sigMsg = Buffer.concat([
    Buffer.of(hashType),
    int32LE(transaction.version),
    uint32LE(transaction.lockTime),
    hexToBuffer(precomputed.shaPrevouts, "shaPrevouts"),
    hexToBuffer(precomputed.shaAmounts, "shaAmounts"),
    hexToBuffer(precomputed.shaScriptPubKeys, "shaScriptPubKeys"),
    hexToBuffer(precomputed.shaSequences, "shaSequences"),
    hexToBuffer(precomputed.shaOutputs, "shaOutputs"),
    Buffer.of(extFlag * 2),
    uint32LE(inputIndex),
  ]);
  const sigMsgWithEpoch = Buffer.concat([Buffer.of(0), sigMsg, extension]);
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TAPROOT_TRANSACTION_PROTOCOL}/${extFlag === 0 ? "KEY_PATH" : "SCRIPT_PATH"}_SIGHASH_DEFAULT`,
    hashType,
    extFlag,
    inputIndex,
    sigMsgWithEpochHex: bytesToHex(sigMsgWithEpoch),
    sigHashHex: taggedHashHex("TapSighash", sigMsgWithEpoch),
    precomputed,
  });
}

export function taprootPrecomputedHashes(transactionInput, spentOutputsInput) {
  const transaction = normalizeParsedTransaction(transactionInput);
  const spentOutputs = normalizeSpentOutputs(spentOutputsInput, transaction.inputs.length);
  return Object.freeze({
    shaPrevouts: sha256Hex(Buffer.concat(transaction.inputs.map((input) => input.serializedOutpoint))),
    shaAmounts: sha256Hex(Buffer.concat(spentOutputs.map((output) => uint64LE(BigInt(output.amountAtomic))))),
    shaScriptPubKeys: sha256Hex(Buffer.concat(spentOutputs.map((output) => serializeScript(output.scriptPubKey)))),
    shaSequences: sha256Hex(Buffer.concat(transaction.inputs.map((input) => uint32LE(input.sequence)))),
    shaOutputs: sha256Hex(Buffer.concat(transaction.outputs.map((output) => serializeTransactionOutput(output)))),
  });
}

export function parseNativeTransactionHex(rawTransactionHex) {
  const raw = hexToBuffer(normalizeHex(rawTransactionHex, "rawTransactionHex"), "rawTransactionHex");
  if (raw.length > MAX_NATIVE_TRANSACTION_BYTES) {
    throw new Error("NativeTransactionTooLarge");
  }
  if (raw.length < 10) {
    throw new Error("NativeTransactionTooShort");
  }
  const reader = new ByteReader(raw);
  const version = reader.int32("transaction version");
  let hasWitness = false;
  let inputCount;
  if (reader.remaining() >= 2 && reader.peek(0) === 0 && reader.peek(1) !== 0) {
    const marker = reader.uint8("witness marker");
    const flags = reader.uint8("witness flags");
    if (marker !== 0 || flags !== 1) {
      throw new Error("NativeTransactionUnsupportedWitnessSerialization");
    }
    hasWitness = true;
    inputCount = reader.varint("input count");
  } else {
    inputCount = reader.varint("input count");
  }
  if (inputCount > MAX_NATIVE_TRANSACTION_INPUTS) {
    throw new Error("NativeTransactionTooManyInputs");
  }
  const inputs = [];
  for (let index = 0; index < inputCount; index += 1) {
    const previousTxidLe = reader.bytes(32, "previous txid");
    const previousVout = reader.uint32("previous vout");
    const scriptSig = reader.bytes(reader.varint("scriptSig length"), "scriptSig");
    const sequence = reader.uint32("sequence");
    const previousTxidHex = bytesToHex(Buffer.from(previousTxidLe).reverse());
    inputs.push(
      Object.freeze({
        previousTxidHex,
        previousVout,
        outpoint: `${previousTxidHex}:${previousVout}`,
        scriptSigHex: bytesToHex(scriptSig),
        scriptSig,
        sequence,
        witness: Object.freeze([]),
        serializedOutpoint: Buffer.concat([previousTxidLe, uint32LE(previousVout)]),
      }),
    );
  }
  const outputCount = reader.varint("output count");
  if (outputCount > MAX_NATIVE_TRANSACTION_OUTPUTS) {
    throw new Error("NativeTransactionTooManyOutputs");
  }
  const outputs = [];
  for (let index = 0; index < outputCount; index += 1) {
    const amountAtomic = reader.uint64("output value").toString();
    const scriptPubKey = reader.bytes(reader.varint("scriptPubKey length"), "scriptPubKey");
    outputs.push(
      Object.freeze({
        index,
        amountAtomic,
        scriptPubKey,
        scriptPubKeyHex: bytesToHex(scriptPubKey),
      }),
    );
  }
  let totalWitnessItems = 0;
  if (hasWitness) {
    for (let index = 0; index < inputs.length; index += 1) {
      const itemCount = reader.varint("witness item count");
      totalWitnessItems += itemCount;
      if (totalWitnessItems > MAX_NATIVE_TRANSACTION_WITNESS_ITEMS) {
        throw new Error("NativeTransactionTooManyWitnessItems");
      }
      const witness = [];
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        witness.push(reader.bytes(reader.varint("witness item length"), "witness item"));
      }
      inputs[index] = Object.freeze({
        ...inputs[index],
        witness: Object.freeze(witness),
      });
    }
    if (totalWitnessItems === 0) {
      throw new Error("NativeTransactionEmptyWitnessSerialization");
    }
  }
  const lockTime = reader.uint32("lock time");
  if (reader.remaining() !== 0) {
    throw new Error("NativeTransactionTrailingData");
  }
  const stripped = serializeNativeTransactionParts({
    version,
    inputs,
    outputs,
    lockTime,
    includeWitness: false,
  });
  const wtxidBytes = hasWitness
    ? sha256d(raw)
    : sha256d(stripped);
  const txidBytes = sha256d(stripped);
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TAPROOT_TRANSACTION_PROTOCOL}/PARSED`,
    raw,
    rawHex: bytesToHex(raw),
    version,
    hasWitness,
    inputs: Object.freeze(inputs),
    outputs: Object.freeze(outputs),
    lockTime,
    stripped,
    strippedHex: bytesToHex(stripped),
    txidHex: displayHashHex(txidBytes),
    wtxidHex: displayHashHex(wtxidBytes),
  });
}

export function attachKeyPathTaprootWitnesses(input) {
  if (input?.tapscriptSpends !== undefined) throw new Error("NativeTaprootKeyPathAttachmentRejectsScripts");
  return attachTaprootWitnesses(input);
}

export function attachTaprootWitnesses(input) {
  const value = requireObject(input, "input");
  const transaction = parseNativeTransactionHex(value.unsignedNativeTransactionHex);
  if (transaction.hasWitness) {
    throw new Error("NativeTaprootWitnessAttachmentRequiresUnsignedTransaction");
  }
  if (!Array.isArray(value.signatures) || value.signatures.length !== transaction.inputs.length) {
    throw new Error("NativeTaprootWitnessSignaturesLengthMismatch");
  }
  if (value.tapscriptSpends !== undefined && (!Array.isArray(value.tapscriptSpends) || value.tapscriptSpends.length !== transaction.inputs.length)) {
    throw new Error("NativeTaprootScriptSpendsLengthMismatch");
  }
  const spentOutputs = value.tapscriptSpends === undefined ? undefined : normalizeSpentOutputs(value.spentOutputs, transaction.inputs.length);
  const witnessStacks = value.signatures.map((signature, index) => {
    const signatureBytes = normalizeTaprootSignature(signature, `signatures[${index}]`);
    const scriptSpend = value.tapscriptSpends?.[index];
    if (scriptSpend === undefined) return Object.freeze([signatureBytes]);
    verifyTaprootControlBlock({ ...scriptSpend, scriptPubKeyHex: spentOutputs[index].scriptPubKeyHex });
    const preimage = scriptSpend.publicPreimageHex;
    if (preimage !== undefined && (typeof preimage !== "string" || !/^[0-9a-f]{64}$/u.test(preimage))) {
      throw new Error("NativeTaprootPublicPreimageInvalid");
    }
    return Object.freeze([signatureBytes, ...(preimage === undefined ? [] : [Buffer.from(preimage, "hex")]),
      Buffer.from(scriptSpend.scriptHex, "hex"), Buffer.from(scriptSpend.controlBlockHex, "hex")]);
  });
  const rawSignedTransaction = serializeNativeTransactionParts({
    version: transaction.version,
    inputs: transaction.inputs,
    outputs: transaction.outputs,
    lockTime: transaction.lockTime,
    includeWitness: true,
    witnessStacks,
  });
  const signed = parseNativeTransactionHex(bytesToHex(rawSignedTransaction));
  if (signed.txidHex !== transaction.txidHex) {
    throw new Error("NativeTaprootWitnessAttachmentTxidChanged");
  }
  return Object.freeze({
    protocol: `${LOCAL_NATIVE_TAPROOT_TRANSACTION_PROTOCOL}/${value.tapscriptSpends === undefined ? "KEY_PATH" : "MIXED_TAPROOT"}_WITNESS_ATTACHMENT`,
    state: "SIGNED_WITNESS_ATTACHED",
    rawSignedTransactionHex: signed.rawHex,
    txidHex: signed.txidHex,
    wtxidHex: signed.wtxidHex,
    witnessInputCount: witnessStacks.length,
  });
}

function serializeNativeTransactionParts({
  version,
  inputs,
  outputs,
  lockTime,
  includeWitness = false,
  witnessStacks = [],
}) {
  const chunks = [int32LE(version)];
  if (includeWitness) {
    chunks.push(Buffer.from([0, 1]));
  }
  chunks.push(encodeVarint(inputs.length));
  for (const input of inputs) {
    chunks.push(input.serializedOutpoint);
    chunks.push(serializeScript(input.scriptSig));
    chunks.push(uint32LE(input.sequence));
  }
  chunks.push(encodeVarint(outputs.length));
  for (const output of outputs) {
    chunks.push(serializeTransactionOutput(output));
  }
  if (includeWitness) {
    if (witnessStacks.length !== inputs.length) {
      throw new Error("NativeTransactionWitnessStackLengthMismatch");
    }
    for (const stack of witnessStacks) {
      chunks.push(encodeVarint(stack.length));
      for (const item of stack) {
        chunks.push(serializeScript(item));
      }
    }
  }
  chunks.push(uint32LE(lockTime));
  return Buffer.concat(chunks);
}

function serializeTransactionOutput(outputInput) {
  const output = requireObject(outputInput, "transactionOutput");
  return Buffer.concat([
    uint64LE(BigInt(canonicalUintDecimal(output.amountAtomic, "transactionOutput.amountAtomic"))),
    serializeScript(output.scriptPubKey ?? hexToBuffer(output.scriptPubKeyHex, "transactionOutput.scriptPubKeyHex")),
  ]);
}

function serializeScript(bytes) {
  const value = Buffer.from(bytes);
  return Buffer.concat([encodeVarint(value.length), value]);
}

function findUniqueReserveOutput({
  transaction,
  reserveAmountAtomic,
  expectedRecipientScriptPubKeyHex,
}) {
  const matches = transaction.outputs.filter(
    (output) =>
      output.amountAtomic === reserveAmountAtomic &&
      (expectedRecipientScriptPubKeyHex === undefined ||
        output.scriptPubKeyHex === expectedRecipientScriptPubKeyHex),
  );
  if (matches.length !== 1) {
    throw new Error("NativeTaprootReserveOutputNotUnique");
  }
  return Object.freeze({
    index: matches[0].index,
    output: matches[0],
  });
}

function calculateChangeAtomic({
  transaction,
  reserveOutputIndex,
  expectedChangeScriptPubKeyHex,
}) {
  if (expectedChangeScriptPubKeyHex === undefined) return "0";
  let change = 0n;
  for (const output of transaction.outputs) {
    if (output.index !== reserveOutputIndex && output.scriptPubKeyHex === expectedChangeScriptPubKeyHex) {
      change += BigInt(output.amountAtomic);
    }
  }
  return change.toString();
}

function transactionFeeAtomic(transaction, spentOutputs) {
  const totalIn = spentOutputs.reduce((sum, output) => sum + BigInt(output.amountAtomic), 0n);
  const totalOut = transaction.outputs.reduce((sum, output) => sum + BigInt(output.amountAtomic), 0n);
  if (totalIn < totalOut) {
    throw new Error("NativeTaprootTransactionOutputsExceedInputs");
  }
  return (totalIn - totalOut).toString();
}

function normalizeSpentOutputs(value, expectedLength) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error("NativeTaprootSpentOutputsLengthMismatch");
  }
  return Object.freeze(
    value.map((entry, index) => {
      const output = requireObject(entry, `spentOutputs[${index}]`);
      const amountAtomic = canonicalUintDecimal(
        output.amountAtomic ?? output.valueAtomic ?? output.amountSats?.toString(),
        `spentOutputs[${index}].amountAtomic`,
      );
      return Object.freeze({
        amountAtomic,
        scriptPubKeyHex: normalizeNonEmptyHex(
          output.scriptPubKeyHex ?? output.scriptPubKey,
          `spentOutputs[${index}].scriptPubKeyHex`,
        ),
        scriptPubKey: hexToBuffer(
          output.scriptPubKeyHex ?? output.scriptPubKey,
          `spentOutputs[${index}].scriptPubKeyHex`,
        ),
      });
    }),
  );
}

function normalizeParsedTransaction(value) {
  const transaction = requireObject(value, "transaction");
  if (!Array.isArray(transaction.inputs) || !Array.isArray(transaction.outputs)) {
    throw new Error("NativeTransactionParsedShapeInvalid");
  }
  return transaction;
}

function normalizeTaprootSignature(value, label) {
  const bytes = hexToBuffer(normalizeHex(value, label), label);
  if (bytes.length !== 64 && bytes.length !== 65) {
    throw new Error(`${label}:ExpectedTaprootSignature`);
  }
  if (bytes.length === 65 && bytes[64] === SIGHASH_DEFAULT) {
    throw new Error(`${label}:DefaultSighashByteMustBeOmitted`);
  }
  if (bytes.length === 65) {
    throw new Error(`${label}:NonDefaultSighashByteUnsupported`);
  }
  return bytes;
}

function isP2trScriptPubKeyHex(value) {
  return /^5120[0-9a-f]{64}$/u.test(value);
}

function taggedHashHex(tag, payload) {
  const tagHash = sha256(Buffer.from(tag, "utf8"));
  return sha256Hex(Buffer.concat([tagHash, tagHash, Buffer.from(payload)]));
}

function displayHashHex(internalDigest) {
  return bytesToHex(Buffer.from(internalDigest).reverse());
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest();
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256d(bytes) {
  return sha256(sha256(bytes));
}

function encodeVarint(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("NativeCompactSizeInvalid");
  }
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) return Buffer.concat([Buffer.from([0xfd]), uint16LE(value)]);
  if (value <= 0xffff_ffff) return Buffer.concat([Buffer.from([0xfe]), uint32LE(value)]);
  return Buffer.concat([Buffer.from([0xff]), uint64LE(BigInt(value))]);
}

class ByteReader {
  #bytes;
  #offset = 0;

  constructor(bytes) {
    this.#bytes = Buffer.from(bytes);
  }

  remaining() {
    return this.#bytes.length - this.#offset;
  }

  peek(offset) {
    return this.#bytes[this.#offset + offset];
  }

  bytes(length, label) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`${label}:InvalidLength`);
    }
    if (length > this.remaining()) {
      throw new Error(`${label}:BufferUnderflow`);
    }
    const start = this.#offset;
    this.#offset += length;
    return this.#bytes.subarray(start, start + length);
  }

  uint8(label) {
    return this.bytes(1, label)[0];
  }

  int32(label) {
    return this.bytes(4, label).readInt32LE(0);
  }

  uint32(label) {
    return this.bytes(4, label).readUInt32LE(0);
  }

  uint64(label) {
    const value = this.bytes(8, label).readBigUInt64LE(0);
    if (value > 0x7fff_ffff_ffff_ffffn) {
      throw new Error(`${label}:AmountOutOfRange`);
    }
    return value;
  }

  varint(label) {
    const prefix = this.uint8(label);
    if (prefix < 0xfd) return prefix;
    if (prefix === 0xfd) {
      const value = this.bytes(2, label).readUInt16LE(0);
      if (value < 0xfd) throw new Error(`${label}:NonCanonicalCompactSize`);
      return value;
    }
    if (prefix === 0xfe) {
      const value = this.uint32(label);
      if (value <= 0xffff) throw new Error(`${label}:NonCanonicalCompactSize`);
      return value;
    }
    const value = this.bytes(8, label).readBigUInt64LE(0);
    if (value <= 0xffff_ffffn || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label}:CompactSizeOutOfRange`);
    }
    return Number(value);
  }
}

function checkedByte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label}:ExpectedByte`);
  }
  return value;
}

function checkedNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}:ExpectedNonNegativeSafeInteger`);
  }
  return value;
}

function int32LE(value) {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new Error("NativeInt32OutOfRange");
  }
  const out = Buffer.alloc(4);
  out.writeInt32LE(value, 0);
  return out;
}

function uint16LE(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("NativeUint16OutOfRange");
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function uint32LE(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("NativeUint32OutOfRange");
  }
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function uint64LE(value) {
  if (typeof value !== "bigint" || value < 0n || value > 0x7fff_ffff_ffff_ffffn) {
    throw new Error("NativeUint64OutOfRange");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function hexToBuffer(value, label) {
  return Buffer.from(hexToBytes(value, label));
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized.length !== 64) {
    throw new Error(`${label}:Expected32ByteHex`);
  }
  return normalized;
}

function normalizeNonEmptyHex(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized.length === 0) {
    throw new Error(`${label}:ExpectedNonEmptyHex`);
  }
  return normalized;
}

function normalizeHex(value, label) {
  if (typeof value !== "string" || value.length % 2 !== 0 || /[^0-9a-f]/iu.test(value)) {
    throw new Error(`${label}:ExpectedHex`);
  }
  return value.toLowerCase();
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}
