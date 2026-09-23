// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, linkSync } from "node:fs";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { WindowsProtectedStore, windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { DEVNET_SOLANA_GENESIS } from "../../shared/solana-test-network.mjs";
import { NATIVE_MAINNET_GENESIS, NATIVE_MAINNET_DOMAIN, SOLANA_MAINNET_GENESIS, mainnetDeploymentIdentity } from "../../shared/network-identity.mjs";
import { base58 } from "@scure/base";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { ProtectedBurnJournal } from '../../services/bridge-validator/protected-burn-journal.mjs';
import { initialBurnJournal } from '../../services/bridge-validator/burn-journal-state.mjs';
import { burnFixture } from '../../native/burn/tests/burn-fixture.mjs';
import { prepareMainnetProgramIdentities, preparedMainnetProgramIdentities, prepareMainnetRoleSeed } from "../../services/bridge-validator/mainnet-identity-preparation.mjs";

if (process.platform !== "win32") throw new Error("WINDOWS_PROTECTED_STORAGE_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../..");
const serviceSid = windowsCurrentServiceSid(); // Never logged or committed.
const h = value => createHash("sha256").update(value).digest("hex");



test("Mainnet Native RPC authentication requires the protected role and rejects malformed secret payloads without echoing them", t => {
  assert.throws(() => NativeRpcClient.fromProtectedMainnetCredentials({}), /ProtectedStoreRoleMismatch/);
  const { options } = fixture(t, "NATIVE_OBSERVER", "native-rpc-auth", { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS });
  const marker = randomBytes(32).toString("hex"), payload = Buffer.from('{invalid-' + marker);
  const store = WindowsProtectedStore.create(options, payload); payload.fill(0);
  try { assert.throws(() => NativeRpcClient.fromProtectedMainnetCredentials(store), /^Error: NativeRpcProtectedCredentialsRejected$/); }
  finally { store.close(); }
});

test("Mainnet program, Mint and attester preparation keeps new identities protected and explicitly undeployed", t => {
  const { options } = fixture(t, "FEE_PAYER", "mainnet-deployment-keys", { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS });
  const prepared = prepareMainnetProgramIdentities({ root: options.root, repoRoot, serviceSid, instanceId: options.context.instanceId });
  assert.equal(prepared.status, "PREPARED_NOT_DEPLOYED"); assert.equal(prepared.transactionsSubmitted, 0);
  assert.equal(new Set(Object.values(prepared.publicKeys)).size, 3);
  assert.equal(prepared.mainnetActivation, "DISABLED"); assert.equal(prepared.productionReady, false);
  const store = new WindowsProtectedStore(prepared.options);
  try { assert.deepEqual(preparedMainnetProgramIdentities(store).publicKeys, prepared.publicKeys); }
  finally { store.close(); }
  assert.throws(() => prepareMainnetProgramIdentities({ root: options.root, repoRoot, serviceSid, instanceId: options.context.instanceId }));
  const attester = fixture(t, "ATTESTER_A", "attester-seed", { environment: "mainnet", nativeGenesis: NATIVE_MAINNET_GENESIS,
    solanaDeployment: prepared.solanaDeployment });
  const role = prepareMainnetRoleSeed(attester.options);
  assert.equal(role.state, "PREPARED_NOT_ACTIVATED"); assert.equal(typeof role.publicKey, "string");
  assert.throws(() => prepareMainnetRoleSeed({ ...attester.options, context: { ...attester.options.context, environment: "devnet" } }), /MainnetRolePreparationRejected/);
});


function fixture(t, role = "BURN_SIGNER", purpose = "native-burn-key", overrides = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "kingpepe-protected-test-"));
  t.after(() => {
    assert(path.dirname(parent) === path.resolve(os.tmpdir()) && path.basename(parent).startsWith("kingpepe-protected-test-"), "UnsafeTemporaryCleanupTarget");
    try { rmSync(parent, { recursive: true }); } catch { throw new Error("WindowsTestCleanupFailed"); }
  });
  const options = { root: path.join(parent, "state"), repoRoot,
    context: { role, purpose, serviceSid, environment: "localnet", nativeGenesis: REGTEST_GENESIS,
      solanaDeployment: h("protected-local-deployment"), instanceId: randomBytes(32).toString("hex"), keyEpoch: 1, ...overrides } };
  return { parent, options };
}
const stateFile = options => path.join(options.root, "state.protected");
function sameProtectedBytes(actual, expected) {
  // Assertions must never retain secret bytes or encrypted operational blobs
  // in actual/expected fields that a failing test reporter could print.
  assert(actual.length === expected.length && timingSafeEqual(actual, expected), "ProtectedBytesMismatch");
}
test("protected-byte assertion failures expose only a fixed error", () => {
  const a = randomBytes(32), b = randomBytes(32); let caught;
  try { sameProtectedBytes(a, b); } catch (error) { caught = error; }
  assert(caught?.message === "ProtectedBytesMismatch" && caught.actual === false && caught.expected === true, "ProtectedAssertionRedactionFailed");
  a.fill(0); b.fill(0);
});

