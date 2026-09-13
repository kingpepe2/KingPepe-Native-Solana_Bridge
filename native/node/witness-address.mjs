// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Address presentation only. Network/UTXO authorization remains in the verifier.
import { bech32, bech32m } from "@scure/base";

// Pinned Native source 3f262182, src/kernel/chainparams.cpp CRegTestParams.
export const NATIVE_REGTEST_HRP = "rkpepe";
const check = v => { if (!v) throw new Error("NativeWitnessAddressRejected"); };
const supported = hex => typeof hex === "string" && /^(?:0014[0-9a-f]{40}|0020[0-9a-f]{64}|5120[0-9a-f]{64})$/u.test(hex);
export function witnessAddressFromScript(scriptHex, hrp = NATIVE_REGTEST_HRP) {
  check(supported(scriptHex) && typeof hrp === "string" && /^[a-z0-9]{1,20}$/u.test(hrp));
  const version = scriptHex.startsWith("00") ? 0 : 1, codec = version ? bech32m : bech32;
  return codec.encode(hrp, [version, ...codec.toWords(Buffer.from(scriptHex.slice(4), "hex"))], 90);
}
export function scriptFromWitnessAddress(address, hrp = NATIVE_REGTEST_HRP) {
  check(typeof address === "string" && address.length <= 90 && typeof hrp === "string");
  // Accept uniform upper case, never mixed case, checksum repair or another HRP.
  check(address === address.toLowerCase() || address === address.toUpperCase());
  const text = address.toLowerCase(); let result;
  for (const [version, codec] of [[0, bech32], [1, bech32m]]) {
    try {
      const { prefix, words } = codec.decode(text, 90);
      if (prefix !== hrp || words[0] !== version) continue;
      const program = codec.fromWords(words.slice(1));
      const script = Buffer.concat([Buffer.of(version ? 0x51 : 0, program.length), program]).toString("hex");
      if (supported(script) && witnessAddressFromScript(script, hrp) === text) result = script;
    } catch { /* Try only the other supported checksum/version, never a fallback network. */ }
  }
  check(result !== undefined); return result;
}
