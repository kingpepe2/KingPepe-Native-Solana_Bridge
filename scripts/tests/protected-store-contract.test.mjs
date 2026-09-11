// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProtectedContext, protectedContextDigest, assertWindowsProtectedStore } from "../../shared/windows/protected-store.mjs";

const context = () => ({ role: "KINGPEPE_FROST_A", purpose: "frost-state", serviceSid: "S-1-5-21-1-2-3-1001",
  environment: "localnet", nativeGenesis: "01".repeat(32), solanaDeployment: "02".repeat(32), instanceId: "03".repeat(32), keyEpoch: 1 });

test("protected context has exact immutable fields and rejects getters/proxies", () => {
  const c = context(); const copy = normalizeProtectedContext(c); c.role = "COORDINATOR";
  assert.equal(copy.role, "KINGPEPE_FROST_A"); assert(Object.isFrozen(copy));
  assert.throws(() => normalizeProtectedContext(new Proxy(context(), {})));
  assert.throws(() => normalizeProtectedContext({ ...context(), unexpected: true }));
  let invoked = false; const getter = context(); Object.defineProperty(getter, "keyEpoch", { get() { invoked = true; return 1; } });
  assert.throws(() => normalizeProtectedContext(getter)); assert.equal(invoked, false);
});
test("protected context binds role purpose identity network deployment instance and epoch", () => {
  const base = protectedContextDigest(context());
  for (const change of [{ role: "KINGPEPE_FROST_B" }, { purpose: "service-auth" }, { serviceSid: "S-1-5-21-1-2-3-1002" },
    { environment: "mainnet" }, { nativeGenesis: "04".repeat(32) }, { solanaDeployment: "05".repeat(32) }, { instanceId: "06".repeat(32) }, { keyEpoch: 2 }]) {
    assert.notEqual(protectedContextDigest({ ...context(), ...change }), base);
  }
});
test("protected context rejects malformed identities epoch and cross-role key purposes", () => {
  for (const change of [{ role: "COORDINATOR" }, { purpose: "attester-seed" }, { serviceSid: "local-user" },
    { nativeGenesis: "00".repeat(32) }, { environment: "MAINNET" }, { keyEpoch: 0 }, { keyEpoch: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => normalizeProtectedContext({ ...context(), ...change }));
  }
});
test("protected adapters reject caller-forged store capabilities", () => {
  assert.throws(() => assertWindowsProtectedStore({ context: context(), read() { throw new Error("MUST_NOT_READ"); } }, "KINGPEPE_FROST_A", "frost-state"), /ProtectedStoreRoleMismatch/u);
});