test("real Windows DPAPI encrypts before disk and restores the exact payload", t => {
  const { options } = fixture(t); const secret = randomBytes(128);
  const store = WindowsProtectedStore.create(options, secret);
  assert.equal(readFileSync(stateFile(options)).includes(secret), false);
  assert.deepEqual(readdirSync(options.root), ["lease.protected", "lock.protected", "state.protected"]);
  sameProtectedBytes(store.read().payload, secret);
  assert.equal(store.write(randomBytes(64), "1").revision, "2");
  assert.equal(new WindowsProtectedStore(options).read().revision, "2");
  secret.fill(0);
});
test("protected storage never initializes missing state on read or write", t => {
  const { options } = fixture(t); const store = new WindowsProtectedStore(options);
  assert.throws(() => store.read(), /WindowsProtectedStoreRejected/u);
  assert.throws(() => store.write(randomBytes(32), "1"), /WindowsProtectedStoreRejected/u);
  assert.equal(existsSync(options.root), false);
});

test("Devnet deployment test material uses real DPAPI without a plaintext fallback", t => {
  const { options } = fixture(t, "FEE_PAYER", "devnet-deployment-keys", { environment: "devnet" });
  const payload = randomBytes(256);
  const store = WindowsProtectedStore.create(options, payload);
  assert.equal(readFileSync(stateFile(options)).includes(payload), false);
  const reopened = new WindowsProtectedStore(options), restored = reopened.read().payload;
  sameProtectedBytes(restored, payload); restored.fill(0); payload.fill(0); store.close(); reopened.close();
  for (const overrides of [{ environment: "localnet" }, { environment: "mainnet" }, { role: "ATTESTER_A" }]) {
    assert.throws(() => new WindowsProtectedStore({ ...options, context: { ...options.context, ...overrides } }), /ProtectedDevnetDeploymentContextRequired/u);
  }
  assert.throws(() => new WindowsProtectedStore({ ...options, context: { ...options.context,
    solanaDeployment: h("different-devnet-deployment") } }).read(), /WindowsProtectedStoreRejected/u);
});
for (const environment of ["localnet", "devnet"]) test(`${environment} burn journal reopens encrypted paused state and rejects context substitution`, async t => {
  const f=burnFixture();
  try {
    f.context.environment=environment;
    if(environment==='devnet')f.context.deployment.solanaGenesis=Buffer.from(base58.decode(DEVNET_SOLANA_GENESIS)).toString('hex');
    Object.assign(f.binding,f.context.deployment);
    const {options}=fixture(t,'BRIDGE_VALIDATOR','burn-operations',{environment,solanaDeployment:f.binding.solanaDeployment});
    const state=initialBurnJournal(f.binding,{context:f.context,feePayerHex:f.policy.feePayerHex});
    const payload=Buffer.from(JSON.stringify(state)),store=WindowsProtectedStore.create(options,payload);payload.fill(0);
    let journal=await ProtectedBurnJournal.open(store);
    try { journal.pause('TEST_RECOVERY_REVIEW'); } finally { await journal.close(); }
    assert.equal(readFileSync(stateFile(options)).includes(Buffer.from(f.binding.solanaDeployment)),false);
    journal=await ProtectedBurnJournal.open(new WindowsProtectedStore(options));
    try { assert.equal(journal.read().pauseReason,'TEST_RECOVERY_REVIEW');assert.equal(journal.read().paused,true); }
    finally { await journal.close(); }
    for(const changes of [{environment:environment==='devnet'?'localnet':'devnet'},{solanaDeployment:h('wrong-deployment')},{instanceId:h('wrong-instance')}])
      await assert.rejects(ProtectedBurnJournal.open(new WindowsProtectedStore({...options,context:{...options.context,...changes}})));
  }finally{f.destroy();}
});

