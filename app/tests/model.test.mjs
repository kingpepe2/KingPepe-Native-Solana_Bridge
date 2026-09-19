// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toAtomic, fromAtomic, checkQuote } from "../model.mjs";

test("display amounts use exact eight-decimal integers through u64", () => {
  for (const [display, atoms] of [["1", "100000000"], ["0.00000001", "1"], ["184467440737.09551615", "18446744073709551615"]]) {
    assert.equal(toAtomic(display), atoms); assert.equal(toAtomic(fromAtomic(atoms)), atoms);
  }
  assert.equal(toAtomic("0", { zero: true }), "0"); assert.equal(fromAtomic("0"), "0.00000000");
});
test("display input rejects floating-point shorthand, excess decimals and overflow", () => {
  for (const value of [0.1, "0", "-1", "01", "1e8", "0.000000001", "184467440737.09551616", "1.", " 1", "NaN"]) assert.throws(() => toAtomic(value));
  for (const value of [0, "-1", "1.0", "18446744073709551616"]) assert.throws(() => fromAtomic(value));
});
test("displayed deposit binds direction, amount, recipient and public recovery request", () => {
  const deposit = { amountAtomic: "100", recipient: "PUBLIC_TOKEN_ACCOUNT", nonceHex: "ab".repeat(32), userRecoveryPublicKeyHex: "cd".repeat(32) };
  const d = { operationId: "ef".repeat(32), direction: "NativeToSolana", request: deposit, ...deposit, depositAddress: "PUBLIC_NATIVE_ADDRESS" };
  assert.equal(checkQuote(d, deposit), d);
  for (const change of [{ direction: "SolanaToNative" }, { amountAtomic: "101" }, { recipient: "OTHER" },
    { request: { ...deposit, nonceHex: "00".repeat(32) } }, { request: { ...deposit, userRecoveryPublicKeyHex: "00".repeat(32) } }])
    assert.throws(() => checkQuote({ ...d, ...change }, deposit));
});
