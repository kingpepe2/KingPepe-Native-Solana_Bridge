import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateRuntimeFile, validateRuntimeStateRoot as validateStateRootOutsideRepo } from "../../shared/runtime-path-boundary.mjs";
import { RPC_OBSERVATION, SOURCE_READY, decimalCoinsToAtomic } from "../../native/node/native-rpc-client.mjs";
import {
  REQUIRED_FROST_SIGNERS,
  nativeSigningIntentDigest,
  validateNativeSigningIntent,
} from "../../native/frost/policy/native-signing-policy.mjs";
import { isHash32Hex, normalizeHex } from "../../shared/protocol/canonical-message.mjs";
import { DEPOSIT_STATES } from "./automatic-deposit-pipeline.mjs";
import { preserveOperationHardStop, readOperationHardStop } from "../../shared/operation-hard-stop.mjs";

export const NATIVE_RESERVE_SWEEP_RELAYER_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RESERVE_SWEEP_RELAYER/V1";
export const NATIVE_RESERVE_SWEEP_VERIFIER_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RESERVE_SWEEP_VERIFIER/V1";

const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const MAX_RAW_TRANSACTION_BYTES = 400_000;

export class NativeReserveSweepRelayer {
  #config;
  #rpcClient;
  #journal;

  constructor(options = {}) {
    const value = requireObject(options, "options");
    this.#config = normalizeRelayerConfig(value.config ?? {});
    this.#rpcClient = requireObject(value.rpcClient, "rpcClient");
    this.#journal = value.journal ?? new InMemoryNativeReserveSweepJournal();
  }

  async broadcastReserveSweep(request) {
    const normalized = normalizeReserveSweepBroadcastRequest(request);
    if (this.#config.environment !== "localnet") {
      return relayerDecision(DEPOSIT_STATES.HARD_STOP, "NATIVE_RESERVE_SWEEP_RELAYER_LOCALNET_ONLY", normalized);
    }

    const stopped = this.#stopped(normalized);
    if (stopped !== undefined) return stopped;
    const submitted = this.#journal.submitted(normalized.operationIdHex);
    if (submitted !== undefined) {
      assertSamePrepared(submitted.prepared, normalized);
      return relayerDecision(DEPOSIT_STATES.BROADCAST, "NATIVE_RESERVE_SWEEP_ALREADY_SUBMITTED", normalized, {
        nativeSweepTxidHex: submitted.submittedTxidHex,
      });
    }

    this.#journal.persistPrepared(normalized);

    let txid;
    try {
      txid = normalizeHash32(await this.#rpcClient.sendRawTransaction(normalized.signedNativeTransactionHex), "nativeSweepTxidHex");
    } catch {
      return this.#stopped(normalized) ?? relayerDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "NATIVE_RESERVE_SWEEP_BROADCAST_FAILED", normalized);
    }

    // The call may have raced with an integrity stop. A successful late
    // response is evidence for reconciliation, not permission to clear it.
    const lateStop = this.#stopped(normalized);
    if (lateStop !== undefined) return lateStop;

    if (normalized.expectedNativeSweepTxidHex !== undefined && txid !== normalized.expectedNativeSweepTxidHex) {
      const result = relayerDecision(DEPOSIT_STATES.HARD_STOP, "NATIVE_RESERVE_SWEEP_TXID_MISMATCH", normalized, {
        nativeSweepTxidHex: txid,
      });
      this.#journal.recordTerminal(normalized.operationIdHex, result);
      return result;
    }

    this.#journal.recordSubmitted(normalized.operationIdHex, txid);
    return relayerDecision(DEPOSIT_STATES.BROADCAST, "NATIVE_RESERVE_SWEEP_BROADCAST_ACCEPTED", normalized, {
      nativeSweepTxidHex: txid,
    });
  }

  #stopped(normalized) {
    const entry = this.#journal.get(normalized.operationIdHex);
    const stopped = readOperationHardStop(entry?.state, entry?.result);
    if (stopped !== undefined) assertSamePrepared(entry.prepared, normalized);
    return stopped;
  }
}

