// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Thin user boundary on the existing service/journal. It cannot sign or mint.
import { LocalBridgeService } from "../relayer/deposit-service.mjs";
import { AuthenticatedLocalDepositLedger } from "./local-deposit-ledger.mjs";
import { createNativeDepositRequest, exactFields } from "../../solana/ts/sdk/bridge.mjs";
import { validateDepositOperationPolicy } from "./deposit-operation-state.mjs";
import { base58Encode } from "./solana-deposit-claim-transaction-plan.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { depositServiceStatus } from "./service-journal-state.mjs";
import { BridgeUserBalances } from "./user-balances.mjs";

const check = v => { if (!v) throw new Error("BridgeUserRequestRejected"); };
const hash = v => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);
export class BridgeUserApi {
  #service; #ledger; #policy; #fundFees; #balances; #busy = false;
  constructor({ service, ledger, depositFeeInputs, balances }) {
    check(service instanceof LocalBridgeService && ledger instanceof AuthenticatedLocalDepositLedger && typeof depositFeeInputs === "function");
    // The service supplies this identity assertion; callers cannot bind status
    // from one journal to submission in another.
    service.assertLedger(ledger);
    this.#service = service; this.#ledger = ledger; this.#policy = validateDepositOperationPolicy(service.depositPolicy()); this.#fundFees = depositFeeInputs;
    if (balances !== undefined) { check(balances instanceof BridgeUserBalances); balances.assertPolicy(this.#policy); this.#balances = balances; }
  }
  getPublicBalance(network, address) { check(this.#balances); return this.#balances.read(network, address); }
  #active() { check(this.#service.status({ limit: 1 }).state === "ACTIVE"); }
  getBridgeStatus() {
    const s = this.#service.status({ limit: 100 });
    return { state: s.state, trust: s.trust, environment: this.#policy.environment, nativeNetwork: "REGTEST", productionReady: false, mainnetActivation: "DISABLED",
      decimals: 8, symbol: "KPEPE", accounting: s.accounting, deposits: s.deposits ?? [] };
  }
  async createNativeDepositRequest(input) {
    exactFields(input, "amountAtomic,recipient,userRecoveryPublicKeyHex,nonceHex");
    this.#active(); const quote = createNativeDepositRequest({ policy: this.#policy, ...input });
    await this.#service.assertSolanaDestination(input.recipient); this.#active(); return quote;
  }

  async submitNativeDeposit(input) {
    exactFields(input, "request,depositTxidHex,depositVout");
    check(!this.#busy && hash(input.depositTxidHex) && (input.depositVout === null || Number.isInteger(input.depositVout) && input.depositVout >= 0 && input.depositVout <= 0xffffffff));
    this.#active(); this.#busy = true;
    try {
      const quote = await this.createNativeDepositRequest(input.request), id = quote.operationId;
      const existing = this.#ledger.serviceDeposit(id)?.operation;
      if (existing) {
        check(existing.plan.inputs[0].txid === input.depositTxidHex && (input.depositVout === null || existing.plan.inputs[0].vout === input.depositVout) &&
          existing.plan.depositPolicy.userRecoveryPublicKeyHex === input.request.userRecoveryPublicKeyHex);
        return this.getDepositStatus(id);
      }
      const old = this.#ledger.serviceDepositRequests().find(r => r.operationId === id);
      // Fee inputs are existing operator-supplied TEST funding, not user-selected
      // reserve allocations. The retained Native verifier validates every input.
      const feeFundingInputs = old?.feeFundingInputs ?? await this.#fundFees(quote);
      check(Array.isArray(feeFundingInputs));
      const backing = new Set(this.#ledger.accountedReserveInputs().map(i => i.txid + ":" + i.vout));
      check(feeFundingInputs.every(i => i && !backing.has(i.txid + ":" + i.vout)));
      this.#active();
      return await this.#service.submitDeposit({ operationId: id, depositIntent: quote.depositIntent,
        userRecoveryPublicKeyHex: input.request.userRecoveryPublicKeyHex, depositTxidHex: input.depositTxidHex,
        depositVout: input.depositVout, feeFundingInputs });
    } finally { this.#busy = false; }
  }

  getOperationStatus(id) {
    check(hash(id));
    const d = this.#ledger.serviceDeposit(id);
    const watch = this.#ledger.serviceDepositRequests().find(r => r.operationId === id);
    if (d || watch) {
      const op = d?.operation, intent = op?.plan.depositIntent ?? watch.depositIntent;
      const state = d ? depositServiceStatus(d) : "OBSERVED";
      const credit = op?.finalizedCredit ? decodeCanonicalBridgeMessage(op.finalizedCredit.encodedMessageHex) : null;
      const delivery = credit ? this.#ledger.solanaServiceJournal("CLAIM").get(credit.operationIdHex) : null;
      return { operationId: id, direction: "NativeToSolana", state: state === "ATTESTED" && delivery?.submittedSignature ? "CLAIMED" : state,
        amountAtomic: intent.amountAtomic, destination: base58Encode(Buffer.from(intent.recipientHex, "hex")),
        transactionIds: { nativeDeposit: op?.plan.inputs[0].txid ?? watch.depositTxidHex,
          nativeSweep: op?.signedTransactionHex ? parseNativeTransactionHex(op.signedTransactionHex).txidHex : null,
          solanaClaim: op?.mintReceipt?.signature ?? delivery?.submittedSignature ?? null }, trust: "JOURNAL_OBSERVATION" };
    }
    return null;
  }

  getDepositStatus(id) { const v = this.getOperationStatus(id); check(!v || v.direction === "NativeToSolana"); return v; }

}
