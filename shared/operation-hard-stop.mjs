// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { isDeepStrictEqual } from "node:util";

// An integrity stop is absorbing. This protects cooperating journal users;
// it is not storage authentication, cross-process fencing or rollback proof.
export function readOperationHardStop(state, decision) {
  if (state !== "HARD_STOP" && decision?.state !== "HARD_STOP") return undefined;
  if (state !== "HARD_STOP" || decision?.state !== "HARD_STOP" ||
      typeof decision.reason !== "string" || decision.reason.length === 0) {
    throw new Error("OperationHardStopRecordInvalid");
  }
  return structuredClone(decision);
}

// Returns true only for an exact, idempotent repeat of the original stop.
// Every other attempted write after a stop fails without changing its reason.
export function preserveOperationHardStop(state, decision, proposed = undefined) {
  const stopped = readOperationHardStop(state, decision);
  if (stopped === undefined) return false;
  if (isDeepStrictEqual(stopped, proposed)) return true;
  throw new Error("OperationHardStopActive");
}
