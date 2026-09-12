// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AuthenticatedLocalDepositLedger as Ledger } from "../local-deposit-ledger.mjs";
import { ExactDepositLedger } from "../automatic-deposit-pipeline.mjs";
import { encodeCanonicalBridgeMessage } from "../../../shared/protocol/canonical-message.mjs";
import { validateRuntimeFile } from "../../../shared/runtime-path-boundary.mjs";
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKER = fileURLToPath(import.meta.url);
const h = value => createHash("sha256").update(String(value)).digest("hex");
function credit(index = 0, amount = 100n, changes = {}) {
  const message = {
    action: "DepositClaim", direction: "NativeToSolana",
    deployment: { protocolId: 1, nativeNetwork: 1, nativeGenesis: REGTEST_GENESIS,
      solanaDeployment: h("local-deployment"), managerProgramId: h("local-manager"),
      transceiverProgramId: h("local-transceiver"), mint: h("local-mint") },
    depositOutpoint: { txid: h(`backing-${index}`), vout: 0 }, withdrawalId: "00".repeat(32),
    amountAtomic: amount, feeAtomic: 0n, destination: Buffer.from(h("local-recipient"), "hex"),
    policyEpoch: 1, keyEpoch: 1, nonce: h(`public-nonce-${index}`), validFrom: 1n, validUntil: 100n,
    evidenceDigest: h(`public-evidence-${index}`), ...changes,
  };
  return { encodedMessageHex: Buffer.from(encodeCanonicalBridgeMessage(message)).toString("hex"), reserveAllocationIdHex: h(`allocation-${index}`) };
}
function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-local-ledger-"));
  const options = { environment: "localnet", root: path.join(root, "ledger"), repoRoot: REPO_ROOT,
    deploymentHex: credit().encodedMessageHex.slice(24, 360), journalIdHex: h("local-journal"),
    authenticationKey: randomBytes(32), ...overrides };
  const open = new Set();
  t.after(() => {
    for (const store of open) store.close();
    options.authenticationKey.fill(0);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("kingpepe-local-ledger-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
    rmSync(root, { recursive: true, force: true });
  });
  return { root, options, file: path.join(options.root, "deposit-ledger.sqlite"),
    create: () => { const store = Ledger.createLocal(options); open.add(store); return store; },
    reopen: changes => { const store = Ledger.openLocal({ ...options, ...changes }); open.add(store); return store; } };
}
function mutate(file, statement, ...parameters) {
  const db = new DatabaseSync(file);
  try { db.prepare(statement).run(...parameters); }
  finally { db.close(); }
}
function child(f, mode) {
  const keyFile = path.join(f.root, "ephemeral-authentication.bin");
  if (!existsSync(keyFile)) writeFileSync(keyFile, f.options.authenticationKey, { mode: 0o600, flag: "wx" });
  const input = { environment: "localnet", root: f.options.root, repoRoot: REPO_ROOT, deploymentHex: f.options.deploymentHex,
    journalIdHex: f.options.journalIdHex, keyFile };
  return spawnSync(process.execPath, [WORKER, "--ledger-worker", mode], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 15000, maxBuffer: 8192, windowsHide: true,
    cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"],
  });
}

