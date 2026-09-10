import { readFileSync } from "node:fs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";

export const NATIVE_RPC_ADAPTER_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_ADAPTER/V1";
export const NATIVE_RPC_SOURCE_SNAPSHOT_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_SOURCE_SNAPSHOT/V1";
export const NATIVE_RPC_UTXO_OBSERVATION_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/NATIVE_RPC_UTXO_OBSERVATION/V1";
export const RPC_OBSERVATION = "RPC_OBSERVATION";
export const SOURCE_READY = "READY";
export const SOURCE_WAITING = "WAITING_FOR_DEPENDENCY";
export const SOURCE_REJECTED = "REJECTED";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_NATIVE_DECIMALS = 8;
const JSON_RPC_VERSION = "1.0";
const METHOD_ALLOWLIST = new Set([
  "getbestblockhash",
  "getblock",
  "getblockchaininfo",
  "getblockhash",
  "getblockheader",
  "getrawtransaction",
  "gettxout",
  "sendrawtransaction",
  "stop",
]);

export class NativeRpcClient {
  #endpoint;
  #authHeader;
  #fetchFn;
  #timeoutMs;
  #maximumResponseBytes;
  #nextId = 1;

  constructor(options = {}) {
    this.#endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:18443", {
      localOnly: options.localOnly !== false,
    });
    this.#authHeader = buildAuthorizationHeader(options);
    this.#fetchFn = options.fetchFn ?? globalThis.fetch;
    if (typeof this.#fetchFn !== "function") {
      throw new Error("NativeRpcFetchUnavailable");
    }
    this.#timeoutMs = checkedPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.#maximumResponseBytes = checkedPositiveInteger(options.maximumResponseBytes ?? 8_000_000, "maximumResponseBytes");
    if (this.#maximumResponseBytes > 16_000_000) throw new Error("NativeRpcResponseLimitTooLarge");
  }

  endpointForReport() {
    const url = new URL(this.#endpoint);
    return `${url.protocol}//${url.hostname}:${url.port}`;
  }

  async call(method, params = []) {
    if (!METHOD_ALLOWLIST.has(method)) {
      throw new Error(`NativeRpcMethodNotAllowed:${method}`);
    }
    if (!Array.isArray(params)) {
      throw new Error("NativeRpcParamsMustBeArray");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const id = this.#nextId;
    this.#nextId += 1;
    try {
      const response = await this.#fetchFn(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#authHeader === undefined ? {} : { authorization: this.#authHeader }),
        },
        body: JSON.stringify({
          jsonrpc: JSON_RPC_VERSION,
          id,
          method,
          params,
        }),
        signal: controller.signal,
      });
      // Native's legacy JSON-RPC endpoint returns structured RPC errors with
      // HTTP 400/404/500. Parse those bounded envelopes, but never accept a
      // success result on a failing HTTP status or expose provider error text.
      const httpFailure = !response.ok;
      if (httpFailure && ![400, 404, 500].includes(response.status)) {
        await response.body?.cancel();
        throw rpcError("NativeRpcHttpFailure", method, response.status);
      }
      const raw = await readBoundedRpcResponse(response, this.#maximumResponseBytes);
      let envelope;
      try {
        envelope = JSON.parse(raw);
      } catch {
        throw httpFailure ? rpcError("NativeRpcHttpFailure", method, response.status) : rpcError("NativeRpcInvalidJson", method);
      }
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.id !== id) {
        throw rpcError("NativeRpcInvalidEnvelope", method);
      }
      if (envelope.error !== null && envelope.error !== undefined) {
        const code = envelope.error?.code;
        if (typeof envelope.error !== "object" || Array.isArray(envelope.error) || !Number.isInteger(code)
          || code < -0x8000_0000 || code > 0x7fff_ffff) throw rpcError("NativeRpcInvalidEnvelope", method);
        throw rpcError("NativeRpcRejected", method, code);
      }
      if (httpFailure) throw rpcError("NativeRpcHttpFailure", method, response.status);
      if (!Object.hasOwn(envelope, "result")) throw rpcError("NativeRpcInvalidEnvelope", method);
      return Object.freeze({
        method,
        id: envelope.id,
        result: envelope.result,
        raw,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getBlockchainInfo() {
    return (await this.call("getblockchaininfo")).result;
  }

  async getSourceSnapshot(options = {}) {
    const info = requireObject(await this.getBlockchainInfo(), "getblockchaininfo.result");
    const genesisHash = normalizeHash32((await this.call("getblockhash", [0])).result, "genesisHash");
    const expectedNetwork = options.expectedNetwork;
    const expectedGenesisHash =
      options.expectedGenesisHash === undefined
        ? undefined
        : normalizeHash32(options.expectedGenesisHash, "expectedGenesisHash");
    const network = checkedNetworkName(info.chain, "chain");
    const bestHash = normalizeHash32(info.bestblockhash, "bestblockhash");
    const bestHeight = checkedNonNegativeInteger(info.blocks, "blocks");
    const headers = checkedNonNegativeInteger(info.headers ?? info.blocks, "headers");
    const inInitialBlockDownload = info.initialblockdownload === true;
    const stale = headers < bestHeight;
    const internallyConsistent = headers >= bestHeight && typeof info.chainwork === "string";
    const state =
      expectedNetwork !== undefined && network !== expectedNetwork
        ? SOURCE_REJECTED
        : expectedGenesisHash !== undefined && genesisHash !== expectedGenesisHash
          ? SOURCE_REJECTED
          : inInitialBlockDownload || stale || !internallyConsistent
            ? SOURCE_WAITING
            : SOURCE_READY;

    return Object.freeze({
      protocol: NATIVE_RPC_SOURCE_SNAPSHOT_PROTOCOL,
      adapterProtocol: NATIVE_RPC_ADAPTER_PROTOCOL,
      trust: RPC_OBSERVATION,
      state,
      reason: sourceReason({
        state,
        network,
        expectedNetwork,
        genesisHash,
        expectedGenesisHash,
        inInitialBlockDownload,
        stale,
        internallyConsistent,
      }),
      endpoint: this.endpointForReport(),
      network,
      genesisHash,
      bestHash,
      bestHeight,
      headers,
      chainworkHex: normalizeHexText(info.chainwork, "chainwork"),
      inInitialBlockDownload,
      stale,
      internallyConsistent,
    });
  }

  async getBlockHeader(blockHash, verbose = true) {
    return (await this.call("getblockheader", [normalizeHash32(blockHash, "blockHash"), verbose])).result;
  }

  async getBlock(blockHash, verbosity = 2) {
    return (await this.call("getblock", [normalizeHash32(blockHash, "blockHash"), verbosity])).result;
  }

  async getRawTransaction(txid, verbose = false, blockHash = undefined) {
    const params = [normalizeHash32(txid, "txid"), verbose];
    if (blockHash !== undefined) params.push(normalizeHash32(blockHash, "blockHash"));
    return (await this.call("getrawtransaction", params)).result;
  }

  async getUtxoObservation(input) {
    const value = requireObject(input, "utxoInput");
    const txid = normalizeHash32(value.txid, "utxoInput.txid");
    const vout = checkedNonNegativeInteger(value.vout, "utxoInput.vout");
    const includeMempool = value.includeMempool === true;
    const response = await this.call("gettxout", [txid, vout, includeMempool]);
    if (response.result === null) {
      return Object.freeze({
        protocol: NATIVE_RPC_UTXO_OBSERVATION_PROTOCOL,
        adapterProtocol: NATIVE_RPC_ADAPTER_PROTOCOL,
        trust: RPC_OBSERVATION,
        outpoint: Object.freeze({ txid, vout }),
        unspent: false,
      });
    }

    const result = requireObject(response.result, "gettxout.result");
    const decimalText = extractResultDecimalText(response.raw, "value");
    const decimals = checkedNonNegativeInteger(value.decimals ?? DEFAULT_NATIVE_DECIMALS, "utxoInput.decimals");
    return Object.freeze({
      protocol: NATIVE_RPC_UTXO_OBSERVATION_PROTOCOL,
      adapterProtocol: NATIVE_RPC_ADAPTER_PROTOCOL,
      trust: RPC_OBSERVATION,
      outpoint: Object.freeze({ txid, vout }),
      unspent: true,
      valueAtomic: decimalCoinsToAtomic(decimalText, decimals).toString(),
      scriptPubKeyHex: normalizeHexText(result.scriptPubKey?.hex, "scriptPubKey.hex"),
      bestBlockHash: normalizeHash32(result.bestblock, "bestblock"),
      confirmations: checkedNonNegativeInteger(result.confirmations, "confirmations"),
      coinbase: result.coinbase === true,
    });
  }

  async sendRawTransaction(rawTransactionHex) {
    return normalizeHash32(
      (await this.call("sendrawtransaction", [normalizeHexText(rawTransactionHex, "rawTransactionHex")])).result,
      "sendrawtransaction.result",
    );
  }

  async stop() {
    return (await this.call("stop")).result;
  }
}

async function readBoundedRpcResponse(response, maximum) {
  const declared = response.headers?.get("content-length");
  if (declared !== null && declared !== undefined && (!/^[0-9]+$/u.test(declared) || Number(declared) > maximum)) {
    await response.body?.cancel();
    throw new Error("NativeRpcResponseTooLarge");
  }
  if (!response.body?.getReader) throw new Error("NativeRpcBoundedStreamRequired");
  const reader = response.body.getReader();
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); throw new Error("NativeRpcResponseTooLarge"); }
      parts.push(Buffer.from(value));
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, length)); }
    catch { throw new Error("NativeRpcInvalidUtf8"); }
  } finally { reader.releaseLock(); }
}

