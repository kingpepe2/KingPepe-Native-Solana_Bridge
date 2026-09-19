// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Authenticated accounting journal. Mainnet requires an OS-protected key and
// separate network context. The journal is not signing authority or a chain proof.
import { createHmac, timingSafeEqual } from "node:crypto";
import { DEVNET_SOLANA_GENESIS } from "../../shared/solana-test-network.mjs";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, constants as sql } from "node:sqlite";
import { ExactDepositLedger } from "./automatic-deposit-pipeline.mjs";
import { decodeCanonicalBridgeMessage, DEPLOYMENT_IDENTITY_LENGTH, MESSAGE_LENGTH } from "../../shared/protocol/canonical-message.mjs";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { REGTEST_GENESIS, requireVerifiedNativeReserve } from "../../native/node/native-raw-evidence.mjs";
import { NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN, SOLANA_MAINNET_GENESIS, mainnetDeploymentIdentity } from "../../shared/network-identity.mjs";
import { base58 } from "@scure/base";
import { canonicalJson, nativeSigningIntentDigest } from "../../native/frost/policy/native-signing-policy.mjs";
import { createNativeFrostSigningRequest } from "../../native/frost/policy/signing-request.mjs";
import { initialCoordinatorSigningState, decodeCoordinatorSigningState } from "../../native/frost/coordinator/protected-signing-journal.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { initialServiceState, reduceServiceEvent, restoreDelivery, depositServiceStatus, MAX_SERVICE_EVENT_BYTES } from "./service-journal-state.mjs";
import { validateEconomicLimits, checkEconomicTransfer, economicLimitUsage } from "./economic-limits.mjs";

const toolchain = JSON.parse(readFileSync(new URL("../../scripts/local-e2e-toolchain.json", import.meta.url), "utf8"));
const MAGIC = Buffer.from("KPDECL02", "ascii");
const PROTECTED_MAINNET = Symbol("Protected Mainnet journal construction");
const MAX_EVENTS = 8192;
const CREDIT = 1;
const MINT = 2;
const STOP = 3;
const RESERVE = 4, MAX_OPERATION_BYTES = 6144;
const SERVICE = 7;
const CREDIT_LENGTH = MESSAGE_LENGTH + 32;
const TABLES = Object.freeze({
  meta: "CREATE TABLE meta (id INTEGER PRIMARY KEY CHECK (id = 1), context BLOB NOT NULL, head INTEGER NOT NULL, tag BLOB NOT NULL) STRICT",
  events: "CREATE TABLE events (seq INTEGER PRIMARY KEY, kind INTEGER NOT NULL, payload BLOB NOT NULL, previous BLOB NOT NULL, tag BLOB NOT NULL) STRICT",
});

export class AuthenticatedLocalDepositLedger {
  #db;
  #file;
  #repoRoot;
  #fileIdentity;
  #key;
  #context;
  #deployment;
  #environment;
  #nativeGenesis;
  #ledger = new ExactDepositLedger();
  #head = 0n;
  #tag;
  #stop;
  #closed = false;
  #credits = new Map();
  #reserves = new Map();
  #service = initialServiceState();
  #signingBusy = false;
  #statements = new Map();

