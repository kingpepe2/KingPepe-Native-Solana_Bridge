// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// The gateway's connection to the private Bridge. It was loaded once at startup,
// and a start during which the Bridge did not answer left the public Bridge API
// unavailable until the next restart. It is now loaded again, with increasing
// pauses, until it succeeds. Loading is the existing loader, unchanged: it reads
// configuration and the access token and performs one authenticated read. It
// changes nothing in the Bridge and submits nothing.
export const RETRY_FIRST_MS = 5_000, RETRY_LIMIT_MS = 60_000, LOAD_LIMIT_MS = 30_000;

export function createBridgeConnection({ load, now = Date.now, schedule = (task, ms) => { const timer = setTimeout(task, ms); timer.unref?.(); return timer; },
  report = () => {}, firstDelayMs = RETRY_FIRST_MS, limitDelayMs = RETRY_LIMIT_MS, loadLimitMs = LOAD_LIMIT_MS } = {}) {
  if (typeof load !== 'function' || !(firstDelayMs >= 1000) || !(limitDelayMs >= firstDelayMs) || !(loadLimitMs >= 1000)) throw new Error('BridgeConnectionOptionsRejected');
  let connection = null, state = 'CONNECTING', attempts = 0, failures = 0, inFlight = null, nextAttemptAt = null, connectedAt = null, lastFailureAt = null;
  function attempt() {
    // One attempt at a time, and never more than one scheduled.
    if (inFlight || state === 'CONNECTED' || state === 'NOT_CONFIGURED') return inFlight;
    attempts++; nextAttemptAt = null;
    let timer;
    inFlight = Promise.race([Promise.resolve().then(load), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('BridgeConnectionTimeout')), loadLimitMs); timer.unref?.(); })])
      .then(value => {
        // No configuration is not a failure: this deployment has no Bridge, and asking again changes nothing.
        if (value === null || value === undefined) { state = 'NOT_CONFIGURED'; connection = null; return; }
        connection = value; state = 'CONNECTED'; connectedAt = now();
        report({ event: 'BRIDGE_GATEWAY_CONNECTED', attempts, afterFailures: failures }); failures = 0;
      }, () => {
        failures++; lastFailureAt = now(); state = 'RETRYING'; connection = null;
        // 5 s, 10 s, 20 s, 40 s, then every 60 s. Never sooner, never in a loop.
        const delay = Math.min(limitDelayMs, firstDelayMs * 2 ** Math.min(failures - 1, 16));
        nextAttemptAt = now() + delay;
        report({ event: 'BRIDGE_GATEWAY_CONNECTION_FAILED', attempts, failures, retryInMs: delay });
        schedule(() => { void attempt(); }, delay);
      })
      .finally(() => { clearTimeout(timer); inFlight = null; });
    return inFlight;
  }
  const first = attempt();
  return {
    // What the gateway asks for on every request. The first attempt is waited
    // for, as it always was. Afterwards a request is never held up by a retry:
    // it gets the connection, or learns at once that there is none.
    async backend() { if (attempts === 1 && inFlight === first && first) await first; return connection; },
    status: () => ({ state, attempts, failures, connectedAt, lastFailureAt, nextAttemptAt }),
  };
}
