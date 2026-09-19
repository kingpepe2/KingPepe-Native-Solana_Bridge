// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Offline instruction only. No key access, signature, submission or public API.
import { assertMainnetDeploymentFields } from "../../../shared/network-identity.mjs";
import { encodeBridgeAbi } from "../../../shared/protocol/solana-bridge-abi.mjs";
import { base58Encode, findProgramAddress } from "../../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";

export function createMainnetModeInstruction({ deployment, mode }) {
  assertMainnetDeploymentFields(deployment);
  const modes = new Map([["PAUSED", 0], ["CONTROLLED", 1], ["ACTIVE", 2]]);
  if (!modes.has(mode)) throw new Error("MainnetProcessingModeRejected");
  const manager = Buffer.from(deployment.managerProgramId, "hex"), mint = Buffer.from(deployment.mint, "hex");
  return { program: base58Encode(manager), accounts: [
    { key: findProgramAddress([Buffer.from("kingpepe-bridge-state"), mint], manager).base58, writable: true, signer: false },
    { key: base58Encode(mint), writable: false, signer: true },
  ], data: encodeBridgeAbi("MainnetMode", { tag: 4, mode: modes.get(mode) }) };
}
