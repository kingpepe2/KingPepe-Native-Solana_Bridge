// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Admission freshness, NOT a blockchain proof, transfer approval or stop reset.
import { randomBytes } from "node:crypto";

export const SOURCE_HEALTH_PROTOCOL = "KINGPEPE_SOURCE_HEALTH_V1";
export const SOURCE_HEALTH_ROLES = Object.freeze(["NATIVE_OBSERVER", "SOLANA_OBSERVER", "RECONCILIATION"]);
export const SOURCE_HEALTH_WINDOW_MS = 30000; // Fixed localnet service bound, not production finality policy.
const HASH = /^[0-9a-f]{64}$/u;
function requireValue(value, code = "SourceHealthRejected") { if (!value) throw new Error(code); }
function fields(value, keys) { requireValue(value && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join()); }

// Each authority incarnation starts EMPTY. Old health observations are never
// restored from disk. At most three challenges and three results are retained.
export class SourceHealthWindow {
  #generation; #clock; #lastTime; #pending = new Map(); #healthy = new Map();
  constructor({ generation, clock = Date.now }) {
    requireValue(typeof generation === "string" && /^[1-9][0-9]{0,19}$/u.test(generation) && BigInt(generation) <= 0xffff_ffff_ffff_ffffn);
    requireValue(typeof clock === "function"); this.#generation = generation; this.#clock = clock; this.#now();
  }
  #now() {
    const now = this.#clock();
    requireValue(Number.isSafeInteger(now) && now > 0 && now <= Number.MAX_SAFE_INTEGER - SOURCE_HEALTH_WINDOW_MS &&
      (this.#lastTime === undefined || now >= this.#lastTime), "SourceHealthClockRollback");
    this.#lastTime = now; return now;
  }
  #binding(role, operationId) { requireValue(SOURCE_HEALTH_ROLES.includes(role) && typeof operationId === "string" && HASH.test(operationId), "SourceHealthRoleRejected"); }
  begin(role, operationId) {
    this.#binding(role, operationId); const now = this.#now();
    const ticket = Object.freeze({ protocol: SOURCE_HEALTH_PROTOCOL, generation: this.#generation,
      challenge: randomBytes(32).toString("hex"), issuedAtMs: now, deadlineMs: now + SOURCE_HEALTH_WINDOW_MS });
    // A pending poll does not renew the last verified result's deadline. Keeping
    // its still-fresh lease avoids starving signing during periodic observation.
    // An unavailable result revokes it immediately; silence expires it naturally.
    this.#pending.set(role, { operationId, ticket }); return ticket;
  }
  finish(role, operationId, payload) {
    this.#binding(role, operationId); fields(payload, ["generation", "challenge", "state", "evidenceDigest"]);
    requireValue(["OBSERVED_MATCH", "WAITING_FOR_DEPENDENCY"].includes(payload.state) && typeof payload.evidenceDigest === "string" && HASH.test(payload.evidenceDigest));
    const pending = this.#pending.get(role), now = this.#now();
    requireValue(pending && pending.operationId === operationId && payload.generation === this.#generation && payload.challenge === pending.ticket.challenge, "SourceHealthChallengeRejected");
    this.#pending.delete(role); this.#healthy.delete(role);
    requireValue(now < pending.ticket.deadlineMs, "SourceHealthExpired");
    if (payload.state === "OBSERVED_MATCH") this.#healthy.set(role, { deadlineMs: pending.ticket.deadlineMs, evidenceDigest: payload.evidenceDigest });
  }
  missing() {
    const now = this.#now();
    return Object.freeze(SOURCE_HEALTH_ROLES.filter(role => !this.#healthy.has(role) || now >= this.#healthy.get(role).deadlineMs));
  }
}
