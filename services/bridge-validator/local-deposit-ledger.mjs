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
import { REGTEST_GENESIS, requireVerifiedRegtestReserve, requireVerifiedRegtestPayout } from "../../native/node/native-raw-evidence.mjs";
import { requireFinalizedWithdrawal } from "../solana-observer/finalized-withdrawal.mjs";
import { validateWithdrawalPlan, validateSignedWithdrawal } from "../../native/reserve/withdrawal-plan.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";

const toolchain = JSON.parse(readFileSync(new URL("../../scripts/local-e2e-toolchain.json", import.meta.url), "utf8"));
const MAGIC = Buffer.from("KPDECL01", "ascii");
const MAX_EVENTS = 8192;
const CREDIT = 1;
const MINT = 2;
const STOP = 3;
const RESERVE = 4, WITHDRAWAL = 5, REQUEST = 6, MAX_OPERATION_BYTES = 6144;
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
  #reserves = new Map();
  #withdrawals = new Map();
  #requests = new Map();
  #statements = new Map();

  static createLocal(options) { return new AuthenticatedLocalDepositLedger(options, true); }
  static openLocal(options) { return new AuthenticatedLocalDepositLedger(options, false); }
  static fromProtectedLocalKey(options, keyStore, create = false) {
    assertWindowsProtectedStore(keyStore, "BRIDGE_VALIDATOR", "bridge-journal-key");
    const c = keyStore.context, deployment = exactHex(options.deploymentHex, DEPLOYMENT_IDENTITY_LENGTH, "Deployment");
    if (Object.hasOwn(options, "authenticationKey") || c.environment !== "localnet" || options.environment !== "localnet" ||
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
  enqueueConfirmedWithdrawal(observation) {
    requireFinalizedWithdrawal(observation);
    this.#record(REQUEST, Buffer.from(JSON.stringify({ signature: observation.signature, encodedMessageHex: observation.encodedMessageHex })));
  }
  withdrawalRequests({ offset = 0, limit = 100, pendingOnly = false } = {}) {
    this.#assertHead();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_EVENTS || !Number.isInteger(limit) || limit < 1 || limit > 100 || typeof pendingOnly !== "boolean") throw new Error("LocalLedgerPageRejected");
    const requests = new Map(this.#requests);
    for (const [id, r] of this.#withdrawals) if (!requests.has(id)) requests.set(id, { signature: r.plan.solanaSignature, encodedMessageHex: r.plan.encodedMessageHex });
    return [...requests].map(([operationId, r]) => {
      const m = decodeCanonicalBridgeMessage(Buffer.from(r.encodedMessageHex, "hex"));
      return { operationId, signature: r.signature, state: this.#withdrawals.get(operationId)?.state ?? "FINALIZED_ON_SOLANA",
        amountAtomic: m.amountAtomic.toString(), feeAtomic: m.feeAtomic.toString() };
    }).filter(r => !pendingOnly || r.state !== "COMPLETED").slice(offset, offset + limit);
  }
  recordCanonicalReserve(receipt, depositOperationId) {
    requireVerifiedRegtestReserve(receipt);
    const b = receipt.reserveBasis;
    this.#record(RESERVE, Buffer.from(JSON.stringify({ depositOperationId, txid: b.sweep.txid, vout: b.sweep.vout,
      amountAtomic: b.amountAtomic, scriptPubKeyHex: b.reserveScriptHex, depositOutpoint: `${b.deposit.txid}:${b.deposit.vout}`, basis: b })));
  }
  reserveWithdrawal(plan, observation) {
    requireFinalizedWithdrawal(observation);
    if (observation.encodedMessageHex !== plan.encodedMessageHex || observation.signature !== plan.solanaSignature ||
        observation.evidenceDigest !== plan.withdrawalEvidenceDigest) throw new Error("LocalLedgerWithdrawalEvidenceMismatch");
    const prior = this.withdrawal(plan.operationId);
    if (prior) {
      if (canonicalJson(prior.plan) !== canonicalJson(plan)) throw new Error("LocalLedgerWithdrawalChanged");
      return prior;
    }
    const record = { plan: validateWithdrawalPlan(plan), state: "FINALIZED_ON_SOLANA", signedTransactionHex: null, attempts: 0, payment: null, reconciliation: null };
    this.#record(WITHDRAWAL, Buffer.from(JSON.stringify(record))); return this.withdrawal(plan.operationId);
  }
  recordWithdrawalSigned(operationId, raw) {
    const r = this.withdrawal(operationId); if (!r) throw new Error("LocalLedgerWithdrawalMissing");
    if (r.state !== "FINALIZED_ON_SOLANA") { if (r.signedTransactionHex !== raw) throw new Error("LocalLedgerWithdrawalChanged"); return r; }
    validateSignedWithdrawal(r.plan, raw);
    this.#record(WITHDRAWAL, Buffer.from(JSON.stringify({ ...r, state: "SIGNED", signedTransactionHex: raw })));
  }
  recordWithdrawalBroadcast(operationId) {
    const r = this.withdrawal(operationId); if (!r || !["SIGNED", "BROADCAST"].includes(r.state) || r.attempts >= 32) throw new Error("LocalLedgerWithdrawalRetryLimit");
    this.#record(WITHDRAWAL, Buffer.from(JSON.stringify({ ...r, state: "BROADCAST", attempts: r.attempts + 1 })));
  }
  recordWithdrawalPaid(operationId, receipt) {
    requireVerifiedRegtestPayout(receipt);
    const r = this.withdrawal(operationId); if (!r) throw new Error("LocalLedgerWithdrawalMissing");
    const m = decodeCanonicalBridgeMessage(Buffer.from(r.plan.encodedMessageHex, "hex"));
    if (receipt.grossAtomic !== m.amountAtomic.toString() || receipt.netAtomic !== (m.amountAtomic - m.feeAtomic).toString() ||
        receipt.feeAtomic !== m.feeAtomic.toString() || receipt.recipientScriptHex !== m.destinationHex || receipt.reserveScriptHex !== r.plan.reserveScriptHex ||
        receipt.txid !== parseNativeTransactionHex(r.signedTransactionHex).txidHex) throw new Error("LocalLedgerPayoutReceiptMismatch");
    if (["PAID", "COMPLETED"].includes(r.state)) return;
    this.#record(WITHDRAWAL, Buffer.from(JSON.stringify({ ...r, state: "PAID", payment: structuredClone(receipt) })));
  }
  completeWithdrawal(operationId, reconciliationDigest) {
    exactHex(reconciliationDigest, 32, "Reconciliation");
    const r = this.withdrawal(operationId); if (!r) throw new Error("LocalLedgerWithdrawalMissing");
    if (r.state === "COMPLETED") return;
    this.#record(WITHDRAWAL, Buffer.from(JSON.stringify({ ...r, state: "COMPLETED", reconciliation: reconciliationDigest })));
  }
  withdrawal(id) { this.#assertHead(); return structuredClone(this.#withdrawals.get(id)); }
  knownWithdrawalIds() { this.#assertHead(); return [...new Set([...this.#requests.keys(), ...this.#withdrawals.keys()])]; }
  pendingSignedWithdrawals() {
    this.#assertHead(); return structuredClone([...this.#withdrawals.values()].filter(r => r.signedTransactionHex && !r.payment));
  }
  availableReserveInputs() {
    this.#assertHead(); const locked = new Set([...this.#withdrawals.values()].flatMap(r => r.plan.inputs.map(i => `${i.txid}:${i.vout}`)));
    return [...this.#reserves.values()].filter(i => !locked.has(`${i.txid}:${i.vout}`)).map(i => ({ txid: i.txid, vout: i.vout, amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex }))
      .sort((a, b) => `${a.txid}:${a.vout}`.localeCompare(`${b.txid}:${b.vout}`));
  }
  accountedReserveInputs() {
    this.#assertHead(); const spent = new Set([...this.#withdrawals.values()].filter(r => ["PAID", "COMPLETED"].includes(r.state)).flatMap(r => r.plan.inputs.map(i => `${i.txid}:${i.vout}`)));
    return [...this.#reserves.values()].filter(i => !spent.has(`${i.txid}:${i.vout}`)).map(i => ({ txid: i.txid, vout: i.vout, amountAtomic: i.amountAtomic, scriptPubKeyHex: i.scriptPubKeyHex }));
  }
  acceptedNativeBases() {
    this.#assertHead();
    const bases = [...this.#reserves.values()].filter(r => r.basis).map(r => ({ operationId: r.depositOperationId, amountAtomic: r.amountAtomic,
      chainworkHex: r.basis.chainworkHex, blocks: [r.basis.deposit, r.basis.sweep].map(({ height, blockHash }) => ({ height, blockHash })) }));
    for (const [operationId, r] of this.#withdrawals) if (r.payment) bases.push({ operationId, amountAtomic: r.payment.grossAtomic,
      chainworkHex: r.payment.chainworkHex, blocks: [{ height: r.payment.blockHeight, blockHash: r.payment.blockHash }] });
    return structuredClone(bases);
  }
  bridgeSnapshot() {
    this.#assertHead(); const d = this.#ledger.snapshot(); let burned = 0n, paid = 0n, fees = 0n, broadcast = 0n;
    for (const r of this.#requests.values()) burned += decodeCanonicalBridgeMessage(Buffer.from(r.encodedMessageHex, "hex")).amountAtomic;
    for (const r of this.#withdrawals.values()) {
      const m = decodeCanonicalBridgeMessage(Buffer.from(r.plan.encodedMessageHex, "hex"));
      if (!this.#requests.has(m.operationIdHex)) burned += m.amountAtomic;
      if (["PAID", "COMPLETED"].includes(r.state)) { paid += m.amountAtomic; fees += m.feeAtomic; }
      else if (r.state === "BROADCAST") broadcast += m.amountAtomic;
    }
    return Object.freeze({ canonicalReserveAtomic: (BigInt(d.canonicalReserve) - paid).toString(),
      bridgeIssuedOutstandingAtomic: (BigInt(d.mintedSupply) - burned).toString(),
      pendingMintAtomic: d.authorizedUnmintedCredits, burnedRecordedAtomic: burned.toString(), pendingWithdrawalAtomic: (burned - paid).toString(),
      broadcastPayoutAtomic: broadcast.toString(), finalizedPayoutAtomic: paid.toString(), nativeFeesAtomic: fees.toString() });
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
    else if (auxiliary) { this.#reserves = auxiliary.reserves; this.#withdrawals = auxiliary.withdrawals; this.#requests = auxiliary.requests; }
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
    if (payload.length > MAX_OPERATION_BYTES) throw new Error("LocalLedgerOperationSizeRejected");
    const text = payload.toString("utf8"), value = JSON.parse(text);
    if (JSON.stringify(value) !== text) throw new Error("LocalLedgerOperationEncodingRejected");
    const reserves = new Map(this.#reserves), withdrawals = new Map(this.#withdrawals), requests = new Map(this.#requests);
    const check = v => { if (!v) throw new Error("LocalLedgerWithdrawalTransitionRejected"); };
    if (kind === REQUEST) {
      check(Object.keys(value).sort().join() === "encodedMessageHex,signature" && typeof value.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value.signature));
      check(typeof value.encodedMessageHex === "string" && /^[0-9a-f]{1028}$/u.test(value.encodedMessageHex));
      const bytes = Buffer.from(value.encodedMessageHex, "hex"), m = decodeCanonicalBridgeMessage(bytes);
      check(bytes.subarray(12, 12 + DEPLOYMENT_IDENTITY_LENGTH).equals(this.#deployment) && m.action === "WithdrawalRequest" && m.direction === "SolanaToNative");
      const prior = requests.get(m.operationIdHex), operation = withdrawals.get(m.operationIdHex);
      if (prior) { check(canonicalJson(prior) === canonicalJson(value)); return { unchanged: true }; }
      check(requests.size < 256 && ![...requests.values()].some(r => r.signature === value.signature));
      if (operation) check(operation.plan.solanaSignature === value.signature && operation.plan.encodedMessageHex === value.encodedMessageHex);
      const known = new Map([...withdrawals].map(([id, r]) => [id, r.plan.encodedMessageHex]));
      for (const [id, r] of requests) known.set(id, r.encodedMessageHex);
      known.set(m.operationIdHex, value.encodedMessageHex);
      check([...known.values()].reduce((n, message) => n + decodeCanonicalBridgeMessage(Buffer.from(message, "hex")).amountAtomic, 0n) <= BigInt(this.#ledger.snapshot().mintedSupply));
      requests.set(m.operationIdHex, value);
    } else if (kind === RESERVE) {
      check(Object.keys(value).sort().join() === "amountAtomic,basis,depositOperationId,depositOutpoint,scriptPubKeyHex,txid,vout");
      const credit = this.#credits.get(value.depositOperationId);
      check(credit && value.amountAtomic === credit.amountAtomic && /^[0-9a-f]{64}$/u.test(value.txid) && value.vout === 0 && /^5120[0-9a-f]{64}$/u.test(value.scriptPubKeyHex));
      check(decodeCanonicalBridgeMessage(Buffer.from(credit.encodedMessageHex, "hex")).depositOutpointText === value.depositOutpoint);
      const b = value.basis;
      check(b && b.genesis === REGTEST_GENESIS && /^[0-9a-f]{64}$/u.test(b.chainworkHex) && BigInt("0x" + b.chainworkHex) > 0n &&
        b.amountAtomic === value.amountAtomic && b.reserveScriptHex === value.scriptPubKeyHex && b.sweep.txid === value.txid && b.sweep.vout === value.vout &&
        `${b.deposit.txid}:${b.deposit.vout}` === value.depositOutpoint);
      for (const block of [b.deposit, b.sweep]) check(Number.isSafeInteger(block.height) && block.height > 0 && block.height <= 4096 && /^[0-9a-f]{64}$/u.test(block.blockHash));
      const key = `${value.txid}:${value.vout}`, prior = reserves.get(key);
      if (prior) { check(canonicalJson(prior) === canonicalJson(value)); return { unchanged: true }; }
      check(![...reserves.values()].some(i => i.depositOperationId === value.depositOperationId)); reserves.set(key, value);
    } else {
      check(kind === WITHDRAWAL && Object.keys(value).sort().join() === "attempts,payment,plan,reconciliation,signedTransactionHex,state");
      const p = validateWithdrawalPlan(value.plan), m = decodeCanonicalBridgeMessage(Buffer.from(p.encodedMessageHex, "hex"));
      check(Buffer.from(p.encodedMessageHex, "hex").subarray(12, 12 + DEPLOYMENT_IDENTITY_LENGTH).equals(this.#deployment));
      const queued = requests.get(p.operationId);
      if (queued) check(queued.signature === p.solanaSignature && queued.encodedMessageHex === p.encodedMessageHex);
      check(Number.isInteger(value.attempts) && value.attempts >= 0 && value.attempts <= 32);
      const prior = withdrawals.get(p.operationId), states = ["FINALIZED_ON_SOLANA", "SIGNED", "BROADCAST", "PAID", "COMPLETED"], index = states.indexOf(value.state);
      check(index >= 0);
      if (prior && canonicalJson(prior) === canonicalJson(value)) return { unchanged: true };
      if (!prior) {
        check(index === 0 && value.attempts === 0);
        check(![...withdrawals.values()].some(r => r.plan.withdrawalId === p.withdrawalId || r.plan.solanaSignature === p.solanaSignature));
        const used = new Set([...withdrawals.values()].flatMap(r => r.plan.inputs.map(i => `${i.txid}:${i.vout}`)));
        for (const input of p.inputs) {
          const key = `${input.txid}:${input.vout}`, reserve = reserves.get(key);
          check(!used.has(key) && reserve && input.amountAtomic === reserve.amountAtomic && input.scriptPubKeyHex === reserve.scriptPubKeyHex);
        }
        const burned = [...withdrawals.values()].reduce((n, r) => n + decodeCanonicalBridgeMessage(Buffer.from(r.plan.encodedMessageHex, "hex")).amountAtomic, 0n);
        check(burned + m.amountAtomic <= BigInt(this.#ledger.snapshot().mintedSupply));
      } else {
        check(canonicalJson(prior.plan) === canonicalJson(p));
        const old = states.indexOf(prior.state);
        check(index === old + 1 || (index === 2 && old === 2) || (index === 3 && old === 1));
        check(value.attempts === prior.attempts + (index === 2 ? 1 : 0));
        if (old >= 1) check(value.signedTransactionHex === prior.signedTransactionHex);
        if (old >= 3) check(canonicalJson(value.payment) === canonicalJson(prior.payment));
      }
      if (index === 0) check(value.signedTransactionHex === null);
      else validateSignedWithdrawal(p, value.signedTransactionHex);
      if (index < 3) check(value.payment === null);
      else {
        const pay = value.payment, tx = parseNativeTransactionHex(value.signedTransactionHex), change = tx.outputs[1];
        check(pay && pay.txid === tx.txidHex && /^[0-9a-f]{64}$/u.test(pay.digestHex) && /^[0-9a-f]{64}$/u.test(pay.tipHash) && Number.isSafeInteger(pay.tipHeight) && pay.tipHeight > 0 &&
          /^[0-9a-f]{64}$/u.test(pay.blockHash) && /^[0-9a-f]{64}$/u.test(pay.chainworkHex) && BigInt("0x" + pay.chainworkHex) > 0n &&
          Number.isSafeInteger(pay.blockHeight) && pay.blockHeight > 0 && pay.blockHeight <= pay.tipHeight &&
          pay.grossAtomic === m.amountAtomic.toString() && pay.netAtomic === (m.amountAtomic - m.feeAtomic).toString() && pay.feeAtomic === m.feeAtomic.toString() &&
          pay.changeAtomic === (change?.amountAtomic ?? "0") && pay.reserveScriptHex === p.reserveScriptHex && pay.recipientScriptHex === m.destinationHex);
        if (change) reserves.set(`${tx.txidHex}:1`, { txid: tx.txidHex, vout: 1, amountAtomic: change.amountAtomic, scriptPubKeyHex: p.reserveScriptHex });
      }
      if (index === 4) check(/^[0-9a-f]{64}$/u.test(value.reconciliation)); else check(value.reconciliation === null);
      withdrawals.set(p.operationId, value);
    }
    return { reserves, withdrawals, requests };
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
      if (this.#stop !== undefined || row.seq !== this.#head + 1n || row.kind < 1n || row.kind > 6n ||
          !(row.payload instanceof Uint8Array) || row.payload.length > (row.kind < 4n ? CREDIT_LENGTH + 8 : MAX_OPERATION_BYTES)) throw new Error("LocalLedgerSequenceRejected");
      if (!equalTag(row.previous, this.#tag)) throw new Error("LocalLedgerAuthenticationFailed");
      const payload = Buffer.from(row.payload);
      const kind = Number(row.kind); // Six bounded enum values, never an amount.
      const tag = this.#authenticate(row.seq, kind, payload, this.#tag);
      if (!equalTag(row.tag, tag)) throw new Error("LocalLedgerAuthenticationFailed");
      const before = JSON.stringify(this.#ledger.snapshot());
      const auxiliary = kind >= RESERVE ? this.#applyOperation(kind, payload) : undefined;
      const credit = auxiliary ? undefined : this.#apply(this.#ledger, kind, payload);
      if (auxiliary?.unchanged || (!auxiliary && kind !== STOP && JSON.stringify(this.#ledger.snapshot()) === before)) throw new Error("LocalLedgerDuplicateEventRejected");
      this.#head = row.seq;
      this.#tag = tag;
      if (kind === STOP) this.#stop = payload.toString("ascii");
      else if (auxiliary) { this.#reserves = auxiliary.reserves; this.#withdrawals = auxiliary.withdrawals; this.#requests = auxiliary.requests; }
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
