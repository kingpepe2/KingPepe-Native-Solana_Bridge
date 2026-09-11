// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { WindowsProtectedStore, windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { WindowsFencedFrostStateStore } from "../../native/frost/state/windows-fenced-state-store.mjs";
import { createLocalNativeDkgPolicy } from "../../native/frost/policy/native-signing-policy.mjs";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { NativeFrostSigner, NativeFrostCoordinator, runTwoPartyDkg, createNativeSigningPolicy, createNativeFrostSigningRequest,
  FROST_SIGNING_INTENT_PROTOCOL, FROST_SIGNING_MODE } from "../../native/frost/index.mjs";
import { schnorr } from "@noble/curves/secp256k1.js";

if (process.platform !== "win32") throw new Error("WINDOWS_FENCING_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../.."), serviceSid = windowsCurrentServiceSid();
const h = value => createHash("sha256").update(value).digest("hex");
async function fixture(t, role = "KINGPEPE_FROST_A") {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-fence-test-")), stores = [];
  t.after(async () => {
    for (const store of stores) await store.close();
    assert(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith("kingpepe-fence-test-"), "UnsafeTestCleanup");
    try { rmSync(root, { recursive: true }); } catch { throw new Error("FencingTestCleanupFailed"); }
  });
  const context = { role, serviceSid, environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: h("local-fenced-deployment"), instanceId: h("instance-" + role), keyEpoch: 1 };
  const stateOptions = { root: path.join(root, "state"), anchorRoot: path.join(root, "state-anchor"), repoRoot, context: { ...context, purpose: "frost-state" } };
  const fenceOptions = { root: path.join(root, "fence"), anchorRoot: path.join(root, "fence-anchor"), repoRoot, context: { ...context, purpose: "signer-fence" } };
  const policy = createLocalNativeDkgPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: context.solanaDeployment, bridgeProgramId: h("bridge"), transceiverProgramId: h("transceiver"), mint: h("mint"), keyEpoch: 1 });
  const base = WindowsProtectedFrostStateStore.createLocal(stateOptions, policy);
  const store = await WindowsFencedFrostStateStore.createLocal({ base, fenceOptions, policy }); stores.push(store);
  async function reopen() {
    const result = await WindowsFencedFrostStateStore.openLocal({ base: new WindowsProtectedFrostStateStore(new WindowsProtectedStore(stateOptions), role), fence: new WindowsProtectedStore(fenceOptions), policy });
    stores.push(result); return result;
  }
  return { root, store, base, stores, reopen, stateOptions, fenceOptions, policy };
}
for (const role of ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]) test("lifetime kernel handle rejects simultaneous signer: " + role, async t => {
  const f = await fixture(t, role); assert.equal(f.store.publicFence().persistentFenceEpoch, "1");
  await assert.rejects(f.reopen());
  // Read/update still work while the separate lease, not the per-write lock, is held.
  const state = f.store.load(); f.store.save(state); assert.equal(f.store.publicFence().stateRevision, "2");
  await f.store.close(); const restarted = await f.reopen();
  assert.equal(restarted.publicFence().persistentFenceEpoch, "2"); assert.equal(restarted.publicFence().stateRevision, "2");
  assert.throws(() => f.store.load());
});

test("restoring signer state and its anchor cannot roll back the retained fence", async t => {
  const f = await fixture(t), files = [path.join(f.stateOptions.root, "state.protected"), path.join(f.stateOptions.anchorRoot, "state.protected")];
  const old = files.map(p => readFileSync(p)); f.store.save(f.store.load()); await f.store.close();
  files.forEach((p, i) => writeFileSync(p, old[i])); await assert.rejects(f.reopen());
});

test("stale loaded object cannot overwrite a newer signer revision", async t => {
  const f = await fixture(t), old = f.store.load(), current = f.store.load();
  f.store.save(current); assert.throws(() => f.store.save(old)); assert.throws(() => f.store.load());
});

test("missing lifetime lease is not silently recreated", async t => {
  const f = await fixture(t); await f.store.close();
  rmSync(path.join(f.fenceOptions.anchorRoot, "lifetime.protected"));
  await assert.rejects(f.reopen());
});

test("copied fence bound to another role or deployment cannot activate", async t => {
  const f = await fixture(t); await f.store.close();
  for (const changes of [{ role: "KINGPEPE_FROST_B" }, { solanaDeployment: h("other-deployment") }, { instanceId: h("other-instance") }]) {
    const fence = new WindowsProtectedStore({ ...f.fenceOptions, context: { ...f.fenceOptions.context, ...changes } });
    await assert.rejects(WindowsFencedFrostStateStore.openLocal({ base: new WindowsProtectedFrostStateStore(new WindowsProtectedStore(f.stateOptions), "KINGPEPE_FROST_A"), fence, policy: f.policy }));
  }
});

