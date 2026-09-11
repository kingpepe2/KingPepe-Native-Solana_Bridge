// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Pure admission-state tests; these fixtures are NOT evidence from either chain.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceHealthWindow, SOURCE_HEALTH_ROLES, SOURCE_HEALTH_WINDOW_MS } from "../../shared/source-health-window.mjs";
const operationId = "31".repeat(32), evidenceDigest = "42".repeat(32);
function fixture() { let now = 100000; const window = new SourceHealthWindow({ generation: "7", clock: () => now });
  return { window, setNow: value => { now = value; }, ready(role) { const t = window.begin(role, operationId); window.finish(role, operationId, payload(t)); return t; } }; }
const payload = (ticket, overrides = {}) => ({ generation: ticket.generation, challenge: ticket.challenge, state: "OBSERVED_MATCH", evidenceDigest, ...overrides });

test("source admission requires all three roles after every authority restart", () => {
  const f = fixture(); assert.deepEqual(f.window.missing(), SOURCE_HEALTH_ROLES);
  f.ready("NATIVE_OBSERVER"); f.ready("SOLANA_OBSERVER"); assert.deepEqual(f.window.missing(), ["RECONCILIATION"]);
  f.ready("RECONCILIATION"); assert.deepEqual(f.window.missing(), []);
  assert.deepEqual(new SourceHealthWindow({ generation: "8", clock: () => 100001 }).missing(), SOURCE_HEALTH_ROLES);
});
test("health expires from challenge issue, not delayed delivery", () => {
  const f = fixture(), tickets = SOURCE_HEALTH_ROLES.map(role => f.window.begin(role, operationId));
  f.setNow(100000 + SOURCE_HEALTH_WINDOW_MS - 1);
  SOURCE_HEALTH_ROLES.forEach((role, i) => f.window.finish(role, operationId, payload(tickets[i]))); assert.deepEqual(f.window.missing(), []);
  f.setNow(100000 + SOURCE_HEALTH_WINDOW_MS); assert.deepEqual(f.window.missing(), SOURCE_HEALTH_ROLES);
});
test("a pending poll cannot renew prior health and an unavailable result revokes it", () => {
  const f = fixture(); SOURCE_HEALTH_ROLES.forEach(role => f.ready(role));
  f.setNow(110000);
  const t = f.window.begin("SOLANA_OBSERVER", operationId); assert.deepEqual(f.window.missing(), []);
  f.window.finish("SOLANA_OBSERVER", operationId, payload(t, { state: "WAITING_FOR_DEPENDENCY" }));
  assert.deepEqual(f.window.missing(), ["SOLANA_OBSERVER"]); f.ready("SOLANA_OBSERVER"); assert.deepEqual(f.window.missing(), []);
  f.window.begin("NATIVE_OBSERVER", operationId); f.setNow(100000 + SOURCE_HEALTH_WINDOW_MS);
  assert(f.window.missing().includes("NATIVE_OBSERVER"), "PollingMustNotExtendACompletedObservation");
});
for (const change of ["role", "operation", "challenge", "generation", "extra field"]) test("source ticket rejects substituted " + change, () => {
  const f = fixture(), t = f.window.begin("NATIVE_OBSERVER", operationId), p = payload(t);
  if (change === "challenge") p.challenge = "00".repeat(32);
  if (change === "generation") p.generation = "6";
  if (change === "extra field") p.approved = true;
  assert.throws(() => f.window.finish(change === "role" ? "SOLANA_OBSERVER" : "NATIVE_OBSERVER", change === "operation" ? "ff".repeat(32) : operationId, p));
  assert.deepEqual(f.window.missing(), SOURCE_HEALTH_ROLES);
});
test("replay, superseded request and old incarnation cannot refresh health", () => {
  const f = fixture(), old = f.ready("NATIVE_OBSERVER");
  assert.throws(() => f.window.finish("NATIVE_OBSERVER", operationId, payload(old)));
  const next = f.window.begin("NATIVE_OBSERVER", operationId);
  assert.throws(() => f.window.finish("NATIVE_OBSERVER", operationId, payload(old)));
  const restarted = new SourceHealthWindow({ generation: "8", clock: () => 100001 }); restarted.begin("NATIVE_OBSERVER", operationId);
  assert.throws(() => restarted.finish("NATIVE_OBSERVER", operationId, payload(next)));
});
test("late source result is consumed without authorizing a transfer", () => {
  const f = fixture(), t = f.window.begin("NATIVE_OBSERVER", operationId); f.setNow(t.deadlineMs);
  assert.throws(() => f.window.finish("NATIVE_OBSERVER", operationId, payload(t)), /SourceHealthExpired/u);
  assert.throws(() => f.window.finish("NATIVE_OBSERVER", operationId, payload(t)), /SourceHealthChallengeRejected/u);
  assert.deepEqual(f.window.missing(), SOURCE_HEALTH_ROLES);
});
test("non-observer roles, invalid counters and invalid health states fail closed", () => {
  const f = fixture(); assert.throws(() => f.window.begin("RELAYER", operationId));
  for (const generation of ["0", "01", "-1", "18446744073709551616", 7]) assert.throws(() => new SourceHealthWindow({ generation }));
  const t = f.window.begin("NATIVE_OBSERVER", operationId);
  for (const state of [true, "TIMEOUT_APPROVED", "RUNNING", "HARD_STOP_INTEGRITY"]) assert.throws(() => f.window.finish("NATIVE_OBSERVER", operationId, payload(t, { state })));
});
test("backward clock movement never lengthens a health window", () => {
  const f = fixture(); SOURCE_HEALTH_ROLES.forEach(role => f.ready(role)); f.setNow(99999);
  assert.throws(() => f.window.missing(), /SourceHealthClockRollback/u);
  assert.throws(() => f.window.begin("NATIVE_OBSERVER", operationId), /SourceHealthClockRollback/u);
});
