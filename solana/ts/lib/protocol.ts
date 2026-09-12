// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Typed SDK facade over the one runtime Borsh codec; no second encoder.
import * as protocol from "../../../shared/protocol/canonical-message.mjs";
export {
  PROTOCOL_MAGIC, MESSAGE_VERSION, DEPLOYMENT_IDENTITY_LENGTH,
  NATIVE_OUTPOINT_LENGTH, MAX_DESTINATION_LENGTH, MESSAGE_LENGTH,
  CANONICAL_MESSAGE_SCHEMA, OPERATION_ID_SCHEMA, hexToBytes, bytesToHex,
} from "../../../shared/protocol/canonical-message.mjs";

export type BridgeDirection = "NativeToSolana" | "SolanaToNative";
export type BridgeAction = "DepositClaim" | "WithdrawalRequest";

export interface DeploymentIdentity {
  protocolId: number;
  nativeNetwork: number;
  nativeGenesis: Uint8Array;
  solanaDeployment: Uint8Array;
  managerProgramId: Uint8Array;
  transceiverProgramId: Uint8Array;
  mint: Uint8Array;
}

export interface NativeOutpoint {
  txid: Uint8Array;
  vout: number;
}

export interface CanonicalBridgeMessage {
  version: number;
  action: BridgeAction;
  direction: BridgeDirection;
  deployment: DeploymentIdentity;
  operationId?: Uint8Array;
  depositOutpoint: NativeOutpoint;
  withdrawalId: Uint8Array;
  amountAtomic: bigint;
  feeAtomic: bigint;
  destination: Uint8Array;
  policyEpoch: number;
  keyEpoch: number;
  nonce: Uint8Array;
  validFrom: bigint;
  validUntil: bigint;
  evidenceDigest: Uint8Array;
}

export function encodeCanonicalBridgeMessage(input: CanonicalBridgeMessage): Uint8Array {
  return protocol.encodeCanonicalBridgeMessage(input);
}

export function decodeCanonicalBridgeMessage(input: Uint8Array): CanonicalBridgeMessage {
  return protocol.decodeCanonicalBridgeMessage(input);
}

export function encodeOperationIdInputs(input: CanonicalBridgeMessage): Uint8Array {
  return protocol.encodeOperationIdInputs(input);
}

export function deriveOperationId(input: CanonicalBridgeMessage): Uint8Array {
  return protocol.deriveOperationId(input);
}

export function messageDigest(input: CanonicalBridgeMessage): Uint8Array {
  return protocol.hexToBytes(protocol.messageDigestHex(encodeCanonicalBridgeMessage(input)));
}