test("stale persistent fence epoch is rejected by a running instance", async t => {
  const f = await fixture(t), external = new WindowsProtectedStore(f.fenceOptions), snapshot = external.read();
  let record;
  try { record = JSON.parse(snapshot.payload.toString("utf8")); } finally { snapshot.payload.fill(0); }
  record.persistentFenceEpoch = "0"; const bytes = Buffer.from(JSON.stringify(record));
  try { external.write(bytes, snapshot.revision); } finally { bytes.fill(0); }
  assert.throws(() => f.store.load());
});

function actor(f, step = undefined) {
  const source = `import{WindowsProtectedStore}from'./shared/windows/protected-store.mjs';
import{WindowsProtectedFrostStateStore}from'./native/frost/state/windows-protected-state-store.mjs';
import{WindowsFencedFrostStateStore}from'./native/frost/state/windows-fenced-state-store.mjs';
import{createLocalNativeDkgPolicy}from'./native/frost/policy/native-signing-policy.mjs';
import{NativeFrostSigner,createNativeSigningPolicy,createNativeFrostSigningRequest}from'./native/frost/index.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;const x=JSON.parse(input);
try{const policy=x.step?createNativeSigningPolicy(x.step.policy):createLocalNativeDkgPolicy(x.policy),base=new WindowsProtectedFrostStateStore(new WindowsProtectedStore(x.stateOptions),x.stateOptions.context.role);
const store=await WindowsFencedFrostStateStore.openLocal({base,fence:new WindowsProtectedStore(x.fenceOptions),policy});
if(x.step){const signer=new NativeFrostSigner({signerId:x.stateOptions.context.role,index:0,policy,stateStore:store,nativeEvidenceValidator:async v=>({digestHex:v.proofFingerprint})});
if(x.step.mode==='NONCE_RESERVED'){const persist=store.save.bind(store);store.save=state=>{persist(state);if(state.nonceReservationCounter!=='0'){process.stdout.write('ACTIVE\\n');process.kill(process.pid,'SIGKILL');}};}
await signer.verifyNativeEvidence(x.step.intent);const request=createNativeFrostSigningRequest(x.step.intent),commitment=signer.signingCommitment(request);
if(x.step.mode==='SIGNATURE_SHARE')signer.signatureShare(request,[commitment,x.step.otherCommitment]);
}else store.save(store.load());process.stdout.write('ACTIVE\\n');setInterval(()=>{},1000);
}catch{process.stdout.write('REJECTED\\n');process.exitCode=2;}`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { cwd: repoRoot, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const ready = new Promise((resolve, reject) => {
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("FenceActorTimeout")); }, 20000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("FenceActorFailed")); });
    child.stderr.on("data", () => { clearTimeout(timer); child.kill(); reject(new Error("FenceActorFailed")); });
    child.stdout.on("data", bytes => { output += bytes.toString("utf8");
      if (["ACTIVE\n", "REJECTED\n"].includes(output)) { clearTimeout(timer); resolve(output.trim()); }
      else if (output.length > 32) { clearTimeout(timer); child.kill(); reject(new Error("FenceActorOutputRejected")); }
    });
  });
  const ended = new Promise(resolve => child.once("close", resolve));
  child.stdin.end(JSON.stringify({ stateOptions: f.stateOptions, fenceOptions: f.fenceOptions, policy: f.policy, step }));
  return { child, ready, ended };
}

