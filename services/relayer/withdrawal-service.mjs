// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Local bridge loop over the existing journal and concrete verified worker.
// No private share, second database, automatic unpause or approval queue.
import { setTimeout as delay } from "node:timers/promises";
import { AuthenticatedLocalDepositLedger } from "../bridge-validator/local-deposit-ledger.mjs";
import { AutomaticSolanaToNativeWithdrawal } from "../bridge-validator/automatic-withdrawal.mjs";
const check = v => { if (!v) throw new Error("WithdrawalServiceConfigurationRejected"); };
export class LocalWithdrawalService {
  #ledger; #worker; #busy = false; #running = false;
  constructor({ ledger, worker }) {
    check(ledger instanceof AuthenticatedLocalDepositLedger && worker instanceof AutomaticSolanaToNativeWithdrawal);
    worker.assertLedger(ledger); this.#ledger = ledger; this.#worker = worker;
  }
  submit(signature) { return this.#worker.enqueue(signature); }
  observe() { return this.#worker.observe(); }
  status(page = {}) {
    return { state: this.#ledger.status().state === "HARD_STOP" ? "PAUSED" : "ACTIVE", trust: "LOCAL_JOURNAL_NOT_FRESH_CHAIN_RECONCILIATION",
      accounting: this.#ledger.bridgeSnapshot(), withdrawals: this.#ledger.withdrawalRequests(page) };
  }
  async tick({ limit = 16 } = {}) {
    check(Number.isInteger(limit) && limit >= 1 && limit <= 100);
    if (this.#busy) throw new Error("WithdrawalServiceBusy"); this.#busy = true;
    try {
      if (this.status({ limit: 1 }).state === "PAUSED") return { state: "PAUSED", operations: [] };
      try { await this.observe(); } catch { return { state: this.status({ limit: 1 }).state === "PAUSED" ? "PAUSED" : "WAITING_FOR_DEPENDENCY", operations: [] }; }
      const operations = [];
      for (const request of this.#ledger.withdrawalRequests({ limit, pendingOnly: true })) {
        try { operations.push(await this.#worker.run(request.signature)); }
        catch {
          const paused = this.#ledger.status().state === "HARD_STOP";
          operations.push({ operationId: request.operationId, state: paused ? "PAUSED" : "WAITING_FOR_DEPENDENCY" });
          if (paused) break;
        }
      }
      // Results contain public operation status only; underlying RPC/storage
      // exception text can include private local configuration and is not logged.
      let reconciliation = { state: "WAITING_FOR_DEPENDENCY" };
      try { reconciliation = await this.#worker.reconcile(); } catch { /* Missing source evidence is not a balance contradiction. */ }
      return { state: this.status({ limit: 1 }).state, operations, reconciliation };
    } finally { this.#busy = false; }
  }
  async run({ signal, intervalMs = 1000, onStatus = () => {} }) {
    check(signal instanceof AbortSignal && Number.isInteger(intervalMs) && intervalMs >= 250 && intervalMs <= 30000 && typeof onStatus === "function");
    if (this.#running) throw new Error("WithdrawalServiceAlreadyRunning"); this.#running = true;
    try {
      while (!signal.aborted) {
        await onStatus(await this.tick());
        try { await delay(intervalMs, undefined, { signal }); } catch { if (!signal.aborted) throw new Error("WithdrawalServiceInterrupted"); }
      }
    } finally { this.#running = false; }
  }
}
