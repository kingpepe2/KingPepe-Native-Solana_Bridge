import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateRuntimeFile, validateRuntimeStateRoot as validateStateRootOutsideRepo } from "../../shared/runtime-path-boundary.mjs";
import {
  bytesToHex,
  decodeCanonicalBridgeMessage,
  hexToBytes,
  isHash32Hex,
  normalizeHex,
} from "../../shared/protocol/canonical-message.mjs";
import {
  ATTESTATION_MODE,
  VERIFIED_READY as ATTESTATION_VERIFIED_READY,
  verifyProjectAttestation,
} from "../attesters/attestation-service.mjs";
import { DEPOSIT_STATES } from "./automatic-deposit-pipeline.mjs";
import { verifySignedLocalnetSolanaDepositClaimTransaction } from "./solana-deposit-claim-transaction-plan.mjs";
import { preserveOperationHardStop, readOperationHardStop } from "../../shared/operation-hard-stop.mjs";

export const SOLANA_DEPOSIT_CLAIM_SUBMITTER_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/SOLANA_DEPOSIT_CLAIM_SUBMITTER/V1";
export const SOLANA_DEPOSIT_CLAIM_OBSERVATION_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/SOLANA_DEPOSIT_CLAIM_OBSERVATION/V1";

const UINT_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const BASE64_TRANSACTION = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE58_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/u;
const JSON_RPC_VERSION = "2.0";
const MAX_SOLANA_RPC_REQUEST_BYTES = 65_536;
const MAX_SOLANA_RPC_RESPONSE_BYTES = 2_097_152;
const SOLANA_RPC_TIMEOUT_MS = 10_000;
const INSTRUCTION_FAILURE_REASONS = new Set(["InvalidAccountData", "InvalidArgument", "InvalidInstructionData", "InsufficientFunds", "ProgramFailedToComplete", "ComputationalBudgetExceeded", "AccountNotRentExempt", "AccountAlreadyInitialized", "IncorrectProgramId"]);
const EXECUTION_FAULTS = new Set(["SBF_STACK_ACCESS_VIOLATION", "SBF_ACCESS_VIOLATION", "SBF_HEAP_EXHAUSTED", "SBF_COMPUTE_BUDGET_EXCEEDED"]);
const TRANSACTION_FAILURES = new Set(["BlockhashNotFound", "AccountNotFound", "InvalidAccountForFee", "InsufficientFundsForFee",
  "AlreadyProcessed", "SignatureFailure", "SanitizeFailure", "AccountInUse", "TooManyAccountLocks", "MaxLoadedAccountsDataSizeExceeded"]);

// Narrow shared projection, never provider messages, logs, paths or packets.
export function sanitizedRpcDiagnostic(error) {
  const result = {};
  if (Number.isSafeInteger(error?.code)) result.rpcCode = error.code;
  if (EXECUTION_FAULTS.has(error?.executionFault)) result.executionFault = error.executionFault;
  if (TRANSACTION_FAILURES.has(error?.transactionFailure)) result.transactionFailure = error.transactionFailure;
  const failure = error?.instructionFailure;
  if (Number.isInteger(failure?.index) && failure.index >= 0 && failure.index <= 255) {
    if (Number.isInteger(failure.customCode) && failure.customCode >= 0 && failure.customCode <= 0xffff_ffff) {
      result.instructionFailure = { index: failure.index, customCode: failure.customCode };
    } else if (INSTRUCTION_FAILURE_REASONS.has(failure.reason)) {
      result.instructionFailure = { index: failure.index, reason: failure.reason };
    }
  }
  return result;
}
const ALLOWED_SOLANA_RPC_METHODS = new Set([
  "getAccountInfo",
  "getBlockHeight",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getSignatureStatuses",
  "requestAirdrop",
  "sendTransaction",
]);

