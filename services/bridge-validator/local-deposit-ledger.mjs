// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Local-only authenticated accounting journal. It is NOT signing authority,
// a chain proof, protected production storage or a rollback-proof nonce store.
import { createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, constants as sql } from "node:sqlite";
import { ExactDepositLedger } from "./automatic-deposit-pipeline.mjs";
import { decodeCanonicalBridgeMessage, DEPLOYMENT_IDENTITY_LENGTH, MESSAGE_LENGTH } from "../../shared/protocol/canonical-message.mjs";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";

const toolchain = JSON.parse(readFileSync(new URL("../../scripts/local-e2e-toolchain.json", import.meta.url), "utf8"));
const MAGIC = Buffer.from("KPDECL01", "ascii");
const MAX_EVENTS = 8192;
const CREDIT = 1;
const MINT = 2;
const STOP = 3;
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
  #ledger = new ExactDepositLedger();
  #head = 0n;
  #tag;
  #stop;
  #closed = false;
  #credits = new Map();
  #statements = new Map();

  static createLocal(options) { return new AuthenticatedLocalDepositLedger(options, true); }
  static openLocal(options) { return new AuthenticatedLocalDepositLedger(options, false); }

  constructor(options, create) {
    if (typeof create !== "boolean") throw new Error("LocalLedgerExplicitCreateOrOpenRequired");
    if (options?.environment !== "localnet") throw new Error("LocalLedgerEnvironmentRejected");
    if (process.versions.node !== toolchain.node.version) throw new Error("LocalLedgerPinnedRuntimeRequired");
    this.#deployment = exactHex(options.deploymentHex, DEPLOYMENT_IDENTITY_LENGTH, "Deployment");
    if (this.#deployment.subarray(8, 40).toString("hex") !== REGTEST_GENESIS) throw new Error("LocalLedgerRegtestRequired");
    const id = exactHex(options.journalIdHex, 32, "Identity");
    if (id.every(byte => byte === 0)) throw new Error("LocalLedgerIdentityRejected");
    const maxPages = options.maxPages ?? 16384; // Local resource bound, not a production transfer limit.
    if (!Number.isSafeInteger(maxPages) || maxPages < 8 || maxPages > 16384) throw new Error("LocalLedgerPageLimitRejected");
    if (!(options.authenticationKey instanceof Uint8Array) || options.authenticationKey.length !== 32) throw new Error("LocalLedgerAuthenticationKeyRequired");
    this.#key = Buffer.from(options.authenticationKey);
    this.#context = Buffer.concat([MAGIC, Buffer.from([1]), id, this.#deployment]);
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
        limits: { length: 8192, sqlLength: 4096, column: 8, exprDepth: 32, compoundSelect: 3,
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
  status() { this.#assertHead(); return Object.freeze({ state: this.#stop ? "HARD_STOP" : "OPEN_LOCAL_ACCOUNTING_ONLY", reason: this.#stop }); }
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
    const credit = this.#apply(next, kind, payload);
    if (kind !== STOP && JSON.stringify(next.snapshot()) === JSON.stringify(this.#ledger.snapshot())) return;
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
      if (this.#stop !== undefined || row.seq !== this.#head + 1n || row.kind < 1n || row.kind > 3n ||
          !(row.payload instanceof Uint8Array) || row.payload.length > CREDIT_LENGTH + 8) throw new Error("LocalLedgerSequenceRejected");
      if (!equalTag(row.previous, this.#tag)) throw new Error("LocalLedgerAuthenticationFailed");
      const payload = Buffer.from(row.payload);
      const kind = Number(row.kind); // Three bounded enum values, never an amount.
      const tag = this.#authenticate(row.seq, kind, payload, this.#tag);
      if (!equalTag(row.tag, tag)) throw new Error("LocalLedgerAuthenticationFailed");
      const before = JSON.stringify(this.#ledger.snapshot());
      const credit = this.#apply(this.#ledger, kind, payload);
      if (kind !== STOP && JSON.stringify(this.#ledger.snapshot()) === before) throw new Error("LocalLedgerDuplicateEventRejected");
      this.#head = row.seq;
      this.#tag = tag;
      if (kind === STOP) this.#stop = payload.toString("ascii");
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
