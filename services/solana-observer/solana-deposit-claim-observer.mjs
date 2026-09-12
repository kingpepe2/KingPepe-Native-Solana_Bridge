import { bytesToHex, isHash32Hex, normalizeHex } from "../../shared/protocol/canonical-message.mjs";
import { base58Decode, base58Encode, findProgramAddress, DEPOSIT_CLAIM_PDA_SEED_PREFIX, MINT_AUTHORITY_PDA_SEED_PREFIX } from "../bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { verifyDepositMintExecution } from "./deposit-mint-execution.mjs";

export const SOLANA_DEPOSIT_CLAIM_OBSERVER_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/SOLANA_DEPOSIT_CLAIM_OBSERVER/V1";
export const SOLANA_DEPOSIT_CLAIM_RPC_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/SOLANA_DEPOSIT_CLAIM_RPC/V1";

const LOCALNET = "localnet";
const RPC_OBSERVATION = "RPC_OBSERVATION";
const FINALIZED = "finalized";
const DEPOSIT_CLAIM_MAGIC = "KPBCLM01";
const DEPOSIT_CLAIM_VERSION = 1;
const DEPOSIT_CLAIM_ACCOUNT_LENGTH = 211;
const DEPOSIT_CLAIM_DESTINATION_MAX_LENGTH = 128;
const SPL_MINT_ACCOUNT_LENGTH = 82;
const SPL_FREEZE_AUTHORITY_TAG_OFFSET = 46;
const SPL_FREEZE_AUTHORITY_VALUE_OFFSET = 50;
const ALLOWED_RPC_METHODS = new Set(["getTransaction", "getSlot", "getAccountInfo", "getGenesisHash"]);
const RPC_INSTANCES = new WeakSet(), PROTECTED_OBSERVATIONS = new WeakSet();
export function requireProtectedClaimObservation(value) {
  if (!PROTECTED_OBSERVATIONS.has(value)) throw new Error("ProtectedClaimObservationRequired");
}
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/u;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export class SolanaDepositClaimObserver {
  #config;
  #rpcClient;

  constructor(options = {}) {
    if (!options || typeof options !== "object") {
      throw new Error("MissingSolanaDepositClaimObserverOptions");
    }
    this.#config = normalizeSolanaDepositClaimObserverConfig(options.config);
    this.#rpcClient =
      options.rpcClient ??
      new SolanaDepositClaimRpcClient({
        endpoint: options.endpoint,
      });
  }

  async observeProtectedFinalizedDepositClaim(input, expectedGenesis) {
    input = structuredClone(input);
    // Protected accounting does not accept the callback adapters used by unit
    // tests as evidence of a live query. This remains RPC_OBSERVATION, never
    // independent Solana consensus or a replacement for deployment monitoring.
    if (!RPC_INSTANCES.has(this.#rpcClient)) throw new Error("ProtectedClaimLiveRpcRequired");
    if (typeof expectedGenesis !== "string" || base58Decode(expectedGenesis).length !== 32 ||
        base58Encode(base58Decode(expectedGenesis)) !== expectedGenesis) throw new Error("ProtectedClaimGenesisRequired");
    const before = await this.#rpcClient.getGenesisHash();
    if (before !== expectedGenesis) throw integrityError("SOLANA_CLAIM_GENESIS_MISMATCH");
    const observed = await this.observeFinalizedDepositClaim(input);
    try { verifyDepositMintExecution(await this.#rpcClient.getSignedTransaction(input.solanaSignature), observed, this.#config); }
    catch (error) {
      if (error?.message === "SOLANA_CLAIM_EXECUTION_MISMATCH") throw integrityError(error.message);
      throw error;
    }
    if (await this.#rpcClient.getGenesisHash() !== expectedGenesis) throw integrityError("SOLANA_CLAIM_GENESIS_MISMATCH");
    if (observed.transaction.err !== null || BigInt(observed.rootSlot) < BigInt(observed.slot) || observed.mint.freezeAuthorityHex !== null) {
      throw integrityError("SOLANA_CLAIM_NOT_FINALIZED_SUCCESS");
    }
    const result = Object.freeze({ ...observed, genesis: expectedGenesis });
    PROTECTED_OBSERVATIONS.add(result); return result;
  }

  async observeFinalizedDepositClaim(input = {}) {
    if (this.#config.environment !== LOCALNET || this.#config.cluster !== LOCALNET) {
      throw new Error("SolanaDepositClaimObserverLocalnetOnly");
    }

    const request = normalizeSolanaDepositClaimObservationRequest(input, this.#config);
    const manager = Buffer.from(this.#config.managerProgramIdHex, "hex");
    const mint = Buffer.from(this.#config.mintHex, "hex");
    const expectedClaim = findProgramAddress([Buffer.from(DEPOSIT_CLAIM_PDA_SEED_PREFIX), Buffer.from(request.operationIdHex, "hex")], manager);
    if (request.depositClaimAccountBase58 !== expectedClaim.base58 || request.mintAccountBase58 !== base58Encode(mint)) {
      throw integrityError("SOLANA_DEPOSIT_ACCOUNT_ADDRESS_MISMATCH");
    }
    const transaction = await this.#rpcClient.getTransaction(request.solanaSignature);
    if (!transaction) {
      throw new Error("SolanaDepositClaimTransactionUnavailable");
    }
    const slot = normalizeSlot(transaction.slot, "transaction.slot");
    const transactionMeta = requireObject(transaction.meta, "transaction.meta");
    if (!Object.hasOwn(transactionMeta, "err")) throw new Error("SolanaDepositClaimTransactionStatusMissing");
    const rootSlot = normalizeSlot(await this.#rpcClient.getFinalizedSlot(), "rootSlot");

    const claimAccount = await this.#rpcClient.getAccountInfo(request.depositClaimAccountBase58);
    validateAccountBoundary(claimAccount, base58Encode(manager), slot);
    const claimRecord = decodeDepositClaimAccountBase64(extractBase64AccountData(claimAccount, "depositClaimAccount"));
    if (claimRecord.operationIdHex !== request.operationIdHex) {
      throw new Error("SolanaDepositClaimObservedOperationMismatch");
    }
    if (claimRecord.messageDigestHex !== request.messageDigestHex) {
      throw new Error("SolanaDepositClaimObservedMessageDigestMismatch");
    }
    const mintAccount = await this.#rpcClient.getAccountInfo(request.mintAccountBase58);
    validateAccountBoundary(mintAccount, TOKEN_PROGRAM, slot);
    const mintRecord = decodeSplMintAccountBase64(extractBase64AccountData(mintAccount, "mintAccount"));
    const expectedAuthority = findProgramAddress([Buffer.from(MINT_AUTHORITY_PDA_SEED_PREFIX), mint], manager);
    if (mintRecord.mintAuthorityHex !== expectedAuthority.hex || mintRecord.decimals !== this.#config.nativeDecimals) {
      throw integrityError("SOLANA_MINT_AUTHORITY_OR_PRECISION_MISMATCH");
    }

    return Object.freeze({
      protocol: SOLANA_DEPOSIT_CLAIM_OBSERVER_PROTOCOL,
      trust: RPC_OBSERVATION,
      cluster: this.#config.cluster,
      slot: slot.toString(),
      rootSlot: rootSlot.toString(),
      commitment: FINALIZED,
      transaction: Object.freeze({
        signature: request.solanaSignature,
        err: transactionMeta.err ?? null,
      }),
      programs: Object.freeze({
        managerProgramIdHex: this.#config.managerProgramIdHex,
        transceiverProgramIdHex: this.#config.transceiverProgramIdHex,
      }),
      mint: Object.freeze({
        addressHex: this.#config.mintHex,
        freezeAuthorityHex: mintRecord.freezeAuthorityHex,
        mintAuthorityHex: mintRecord.mintAuthorityHex,
        supplyAtomic: mintRecord.supplyAtomic,
        decimals: mintRecord.decimals,
      }),
      depositClaim: Object.freeze({
        operationIdHex: claimRecord.operationIdHex,
        messageDigestHex: claimRecord.messageDigestHex,
        mintHex: this.#config.mintHex,
        amountAtomic: claimRecord.amountAtomic,
        mintedAmountAtomic: claimRecord.amountAtomic,
        solanaRecipientHex: claimRecord.solanaRecipientHex,
      }),
    });
  }
}

export class SolanaDepositClaimRpcClient {
  #endpoint;
  #requestId = 0;
  #timeoutMs;
  #maxResponseBytes;

  constructor(options = {}) {
    this.#endpoint = normalizeSolanaDepositClaimRpcEndpoint(options.endpoint);
    this.#timeoutMs = boundedLimit(options.timeoutMs ?? 10_000, 10, 30_000);
    this.#maxResponseBytes = boundedLimit(options.maxResponseBytes ?? 2_097_152, 128, 4_194_304);
    RPC_INSTANCES.add(this);
  }

  async getGenesisHash() { return this.call("getGenesisHash", []); }

  async getSignedTransaction(solanaSignature) {
    return this.call("getTransaction", [normalizeBase58(solanaSignature, "solanaSignature"),
      { commitment: FINALIZED, encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  }

  async getTransaction(solanaSignature) {
    return this.call("getTransaction", [
      normalizeBase58(solanaSignature, "solanaSignature"),
      {
        commitment: FINALIZED,
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      },
    ]);
  }

  async getFinalizedSlot() {
    return this.call("getSlot", [{ commitment: FINALIZED }]);
  }

  async getAccountInfo(addressBase58) {
    return this.call("getAccountInfo", [
      normalizeBase58(addressBase58, "accountAddress"),
      {
        commitment: FINALIZED,
        encoding: "base64",
      },
    ]);
  }

  async call(method, params = []) {
    if (!ALLOWED_RPC_METHODS.has(method)) {
      throw new Error(`SolanaDepositClaimRpcMethodNotAllowed:${method}`);
    }
    const id = ++this.#requestId;
    if (!Number.isSafeInteger(id)) throw new Error("SolanaDepositClaimRpcRequestIdExhausted");
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.#timeoutMs);
    let reader;
    try {
      const response = await fetch(this.#endpoint, {
        method: "POST", redirect: "error", signal: abort.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!response.ok) throw new Error("SolanaDepositClaimRpcHttpRejected");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > this.#maxResponseBytes)) {
        throw new Error("SolanaDepositClaimRpcResponseTooLarge");
      }
      if (!response.body) throw new Error("SolanaDepositClaimRpcEmptyResponse");
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > this.#maxResponseBytes) throw new Error("SolanaDepositClaimRpcResponseTooLarge");
        chunks.push(value);
      }
      let payload;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))); }
      catch { throw new Error("SolanaDepositClaimRpcMalformedResponse"); }
      if (!payload || Array.isArray(payload) || payload.jsonrpc !== "2.0" || payload.id !== id
          || !Object.hasOwn(payload, "result") || Object.hasOwn(payload, "error")) {
        throw new Error("SolanaDepositClaimRpcInvalidEnvelope");
      }
      return payload.result;
    } catch (error) {
      // Never surface an RPC error body, redirect target, endpoint or exception cause.
      if (/^SolanaDepositClaimRpc[A-Za-z]+$/u.test(error?.message)) throw new Error(error.message);
      throw new Error(abort.signal.aborted ? "SolanaDepositClaimRpcTimeout" : "SolanaDepositClaimRpcUnavailable");
    } finally {
      clearTimeout(timer);
      abort.abort();
      if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    }
  }
}

function boundedLimit(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error("SolanaDepositClaimRpcInvalidLimit");
  return value;
}

export function normalizeSolanaDepositClaimRpcEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    throw new Error("MissingSolanaDepositClaimRpcEndpoint");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "http:") {
    throw new Error("SolanaDepositClaimRpcEndpointProtocolRejected");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("SolanaDepositClaimRpcEndpointCredentialsRejected");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("SolanaDepositClaimRpcEndpointMustBeLoopback");
  }
  if (url.search || url.hash || url.pathname !== "/") throw new Error("SolanaDepositClaimRpcEndpointPathRejected");
  return url.toString();
}

export function decodeDepositClaimAccountBase64(base64Data) {
  return decodeDepositClaimAccountBytes(decodeBase64AccountData(base64Data, "depositClaimAccount.data"));
}

export function decodeDepositClaimAccountBytes(input) {
  const bytes = asUint8Array(input, "depositClaimAccount");
  if (bytes.length !== DEPOSIT_CLAIM_ACCOUNT_LENGTH) {
    throw new Error(`DepositClaimAccountInvalidLength:${bytes.length}`);
  }
  let cursor = 0;
  const magic = Buffer.from(bytes.slice(cursor, cursor + 8)).toString("ascii");
  cursor += 8;
  if (magic !== DEPOSIT_CLAIM_MAGIC) {
    throw new Error("DepositClaimAccountInvalidMagic");
  }
  const version = bytes[cursor];
  cursor += 1;
  if (version !== DEPOSIT_CLAIM_VERSION) {
    throw new Error("DepositClaimAccountUnsupportedVersion");
  }
  const operationIdHex = bytesToHex(bytes.slice(cursor, cursor + 32));
  cursor += 32;
  const messageDigestHex = bytesToHex(bytes.slice(cursor, cursor + 32));
  cursor += 32;
  const amountAtomic = readU64LE(bytes, cursor).toString();
  cursor += 8;
  const destinationLength = readU16LE(bytes, cursor);
  cursor += 2;
  if (destinationLength > DEPOSIT_CLAIM_DESTINATION_MAX_LENGTH) {
    throw new Error("DepositClaimAccountDestinationTooLong");
  }
  const destinationPadded = bytes.slice(cursor, cursor + DEPOSIT_CLAIM_DESTINATION_MAX_LENGTH);
  const destination = destinationPadded.slice(0, destinationLength);
  const destinationPadding = destinationPadded.slice(destinationLength);
  if (destinationPadding.some((byte) => byte !== 0)) {
    throw new Error("DepositClaimAccountNonZeroDestinationPadding");
  }
  cursor += DEPOSIT_CLAIM_DESTINATION_MAX_LENGTH;
  if (cursor !== DEPOSIT_CLAIM_ACCOUNT_LENGTH) {
    throw new Error(`DepositClaimAccountInvalidCursor:${cursor}`);
  }

  return Object.freeze({
    operationIdHex,
    messageDigestHex,
    amountAtomic,
    solanaRecipientHex: bytesToHex(destination),
  });
}

export function decodeSplMintAccountBase64(base64Data) {
  return decodeSplMintAccountBytes(decodeBase64AccountData(base64Data, "mintAccount.data"));
}

export function decodeSplMintAccountBytes(input) {
  const bytes = asUint8Array(input, "mintAccount");
  if (bytes.length !== SPL_MINT_ACCOUNT_LENGTH) {
    throw new Error(`SplMintAccountInvalidLength:${bytes.length}`);
  }
  const freezeAuthorityTag = readU32LE(bytes, SPL_FREEZE_AUTHORITY_TAG_OFFSET);
  const authorityTag = readU32LE(bytes, 0);
  if (![0, 1].includes(authorityTag) || bytes[45] !== 1) throw new Error("SplMintAccountInvalidInitializationOrAuthorityTag");
  const fields = {
    mintAuthorityHex: authorityTag === 0 ? null : bytesToHex(bytes.slice(4, 36)),
    supplyAtomic: readU64LE(bytes, 36).toString(),
    decimals: bytes[44],
  };
  if (freezeAuthorityTag === 0) {
    return Object.freeze({ ...fields, freezeAuthorityHex: null });
  }
  if (freezeAuthorityTag !== 1) {
    throw new Error("SplMintAccountInvalidFreezeAuthorityTag");
  }
  return Object.freeze({
    ...fields,
    freezeAuthorityHex: bytesToHex(
      bytes.slice(SPL_FREEZE_AUTHORITY_VALUE_OFFSET, SPL_FREEZE_AUTHORITY_VALUE_OFFSET + 32),
    ),
  });
}

function normalizeSolanaDepositClaimObserverConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("MissingSolanaDepositClaimObserverConfig");
  }
  return Object.freeze({
    environment: config.environment ?? LOCALNET,
    cluster: config.cluster ?? LOCALNET,
    managerProgramIdHex: normalizeHashLike(config.managerProgramIdHex, "managerProgramIdHex"),
    transceiverProgramIdHex: normalizeHashLike(config.transceiverProgramIdHex, "transceiverProgramIdHex"),
    mintHex: normalizeHashLike(config.mintHex, "mintHex"),
    nativeDecimals: checkedDecimals(config.nativeDecimals ?? 8),
    depositClaimAccountBase58:
      config.depositClaimAccountBase58 === undefined
        ? undefined
        : normalizeBase58(config.depositClaimAccountBase58, "depositClaimAccountBase58"),
    mintAccountBase58:
      config.mintAccountBase58 === undefined ? undefined : normalizeBase58(config.mintAccountBase58, "mintAccountBase58"),
  });
}

function normalizeSolanaDepositClaimObservationRequest(input, config) {
  if (!input || typeof input !== "object") {
    throw new Error("MissingSolanaDepositClaimObservationRequest");
  }
  return Object.freeze({
    operationIdHex: normalizeHashLike(input.operationIdHex, "operationIdHex"),
    messageDigestHex: normalizeHashLike(input.messageDigestHex, "messageDigestHex"),
    solanaSignature: normalizeBase58(input.solanaSignature, "solanaSignature"),
    depositClaimAccountBase58: normalizeBase58(
      input.depositClaimAccountBase58 ?? config.depositClaimAccountBase58,
      "depositClaimAccountBase58",
    ),
    mintAccountBase58: normalizeBase58(input.mintAccountBase58 ?? config.mintAccountBase58, "mintAccountBase58"),
  });
}

function checkedDecimals(value) {
  if (!Number.isInteger(value) || value < 0 || value > 18) throw new Error("SolanaObserverDecimalsInvalid");
  return value;
}

function integrityError(code) {
  const error = new Error(code);
  error.integrityCode = code;
  return error;
}

function validateAccountBoundary(envelope, expectedProgram, transactionSlot) {
  const account = envelope?.value;
  if (!account) throw new Error("SolanaObservedAccountMissing");
  if (account.owner !== expectedProgram || account.executable !== false) {
    throw integrityError("SOLANA_DEPOSIT_ACCOUNT_PROGRAM_MISMATCH");
  }
  if (normalizeSlot(envelope.context?.slot, "accountContextSlot") < transactionSlot) {
    throw new Error("SolanaObservedAccountSnapshotStale");
  }
}

function extractBase64AccountData(accountInfo, label) {
  const account = accountInfo?.value;
  if (!account) {
    throw new Error(`${label}:MissingAccount`);
  }
  const data = account.data;
  if (!Array.isArray(data) || data.length < 2 || data[1] !== "base64") {
    throw new Error(`${label}:ExpectedBase64Data`);
  }
  return data[0];
}

function decodeBase64AccountData(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}:MissingBase64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64").replaceAll("=", "") !== value.replaceAll("=", "")) {
    throw new Error(`${label}:InvalidBase64`);
  }
  return bytes;
}

function normalizeHashLike(value, label) {
  const normalized = normalizeHex(value, label);
  if (!isHash32Hex(normalized)) {
    throw new Error(`${label}:Expected32Bytes`);
  }
  return normalized;
}

function normalizeBase58(value, label) {
  if (typeof value !== "string" || !BASE58_PATTERN.test(value)) {
    throw new Error(`${label}:InvalidBase58`);
  }
  return value;
}

function normalizeSlot(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${label}:Negative`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}:InvalidNumber`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) {
    return BigInt(value);
  }
  throw new Error(`${label}:Invalid`);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}

function asUint8Array(input, label) {
  if (input instanceof Uint8Array) {
    return input;
  }
  throw new Error(`${label}:ExpectedBytes`);
}

function readU16LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8);
}

function readU32LE(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000;
}

function readU64LE(bytes, offset) {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) + BigInt(bytes[offset + index]);
  }
  return value;
}
