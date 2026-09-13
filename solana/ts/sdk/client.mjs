// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// User-access transport only. No wallet key, arbitrary RPC or retry-broadcast API.
export function createBridgeClient({ endpoint, accessToken, fetchImpl = globalThis.fetch }) {
  const u = new URL(endpoint);
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.username || u.password || u.search || u.hash || u.pathname !== "/" ||
      typeof accessToken !== "string" || !/^[0-9a-f]{64}$/u.test(accessToken) || typeof fetchImpl !== "function") throw new Error("BridgeClientConfigurationRejected");
  const request = async (route, input) => {
    try {
      const response = await fetchImpl(new URL(route, u), { method: input === undefined ? "GET" : "POST", redirect: "error",
        headers: { authorization: "Bearer " + accessToken, ...(input === undefined ? {} : { "content-type": "application/json" }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(30000) });
      let length = 0; const chunks = [];
      for await (const chunk of response.body) { length += chunk.length; if (length > 65536) throw new Error("ResponseTooLarge"); chunks.push(chunk); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (response.status === 404 && input === undefined && value.error === "OPERATION_NOT_FOUND") return null;
      if (!response.ok) throw new Error("RequestNotAccepted");
      return value;
    } catch { throw new Error("BridgeRequestFailedCheckStatusBeforeRetry"); }
  };
  const id = value => { if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new Error("OperationIdRejected"); return value; };
  return Object.freeze({
    createNativeDepositRequest: value => request("/deposits/request", value), submitNativeDeposit: value => request("/deposits/submit", value),
    createSolanaWithdrawal: value => request("/withdrawals/request", value), submitSolanaWithdrawal: signature => request("/withdrawals/submit", { signature }),
    getBridgeStatus: () => request("/bridge/status"), getDepositStatus: value => request("/deposits/" + id(value)),
    getWithdrawalStatus: value => request("/withdrawals/" + id(value)), getOperationStatus: value => request("/operations/" + id(value)),
  });
}
