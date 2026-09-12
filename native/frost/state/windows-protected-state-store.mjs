// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { WindowsProtectedStore, assertWindowsProtectedStore } from "../../../shared/windows/protected-store.mjs";
import { assertFrostStateEnvelope, initialSignerState } from "./file-state-store.mjs";
import { assertNativeFrostRuntimePolicy, REQUIRED_FROST_SIGNERS } from "../policy/native-signing-policy.mjs";
import { nativeFrostKeyContext } from "../policy/dkg-request.mjs";

// Same synchronous signer interface; Windows OS protection never falls back to JSON files.
export class WindowsProtectedFrostStateStore {
  #store;
  #role;
  #revisions = new WeakMap();
  #lease;
  constructor(store, role) {
    if (!REQUIRED_FROST_SIGNERS.includes(role)) throw new Error("FrostStateRoleInvalid");
    assertWindowsProtectedStore(store, role, "frost-state");
    this.#store = store; this.#role = role;
  }
  static createLocal(options, policy) {
    assertNativeFrostRuntimePolicy(policy);
    if (options.context.environment !== "localnet") throw new Error("LocalProtectedFrostContextRequired");
    const bound = nativeFrostKeyContext(policy);
    if (options.context.nativeGenesis !== bound.nativeGenesisHash || options.context.solanaDeployment !== bound.solanaDeployment ||
        options.context.keyEpoch !== bound.keyEpoch) throw new Error("ProtectedFrostPolicyMismatch");
    const payload = Buffer.from(JSON.stringify(initialSignerState(options.context.role)));
    try { return new WindowsProtectedFrostStateStore(WindowsProtectedStore.create(options, payload), options.context.role); }
    finally { payload.fill(0); }
  }
  assertPolicy(policy) {
    const bound = nativeFrostKeyContext(assertNativeFrostRuntimePolicy(policy));
    if (this.#store.context.environment !== bound.environment || this.#store.context.nativeGenesis !== bound.nativeGenesisHash ||
        this.#store.context.solanaDeployment !== bound.solanaDeployment || this.#store.context.keyEpoch !== bound.keyEpoch) throw new Error("ProtectedFrostPolicyMismatch");
  }
  get context() { return this.#store.context; }
  async acquireExclusive() {
    if (this.#lease) throw new Error("ProtectedSignerAlreadyOpen");
    this.#lease = await this.#store.acquireLease();
    return this;
  }
  assertExclusive() {
    if (!this.#lease) throw new Error("ProtectedSignerExclusiveAccessRequired");
    this.#lease.assertHeld();
  }
  load() {
    this.#lease?.assertHeld();
    const result = this.#store.read();
    try {
      let state;
      try { state = JSON.parse(result.payload.toString("utf8")); assertFrostStateEnvelope(state, this.#role); }
      catch { throw new Error("ProtectedFrostStateInvalid"); }
      this.#revisions.set(state, result.revision); return state;
    } finally { result.payload.fill(0); }
  }
  save(state) {
    this.#lease?.assertHeld();
    assertFrostStateEnvelope(state, this.#role);
    const expected = this.#revisions.get(state);
    if (!expected) throw new Error("ProtectedFrostLoadRequired");
    const payload = Buffer.from(JSON.stringify(state));
    try { this.#revisions.set(state, this.#store.write(payload, expected).revision); }
    finally { payload.fill(0); }
  }
  async close() { await this.#lease?.close(); this.#store.close(); }
}
