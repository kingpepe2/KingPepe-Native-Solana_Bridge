// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Local bridge loop over the existing journal and concrete verified worker.
// No private share, second database, automatic unpause or approval queue.
import { setTimeout as delay } from "node:timers/promises";
import { AuthenticatedLocalDepositLedger } from "../bridge-validator/local-deposit-ledger.mjs";
import { AutomaticNativeToSolanaDeposit } from "../bridge-validator/automatic-native-deposit.mjs";
import { sha256Canonical } from "../../native/frost/policy/native-signing-policy.mjs";
const check = v => { if (!v) throw new Error("BridgeServiceConfigurationRejected"); };
export class LocalBridgeService {
  #ledger; #deposits; #busy = false; #running = false; #depositCursor = 0;
  constructor({ ledger, depositWorker }) {
    check(ledger instanceof AuthenticatedLocalDepositLedger && depositWorker instanceof AutomaticNativeToSolanaDeposit);
    depositWorker.assertLedger(ledger); this.#ledger = ledger; this.#deposits = depositWorker;
  }

  assertLedger(ledger) { check(ledger === this.#ledger); }
  depositPolicy() { check(this.#deposits !== undefined); return this.#deposits.publicPolicy(); }
  assertSolanaDestination(account) { return this.#deposits.assertSolanaDestination(account); }

  submitDeposit(request) { check(this.#deposits !== undefined); return this.#deposits.submit(request); }
  pause(reason) { this.#ledger.pause(reason); }
  async resumeAfterReview() {
    check(!this.#busy && !this.#running && this.#ledger.status().state === "PAUSED");
    this.#busy = true;
    try { await this.#deposits.catchUp();
      const result = await this.#deposits.reconcile(); check(result.state === "MATCH"); this.#ledger.resumeAfterReview(); return this.status(); }
    finally { this.#busy = false; }
  }

  status(page = {}) {
    return { state: this.#ledger.status().state === "OPEN_LOCAL_ACCOUNTING_ONLY" ? "ACTIVE" : "PAUSED", trust: "LOCAL_JOURNAL_NOT_FRESH_CHAIN_RECONCILIATION",
      pauseReason: this.#ledger.status().reason ?? null,
      accounting: this.#ledger.bridgeSnapshot(),
      ...(this.#deposits ? { deposits: this.#ledger.serviceDeposits(page) } : {}) };
  }
  async tick({ limit = 16 } = {}) {
    check(Number.isInteger(limit) && limit >= 1 && limit <= 100);
    if (this.#busy) throw new Error("BridgeServiceBusy"); this.#busy = true;
    try {
      if (this.status({ limit: 1 }).state === "PAUSED") {
        // Pause blocks new external actions. Observe a mint already submitted
        // without signing or sending again. Integrity stops remain absorbing.
        if (this.#ledger.status().state === "PAUSED") {
          await this.#deposits?.catchUp();
        }
        return { state: "PAUSED", reason: this.#ledger.status().reason, operations: [] };
      }
      const operations = [];
      // Catch up already-landed effects and check global backing BEFORE any
      // new signing/send. Validating just the selected inputs is insufficient
      // when a different retained reserve was invalidated or spent.
      let admission;
      try {
        await this.#deposits.catchUp();
        admission = await this.#deposits.reconcile();
      } catch { return { state: this.status({ limit: 1 }).state === "PAUSED" ? "PAUSED" : "WAITING_FOR_DEPENDENCY", operations }; }
      if (admission.state !== "MATCH") return { state: admission.state, operations, reconciliation: admission };
      if (this.#deposits) {
        await this.#deposits.observe({ limit });
        const pending = this.#ledger.serviceDeposits({ pendingOnly: true, registeredOnly: true });
        const selected = this.#page(pending, limit, this.#depositCursor);
        this.#depositCursor = pending.length ? (this.#depositCursor + selected.length) % pending.length : 0;
        for (const request of selected) {
          if (!this.#ledger.serviceDeposit(request.operationId)) continue; // User transaction not yet validated.
          try { operations.push(await this.#deposits.run(request.operationId)); }
          catch { operations.push({ operationId: request.operationId, state: this.status({ limit: 1 }).state === "PAUSED" ? "PAUSED" : "WAITING_FOR_DEPENDENCY" }); }
          if (this.status({ limit: 1 }).state === "PAUSED") return { state: "PAUSED", reason: this.#ledger.status().reason, operations };
        }
        // Settle/catch up the deposit journal before comparing mint counters or
        // proceeding again. An unknown send outcome is WAIT, not a
        // fabricated reserve deficit. No second ledger or balance adjustment.
        if (this.#ledger.serviceDeposits({ pendingOnly: true }).some(r => {
          const op = this.#ledger.serviceDeposit(r.operationId)?.operation;
          return op?.broadcastAttempted && op.mintReceipt === null;
        })) return { state: "WAITING_FOR_DEPENDENCY", operations, reconciliation: { state: "WAITING_FOR_DEPENDENCY", reason: "DEPOSIT_SETTLEMENT_PENDING" } };
      }
      // Results contain public operation status only; underlying RPC/storage
      // exception text can include private local configuration and is not logged.
      let reconciliation = { state: "WAITING_FOR_DEPENDENCY" };
      try { reconciliation = await this.#deposits.reconcile(); } catch { /* Missing source evidence is not a balance contradiction. */ }
      if (this.#deposits && reconciliation.state === "MATCH" && this.status({ limit: 1 }).state === "ACTIVE") {
        for (const request of this.#ledger.serviceDeposits({ pendingOnly: true })) if (request.state === "MINTED") {
          this.#ledger.updateServiceDeposit(request.operationId, "COMPLETED", sha256Canonical(reconciliation));
          const result = operations.find(r => r.operationId === request.operationId);
          if (result) result.state = "COMPLETED";
        }
      }
      return { state: this.status({ limit: 1 }).state, operations, reconciliation };
    } finally { this.#busy = false; }
  }
  #page(items, limit, cursor) { return Array.from({ length: Math.min(limit, items.length) }, (_, i) => items[(cursor + i) % items.length]); }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 250 && intervalMs <= 30000 && typeof onStatus === "function");
    if (this.#running) throw new Error("BridgeServiceAlreadyRunning"); this.#running = true;
    try {
      while (!signal.aborted) {
        await onStatus(await this.tick());
        try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("BridgeServiceInterrupted"); }
      }
    } finally { this.#running = false; }
  }
}
