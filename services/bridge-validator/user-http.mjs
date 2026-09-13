// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Optional loopback listener in the SAME service process, no extra journal.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { BridgeUserApi } from "./user-api.mjs";

function appAssets() {
  const file = (name, type) => [readFileSync(new URL(name, import.meta.url)), type];
  const vendor = (name, entry, type = "text/javascript; charset=utf-8") => [readFileSync(new URL(name, import.meta.resolve(entry))), type];
  // Exact static allowlist, never a filesystem path derived from a request.
  return new Map([
    ["/", file("../../app/index.html", "text/html; charset=utf-8")],
    ...["bridge.mjs", "model.mjs"].map(name => ["/app/" + name, file("../../app/" + name, "text/javascript; charset=utf-8")]),
    ["/app/style.css", file("../../app/style.css", "text/css; charset=utf-8")],
    ["/sdk/client.mjs", file("../../solana/ts/sdk/client.mjs", "text/javascript; charset=utf-8")],
    ["/vendor/scure-base.js", vendor("index.js", "@scure/base")],
    ["/vendor/wallet-standard/wallets.js", vendor("wallets.js", "@wallet-standard/app")],
    ["/licenses/scure-base", vendor("LICENSE", "@scure/base", "text/plain; charset=utf-8")],
    ["/licenses/wallet-standard", vendor("../../LICENSE", "@wallet-standard/app", "text/plain; charset=utf-8")],
    ["/notices", file("../../THIRD_PARTY_NOTICES.md", "text/plain; charset=utf-8")],
    ["/license", file("../../LICENSE", "text/plain; charset=utf-8")],
  ]);
}

export async function listenBridgeUserApi({ api, accessToken, port = 0 }) {
  if (!(api instanceof BridgeUserApi) || !(accessToken instanceof Uint8Array) || accessToken.length !== 32 || !accessToken.some(v => v !== 0) ||
      !Number.isInteger(port) || port < 0 || port > 65535) throw new Error("BridgeUserListenerConfigurationRejected");
  // Token is supplied by local protected configuration (or isolated test state),
  // never a URL/query value, log entry, Git value or a FROST signing credential.
  const expected = Buffer.from("Bearer " + Buffer.from(accessToken).toString("hex"));
  const assets = appAssets();
  let active = 0;
  const server = createServer({ maxHeaderSize: 4096, headersTimeout: 10000, requestTimeout: 15000 }, async (req, res) => {
    const reply = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      const text = JSON.stringify(value);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(text);
    };
    try {
      const host = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== host || req.headers.origin && req.headers.origin !== `http://${host}`) return reply(403, { error: "ACCESS_DENIED" });
      // Static public introduction/interface contains no credential or runtime
      // state. Every API route still requires the separate user-access token.
      if (req.method === "GET" && req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
      if (req.method === "GET" && assets.has(req.url)) {
        const [body, type] = assets.get(req.url);
        res.writeHead(200, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin",
          "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
        res.end(body); return;
      }
      if (req.headersDistinct.authorization?.length !== 1) return reply(403, { error: "ACCESS_DENIED" });
      const given = Buffer.from(req.headers.authorization ?? "");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply(403, { error: "ACCESS_DENIED" });
      if (active >= 4) return reply(429, { error: "RETRY_LATER" });
      active++;
      try {
        if (req.method === "GET" && req.url === "/bridge/status") return reply(200, api.getBridgeStatus());
        const match = /^\/(operations|deposits|withdrawals)\/([0-9a-f]{64})$/u.exec(req.url);
        if (req.method === "GET" && match) {
          const method = { operations: "getOperationStatus", deposits: "getDepositStatus", withdrawals: "getWithdrawalStatus" }[match[1]];
          const value = api[method](match[2]); return reply(value ? 200 : 404, value ?? { error: "OPERATION_NOT_FOUND" });
        }
        const routes = { "/deposits/request": "createNativeDepositRequest", "/deposits/submit": "submitNativeDeposit",
          "/withdrawals/request": "createSolanaWithdrawal", "/withdrawals/submit": "submitSolanaWithdrawal" };
        if (req.method !== "POST" || !Object.hasOwn(routes, req.url)) return reply(404, { error: "ROUTE_NOT_FOUND" });
        if (!/^application\/json(?:; charset=utf-8)?$/u.test(req.headers["content-type"] ?? "")) return reply(415, { error: "JSON_REQUIRED" });
        let size = 0; const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) { reply(413, { error: "REQUEST_TOO_LARGE" }); req.resume(); return; }
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks), text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const result = await api[routes[req.url]](JSON.parse(text)); reply(200, result);
      } finally { active--; }
    } catch {
      // Do not serialize arbitrary exception text: RPC/storage errors can carry
      // private configuration. Unknown outcome is not automatic resubmission.
      reply(400, { error: "REQUEST_REJECTED_OR_DEPENDENCY_UNAVAILABLE" });
    }
  });
  server.keepAliveTimeout = 1000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  server.once("close", () => expected.fill(0));
  return server;
}