export class SolanaDepositClaimSubmitter {
  #config;
  #rpcClient;
  #claimObserver;
  #journal;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#config = normalizeSubmitterConfig(value.config);
    this.#rpcClient = requireObject(value.rpcClient, "rpcClient");
    this.#claimObserver = value.claimObserver;
    this.#journal = value.journal ?? new InMemorySolanaDepositClaimJournal();
  }

  async submitDepositClaim(request) {
    const normalized = normalizeDepositClaimRequest(this.#config, request);
    if (this.#config.environment !== "localnet") {
      return submitterDecision(DEPOSIT_STATES.HARD_STOP, "SOLANA_DEPOSIT_SUBMITTER_LOCALNET_ONLY", normalized);
    }

    const terminal = this.#terminal(normalized);
    if (terminal !== undefined) return terminal;

    const prepared = this.#journal.persistPrepared({
      protocol: SOLANA_DEPOSIT_CLAIM_SUBMITTER_PROTOCOL,
      state: "PREPARED",
      operationIdHex: normalized.operationIdHex,
      messageDigestHex: normalized.messageDigestHex,
      encodedMessageHex: normalized.encodedMessageHex,
      amountAtomic: normalized.amountAtomic,
      solanaRecipientHex: normalized.solanaRecipientHex,
      preparedTransactionBase64: normalized.preparedTransactionBase64,
      preparedTransactionFingerprintHex: sha256Hex(Buffer.from(normalized.preparedTransactionBase64, "base64")),
      recentBlockhash: normalized.recentBlockhash,
      lastValidBlockHeight: normalized.lastValidBlockHeight,
      depositClaimAccountBase58: normalized.depositClaimAccountBase58,
      mintAccountBase58: normalized.mintAccountBase58,
    });
    assertSamePrepared(prepared, normalized);

    const solanaSignature = normalized.solanaSignature;
    if (prepared.submittedSignature !== undefined && prepared.submittedSignature !== solanaSignature) {
      throw new Error("SolanaDepositClaimSubmittedSignatureConflict");
    }
    // The signed packet already contains the transaction identity. Query that
    // identity even after expiry or a crash before the send response was saved.
    let priorStatus;
    try {
      priorStatus = await this.#rpcClient.getSignatureStatus(solanaSignature);
    } catch {
      return this.#terminal(normalized) ?? submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_RPC_STATUS_UNAVAILABLE", normalized, { solanaSignature });
    }
    const statusTerminal = this.#terminal(normalized);
    if (statusTerminal !== undefined) return statusTerminal;
    if (priorStatus !== null) {
      return this.#evaluateStatus(solanaSignature, normalized, priorStatus);
    }

    const currentBlockHeight = await this.#getBlockHeightOrDependency(normalized);
    const heightTerminal = this.#terminal(normalized);
    if (heightTerminal !== undefined) return heightTerminal;
    if (typeof currentBlockHeight !== "bigint") {
      return currentBlockHeight;
    }
    if (currentBlockHeight > BigInt(normalized.lastValidBlockHeight)) {
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY,
        prepared.submittedSignature === undefined ? "SOLANA_BLOCKHASH_EXPIRED_BEFORE_SUBMIT" :
          "SOLANA_SUBMITTED_TRANSACTION_OUTCOME_UNKNOWN_AFTER_BLOCKHASH_EXPIRY", normalized, {
        solanaSignature,
        currentBlockHeight: currentBlockHeight.toString(),
      });
    }

    // Persist before exposing bytes to RPC. A crash here may only lead to a
    // rebroadcast of these identical bytes, never a new blockhash/operation.
    this.#journal.recordSubmitted(normalized.operationIdHex, solanaSignature);
    let signature;
    try {
      signature = await this.#rpcClient.sendTransaction(normalized.preparedTransactionBase64, {
        encoding: "base64",
        maxRetries: normalized.maxRetries,
        skipPreflight: false,
      });
    } catch (error) {
      return this.#terminal(normalized) ?? submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_RPC_SEND_FAILED", normalized, {
        solanaSignature, ...sanitizedRpcDiagnostic(error),
      });
    }
    const sendTerminal = this.#terminal(normalized);
    if (sendTerminal !== undefined) return sendTerminal;
    if (signature !== solanaSignature) {
      const stopped = submitterDecision(DEPOSIT_STATES.HARD_STOP, "SOLANA_RPC_SUBMITTED_SIGNATURE_MISMATCH", normalized);
      this.#journal.recordTerminal(normalized.operationIdHex, stopped);
      return stopped;
    }
    return this.#observeSubmitted(solanaSignature, normalized);
  }

  async #observeSubmitted(solanaSignature, normalized) {
    let status;
    try {
      status = await this.#rpcClient.getSignatureStatus(solanaSignature);
    } catch {
      return this.#terminal(normalized) ?? submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_RPC_STATUS_UNAVAILABLE", normalized, {
        solanaSignature,
      });
    }
    return this.#evaluateStatus(solanaSignature, normalized, status);
  }

  async #evaluateStatus(solanaSignature, normalized, status) {
    const terminal = this.#terminal(normalized);
    if (terminal !== undefined) return terminal;
    if (status === null) {
      const currentBlockHeight = await this.#getBlockHeightOrDependency(normalized);
      const heightTerminal = this.#terminal(normalized);
      if (heightTerminal !== undefined) return heightTerminal;
      if (typeof currentBlockHeight !== "bigint") {
        return currentBlockHeight;
      }
      const reason =
        currentBlockHeight > BigInt(normalized.lastValidBlockHeight)
          ? "SOLANA_SUBMITTED_TRANSACTION_OUTCOME_UNKNOWN_AFTER_BLOCKHASH_EXPIRY"
          : "SOLANA_MINT_WAITING_FOR_FINALITY";
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, reason, normalized, {
        solanaSignature,
        currentBlockHeight: currentBlockHeight.toString(),
      });
    }

    if (!status || typeof status !== "object" || Array.isArray(status) ||
        !Object.hasOwn(status, "err") || status.err === undefined ||
        !Number.isSafeInteger(status.slot) || status.slot < 0 ||
        !["processed", "confirmed", "finalized"].includes(status.confirmationStatus)) {
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_EXECUTION_STATUS_MALFORMED", normalized, { solanaSignature });
    }
    if (status.confirmationStatus !== "finalized") {
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_FINALITY, "SOLANA_MINT_WAITING_FOR_FINALITY", normalized, {
        solanaSignature, confirmationStatus: status.confirmationStatus,
      });
    }
    if (status.err !== null) {
      const result = submitterDecision(DEPOSIT_STATES.REJECTED, "SOLANA_DEPOSIT_TRANSACTION_FAILED", normalized, {
        solanaSignature,
        solanaError: "REDACTED",
      });
      this.#journal.recordTerminal(normalized.operationIdHex, result);
      return result;
    }

    if (this.#claimObserver === undefined) {
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_DEPOSIT_CLAIM_OBSERVER_REQUIRED", normalized, {
        solanaSignature,
      });
    }

    let observation;
    try {
      observation = await this.#claimObserver.observeFinalizedDepositClaim({
        operationIdHex: normalized.operationIdHex,
        messageDigestHex: normalized.messageDigestHex,
        solanaSignature,
        depositClaimAccountBase58: normalized.depositClaimAccountBase58,
        mintAccountBase58: normalized.mintAccountBase58,
      });
    } catch (error) {
      const observerTerminal = this.#terminal(normalized);
      if (observerTerminal !== undefined) return observerTerminal;
      if (["SOLANA_DEPOSIT_ACCOUNT_ADDRESS_MISMATCH", "SOLANA_DEPOSIT_ACCOUNT_PROGRAM_MISMATCH", "SOLANA_MINT_AUTHORITY_OR_PRECISION_MISMATCH"].includes(error.integrityCode)) {
        const result = submitterDecision(DEPOSIT_STATES.HARD_STOP, error.integrityCode, normalized);
        this.#journal.recordTerminal(normalized.operationIdHex, result);
        return result;
      }
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_DEPOSIT_CLAIM_OBSERVER_FAILED", normalized, {
        solanaSignature,
      });
    }

    const observerTerminal = this.#terminal(normalized);
    if (observerTerminal !== undefined) return observerTerminal;

    const observationResult = validateDepositClaimObservation(this.#config, normalized, solanaSignature, status, observation);
    if (observationResult.state !== DEPOSIT_STATES.VERIFIED_READY) {
      if (observationResult.state === DEPOSIT_STATES.HARD_STOP || observationResult.state === DEPOSIT_STATES.REJECTED) {
        this.#journal.recordTerminal(normalized.operationIdHex, observationResult);
      }
      return observationResult;
    }

    const completed = submitterDecision(DEPOSIT_STATES.COMPLETED, "SOLANA_DEPOSIT_CLAIM_FINALIZED", normalized, {
      solanaSignature,
      mintedAmountAtomic: normalized.amountAtomic,
      slot: String(status.slot ?? observation.slot),
      sourceBoundary: observation.trust,
      ...(observation.mint.supplyAtomic === undefined ? {} : { mintSupplyAtomic: observation.mint.supplyAtomic }),
    });
    this.#journal.recordCompleted(normalized.operationIdHex, completed);
    return completed;
  }

  #terminal(normalized) {
    const entry = this.#journal.get(normalized.operationIdHex);
    const stopped = readOperationHardStop(entry?.state, entry?.result);
    if (stopped !== undefined || entry?.state === DEPOSIT_STATES.REJECTED || entry?.state === DEPOSIT_STATES.COMPLETED) {
      if (entry.result?.state !== entry.state) throw new Error("SolanaDepositClaimTerminalRecordInvalid");
      assertSamePrepared(entry.prepared, normalized);
      return stopped ?? structuredClone(entry.result);
    }
    return undefined;
  }

  async #getBlockHeightOrDependency(normalized) {
    try {
      return BigInt(canonicalUintDecimalLike(await this.#rpcClient.getBlockHeight(), "blockHeight"));
    } catch {
      return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_RPC_BLOCK_HEIGHT_UNAVAILABLE", normalized);
    }
  }
}