for (const role of ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]) test("actual duplicate process and killed signer restart: " + role, async t => {
  const f = await fixture(t, role), duplicate = actor(f);
  assert.equal(await duplicate.ready, "REJECTED"); await duplicate.ended;
  await f.store.close(); const live = actor(f);
  try {
    assert.equal(await live.ready, "ACTIVE");
    const second = actor(f); assert.equal(await second.ready, "REJECTED"); await second.ended;
  } finally { live.child.kill("SIGKILL"); await live.ended; }
  // The killed parent closes the inherited pipe. Its helper releases the kernel
  // handle; if not yet released, wait only for that dependency, never reset it.
  let reopened;
  for (let i = 0; i < 5 && !reopened; i++) {
    try { reopened = await f.reopen(); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(reopened, "KilledSignerLeaseNotReleased");
  assert.equal(reopened.publicFence().persistentFenceEpoch, "3");
  assert.equal(reopened.publicFence().stateRevision, "2");
});

for (const mode of ["NONCE_RESERVED", "NONCE_COMMITMENT", "SIGNATURE_SHARE"]) test("real FROST process kill after durable " + mode, async t => {
  const a = await fixture(t, "KINGPEPE_FROST_A"), b = await fixture(t, "KINGPEPE_FROST_B");
  const dkgSigners = [a, b].map((f, index) => new NativeFrostSigner({ signerId: f.stateOptions.context.role, index, policy: f.policy, stateStore: f.store }));
  const dkg = runTwoPartyDkg(dkgSigners, { epoch: 1 }); dkgSigners.forEach(s => s.close());
  const intent = { protocol: FROST_SIGNING_INTENT_PROTOCOL, mode: FROST_SIGNING_MODE, purpose: "RESERVE_SWEEP", nativeNetwork: "regtest",
    nativeGenesisHash: REGTEST_GENESIS, solanaDeployment: a.policy.solanaDeployment, bridgeProgramId: a.policy.bridgeProgramId,
    transceiverProgramId: a.policy.transceiverProgramId, mint: a.policy.mint, keyEpoch: 1, signingRequestId: h("crash-request"), operationId: h("crash-operation"), withdrawalId: h("deposit-id"),
    proofFingerprint: h("local-evidence-fixture"), unsignedNativeTransactionId: h("unsigned-tx"), transactionCommitment: h("commitment"), signingInputIndex: 0,
    taprootSighashHex: h("crash-sighash"), recipientScriptPubKeyHex: "5120" + h("reserve"), amountAtomic: "1000", feeAtomic: "10",
    changeScriptPubKeyHex: "5120" + h("reserve"), changeAtomic: "100", inputOutpoints: [h("input") + ":0"], outputCommitments: [h("output")], reserveCommitment: h("allocation"),
    pauseWithdrawals: false, hardStop: false };
  const policyOptions = { ...a.policy, maxAmountAtomic: "10000", maxFeeAtomic: "100", reserveScriptPubKeyHex: intent.changeScriptPubKeyHex, authorizedOperations: [intent] };
  const policy = createNativeSigningPolicy(policyOptions), request = createNativeFrostSigningRequest(intent);
  const signerB = new NativeFrostSigner({ signerId: "KINGPEPE_FROST_B", index: 1, policy, stateStore: b.store, nativeEvidenceValidator: async v => ({ digestHex: v.proofFingerprint }) });
  t.after(() => signerB.close());
  await signerB.verifyNativeEvidence(intent);
  const otherCommitment = mode === "SIGNATURE_SHARE" ? signerB.signingCommitment(request) : undefined;
  await a.store.close(); const live = actor(a, { mode, policy: policyOptions, intent, otherCommitment });
  try { assert.equal(await live.ready, "ACTIVE"); } finally { live.child.kill("SIGKILL"); await live.ended; }
  const base = new WindowsProtectedFrostStateStore(new WindowsProtectedStore(a.stateOptions), "KINGPEPE_FROST_A");
  const store = await WindowsFencedFrostStateStore.openLocal({ base, fence: new WindowsProtectedStore(a.fenceOptions), policy }); a.stores.push(store);
  const signerA = new NativeFrostSigner({ signerId: "KINGPEPE_FROST_A", index: 0, policy, stateStore: store, nativeEvidenceValidator: async v => ({ digestHex: v.proofFingerprint }) });
  t.after(() => signerA.close()); await signerA.verifyNativeEvidence(intent);
  assert.equal(store.publicFence().nonceHighWaterMark, "1");
  if (mode !== "SIGNATURE_SHARE") {
    assert.throws(() => signerA.signingCommitment(request), /already burned/u);
    assert.equal(store.publicFence().nonceHighWaterMark, "1");
  } else {
    const coordinator = new NativeFrostCoordinator({ signers: [signerA, signerB], publicPackage: dkg.publicPackage, aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey });
    const signed = await coordinator.signAutomaticallyWithNativeEvidence(intent);
    assert(schnorr.verify(Buffer.from(signed.signatureHex, "hex"), Buffer.from(intent.taprootSighashHex, "hex"), Buffer.from(dkg.aggregateTweakedXOnlyPublicKey, "hex")), "RecoveredFrostSignatureRejected");
    const retry = await new NativeFrostCoordinator({ signers: [signerA, signerB], publicPackage: dkg.publicPackage, aggregateTweakedXOnlyPublicKey: dkg.aggregateTweakedXOnlyPublicKey }).signAutomaticallyWithNativeEvidence(intent);
    assert.equal(retry.signatureHex, signed.signatureHex);
    assert.equal(store.publicFence().nonceHighWaterMark, "1");
  }
  const rollback = store.load(); rollback.nonceReservationCounter = "0";
  assert.throws(() => store.save(rollback)); assert.throws(() => store.load());
});

for (const position of ["BEFORE_STATE_WRITE", "AFTER_STATE_WRITE"]) test("authenticated prepared fence recovery: " + position, async t => {
  const f = await fixture(t); await f.store.close();
  const base = new WindowsProtectedFrostStateStore(new WindowsProtectedStore(f.stateOptions), "KINGPEPE_FROST_A");
  const fence = new WindowsProtectedStore(f.fenceOptions), before = fence.read();
  let record; try { record = JSON.parse(before.payload.toString("utf8")); } finally { before.payload.fill(0); }
  const state = base.load();
  record.pending = { stateRevision: (BigInt(record.stateRevision) + 1n).toString(), stateDigest: createHash("sha256").update(canonicalJson(state)).digest("hex"), nonceHighWaterMark: state.nonceReservationCounter };
  const bytes = Buffer.from(JSON.stringify(record)); try { fence.write(bytes, before.revision); } finally { bytes.fill(0); }
  if (position === "AFTER_STATE_WRITE") base.save(state);
  base.close(); fence.close(); const restarted = await f.reopen();
  assert.equal(restarted.publicFence().persistentFenceEpoch, "2");
  assert.equal(restarted.publicFence().stateRevision, position === "AFTER_STATE_WRITE" ? "2" : "1");
});
