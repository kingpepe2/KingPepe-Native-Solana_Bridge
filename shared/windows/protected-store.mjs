// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { types } from "node:util";
import path from "node:path";
import { validateRuntimeStateRoot, isSameOrInside } from "../runtime-path-boundary.mjs";

const PROTOCOL = "KINGPEPE_WINDOWS_PROTECTED_STORE_V1";
const MAX_PAYLOAD = 1_048_576;
const ROLES = Object.freeze(["KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "ATTESTER_A", "ATTESTER_B",
  "COORDINATOR", "BRIDGE_VALIDATOR", "SUPERVISOR", "NATIVE_OBSERVER", "SOLANA_OBSERVER", "RELAYER", "RECONCILIATION"]);
const PURPOSES = Object.freeze(["frost-state", "attester-seed", "service-auth", "signer-fence"]);
const INSTANCES = new WeakSet();

function record(value, fields) {
  if (!value || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("ProtectedContextInvalid");
  if (Reflect.ownKeys(value).length !== fields.length) throw new Error("ProtectedContextFields");
  const copy = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("ProtectedContextFields");
    copy[field] = descriptor.value;
  }
  return copy;
}

export function normalizeProtectedContext(value) {
  const fields = ["role", "purpose", "serviceSid", "environment", "nativeGenesis", "solanaDeployment", "instanceId", "keyEpoch"];
  const c = record(value, fields);
  if (!ROLES.includes(c.role) || !PURPOSES.includes(c.purpose)) throw new Error("ProtectedRolePurposeInvalid");
  if (c.purpose === "frost-state" && !["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"].includes(c.role)) throw new Error("ProtectedRolePurposeInvalid");
  if (c.purpose === "attester-seed" && !["ATTESTER_A", "ATTESTER_B"].includes(c.role)) throw new Error("ProtectedRolePurposeInvalid");
  if (typeof c.serviceSid !== "string" || !/^S-1-5-(?:\d{1,10}-){1,14}\d{1,10}$/u.test(c.serviceSid)) throw new Error("ProtectedServiceSidInvalid");
  if (!["localnet", "devnet", "mainnet"].includes(c.environment)) throw new Error("ProtectedEnvironmentInvalid");
  for (const key of ["nativeGenesis", "solanaDeployment", "instanceId"]) {
    if (typeof c[key] !== "string" || !/^[0-9a-f]{64}$/u.test(c[key]) || /^0+$/u.test(c[key])) throw new Error("ProtectedContextIdentityInvalid");
  }
  if (!Number.isInteger(c.keyEpoch) || c.keyEpoch < 1 || c.keyEpoch > 0xffff_ffff) throw new Error("ProtectedEpochInvalid");
  return Object.freeze(c);
}

export function protectedContextDigest(context) {
  const c = normalizeProtectedContext(context);
  // Fixed ordered fields bind OS storage, not economic transfer authorization.
  return createHash("sha256").update(JSON.stringify([PROTOCOL, c.role, c.purpose, c.serviceSid,
    c.environment, c.nativeGenesis, c.solanaDeployment, c.instanceId, c.keyEpoch])).digest("hex");
}

function invoke(request) {
  if (process.platform !== "win32") throw new Error("WindowsProtectedStorageRequired");
  const windowsRoot = process.env.SystemRoot;
  if (typeof windowsRoot !== "string" || !/^[A-Z]:\\[^\r\n\0]+$/iu.test(windowsRoot)) throw new Error("WindowsSystemRootRequired");
  const executable = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const input = Buffer.from(JSON.stringify(request));
  let result;
  try {
    result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(import.meta.dirname, "protected-store-driver.ps1")],
      { input, encoding: "buffer", maxBuffer: 1_500_000, timeout: 30_000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    if (result.error || result.status !== 0 || result.stderr.length !== 0) throw new Error("WindowsProtectedStoreRejected");
    try { return JSON.parse(result.stdout.toString("utf8")); } catch { throw new Error("WindowsProtectedStoreResponseInvalid"); }
  } finally {
    input.fill(0);
    result?.stdout?.fill(0);
    result?.stderr?.fill(0);
  }
}

export function windowsCurrentServiceSid() { return invoke({ operation: "identity" }).sid; }

function revision(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value) || BigInt(value) > 0xffff_ffff_ffff_ffffn) throw new Error("ProtectedRevisionInvalid");
  return value;
}

export class WindowsProtectedStore {
  #request;
  #context;
  #highestRevision = 0n;
  #closed = false;
  constructor({ root, anchorRoot, context, repoRoot }) {
    if (process.platform !== "win32") throw new Error("WindowsProtectedStorageRequired");
    this.#context = normalizeProtectedContext(context);
    root = validateRuntimeStateRoot(root, repoRoot);
    anchorRoot = validateRuntimeStateRoot(anchorRoot, repoRoot);
    if (isSameOrInside(root, anchorRoot) || isSameOrInside(anchorRoot, root)) throw new Error("SeparateProtectedAnchorRequired");
    this.#request = Object.freeze({ protocol: PROTOCOL, root, anchorRoot, serviceSid: this.#context.serviceSid,
      contextDigest: protectedContextDigest(this.#context) });
    INSTANCES.add(this);
  }
  static create(options, payload) {
    const store = new WindowsProtectedStore(options);
    const result = store.#write("create", payload);
    store.#highestRevision = BigInt(result.revision);
    return store;
  }
  get context() { return this.#context; }
  close() { this.#closed = true; }
  #ready() { if (this.#closed) throw new Error("ProtectedStoreClosed"); }
  read() {
    this.#ready();
    const result = invoke({ ...this.#request, operation: "read" });
    const generation = BigInt(revision(result.revision));
    if (generation < this.#highestRevision) throw new Error("ProtectedStateRollbackDetected");
    if (typeof result.payload !== "string" || result.payload.length > Math.ceil(MAX_PAYLOAD / 3) * 4) throw new Error("ProtectedPayloadInvalid");
    const payload = Buffer.from(result.payload, "base64");
    if (payload.length > MAX_PAYLOAD || payload.toString("base64") !== result.payload) { payload.fill(0); throw new Error("ProtectedPayloadInvalid"); }
    this.#highestRevision = generation;
    return { revision: result.revision, payload };
  }
  write(payload, expectedRevision) {
    this.#ready();
    const expected = revision(expectedRevision);
    if (BigInt(expected) < this.#highestRevision) throw new Error("ProtectedStateRollbackDetected");
    return this.#write("write", payload, expected);
  }
  #write(operation, payload, expectedRevision) {
    if (!(payload instanceof Uint8Array) || types.isProxy(payload) || payload.byteLength > MAX_PAYLOAD) throw new Error("ProtectedPayloadInvalid");
    const copy = Buffer.from(payload);
    let result;
    try { result = invoke({ ...this.#request, operation, payload: copy.toString("base64"),
      ...(expectedRevision === undefined ? {} : { expectedRevision }) }); }
    finally { copy.fill(0); }
    const next = BigInt(revision(result.revision));
    if (next < this.#highestRevision || (expectedRevision !== undefined && next !== BigInt(expectedRevision) + 1n)) throw new Error("ProtectedRevisionInvalid");
    this.#highestRevision = next;
    return { revision: result.revision };
  }
}

export function assertWindowsProtectedStore(store, role, purpose) {
  if (!INSTANCES.has(store) || store.context.role !== role || store.context.purpose !== purpose) throw new Error("ProtectedStoreRoleMismatch");
}