  static createLocal(options) { return new AuthenticatedLocalDepositLedger(options, true); }
  static openLocal(options) { return new AuthenticatedLocalDepositLedger(options, false); }
  get environment() { return this.#environment; }
  static fromProtectedLocalKey(options, keyStore, create = false) {
    assertWindowsProtectedStore(keyStore, "BRIDGE_VALIDATOR", "bridge-journal-key");
    const c = keyStore.context, deployment = exactHex(options.deploymentHex, DEPLOYMENT_IDENTITY_LENGTH, "Deployment");
    if (Object.hasOwn(options, "authenticationKey") || !["localnet", "devnet"].includes(c.environment) || options.environment !== c.environment ||
        c.instanceId !== options.journalIdHex || c.nativeGenesis !== deployment.subarray(8, 40).toString("hex") ||
        c.solanaDeployment !== deployment.subarray(40, 72).toString("hex")) throw new Error("LocalLedgerProtectedKeyBindingRejected");
    // Only an existing OS-protected key is read. Never create a missing key,
    // fall back to a plaintext file, or persist key bytes with journal data.
    const secret = keyStore.read();
    try {
      if (secret.payload.length !== 32) throw new Error("LocalLedgerProtectedKeyRejected");
      return new AuthenticatedLocalDepositLedger({ ...options, authenticationKey: secret.payload }, create);
    } finally { secret.payload.fill(0); }
  }

  static fromProtectedMainnetKey(options, keyStore, create = false) {
    assertWindowsProtectedStore(keyStore, "BRIDGE_VALIDATOR", "bridge-journal-key");
    const c = keyStore.context, deployment = exactHex(options.deploymentHex, DEPLOYMENT_IDENTITY_LENGTH, "Deployment");
    if (Object.hasOwn(options, "authenticationKey") || options.environment !== "mainnet" || c.environment !== "mainnet" ||
        options.solanaGenesis !== SOLANA_MAINNET_GENESIS || c.nativeGenesis !== NATIVE_MAINNET_GENESIS ||
        c.instanceId !== options.journalIdHex || c.solanaDeployment !== deployment.subarray(40, 72).toString("hex"))
      throw new Error("MainnetLedgerProtectedKeyBindingRejected");
    const secret = keyStore.read();
    try {
      if (secret.payload.length !== 32) throw new Error("MainnetLedgerProtectedKeyRejected");
      const ledger = new AuthenticatedLocalDepositLedger({ ...options, authenticationKey: secret.payload }, create, PROTECTED_MAINNET);
      try {
        // A crash immediately after empty schema creation cannot expose an
        // unpaused zero-event production journal on its next open.
        if (create || ledger.checkpoint().sequence === "0") ledger.pause("MAINNET_PREPARATION");
        return ledger;
      }
      catch (error) { ledger.close(); throw error; }
    } finally { secret.payload.fill(0); }
  }

  constructor(options, create, capability) {
    if (typeof create !== "boolean") throw new Error("LocalLedgerExplicitCreateOrOpenRequired");
    const mainnet = capability === PROTECTED_MAINNET && options?.environment === "mainnet" && options.solanaGenesis === SOLANA_MAINNET_GENESIS;
    if (!(mainnet || options?.environment === "localnet" || (options?.environment === "devnet" && options.solanaGenesis === DEVNET_SOLANA_GENESIS)))
      throw new Error("LocalLedgerEnvironmentRejected");
    this.#environment = options.environment;
    this.#nativeGenesis = mainnet ? NATIVE_MAINNET_GENESIS : REGTEST_GENESIS;
    if (process.versions.node !== toolchain.node.version) throw new Error("LocalLedgerPinnedRuntimeRequired");
    this.#deployment = exactHex(options.deploymentHex, DEPLOYMENT_IDENTITY_LENGTH, "Deployment");
    if (this.#deployment.subarray(8, 40).toString("hex") !== this.#nativeGenesis)
      throw new Error(mainnet ? "MainnetLedgerNativeGenesisRequired" : "LocalLedgerRegtestRequired");
    if (mainnet && (this.#deployment.readUInt32LE(0) !== 1 || this.#deployment.readUInt32LE(4) !== NATIVE_MAINNET_DOMAIN ||
        mainnetDeploymentIdentity({ manager: base58.encode(this.#deployment.subarray(72, 104)),
          transceiver: base58.encode(this.#deployment.subarray(104, 136)), mint: base58.encode(this.#deployment.subarray(136, 168)) }) !==
          this.#deployment.subarray(40, 72).toString("hex"))) throw new Error("MainnetLedgerDeploymentRequired");
    const id = exactHex(options.journalIdHex, 32, "Identity");
    if (id.every(byte => byte === 0)) throw new Error("LocalLedgerIdentityRejected");
    const maxPages = options.maxPages ?? 16384; // Local resource bound, not a production transfer limit.
    if (!Number.isSafeInteger(maxPages) || maxPages < 8 || maxPages > 16384) throw new Error("LocalLedgerPageLimitRejected");
    if (!(options.authenticationKey instanceof Uint8Array) || options.authenticationKey.length !== 32) throw new Error("LocalLedgerAuthenticationKeyRequired");
    this.#key = Buffer.from(options.authenticationKey);
    // One-way format and explicit network context reject historical journals,
    // including when a caller copies a key, ID or deployment identity.
    this.#context = Buffer.concat([MAGIC, Buffer.from([mainnet ? 3 : this.#environment === "devnet" ? 2 : 1]), id, this.#deployment]);
    this.#tag = this.#authenticate(0n, 0, Buffer.alloc(0), Buffer.alloc(32));
    this.#repoRoot = options.repoRoot;
    try {
      const root = validateRuntimeStateRoot(options.root, this.#repoRoot, "Local deposit ledger root");
      if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
      this.#file = validateRuntimeFile(path.join(root, "deposit-ledger.sqlite"), this.#repoRoot);
      this.#assertAuxiliaryPaths();
      if (create) {
        const fd = openSync(this.#file, "wx", 0o600);
        try { fsyncSync(fd); } finally { closeSync(fd); }
      } else if (!lstatSync(this.#file).isFile()) {
        throw new Error("LocalLedgerExistingDatabaseRequired");
      }
      this.#fileIdentity = lstatSync(this.#file, { bigint: true });
      if (this.#fileIdentity.size > 64n * 1024n * 1024n) throw new Error("LocalLedgerFileLimit");
      this.#db = new DatabaseSync(this.#file, {
        defensive: true, allowExtension: false, enableDoubleQuotedStringLiterals: false,
        enableForeignKeyConstraints: true, readBigInts: true, timeout: 250,
        // A public sweep plan includes every exact per-input signing intent.
        // Keep the original smaller bounds for existing economic event types.
        limits: { length: MAX_SERVICE_EVENT_BYTES + 8192, sqlLength: 4096, column: 8, exprDepth: 32, compoundSelect: 3,
          vdbeOp: 25000, functionArg: 8, attach: 0, likePatternLength: 128, variableNumber: 8, triggerDepth: 0 },
      });
      // These fixed statements run before any application/schema query. No
      // caller SQL, extension, custom function or virtual table is registered.
      this.#db.exec("PRAGMA trusted_schema=OFF; PRAGMA cell_size_check=ON; PRAGMA mmap_size=0; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=EXTRA");
      if (this.#query("PRAGMA journal_mode=DELETE")[0].journal_mode !== "delete" ||
          this.#query("PRAGMA synchronous")[0].synchronous !== 3n ||
          this.#query("PRAGMA locking_mode")[0].locking_mode !== "exclusive" ||
          this.#query("PRAGMA mmap_size")[0].mmap_size !== 0n ||
          this.#query("PRAGMA cell_size_check")[0].cell_size_check !== 1n ||
          this.#query("PRAGMA trusted_schema")[0].trusted_schema !== 0n ||
          this.#query("SELECT sqlite_version() AS version")[0].version !== toolchain.node.sqliteVersion) {
        throw new Error("LocalLedgerSqlitePolicyRejected");
      }
      if (this.#query(`PRAGMA max_page_count=${maxPages}`)[0].max_page_count !== BigInt(maxPages)) {
        throw new Error("LocalLedgerPageLimitRejected");
      } // Bounded integer above, not user SQL.
      this.#db.exec("BEGIN EXCLUSIVE");
      if (create) {
        this.#db.exec(TABLES.meta);
        this.#db.exec(TABLES.events);
        this.#run("INSERT INTO meta VALUES (1, ?, ?, ?)", this.#context, 0n, this.#tag);
      }
      const schema = this.#query("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name");
      if (schema.length !== 2 || schema.some(row => row.type !== "table" || row.tbl_name !== row.name || row.sql !== TABLES[row.name])) {
        throw new Error("LocalLedgerSchemaRejected");
      }
      if (this.#query("PRAGMA quick_check(1)")[0].quick_check !== "ok") throw new Error("LocalLedgerIntegrityRejected");
      this.#replay(options.minimumCheckpoint);
      // A retained exclusive SQLite lease fences cooperating local processes.
      // It is not proof against a hidden clone, hostile mount or privileged write.
      this.#db.exec("COMMIT");
      this.#db.setAuthorizer((action, arg1, arg2, database, source) => {
        if (source !== null) return sql.SQLITE_DENY;
        if (action === sql.SQLITE_SELECT || action === sql.SQLITE_TRANSACTION) return sql.SQLITE_OK;
        if (database !== "main") return sql.SQLITE_DENY;
        if (action === sql.SQLITE_READ && ["meta", "events"].includes(arg1)) return sql.SQLITE_OK;
        if (action === sql.SQLITE_INSERT && arg1 === "events") return sql.SQLITE_OK;
        if (action === sql.SQLITE_UPDATE && arg1 === "meta" && ["head", "tag"].includes(arg2)) return sql.SQLITE_OK;
        return sql.SQLITE_DENY;
      });
    } catch (error) {
      this.close();
      throw safeError(error);
    }
  }

  recordValidatedDeposit(input) { this.#record(CREDIT, creditPayload(input)); }
  watchServiceDeposit(request, policy) { this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "WATCH", request, policy }))); }
  serviceDepositRequests({ limit = 100 } = {}) {
    this.#assertHead(); if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("LocalLedgerPageRejected");
    return structuredClone([...this.#service.watches.values()].filter(r => !this.#service.deposits.has(r.operationId)).slice(0, limit));
  }
  registerServiceDeposit(plan, policy) { this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "REGISTER", plan, policy }))); }
  updateServiceDeposit(operationId, action, value) {
    this.#record(SERVICE, Buffer.from(JSON.stringify({ action, operationId, value })));
  }
  serviceDeposit(id) { this.#assertHead(); return structuredClone(this.#service.deposits.get(id)); }
  serviceDeposits({ limit = 100, pendingOnly = false, registeredOnly = false } = {}) {
    this.#assertHead();
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof pendingOnly !== "boolean" || typeof registeredOnly !== "boolean") throw new Error("LocalLedgerPageRejected");
    const pending = registeredOnly ? [] : this.serviceDepositRequests().map(r => ({ operationId: r.operationId, state: "OBSERVED", amountAtomic: r.depositIntent.amountAtomic }));
    return [...pending, ...[...this.#service.deposits].map(([operationId, r]) => ({ operationId, state: depositServiceStatus(r),
      amountAtomic: r.operation.plan.depositIntent.amountAtomic }))].filter(r => !pendingOnly || r.state !== "COMPLETED").slice(0, limit);
  }
  servicePolicy() { this.#assertHead(); return structuredClone(this.#service.policy); }
  configureEconomicLimits(policy, timestampMs = Date.now()) {
    this.#assertHead(); validateEconomicLimits(policy);
    if ((policy.scope === "MAINNET") !== (this.#environment === "mainnet")) throw new Error("EconomicLimitEnvironmentMismatch");
    // Upgrade an existing TEST journal only at a quiescent boundary. Historical
    // completed actions are retained; no existing pending authorization is reset.
    if (this.#service.limits === null && this.serviceDeposits({ pendingOnly: true }).length)
      throw new Error("EconomicLimitsRequireQuiescentInstallation");
    this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "LIMIT_CONFIG", policy, timestampMs })));
  }
  assertEconomicLimitsReady() {
    this.#assertHead();
    // Retained isolated localnet fixtures may omit this new TEST policy. Every
    // Devnet worker requires an explicit journal-bound policy before startup.
    if (this.#environment !== "localnet" && this.#service.limits === null) throw new Error("EconomicLimitsRequired");
  }
  economicLimitsStatus(timestampMs = Date.now()) {
    this.#assertHead(); const state = this.#service.limits;
    return state === null ? null : { policy: structuredClone(state.policy), ...economicLimitUsage(state, timestampMs),
      pending: [...state.records.values()].filter(r => r.settledAtMs === null).length, breach: state.breach ? state.breach.direction + "_WINDOW_LIMIT" : null };
  }
  authorizeEconomicOperation(direction, operationId, timestampMs = Date.now()) {
    this.assertEconomicLimitsReady();
    if (this.#service.limits === null) return;
    if (this.status().state !== "OPEN_LOCAL_ACCOUNTING_ONLY") throw new Error("EconomicLimitBridgePaused");
    const { amountAtomic } = this.#economicOperation(direction, operationId);
    checkEconomicTransfer(this.#service.limits.policy, direction, amountAtomic);
    this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "LIMIT_RESERVE", direction, operationId, amountAtomic, timestampMs })));
    if (this.#service.paused) throw new Error("EconomicWindowLimitExceeded");
  }
  settleEconomicOperation(direction, operationId, timestampMs = Date.now()) {
    this.assertEconomicLimitsReady();
    if (this.#service.limits === null) return;
    const { amountAtomic, settled } = this.#economicOperation(direction, operationId);
    if (!settled) throw new Error("EconomicLimitSettlementUnverified");
    this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "LIMIT_SETTLE", direction, operationId, amountAtomic, timestampMs })));
  }
  #economicOperation(direction, operationId) {
    if (direction !== "MINT") throw new Error("EconomicLimitDirectionRejected");
    const record = this.#service.deposits.get(operationId);
    if (!record) throw new Error("EconomicLimitOperationMissing");
    return { amountAtomic: record.operation.plan.depositIntent.amountAtomic, settled: record.operation.mintReceipt !== null };
  }
  serviceAccountingPending() {
    this.#assertHead();
    for (const { operation } of this.#service.deposits.values()) if (operation.finalizedCredit) {
      const id = decodeCanonicalBridgeMessage(operation.finalizedCredit.encodedMessageHex).operationIdHex;
      const credit = this.#credits.get(id);
      if (!credit || !this.hasCanonicalDepositReserve(id) || operation.mintReceipt && !credit.minted) return true;
    }
    return false;
  }
  nativeSigningJournal(key) {
    key = structuredClone(key); decodeCoordinatorSigningState(initialCoordinatorSigningState(key), key);
    const lookup = intent => {
      this.#assertHead();
      const state = decodeCoordinatorSigningState(Buffer.from(JSON.stringify(this.#service.signing ?? JSON.parse(initialCoordinatorSigningState(key)))), key);
      const r = state.records.find(v => v.request.requestId === intent.signingRequestId);
      if (r && r.request.intentDigest !== nativeSigningIntentDigest(intent)) throw new Error("LocalLedgerSigningIntentChanged");
      return structuredClone(r ?? null);
    };
    const append = record => {
      if (!this.#signingBusy || this.status().state !== "OPEN_LOCAL_ACCOUNTING_ONLY") throw new Error("LocalLedgerSigningPaused");
      this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "SIGNING", key, record })));
    };
    return Object.freeze({ lookup, retainedResult: intent => {
      const r = lookup(intent); if (r?.state !== "SIGNED") throw new Error("LocalLedgerSignatureUnavailable"); return r.result;
    }, prepare: intent => {
      const old = lookup(intent);
      if (old && old.state !== "ABORTED") throw new Error("LocalLedgerSigningRecoveryRequired");
      const request = createNativeFrostSigningRequest(intent, { attempt: old ? old.request.attempt + 1 : 1 });
      append({ request, state: "PREPARED", abortReceipts: null, result: null }); return request;
    }, markAborted: (request, abortReceipts) => append({ request, state: "ABORTED", abortReceipts, result: null }),
    markSigned: (request, result) => append({ request, state: "SIGNED", abortReceipts: null, result }),
    runExclusive: async action => {
      if (this.#signingBusy) throw new Error("LocalLedgerSigningBusy"); this.#signingBusy = true;
      try { return await action(); } finally { this.#signingBusy = false; }
    } });
  }
  depositCredit(id) { this.#assertHead(); return structuredClone(this.#credits.get(id)); }
  pause(reason = "KINGPEPE_TEAM_REVIEW") { this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "PAUSE", reason }))); }
  // Deliberate administrative call, never invoked by the polling/retry loop.
  // Integrity HARD_STOP remains sticky and cannot be cleared by this method.
  resumeAfterReview(timestampMs = Date.now()) {
    this.#assertHead();
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const { operation } of this.#service.deposits.values()) if (operation.finalizedCredit && !operation.mintReceipt &&
      decodeCanonicalBridgeMessage(operation.finalizedCredit.encodedMessageHex).validUntil < now) throw new Error("LocalLedgerExpiredCreditPending");
    if (this.#service.limits) this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "LIMIT_REVIEW", timestampMs })));
    this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "RESUME", reason: "KINGPEPE_TEAM_REVIEWED" })));
  }
  solanaServiceJournal(stage) {
    if (!["RECEIPT", "CLAIM"].includes(stage)) throw new Error("LocalLedgerServiceStageRejected");
    const get = id => { this.#assertHead(); return restoreDelivery(this.#service.deliveries.get(stage + ":" + id)); };
    const append = (method, args) => {
      const id = method === "persistPrepared" ? args[0]?.operationIdHex : args[0];
      this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "DELIVERY", stage, method, args, operationId: id })));
      return get(id).get(id)?.prepared;
    };
    return Object.freeze({ get: id => get(id).get(id), completed: id => get(id).completed(id),
      replaceExpired: (prepared, expiry) => this.#record(SERVICE, Buffer.from(JSON.stringify({ action: "DELIVERY_REBUILD", stage, prepared, expiry }))),
      persistPrepared: (...args) => append("persistPrepared", args), recordSubmitted: (...args) => append("recordSubmitted", args),
      recordCompleted: (...args) => append("recordCompleted", args), recordTerminal: (...args) => append("recordTerminal", args) });
  }


  recordCanonicalReserve(receipt, depositOperationId) {
    requireVerifiedNativeReserve(receipt, this.#nativeGenesis);
    const b = receipt.reserveBasis;
    this.#record(RESERVE, Buffer.from(JSON.stringify({ depositOperationId, txid: b.sweep.txid, vout: b.sweep.vout,
      amountAtomic: b.amountAtomic, scriptPubKeyHex: b.reserveScriptHex, depositOutpoint: `${b.deposit.txid}:${b.deposit.vout}`, basis: b })));
  }
  hasCanonicalDepositReserve(id) { this.#assertHead(); return [...this.#reserves.values()].some(r => r.depositOperationId === id); }










  accountedReserveInputs() {
    this.#assertHead();
    return [...this.#reserves.values()].map(i => ({ txid: i.txid, vout: i.vout, amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex }));
  }
  acceptedNativeBases() {
    this.#assertHead();
    return structuredClone([...this.#reserves.values()].map(r => ({ operationId: r.depositOperationId, amountAtomic: r.amountAtomic,
      chainworkHex: r.basis.chainworkHex, blocks: [r.basis.deposit, r.basis.sweep].map(({ height, blockHash }) => ({ height, blockHash })) })));
  }
  bridgeSnapshot() {
    this.#assertHead(); const d = this.#ledger.snapshot();
    return Object.freeze({ canonicalReserveAtomic: d.canonicalReserve,
      bridgeIssuedAtomic: d.mintedSupply, pendingMintAtomic: d.authorizedUnmintedCredits });
  }
  completedForwardAtomic() {
    this.#assertHead();
    // Aggregate the complete authenticated ledger, never a paginated status page.
    let total = 0n;
    for (const record of this.#service.deposits.values()) if (record.completed !== null && record.operation.mintReceipt !== null)
      total += BigInt(record.operation.plan.depositIntent.amountAtomic);
    return total.toString();
  }
  recordMint(input) {
    const credit = creditPayload(input);
    const value = input.mintedAmountAtomic;
    if ((typeof value !== "bigint" && typeof value !== "string") || !/^[1-9][0-9]{0,19}$/u.test(String(value))) throw new Error("LocalLedgerMintAmountRejected");
    const amount = BigInt(value);
    if (amount > 0xffff_ffff_ffff_ffffn) throw new Error("LocalLedgerMintAmountRejected");
    const encodedAmount = Buffer.alloc(8);
    encodedAmount.writeBigUInt64LE(amount);
    this.#record(MINT, Buffer.concat([credit, encodedAmount]));
  }
  hardStop(code) {
    if (typeof code !== "string" || !/^[A-Z_]{1,64}$/u.test(code)) throw new Error("LocalLedgerStopCodeRejected");
    this.#record(STOP, Buffer.from(code, "ascii"));
  }
  snapshot() { this.#assertHead(); return this.#ledger.snapshot(); }
  checkpoint() { this.#assertHead(); return Object.freeze({ sequence: this.#head.toString(), tagHex: this.#tag.toString("hex") }); }
  status() { this.#assertHead(); return Object.freeze({ state: this.#stop ? "HARD_STOP" : this.#service.paused ? "PAUSED" : "OPEN_LOCAL_ACCOUNTING_ONLY", reason: this.#stop ?? this.#service.paused ?? undefined }); }
  pendingCredits({ offset = 0, limit = 100 } = {}) {
    this.#assertHead();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_EVENTS || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("LocalLedgerPageRejected");
    return Object.freeze([...this.#credits.values()].filter(credit => !credit.minted).slice(offset, offset + limit).map(credit => Object.freeze({ ...credit })));
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    try { this.#db?.close(); } finally { this.#statements.clear(); this.#key?.fill(0); }
  }

  #record(kind, payload) {
    this.#assertHead();
    if (this.#stop !== undefined) {
      if (kind === STOP && payload.toString("ascii") === this.#stop) return;
      throw new Error("LocalLedgerHardStop");
    }
    const next = this.#ledger.fork();
    const auxiliary = kind >= RESERVE ? this.#applyOperation(kind, payload) : undefined;
    const credit = auxiliary ? undefined : this.#apply(next, kind, payload);
    if (auxiliary?.unchanged || (!auxiliary && kind !== STOP && JSON.stringify(next.snapshot()) === JSON.stringify(this.#ledger.snapshot()))) return;
    if (this.#head >= BigInt(MAX_EVENTS)) throw new Error("LocalLedgerEventLimit");
    const sequence = this.#head + 1n;
    const tag = this.#authenticate(sequence, kind, payload, this.#tag);
    try {
      this.#db.exec("BEGIN EXCLUSIVE");
      this.#run("INSERT INTO events VALUES (?, ?, ?, ?, ?)", sequence, kind, payload, this.#tag, tag);
      this.#run("UPDATE meta SET head = ?, tag = ? WHERE id = 1", sequence, tag);
      this.#db.exec("COMMIT");
    } catch (error) {
      // Outcome must be reloaded and reconciled before any caller continues.
      this.close();
      throw safeError(error);
    }
    this.#ledger = next;
    this.#head = sequence;
    this.#tag = tag;
    if (kind === STOP) this.#stop = payload.toString("ascii");
    else if (auxiliary) { this.#reserves = auxiliary.reserves;
      if (auxiliary.service) this.#service = auxiliary.service; }
    else this.#credits.set(credit.operationIdHex, credit);
  }

  #apply(ledger, kind, payload) {
    if (kind === STOP) {
      if (!/^[A-Z_]{1,64}$/u.test(payload.toString("ascii")) || payload.some(byte => byte > 127)) throw new Error("LocalLedgerEventRejected");
      return;
    }
    if ((kind !== CREDIT && kind !== MINT) || payload.length !== CREDIT_LENGTH + (kind === MINT ? 8 : 0)) throw new Error("LocalLedgerEventRejected");
    const messageBytes = payload.subarray(0, MESSAGE_LENGTH);
    if (!messageBytes.subarray(12, 12 + DEPLOYMENT_IDENTITY_LENGTH).equals(this.#deployment)) throw new Error("LocalLedgerDeploymentMismatch");
    const input = { encodedMessageHex: messageBytes.toString("hex"), reserveAllocationIdHex: payload.subarray(MESSAGE_LENGTH, CREDIT_LENGTH).toString("hex") };
    if (kind === CREDIT) ledger.recordValidatedDeposit(input);
    else ledger.recordMint({ ...input, mintedAmountAtomic: payload.readBigUInt64LE(CREDIT_LENGTH) });
    const message = decodeCanonicalBridgeMessage(messageBytes);
    return Object.freeze({ ...input, operationIdHex: message.operationIdHex, amountAtomic: message.amountAtomic.toString(), minted: kind === MINT });
  }

  #applyOperation(kind, payload) {
    if (payload.length > (kind === SERVICE ? MAX_SERVICE_EVENT_BYTES : MAX_OPERATION_BYTES)) throw new Error("LocalLedgerOperationSizeRejected");
    const text = payload.toString("utf8"), value = JSON.parse(text);
    if (JSON.stringify(value) !== text) throw new Error("LocalLedgerOperationEncodingRejected");
    const reserves = new Map(this.#reserves);
    const check = v => { if (!v) throw new Error("LocalLedgerOperationTransitionRejected"); };
    if (kind === SERVICE) {
      if (value.action === "LIMIT_CONFIG" && this.#service.limits === null) {
        check(![...this.#service.deposits.values()].some(r => r.completed === null) &&
          ![...this.#service.watches.keys()].some(id => !this.#service.deposits.has(id)) &&
          this.#ledger.snapshot().authorizedUnmintedCredits === "0");
      }
      if (value.action === "LIMIT_RESERVE" || value.action === "LIMIT_SETTLE") {
        const identity = this.#economicOperation(value.direction, value.operationId);
        check(identity.amountAtomic === value.amountAtomic && (value.action !== "LIMIT_SETTLE" || identity.settled));
      }
      if (value.action === "REGISTER") {
        // Backing must never be consumed as another deposit's miner-fee input.
        const bridgeTransactions = new Set();
        for (const r of this.#service.deposits.values()) bridgeTransactions.add(parseNativeTransactionHex(r.operation.plan.unsignedTransactionHex).txidHex);
        for (const i of value.plan.inputs) check(!reserves.has(`${i.txid}:${i.vout}`) && !bridgeTransactions.has(i.txid));
      }
      const projection = reduceServiceEvent(this.#service, value, this.#deployment);
      return { reserves, service: projection.state, unchanged: projection.unchanged };
    } else if (kind === RESERVE) {
      check(Object.keys(value).sort().join() === "amountAtomic,basis,depositOperationId,depositOutpoint,scriptPubKeyHex,txid,vout");
      const credit = this.#credits.get(value.depositOperationId);
      check(credit && value.amountAtomic === credit.amountAtomic && /^[0-9a-f]{64}$/u.test(value.txid) && value.vout === 0 && /^5120[0-9a-f]{64}$/u.test(value.scriptPubKeyHex));
      check(decodeCanonicalBridgeMessage(Buffer.from(credit.encodedMessageHex, "hex")).depositOutpointText === value.depositOutpoint);
      const b = value.basis;
      check(b && b.genesis === this.#nativeGenesis && /^[0-9a-f]{64}$/u.test(b.chainworkHex) && BigInt("0x" + b.chainworkHex) > 0n &&
        b.amountAtomic === value.amountAtomic && b.reserveScriptHex === value.scriptPubKeyHex && b.sweep.txid === value.txid && b.sweep.vout === value.vout &&
        `${b.deposit.txid}:${b.deposit.vout}` === value.depositOutpoint);
      for (const block of [b.deposit, b.sweep]) check(Number.isSafeInteger(block.height) && block.height > 0 &&
        block.height <= (this.#environment === "mainnet" ? 1_000_000 : 4096) && /^[0-9a-f]{64}$/u.test(block.blockHash));
      const key = `${value.txid}:${value.vout}`, prior = reserves.get(key);
      if (prior) { check(canonicalJson(prior) === canonicalJson(value)); return { unchanged: true }; }
      check(![...reserves.values()].some(i => i.depositOperationId === value.depositOperationId)); reserves.set(key, value);
    } else throw new Error("LocalLedgerEventRejected");
    return { reserves };
  }

  #replay(minimum) {
    const rows = this.#query("SELECT seq, kind, payload, previous, tag FROM events ORDER BY seq LIMIT 8193");
    if (rows.length > MAX_EVENTS) throw new Error("LocalLedgerEventLimit");
    let minimumMatched = minimum === undefined;
    let minimumSequence;
    let minimumTag;
    if (minimum !== undefined) {
      if (typeof minimum.sequence !== "string" || !/^(0|[1-9][0-9]{0,4})$/u.test(minimum.sequence)) throw new Error("LocalLedgerCheckpointRejected");
      minimumSequence = BigInt(minimum.sequence);
      minimumTag = exactHex(minimum.tagHex, 32, "Checkpoint");
      minimumMatched = minimumSequence === 0n && timingSafeEqual(minimumTag, this.#tag);
    }
    for (const row of rows) {
      if (this.#stop !== undefined || row.seq !== this.#head + 1n || ![1n, 2n, 3n, 4n, 7n].includes(row.kind) ||
          !(row.payload instanceof Uint8Array) || row.payload.length > (row.kind === 7n ? MAX_SERVICE_EVENT_BYTES : row.kind < 4n ? CREDIT_LENGTH + 8 : MAX_OPERATION_BYTES)) throw new Error("LocalLedgerSequenceRejected");
      if (!equalTag(row.previous, this.#tag)) throw new Error("LocalLedgerAuthenticationFailed");
      const payload = Buffer.from(row.payload);
      const kind = Number(row.kind); // Bounded enum values, never an amount.
      const tag = this.#authenticate(row.seq, kind, payload, this.#tag);
      if (!equalTag(row.tag, tag)) throw new Error("LocalLedgerAuthenticationFailed");
      const before = JSON.stringify(this.#ledger.snapshot());
      const auxiliary = kind >= RESERVE ? this.#applyOperation(kind, payload) : undefined;
      const credit = auxiliary ? undefined : this.#apply(this.#ledger, kind, payload);
      if (auxiliary?.unchanged || (!auxiliary && kind !== STOP && JSON.stringify(this.#ledger.snapshot()) === before)) throw new Error("LocalLedgerDuplicateEventRejected");
      this.#head = row.seq;
      this.#tag = tag;
      if (kind === STOP) this.#stop = payload.toString("ascii");
      else if (auxiliary) { this.#reserves = auxiliary.reserves;
        if (auxiliary.service) this.#service = auxiliary.service; }
      else this.#credits.set(credit.operationIdHex, credit);
      if (minimumSequence === this.#head && timingSafeEqual(minimumTag, tag)) minimumMatched = true;
    }
    this.#assertStoredHead();
    if (!minimumMatched) throw new Error("LocalLedgerRollbackCheckpointRejected");
  }

  #assertHead() {
    if (this.#closed) throw new Error("LocalLedgerClosed");
    try {
      validateRuntimeFile(this.#file, this.#repoRoot);
      this.#assertAuxiliaryPaths();
      // stat only: opening/closing another descriptor to the active DB could
      // release POSIX record locks held by SQLite in this process.
      const identity = lstatSync(this.#file, { bigint: true });
      if (identity.ino !== this.#fileIdentity.ino || identity.dev !== this.#fileIdentity.dev || identity.size > 64n * 1024n * 1024n) throw new Error("LocalLedgerFileChanged");
      this.#assertStoredHead();
    } catch (error) { this.close(); throw safeError(error); }
  }
  #assertStoredHead() {
    const rows = this.#query("SELECT id, context, head, tag FROM meta");
    if (rows.length !== 1 || rows[0].id !== 1n || rows[0].head !== this.#head ||
        !(rows[0].context instanceof Uint8Array) || !Buffer.from(rows[0].context).equals(this.#context) ||
        !equalTag(rows[0].tag, this.#tag)) throw new Error("LocalLedgerHeadAuthenticationFailed");
  }
  #assertAuxiliaryPaths() {
    // SQLite may inspect/recover these files before application replay. They
    // must not point into source or to another file through a link either.
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      const file = validateRuntimeFile(this.#file + suffix, this.#repoRoot);
      try {
        if (lstatSync(file, { bigint: true }).size > 128n * 1024n * 1024n) throw new Error("LocalLedgerAuxiliaryFileLimit");
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  #authenticate(sequence, kind, payload, previous) {
    const header = Buffer.alloc(13);
    header.writeBigUInt64LE(sequence);
    header[8] = kind;
    header.writeUInt32LE(payload.length, 9);
    return createHmac("sha256", this.#key).update(this.#context).update(header).update(previous).update(payload).digest();
  }
  #query(statement, ...parameters) {
    return this.#statement(statement).all(...parameters);
  }
  #run(statement, ...parameters) {
    return this.#statement(statement).run(...parameters);
  }
  #statement(statement) {
    // The tested pinned binaries finalize statements on database.close(), not
    // StatementSync.close(). Retain only this bounded set of private fixed SQL.
    if (!this.#statements.has(statement)) {
      if (this.#statements.size >= 16) throw new Error("LocalLedgerStatementLimit");
      this.#statements.set(statement, this.#db.prepare(statement));
    }
    return this.#statements.get(statement);
  }
}

function exactHex(value, length, field) {
  if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]+$/u.test(value)) throw new Error(`LocalLedger${field}Rejected`);
  return Buffer.from(value, "hex");
}
function creditPayload(input) {
  return Buffer.concat([exactHex(input?.encodedMessageHex, MESSAGE_LENGTH, "Message"), exactHex(input?.reserveAllocationIdHex, 32, "Allocation")]);
}
function equalTag(value, tag) { return value instanceof Uint8Array && value.length === 32 && timingSafeEqual(value, tag); }
function safeError(error) {
  if (/^(?:LocalLedger|Ledger)[A-Za-z]+$/u.test(error?.message ?? "")) return new Error(error.message);
  if (error?.errcode === 13) return new Error("LocalLedgerDiskFull");
  if (error?.errcode === 5 || error?.errcode === 6) return new Error("LocalLedgerLeaseUnavailable");
  if (error?.code === "EEXIST") return new Error("LocalLedgerAlreadyExists");
  if (error?.code === "ENOENT") return new Error("LocalLedgerExistingDatabaseRequired");
  return new Error("LocalLedgerStorageRejected");
}
