// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Explicit Windows TEST harness: existing protected A/B processes and retained
// bridge workers, Native regtest only, already-enrolled Solana Devnet only.
// No deployment, airdrop, production credential or automatic balance repair.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statfsSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createLocalSecurityFixture } from "../../tests/windows/local-security-fixture.mjs";
import { buildRegtestDaemonArguments, buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { WindowsProtectedStore } from "../../shared/windows/protected-store.mjs";
import { ProtectedServiceIpc } from "../../shared/windows/service-ipc.mjs";
import { validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { DEVNET_SOLANA_GENESIS } from "../../shared/solana-test-network.mjs";
import { NativeFrostSigner, NativeFrostCoordinator, runTwoPartyDkg, REQUIRED_FROST_SIGNERS } from "../../native/frost/index.mjs";
import { createLocalNativeDkgPolicy } from "../../native/frost/policy/native-signing-policy.mjs";
import { WindowsProtectedFrostStateStore } from "../../native/frost/state/windows-protected-state-store.mjs";
import { ProtectedRemoteFrostPeer } from "../../native/frost/signer/protected-service.mjs";
import { ProtectedCoordinatorSigningJournal, initialCoordinatorSigningState } from "../../native/frost/coordinator/protected-signing-journal.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier, REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import { witnessAddressFromScript } from "../../native/node/witness-address.mjs";
import { AuthenticatedLocalDepositLedger } from "../../services/bridge-validator/local-deposit-ledger.mjs";
import { AutomaticNativeToSolanaDeposit } from "../../services/bridge-validator/automatic-native-deposit.mjs";
import { AutomaticSolanaToNativeWithdrawal } from "../../services/bridge-validator/automatic-withdrawal.mjs";
import { FinalizedWithdrawalReader } from "../../services/solana-observer/finalized-withdrawal.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot, devnetTestManifest } from "../../services/solana-observer/deployment-integrity.mjs";
import { ProjectAttester } from "../../services/attesters/attestation-service.mjs";
import { LocalBridgeService } from "../../services/relayer/withdrawal-service.mjs";
import { BridgeUserApi } from "../../services/bridge-validator/user-api.mjs";
import { SolanaLocalRpcClient, sanitizedRpcDiagnostic } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { base58Decode, base58Encode, shortvecEncode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { encodeCanonicalBridgeMessage, decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { createNativeDepositRequest, createSolanaWithdrawalRequest } from "../ts/sdk/bridge.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../.."), exec = promisify(execFile);
const hash = v => createHash("sha256").update(v).digest("hex"), keyHex = v => Buffer.from(base58Decode(v)).toString("hex");
const json = v => JSON.stringify(v, (_, value) => typeof value === "bigint" ? value.toString() : value);
const required = name => { assert(process.env[name], "DevnetTestSettingMissing:" + name); return process.env[name]; };
let interrupted = false, failedDiskSample;
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; });
function diskGuard({ allowInterrupted = false } = {}) {
  assert(allowInterrupted || !interrupted, "TestInterrupted");
  assert.equal(process.platform, "win32", "DevnetProtectedTestRequiresWindows");
  const free = drive => { const v = statfsSync(drive, { bigint: true }); return v.bavail * v.bsize; };
  const space = { cFree: free("C:/").toString(), dFree: free("D:/").toString() };
  if (BigInt(space.cFree) < 8n * 1024n ** 3n || BigInt(space.dFree) < 4n * 1024n ** 3n) {
    // Retain the failing sample, not just a later sample after shutdown. The
    // overnight observation showed that host free space can recover meanwhile.
    failedDiskSample ??= { observedAt: new Date().toISOString(), ...space,
      minimumCFree: (8n * 1024n ** 3n).toString(), minimumDFree: (4n * 1024n ** 3n).toString() };
    throw new Error("TestDiskHeadroomRequired");
  }
  for (const name of ["TEMP", "TMP", "KINGPEPE_E2E_ROOT"]) assert(/^D:[\\/]/iu.test(required(name)), "TestHeavyOutputMustUseDataDrive");
  return space;
}
function linuxPath(value) {
  const absolute = path.resolve(value); assert(/^D:\\/iu.test(absolute), "NativeTestDataDriveRequired");
  return "/mnt/d/" + absolute.slice(3).replaceAll("\\", "/");
}
async function unusedPort() {
  const server = createServer(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function protectedSigner(store, expectedPublicKey) {
  const result = store.read(); assert.equal(result.payload.length, 32, "TestSeedLengthRejected");
  const seed = result.payload, publicBytes = Buffer.from(ed25519.getPublicKey(seed));
  const publicKeyBase58 = base58Encode(publicBytes);
  if (expectedPublicKey) assert.equal(publicKeyBase58, expectedPublicKey, "TestPublicIdentityMismatch");
  return { publicKeyBase58, publicKeyHex: publicBytes.toString("hex"), sign: bytes => Buffer.from(ed25519.sign(bytes, seed)),
    close() { seed.fill(0); store.close(); } };
}
function startSigner(configuration) {
  const child = spawn(process.execPath, [path.join(repoRoot, "tests/windows/local-deposit-service-actor.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let input = "", closing = false, failure;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const end = new Promise(resolve => child.once("close", code => { if (!closing) rejectReady(new Error("DevnetTestSignerExited")); resolve(code); }));
  const fail = () => { failure = new Error("DevnetTestSignerFailed"); rejectReady(failure); };
  child.once("error", fail); child.stderr.on("data", fail); child.stdin.on("error", fail);
  child.stdout.on("data", bytes => {
    input += bytes.toString("utf8"); if (input.length > 32768) { fail(); child.kill(); return; }
    for (;;) {
      const at = input.indexOf("\n"); if (at < 0) break;
      const line = input.slice(0, at); input = input.slice(at + 1);
      try {
        const value = JSON.parse(line);
        if (value.event === "READY") resolveReady(value.ports.service);
        else if (value.event === "FAILED") fail();
      } catch { fail(); }
    }
  });
  child.stdin.write(json(["INIT", configuration]) + "\n");
  return { ready: async () => {
    const timer = setTimeout(() => rejectReady(new Error("DevnetTestSignerStartupTimeout")), 30000);
    try { return await ready; } finally { clearTimeout(timer); }
  }, async close() {
    if (closing) return; closing = true;
    child.stdin.end(json(["STOP"]) + "\n"); const timer = setTimeout(() => child.kill(), 15000);
    try { await end; } finally { clearTimeout(timer); }
    if (failure) throw failure;
  } };
}

let stage = "PREFLIGHT", root, fixture, ledger, nativeChild, nativeCli, miner, stopHealth = false, healthTask, phaseError;
let activeActors = [], activeTransports = [], signingJournal;
const closers = [], evidence = { phase: 16, status: "IN_PROGRESS", productionReady: false, mainnetActivation: "DISABLED", events: [] };
function retain(name, value) {
  assert(/^[a-z0-9-]+\.json$/u.test(name));
  const file = path.join(root, name), bytes = json(value) + "\n";
  if (existsSync(file)) { assert.equal(readFileSync(file, "utf8"), bytes, "RetainedTestRecordChanged"); return; }
  writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
}
function event(name, data = {}) {
  const value = { name, time: new Date().toISOString(), ...data }; evidence.events.push(value);
  if (evidence.events.length > 512) evidence.events.shift();
  console.log(json(value));
}
async function closeSigning() {
  for (const child of activeActors.splice(0)) await child.close();
  for (const ipc of activeTransports.splice(0)) await ipc.close();
  await signingJournal?.close(); signingJournal = undefined;
}
try {
  evidence.diskBefore = diskGuard();
  assert(!process.env.KINGPEPE_PRODUCTION_ACTIVATION, "ProductionForbiddenInTestHarness");
  const soakOption = process.env.KINGPEPE_DEVNET_SOAK_SECONDS;
  const soakSeconds = soakOption === undefined ? 0 : Number(soakOption);
  assert(soakOption === undefined || /^[1-9][0-9]*$/u.test(soakOption) && Number.isSafeInteger(soakSeconds) &&
    soakSeconds >= 60 && soakSeconds <= 28 * 86400 && process.env.KINGPEPE_DEVNET_TEST_RUN, "TestSoakConfigurationRejected");
  if (soakSeconds) evidence.phase = 17;
  const record = JSON.parse(readFileSync(path.join(repoRoot, "docs/deployment/devnet.json")));
  const manifest = devnetTestManifest(record), endpoint = required("SOLANA_DEVNET_RPC_URL");
  const rpc = new SolanaLocalRpcClient({ endpoint, environment: "devnet", expectedGenesis: DEVNET_SOLANA_GENESIS });
  const solana = new LocalDeploymentRpc({ endpoint, environment: "devnet", expectedGenesis: DEVNET_SOLANA_GENESIS });
  assert.equal(await rpc.call("getGenesisHash"), DEVNET_SOLANA_GENESIS);
  const initial = verifyDeploymentSnapshot(manifest, await solana.snapshot(manifest));
  if (!process.env.KINGPEPE_DEVNET_TEST_RUN) assert.equal(initial.mintSupplyAtomic, "0", "ExistingDevnetSupplyRequiresExistingStateRecovery");
  // Verify complete finalized discovery through the supported history API
  // before opening signing state or spending fees. Unavailable is never empty.
  stage = "RPC_CAPABILITIES";
  await new FinalizedWithdrawalReader({ rpc: solana, manifest }).discover([]);
  stage = "PREPARATION";
  const local = JSON.parse(readFileSync(validateRuntimeFile(required("KINGPEPE_DEVNET_TEST_CONTEXT"), repoRoot)));
  const resumeRoot = process.env.KINGPEPE_DEVNET_TEST_RUN;
  const e2eRoot = validateRuntimeStateRoot(required("KINGPEPE_E2E_ROOT"), repoRoot);
  root = resumeRoot ? validateRuntimeStateRoot(resumeRoot, repoRoot) : path.join(e2eRoot, "devnet-service-" + randomBytes(8).toString("hex"));
  assert(path.dirname(root) === path.resolve(e2eRoot) && /^devnet-service-[0-9a-f]{16}$/u.test(path.basename(root)), "TestRunRootRejected");
  if (!resumeRoot) mkdirSync(root);
  retain("test-run.json", { kind: "KINGPEPE_DEVNET_REGTEST_TEST_ONLY", programSourceSha: record.sourceSha, solanaGenesis: DEVNET_SOLANA_GENESIS });
  const saved = resumeRoot ? JSON.parse(readFileSync(validateRuntimeFile(path.join(root, "local-recovery-context.json"), repoRoot))) : undefined;
  const runtimeFile = path.join(root, "local-runtime-context.json");
  const retainedRuntime = existsSync(runtimeFile) ? JSON.parse(readFileSync(validateRuntimeFile(runtimeFile, repoRoot))) : undefined;
  if (saved) {
    assert(retainedRuntime, "ExistingEconomicStateRequiresRetainedAuthority");
    const store = new WindowsProtectedStore(saved.keyOptions);
    try { ledger = AuthenticatedLocalDepositLedger.fromProtectedLocalKey(saved.ledgerOptions, store); } finally { store.close(); }
    assert.equal(ledger.status().state, "OPEN_LOCAL_ACCOUNTING_ONLY", "RetainedPauseRequiresManualReview");
  }
  evidence.sourceSha = (await exec("git", ["rev-parse", "HEAD"], { cwd: repoRoot, windowsHide: true })).stdout.trim();
  evidence.sourceWorktreeClean = (await exec("git", ["status", "--porcelain=v1"], { cwd: repoRoot, windowsHide: true })).stdout.trim() === "";
  evidence.harnessSha256 = hash(readFileSync(import.meta.filename));
  evidence.programSourceSha = record.sourceSha; evidence.borshSchemaVersion = 2;
  event("DEVNET_IDENTITY_VERIFIED", { mint: manifest.mint.id, observedSupplyAtomic: initial.mintSupplyAtomic });

  const partial = { environment: "localnet", nativeGenesis: REGTEST_GENESIS, solanaDeployment: manifest.solanaDeploymentHex,
    managerProgramId: keyHex(manifest.manager.id), transceiverProgramId: keyHex(manifest.transceiver.id), mint: keyHex(manifest.mint.id), keyEpoch: manifest.config.keyEpoch };
  fixture = await createLocalSecurityFixture({ repoRoot, policy: partial, authorityOptions: retainedRuntime?.authorityOptions,
    testCertificateDays: Math.ceil(soakSeconds / 86400) + 1 });
  if (!retainedRuntime) retain("local-runtime-context.json", { authorityOptions: fixture.authorityOptions });
  // Only the test ceremony initializes private shares. Runtime receives the
  // public package and references to separate OS-protected A/B stores.
  stage = "PROTECTED_TEST_DKG";
  const dkgPolicy = createLocalNativeDkgPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: REGTEST_GENESIS,
    solanaDeployment: partial.solanaDeployment, bridgeProgramId: partial.managerProgramId, transceiverProgramId: partial.transceiverProgramId,
    mint: partial.mint, keyEpoch: partial.keyEpoch });
  const material = saved?.signerMaterial ?? [], setupSigners = [], setupStates = [];
  let publicPackage = saved?.publicPackage;
  try {
    if (!saved) {
    for (const [index, role] of REQUIRED_FROST_SIGNERS.entries()) {
      const stateOptions = fixture.options("frost-" + index, role, "frost-state");
      const state = await WindowsProtectedFrostStateStore.createLocal(stateOptions, dkgPolicy).acquireExclusive(); setupStates.push(state);
      setupSigners.push(new NativeFrostSigner({ signerId: role, index, policy: dkgPolicy, stateStore: state })); material.push({ role, stateOptions });
    }
    const result = runTwoPartyDkg(setupSigners, { epoch: partial.keyEpoch });
    publicPackage = { publicPackage: result.publicPackage, aggregateTweakedXOnlyPublicKey: result.aggregateTweakedXOnlyPublicKey };
    }
  } finally { setupSigners.forEach(s => s.close()); for (const state of setupStates) await state.close(); }
  const policy = { ...partial, environment: "devnet", solanaGenesis: DEVNET_SOLANA_GENESIS, minimumSolanaSlot: String(manifest.minimumSlot),
    protocolId: manifest.config.protocolId, nativeNetwork: 8_000_111, policyEpoch: manifest.config.policyEpoch,
    frostPublicKeyHex: publicPackage.aggregateTweakedXOnlyPublicKey, csvDelayBlocks: 144, minimumConfirmations: 6,
    maximumAmountAtomic: "100000000", maximumFeeAtomic: "10000" };
  const reserveScriptHex = "5120" + policy.frostPublicKeyHex;
  if (saved) assert.deepEqual(policy, saved.policy, "RetainedDevnetPolicyMismatch");
  const contextBytes = Buffer.alloc(168); contextBytes.writeUInt32LE(policy.protocolId); contextBytes.writeUInt32LE(policy.nativeNetwork, 4);
  [policy.nativeGenesis, policy.solanaDeployment, policy.managerProgramId, policy.transceiverProgramId, policy.mint]
    .forEach((value, index) => Buffer.from(value, "hex").copy(contextBytes, 8 + index * 32));
  const journalIdHex = saved?.ledgerOptions.journalIdHex ?? randomBytes(32).toString("hex");
  const keyOptions = saved?.keyOptions ?? fixture.options("ledger-key", "BRIDGE_VALIDATOR", "bridge-journal-key", journalIdHex);
  keyOptions.context.environment = "devnet";
  const keyStore = saved ? undefined : fixture.store(keyOptions, randomBytes(32));
  const ledgerOptions = { environment: "devnet", solanaGenesis: DEVNET_SOLANA_GENESIS, root: path.join(root, "journal"), repoRoot,
    deploymentHex: contextBytes.toString("hex"), journalIdHex };
  if (!saved) ledger = AuthenticatedLocalDepositLedger.fromProtectedLocalKey(ledgerOptions, keyStore, true);
  const coordinatorOptions = saved?.coordinatorOptions ?? fixture.options("coordinator-journal", "COORDINATOR", "coordinator-signing");
  if (!saved) fixture.store(coordinatorOptions, initialCoordinatorSigningState(publicPackage)).close();
  const feeOptions = saved?.feeOptions ?? fixture.options("runtime-fee-payer", "FEE_PAYER", "fee-payer-seed"); feeOptions.context.environment = "devnet";
  const feePayer = protectedSigner(saved ? new WindowsProtectedStore(feeOptions) : fixture.store(feeOptions, randomBytes(32))); closers.push(() => feePayer.close());
  assert.notEqual(feePayer.publicKeyBase58, manifest.manager.upgradeAuthority, "RelayerMustNotBeUpgradeAuthority");
  if (!saved) retain("local-recovery-context.json", { policy, ledgerOptions, keyOptions, coordinatorOptions, feeOptions, signerMaterial: material, publicPackage, fixtureRoot: fixture.root });

  stage = "TEST_FEE_FUNDING";
  const deploymentStore = new WindowsProtectedStore(local.deployment), deployment = deploymentStore.read();
  assert.equal(deployment.payload.length, 256, "PreparedDevnetCredentialsRejected");
  const deploymentSeed = deployment.payload.subarray(0, 32), userSeed = Buffer.from(deployment.payload.subarray(224, 256));
  const fundingKey = base58Encode(ed25519.getPublicKey(deploymentSeed)), userPublicKey = base58Encode(ed25519.getPublicKey(userSeed));
  assert.equal(fundingKey, manifest.manager.upgradeAuthority); assert.equal(userPublicKey, record.recipient);
  const userSigner = { publicKeyBase58: userPublicKey, sign: bytes => Buffer.from(ed25519.sign(bytes, userSeed)) };
  closers.push(() => userSeed.fill(0));
  async function submitRetained(packet) {
    const bytes = Buffer.from(packet.signedTransactionBase64 ?? packet.packet, "base64");
    assert.equal(base58Encode(bytes.subarray(1, 65)), packet.signature, "RetainedTestSignatureMismatch");
    const started = Date.now(); let attempts = 0;
    for (;;) {
      diskGuard(); const status = await rpc.getSignatureStatus(packet.signature);
      if (status) {
        assert.equal(status.err, null, "RetainedTestTransactionFailed");
        if (status.confirmationStatus === "finalized") return { slot: status.slot, finalityMilliseconds: Date.now() - started, attempts };
      } else {
        assert(await rpc.getBlockHeight() <= BigInt(packet.lastValidBlockHeight), "RetainedUserTransactionExpiredNeedsReview");
        try {
          attempts += 1;
          assert.equal(await rpc.sendTransaction(bytes.toString("base64"), { maxRetries: 3 }), packet.signature);
        } catch (error) {
          // Retrying these exact signed bytes cannot create a second action.
          // Preserve a safe diagnostic instead of swallowing a preflight error.
          const diagnostic = sanitizedRpcDiagnostic(error);
          event("TEST_SUBMISSION_RETRY", { signature: packet.signature, attempts, ...diagnostic });
          if (error.code === "ERR_ASSERTION" || diagnostic.instructionFailure || diagnostic.executionFault ||
              diagnostic.transactionFailure === "InsufficientFundsForFee") throw error;
        }
      }
      assert(Date.now() - started < 180000, "DevnetFinalityTimeout"); await delay(3000);
    }
  }
  try {
    const balance = async address => BigInt((await rpc.call("getAccountInfo", [address, { encoding: "base64", commitment: "finalized" }])).value?.lamports ?? 0);
    const available = await balance(fundingKey);
    assert(available >= 80000000n, "ExistingDevnetTestFundingInsufficient");
    event("EXISTING_TEST_BALANCE_SUFFICIENT", { balanceLamports: available.toString(), airdropsRequested: 0 });
    for (const [label, address, amount] of [["runtime-fees", feePayer.publicKeyBase58, 50000000n], ["user-fees", userPublicKey, 20000000n]]) {
      const retained = path.join(root, label + ".json");
      if (existsSync(retained)) {
        const packet = JSON.parse(readFileSync(retained)); assert.equal(packet.recipient, address);
        await submitRetained(packet); assert(await balance(address) >= 5000000n, "RetainedTestFeeBalanceInsufficient"); continue;
      }
      if (await balance(address) >= amount) continue;
      const latest = await rpc.getLatestBlockhash(), data = Buffer.alloc(12); data.writeUInt32LE(2); data.writeBigUInt64LE(amount, 4);
      // Standard Solana System transfer; not a bridge authorization/message.
      const message = Buffer.concat([Buffer.from([1, 0, 1, 3]), Buffer.from(base58Decode(fundingKey)), Buffer.from(base58Decode(address)), Buffer.alloc(32),
        Buffer.from(base58Decode(latest.blockhash)), Buffer.from([1, 2, 2, 0, 1, 12]), data]);
      const signatureBytes = Buffer.from(ed25519.sign(message, deploymentSeed)), signature = base58Encode(signatureBytes);
      const packet = Buffer.concat([shortvecEncode(1), signatureBytes, message]).toString("base64");
      const funding = { signature, packet, amountLamports: amount.toString(), recipient: address, lastValidBlockHeight: String(latest.lastValidBlockHeight) };
      retain(label + ".json", funding);
      event("TEST_FEE_FUNDING_FINALIZED", { signature, recipient: address, ...await submitRetained(funding) });
    }
  } finally { deployment.payload.fill(0); deploymentStore.close(); }

  stage = "NATIVE_REGTEST";
  const binaryRoot = required("KINGPEPE_NATIVE_TEST_BINARY_ROOT"); assert(/^\/[A-Za-z0-9/._-]+$/u.test(binaryRoot));
  const dataDir = path.join(root, "native-regtest"); if (!saved) mkdirSync(dataDir);
  const rpcPort = await unusedPort(), peerPort = await unusedPort(), nativeBase = ["-regtest", "-datadir=" + linuxPath(dataDir), "-rpcport=" + rpcPort];
  const wslArguments = args => args.map(arg => arg.startsWith("-datadir=") ? "-datadir=" + linuxPath(arg.slice(9)) : arg);
  const log = openSync(path.join(root, "native-test-process.log"), saved ? "a" : "wx");
  nativeChild = spawn("wsl.exe", ["-e", binaryRoot + "/kingpeped",
    ...wslArguments(buildRegtestDaemonArguments({ datadir: dataDir, rpcPort, p2pPort: peerPort })), "-printtoconsole=1"],
    { windowsHide: true, stdio: ["ignore", log, log] }); closeSync(log);
  nativeCli = async (command, args = [], wallet) => {
    try { const value = await exec("wsl.exe", ["-e", binaryRoot + "/kingpepe-cli",
      ...wslArguments(buildRegtestCliArguments({ datadir: dataDir, rpcPort, wallet, command, parameters: args }))],
      { windowsHide: true, timeout: 120000, maxBuffer: 1000000 }); return value.stdout.trim(); }
    catch (error) { const failure = new Error("NativeTestCliFailed:" + command);
      failure.nativeCode = /error code:\s*(-?\d+)/u.exec(error.stderr ?? "")?.[1]; throw failure; }
  };
  for (let i = 0; ; i++) {
    try { assert.equal(await nativeCli("getblockhash", ["0"]), REGTEST_GENESIS); break; }
    catch { assert(i < 30 && nativeChild.exitCode === null, "NativeTestStartupFailed"); await delay(1000); }
  }
  const wallet = "devnet-test-user";
  if (!saved) await nativeCli("createwallet", [wallet]);
  else if (!JSON.parse(await nativeCli("listwallets")).includes(wallet)) await nativeCli("loadwallet", [wallet]);
  miner = await nativeCli("getnewaddress", ["mining", "bech32m"], wallet);
  // The retained KingPepe regtest harness uses maturity 20, not Bitcoin's 100.
  const height = Number(await nativeCli("getblockcount"));
  if (height < 21) await nativeCli("generatetoaddress", [String(21 - height), miner], wallet);
  const rpcOptions = { endpoint: "http://127.0.0.1:" + rpcPort, authCookieFile: path.join(dataDir, "regtest/.cookie"), repoRoot };
  const nativeRpc = new NativeRpcClient(rpcOptions), executable = validateRuntimeFile(required("KINGPEPE_NATIVE_EVIDENCE_EXE"), repoRoot);
  const executableSha256 = required("KINGPEPE_NATIVE_EVIDENCE_SHA256").toLowerCase();
  assert(/^[0-9a-f]{64}$/u.test(executableSha256) && hash(readFileSync(executable)) === executableSha256, "PinnedNativeVerifierRequired");
  const nativeVerifier = new LocalNativeEvidenceVerifier({ rpc: nativeRpc, executable });
  await nativeVerifier.observeChain();
  retain("local-native-context-" + rpcPort + ".json", { rpcOptions, executable, executableSha256, nativeBase, binaryRoot });

  stage = "PROTECTED_SERVICE";
  const attesters = ["ATTESTER_A", "ATTESTER_B"].map((role, i) => {
    const options = i === 0 ? local.attesterA : local.attesterB;
    const attesterPolicy = { role, attesterPublicKeyHex: keyHex(manifest.config.attesters[i]), protocolId: policy.protocolId, nativeNetwork: policy.nativeNetwork,
      nativeGenesisHex: policy.nativeGenesis, solanaDeploymentHex: policy.solanaDeployment, managerProgramIdHex: policy.managerProgramId,
      transceiverProgramIdHex: policy.transceiverProgramId, mintHex: policy.mint, keyEpoch: policy.keyEpoch, policyEpoch: policy.policyEpoch,
      acceptedNativeTrust: ["RPC_OBSERVATION"], depositsPaused: false, hardStop: false };
    const attester = ProjectAttester.fromWindowsProtectedStore({ store: new WindowsProtectedStore(options), role, policy: attesterPolicy,
      environment: "devnet", solanaGenesis: DEVNET_SOLANA_GENESIS }); closers.push(() => attester.close()); return attester;
  });
  const coordinatorGuard = await fixture.guard("COORDINATOR"), sourceGuards = [];
  for (const role of ["NATIVE_OBSERVER", "SOLANA_OBSERVER", "RECONCILIATION"]) sourceGuards.push(await fixture.guard(role));
  let signingRequests = 0, worker;
  const healthId = hash("KINGPEPE_DEVNET_TEST_HEALTH:" + policy.solanaDeployment);
  let activeHealth;
  async function health() {
    if (activeHealth) return activeHealth;
    activeHealth = observeHealth();
    try { return await activeHealth; } finally { activeHealth = undefined; }
  }
  async function observeHealth() {
    const reads = [() => nativeVerifier.observeChain(), async () => verifyDeploymentSnapshot(manifest, await solana.snapshot(manifest)), () => worker.reconcile()];
    for (let i = 0; i < reads.length; i++) {
      const ticket = await sourceGuards[i].beginSourceCheck(healthId); let result;
      try { result = await reads[i](); }
      catch { await sourceGuards[i].finishSourceCheck(ticket, { state: "WAITING_FOR_DEPENDENCY", evidenceDigest: hash("TEST_SOURCE_UNAVAILABLE") }); throw new Error("DevnetSourceObservationUnavailable"); }
      await sourceGuards[i].finishSourceCheck(ticket, { state: i === 2 && result.state !== "MATCH" ? "WAITING_FOR_DEPENDENCY" : "OBSERVED_MATCH", evidenceDigest: hash(json(result)) });
    }
  }
  const signerConnections = [];
  for (const item of material) signerConnections.push({ ...item,
    connection: await fixture.deferredPair(item.role, "COORDINATOR"), guard: await fixture.pair("SUPERVISOR", item.role) });
  const createCoordinator = async ({ plan }) => {
    signingRequests++; await closeSigning();
    const peers = [];
    for (const item of signerConnections) {
      const { connection, guard } = item;
      const configuration = { role: item.role, policy, stateOptions: item.stateOptions, serverOptions: connection.serverOptions,
        supervisorOptions: guard.clientOptions, supervisorPort: guard.port, rpcOptions, executable, executableSha256,
        ...(plan.signingIntents ? { operationPlan: plan } : { withdrawalPlan: plan, manifest }) };
      const actor = startSigner(configuration); activeActors.push(actor);
      const port = await actor.ready(), ipc = new ProtectedServiceIpc(new WindowsProtectedStore(connection.clientOptions)); activeTransports.push(ipc);
      peers.push(new ProtectedRemoteFrostPeer({ ipc, port, signerId: item.role }));
    }
    signingJournal = await ProtectedCoordinatorSigningJournal.open({ store: new WindowsProtectedStore(coordinatorOptions), integrity: coordinatorGuard, ...publicPackage });
    await health();
    return new NativeFrostCoordinator({ signers: peers, integrity: coordinatorGuard, signingJournal, ...publicPackage });
  };
  const reader = new FinalizedWithdrawalReader({ rpc: solana, manifest });
  worker = new AutomaticSolanaToNativeWithdrawal({ environment: "devnet", ledger, reader, nativeVerifier, nativeRpc, solanaRpc: solana, manifest,
    createCoordinator, reserveScriptHex, minimumConfirmations: policy.minimumConfirmations, maxFeeAtomic: policy.maximumFeeAtomic, maxAmountAtomic: policy.maximumAmountAtomic });
  const deposits = new AutomaticNativeToSolanaDeposit({ environment: "devnet", ledger, policy, manifest, nativeVerifier, nativeRpc,
    solanaRpc: solana, solanaEndpoint: endpoint, createCoordinator, attesters, feePayerSigner: feePayer });
  const service = new LocalBridgeService({ ledger, worker, depositWorker: deposits });
  let feeFundingInputs;
  const api = new BridgeUserApi({ service, ledger, depositFeeInputs: async () => feeFundingInputs });
  await health();
  healthTask = (async () => { while (!stopHealth) { await delay(stage === "DEVNET_SOAK" ? 60000 : 5000); if (!stopHealth) try { await health(); } catch { /* Next check must obtain fresh evidence; no synthetic health. */ } } })();

  stage = "NATIVE_DEPOSIT";
  const oldQuote = existsSync(path.join(root, "deposit-request.json")) ? JSON.parse(readFileSync(path.join(root, "deposit-request.json"))) : undefined;
  let request = oldQuote?.request;
  if (!request) {
    const recoveryAddress = await nativeCli("getnewaddress", ["recovery", "bech32"], wallet);
    const recovery = JSON.parse(await nativeCli("getaddressinfo", [recoveryAddress], wallet));
    assert(recovery.ismine && /^(02|03)[0-9a-f]{64}$/u.test(recovery.pubkey), "NativeUserRecoveryPublicKeyRequired");
    request = { amountAtomic: "100000000", recipient: record.recipientSplAccount, userRecoveryPublicKeyHex: recovery.pubkey.slice(2), nonceHex: randomBytes(32).toString("hex") };
  }
  const quote = createNativeDepositRequest({ policy, ...request }); retain("deposit-request.json", quote);
  const history = JSON.parse(await nativeCli("listtransactions", ["*", "1000"], wallet));
  const oldDeposit = history.filter(tx => tx.category === "send" && tx.address === quote.depositAddress);
  const reserveAddress = witnessAddressFromScript(reserveScriptHex);
  const oldFee = history.filter(tx => tx.category === "send" && tx.address === reserveAddress);
  assert(oldDeposit.length <= 1 && oldFee.length <= 1, "AmbiguousNativeTestFundingHistory");
  const retainedObservation = path.join(root, "deposit-observation-bound.json");
  const priorFunding = existsSync(retainedObservation) ? JSON.parse(readFileSync(retainedObservation)) : undefined;
  // Prefer durable transaction identities even if a later wallet-history page
  // no longer includes the original user funding. Never fund it again on resume.
  const depositTxidHex = priorFunding?.depositTxidHex ?? oldDeposit[0]?.txid ?? await nativeCli("sendtoaddress", [quote.depositAddress, "1.00000000"], wallet);
  const feeTxid = priorFunding?.feeFundingInputs[0]?.txid ?? oldFee[0]?.txid ?? await nativeCli("sendtoaddress", [reserveAddress, "0.00001000"], wallet);
  await nativeCli("generatetoaddress", ["6", miner], wallet);
  const feeTx = JSON.parse(await nativeCli("getrawtransaction", [feeTxid, "true"]));
  const feeOutput = feeTx.vout.find(v => v.scriptPubKey.hex === reserveScriptHex); assert(feeOutput, "TestFeeOutputMissing");
  feeFundingInputs = [{ txid: feeTxid, vout: feeOutput.n, amountAtomic: "1000", scriptPubKeyHex: reserveScriptHex, minimumConfirmations: policy.minimumConfirmations }];
  retain("deposit-observation-bound.json", { depositTxidHex, feeFundingInputs });
  await api.submitNativeDeposit({ request, depositTxidHex, depositVout: null });
  let last;
  async function tickUntil(direction, id) {
    const until = Date.now() + 15 * 60 * 1000;
    for (;;) {
      diskGuard(); assert(Date.now() < until, "DevnetServiceCompletionTimeout");
      const result = await service.tick(), state = service.status();
      const progress = json({ direction, state: state.state, deposits: state.deposits, withdrawals: state.withdrawals, reconciliation: result.reconciliation?.state });
      if (progress !== last) { last = progress; event("SERVICE_PROGRESS", JSON.parse(progress)); }
      assert.equal(state.state, "ACTIVE", "DevnetServicePausedRequiresReview");
      const operation = api.getOperationStatus(id);
      if (operation?.state === "COMPLETED") return operation;
      // Mining belongs to this isolated USER test harness, never the service.
      if (JSON.parse(await nativeCli("getrawmempool")).length) await nativeCli("generatetoaddress", ["6", miner], wallet);
      await delay(2000);
    }
  }
  evidence.nativeToSolana = await tickUntil("NativeToSolana", quote.operationId);
  const depositRecord = ledger.serviceDeposit(quote.operationId), credit = depositRecord.operation.finalizedCredit;
  const depositMessage = decodeCanonicalBridgeMessage(credit.encodedMessageHex);
  retain("deposit-borsh-message.json", { encodedMessageHex: credit.encodedMessageHex, messageDigestHex: depositMessage.messageDigestHex });
  assert.equal(Buffer.from(encodeCanonicalBridgeMessage(depositMessage)).toString("hex"), credit.encodedMessageHex);
  event("NATIVE_TO_SOLANA_DEVNET_COMPLETED", evidence.nativeToSolana);

  stage = "USER_WITHDRAWAL";
  const withdrawalFile = path.join(root, "withdrawal-user-packet.json");
  let withdrawal;
  if (existsSync(withdrawalFile)) withdrawal = JSON.parse(readFileSync(withdrawalFile));
  else {
    const destination = await nativeCli("getnewaddress", ["payout", "bech32m"], wallet);
    const unsigned = await api.createSolanaWithdrawal({ amountAtomic: request.amountAtomic, feeAtomic: "1000", destination,
      userAuthority: userPublicKey, sourceTokenAccount: record.recipientSplAccount, withdrawalIdHex: randomBytes(32).toString("hex"), nonceHex: randomBytes(32).toString("hex") });
    const userPacket = Buffer.from(unsigned.transactionBase64, "base64");
    assert(userPacket[0] === 1 && userPacket.subarray(1, 65).equals(Buffer.alloc(64)), "TestUserPacketRejected");
    userSigner.sign(userPacket.subarray(65)).copy(userPacket, 1);
    withdrawal = { ...unsigned, signedTransactionBase64: userPacket.toString("base64"), signature: base58Encode(userPacket.subarray(1, 65)) };
    retain("withdrawal-user-packet.json", withdrawal);
  }
  // A TEST user may replace an expired *unlanded* packet, not the withdrawal.
  // Keep every old signed packet and the exact Borsh message/operation ID.
  let retry = 1;
  while (existsSync(path.join(root, `withdrawal-user-packet-${retry}.json`))) {
    assert(retry <= 8, "TestWithdrawalRetryLimit");
    const next = JSON.parse(readFileSync(path.join(root, `withdrawal-user-packet-${retry}.json`)));
    assert.equal(next.encodedMessageHex, withdrawal.encodedMessageHex, "RetainedWithdrawalMessageChanged");
    assert.equal(next.operationId, withdrawal.operationId, "RetainedWithdrawalOperationChanged");
    withdrawal = next; retry += 1;
  }
  if (await rpc.getSignatureStatus(withdrawal.signature) === null && await rpc.getBlockHeight() > BigInt(withdrawal.lastValidBlockHeight)) {
    assert(retry <= 8, "TestWithdrawalRetryLimit");
    const old = withdrawal, message = decodeCanonicalBridgeMessage(old.encodedMessageHex);
    const context = await service.userTransactionContext({ tokenAccount: record.recipientSplAccount,
      authority: userPublicKey, amountAtomic: message.amountAtomic.toString() });
    assert(BigInt(context.unixTimestamp) < message.validUntil, "TestWithdrawalMessageExpiredNeedsReview");
    assert.equal(await rpc.getAccountInfo(old.instruction.accounts[1].key), null, "WithdrawalAlreadyRecordedNeedsReview");
    assert.equal(await rpc.getSignatureStatus(old.signature), null, "WithdrawalAlreadySubmittedNeedsReview");
    const unsigned = createSolanaWithdrawalRequest({ policy, amountAtomic: message.amountAtomic.toString(), feeAtomic: message.feeAtomic.toString(),
      destination: old.destination, userAuthority: userPublicKey, sourceTokenAccount: record.recipientSplAccount,
      withdrawalIdHex: message.withdrawalIdHex, nonceHex: Buffer.from(message.nonce).toString("hex"),
      validFrom: message.validFrom.toString(), validUntil: message.validUntil.toString(), recentBlockhash: context.blockhash });
    assert.equal(unsigned.encodedMessageHex, old.encodedMessageHex, "RetryMustPreserveExactWithdrawalMessage");
    assert.equal(unsigned.operationId, old.operationId, "RetryMustPreserveWithdrawalOperation");
    const packet = Buffer.from(unsigned.transactionBase64, "base64");
    assert(packet[0] === 1 && packet.subarray(1, 65).equals(Buffer.alloc(64)), "TestUserPacketRejected");
    userSigner.sign(packet.subarray(65)).copy(packet, 1);
    withdrawal = { ...unsigned, lastValidBlockHeight: String(context.lastValidBlockHeight),
      signedTransactionBase64: packet.toString("base64"), signature: base58Encode(packet.subarray(1, 65)) };
    retain(`withdrawal-user-packet-${retry}.json`, withdrawal); // persist BEFORE send
    event("EXPIRED_TEST_USER_PACKET_REPLACED", { oldSignature: old.signature, signature: withdrawal.signature,
      operationId: withdrawal.operationId, canonicalMessageUnchanged: true, priorSignatureAbsent: true, withdrawalRecordAbsent: true });
  }
  const withdrawalSignature = withdrawal.signature;
  event("DEVNET_USER_BURN_FINALIZED", { signature: withdrawalSignature, ...await submitRetained(withdrawal) });
  // No submission to the bridge: the retained Solana observer discovers it.
  stage = "AUTOMATIC_WITHDRAWAL";
  evidence.solanaToNative = await tickUntil("SolanaToNative", withdrawal.operationId);
  const observedWithdrawal = await reader.read(withdrawalSignature, withdrawal.encodedMessageHex);
  assert.equal(observedWithdrawal.encodedMessageHex, withdrawal.encodedMessageHex);
  retain("withdrawal-borsh-message.json", { encodedMessageHex: withdrawal.encodedMessageHex, messageDigestHex: withdrawal.messageDigestHex });
  event("SOLANA_DEVNET_TO_NATIVE_COMPLETED", evidence.solanaToNative);
  evidence.reconciliation = await worker.reconcile(); assert.equal(evidence.reconciliation.state, "MATCH");
  const finalState = service.status();
  assert.equal(finalState.accounting.pendingMintAtomic, "0"); assert.equal(finalState.accounting.pendingWithdrawalAtomic, "0");
  const signingCount = signingRequests; await service.tick(); assert.equal(signingRequests, signingCount, "CompletedOperationSignedAgain");
  evidence.status = "PASS"; evidence.finalAccounting = finalState.accounting;
  evidence.protectedFrost = "SEPARATE_A_B_PROCESSES_CURRENT_PRINCIPAL_DPAPI_PINNED_MTLS_EXACT_2_OF_2";
  evidence.nativeEnvironment = "REGTEST_TEST_VALUE_ONLY"; evidence.runtimeFeePayer = feePayer.publicKeyBase58;
  if (soakSeconds) {
    stage = "DEVNET_EDGE_CHECKS";
    const settled = service.status().accounting;
    service.pause("DEVNET_TEST_MANUAL_REVIEW");
    assert.equal((await service.tick()).state, "PAUSED");
    assert.deepEqual(service.status().accounting, settled); assert.equal(signingRequests, signingCount);
    // Explicit TEST operator review, not an automatic runtime unpause policy.
    await service.resumeAfterReview(); assert.equal(service.status().state, "ACTIVE");
    const originalSnapshot = solana.snapshot;
    try {
      solana.snapshot = async () => { throw new Error("TEST_INJECTED_RPC_OUTAGE"); };
      const unavailable = await service.tick();
      assert.equal(unavailable.state, "WAITING_FOR_DEPENDENCY");
      assert.equal(service.status().state, "ACTIVE", "OutageMustNotFabricateContradiction");
      assert.deepEqual(service.status().accounting, settled); assert.equal(signingRequests, signingCount);
    } finally { solana.snapshot = originalSnapshot; }
    await health();
    const reconnected = await service.tick(); assert.equal(reconnected.reconciliation.state, "MATCH");
    assert.deepEqual(await reader.discover([withdrawal.operationId]), [], "CompletedWithdrawalRediscovered");
    evidence.edgeChecks = { pauseReviewedResume: "PASS", injectedRpcOutageAndRealReconnect: "PASS",
      completedWithdrawalRediscovery: "PASS", noNewSigning: signingRequests === signingCount,
      scope: "RETAINED_COMPLETED_OPERATIONS_NOT_A_PENDING_OPERATION_RESTORE_DRILL" };
    event("DEVNET_EDGE_CHECKS_PASSED", evidence.edgeChecks);

    stage = "DEVNET_SOAK";
    const began = Date.now(), end = began + soakSeconds * 1000;
    const miningIntervalMs = 600000, startHeight = Number(await nativeCli("getblockcount"));
    // The retained regtest verifier deliberately accepts at most 4096 headers.
    // Budget this TEST window up front; never reset its chain or weaken the bound.
    assert(Number.isSafeInteger(startHeight) && startHeight + Math.ceil(soakSeconds * 1000 / miningIntervalMs) <= 4096,
      "ObservationWindowExceedsRetainedRegtestHeaderBound");
    evidence.soak = { startedAt: new Date(began).toISOString(), requestedSeconds: soakSeconds,
      targetEndAt: new Date(end).toISOString(), observations: 0, waitingObservations: 0,
      scope: "LIVE_SERVICE_OBSERVATION_OF_RETAINED_COMPLETED_TRANSFERS_NO_NEW_USER_TRANSFERS",
      requiredRecoveryDrill: "NOT_RUN_ON_DEVNET", phase17Certified: false };
    event("DEVNET_SOAK_STARTED", evidence.soak);
    let previousState, lastReport = 0, lastMined = 0;
    while (Date.now() < end) {
      diskGuard();
      // Keep isolated regtest fresh. This is TEST-driver mining, not a bridge
      // runtime capability or a claim about public Native confirmation timing.
      if (Date.now() - lastMined >= miningIntervalMs) {
        await nativeCli("generatetoaddress", ["1", miner], wallet); lastMined = Date.now();
      }
      let sourcesAvailable = true;
      try { await health(); } catch { sourcesAvailable = false; }
      const result = await service.tick(), current = service.status();
      assert.equal(current.state, "ACTIVE", "SoakPausedRequiresManualReview");
      assert.deepEqual(current.accounting, settled, "UnexpectedEconomicActionDuringObservationSoak");
      assert.equal(signingRequests, signingCount, "CompletedOperationSignedAgain");
      const state = sourcesAvailable ? result.reconciliation?.state ?? result.state : "WAITING_FOR_DEPENDENCY";
      evidence.soak.observations++; if (state !== "MATCH") evidence.soak.waitingObservations++;
      if (state !== previousState || Date.now() - lastReport >= 3600000) {
        const observation = { sourceSha: evidence.sourceSha, ...evidence.soak, observedAt: new Date().toISOString(),
          elapsedSeconds: Math.floor((Date.now() - began) / 1000), state, residentBytes: process.memoryUsage().rss, ...diskGuard() };
        retain("soak-observation-" + Date.now() + ".json", observation);
        event("DEVNET_SOAK_OBSERVATION", observation); previousState = state; lastReport = Date.now();
      }
      await delay(Math.min(60000, Math.max(1, end - Date.now())));
    }
    evidence.soak.elapsedSeconds = Math.floor((Date.now() - began) / 1000);
    // Even a complete observation window does not certify traffic/recovery,
    // reorg, external-review or production readiness requirements by itself.
    evidence.status = soakSeconds < 14 * 86400 ? "SMOKE_PASS_NOT_SOAK_COMPLETE" : "OBSERVATION_WINDOW_COMPLETE_NOT_PHASE17_PASS";
    event("DEVNET_SOAK_WINDOW_ENDED", { ...evidence.soak, status: evidence.status });
  }
} catch (error) {
  phaseError = error; evidence.status = failedDiskSample || stage === "RPC_CAPABILITIES" && !error?.integrityCode ? "BLOCKED" : "FAIL"; evidence.failureStage = stage;
  if (evidence.soak) {
    evidence.soak.endedAt = new Date().toISOString();
    evidence.soak.elapsedSeconds = Math.floor((Date.now() - Date.parse(evidence.soak.startedAt)) / 1000);
    evidence.soak.status = "INTERRUPTED_NOT_COMPLETE";
  }
  // Do not include provider errors, process argv, private paths, buffers or keys.
  evidence.failure = { ...sanitizedRpcDiagnostic(error), nativeCode: error?.nativeCode,
    ...(failedDiskSample ? { reason: "TEST_DISK_HEADROOM_REQUIRED", disk: failedDiskSample } : {}),
    sourceFrames: [...String(error?.stack ?? "").matchAll(/[/\\]([a-z0-9-]+\.mjs):(\d+):(\d+)/gu)]
      .slice(0, 6).map(match => ({ file: match[1], line: Number(match[2]), column: Number(match[3]) })) };
  event("DEVNET_TEST_FAILED", { stage, diagnostic: evidence.failure });
} finally {
  stopHealth = true; await healthTask;
  try { await closeSigning(); } catch { evidence.cleanupFailure = "SIGNER_SHUTDOWN"; }
  for (const close of closers.reverse()) try { await close(); } catch { evidence.cleanupFailure = "PROTECTED_STORE_SHUTDOWN"; }
  ledger?.close();
  if (nativeCli && nativeChild?.exitCode === null) try { await nativeCli("stop"); } catch { evidence.cleanupFailure = "NATIVE_SHUTDOWN"; }
  if (nativeChild) {
    for (let i = 0; nativeChild.exitCode === null && i < 15; i++) await delay(1000);
    if (nativeChild.exitCode === null) evidence.cleanupFailure = "NATIVE_STILL_RUNNING";
  }
  if (fixture) try { await fixture.close({ retainState: true }); } catch { evidence.cleanupFailure = "IPC_SHUTDOWN"; }
  // Retain this real Devnet test's protected shares, wallet, journal and signed
  // packets for the next recovery/soak stage; never delete operational evidence.
  try { evidence.diskAfter = diskGuard({ allowInterrupted: true }); } catch { evidence.cleanupFailure = "DISK_HEADROOM"; }
  if (root) retain("test-evidence-" + Date.now() + ".json", evidence);
  console.log(json({ phase: evidence.phase, status: evidence.status, stage, evidenceRetained: Boolean(root), protectedStatePreserved: true,
    cleanupFailure: evidence.cleanupFailure ?? null, diskAfter: evidence.diskAfter, productionReady: false, mainnetActivation: "DISABLED" }));
  if (phaseError || evidence.cleanupFailure) process.exitCode = 1;
}
