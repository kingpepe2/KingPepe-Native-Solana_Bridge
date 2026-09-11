// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TLS is the cryptographic transport. This framing is NOT economic authorization.
import tls from "node:tls";
import { createHash, createPrivateKey, createPublicKey, randomBytes, X509Certificate } from "node:crypto";
import { assertWindowsProtectedStore } from "./protected-store.mjs";

const VERSION = "KINGPEPE_SERVICE_IPC_V1";
const HOSTNAME = "kingpepe-service.invalid";
const MAX = 262144;
const REQUEST_LIMIT = 2048; // Exhaustion fails closed; no automatic pruning/rotation.
const TIMEOUT = 10000;
const HASH = /^[0-9a-f]{64}$/u;
const edges = Object.freeze({
  KINGPEPE_FROST_A: { COORDINATOR: ["verifyNativeEvidence", "signingCommitment", "signatureShare", "abortSigningSession"] },
  KINGPEPE_FROST_B: { COORDINATOR: ["verifyNativeEvidence", "signingCommitment", "signatureShare", "abortSigningSession"] },
  ATTESTER_A: { BRIDGE_VALIDATOR: ["attestDeposit"] },
  ATTESTER_B: { BRIDGE_VALIDATOR: ["attestDeposit"] },
});
function requireValue(condition, code = "IpcRejected") { if (!condition) throw new Error(code); }
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function increment(value) {
  requireValue(typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value) && BigInt(value) < 0xffff_ffff_ffff_ffffn);
  return (BigInt(value) + 1n).toString();
}
function exactArray(value, length) { requireValue(Array.isArray(value) && value.length === length); return value; }
function encode(value) {
  const data = Buffer.from(JSON.stringify(value)); requireValue(data.length > 0 && data.length <= MAX, "IpcSizeRejected");
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length); return Buffer.concat([prefix, data]);
}
function frame(socket) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0), length;
    const timer = setTimeout(() => end(new Error("IpcTimeout")), TIMEOUT);
    function end(error, value) {
      clearTimeout(timer); socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose);
      if (error) { socket.destroy(); reject(error); } else resolve(value);
    }
    function onError() { end(new Error("IpcTransportRejected")); }
    function onClose() { end(new Error("IpcTransportClosed")); }
    function onData(chunk) {
      if (data.length + chunk.length > MAX + 4) return end(new Error("IpcSizeRejected"));
      data = Buffer.concat([data, chunk]);
      if (data.length >= 4 && length === undefined) { length = data.readUInt32BE(); if (length === 0 || length > MAX) return end(new Error("IpcSizeRejected")); }
      if (length !== undefined && data.length >= length + 4) {
        if (data.length !== length + 4) return end(new Error("IpcTrailingFrameRejected"));
        try { const parsed = JSON.parse(data.subarray(4).toString("utf8"));
          // Reject duplicate JSON fields, alternate encoding and invalid UTF-8.
          requireValue(encode(parsed).equals(data)); end(undefined, parsed);
        } catch { end(new Error("IpcEncodingRejected")); }
      }
    }
    socket.on("data", onData); socket.once("error", onError); socket.once("close", onClose);
  });
}
function read(store) {
  const result = store.read(); let state;
  try { state = JSON.parse(result.payload.toString("utf8")); } catch { throw new Error("IpcProtectedStateRejected"); }
  finally { result.payload.fill(0); }
  requireValue(state?.protocol === VERSION && Object.keys(state).sort().join() === "credential,generation,lastTimeMs,protocol,usedRequestIds", "IpcProtectedStateRejected");
  increment(state.generation);
  requireValue(Number.isSafeInteger(state.lastTimeMs) && state.lastTimeMs >= 0 && Date.now() >= state.lastTimeMs, "IpcClockRollback");
  requireValue(Array.isArray(state.usedRequestIds) && state.usedRequestIds.length <= REQUEST_LIMIT &&
    state.usedRequestIds.every(id => typeof id === "string" && HASH.test(id)) && new Set(state.usedRequestIds).size === state.usedRequestIds.length);
  return { state, revision: result.revision };
}
function persist(store, state, revision) {
  const bytes = Buffer.from(JSON.stringify(state));
  try { store.write(bytes, revision); } finally { bytes.fill(0); }
}

