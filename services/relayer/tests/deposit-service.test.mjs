// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Service admission tests with a real durable journal and synthetic worker
// observations. Actual chain/recovery tests run separately.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalBridgeService } from "../deposit-service.mjs";
import { AuthenticatedLocalDepositLedger as Ledger } from "../../bridge-validator/local-deposit-ledger.mjs";
import { AutomaticNativeToSolanaDeposit } from "../../bridge-validator/automatic-native-deposit.mjs";
import { REGTEST_GENESIS } from "../../../native/node/native-raw-evidence.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-forward-admission-"));
  const header = Buffer.alloc(8); header.writeUInt32LE(1); header.writeUInt32LE(1, 4);
  const options = { environment: "localnet", root: path.join(root, "journal"), repoRoot: path.resolve(import.meta.dirname, "../../.."),
    journalIdHex: randomBytes(32).toString("hex"), authenticationKey: randomBytes(32),
    deploymentHex: Buffer.concat([header, Buffer.from(REGTEST_GENESIS, "hex"), ...[1, 2, 3, 4].map(n => Buffer.alloc(32, n))]).toString("hex") };
  let ledger = Ledger.createLocal(options);
  const calls = [], worker = Object.create(AutomaticNativeToSolanaDeposit.prototype);
  Object.assign(worker, {
    publicPolicy: () => ({ environment: "localnet" }),
    assertLedger: value => assert.equal(value, ledger),
    catchUp: async () => { calls.push("CATCH_UP"); },
    reconcile: async () => { calls.push("MATCH"); return { state: "MATCH" }; },
    observe: async () => { calls.push("OBSERVE"); },
  });
  t.after(() => {
    ledger.close(); options.authenticationKey.fill(0);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("kingpepe-forward-admission-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
    rmSync(root, { recursive: true, force: true });
  });
  return { ledger, worker, calls, service: new LocalBridgeService({ ledger, depositWorker: worker }),
    reopen: () => { ledger.close(); ledger = Ledger.openLocal(options); return ledger; } };
}

test("fresh backing admission precedes new observation and is repeated each tick", async t => {
  const f = fixture(t);
  await f.service.tick(); await f.service.tick();
  assert.deepEqual(f.calls, ["CATCH_UP", "MATCH", "OBSERVE", "MATCH", "CATCH_UP", "MATCH", "OBSERVE", "MATCH"]);
});

test("public supply is absent until reconciled, is invalidated by ledger changes and never survives pause", async t => {
  const f = fixture(t);
  f.worker.publicPolicy = () => ({ environment: "devnet", mint: '01'.repeat(32) });
  f.worker.reconcile = async () => ({ state: 'MATCH', canonicalReserve: '0', mintedSupply: '0', unclaimedDirectBurnDifference: '0', authorizedUnmintedCredits: '0' });
  assert.equal(f.service.status().supply.state, 'UNAVAILABLE');
  await f.service.tick();
  assert.equal(f.service.status().supply.bridgedSupplyAtomic, '0');
  assert.equal(f.service.status().supply.remainingSupplyAtomic, '2100000000000000');
  f.service.pause('REVIEW'); assert.equal(f.service.status().supply.state, 'UNAVAILABLE');
  assert.equal(f.reopen().completedForwardAtomic(), '0');
});

test("an invalid over-cap accounting projection enters the existing persisted safe state", async t => {
  const f = fixture(t); f.worker.publicPolicy = () => ({ environment: 'devnet', mint: '01'.repeat(32) });
  f.worker.reconcile = async () => ({ state: 'MATCH', canonicalReserve: '2100000000000001', mintedSupply: '2100000000000001', unclaimedDirectBurnDifference: '0', authorizedUnmintedCredits: '0' });
  assert.equal((await f.service.tick()).state, 'PAUSED');
  assert.equal(f.service.status().supply.state, 'UNAVAILABLE');
  assert.equal(f.reopen().status().reason, 'COMPLETED_SUPPLY_CONTRADICTION');
  assert.throws(() => f.reopen().resumeAfterReview());
});

for (const condition of ["WAITING_FOR_DEPENDENCY", "ACCOUNTING_CONTRADICTION", "RPC_UNAVAILABLE"])
  test(`forward service creates no economic work after ${condition}`, async t => {
    const f = fixture(t);
    f.worker.reconcile = async () => {
      if (condition === "RPC_UNAVAILABLE") throw Error("PRIVATE_DEPENDENCY_DETAIL");
      if (condition === "ACCOUNTING_CONTRADICTION") { f.ledger.hardStop(condition); return { state: "PAUSED" }; }
      return { state: condition };
    };
    const result = await f.service.tick();
    assert.equal(result.state, condition === "ACCOUNTING_CONTRADICTION" ? "PAUSED" : "WAITING_FOR_DEPENDENCY");
    assert.deepEqual(result.operations, []); assert.deepEqual(f.calls, ["CATCH_UP"]);
    assert(!JSON.stringify(result).includes("PRIVATE_DEPENDENCY_DETAIL"));
    if (condition === "ACCOUNTING_CONTRADICTION") {
      assert.equal(f.reopen().status().state, "HARD_STOP");
      assert.throws(() => f.reopen().resumeAfterReview());
    }
  });

test("pause admits only read-only catch-up; reviewed resume requires fresh MATCH", async t => {
  const f = fixture(t); f.service.pause("OPERATOR_REVIEW");
  assert.equal((await f.service.tick()).state, "PAUSED"); assert.deepEqual(f.calls, ["CATCH_UP"]);
  f.worker.reconcile = async () => ({ state: "WAITING_FOR_DEPENDENCY" });
  await assert.rejects(f.service.resumeAfterReview()); assert.equal(f.ledger.status().state, "PAUSED");
  f.worker.reconcile = async () => ({ state: "MATCH" });
  assert.equal((await f.service.resumeAfterReview()).state, "ACTIVE");
});