if (process.argv[2] === "--ledger-worker") {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const key = readFileSync(validateRuntimeFile(input.keyFile, input.repoRoot));
    const store = Ledger.openLocal({ ...input, authenticationKey: key });
    key.fill(0);
    if (process.argv[3] === "interrupt") {
      const exec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (statement) {
        if (statement === "COMMIT") process.exit(86); // Real interruption before transaction commit.
        return exec.call(this, statement);
      };
      store.recordValidatedDeposit(credit(1, 7n));
      throw new Error("INTERRUPT_NOT_REACHED");
    }
    if (process.argv[3] === "commit") {
      store.recordValidatedDeposit(credit(1, 7n));
      process.exit(87); // Committed event, no application shutdown or checkpoint response.
    }
    if (process.argv[3] !== "inspect") throw new Error("MODE_REJECTED");
    process.stdout.write(JSON.stringify({ snapshot: store.snapshot(), checkpoint: store.checkpoint() }));
    store.close();
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: /^LocalLedger[A-Za-z]+$/u.test(error.message) ? error.message : "WORKER_REJECTED" }));
    process.exitCode = 1;
  }
} else {
  test("withdrawal inbox rejects unverified records and keeps status pagination bounded", t => {
    const f = fixture(t), store = f.create(), before = store.checkpoint();
    assert.throws(() => store.enqueueConfirmedWithdrawal({ signature: "1".repeat(64), encodedMessageHex: credit().encodedMessageHex }));
    assert.deepEqual(store.checkpoint(), before); assert.deepEqual(store.withdrawalRequests(), []);
    for (const options of [{ offset: -1 }, { limit: 101 }, { pendingOnly: "true" }]) assert.throws(() => store.withdrawalRequests(options));
    assert.equal(store.bridgeSnapshot().pendingWithdrawalAtomic, "0");
  });
  test("authenticated ledger explicitly creates and reopens pending and minted credits", t => {
    const f = fixture(t); const store = f.create(); const item = credit();
    assert.equal(store.checkpoint().sequence, "0");
    store.recordValidatedDeposit(item);
    assert.equal(store.snapshot().authorizedUnmintedCredits, "100");
    const checkpoint = store.checkpoint();
    store.close();
    const reopened = f.reopen({ minimumCheckpoint: checkpoint });
    assert.equal(reopened.pendingCredits().length, 1);
    reopened.recordMint({ ...item, mintedAmountAtomic: "100" });
    assert.equal(reopened.snapshot().mintedSupply, "100");
    assert.equal(reopened.snapshot().authorizedUnmintedCredits, "0");
    assert.equal(reopened.checkpoint().sequence, "2");
    reopened.close();
    assert.equal(f.reopen().pendingCredits().length, 0);
  });

  test("reopening never creates a missing ledger or overwrites an existing one", t => {
    const f = fixture(t);
    assert.throws(() => f.reopen(), /LocalLedgerStorageRejected/u);
    assert(!existsSync(f.file));
    mkdirSync(f.options.root);
    assert.throws(() => f.reopen(), /ExistingDatabaseRequired/u);
    assert(!existsSync(f.file));
    const store = f.create(); store.recordValidatedDeposit(credit()); store.close();
    assert.throws(() => f.create(), /AlreadyExists/u);
    assert.equal(f.reopen().snapshot().authorizedUnmintedCredits, "100");
  });

  test("local ledger rejects other environments, networks, absent keys and source roots", t => {
    const f = fixture(t);
    for (const environment of [undefined, "devnet", "mainnet", "production"]) assert.throws(() => Ledger.createLocal({ ...f.options, environment }), /EnvironmentRejected/u);
    assert.throws(() => Ledger.createLocal({ ...f.options, deploymentHex: "00".repeat(168) }), /RegtestRequired/u);
    for (const authenticationKey of [undefined, "not-key-bytes", new Uint8Array(31)]) assert.throws(() => Ledger.createLocal({ ...f.options, authenticationKey }), /AuthenticationKeyRequired/u);
    assert.throws(() => Ledger.createLocal({ ...f.options, root: REPO_ROOT }), /StorageRejected/u);
    assert(!existsSync(f.file));
  });

  test("wrong authentication key, journal identity and deployment cannot reopen state", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit()); store.close();
    assert.throws(() => f.reopen({ authenticationKey: randomBytes(32) }), /AuthenticationFailed/u);
    assert.throws(() => f.reopen({ journalIdHex: h("different-journal") }), /AuthenticationFailed/u);
    const domain = Buffer.from(f.options.deploymentHex, "hex"); domain[72] ^= 1;
    assert.throws(() => f.reopen({ deploymentHex: domain.toString("hex") }), /AuthenticationFailed/u);
    assert.equal(f.reopen().snapshot().authorizedUnmintedCredits, "100");
  });

  test("identical credit and mint retries do not append events or duplicate liabilities", t => {
    const f = fixture(t); const store = f.create(); const item = credit();
    store.recordValidatedDeposit(item); store.recordValidatedDeposit(item);
    assert.equal(store.checkpoint().sequence, "1");
    store.recordMint({ ...item, mintedAmountAtomic: 100n });
    store.recordMint({ ...item, mintedAmountAtomic: 100n }); store.recordValidatedDeposit(item);
    assert.equal(store.checkpoint().sequence, "2");
    assert.equal(store.pendingCredits().length, 0);
    store.close();
    const reopened = f.reopen(); reopened.recordValidatedDeposit(item);
    assert.equal(reopened.checkpoint().sequence, "2");
    assert.equal(reopened.snapshot().mintedSupply, "100");
  });

  test("canonical changes, new epochs and alternate allocations cannot reuse backing", t => {
    const f = fixture(t); const store = f.create(); const item = credit(); store.recordValidatedDeposit(item);
    const before = store.checkpoint();
    for (const altered of [credit(0, 101n), credit(0, 100n, { policyEpoch: 2 }), credit(0, 100n, { nonce: h("alternate") }),
      { ...item, reserveAllocationIdHex: h("another-allocation") }]) assert.throws(() => store.recordValidatedDeposit(altered), /LedgerBackingAlreadyAllocated|LedgerCreditReplayAltered/u);
    assert.deepEqual(store.checkpoint(), before);
    store.close(); assert.equal(f.reopen().snapshot().canonicalReserve, "100");
  });

  test("failed mint authorization preserves pending credits and the durable head", t => {
    const f = fixture(t); const store = f.create(); const item = credit(); store.recordValidatedDeposit(item);
    const before = store.checkpoint();
    for (const amount of [100, -1n, 0n, "01", "1e2", 101n, 1n << 64n]) assert.throws(() => store.recordMint({ ...item, mintedAmountAtomic: amount }));
    assert.throws(() => store.recordMint({ ...credit(1), mintedAmountAtomic: 100n }), /LedgerUnknownCredit/u);
    assert.deepEqual(store.checkpoint(), before); assert.equal(store.snapshot().authorizedUnmintedCredits, "100");
  });

  test("u64 values and u128 totals retain precision across database reopen", t => {
    const f = fixture(t); const store = f.create(); const maximum = (1n << 64n) - 1n;
    const first = credit(0, maximum); const second = credit(1, maximum);
    store.recordValidatedDeposit(first); store.recordValidatedDeposit(second);
    store.recordMint({ ...first, mintedAmountAtomic: maximum }); store.close();
    const reopened = f.reopen();
    assert.equal(reopened.snapshot().canonicalReserve, (maximum * 2n).toString());
    assert.equal(reopened.snapshot().authorizedUnmintedCredits, maximum.toString());
    assert.equal(reopened.snapshot().mintedSupply, maximum.toString());
  });

  test("snapshot, pending pages and input objects cannot mutate stored authorization", t => {
    const f = fixture(t); const store = f.create(); const item = credit(); store.recordValidatedDeposit(item);
    item.encodedMessageHex = "00"; item.reserveAllocationIdHex = h("mutated");
    assert.throws(() => { store.snapshot().authorizedUnmintedCredits = "0"; }, TypeError);
    assert.throws(() => { store.pendingCredits()[0].encodedMessageHex = "00"; }, TypeError);
    for (const page of [{ limit: 101 }, { offset: -1 }, { offset: 1.5 }, { limit: 0 }]) assert.throws(() => store.pendingCredits(page), /PageRejected/u);
    store.recordMint({ ...credit(), mintedAmountAtomic: 100n }); assert.equal(store.snapshot().mintedSupply, "100");
  });

  test("hard stop is authenticated, sticky across reopen and has no reset method", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit());
    store.hardStop("ECONOMIC_CONTRADICTION"); store.hardStop("ECONOMIC_CONTRADICTION");
    assert.equal(store.checkpoint().sequence, "2"); store.close();
    const reopened = f.reopen(); assert.equal(reopened.status().state, "HARD_STOP");
    assert.throws(() => reopened.recordMint({ ...credit(), mintedAmountAtomic: 100n }), /HardStop/u);
    assert.throws(() => reopened.recordValidatedDeposit(credit(1)), /HardStop/u);
    assert.throws(() => reopened.hardStop("REPLACEMENT_REASON"), /HardStop/u);
    assert.equal(reopened.clearHardStop, undefined);
    assert.equal(reopened.snapshot().authorizedUnmintedCredits, "100");
  });

  for (const [label, statement, parameters] of [
    ["payload", "UPDATE events SET payload = ? WHERE seq = 1", [Buffer.alloc(546)]],
    ["event MAC", "UPDATE events SET tag = ? WHERE seq = 1", [Buffer.alloc(32)]],
    ["previous MAC", "UPDATE events SET previous = ? WHERE seq = 1", [Buffer.alloc(32)]],
    ["sequence", "UPDATE events SET seq = 9 WHERE seq = 1", []],
    ["head", "UPDATE meta SET head = 0", []],
    ["head MAC", "UPDATE meta SET tag = ?", [Buffer.alloc(32)]],
    ["context", "UPDATE meta SET context = ?", [Buffer.alloc(209)]],
    ["deleted suffix", "DELETE FROM events WHERE seq = 1", []],
  ]) test(`tampered ${label} is rejected during authenticated replay`, t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit()); store.close();
    mutate(f.file, statement, ...parameters);
    assert.throws(() => f.reopen(), /LocalLedger.*(?:Rejected|Failed)/u);
  });

  test("unexpected tables are rejected before replay", t => {
    const f = fixture(t); const store = f.create(); store.close();
    mutate(f.file, "CREATE TABLE unexpected (value BLOB)");
    assert.throws(() => f.reopen(), /SchemaRejected/u);
  });

  test("unexpected triggers are rejected before replay", t => {
    const f = fixture(t); const store = f.create(); store.close();
    mutate(f.file, "CREATE TRIGGER unexpected AFTER INSERT ON events BEGIN UPDATE meta SET head=0; END");
    assert.throws(() => f.reopen(), /SchemaRejected/u);
  });

  test("oversized database files are rejected before SQLite scans them", t => {
    const f = fixture(t); const store = f.create(); store.close();
    truncateSync(f.file, 64 * 1024 * 1024 + 1); // Sparse test file, not a physical disk-full claim.
    assert.throws(() => f.reopen(), /FileLimit/u);
  });

  test("authentication key input is copied and never appears in database bytes", t => {
    const f = fixture(t); const original = Buffer.from(f.options.authenticationKey); const store = f.create();
    f.options.authenticationKey.fill(0); store.recordValidatedDeposit(credit()); store.close();
    assert(!readFileSync(f.file).includes(original), "Authentication material leaked into database");
    const reopened = f.reopen({ authenticationKey: original });
    assert.equal(reopened.snapshot().authorizedUnmintedCredits, "100"); original.fill(0);
  });

  test("two connections in one process cannot share an exclusive ledger", t => {
    const f = fixture(t); const store = f.create();
    assert.throws(() => f.reopen(), /LeaseUnavailable/u);
    store.recordValidatedDeposit(credit()); store.close();
    assert.equal(f.reopen().snapshot().authorizedUnmintedCredits, "100");
  });

  test("invalid checkpoint cannot be used as a freshness assertion", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit()); store.close();
    for (const minimumCheckpoint of [{ sequence: 1, tagHex: h("wrong") }, { sequence: "01", tagHex: h("wrong") },
      { sequence: "1", tagHex: h("wrong") }, { sequence: "3", tagHex: h("wrong") }]) {
      assert.throws(() => f.reopen({ minimumCheckpoint }), /CheckpointRejected/u);
    }
  });

  test("corrupt database input fails closed and is not automatically replaced", t => {
    const f = fixture(t); mkdirSync(f.options.root);
    writeFileSync(f.file, "public malformed database fixture", { flag: "wx" });
    assert.throws(() => f.reopen(), /StorageRejected/u);
    assert.equal(readFileSync(f.file, "utf8"), "public malformed database fixture");
  });

  test("retained checkpoint rejects rollback but an entirely rolled-back anchor cannot prove freshness", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit());
    const older = store.checkpoint(); store.close();
    const backup = path.join(f.root, "local-test-snapshot.sqlite"); copyFileSync(f.file, backup);
    const second = f.reopen(); second.recordValidatedDeposit(credit(1)); const current = second.checkpoint(); second.close();
    copyFileSync(backup, f.file);
    assert.throws(() => f.reopen({ minimumCheckpoint: current }), /RollbackCheckpointRejected/u);
    // Honest limitation: a co-restored DB and anchor carry no evidence of the lost event.
    const rolledBack = f.reopen({ minimumCheckpoint: older });
    assert.equal(rolledBack.snapshot().authorizedUnmintedCredits, "100");
  });

  test("separate processes cannot acquire the same retained database lease", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit());
    const blocked = child(f, "inspect");
    assert.equal(blocked.status, 1); assert.equal(JSON.parse(blocked.stdout).error, "LocalLedgerLeaseUnavailable");
    store.close(); const released = child(f, "inspect");
    assert.equal(released.status, 0); assert.equal(JSON.parse(released.stdout).snapshot.authorizedUnmintedCredits, "100");
  });

  test("process interruption before commit preserves the previous economic state", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit()); const before = store.checkpoint(); store.close();
    const interrupted = child(f, "interrupt"); assert.equal(interrupted.status, 86);
    const reopened = f.reopen({ minimumCheckpoint: before });
    assert.deepEqual(reopened.checkpoint(), before); assert.equal(reopened.snapshot().authorizedUnmintedCredits, "100");
  });

  test("committed credit survives abrupt exit without a response or graceful shutdown", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit()); store.close();
    const committed = child(f, "commit"); assert.equal(committed.status, 87);
    const reopened = f.reopen(); assert.equal(reopened.snapshot().authorizedUnmintedCredits, "107");
    reopened.recordValidatedDeposit(credit(1, 7n)); assert.equal(reopened.checkpoint().sequence, "2");
  });

  test("SQLite page-quota exhaustion preserves committed state and poisons the active instance", t => {
    const f = fixture(t, { maxPages: 8 }); const store = f.create(); let count = 0; let before;
    let failed = false;
    for (let index = 0; index < 100; index += 1) {
      before = store.checkpoint();
      try { store.recordValidatedDeposit(credit(index, 1n)); count += 1; }
      catch (error) { assert.match(error.message, /LocalLedgerDiskFull/u); failed = true; break; }
    }
    assert(failed); assert.throws(() => store.snapshot(), /LocalLedgerClosed/u);
    const reopened = f.reopen(); assert.deepEqual(reopened.checkpoint(), before);
    assert.equal(reopened.snapshot().authorizedUnmintedCredits, String(count));
  });

  test("a linked runtime root cannot reopen the database", t => {
    const f = fixture(t); const store = f.create(); store.recordValidatedDeposit(credit()); store.close();
    const alias = path.join(f.root, "alias"); symlinkSync(f.options.root, alias, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => f.reopen({ root: alias }), /StorageRejected/u);
  });

  test("invalid page limits cannot create a directory or database", t => {
    const f = fixture(t);
    for (const maxPages of [0, 7, 8.5, "8", 16385]) {
      assert.throws(() => Ledger.createLocal({ ...f.options, maxPages }), /PageLimitRejected/u);
      assert(!existsSync(f.options.root));
    }
  });

  for (const suffix of ["-journal", "-wal", "-shm"]) test(`linked SQLite ${suffix} file is rejected before opening a database`, t => {
    const f = fixture(t); mkdirSync(f.options.root);
    const marker = path.join(f.root, "unrelated-public-marker.txt");
    writeFileSync(marker, "public filesystem marker", { flag: "wx" });
    linkSync(marker, f.file + suffix);
    assert.throws(() => f.create(), /LocalLedgerStorageRejected/u);
    assert(!existsSync(f.file));
    assert.equal(readFileSync(marker, "utf8"), "public filesystem marker");
  });

  test("auxiliary paths are checked again before appending an economic event", t => {
    const f = fixture(t); const store = f.create();
    const marker = path.join(f.root, "unrelated-public-marker.txt");
    writeFileSync(marker, "public filesystem marker", { flag: "wx" });
    // EXCLUSIVE mode can retain its rollback journal between commits. Use the
    // inactive WAL name; do not delete or replace SQLite's active journal.
    linkSync(marker, f.file + "-wal");
    assert.throws(() => store.recordValidatedDeposit(credit()), /LocalLedgerStorageRejected/u);
    assert.throws(() => store.snapshot(), /LocalLedgerClosed/u);
    assert.equal(readFileSync(marker, "utf8"), "public filesystem marker");
  });

  test("forked exact accounting has independent mutable collections", () => {
    const ledger = new ExactDepositLedger(); const item = credit(); ledger.recordValidatedDeposit(item);
    const fork = ledger.fork(); fork.recordMint({ ...item, mintedAmountAtomic: 100n }); fork.recordValidatedDeposit(credit(1));
    assert.equal(ledger.snapshot().mintedSupply, "0"); assert.equal(ledger.snapshot().canonicalReserve, "100");
    assert.equal(fork.snapshot().mintedSupply, "100"); assert.equal(fork.snapshot().canonicalReserve, "200");
    ledger.recordValidatedDeposit(credit(1)); assert.equal(ledger.snapshot().canonicalReserve, "200");
  });
}
