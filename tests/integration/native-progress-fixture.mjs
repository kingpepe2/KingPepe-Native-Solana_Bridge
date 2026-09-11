// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Synthetic policy/persistence input ONLY, never a verified Native receipt.
import { createHash } from "node:crypto";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { NATIVE_INTEGRITY_PROTOCOL } from "../../native/node/native-integrity.mjs";
export const nativeFixtureHash = text => createHash("sha256").update(text).digest("hex");
export function nativeProgressFixture() {
  const h = nativeFixtureHash;
  const now = Date.now(), expectedPolicy = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: h("protected-ipc-local-deployment"), keyEpoch: 1, minimumConfirmations: 3, maximumStallMs: 60000 };
  const hashes = [REGTEST_GENESIS, ...Array.from({ length: 5 }, (_, i) => h(String(i)))];
  const chain = { genesis: REGTEST_GENESIS, tipHeight: 5, tipHash: hashes[5], headerHashes: hashes, chainworkHex: "00".repeat(31) + "10", observedAt: now };
  const b = { operationId: h("test-operation"), genesis: REGTEST_GENESIS, chainworkHex: chain.chainworkHex,
    deposit: { txid: h("deposit"), vout: 0, height: 2, blockHash: hashes[2] }, sweep: { txid: h("sweep"), vout: 0, height: 3, blockHash: hashes[3] },
    amountAtomic: "9007199254740993", reserveScriptHex: "5120" + h("test-reserve") };
  const stored = { protocol: NATIVE_INTEGRITY_PROTOCOL, policyDigest: h(JSON.stringify(expectedPolicy)), genesis: REGTEST_GENESIS,
    tipHeight: 5, tipHash: hashes[5], chainworkHex: chain.chainworkHex, lastObservationMs: now, lastAdvanceMs: now, bases: [b], incident: null };
  return { expectedPolicy, chain, stored, now };
}