export class SolanaLocalRpcClient {
  #endpoint;
  #fetchImpl;
  #nextId = 0;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#endpoint = normalizeSolanaRpcEndpoint(value.endpoint);
    this.#fetchImpl = value.fetchImpl ?? globalThis.fetch;
    if (typeof this.#fetchImpl !== "function") {
      throw new Error("SolanaRpcFetchUnavailable");
    }
  }

  async call(method, params = []) {
    if (!ALLOWED_SOLANA_RPC_METHODS.has(method)) {
      throw new Error(`SolanaRpcMethodNotAllowed:${method}`);
    }
    if (!Array.isArray(params)) {
      throw new Error("SolanaRpcParamsMustBeArray");
    }
    const id = ++this.#nextId;
    if (!Number.isSafeInteger(id)) throw rpcError("SolanaRpcRequestIdentityExhausted", method);
    const body = JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, method, params });
    if (Buffer.byteLength(body) > MAX_SOLANA_RPC_REQUEST_BYTES) throw rpcError("SolanaRpcRequestTooLarge", method);
    let response;
    try {
      response = await this.#fetchImpl(this.#endpoint, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(SOLANA_RPC_TIMEOUT_MS),
        headers: { "content-type": "application/json" }, body,
      });
    } catch { throw rpcError("SolanaRpcTransportUnavailable", method); }
    if (!response.ok) {
      await response.body?.cancel();
      throw rpcError("SolanaRpcHttpFailure", method, response.status);
    }
    let envelope;
    try {
      if (!response.body) throw new Error("ResponseBodyRequired");
      const reader = response.body.getReader(), parts = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_SOLANA_RPC_RESPONSE_BYTES) throw new Error("ResponseLimit");
          parts.push(value);
        }
      } finally { await reader.cancel(); }
      envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts)));
    } catch {
      throw rpcError("SolanaRpcInvalidJson", method);
    }
    if (!envelope || Array.isArray(envelope) || envelope.jsonrpc !== JSON_RPC_VERSION || envelope.id !== id ||
        (!Object.hasOwn(envelope, "result") && !Object.hasOwn(envelope, "error"))) {
      throw rpcError("SolanaRpcInvalidEnvelope", method);
    }
    if (envelope.error !== null && envelope.error !== undefined) {
      const code = envelope.error?.code;
      if (typeof envelope.error !== "object" || Array.isArray(envelope.error) || !Number.isInteger(code) ||
          code < -0x8000_0000 || code > 0x7fff_ffff) throw rpcError("SolanaRpcInvalidEnvelope", method);
      const error = rpcError("SolanaRpcRejected", method, code);
      const transactionFailure = envelope.error?.data?.err;
      if (TRANSACTION_FAILURES.has(transactionFailure)) error.transactionFailure = transactionFailure;
      const failure = envelope.error?.data?.err?.InstructionError;
      const logs = envelope.error?.data?.logs;
      if (Array.isArray(logs)) {
        for (const line of logs) {
          if (typeof line !== "string") continue;
          if (/Access violation in stack frame/iu.test(line)) error.executionFault = "SBF_STACK_ACCESS_VIOLATION";
          else if (/Access violation/iu.test(line)) error.executionFault = "SBF_ACCESS_VIOLATION";
          else if (/memory allocation failed|out of memory/iu.test(line)) error.executionFault = "SBF_HEAP_EXHAUSTED";
          else if (/exceeded CUs meter|exceeded maximum number of instructions|ComputationalBudgetExceeded/iu.test(line)) error.executionFault = "SBF_COMPUTE_BUDGET_EXCEEDED";
        }
      }
      if (Array.isArray(failure) && failure.length === 2 && Number.isSafeInteger(failure[0])) {
        const detail = failure[1];
        if (Number.isSafeInteger(detail?.Custom)) {
          error.instructionFailure = { index: failure[0], customCode: detail.Custom };
        } else if (INSTRUCTION_FAILURE_REASONS.has(detail)) {
          error.instructionFailure = { index: failure[0], reason: detail };
        }
      }
      throw error;
    }
    if (!Object.hasOwn(envelope, "result")) throw rpcError("SolanaRpcInvalidEnvelope", method);
    return envelope.result;
  }

  async sendTransaction(transactionBase64, options = {}) {
    return this.call("sendTransaction", [
      normalizePreparedTransactionBase64(transactionBase64),
      {
        encoding: "base64",
        maxRetries: checkedSmallInteger(options.maxRetries ?? 0, "maxRetries"),
        skipPreflight: options.skipPreflight === true,
      },
    ]);
  }

  async getSignatureStatus(solanaSignature) {
    const signature = normalizeSolanaSignature(solanaSignature);
    const result = await this.call("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    if (!result || !Array.isArray(result.value) || result.value.length !== 1) {
      throw new Error("SolanaRpcSignatureStatusMalformed");
    }
    return result.value[0];
  }

  async getBlockHeight() {
    return BigInt(canonicalUintDecimalLike(await this.call("getBlockHeight", [{ commitment: "finalized" }]), "blockHeight"));
  }

  async getLatestBlockhash() {
    const result = await this.call("getLatestBlockhash", [{ commitment: "finalized" }]);
    const value = requireObject(result?.value, "latestBlockhash.value");
    return Object.freeze({
      blockhash: normalizeBase58Like(value.blockhash, "latestBlockhash.blockhash"),
      lastValidBlockHeight: canonicalUintDecimalLike(value.lastValidBlockHeight, "latestBlockhash.lastValidBlockHeight"),
    });
  }

  async getMinimumBalanceForRentExemption(accountLength) {
    return BigInt(await this.call("getMinimumBalanceForRentExemption", [
      checkedAccountLength(accountLength, "accountLength"),
      { commitment: "finalized" },
    ]));
  }

  async requestAirdrop(addressBase58, lamports) {
    return normalizeSolanaSignature(
      await this.call("requestAirdrop", [
        normalizeBase58Like(addressBase58, "airdropAddressBase58"),
        checkedJsonSafeLamports(lamports, "airdropLamports"),
      ]),
    );
  }

  async getAccountInfo(addressBase58) {
    const result = await this.call("getAccountInfo", [
      normalizeBase58Like(addressBase58, "accountInfoAddressBase58"),
      { commitment: "finalized", encoding: "base64" },
    ]);
    return result?.value ?? null;
  }
}

