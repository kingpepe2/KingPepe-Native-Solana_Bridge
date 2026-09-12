// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { types } from "node:util";
import path from "node:path";
import { validateRuntimeStateRoot } from "../runtime-path-boundary.mjs";
import { windowsProtectedExecutable } from "./protected-executable.mjs";

const PROTOCOL = "KINGPEPE_WINDOWS_PROTECTED_STORE_V2";
const MAX_PAYLOAD = 1_048_576;
const ROLES = Object.freeze(["KINGPEPE_FROST_A", "KINGPEPE_FROST_B", "ATTESTER_A", "ATTESTER_B",
  "COORDINATOR", "BRIDGE_VALIDATOR", "SUPERVISOR", "NATIVE_OBSERVER", "SOLANA_OBSERVER", "RELAYER", "RECONCILIATION", "INDEXER", "FEE_PAYER"]);
const PURPOSES = Object.freeze(["frost-state", "attester-seed", "attester-authorizations", "fee-payer-seed", "coordinator-signing", "coordinator-jobs", "deposit-operations", "deposit-controller", "reconciliation-progress", "native-sweep-outbox", "solana-deposit-outbox", "service-auth", "global-integrity", "chain-progress"]);
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
  if (c.purpose === "fee-payer-seed" && c.role !== "FEE_PAYER") throw new Error("ProtectedRolePurposeInvalid");
  if (["attester-seed", "attester-authorizations"].includes(c.purpose) && !["ATTESTER_A", "ATTESTER_B"].includes(c.role)) throw new Error("ProtectedRolePurposeInvalid");
  if (c.purpose === "global-integrity" && c.role !== "SUPERVISOR") throw new Error("ProtectedRolePurposeInvalid");
  if (["coordinator-signing", "coordinator-jobs"].includes(c.purpose) && c.role !== "COORDINATOR") throw new Error("ProtectedRolePurposeInvalid");
  if (["deposit-operations", "deposit-controller"].includes(c.purpose) && c.role !== "BRIDGE_VALIDATOR") throw new Error("ProtectedRolePurposeInvalid");
  if (["native-sweep-outbox", "solana-deposit-outbox"].includes(c.purpose) && c.role !== "RELAYER") throw new Error("ProtectedRolePurposeInvalid");
  if (c.purpose === "reconciliation-progress" && c.role !== "RECONCILIATION") throw new Error("ProtectedRolePurposeInvalid");
  if (c.purpose === "chain-progress" && !["NATIVE_OBSERVER", "SOLANA_OBSERVER"].includes(c.role)) throw new Error("ProtectedRolePurposeInvalid");
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
  const helper = windowsProtectedExecutable();
  const input = Buffer.from(JSON.stringify(request));
  let result;
  try {
    result = spawnSync(helper.executable, [helper.sourceRoot],
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
  #lease;
  constructor({ root, context, repoRoot }) {
    if (process.platform !== "win32") throw new Error("WindowsProtectedStorageRequired");
    this.#context = normalizeProtectedContext(context);
    root = validateRuntimeStateRoot(root, repoRoot);
    this.#request = Object.freeze({ protocol: PROTOCOL, root, serviceSid: this.#context.serviceSid,
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
  close() { this.#closed = true; this.#lease?.close().catch(() => {}); }
  async acquireLease() {
    this.#ready();
    if (this.#lease) throw new Error("ProtectedLeaseAlreadyRequested");
    this.#lease = new ProtectedProcessLease(this.#request);
    try { await this.#lease.ready(); this.#ready(); return this.#lease; }
    catch { await this.#lease.close(); throw new Error("ProtectedProcessLeaseRejected"); }
  }
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

class ProtectedProcessLease {
  #child; #ready; #closed = false; #ended; #confirmed = false;
  constructor(request) {
    const windowsRoot = process.env.SystemRoot;
    if (typeof windowsRoot !== "string" || !/^[A-Z]:\\[^\r\n\0]+$/iu.test(windowsRoot)) throw new Error("WindowsSystemRootRequired");
    this.#child = spawn(path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(import.meta.dirname, "protected-lease-driver.ps1")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const child = this.#child;
    this.#ended = new Promise(resolve => child.once("close", resolve));
    this.#ready = new Promise((resolve, reject) => {
      let output = "";
      const failed = () => { this.#closed = true; clearTimeout(timer); child.kill(); reject(new Error("ProtectedProcessLeaseRejected")); };
      const timer = setTimeout(failed, 15000);
      child.once("error", failed); child.once("exit", () => { this.#closed = true; clearTimeout(timer); reject(new Error("ProtectedProcessLeaseLost")); });
      child.stderr.on("data", failed); child.stdin.on("error", failed);
      child.stdout.on("data", chunk => {
        if (this.#confirmed) return failed();
        output += chunk.toString("utf8");
        if (output.length > 64) return failed();
        if (output === "KINGPEPE_LEASE_READY_V1\r\n" || output === "KINGPEPE_LEASE_READY_V1\n") {
          if (this.#confirmed) return failed();
          this.#confirmed = true; clearTimeout(timer); resolve();
        }
      });
      child.stdin.write(JSON.stringify(request) + "\n");
    });
    this.#ready.catch(() => {});
  }
  ready() { return this.#ready; }
  assertHeld() { if (this.#closed || !this.#confirmed || this.#child.exitCode !== null || this.#child.signalCode !== null || this.#child.killed) throw new Error("ProtectedProcessLeaseLost"); }
  async close() { this.#closed = true; this.#child.stdin.end(); await this.#ended; }
}