export class NativeReserveSweepVerifier {
  #config;
  #rpcClient;

  constructor(options = {}) {
    const value = requireObject(options, "options");
    this.#config = normalizeVerifierConfig(value.config ?? {});
    this.#rpcClient = requireObject(value.rpcClient, "rpcClient");
  }

  async verifyFinalizedReserveSweep(request) {
    const normalized = normalizeReserveSweepVerificationRequest(request);
    const base = reserveEvidenceBase(this.#config, normalized);

    let sourceSnapshot;
    try {
      sourceSnapshot =
        typeof this.#rpcClient.getSourceSnapshot === "function"
          ? await this.#rpcClient.getSourceSnapshot({
              expectedNetwork: this.#config.expectedSourceNetwork,
              expectedGenesisHash: normalized.deposit.nativeGenesisHash,
            })
          : { state: SOURCE_READY, trust: RPC_OBSERVATION };
    } catch {
      return {
        ...base,
        finalitySatisfied: false,
        sweepFinalized: false,
        reserveTransitionState: "SOURCE_UNAVAILABLE",
        mintCreditState: "UNAVAILABLE",
        noPriorConsumption: false,
      };
    }

    if (sourceSnapshot.state !== SOURCE_READY) {
      return {
        ...base,
        finalitySatisfied: false,
        sweepFinalized: false,
        reserveTransitionState: "SOURCE_NOT_READY",
        mintCreditState: "UNAVAILABLE",
        noPriorConsumption: false,
      };
    }

    let transaction;
    try {
      transaction = requireObject(
        await this.#rpcClient.getRawTransaction(normalized.reserveSweep.nativeSweepTxidHex, true),
        "nativeSweepTransaction",
      );
    } catch {
      return {
        ...base,
        finalitySatisfied: false,
        sweepFinalized: false,
        reserveTransitionState: "SWEEP_TRANSACTION_UNAVAILABLE",
        mintCreditState: "UNAVAILABLE",
        noPriorConsumption: false,
      };
    }

    let validation;
    try {
      validation = validateSweepTransaction(this.#config, normalized, transaction);
    } catch {
      return {
        ...base,
        finalitySatisfied: false,
        sweepFinalized: false,
        reserveTransitionState: "INVALID_RESERVE_SWEEP",
        mintCreditState: "UNAVAILABLE",
        noPriorConsumption: false,
      };
    }
    return {
      ...base,
      finalitySatisfied: validation.finalitySatisfied,
      sweepFinalized: validation.finalitySatisfied,
      reserveTransitionState: validation.valid ? "CANONICAL_RESERVE" : "INVALID_RESERVE_SWEEP",
      mintCreditState: validation.valid ? "AUTHORIZED_UNCONSUMED" : "UNAVAILABLE",
      noPriorConsumption: validation.spendsDepositOutpoint && normalized.deposit.noPriorConsumption,
    };
  }
}

export class InMemoryNativeReserveSweepJournal {
  #entries = new Map();

  get(operationIdHex) {
    return structuredClone(this.#entries.get(normalizeHash32(operationIdHex, "operationIdHex")));
  }

  submitted(operationIdHex) {
    const entry = this.#entries.get(normalizeHash32(operationIdHex, "operationIdHex"));
    return entry?.submittedTxidHex === undefined ? undefined : structuredClone(entry);
  }

  persistPrepared(prepared) {
    const normalized = normalizePreparedEntry(prepared);
    const existing = this.#entries.get(normalized.operationIdHex);
    if (existing !== undefined) {
      assertSamePrepared(existing.prepared, normalized);
      return structuredClone(existing.prepared);
    }
    this.#entries.set(normalized.operationIdHex, {
      protocol: NATIVE_RESERVE_SWEEP_RELAYER_PROTOCOL,
      state: "PREPARED",
      prepared: normalized,
      submittedTxidHex: undefined,
      result: undefined,
    });
    return structuredClone(normalized);
  }

  recordSubmitted(operationIdHex, nativeSweepTxidHex) {
    const entry = this.#requireEntry(operationIdHex);
    preserveOperationHardStop(entry.state, entry.result);
    const txid = normalizeHash32(nativeSweepTxidHex, "nativeSweepTxidHex");
    if (entry.submittedTxidHex !== undefined && entry.submittedTxidHex !== txid) {
      throw new Error("NativeReserveSweepSubmittedTxidConflict");
    }
    entry.state = "SUBMITTED";
    entry.submittedTxidHex = txid;
  }

  recordTerminal(operationIdHex, result) {
    const entry = this.#requireEntry(operationIdHex);
    if (preserveOperationHardStop(entry.state, entry.result, result)) return;
    entry.state = result.state;
    entry.result = structuredClone(result);
  }

  #requireEntry(operationIdHex) {
    const normalized = normalizeHash32(operationIdHex, "operationIdHex");
    const entry = this.#entries.get(normalized);
    if (entry === undefined) throw new Error("NativeReserveSweepJournalEntryMissing");
    return entry;
  }
}