export class InMemorySolanaDepositClaimJournal {
  #entries = new Map();

  completed(operationIdHex) {
    const entry = this.#entries.get(operationIdHex);
    return entry?.state === DEPOSIT_STATES.COMPLETED ? structuredClone(entry) : undefined;
  }

  get(operationIdHex) {
    const entry = this.#entries.get(operationIdHex);
    return entry === undefined ? undefined : structuredClone(entry);
  }

  persistPrepared(prepared) {
    const normalized = normalizePreparedEntry(prepared);
    const existing = this.#entries.get(normalized.operationIdHex);
    if (existing !== undefined) {
      assertSamePrepared(existing.prepared, normalized);
      return structuredClone(existing.prepared);
    }
    const entry = {
      protocol: SOLANA_DEPOSIT_CLAIM_SUBMITTER_PROTOCOL,
      state: "PREPARED",
      prepared: normalized,
      submittedSignature: undefined,
      result: undefined,
    };
    this.#entries.set(normalized.operationIdHex, entry);
    return structuredClone(normalized);
  }

  recordSubmitted(operationIdHex, solanaSignature) {
    const entry = this.#requireEntry(operationIdHex);
    preserveOperationHardStop(entry.state, entry.result);
    const signature = normalizeSolanaSignature(solanaSignature);
    if (entry.submittedSignature !== undefined && entry.submittedSignature !== signature) {
      throw new Error("SolanaDepositClaimSubmittedSignatureConflict");
    }
    entry.state = "SUBMITTED";
    entry.submittedSignature = signature;
    entry.prepared = {
      ...entry.prepared,
      submittedSignature: signature,
    };
  }