export function createNativeRegtestRpcClient(options = {}) {
  return new NativeRpcClient({
    ...options,
    localOnly: true,
  });
}

export function normalizeEndpoint(endpoint, options = {}) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new Error("NativeRpcEndpointRequired");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NativeRpcEndpointProtocolRejected");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("NativeRpcEndpointCredentialsRejected");
  }
  if (options.localOnly !== false && !isLoopbackHostname(url.hostname)) {
    throw new Error("NativeRpcEndpointMustBeLoopback");
  }
  return url.toString();
}

export function readAuthorizationHeaderFromCookieFile(cookieFile, repoRoot = undefined) {
  if (cookieFile === undefined || cookieFile === null || cookieFile === "") return undefined;
  if (typeof cookieFile !== "string") throw new Error("NativeRpcAuthCookieFileInvalid");
  let resolved;
  try { resolved = validateRuntimeFile(cookieFile, repoRoot); }
  catch (error) {
    if (error.message.includes("InsideRepositoryRejected")) throw new Error("NativeRpcAuthCookieInsideRepositoryRejected");
    throw new Error("NativeRpcAuthCookiePathRejected");
  }
  let line;
  try {
    line = readFileSync(resolved, "utf8").split(/\r?\n/u)[0]?.trim();
  } catch {
    throw new Error("NativeRpcAuthCookieUnreadable");
  }
  if (line === undefined || line.length === 0 || !line.includes(":")) {
    throw new Error("NativeRpcAuthCookieMalformed");
  }
  return `Basic ${Buffer.from(line, "utf8").toString("base64")}`;
}

