// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, linkSync, unlinkSync } from "node:fs";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { WindowsProtectedStore, windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { initialSignerState } from "../../native/frost/state/file-state-store.mjs";
import { NativeFrostSigner, NativeFrostCoordinator, createNativeSigningPolicy, runTwoPartyDkg,
  FROST_SIGNING_INTENT_PROTOCOL, FROST_SIGNING_MODE, REQUIRED_FROST_SIGNERS } from "../../native/frost/index.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { schnorr } from "@noble/curves/secp256k1.js";
import { ProjectAttester, verifyProjectAttestation } from "../../services/attesters/attestation-service.mjs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";

if (process.platform !== "win32") throw new Error("WINDOWS_PROTECTED_STORAGE_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../..");
const serviceSid = windowsCurrentServiceSid(); // Never logged or committed.
const h = value => createHash("sha256").update(value).digest("hex");
function fixture(t, role = "KINGPEPE_FROST_A", purpose = "frost-state", overrides = {}) {
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
  for (const change of [{ role: "KINGPEPE_FROST_B" }, { keyEpoch: 2 }, { nativeGenesis: h("wrong-genesis") },
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
test("authenticated atomic candidate recovers once after a write interruption", t => {
  const p = committedState(t);
  writeFileSync(stateFile(p.options), p.previous);
  writeFileSync(path.join(p.options.root, "candidate.protected"), p.candidate, { flag: "wx" });
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
  writeFileSync(stateFile(p.options), p.previous);
  writeFileSync(path.join(p.options.root, "candidate.protected"), p.candidate, { flag: "wx" });
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
test("FROST save cannot use a stale object even after reading a new revision", t => {
  const { options } = fixture(t);
  const blob = WindowsProtectedStore.create(options, Buffer.from(JSON.stringify(initialSignerState(options.context.role))));
  const store = new WindowsProtectedFrostStateStore(blob, options.context.role);
  const a = store.load(), b = store.load(); store.save(a); store.load();
  assert.throws(() => store.save(b)); assert.throws(() => store.save(structuredClone(a)), /ProtectedFrostLoadRequired/u);
});

function nativeIntent() {
  return { protocol: FROST_SIGNING_INTENT_PROTOCOL, mode: FROST_SIGNING_MODE, purpose: "WITHDRAWAL", nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: h("protected-local-deployment"), bridgeProgramId: h("manager"), transceiverProgramId: h("transceiver"),
    mint: h("mint"), keyEpoch: 1, proofFingerprint: h("evidence"), unsignedNativeTransactionId: h("transaction"), pauseWithdrawals: false, hardStop: false,
    signingRequestId: h("request"), operationId: h("operation"), withdrawalId: h("withdrawal"), taprootSighashHex: h("public-test-sighash"), transactionCommitment: h("transaction-commitment"),
    signingInputIndex: 0, recipientScriptPubKeyHex: "5120" + h("recipient"), amountAtomic: "1000", feeAtomic: "10", changeScriptPubKeyHex: "5120" + h("reserve"),
    changeAtomic: "2000", inputOutpoints: [h("input") + ":0"], outputCommitments: [h("output")], reserveCommitment: h("reserve-commitment") };
}
test("real A+B FROST signs and reopens using only encrypted persistent state", t => {
  const intent = nativeIntent();
  const policy = createNativeSigningPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: intent.solanaDeployment, bridgeProgramId: intent.bridgeProgramId, transceiverProgramId: intent.transceiverProgramId, mint: intent.mint,
    keyEpoch: 1, maxAmountAtomic: "100000", maxFeeAtomic: "100", reserveScriptPubKeyHex: intent.changeScriptPubKeyHex, authorizedOperations: [intent] });
  const options = REQUIRED_FROST_SIGNERS.map(role => fixture(t, role).options);
  let signers = options.map((o, index) => new NativeFrostSigner({ signerId: o.context.role, index, policy, stateStore: WindowsProtectedFrostStateStore.createLocal(o, policy) }));
  const dkg = runTwoPartyDkg(signers, { epoch: 1 });
  const coordinator = new NativeFrostCoordinator({ signers, publicPackage: dkg.publicPackage, aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey });
  const signed = coordinator.signAutomatically(intent);
  assert(schnorr.verify(Buffer.from(signed.signatureHex, "hex"), Buffer.from(intent.taprootSighashHex, "hex"), Buffer.from(dkg.aggregateTweakedXOnlyPublicKey, "hex")));
  signers.forEach(s => s.close());
  signers = options.map((o, index) => new NativeFrostSigner({ signerId: o.context.role, index, policy,
    stateStore: new WindowsProtectedFrostStateStore(new WindowsProtectedStore(o), o.context.role) }));
  const retry = new NativeFrostCoordinator({ signers, publicPackage: dkg.publicPackage, aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey }).signAutomatically(intent);
  assert.equal(retry.signatureHex, signed.signatureHex);
  signers.forEach(s => s.close());
  for (const o of options) assert.deepEqual(readdirSync(o.root), ["lease.protected", "lock.protected", "state.protected"]);
});
test("attester loads a distinct DPAPI-protected seed with deployment binding", t => {
  const vector = JSON.parse(readFileSync(path.join(repoRoot, "solana/modules/bridge-messages/vectors/canonical-v1.json"))).vectors.find(v => v.name === "deposit-claim-v1");
  const decoded = decodeCanonicalBridgeMessage(vector.encodedHex), seed = randomBytes(32);
  const { options } = fixture(t, "ATTESTER_A", "attester-seed", { nativeGenesis: vector.deployment.nativeGenesis,
    solanaDeployment: vector.deployment.solanaDeployment, keyEpoch: vector.keyEpoch });
  const policy = { role: "ATTESTER_A", attesterPublicKeyHex: Buffer.from(ed25519.getPublicKey(seed)).toString("hex"), protocolId: vector.deployment.protocolId,
    nativeNetwork: vector.deployment.nativeNetwork, nativeGenesisHex: vector.deployment.nativeGenesis, solanaDeploymentHex: vector.deployment.solanaDeployment,
    managerProgramIdHex: vector.deployment.managerProgramId, transceiverProgramIdHex: vector.deployment.transceiverProgramId, mintHex: vector.deployment.mint,
    keyEpoch: vector.keyEpoch, policyEpoch: vector.policyEpoch, acceptedNativeTrust: ["LOCALLY_VALIDATED_CHAIN_STATE"], depositsPaused: false, hardStop: false };
  const store = WindowsProtectedStore.create(options, seed); seed.fill(0);
  assert.throws(() => ProjectAttester.fromWindowsProtectedStore({ store, role: "ATTESTER_A", policy: { ...policy, keyEpoch: policy.keyEpoch + 1 } }));
  let reads = 0;
  const changingPolicy = { ...policy, get nativeGenesisHex() { return reads++ === 0 ? policy.nativeGenesisHex : h("substituted-genesis"); } };
  const attester = ProjectAttester.fromWindowsProtectedStore({ store, role: "ATTESTER_A", policy: changingPolicy });
  assert.equal(reads, 1); assert.equal(attester.policy.nativeGenesisHex, policy.nativeGenesisHex);
  const request = { encodedMessageHex: vector.encodedHex, evidence: { trust: "LOCALLY_VALIDATED_CHAIN_STATE", nativeNetwork: vector.deployment.nativeNetwork,
    nativeGenesisHash: vector.deployment.nativeGenesis, operationIdHex: decoded.operationIdHex, depositOutpoint: decoded.depositOutpointText,
    amountAtomic: decoded.amountAtomic.toString(), solanaRecipientHex: decoded.destinationHex, evidenceDigestHex: decoded.evidenceDigestHex,
    reserveAllocationIdHex: h("allocation"), reserveTransitionState: "CANONICAL_RESERVE", mintCreditState: "AUTHORIZED_UNCONSUMED", finalitySatisfied: true,
    sweepFinalized: true, utxoUnspentAtDeposit: true, noPriorConsumption: true } };
  const attestation = attester.signDepositCredit(request, decoded.validFrom);
  assert.equal(verifyProjectAttestation(attestation, vector.encodedHex), true); attester.close();
});
