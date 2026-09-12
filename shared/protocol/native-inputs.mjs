// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Bridge-owned Native hash preimages, not Native consensus serialization.
import { serialize } from "borsh";
const h = { array: { type: "u8", len: 32 } };
export const NATIVE_INPUT_SCHEMAS = Object.freeze({
  DepositIntent: { struct: { magic: { array: { type: "u8", len: 8 } },
    nativeGenesisHex: h, solanaDeploymentHex: h, managerProgramIdHex: h,
    transceiverProgramIdHex: h, mintHex: h, recipientHex: h, nonceHex: h,
    amountAtomic: "u64", protocolId: "u32", nativeNetwork: "u32", policyEpoch: "u32", keyEpoch: "u32" } },
  DepositEvidence: { struct: { transaction: { array: { type: "u8" } }, blockHash: h,
    outputIndex: "u32", amountAtomic: "u64" } },
  ReserveAllocation: { struct: { depositTxid: h, depositVout: "u32", sweepTxid: h,
    reserveVout: "u32", amountAtomic: "u64" } },
});
export function encodeNativeInput(name, input) {
  const schema = NATIVE_INPUT_SCHEMAS[name];
  if (!schema || !input || Object.keys(input).sort().join() !== Object.keys(schema.struct).sort().join()) throw Error("NativeInputFields");
  const value = {};
  for (const [field, type] of Object.entries(schema.struct)) {
    let item = input[field];
    if (type.array) {
      if (typeof item === "string" && /^(?:[0-9a-f]{2})*$/u.test(item)) item = Buffer.from(item, "hex");
      if (!(item instanceof Uint8Array) || (type.array.len !== undefined ? item.length !== type.array.len : item.length > 4_000_000)) throw Error("NativeInputBytes");
      value[field] = Array.from(item);
    } else if (type === "u64") {
      if (typeof item === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(item)) item = BigInt(item);
      if (typeof item !== "bigint" || item < 0n || item > 0xffffffffffffffffn) throw Error("NativeInputAmount");
      value[field] = item;
    } else {
      if (!Number.isSafeInteger(item) || item < 0 || item > 0xffffffff) throw Error("NativeInputInteger");
      value[field] = item;
    }
  }
  if (name === "DepositIntent" && Buffer.from(value.magic).toString("hex") !== "4b5044494e543031") throw Error("NativeInputDomain");
  return Buffer.from(serialize(schema, value));
}
