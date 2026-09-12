// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// TEST process host, same principal, separate role process. Configuration
// references arrive only over its inherited test-control pipe. Privileged
// service requests use actual pinned mTLS; private shares never leave signers.
import assert from "node:assert/strict";
import { readFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { RemoteIntegrityGuard } from "../../services/supervisor/protected-integrity.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { createNativeSigningPolicy } from "../../native/frost/index.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { openProtectedNativeSigner, ProtectedRemoteFrostPeer } from "../../native/frost/signer/protected-service.mjs";
import { ProtectedCoordinatorSigningJournal } from "../../native/frost/coordinator/protected-signing-journal.mjs";
import { ProtectedSweepJobs } from "../../native/frost/coordinator/protected-sweep-jobs.mjs";
import { sweepJobIpcHandler, ProtectedSweepJobClient } from "../../native/frost/coordinator/sweep-job-ipc.mjs";
import { ProjectAttester } from "../../services/attesters/attestation-service.mjs";
import { ProtectedAttesterAuthorizationJournal } from "../../services/attesters/authorization-journal.mjs";
import { attesterIpcHandler } from "../../services/attesters/protected-service.mjs";
import { ProtectedDepositAttesterClient } from "../../services/attesters/protected-client.mjs";
import { createRawNativeCreditAttestationVerifier } from "../../services/bridge-validator/native-reserve-credit.mjs";
import { ProtectedNativeSweepOutbox } from "../../services/relayer/native-sweep-outbox.mjs";
import { nativeSweepIpcHandler, ProtectedNativeSweepClient } from "../../services/relayer/native-sweep-ipc.mjs";
import { ProtectedSolanaDepositOutbox } from "../../services/relayer/protected-solana-deposit-outbox.mjs";
import { solanaDepositIpcHandler, ProtectedSolanaDepositClient } from "../../services/relayer/solana-deposit-ipc.mjs";
import { ProtectedDepositFeePayer } from "../../services/bridge-validator/protected-deposit-fee-payer.mjs";
import { depositFeePayerIpcHandler, ProtectedDepositFeePayerClient } from "../../services/bridge-validator/deposit-fee-payer-ipc.mjs";
import { ProtectedDepositOperationJournal } from "../../services/bridge-validator/protected-deposit-journal.mjs";
import { depositSnapshotIpcHandler } from "../../services/bridge-validator/protected-deposit-snapshot.mjs";
import { ProtectedDepositController } from "../../services/bridge-validator/protected-deposit-controller.mjs";
import { validateDepositOperationPlan } from "../../services/bridge-validator/deposit-operation-state.mjs";
import { canonicalJson } from "../../native/frost/policy/native-signing-policy.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
import { sanitizedRpcDiagnostic } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
const repoRoot = path.resolve(import.meta.dirname, "../.."), closers = [], servers = [], transports = new Map();
let initialized = false, stopping = false, input = "", taskController, running = [], service, journal, role, stage = "INIT";
const send = value => writeSync(1, JSON.stringify(value) + "\n");
const safe = value => typeof value === "string" && /^[A-Za-z0-9_: -]{1,100}$/u.test(value) ? value : "REDACTED";
function store(options, expectedRole, purpose) {
  assert.equal(options.context.environment, "localnet"); assert.equal(options.context.role, expectedRole); assert.equal(options.context.purpose, purpose);
  const root = path.dirname(path.resolve(options.root));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-ipc-test-"));
  const result = new WindowsProtectedStore(options); closers.push(() => result.close()); return result;
}
function transport(options, expectedRole) {
  const identity = canonicalJson(options), key = path.resolve(options.root), old = transports.get(key);
  if (old) { assert.equal(old.identity, identity); assert.equal(old.role, expectedRole); return old.ipc; }
  const ipc = new ProtectedServiceIpc(store(options, expectedRole, "service-auth"));
  transports.set(key, { identity, role: expectedRole, ipc }); closers.push(() => ipc.close()); return ipc;
}
function verifier(c) {
  const exe = validateRuntimeFile(c.executable, repoRoot); assert.match(c.executableSha256, /^[0-9a-f]{64}$/u);
  assert.equal(createHash("sha256").update(readFileSync(exe)).digest("hex"), c.executableSha256);
  return new LocalNativeEvidenceVerifier({ rpc: new NativeRpcClient(c.rpcOptions), executable: exe });
}
async function listen(options, handler) {
  const server = transport(options, role); servers.push(server); return server.listen(handler);
}
async function start(c) {
  assert.equal(process.platform, "win32"); assert(!initialized); initialized = true; role = c.role;
  const integrity = new RemoteIntegrityGuard({ ipc: transport(c.supervisorOptions, role), port: c.supervisorPort }), p = c.policy;
  taskController = new AbortController(); const signal = taskController.signal, ports = {}, workers = [];
  if (["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"].includes(role)) {
    const plan = validateDepositOperationPlan(c.operationPlan, p), native = verifier(c);
    const policy = createNativeSigningPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: p.nativeGenesis, solanaDeployment: p.solanaDeployment,
      bridgeProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint, keyEpoch: p.keyEpoch,
      maxAmountAtomic: p.maximumAmountAtomic, maxFeeAtomic: p.maximumFeeAtomic, reserveScriptPubKeyHex: plan.depositPolicy.canonicalReserveScriptPubKeyHex,
      authorizedOperations: plan.signingIntents });
    const base = new WindowsProtectedFrostStateStore(store(c.stateOptions, role, "frost-state"), role);
    service = await openProtectedNativeSigner({ base, policy, integrity,
      nativeEvidenceValidator: async intent => {
        assert(plan.signingIntents.some(v => canonicalJson(v) === canonicalJson(intent)));
        return native.verifySweepSigning({ inputs: plan.inputs, minimumConfirmations: p.minimumConfirmations, acceptedCheckpoint: plan.acceptedCheckpoint,
          unsignedTransactionHex: plan.unsignedTransactionHex, reserveAmountAtomic: plan.depositIntent.amountAtomic, feeAtomic: intent.feeAtomic,
          reserveScriptHex: plan.depositPolicy.canonicalReserveScriptPubKeyHex, intent, tapscriptSpends: [plan.depositPolicy.sweep, ...plan.inputs.slice(1).map(() => undefined)] });
      } });
    ports.service = await listen(c.serverOptions, service.handler);
  } else if (role === "COORDINATOR") {
    const signers = c.signers.map(v => new ProtectedRemoteFrostPeer({ ipc: transport(v.options, role), port: v.port, signerId: v.role }));
    journal = await ProtectedCoordinatorSigningJournal.open({ store: store(c.journalOptions, role, "coordinator-signing"), integrity, ...c.publicPackage });
    closers.push(() => journal.close());
    service = await ProtectedSweepJobs.open({ store: store(c.jobsOptions, role, "coordinator-jobs"), integrity, policy: p, signers, signingJournal: journal, ...c.publicPackage });
    ports.service = await listen(c.serverOptions, sweepJobIpcHandler({ jobs: service, policy: p, integrity }));
    workers.push(() => service.run({ signal, onStatus: s => send({ event: "STATUS", state: safe(s.state), reason: safe(s.reason) }) }));
  } else if (["ATTESTER_A", "ATTESTER_B"].includes(role)) {
    const attester = ProjectAttester.fromWindowsProtectedStore({ store: store(c.seedOptions, role, "attester-seed"), role, policy: c.attesterPolicy });
    closers.push(() => attester.close());
    service = await ProtectedAttesterAuthorizationJournal.open({ store: store(c.journalOptions, role, "attester-authorizations"), integrity, attester });
    ports.service = await listen(c.serverOptions, attesterIpcHandler({ attester, integrity, journal: service,
      verifyNativeDeposit: createRawNativeCreditAttestationVerifier({ policy: p, nativeVerifier: verifier(c) }) }));
  } else if (role === "RELAYER") {
    const native = await ProtectedNativeSweepOutbox.open({ store: store(c.nativeOptions, role, "native-sweep-outbox"), integrity, policy: p,
      rpc: new NativeRpcClient(c.rpcOptions), nativeVerifier: verifier(c) });
    closers.push(() => native.close());
    service = await ProtectedSolanaDepositOutbox.open({ store: store(c.solanaOptions, role, "solana-deposit-outbox"), integrity, policy: c.deliveryPolicy, endpoint: c.endpoint });
    const nativeHandler = nativeSweepIpcHandler({ outbox: native, policy: p, integrity }), solanaHandler = solanaDepositIpcHandler({ outbox: service, policy: c.deliveryPolicy, integrity });
    ports.service = await listen(c.serverOptions, request => ["enqueueNativeSweep", "nativeSweepStatus"].includes(request.method) ? nativeHandler(request) : solanaHandler(request));
    workers.push(() => native.run({ signal }), () => service.run({ signal, onStatus: status => send({ event: "STATUS",
      state: safe(status.state), reason: safe(status.reason), ...sanitizedRpcDiagnostic({ code: status.rpcCode,
        executionFault: status.executionFault, transactionFailure: status.transactionFailure,
        instructionFailure: status.instructionFailure }) }) }));
  } else if (role === "FEE_PAYER") {
    service = await ProtectedDepositFeePayer.open({ store: store(c.seedOptions, role, "fee-payer-seed"), integrity, policy: c.deliveryPolicy, endpoint: c.endpoint });
    ports.service = await listen(c.serverOptions, depositFeePayerIpcHandler({ feePayer: service, integrity, policy: c.deliveryPolicy }));
  } else {
    assert.equal(role, "BRIDGE_VALIDATOR"); const dp = c.deliveryPolicy;
    journal = await ProtectedDepositOperationJournal.open({ store: store(c.journalOptions, role, "deposit-operations"), integrity, policy: p });
    closers.push(() => journal.close());
    ports.snapshot = await listen(c.snapshotServerOptions, depositSnapshotIpcHandler({ journal, integrity, policy: p }));
    const client = (v, Type, policy) => new Type({ ipc: transport(v.options, role), port: v.port, role: v.role, policy });
    const native = verifier(c);
    if (c.killBoundary === "NATIVE_FINALITY_BEFORE_CREDIT_PERSIST") {
      // Actual verifier result first; the TEST crash hook cannot invent a proof.
      const verify = native.verifyReserve.bind(native);
      native.verifyReserve = async (...args) => {
        const result = await verify(...args);
        send({ event: "BOUNDARY", stage: "NATIVE_FINALITY_BEFORE_CREDIT_PERSIST" });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        return result;
      };
    }
    service = await ProtectedDepositController.open({ store: store(c.controllerOptions, role, "deposit-controller"), integrity,
      policy: { deliveryPolicy: dp, creditValiditySeconds: 3600 }, journal, nativeVerifier: native, endpoint: c.endpoint,
      jobs: client(c.jobs, ProtectedSweepJobClient, p), nativeOutbox: client(c.nativeOutbox, ProtectedNativeSweepClient, p),
      solanaOutbox: client(c.solanaOutbox, ProtectedSolanaDepositClient, dp), feePayer: client(c.feePayer, ProtectedDepositFeePayerClient, dp),
      attesters: c.attesters.map(v => client(v, ProtectedDepositAttesterClient, dp)),
      onTransition: async value => { send({ event: "BOUNDARY", stage: value.stage }); if (c.killBoundary === value.stage)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); } });
    // Advertise initialized endpoints before the TEST may suspend at the first
    // durable observation. No operation is authorized by readiness itself.
    workers.push(async () => {
      await service.submit(c.operationPlan);
      return service.run({ signal, onStatus: async status => {
      send({ event: "STATUS", state: status.state, reason: status.reason });
      if (status.state === "COMPLETED") { send({ event: "COMPLETED", result: status, book: await journal.inspect(status.operationId) }); taskController.abort(); }
      } });
    });
  }
  closers.push(() => service?.close());
  if (c.probeStop === true) {
    const action = { KINGPEPE_FROST_A: "FROST_SIGN", KINGPEPE_FROST_B: "FROST_SIGN", COORDINATOR: "COORDINATE_SWEEP",
      ATTESTER_A: "ATTEST_MINT_CREDIT", ATTESTER_B: "ATTEST_MINT_CREDIT", RELAYER: "SUBMIT_CLAIM",
      FEE_PAYER: "SIGN_SOLANA_CLAIM", BRIDGE_VALIDATOR: "AUTHORIZE_CLAIM" }[role];
    assert(action); assert.equal((await integrity.status(c.operationPlan.operationId)).state, "HARD_STOP_INTEGRITY");
    await assert.rejects(integrity.assertRunning(c.operationPlan.operationId, action), /IntegrityAuthorizationStopped/u);
    send({ event: "STOP_REJECTED", role });
  }
  send({ event: "READY", role, ports });
  // A retained-stop probe uses the real guard before concurrent background
  // work starts. A busy transport must never masquerade as proof of a stop.
  running = workers.map(worker => Promise.resolve().then(worker).catch(error => {
    if (!stopping) { send({ event: "FAILED", stage, reason: safe(error?.message) }); process.exitCode = 1; }
  }));
}
async function stop() {
  if (stopping) return; stopping = true; taskController?.abort(); await Promise.all(running);
  for (const closer of [...closers].reverse()) { try { await closer(); } catch { process.exitCode = 1; } }
  send({ event: "CLOSED" });
}
let queue = Promise.resolve(), commands = 0;
process.stdin.on("data", bytes => {
  input += bytes.toString("utf8");
  if (input.length > 250000) { process.exitCode = 1; process.stdin.destroy(); void stop(); return; }
  for (;;) {
    const at = input.indexOf("\n"); if (at < 0) break;
    const line = input.slice(0, at); input = input.slice(at + 1);
    if (++commands > 2) { process.exitCode = 1; process.stdin.destroy(); void stop(); return; }
    queue = queue.then(async () => { const [method, payload] = JSON.parse(line);
      if (method === "INIT") await start(payload); else { assert.equal(method, "STOP"); await stop(); }
    }).catch(async error => { send({ event: "FAILED", stage, reason: safe(error?.message) }); process.exitCode = 1; await stop(); });
  }
});
process.stdin.on("end", () => { void queue.finally(stop); });
process.stdin.on("error", () => { void queue.finally(stop); });