// Explicit enrollment input. The returned bytes contain a private TLS key and
// must go directly to WindowsProtectedStore.create(service-auth), never disk/logs.
export function encodeIpcEnrollment({ certificatePem, privateKeyPem, peerCertificatePem, peerRole }) {
  requireValue(typeof certificatePem === "string" && typeof privateKeyPem === "string" && typeof peerCertificatePem === "string");
  return Buffer.from(JSON.stringify({ protocol: VERSION, generation: "0", lastTimeMs: 0, usedRequestIds: [],
    credential: { certificatePem, privateKeyPem, peerCertificatePem, peerRole } }));
}

export class ProtectedServiceIpc {
  #store; #credential; #generation; #server; #connections = new Set(); #busy = false; #closed = false;
  #role; #peerRole; #domain; #environment; #peerFingerprint;
  #credentialBinding;
  constructor(store) {
    assertWindowsProtectedStore(store, store?.context?.role, "service-auth");
    // Production enrollment/activation is outside this remediation's authority.
    requireValue(store.context.environment === "localnet", "IpcLocalEnrollmentRequired");
    this.#store = store; this.#role = store.context.role; this.#environment = store.context.environment;
    this.#domain = digest(Buffer.from(JSON.stringify([VERSION, store.context.nativeGenesis, store.context.solanaDeployment, store.context.keyEpoch])));
    const { state } = read(store), c = state.credential;
    requireValue(c && Object.keys(c).sort().join() === "certificatePem,peerCertificatePem,peerRole,privateKeyPem");
    this.#peerRole = c.peerRole;
    this.#credentialBinding = digest(Buffer.from(JSON.stringify(c)));
    requireValue(edges[this.#role]?.[this.#peerRole] || edges[this.#peerRole]?.[this.#role], "IpcRolePairRejected");
    try {
      const own = new X509Certificate(c.certificatePem), peer = new X509Certificate(c.peerCertificatePem);
      for (const cert of [own, peer]) requireValue(Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now() && cert.checkHost(HOSTNAME) === HOSTNAME);
      const key = createPrivateKey(c.privateKeyPem);
      requireValue(digest(createPublicKey(key).export({ type: "spki", format: "der" })) === digest(own.publicKey.export({ type: "spki", format: "der" })));
      requireValue(digest(own.raw) !== digest(peer.raw), "IpcDistinctIdentitiesRequired");
      this.#peerFingerprint = digest(peer.raw);
      this.#credential = { key: Buffer.from(c.privateKeyPem), cert: c.certificatePem, ca: c.peerCertificatePem, minVersion: "TLSv1.3", maxVersion: "TLSv1.3", rejectUnauthorized: true };
    } catch { throw new Error("IpcCredentialRejected"); }
  }
  get role() { return this.#role; }
  get peerRole() { return this.#peerRole; }
  #checkPeer(socket) {
    requireValue(!this.#closed && socket.authorized && socket.getProtocol() === "TLSv1.3" && !socket.isSessionReused(), "IpcPeerRejected");
    requireValue(digest(socket.getPeerX509Certificate().raw) === this.#peerFingerprint, "IpcPeerRejected");
  }
  #binding(socket) { return socket.exportKeyingMaterial(32, VERSION).toString("hex"); }
  #state() { requireValue(!this.#closed, "IpcClosed"); const r = read(this.#store);
    requireValue(digest(Buffer.from(JSON.stringify(r.state.credential))) === this.#credentialBinding, "IpcCredentialChanged");
    if (this.#generation !== undefined) requireValue(r.state.generation === this.#generation, "IpcStaleEndpoint"); return r; }
  async listen(handler) {
    requireValue(!this.#server && typeof handler === "function" && edges[this.#role]?.[this.#peerRole], "IpcServerRoleRejected");
    const { state, revision } = this.#state(); state.generation = increment(state.generation); state.lastTimeMs = Date.now();
    persist(this.#store, state, revision); this.#generation = state.generation;
    let server;
    try { server = tls.createServer({ ...this.#credential, requestCert: true, handshakeTimeout: TIMEOUT, sessionTimeout: 1 }, socket => {
      this.#serve(socket, handler).catch(() => socket.destroy());
    }); } catch { throw new Error("IpcTlsContextRejected"); }
    this.#server = server; server.maxConnections = 8;
    server.on("connection", socket => { this.#connections.add(socket); socket.setTimeout(TIMEOUT, () => socket.destroy()); socket.once("close", () => this.#connections.delete(socket)); });
    server.on("tlsClientError", () => {}); // No exception may print key/config/peer data.
    server.on("error", () => this.close());
    await new Promise((resolve, reject) => { server.once("error", () => reject(new Error("IpcListenFailed"))); server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve); });
    return server.address().port;
  }
  async #serve(socket, handler) {
    socket.on("error", () => {});
    this.#checkPeer(socket); this.#state();
    const nonce = randomBytes(32).toString("hex"), binding = this.#binding(socket);
    const pending = frame(socket);
    socket.write(encode([VERSION, "CHALLENGE", this.#domain, this.#environment, this.#role, this.#peerRole, this.#generation, nonce, binding]));
    const v = exactArray(await pending, 14);
    requireValue(v[0] === VERSION && v[1] === "REQUEST" && v[2] === this.#domain && v[3] === this.#environment && v[4] === this.#peerRole && v[5] === this.#role && v[6] === this.#generation && v[7] === nonce && v[8] === binding, "IpcContextRejected");
    const [id, operation, method, expires, payload] = v.slice(9);
    requireValue(typeof id === "string" && HASH.test(id) && typeof operation === "string" && HASH.test(operation));
    requireValue(edges[this.#role][this.#peerRole].includes(method), "IpcMethodRejected");
    requireValue(Number.isSafeInteger(expires) && expires > Date.now() && expires <= Date.now() + TIMEOUT, "IpcStaleRequest");
    requireValue(!this.#busy, "IpcBusy"); this.#busy = true;
    try {
      const { state, revision } = this.#state();
      requireValue(!state.usedRequestIds.includes(id), "IpcReplayRejected");
      requireValue(state.usedRequestIds.length < REQUEST_LIMIT, "IpcReplayCapacity");
      state.usedRequestIds.push(id); state.lastTimeMs = Date.now(); persist(this.#store, state, revision);
      // Persist-before-dispatch. A lost result is not permission to replay this ID.
      // Economic/session idempotency remains enforced by the signer/attester.
      const result = await handler(Object.freeze({ method, operationId: operation, payload, peerRole: this.#peerRole }));
      this.#state(); requireValue(!socket.destroyed && Date.now() < expires, "IpcExpiredResult");
      socket.end(encode([VERSION, "RESPONSE", id, operation, binding, result ?? null]));
    } finally { this.#busy = false; }
  }
  async request(port, { method, operationId, payload, requestId = randomBytes(32).toString("hex") }) {
    this.#state();
    requireValue(Number.isInteger(port) && port > 0 && port <= 65535 && edges[this.#peerRole]?.[this.#role]?.includes(method), "IpcRequestTargetRejected");
    requireValue(typeof operationId === "string" && HASH.test(operationId) && typeof requestId === "string" && HASH.test(requestId));
    // Bound payload before connecting. Do not expose private share/state methods.
    encode(payload);
    let socket;
    try {
      socket = tls.connect({ ...this.#credential, host: "127.0.0.1", port, servername: HOSTNAME, handshakeTimeout: TIMEOUT });
      this.#connections.add(socket); socket.setTimeout(TIMEOUT, () => socket.destroy());
      const challenge = frame(socket);
      challenge.catch(() => {}); // Awaited below; avoid orphan rejection on TLS failure.
      await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", () => reject(new Error("IpcAuthenticationFailed"))); socket.once("close", () => reject(new Error("IpcTransportClosed"))); });
      this.#checkPeer(socket);
      const hello = exactArray(await challenge, 9), binding = this.#binding(socket);
      requireValue(hello[0] === VERSION && hello[1] === "CHALLENGE" && hello[2] === this.#domain && hello[3] === this.#environment && hello[4] === this.#peerRole && hello[5] === this.#role && HASH.test(hello[7]) && hello[8] === binding, "IpcContextRejected");
      const response = frame(socket);
      socket.write(encode([VERSION, "REQUEST", this.#domain, this.#environment, this.#role, this.#peerRole, hello[6], hello[7], binding,
        requestId, operationId, method, Date.now() + TIMEOUT - 100, payload]));
      const result = exactArray(await response, 6); this.#state();
      requireValue(result[0] === VERSION && result[1] === "RESPONSE" && result[2] === requestId && result[3] === operationId && result[4] === binding);
      return result[5];
    } catch { throw new Error("IpcRequestRejected"); }
    finally { socket?.destroy(); this.#connections.delete(socket); }
  }
  close() { this.#closed = true; for (const socket of this.#connections) socket.destroy(); this.#server?.close(); this.#credential?.key.fill(0); this.#credential = undefined; }
}
