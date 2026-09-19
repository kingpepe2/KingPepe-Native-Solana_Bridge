// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import * as sdk from "../../../solana/ts/sdk/bridge.mjs";
import { createBridgeClient } from "../../../solana/ts/sdk/client.mjs";
import { BridgeUserApi } from "../user-api.mjs";
import { LocalBridgeService } from "../../relayer/deposit-service.mjs";
import { AuthenticatedLocalDepositLedger } from "../local-deposit-ledger.mjs";
import { BRIDGE_ABI_SCHEMAS } from "../../../shared/protocol/solana-bridge-abi.mjs";

test("SDK, service, user API and journal expose only forward economic entry points", () => {
  const client = createBridgeClient({ endpoint: "http://127.0.0.1:29081", accessToken: "ab".repeat(32) });
  const surfaces = [sdk, client, BridgeUserApi.prototype, LocalBridgeService.prototype, AuthenticatedLocalDepositLedger.prototype];
  for (const surface of surfaces) for (const name of Object.getOwnPropertyNames(surface))
    assert(!/withdraw|payout|solanaToNative/i.test(name), name);
  assert.equal(typeof sdk.createNativeDepositRequest, "function");
  assert.equal(typeof client.submitNativeDeposit, "function");
  for (const name of ["WithdrawalRecord", "RecordWithdrawal", "BurnChecked"])
    assert.equal(Object.hasOwn(BRIDGE_ABI_SCHEMAS, name), false);
});

test("retired runtime modules are absent and recipient UI contains no signing call", () => {
  for (const file of ["../automatic-withdrawal.mjs", "../../relayer/withdrawal-service.mjs",
    "../../solana-observer/finalized-withdrawal.mjs", "../../../solana/ts/sdk/withdrawal.mjs",
    "../../../native/reserve/withdrawal-plan.mjs"])
    assert.equal(existsSync(new URL(file, import.meta.url)), false);
  const ui = readFileSync(new URL("../../../app/bridge.mjs", import.meta.url), "utf8");
  assert(!/signAndSendTransaction|signTransaction|createSolanaWithdrawal|submitSolanaWithdrawal/.test(ui));
  assert(ui.includes('"standard:connect"'));
});