export class FileBackedNativeReserveSweepJournal {
  #root;
  #repoRoot;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#repoRoot = value.repoRoot;
    this.#root = validateStateRootOutsideRepo(value.root, this.#repoRoot, "Native reserve sweep journal root");
    mkdirSync(this.#root, { recursive: true });
  }

  submitted(operationIdHex) {
    const entry = this.get(operationIdHex);
    return entry?.submittedTxidHex === undefined ? undefined : entry;
  }

  get(operationIdHex) {
    const file = this.#entryPath(operationIdHex);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8"));
  }

  persistPrepared(prepared) {
    const normalized = normalizePreparedEntry(prepared);
    const existing = this.get(normalized.operationIdHex);
    if (existing !== undefined) {
      assertSamePrepared(existing.prepared, normalized);
      return structuredClone(existing.prepared);
    }
    this.#write(normalized.operationIdHex, {
      protocol: NATIVE_RESERVE_SWEEP_RELAYER_PROTOCOL,
      state: "PREPARED",
      prepared: normalized,
      submittedTxidHex: undefined,
      result: undefined,
    });
    return structuredClone(normalized);
  }

  recordSubmitted(operationIdHex, nativeSweepTxidHex) {
    const entry = this.#requireEntry(operationIdHex);
    preserveOperationHardStop(entry.state, entry.result);
    const txid = normalizeHash32(nativeSweepTxidHex, "nativeSweepTxidHex");
    if (entry.submittedTxidHex !== undefined && entry.submittedTxidHex !== txid) {
      throw new Error("NativeReserveSweepSubmittedTxidConflict");
    }
    entry.state = "SUBMITTED";
    entry.submittedTxidHex = txid;
    this.#write(operationIdHex, entry);
  }

  recordTerminal(operationIdHex, result) {
    const entry = this.#requireEntry(operationIdHex);
    if (preserveOperationHardStop(entry.state, entry.result, result)) return;
    entry.state = result.state;
    entry.result = structuredClone(result);
    this.#write(operationIdHex, entry);
  }

  #requireEntry(operationIdHex) {
    const entry = this.get(operationIdHex);
    if (entry === undefined) throw new Error("NativeReserveSweepJournalEntryMissing");
    return entry;
  }

  #entryPath(operationIdHex) {
    return validateRuntimeFile(path.join(this.#root, `${normalizeHash32(operationIdHex, "operationIdHex")}.json`), this.#repoRoot);
  }

  #write(operationIdHex, entry) {
    const target = this.#entryPath(operationIdHex);
    const temp = `${target}.${process.pid}.tmp`;
    validateRuntimeFile(temp, this.#repoRoot);
    // File flush is not a guarantee of directory-metadata power-loss safety.
    writeFileSync(temp, `${JSON.stringify(entry, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temp, target);
  }
}

function normalizeReserveSweepBroadcastRequest(request) {
  const value = requireObject(request, "request");
  const signingIntent = validateNativeSigningIntent(value.signingIntent);
  if (signingIntent.purpose !== "RESERVE_SWEEP") throw new Error("NativeReserveSweepIntentRequired");
  const intentDigest = nativeSigningIntentDigest(signingIntent);
  const frostResult = requireObject(value.frostResult, "frostResult");
  if (frostResult.state !== "SIGNED") throw new Error("NativeReserveSweepRequiresSignedFrostResult");
  if (frostResult.requestId !== signingIntent.signingRequestId) throw new Error("NativeReserveSweepFrostRequestMismatch");
  if (frostResult.messageHex !== signingIntent.taprootSighashHex) throw new Error("NativeReserveSweepFrostMessageMismatch");
  if (frostResult.intentDigest !== intentDigest) throw new Error("NativeReserveSweepFrostIntentMismatch");
  if (JSON.stringify(frostResult.signerIds) !== JSON.stringify(REQUIRED_FROST_SIGNERS)) {
    throw new Error("NativeReserveSweepRequiresFrostAB");
  }

  const operationIdHex = normalizeHash32(value.operationIdHex ?? signingIntent.operationId, "operationIdHex");
  if (operationIdHex !== signingIntent.operationId) throw new Error("NativeReserveSweepOperationMismatch");
  const signedNativeTransactionHex = normalizeRawTransactionHex(
    value.signedNativeTransactionHex ?? value.reserveSweep?.signedNativeTransactionHex,
  );
  const expectedNativeSweepTxidHex =
    value.expectedNativeSweepTxidHex === undefined && value.reserveSweep?.nativeSweepTxidHex === undefined
      ? undefined
      : normalizeHash32(value.expectedNativeSweepTxidHex ?? value.reserveSweep.nativeSweepTxidHex, "expectedNativeSweepTxidHex");

  return Object.freeze({
    protocol: NATIVE_RESERVE_SWEEP_RELAYER_PROTOCOL,
    operationIdHex,
    encodedMessageHex: normalizeNonEmptyHex(value.encodedMessageHex, "encodedMessageHex"),
    signingRequestId: signingIntent.signingRequestId,
    signingIntentDigestHex: intentDigest,
    signingIntent,
    frostResult: Object.freeze({
      state: frostResult.state,
      requestId: frostResult.requestId,
      signerIds: Object.freeze([...frostResult.signerIds]),
      messageHex: normalizeHash32(frostResult.messageHex, "frostResult.messageHex"),
      intentDigest: normalizeHash32(frostResult.intentDigest, "frostResult.intentDigest"),
    }),
    signedNativeTransactionHex,
    signedNativeTransactionFingerprintHex: sha256Hex(Buffer.from(signedNativeTransactionHex, "hex")),
    expectedNativeSweepTxidHex,
  });
}

function normalizeReserveSweepVerificationRequest(request) {
  const value = requireObject(request, "request");
  const deposit = requireObject(value.deposit, "deposit");
  const reserveSweep = requireObject(value.reserveSweep, "reserveSweep");
  const broadcast = requireObject(value.broadcast, "broadcast");
  const reserveSweepTxidHex = normalizeHash32(reserveSweep.nativeSweepTxidHex, "reserveSweep.nativeSweepTxidHex");
  const broadcastTxidHex = normalizeHash32(broadcast.nativeSweepTxidHex ?? reserveSweepTxidHex, "broadcast.nativeSweepTxidHex");
  if (broadcastTxidHex !== reserveSweepTxidHex) throw new Error("NativeReserveSweepBroadcastTxidMismatch");
  return Object.freeze({
    protocol: NATIVE_RESERVE_SWEEP_VERIFIER_PROTOCOL,
    operationIdHex: normalizeHash32(value.operationIdHex, "operationIdHex"),
    encodedMessageHex: normalizeNonEmptyHex(value.encodedMessageHex, "encodedMessageHex"),
    evidenceDigestHex: normalizeHash32(value.evidenceDigestHex, "evidenceDigestHex"),
    deposit: Object.freeze({
      trust: deposit.trust,
      nativeNetwork: checkedU32(deposit.nativeNetwork, "deposit.nativeNetwork"),
      nativeGenesisHash: normalizeHash32(deposit.nativeGenesisHash, "deposit.nativeGenesisHash"),
      depositOutpoint: normalizeOutpoint(deposit.depositOutpoint, "depositOutpoint"),
      amountAtomic: canonicalUintDecimal(deposit.amountAtomic, "deposit.amountAtomic"),
      solanaRecipientHex: normalizeNonEmptyHex(deposit.solanaRecipientHex, "deposit.solanaRecipientHex"),
      utxoUnspentAtDeposit: deposit.utxoUnspentAtDeposit === true,
      noPriorConsumption: deposit.noPriorConsumption === true,
    }),
    reserveSweep: Object.freeze({
      reserveAllocationIdHex: normalizeHash32(reserveSweep.reserveAllocationIdHex, "reserveSweep.reserveAllocationIdHex"),
      nativeSweepTxidHex: reserveSweepTxidHex,
      nativeMinerFeeAtomic: canonicalUintDecimal(reserveSweep.nativeMinerFeeAtomic, "reserveSweep.nativeMinerFeeAtomic"),
      canonicalReserveScriptPubKeyHex: normalizeNonEmptyHex(
        reserveSweep.canonicalReserveScriptPubKeyHex,
        "reserveSweep.canonicalReserveScriptPubKeyHex",
      ),
    }),
  });
}

function validateSweepTransaction(config, normalized, transaction) {
  const txid = normalizeHash32(transaction.txid ?? normalized.reserveSweep.nativeSweepTxidHex, "transaction.txid");
  const confirmations = checkedNonNegativeInteger(transaction.confirmations ?? 0, "transaction.confirmations");
  const spendsDepositOutpoint =
    Array.isArray(transaction.vin) &&
    transaction.vin.some((input) => {
      const txidValue = typeof input?.txid === "string" ? input.txid.toLowerCase() : "";
      return txidValue === normalized.deposit.depositOutpoint.txid && input.vout === normalized.deposit.depositOutpoint.vout;
    });
  const reserveOutput = findReserveOutput(config, normalized, transaction.vout);
  const amountMatches = reserveOutput?.valueAtomic === normalized.deposit.amountAtomic;
  const finalitySatisfied = confirmations >= config.requiredConfirmations;
  return Object.freeze({
    valid: txid === normalized.reserveSweep.nativeSweepTxidHex && spendsDepositOutpoint && amountMatches,
    finalitySatisfied,
    spendsDepositOutpoint,
    amountMatches,
  });
}

function findReserveOutput(config, normalized, vout) {
  if (!Array.isArray(vout)) return undefined;
  for (const output of vout) {
    const scriptHex = output?.scriptPubKey?.hex;
    if (typeof scriptHex !== "string") continue;
    if (scriptHex.toLowerCase() !== normalized.reserveSweep.canonicalReserveScriptPubKeyHex) continue;
    const valueAtomic = normalizeOutputValueAtomic(output, config.nativeDecimals);
    return { valueAtomic };
  }
  return undefined;
}

function normalizeOutputValueAtomic(output, nativeDecimals) {
  if (output.valueAtomic !== undefined) {
    if (typeof output.valueAtomic !== "string") throw new Error("NativeReserveSweepOutputAtomicMustBeText");
    return canonicalUintDecimal(output.valueAtomic, "vout.valueAtomic");
  }
  if (typeof output.value === "string") return decimalCoinsToAtomic(output.value, nativeDecimals).toString();
  throw new Error("NativeReserveSweepOutputRequiresExactValue");
}

function reserveEvidenceBase(config, normalized) {
  return {
    protocol: NATIVE_RESERVE_SWEEP_VERIFIER_PROTOCOL,
    trust: config.trust,
    nativeNetwork: normalized.deposit.nativeNetwork,
    nativeGenesisHash: normalized.deposit.nativeGenesisHash,
    operationIdHex: normalized.operationIdHex,
    depositOutpoint: outpointText(normalized.deposit.depositOutpoint),
    amountAtomic: normalized.deposit.amountAtomic,
    solanaRecipientHex: normalized.deposit.solanaRecipientHex,
    evidenceDigestHex: normalized.evidenceDigestHex,
    reserveAllocationIdHex: normalized.reserveSweep.reserveAllocationIdHex,
    utxoUnspentAtDeposit: normalized.deposit.utxoUnspentAtDeposit,
    noPriorConsumption: normalized.deposit.noPriorConsumption,
    nativeSweepTxidHex: normalized.reserveSweep.nativeSweepTxidHex,
  };
}

function normalizePreparedEntry(prepared) {
  const value = requireObject(prepared, "prepared");
  return Object.freeze({
    protocol: NATIVE_RESERVE_SWEEP_RELAYER_PROTOCOL,
    operationIdHex: normalizeHash32(value.operationIdHex, "operationIdHex"),
    encodedMessageHex: normalizeNonEmptyHex(value.encodedMessageHex, "encodedMessageHex"),
    signingRequestId: normalizeHash32(value.signingRequestId, "signingRequestId"),
    signingIntentDigestHex: normalizeHash32(value.signingIntentDigestHex, "signingIntentDigestHex"),
    signedNativeTransactionHex: normalizeRawTransactionHex(value.signedNativeTransactionHex),
    signedNativeTransactionFingerprintHex: normalizeHash32(
      value.signedNativeTransactionFingerprintHex,
      "signedNativeTransactionFingerprintHex",
    ),
    expectedNativeSweepTxidHex:
      value.expectedNativeSweepTxidHex === undefined
        ? undefined
        : normalizeHash32(value.expectedNativeSweepTxidHex, "expectedNativeSweepTxidHex"),
  });
}

function assertSamePrepared(existing, incoming) {
  for (const key of [
    "operationIdHex",
    "encodedMessageHex",
    "signingRequestId",
    "signingIntentDigestHex",
    "signedNativeTransactionFingerprintHex",
    "expectedNativeSweepTxidHex",
  ]) {
    if (existing[key] !== incoming[key]) throw new Error(`NativeReserveSweepJournalConflict:${key}`);
  }
}

function relayerDecision(state, reason, normalized, extra = {}) {
  return Object.freeze({
    protocol: NATIVE_RESERVE_SWEEP_RELAYER_PROTOCOL,
    state,
    reason,
    operationIdHex: normalized.operationIdHex,
    signingRequestId: normalized.signingRequestId,
    ...extra,
  });
}

function normalizeRelayerConfig(config) {
  const value = requireObject(config, "config");
  return Object.freeze({
    environment: value.environment ?? "localnet",
  });
}

function normalizeVerifierConfig(config) {
  const value = requireObject(config, "config");
  return Object.freeze({
    trust: value.trust ?? RPC_OBSERVATION,
    expectedSourceNetwork: value.expectedSourceNetwork,
    requiredConfirmations: checkedPositiveInteger(value.requiredConfirmations ?? 1, "requiredConfirmations"),
    nativeDecimals: checkedNonNegativeInteger(value.nativeDecimals ?? 8, "nativeDecimals"),
  });
}

function normalizeOutpoint(value, label) {
  const outpoint = requireObject(value, label);
  return Object.freeze({
    txid: normalizeHash32(outpoint.txid, `${label}.txid`),
    vout: checkedU32(outpoint.vout, `${label}.vout`),
  });
}

function outpointText(outpoint) {
  return `${outpoint.txid}:${outpoint.vout}`;
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) throw new Error(`${label}:Expected32Bytes`);
  return normalized;
}

function normalizeNonEmptyHex(value, label) {
  const normalized = normalizeHex(value, label);
  if (normalized.length === 0) throw new Error(`${label}:Empty`);
  return normalized;
}

function normalizeRawTransactionHex(value) {
  const normalized = normalizeNonEmptyHex(value, "signedNativeTransactionHex");
  if (normalized.length > MAX_RAW_TRANSACTION_BYTES * 2) throw new Error("SignedNativeTransactionTooLarge");
  return normalized;
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function checkedU32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${label}:ExpectedU32`);
  return value;
}

function checkedPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}:ExpectedPositiveInteger`);
  return value;
}

function checkedNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}:ExpectedNonNegativeInteger`);
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}:ExpectedObject`);
  return value;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