  recordCompleted(operationIdHex, result) {
    const entry = this.#requireEntry(operationIdHex);
    preserveOperationHardStop(entry.state, entry.result);
    entry.state = DEPOSIT_STATES.COMPLETED;
    entry.result = structuredClone(result);
  }

  recordTerminal(operationIdHex, result) {
    const entry = this.#requireEntry(operationIdHex);
    if (preserveOperationHardStop(entry.state, entry.result, result)) return;
    entry.state = result.state;
    entry.result = structuredClone(result);
  }

  #requireEntry(operationIdHex) {
    const entry = this.#entries.get(operationIdHex);
    if (entry === undefined) throw new Error("SolanaDepositClaimJournalEntryMissing");
    return entry;
  }
}

export class FileBackedSolanaDepositClaimJournal {
  #root;
  #repoRoot;

  constructor(options) {
    const value = requireObject(options, "options");
    this.#repoRoot = value.repoRoot;
    this.#root = validateStateRootOutsideRepo(value.root, this.#repoRoot, "Solana deposit claim journal root");
    mkdirSync(this.#root, { recursive: true });
  }

  completed(operationIdHex) {
    const entry = this.get(operationIdHex);
    return entry?.state === DEPOSIT_STATES.COMPLETED ? entry : undefined;
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
      protocol: SOLANA_DEPOSIT_CLAIM_SUBMITTER_PROTOCOL,
      state: "PREPARED",
      prepared: normalized,
      submittedSignature: undefined,
      result: undefined,
    });
    return structuredClone(normalized);
  }

  recordSubmitted(operationIdHex, solanaSignature) {
    const entry = this.#requireEntry(operationIdHex);
    preserveOperationHardStop(entry.state, entry.result);
    const signature = normalizeSolanaSignature(solanaSignature);
    if (entry.submittedSignature !== undefined && entry.submittedSignature !== signature) {
      throw new Error("SolanaDepositClaimSubmittedSignatureConflict");
    }
    entry.state = "SUBMITTED";
    entry.submittedSignature = signature;
    entry.prepared.submittedSignature = signature;
    this.#write(operationIdHex, entry);
  }

  recordCompleted(operationIdHex, result) {
    const entry = this.#requireEntry(operationIdHex);
    preserveOperationHardStop(entry.state, entry.result);
    entry.state = DEPOSIT_STATES.COMPLETED;
    entry.result = structuredClone(result);
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
    if (entry === undefined) throw new Error("SolanaDepositClaimJournalEntryMissing");
    return entry;
  }

  #entryPath(operationIdHex) {
    const normalized = normalizeHash32(operationIdHex, "operationIdHex");
    return validateRuntimeFile(path.join(this.#root, `${normalized}.json`), this.#repoRoot);
  }

  #write(operationIdHex, entry) {
    const target = this.#entryPath(operationIdHex);
    const temp = `${target}.${process.pid}.tmp`;
    validateRuntimeFile(temp, this.#repoRoot);
    // Flush file contents before rename. This is not authenticated/fenced
    // storage or proof of directory-metadata survival through power loss.
    writeFileSync(temp, `${JSON.stringify(entry, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temp, target);
  }
}

export function normalizeSolanaRpcEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new Error("SolanaRpcEndpointRequired");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "http:") {
    throw new Error("SolanaRpcEndpointProtocolRejected");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("SolanaRpcEndpointCredentialsRejected");
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("SolanaRpcEndpointMustBeLoopback");
  }
  return url.toString();
}

export function validateDepositClaimObservation(config, normalizedRequest, solanaSignature, status, observation) {
  const expected = normalizeSubmitterConfig(config);
  const request = normalizeDepositClaimRequestForObservation(expected, normalizedRequest);
  const value = requireObject(observation, "observation");
  if (!expected.acceptedObservationTrust.includes(value.trust)) {
    return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_DEPOSIT_CLAIM_TRUST_NOT_ACCEPTED", request);
  }
  if (value.cluster !== expected.cluster) {
    return submitterDecision(DEPOSIT_STATES.REJECTED, "SOLANA_CLUSTER_MISMATCH", request);
  }
  if (value.commitment !== "finalized" || BigInt(value.rootSlot) < BigInt(value.slot)) {
    return submitterDecision(DEPOSIT_STATES.WAITING_FOR_FINALITY, "SOLANA_DEPOSIT_CLAIM_FINALITY_NOT_REACHED", request);
  }
  if (normalizeSolanaSignature(value.transaction?.signature) !== solanaSignature || value.transaction.err !== null) {
    return submitterDecision(DEPOSIT_STATES.REJECTED, "SOLANA_DEPOSIT_TRANSACTION_OBSERVATION_MISMATCH", request);
  }
  if (status.slot !== undefined && BigInt(status.slot) !== BigInt(value.slot)) {
    return submitterDecision(DEPOSIT_STATES.WAITING_FOR_DEPENDENCY, "SOLANA_DEPOSIT_STATUS_SLOT_MISMATCH", request);
  }

  const programs = requireObject(value.programs, "observation.programs");
  if (
    normalizeHash32(programs.managerProgramIdHex, "programs.managerProgramIdHex") !== expected.managerProgramIdHex ||
    normalizeHash32(programs.transceiverProgramIdHex, "programs.transceiverProgramIdHex") !== expected.transceiverProgramIdHex
  ) {
    return submitterDecision(DEPOSIT_STATES.HARD_STOP, "UNAUTHORIZED_SOLANA_PROGRAM_ID_CHANGE", request);
  }

  const mint = requireObject(value.mint, "observation.mint");
  if (normalizeHash32(mint.addressHex, "mint.addressHex") !== expected.mintHex) {
    return submitterDecision(DEPOSIT_STATES.HARD_STOP, "UNAUTHORIZED_MINT_CHANGE", request);
  }
  if (mint.freezeAuthorityHex !== null && mint.freezeAuthorityHex !== undefined) {
    return submitterDecision(DEPOSIT_STATES.HARD_STOP, "UNAUTHORIZED_FREEZE_AUTHORITY_SET", request);
  }

  const claim = requireObject(value.depositClaim, "observation.depositClaim");
  if (
    normalizeHash32(claim.operationIdHex, "depositClaim.operationIdHex") !== request.operationIdHex ||
    normalizeHash32(claim.messageDigestHex, "depositClaim.messageDigestHex") !== request.messageDigestHex ||
    normalizeHash32(claim.mintHex, "depositClaim.mintHex") !== expected.mintHex
  ) {
    return submitterDecision(DEPOSIT_STATES.REJECTED, "SOLANA_DEPOSIT_CLAIM_IDENTITY_MISMATCH", request);
  }
  if (claim.solanaRecipientHex.toLowerCase() !== request.solanaRecipientHex) {
    return submitterDecision(DEPOSIT_STATES.REJECTED, "SOLANA_DEPOSIT_CLAIM_RECIPIENT_MISMATCH", request);
  }
  if (BigInt(claim.amountAtomic) !== BigInt(request.amountAtomic) || BigInt(claim.mintedAmountAtomic) !== BigInt(request.amountAtomic)) {
    return submitterDecision(DEPOSIT_STATES.HARD_STOP, "SOLANA_MINT_AMOUNT_MISMATCH", request);
  }

  return submitterDecision(DEPOSIT_STATES.VERIFIED_READY, "SOLANA_DEPOSIT_CLAIM_OBSERVATION_VERIFIED", request, {
    evidenceDigestHex: depositClaimObservationDigestHex(expected, request, value),
  });
}

export function depositClaimObservationDigestHex(expected, request, observation) {
  return sha256Hex(
    Buffer.from(
      JSON.stringify({
        protocol: SOLANA_DEPOSIT_CLAIM_OBSERVATION_PROTOCOL,
        cluster: expected.cluster,
        solanaDeploymentHex: expected.solanaDeploymentHex,
        operationIdHex: request.operationIdHex,
        messageDigestHex: request.messageDigestHex,
        solanaSignature: observation.transaction.signature,
        slot: String(observation.slot),
        amountAtomic: request.amountAtomic,
        solanaRecipientHex: request.solanaRecipientHex,
        trust: observation.trust,
      }),
      "utf8",
    ),
  );
}

function normalizeSubmitterConfig(config) {
  const value = requireObject(config, "config");
  return Object.freeze({
    environment: value.environment ?? "localnet",
    cluster: value.cluster ?? "localnet",
    solanaDeploymentHex: normalizeHash32(value.solanaDeploymentHex, "solanaDeploymentHex"),
    managerProgramIdHex: normalizeHash32(value.managerProgramIdHex, "managerProgramIdHex"),
    transceiverProgramIdHex: normalizeHash32(value.transceiverProgramIdHex, "transceiverProgramIdHex"),
    mintHex: normalizeHash32(value.mintHex, "mintHex"),
    policyEpoch: checkedU32(value.policyEpoch, "policyEpoch"),
    keyEpoch: checkedU32(value.keyEpoch, "keyEpoch"),
    acceptedObservationTrust: Object.freeze([...(value.acceptedObservationTrust ?? ["LOCAL_VALIDATION"])]),
  });
}

function normalizeDepositClaimRequest(config, request) {
  const value = requireObject(request, "request");
  const encodedMessageHex = normalizeHex(value.encodedMessageHex, "encodedMessageHex");
  const message = decodeCanonicalBridgeMessage(hexToBytes(encodedMessageHex, "encodedMessageHex"));
  if (message.action !== "DepositClaim" || message.direction !== "NativeToSolana") {
    throw new Error("SolanaDepositSubmitterWrongMessageKind");
  }
  checkMessageDomain(config, message);

  const operationIdHex = normalizeHash32(value.operationIdHex ?? message.operationIdHex, "operationIdHex");
  const messageDigestHex = normalizeHash32(value.messageDigestHex ?? message.messageDigestHex, "messageDigestHex");
  const amountAtomic = canonicalUintDecimal(value.amountAtomic ?? message.amountAtomic.toString(), "amountAtomic");
  const solanaRecipientHex = normalizeHex(value.solanaRecipientHex ?? message.destinationHex, "solanaRecipientHex");
  if (
    operationIdHex !== message.operationIdHex ||
    messageDigestHex !== message.messageDigestHex ||
    BigInt(amountAtomic) !== message.amountAtomic ||
    solanaRecipientHex !== message.destinationHex
  ) {
    throw new Error("SolanaDepositSubmitterRequestMessageMismatch");
  }

  validateProjectAttestations(value, encodedMessageHex, message);
  const preparedTransactionBase64 = normalizePreparedTransactionBase64(value.preparedTransactionBase64);
  const recentBlockhash = normalizeBase58Like(value.recentBlockhash, "recentBlockhash");
  const identity = verifySignedLocalnetSolanaDepositClaimTransaction({
    ...config, preparedTransactionBase64, encodedMessageHex, recipientTokenAccountHex: solanaRecipientHex,
    recentBlockhashBase58: recentBlockhash, lastValidBlockHeight: value.lastValidBlockHeight,
  });
  for (const field of ["depositClaimAccountBase58", "mintAccountBase58"]) {
    if (value[field] !== undefined && value[field] !== identity[field]) throw new Error("SolanaClaimPacketAccountMismatch");
  }
  return Object.freeze({
    operationIdHex,
    messageDigestHex,
    encodedMessageHex,
    amountAtomic,
    solanaRecipientHex,
    preparedTransactionBase64,
    recentBlockhash,
    lastValidBlockHeight: canonicalUintDecimal(value.lastValidBlockHeight, "lastValidBlockHeight"),
    ...identity,
    maxRetries: checkedSmallInteger(value.maxRetries ?? 0, "maxRetries"),
    message,
  });
}

function normalizeDepositClaimRequestForObservation(config, request) {
  const value = requireObject(request, "request");
  if (value.message !== undefined) {
    const message = value.message;
    checkMessageDomain(config, message);
    const operationIdHex = normalizeHash32(value.operationIdHex, "operationIdHex");
    const messageDigestHex = normalizeHash32(value.messageDigestHex, "messageDigestHex");
    const amountAtomic = canonicalUintDecimal(value.amountAtomic, "amountAtomic");
    const solanaRecipientHex = normalizeHex(value.solanaRecipientHex, "solanaRecipientHex");
    if (
      operationIdHex !== message.operationIdHex ||
      messageDigestHex !== message.messageDigestHex ||
      BigInt(amountAtomic) !== message.amountAtomic ||
      solanaRecipientHex !== message.destinationHex
    ) {
      throw new Error("SolanaDepositSubmitterRequestMessageMismatch");
    }
    return Object.freeze({
      ...value,
      operationIdHex,
      messageDigestHex,
      amountAtomic,
      solanaRecipientHex,
    });
  }
  return normalizeDepositClaimRequest(config, request);
}

function validateProjectAttestations(value, encodedMessageHex, message) {
  const combined = requireObject(value.combinedAttestation, "combinedAttestation");
  if (
    combined.state !== ATTESTATION_VERIFIED_READY ||
    combined.mode !== ATTESTATION_MODE ||
    combined.threshold !== 2 ||
    combined.operationIdHex !== message.operationIdHex ||
    combined.messageDigestHex !== message.messageDigestHex
  ) {
    throw new Error("SolanaDepositSubmitterAttestationThresholdInvalid");
  }
  if (!Array.isArray(value.attestations) || value.attestations.length !== 2) {
    throw new Error("SolanaDepositSubmitterExactlyTwoAttestationsRequired");
  }
  const seen = new Set();
  for (const attestation of value.attestations) {
    const key = normalizeHash32(attestation.attesterPublicKeyHex, "attesterPublicKeyHex");
    if (seen.has(key)) {
      throw new Error("SolanaDepositSubmitterDuplicateAttester");
    }
    if (!verifyProjectAttestation(attestation, encodedMessageHex)) {
      throw new Error("SolanaDepositSubmitterInvalidAttestationSignature");
    }
    seen.add(key);
  }
  const combinedKeys = new Set(combined.attesterPublicKeys ?? []);
  if (combinedKeys.size !== 2 || [...seen].some((key) => !combinedKeys.has(key))) {
    throw new Error("SolanaDepositSubmitterCombinedAttestationMismatch");
  }
}

function checkMessageDomain(config, message) {
  if (bytesToHex(message.deployment.solanaDeployment) !== config.solanaDeploymentHex) {
    throw new Error("SolanaDepositSubmitterDeploymentMismatch");
  }
  if (bytesToHex(message.deployment.managerProgramId) !== config.managerProgramIdHex) {
    throw new Error("SolanaDepositSubmitterManagerProgramMismatch");
  }
  if (bytesToHex(message.deployment.transceiverProgramId) !== config.transceiverProgramIdHex) {
    throw new Error("SolanaDepositSubmitterTransceiverProgramMismatch");
  }
  if (bytesToHex(message.deployment.mint) !== config.mintHex) {
    throw new Error("SolanaDepositSubmitterMintMismatch");
  }
  if (message.policyEpoch !== config.policyEpoch) {
    throw new Error("SolanaDepositSubmitterPolicyEpochMismatch");
  }
  if (message.keyEpoch !== config.keyEpoch) {
    throw new Error("SolanaDepositSubmitterKeyEpochMismatch");
  }
}

function normalizePreparedEntry(prepared) {
  const value = requireObject(prepared, "prepared");
  return Object.freeze({
    protocol: SOLANA_DEPOSIT_CLAIM_SUBMITTER_PROTOCOL,
    state: "PREPARED",
    operationIdHex: normalizeHash32(value.operationIdHex, "operationIdHex"),
    messageDigestHex: normalizeHash32(value.messageDigestHex, "messageDigestHex"),
    encodedMessageHex: normalizeHex(value.encodedMessageHex, "encodedMessageHex"),
    amountAtomic: canonicalUintDecimal(value.amountAtomic, "amountAtomic"),
    solanaRecipientHex: normalizeHex(value.solanaRecipientHex, "solanaRecipientHex"),
    preparedTransactionBase64: normalizePreparedTransactionBase64(value.preparedTransactionBase64),
    preparedTransactionFingerprintHex: normalizeHash32(
      value.preparedTransactionFingerprintHex,
      "preparedTransactionFingerprintHex",
    ),
    recentBlockhash: normalizeBase58Like(value.recentBlockhash, "recentBlockhash"),
    lastValidBlockHeight: canonicalUintDecimal(value.lastValidBlockHeight, "lastValidBlockHeight"),
    depositClaimAccountBase58:
      value.depositClaimAccountBase58 === undefined
        ? undefined
        : normalizeBase58Like(value.depositClaimAccountBase58, "depositClaimAccountBase58"),
    mintAccountBase58:
      value.mintAccountBase58 === undefined ? undefined : normalizeBase58Like(value.mintAccountBase58, "mintAccountBase58"),
    submittedSignature:
      value.submittedSignature === undefined ? undefined : normalizeSolanaSignature(value.submittedSignature),
  });
}

function assertSamePrepared(existing, incoming) {
  const comparable = [
    "operationIdHex",
    "messageDigestHex",
    "encodedMessageHex",
    "amountAtomic",
    "solanaRecipientHex",
    "preparedTransactionBase64",
    "recentBlockhash",
    "lastValidBlockHeight",
    "depositClaimAccountBase58",
    "mintAccountBase58",
  ];
  for (const key of comparable) {
    if (existing[key] !== incoming[key]) {
      throw new Error(`SolanaDepositClaimJournalConflict:${key}`);
    }
  }
}

function submitterDecision(state, reason, normalized, extra = {}) {
  return Object.freeze({
    protocol: SOLANA_DEPOSIT_CLAIM_SUBMITTER_PROTOCOL,
    state,
    reason,
    operationIdHex: normalized.operationIdHex,
    messageDigestHex: normalized.messageDigestHex,
    amountAtomic: normalized.amountAtomic,
    solanaRecipientHex: normalized.solanaRecipientHex,
    ...extra,
  });
}

function normalizePreparedTransactionBase64(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 64_000 || !BASE64_TRANSACTION.test(value)) {
    throw new Error("SolanaPreparedTransactionBase64Invalid");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > 1232) throw new Error("SolanaTransactionPacketLimitExceeded");
  if (decoded.length === 0 || decoded.toString("base64") !== value) {
    throw new Error("SolanaPreparedTransactionBase64Invalid");
  }
  return value;
}

function normalizeSolanaSignature(value) {
  if (typeof value !== "string" || !BASE58_LIKE.test(value)) {
    throw new Error("SolanaSignatureInvalid");
  }
  return value;
}

function normalizeBase58Like(value, label) {
  if (typeof value !== "string" || !BASE58_LIKE.test(value)) {
    throw new Error(`${label}:InvalidBase58`);
  }
  return value;
}

function normalizeHash32(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function canonicalUintDecimal(value, label) {
  if (typeof value !== "string" || !UINT_DECIMAL.test(value)) {
    throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
  }
  return value;
}

function canonicalUintDecimalLike(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
    }
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}:ExpectedCanonicalUintDecimal`);
    }
    return String(value);
  }
  return canonicalUintDecimal(value, label);
}

function checkedSmallInteger(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new Error(`${label}:ExpectedSmallInteger`);
  }
  return value;
}

function checkedAccountLength(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
    throw new Error(`${label}:ExpectedAccountLength`);
  }
  return value;
}

function checkedJsonSafeLamports(value, label) {
  const normalized = canonicalUintDecimalLike(value, label);
  const lamports = BigInt(normalized);
  if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label}:ExpectedPositiveJsonSafeLamports`);
  }
  return Number(lamports);
}

function checkedU32(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new Error(`${label}:ExpectedU32`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rpcError(kind, method, code = undefined) {
  const error = new Error(code === undefined ? `${kind}:${method}` : `${kind}:${method}:${code}`);
  error.kind = kind;
  error.method = method;
  error.code = code;
  return error;
}
