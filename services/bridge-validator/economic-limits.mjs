// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit service policy projected from the existing authenticated journal.
// Pending authorizations carry into later windows until observed settlement.
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";

const check = (value, code = "EconomicLimitsRejected") => { if (!value) throw new Error(code); };
const fields = (value, expected) => check(value && !Array.isArray(value) &&
  Object.keys(value).sort().join() === expected.split(",").sort().join());
const amount = value => {
  check(typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 0xffffffffffffffffn);
  return BigInt(value);
};
const time = value => check(Number.isSafeInteger(value) && value >= 0);
const direction = value => check(value === "MINT");
const id = value => check(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value));
const key = (kind, operationId) => kind + ":" + operationId;

export function validateEconomicLimits(input) {
  if (input?.scope === "MAINNET") {
    fields(input, "scope,productionLimitPolicy,windowDuration,maxMintPerTransfer,maxMintPerWindow");
    check(input.productionLimitPolicy === "UNBOUNDED_BY_TEAM_DECISION" && input.windowDuration === "NOT_APPLICABLE");
    for (const name of ["maxMintPerTransfer", "maxMintPerWindow"]) check(input[name] === "UNBOUNDED");
    return Object.freeze({ ...input });
  }
  fields(input, "scope,windowSeconds,maxMintPerTransfer,maxMintPerWindow");
  check(input.scope === "TEST_ONLY");
  check(Number.isSafeInteger(input.windowSeconds) && input.windowSeconds >= 1 && input.windowSeconds <= 86400);
  check(amount(input.maxMintPerTransfer) <= amount(input.maxMintPerWindow));
  return Object.freeze({ ...input });
}

export function checkEconomicTransfer(policy, kind, value) {
  direction(kind);
  if (policy.scope === "MAINNET") { validateEconomicLimits(policy); amount(value); return; }
  check(amount(value) <= amount(policy.maxMintPerTransfer), "EconomicTransferLimitExceeded");
}

export function economicLimitUsage(state, timestampMs) {
  time(timestampMs); check(timestampMs >= state.lastTimestampMs, "EconomicLimitClockRegression");
  const unbounded = state.policy.scope === "MAINNET";
  const window = unbounded ? null : Math.floor(timestampMs / (state.policy.windowSeconds * 1000));
  const used = { MINT: 0n };
  for (const record of state.records.values()) {
    if (record.settledAtMs === null || !unbounded && Math.floor(record.settledAtMs / (state.policy.windowSeconds * 1000)) === window)
      used[record.direction] += BigInt(record.amountAtomic);
  }
  return { window, mintAtomic: used.MINT.toString() };
}

export function reduceEconomicLimitEvent(previous, event) {
  if (event.action === "LIMIT_CONFIG") {
    fields(event, "action,policy,timestampMs"); time(event.timestampMs);
    const policy = validateEconomicLimits(event.policy);
    if (previous) { check(canonicalJson(previous.policy) === canonicalJson(policy), "EconomicLimitPolicyChanged"); return { state: previous, unchanged: true }; }
    return { state: { policy, lastTimestampMs: event.timestampMs, records: new Map(), breach: null }, unchanged: false };
  }
  check(previous !== null && previous !== undefined, "EconomicLimitsRequired");
  time(event.timestampMs);
  const usage = economicLimitUsage(previous, event.timestampMs);
  const next = { ...previous, lastTimestampMs: event.timestampMs, records: new Map(previous.records) };
  const room = (kind, value) => previous.policy.scope === "MAINNET" || BigInt(usage.mintAtomic) + amount(value) <=
    amount(previous.policy.maxMintPerWindow);
  if (event.action === "LIMIT_REVIEW") {
    fields(event, "action,timestampMs");
    if (!previous.breach) return { state: previous, unchanged: true };
    // A later window permits explicit review so earlier reserved work can
    // finish. Reservations still carry forward; a new excess pauses again.
    check(usage.window > previous.breach.window || room(previous.breach.direction, previous.breach.amountAtomic), "EconomicWindowStillExhausted");
    next.breach = null; return { state: next, unchanged: false };
  }
  fields(event, "action,direction,operationId,amountAtomic,timestampMs");
  direction(event.direction); id(event.operationId); checkEconomicTransfer(previous.policy, event.direction, event.amountAtomic);
  const recordKey = key(event.direction, event.operationId), old = previous.records.get(recordKey);
  if (old) check(old.amountAtomic === event.amountAtomic, "EconomicLimitOperationChanged");
  if (event.action === "LIMIT_SETTLE") {
    check(old !== undefined, "EconomicLimitReservationMissing");
    if (old.settledAtMs !== null) return { state: previous, unchanged: true };
    next.records.set(recordKey, { ...old, settledAtMs: event.timestampMs });
    return { state: next, unchanged: false };
  }
  check(event.action === "LIMIT_RESERVE");
  if (old) return { state: previous, unchanged: true };
  check(previous.breach === null, "EconomicLimitReviewRequired");
  if (!room(event.direction, event.amountAtomic)) {
    next.breach = { direction: event.direction, operationId: event.operationId, amountAtomic: event.amountAtomic, window: usage.window };
    return { state: next, unchanged: false, pauseReason: event.direction + "_WINDOW_LIMIT" };
  }
  check(previous.records.size < 256, "EconomicLimitCapacity");
  next.records.set(recordKey, { direction: event.direction, operationId: event.operationId,
    amountAtomic: event.amountAtomic, authorizedAtMs: event.timestampMs, settledAtMs: null });
  return { state: next, unchanged: false };
}
