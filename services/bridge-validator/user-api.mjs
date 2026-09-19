// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Thin user boundary on the existing service/journal. It cannot sign or mint.
import { LocalBridgeService } from "../relayer/deposit-service.mjs";
import { AuthenticatedLocalDepositLedger } from "./local-deposit-ledger.mjs";
import { createNativeDepositRequest, createMainnetNativeDepositRequest, exactFields } from "../../solana/ts/sdk/bridge.mjs";
import { ProtectedDepositController } from "./protected-deposit-controller.mjs";
import { validateDepositOperationPolicy } from "./deposit-operation-state.mjs";
import { base58Encode } from "./solana-deposit-claim-transaction-plan.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { parseNativeTransactionHex } from "../../native/node/native-taproot-transaction.mjs";
import { depositServiceStatus } from "./service-journal-state.mjs";
import { BridgeUserBalances } from "./user-balances.mjs";

const check = v => { if (!v) throw new Error("BridgeUserRequestRejected"); };
const hash = v => typeof v === "string" && /^[0-9a-f]{64}$/u.test(v);
const MAINNET_API = Symbol("Protected Mainnet public API");
export class BridgeUserApi {
  #service; #ledger; #policy; #fundFees; #balances; #busy = false; #controller;
  static createMainnet(options) { return new BridgeUserApi(options, MAINNET_API); }
  constructor({ service, ledger, controller, depositFeeInputs, balances }, capability) {
    if (capability === MAINNET_API) {
      check(service === undefined && ledger === undefined && controller instanceof ProtectedDepositController && typeof depositFeeInputs === "function");
      this.#policy = validateDepositOperationPolicy(controller.publicPolicy()); check(this.#policy.environment === "mainnet");
      this.#controller = controller; this.#fundFees = depositFeeInputs;
      check(balances instanceof BridgeUserBalances); balances.assertPolicy(this.#policy); this.#balances = balances; return;
    }
    check(capability === undefined && controller === undefined);
    check(service instanceof LocalBridgeService && ledger instanceof AuthenticatedLocalDepositLedger && typeof depositFeeInputs === "function");
    // The service supplies this identity assertion; callers cannot bind status
    // from one journal to submission in another.
    service.assertLedger(ledger);
    this.#service = service; this.#ledger = ledger; this.#policy = validateDepositOperationPolicy(service.depositPolicy()); this.#fundFees = depositFeeInputs;
    if (balances !== undefined) { check(balances instanceof BridgeUserBalances); balances.assertPolicy(this.#policy); this.#balances = balances; }
  }
  getPublicBalance(network, address) { check(this.#balances); return this.#balances.read(network, address); }
  #active() { if (this.#controller) return this.#controller.assertPublicAdmission(); check(this.#service.status({ limit: 1 }).state === "ACTIVE"); }
  getBridgeStatus() {
    if (this.#controller) return this.#controller.publicSnapshot().then(s => ({ state: s.state, trust: s.trust,
      environment: "mainnet", nativeNetwork: "MAINNET", productionReady: s.state === "ACTIVE", mainnetActivation: s.state === "ACTIVE" ? "ENABLED" : "DISABLED",
      decimals: 8, symbol: "KPEPE", accounting: s.accounting, deposits: s.operations }));
    const s = this.#service.status({ limit: 100 });
    return { state: s.state, trust: s.trust, environment: this.#policy.environment, nativeNetwork: "REGTEST", productionReady: false, mainnetActivation: "DISABLED",
      decimals: 8, symbol: "KPEPE", accounting: s.accounting, deposits: s.deposits ?? [] };
  }
  async createNativeDepositRequest(input) {
    exactFields(input, "amountAtomic,recipient,userRecoveryPublicKeyHex,nonceHex");
    await this.#active(); const quote = (this.#controller ? createMainnetNativeDepositRequest : createNativeDepositRequest)({ policy: this.#policy, ...input });
    await (this.#controller ?? this.#service).assertSolanaDestination(input.recipient); await this.#active(); return quote;
  }

  async submitNativeDeposit(input) {
    exactFields(input, "request,depositTxidHex,depositVout");
    check(!this.#busy && hash(input.depositTxidHex) && (input.depositVout === null || Number.isInteger(input.depositVout) && input.depositVout >= 0 && input.depositVout <= 0xffffffff));
    this.#busy = true;
    try {
      await this.#active();
      const quote = await this.createNativeDepositRequest(input.request), id = quote.operationId;
      if (this.#controller) {
        const existing = await this.getOperationStatus(id);
        const old = await this.#controller.pendingRequest(id);
        if (existing && !old) {
          const record = await this.#controller.inspect(id);
          // Registered deposits are read again, never funded or submitted twice.
          // The recovery key also binds the actual deposit script, separately
          // from the intent-derived public operation identifier.
          check(record.record.plan.inputs[0].txid === input.depositTxidHex &&
            (input.depositVout === null || record.record.plan.inputs[0].vout === input.depositVout) &&
            record.record.plan.depositPolicy.userRecoveryPublicKeyHex === input.request.userRecoveryPublicKeyHex &&
            record.record.plan.inputs[0].scriptPubKeyHex === quote.scriptPubKeyHex);
          return existing;
        }
        const feeFundingInputs = old?.feeFundingInputs ?? await this.#fundFees(quote);
        check(Array.isArray(feeFundingInputs)); await this.#active();
        await this.#controller.watch({ operationId: id, depositIntent: quote.depositIntent, userRecoveryPublicKeyHex: input.request.userRecoveryPublicKeyHex,
          depositTxidHex: input.depositTxidHex, depositVout: input.depositVout, feeFundingInputs });
        return this.getOperationStatus(id);
      }
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
      await this.#active();
      return await this.#service.submitDeposit({ operationId: id, depositIntent: quote.depositIntent,
        userRecoveryPublicKeyHex: input.request.userRecoveryPublicKeyHex, depositTxidHex: input.depositTxidHex,
        depositVout: input.depositVout, feeFundingInputs });
    } finally { this.#busy = false; }
  }

  getOperationStatus(id) {
    check(hash(id));
    if (this.#controller) return this.#controller.publicSnapshot().then(s => s.operations.find(o => o.operationId === id) ?? null);
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

  getDepositStatus(id) {
    const validate = v => { check(!v || v.direction === "NativeToSolana"); return v; };
    const v = this.getOperationStatus(id); return this.#controller ? v.then(validate) : validate(v);
  }

}