test("created protected files have explicit private DACLs on a fixed local volume", t => {
  const { options } = fixture(t); WindowsProtectedStore.create(options, randomBytes(32));
  const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = '$ErrorActionPreference="Stop";try{$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;foreach($p in $r.files){$a=[IO.File]::GetAccessControl($p);if(-not $a.AreAccessRulesProtected -or -not $a.GetOwner([Security.Principal.SecurityIdentifier]).Equals($sid)){throw "ACL"};if(([IO.DriveInfo]([IO.Path]::GetPathRoot($p))).DriveType -ne [IO.DriveType]::Fixed){throw "VOLUME"}};[Console]::Out.Write("VERIFIED");exit 0}catch{[Console]::Error.Write("TEST_FILE_POLICY_REJECTED");exit 1}';
  const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { input: JSON.stringify({ files: [stateFile(options), path.join(options.root, "lock.protected"), path.join(options.root, "lease.protected")] }), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  assert(result.status === 0 && result.stdout.toString("utf8") === "VERIFIED", "ProtectedFilePolicyNotVerified");
});
test("protected storage refuses reinitialization without overwriting", t => {
  const { options } = fixture(t); WindowsProtectedStore.create(options, randomBytes(32));
  const before = readFileSync(stateFile(options));
  assert.throws(() => WindowsProtectedStore.create(options, randomBytes(32)));
  sameProtectedBytes(readFileSync(stateFile(options)), before);
});
test("corrupt protected state fails closed with a redacted error", t => {
  const { options } = fixture(t); const store = WindowsProtectedStore.create(options, randomBytes(32));
  const blob = readFileSync(stateFile(options)); blob[blob.length - 1] ^= 1; writeFileSync(stateFile(options), blob);
  assert.throws(() => store.read(), { message: "WindowsProtectedStoreRejected" });
});
test("wrong pinned service SID is refused before decryption", t => {
  const { options } = fixture(t); WindowsProtectedStore.create(options, randomBytes(32));
  // SID substitution rejection, NOT a second-user token/DPAPI separation test.
  const context = { ...options.context, serviceSid: "S-1-5-21-1-2-3-1002" };
  assert.throws(() => new WindowsProtectedStore({ ...options, context }).read());
});
test("encrypted context rejects wrong role epoch deployment network and instance", t => {
  const { options } = fixture(t); WindowsProtectedStore.create(options, randomBytes(32));
  for (const change of [{ role: "ATTESTER_B" }, { keyEpoch: 2 }, { nativeGenesis: h("wrong-genesis") },
    { solanaDeployment: h("wrong-deployment") }, { environment: "mainnet" }, { instanceId: h("wrong-instance") }]) {
    assert.throws(() => new WindowsProtectedStore({ ...options, context: { ...options.context, ...change } }).read());
  }
});
test("copied encrypted state cannot authorize a different root", t => {
  const { parent, options } = fixture(t); WindowsProtectedStore.create(options, randomBytes(32));
  const clone = { ...options, root: path.join(parent, "copy-state") };
  // Create exact valid ACLs at both destinations, so this tests cryptographic
  // location binding rather than failure due to inherited copy permissions.
  WindowsProtectedStore.create(clone, randomBytes(32));
  writeFileSync(stateFile(clone), readFileSync(stateFile(options)));
  assert.throws(() => new WindowsProtectedStore(clone).read());
});

test("compare-and-swap refuses a stale writer without changing current state", t => {
  const { options } = fixture(t); const a = WindowsProtectedStore.create(options, randomBytes(32)), b = new WindowsProtectedStore(options);
  const old = b.read(); const updated = randomBytes(32); a.write(updated, "1");
  assert.throws(() => b.write(randomBytes(32), old.revision));
  sameProtectedBytes(a.read().payload, updated);
});

test("Windows directories reject widened ACLs before releasing plaintext", t => {
  const { options } = fixture(t); const store = WindowsProtectedStore.create(options, randomBytes(32));
  const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = '$ErrorActionPreference="Stop";$p=[Console]::In.ReadToEnd();$a=[IO.Directory]::GetAccessControl($p);$s=New-Object Security.Principal.SecurityIdentifier -ArgumentList "S-1-1-0";$r=New-Object Security.AccessControl.FileSystemAccessRule -ArgumentList $s,([Security.AccessControl.FileSystemRights]::Read),([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),([Security.AccessControl.PropagationFlags]::None),([Security.AccessControl.AccessControlType]::Allow);$a.AddAccessRule($r);[IO.Directory]::SetAccessControl($p,$a)';
  const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { input: options.root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  assert.equal(result.status, 0);
  assert.throws(() => store.read());
});
test("closed protected store cannot read or write", t => {
  const { options } = fixture(t); const store = WindowsProtectedStore.create(options, randomBytes(32)); store.close();
  assert.throws(() => store.read(), /ProtectedStoreClosed/u); assert.throws(() => store.write(randomBytes(32), "1"), /ProtectedStoreClosed/u);
});

function committedState(t) {
  const { options } = fixture(t); const store = WindowsProtectedStore.create(options, randomBytes(32));
  const previous = readFileSync(stateFile(options)), next = randomBytes(32);
  store.write(next, "1"); return { options, previous, next, candidate: readFileSync(stateFile(options)) };
}
function interruptedWriteFixture(p) {
  writeFileSync(stateFile(p.options), p.previous);
  writeFileSync(path.join(p.options.root, "candidate.protected"), p.candidate, { flag: "wx" });
  // The real C# writer creates the candidate with an explicit service-SID ACL.
  // Node's default creator principal can instead be Administrators on an
  // elevated runner. Reproduce the real writer's ACL in this disposable fixture
  // so the tests reach authenticated recovery, not an earlier ACL rejection.
  const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  // SetAccessControl does not persist an unmodified GetAccessControl object.
  // Copy its descriptor into a new, modified FileSecurity and verify the result.
  const script = '$ErrorActionPreference="Stop";try{$p=[Console]::In.ReadToEnd();$a=[IO.File]::GetAccessControl([IO.Path]::Combine($p,"state.protected"));$c=[IO.Path]::Combine($p,"candidate.protected");$s=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner;$b=New-Object Security.AccessControl.FileSecurity;$b.SetSecurityDescriptorBinaryForm($a.GetSecurityDescriptorBinaryForm(),$s);[IO.File]::SetAccessControl($c,$b);$v=[IO.File]::GetAccessControl($c);if($v.GetSecurityDescriptorSddlForm($s) -ne $a.GetSecurityDescriptorSddlForm($s)){throw "ACL"};[Console]::Out.Write("FIXTURE_READY")}catch{[Console]::Error.Write("TEST_CANDIDATE_FIXTURE_REJECTED");exit 1}';
  const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script], {
    input: p.options.root, windowsHide: true, timeout: 10_000, stdio: ["pipe", "pipe", "pipe"],
  });
  assert(result.status === 0 && result.stdout.toString("utf8") === "FIXTURE_READY", "ProtectedCandidateFixtureRejected");
}
test("authenticated atomic candidate recovers once after a write interruption", t => {
  const p = committedState(t);
  interruptedWriteFixture(p);
  const store = new WindowsProtectedStore(p.options);
  assert.equal(store.read().revision, "2"); sameProtectedBytes(store.read().payload, p.next);
  assert.equal(new WindowsProtectedStore(p.options).read().revision, "2");
  assert.equal(existsSync(path.join(p.options.root, "candidate.protected")), false);
});
for (const invalid of ["CORRUPT", "SKIPPED_REVISION"]) test("ambiguous atomic candidate fails closed: " + invalid, t => {
  const p = committedState(t);
  if (invalid === "CORRUPT") p.candidate[p.candidate.length - 1] ^= 1;
  else {
    new WindowsProtectedStore(p.options).write(randomBytes(32), "2");
    p.candidate = readFileSync(stateFile(p.options));
  }
  interruptedWriteFixture(p);
  assert.throws(() => new WindowsProtectedStore(p.options).read(), { message: "WindowsProtectedStoreRejected" });
});

