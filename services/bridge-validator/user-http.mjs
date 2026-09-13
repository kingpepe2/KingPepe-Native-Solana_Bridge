// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Optional loopback listener in the SAME service process, no extra journal.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { BridgeUserApi } from "./user-api.mjs";

export async function listenBridgeUserApi({ api, accessToken, port = 0 }) {
  if (!(api instanceof BridgeUserApi) || !(accessToken instanceof Uint8Array) || accessToken.length !== 32 || !accessToken.some(v => v !== 0) ||
      !Number.isInteger(port) || port < 0 || port > 65535) throw new Error("BridgeUserListenerConfigurationRejected");
  // Token is supplied by local protected configuration (or isolated test state),
  // never a URL/query value, log entry, Git value or a FROST signing credential.
  const expected = Buffer.from("Bearer " + Buffer.from(accessToken).toString("hex"));
  let active = 0;
  const server = createServer({ maxHeaderSize: 4096, headersTimeout: 10000, requestTimeout: 15000 }, async (req, res) => {
    const reply = (status, value) => {
      if (res.destroyed || res.writableEnded) return;
      const text = JSON.stringify(value);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(text);
    };
    try {
      const host = `127.0.0.1:${server.address()?.port}`;
      if (req.headers.host !== host || req.headers.origin && req.headers.origin !== `http://${host}` ||
          req.headersDistinct.authorization?.length !== 1) return reply(403, { error: "ACCESS_DENIED" });
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
