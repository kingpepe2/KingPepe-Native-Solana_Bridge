// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Service assertions are not chain consensus. Only an authenticated authorized
// detector may report a confirmed contradiction; missing evidence is a wait.
export const INTEGRITY_PROTOCOL = "KINGPEPE_GLOBAL_INTEGRITY_V1";
export const INTEGRITY_ROLES = Object.freeze([
  "KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "COORDINATOR", "ATTESTER_A", "ATTESTER_B",
  "BRIDGE_VALIDATOR", "NATIVE_OBSERVER", "SOLANA_OBSERVER", "RELAYER", "RECONCILIATION", "INDEXER",
]);
const permissions = {
  KINGPEPE_FROST_A: ["FROST_SIGN"], KINGPEPE_FROST_B: ["FROST_SIGN"],
  COORDINATOR: ["COORDINATE_SWEEP"], ATTESTER_A: ["ATTEST_MINT_CREDIT"], ATTESTER_B: ["ATTEST_MINT_CREDIT"],
  BRIDGE_VALIDATOR: ["AUTHORIZE_SWEEP", "AUTHORIZE_CREDIT", "AUTHORIZE_CLAIM"],
  RELAYER: ["BROADCAST_SWEEP", "SUBMIT_CLAIM"], NATIVE_OBSERVER: [], SOLANA_OBSERVER: [], RECONCILIATION: [], INDEXER: [],
};
const reports = {
  KINGPEPE_FROST_A: ["SIGNER_ROLLBACK", "SIGNER_STATE_CORRUPT"], KINGPEPE_FROST_B: ["SIGNER_ROLLBACK", "SIGNER_STATE_CORRUPT"],
  COORDINATOR: ["SIGNING_TRANSCRIPT_CONFLICT"], ATTESTER_A: ["CONFLICTING_RESERVE_EVIDENCE"], ATTESTER_B: ["CONFLICTING_RESERVE_EVIDENCE"],
  BRIDGE_VALIDATOR: ["IMPOSSIBLE_OPERATION_STATE"], NATIVE_OBSERVER: ["NATIVE_DEEP_REORG", "NATIVE_GENESIS_CHANGED", "FINALIZED_NATIVE_CONFLICT", "NATIVE_PROGRESS_INTEGRITY"],
  SOLANA_OBSERVER: ["SOLANA_GENESIS_CHANGED", "SOLANA_DEPLOYMENT_CHANGED", "FINALIZED_SOLANA_CONFLICT", "SOLANA_PROGRESS_INTEGRITY"],
  RELAYER: ["CONFLICTING_BROADCAST"], RECONCILIATION: ["CONFIRMED_RESERVE_DEFICIT", "JOURNAL_INTEGRITY_FAILURE"], INDEXER: [],
};
export function mayPerform(role, action) { return typeof action === "string" && permissions[role]?.includes(action) === true; }
export function mayReport(role, code) { return typeof code === "string" && reports[role]?.includes(code) === true; }
export const INTEGRITY_METHODS = Object.freeze(["integrityStatus", "assertRunning", "reportContradiction", "beginSourceCheck", "finishSourceCheck"]);
