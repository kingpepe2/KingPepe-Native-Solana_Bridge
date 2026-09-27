// Security middleware for the public API: per-IP rate limiting, CORS, secure headers,
// strict input validation, response-size limits, and request timeouts. No secrets ever
// leave the server; only read-only, allowlisted endpoints are reachable.

import { SECURITY } from './config.js';

// ---- client IP (behind Cloudflare Tunnel, the real client is CF-Connecting-IP) ----
export function clientIP(req) {
  if (SECURITY.trustCloudflareIP) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ---- per-IP token-bucket rate limiter ----
const buckets = new Map(); // ip -> { tokens, last }
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (now - b.last > SECURITY.rateWindowMs * 5) buckets.delete(ip);
}, SECURITY.rateWindowMs).unref?.();

export function rateLimit(req) {
  const ip = clientIP(req);
  const now = Date.now();
  const ratePerMs = SECURITY.rateMax / SECURITY.rateWindowMs;
  let b = buckets.get(ip);
  if (!b) { b = { tokens: SECURITY.burst + SECURITY.rateMax, last: now }; buckets.set(ip, b); }
  b.tokens = Math.min(SECURITY.burst + SECURITY.rateMax, b.tokens + (now - b.last) * ratePerMs);
  b.last = now;
  if (b.tokens < 1) return { ok: false, retryAfter: Math.ceil((1 - b.tokens) / ratePerMs / 1000) };
  b.tokens -= 1;
  return { ok: true };
}

// ---- CORS + secure headers ----
export function applyCommonHeaders(req, res, { html = false } = {}) {
  const origin = req.headers.origin;
  const allow = SECURITY.corsAllowOrigins;
  if (allow.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Content-Security-Policy', html
    ? "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    : "default-src 'none'; frame-ancestors 'none'");
}

// ---- responses (size-limited) ----
export function sendJson(res, code, obj, { cacheSeconds = 0 } = {}) {
  let body;
  try { body = JSON.stringify(obj); } catch { body = '{"error":true,"message":"serialization"}'; code = 500; }
  if (Buffer.byteLength(body) > SECURITY.maxResponseBytes) {
    body = JSON.stringify({ error: true, message: 'Response too large; narrow your query.' });
    code = 413;
  }
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
  });
  res.end(body);
}

export function sendError(res, code, message, extra = {}) {
  sendJson(res, code, { error: true, message, ...extra });
}

// ---- strict validators (KingPepe-specific; NOT Bitcoin) ----
export const Validate = {
  hash64: (s) => typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s),
  height: (s) => /^\d{1,9}$/.test(String(s)) && Number(s) <= 100_000_000,
  // Syntactic pre-check only; the node's validateaddress is authoritative in the handler.
  addressSyntax: (s) =>
    typeof s === 'string' && s.length <= 100 &&
    (/^kpepe1[02-9ac-hj-np-z]{6,90}$/i.test(s) || /^[13-9A-HJ-NP-Za-km-z]{20,40}$/.test(s)),
  page: (s) => {
    const n = Math.max(0, parseInt(s ?? '0', 10) || 0);
    return Number.isFinite(n) ? Math.min(n, 100000) : 0;
  },
  limit: (s) => {
    const n = parseInt(s ?? String(SECURITY.defaultPageSize), 10) || SECURITY.defaultPageSize;
    return Math.min(Math.max(1, n), SECURITY.maxPageSize);
  },
};

// ---- guard wrapper: preflight, rate limit, timeout, error mapping ----
export function guard(handler, { html = false } = {}) {
  return async (req, res, params) => {
    applyCommonHeaders(req, res, { html });
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET') { sendError(res, 405, 'Method not allowed'); return; }
    const rl = rateLimit(req);
    if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter || 1)); sendError(res, 429, 'Rate limit exceeded'); return; }

    const timer = setTimeout(() => {
      if (!res.headersSent) sendError(res, 504, 'Upstream timeout');
    }, SECURITY.requestTimeoutMs);
    try {
      await handler(req, res, params);
    } catch (e) {
      if (!res.headersSent) {
        const kind = e && e.kind;
        const code = kind === 'auth' ? 502 : kind === 'network' ? 503 : kind === 'timeout' ? 504 : 500;
        sendError(res, code, publicMessage(e));
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

// Never leak internal detail/secrets in error messages.
function publicMessage(e) {
  const kind = e && e.kind;
  if (kind === 'network') return 'Node temporarily unavailable.';
  if (kind === 'auth') return 'Backend node authentication error.';
  if (kind === 'timeout') return 'Upstream timeout.';
  return 'Request failed.';
}
