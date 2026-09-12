// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Fixed Borsh layouts for bridge-owned instructions/accounts, mirrored by
// bridge-messages/src/abi.rs. Solana/SPL consensus formats are not redefined.
import { serialize, deserialize } from "borsh";
import { MESSAGE_LENGTH } from "./canonical-message.mjs";
const bytes = len => ({ array: { type: "u8", len } });
const h = bytes(32), struct = fields => ({ struct: fields });
const binding = struct({ environment: "u8", managerProgramId: h, transceiverProgramId: h,
  solanaDeployment: h, mint: h, tokenProgramId: h, mintAuthorityPda: h, decimals: "u8", nativeDecimals: "u8" });
const policy = struct({ policyEpoch: "u32", keyEpoch: "u32", depositsPaused: "bool",
  withdrawalsPaused: "bool", hardStop: "bool", mainnetActivationEnabled: "bool" });
const config = struct({ binding, freezeTag: "u8", freezeKey: h, initialSupply: "u128", policy });
const destination = struct({ length: "u16", padded: bytes(128) });
const burn = struct({ tokenProgramId: h, mint: h, authority: h, amountAtomic: "u64", decimals: "u8" });
const transceiver = struct({ transceiverProgramId: h, managerProgramId: h, mint: h,
  solanaDeployment: h, protocolId: "u32", nativeNetwork: "u32", nativeGenesis: h,
  authorizedAttesters: { array: { type: h, len: 2 } }, active: "bool", keyEpoch: "u32" });
const header = { magic: bytes(8), version: "u8" };
export const BRIDGE_ABI_SCHEMAS = Object.freeze({
  BridgeConfig: [config, 256],
  BridgeInitialize: [struct({ tag: "u8", binding, policy }), 208],
  BridgeState: [struct({ ...header, state: "u8", config, mintedSupply: "u128", burnedUnpaidWithdrawals: "u128" }), 298],
  DepositClaim: [struct({ ...header, operationId: h, messageDigest: h, amountAtomic: "u64", recipient: destination }), 211],
  WithdrawalRecord: [struct({ ...header, withdrawalId: h, operationId: h, messageDigest: h,
    grossAmountAtomic: "u64", feeAtomic: "u64", nativeDestination: destination, burnAuthority: h }), 283],
  DepositBacking: [struct({ ...header, operationId: h, messageDigest: h }), 73],
  BurnChecked: [burn, 105],
  AcceptDepositClaim: [struct({ tag: "u8", message: bytes(MESSAGE_LENGTH) }), 1 + MESSAGE_LENGTH],
  RecordWithdrawal: [struct({ tag: "u8", message: bytes(MESSAGE_LENGTH), burn }), 1 + MESSAGE_LENGTH + 105],
  TransceiverConfig: [transceiver, 237],
  TransceiverInitialize: [struct({ tag: "u8", config: transceiver }), 238],
  TransceiverState: [struct({ ...header, config: transceiver }), 246],
  VerifyMessage: [struct({ tag: "u8", message: bytes(MESSAGE_LENGTH),
    ed25519InstructionIndexes: { array: { type: "u16", len: 2 } } }), 1 + MESSAGE_LENGTH + 4],
  VerifiedReceipt: [struct({ ...header, messageDigest: h, operationId: h, transceiverProgramId: h,
    managerProgramId: h, mint: h, direction: "u8", action: "u8", keyEpoch: "u32",
    attesters: { array: { type: h, len: 2 } }, consumed: "bool" }), 240],
});

// borsh-js's numeric writes can truncate; reject before serialization. All ABI
// arrays have fixed bounds, so untrusted lengths cannot cause allocations.
function checked(schema, value) {
  if (typeof schema === "string") {
    if (schema === "bool") {
      if (typeof value !== "boolean") throw Error("BridgeAbiInvalidBoolean");
      return value;
    }
    const width = Number(schema.slice(1));
    if (width <= 32) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** width - 1) throw Error("BridgeAbiIntegerRange");
      return value;
    }
    if (typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/u.test(value)) value = BigInt(value);
    if (typeof value !== "bigint" || value < 0n || value >= 1n << BigInt(width)) throw Error("BridgeAbiIntegerRange");
    return value;
  }
  if (schema.array) {
    if (!(Array.isArray(value) || value instanceof Uint8Array) || value.length !== schema.array.len) throw Error("BridgeAbiArrayLength");
    return Array.from(value, item => checked(schema.array.type, item));
  }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== Object.keys(schema.struct).sort().join()) throw Error("BridgeAbiFields");
  return Object.fromEntries(Object.entries(schema.struct).map(([name, type]) => [name, checked(type, value[name])]));
}
export function encodeBridgeAbi(name, value) {
  const definition = BRIDGE_ABI_SCHEMAS[name];
  if (!definition) throw Error("BridgeAbiUnknownType");
  const [schema, length] = definition, result = Buffer.from(serialize(schema, checked(schema, value)));
  if (result.length !== length) throw Error("BridgeAbiLength");
  return result;
}
export function decodeBridgeAbi(name, input) {
  const definition = BRIDGE_ABI_SCHEMAS[name];
  if (!definition || !(input instanceof Uint8Array) || input.length !== definition[1]) throw Error("BridgeAbiLength");
  const result = deserialize(definition[0], input);
  // Reject trailing data and noncanonical booleans (borsh-js decodes any
  // nonzero bool as true). Semantic domain/authority checks remain at callers.
  if (!encodeBridgeAbi(name, result).equals(Buffer.from(input))) throw Error("BridgeAbiNonCanonical");
  return result;
}
export function paddedDestination(value) {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > 128) throw Error("BridgeAbiDestination");
  const padded = new Uint8Array(128); padded.set(value);
  return { length: value.length, padded };
}
