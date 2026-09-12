// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Test-only transaction compiler: intentionally allows malformed account/data
// substitutions to reach the real runtime. Not a production withdrawal SDK.
import assert from "node:assert/strict";
import { base58Decode, shortvecEncode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
const meta = (key, writable = false, signer = false) => ({ key, writable, signer });

export async function packet(payer, signers, blockhash, instructions) {
  const merged = new Map([[payer.publicKeyBase58, meta(payer.publicKeyBase58, true, true)]]);
  for (const ix of instructions) for (const a of [...ix.accounts, meta(ix.program)]) {
    const old = merged.get(a.key);
    merged.set(a.key, { key: a.key, writable: a.writable || old?.writable || false, signer: a.signer || old?.signer || false });
  }
  const rank = a => a.key === payer.publicKeyBase58 ? -1 : a.signer ? (a.writable ? 0 : 1) : (a.writable ? 2 : 3);
  const keys = [...merged.values()].sort((a, b) => rank(a) - rank(b));
  const signing = keys.filter(a => a.signer);
  const message = Buffer.concat([Buffer.from([signing.length, signing.filter(a => !a.writable).length,
    keys.filter(a => !a.signer && !a.writable).length]), shortvecEncode(keys.length),
  ...keys.map(a => base58Decode(a.key)), base58Decode(blockhash), shortvecEncode(instructions.length),
  ...instructions.map(ix => Buffer.concat([Buffer.from([keys.findIndex(a => a.key === ix.program)]),
    shortvecEncode(ix.accounts.length), Buffer.from(ix.accounts.map(a => keys.findIndex(k => k.key === a.key))),
    shortvecEncode(ix.data.length), ix.data]))]);
  const signatures = await Promise.all(signing.map(a => {
    const signer = [payer, ...signers].find(s => s.publicKeyBase58 === a.key);
    assert.ok(signer, "LOCAL_TEST_SIGNATURE_REQUIRED");
    return signer.sign(message);
  }));
  const bytes = Buffer.concat([shortvecEncode(signatures.length), ...signatures, message]);
  assert.ok(bytes.length <= 1232, "LOCAL_TEST_TRANSACTION_TOO_LARGE");
  return bytes.toString("base64");
}
