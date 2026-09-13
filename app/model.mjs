// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Display/request helpers only; economic authorization stays in the bridge.
export function toAtomic(text, { zero = false } = {}) {
  if (typeof text !== "string" || !/^(0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/u.test(text)) throw new Error("AMOUNT_FORMAT");
  const [whole, fraction = ""] = text.split(".");
  const n = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  if (n > 0xffffffffffffffffn || (!zero && n === 0n)) throw new Error("AMOUNT_RANGE");
  return n.toString();
}
export function fromAtomic(text) {
  if (typeof text !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(text) || BigInt(text) > 0xffffffffffffffffn) throw new Error("AMOUNT_RANGE");
  const n = BigInt(text); return `${n / 100000000n}.${(n % 100000000n).toString().padStart(8, "0")}`;
}
export function checkQuote(quote, input, direction) {
  if (!quote || !/^[0-9a-f]{64}$/u.test(quote.operationId) || quote.direction !== direction || quote.amountAtomic !== input.amountAtomic) throw new Error("REQUEST_CHANGED");
  if (direction === "NativeToSolana") {
    if (quote.recipient !== input.recipient || quote.request?.nonceHex !== input.nonceHex ||
        quote.request?.userRecoveryPublicKeyHex !== input.userRecoveryPublicKeyHex || typeof quote.depositAddress !== "string") throw new Error("REQUEST_CHANGED");
  } else if (quote.destination !== input.destination || quote.feeAtomic !== input.feeAtomic || quote.chain !== "solana:localnet" ||
      quote.netAtomic !== (BigInt(input.amountAtomic) - BigInt(input.feeAtomic)).toString() || typeof quote.transactionBase64 !== "string") throw new Error("REQUEST_CHANGED");
  return quote;
}