export function decimalCoinsToAtomic(decimalText, decimals = DEFAULT_NATIVE_DECIMALS) {
  if (typeof decimalText !== "string") throw new Error("NativeRpcAmountMustBeText");
  const precision = checkedNonNegativeInteger(decimals, "decimals");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(decimalText)) {
    throw new Error("NativeRpcAmountNonCanonical");
  }
  const [whole, fractional = ""] = decimalText.split(".");
  if (fractional.length > precision) {
    throw new Error("NativeRpcAmountPrecisionLoss");
  }
  return BigInt(`${whole}${fractional.padEnd(precision, "0")}`);
}

function buildAuthorizationHeader(options) {
  if (options.authorizationHeader !== undefined) {
    throw new Error("NativeRpcRawAuthorizationHeaderRejected");
  }
  return readAuthorizationHeaderFromCookieFile(options.authCookieFile, options.repoRoot);
}

function extractResultDecimalText(raw, fieldName) {
  const resultOffset = raw.indexOf('"result"');
  if (resultOffset < 0) throw new Error("NativeRpcResultMissing");
  const fieldPattern = new RegExp(`"${fieldName}"\\s*:\\s*("(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?"|(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?)`, "u");
  const match = fieldPattern.exec(raw.slice(resultOffset));
  if (match === null) throw new Error("NativeRpcAmountMissing");
  return match[1].startsWith('"') ? match[1].slice(1, -1) : match[1];
}

function sourceReason(input) {
  if (input.expectedNetwork !== undefined && input.network !== input.expectedNetwork) {
    return "NATIVE_NETWORK_MISMATCH";
  }
  if (input.expectedGenesisHash !== undefined && input.genesisHash !== input.expectedGenesisHash) {
    return "NATIVE_GENESIS_MISMATCH";
  }
  if (input.inInitialBlockDownload) return "NATIVE_SOURCE_IBD";
  if (input.stale) return "NATIVE_SOURCE_STALE_HEADERS";
  if (!input.internallyConsistent) return "NATIVE_SOURCE_INCONSISTENT";
  return "NATIVE_SOURCE_RPC_OBSERVED";
}

function rpcError(kind, method, code = undefined) {
  return Object.assign(new Error(`${kind}:${method}${code === undefined ? "" : `:${code}`}`), {
    code: kind,
    method,
  });
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}:ExpectedObject`);
  }
  return value;
}

function checkedNetworkName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,32}$/iu.test(value)) {
    throw new Error(`${label}:InvalidNetworkName`);
  }
  return value;
}

function checkedPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}:ExpectedPositiveInteger`);
  return value;
}

function checkedNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}:ExpectedNonNegativeInteger`);
  return value;
}

function normalizeHash32(value, label) {
  const normalized = normalizeHexText(value, label);
  if (normalized.length !== 64) throw new Error(`${label}:Expected32ByteHex`);
  return normalized;
}

function normalizeHexText(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f][0-9a-f])*$/iu.test(value)) {
    throw new Error(`${label}:ExpectedHex`);
  }
  return value.toLowerCase();
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(normalized)
  );
}