test("hard-linked protected state is refused", t => {
  const { parent, options } = fixture(t); const store = WindowsProtectedStore.create(options, randomBytes(32));
  linkSync(stateFile(options), path.join(parent, "linked.protected"));
  assert.throws(() => store.read(), { message: "WindowsProtectedStoreRejected" });
});
test("an actual second process holding the protected lock blocks reads and writes", async t => {
  const { options } = fixture(t); const store = WindowsProtectedStore.create(options, randomBytes(32));
  const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = '$ErrorActionPreference="Stop";try{$p=([Console]::In.ReadLine()|ConvertFrom-Json).gate;$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);[Console]::Out.WriteLine("LOCKED");[Console]::Out.Flush();[void][Console]::In.ReadLine();$f.Dispose();exit 0}catch{[Console]::Error.Write("TEST_LOCK_REJECTED");exit 1}';
  const child = spawn(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const exited = once(child, "exit");
  const ready = once(child.stdout, "data", { signal: AbortSignal.timeout(10_000) });
  child.stdin.write(JSON.stringify({ gate: path.join(options.root, "lock.protected") }) + "\n");
  assert.equal((await ready)[0].toString("utf8").trim(), "LOCKED");
  assert.throws(() => store.read(), { message: "WindowsProtectedStoreRejected" });
  assert.throws(() => store.write(randomBytes(32), "1"), { message: "WindowsProtectedStoreRejected" });
  child.stdin.end("RELEASE\n"); assert.equal((await exited)[0], 0);
  // Lock release after process exit is measured; no lifetime fencing is claimed.
  assert.equal(store.read().revision, "1");
});
