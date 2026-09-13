// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real LOCALNET/REGTEST service regression. Wallet funding/mining belongs only
// to this harness. Child service processes never create blocks or deployments.
import assert from "node:assert/strict";
import { generateKeyPairSync, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, statfsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, executeNativeDepositObservationFlow,
  createLocalFrostTaprootCustodyContext, submitLocalnetSolanaSetup } from "../../scripts/local-e2e-native-to-solana.mjs";
import { LocalNativeEvidenceVerifier } from "../../native/node/native-raw-evidence.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { FileBackedFrostStateStore, NativeFrostSigner, NativeFrostCoordinator, REQUIRED_FROST_SIGNERS, createNativeSigningPolicy } from "../../native/frost/index.mjs";
import { ProjectAttester } from "../../services/attesters/attestation-service.mjs";
import { AuthenticatedLocalDepositLedger } from "../../services/bridge-validator/local-deposit-ledger.mjs";
import { AutomaticNativeToSolanaDeposit } from "../../services/bridge-validator/automatic-native-deposit.mjs";
import { AutomaticSolanaToNativeWithdrawal } from "../../services/bridge-validator/automatic-withdrawal.mjs";
import { FinalizedWithdrawalReader } from "../../services/solana-observer/finalized-withdrawal.mjs";
import { LocalDeploymentRpc, verifyDeploymentSnapshot } from "../../services/solana-observer/deployment-integrity.mjs";
import { LocalBridgeService } from "../../services/relayer/withdrawal-service.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SYSTEM_PROGRAM_ID_BASE58 as SYSTEM } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { decodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
import { createNativeDepositRequest } from "../ts/sdk/bridge.mjs";
import { createBridgeClient } from "../ts/sdk/client.mjs";
import { BridgeUserApi } from "../../services/bridge-validator/user-api.mjs";
import { listenBridgeUserApi } from "../../services/bridge-validator/user-http.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../.."), self = fileURLToPath(import.meta.url);
function testIdentity(encoded) {
  const privateKey = encoded ? createPrivateKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "pkcs8" }) : generateKeyPairSync("ed25519").privateKey;
  const publicBytes = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32);
  return { encoded: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), seed: privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32),
    signer: { publicKeyHex: publicBytes.toString("hex"), publicKeyBase58: base58Encode(publicBytes), sign: b => sign(null, b, privateKey) } };
}
function diskGuard() {
  if (process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
    const s = statfsSync("/mnt/c", { bigint: true }); assert(s.bavail * s.bsize >= 8n * 1024n ** 3n, "TEST_HOST_DISK_HEADROOM_REQUIRED");
  }
}
function ledgerOptions(c) { return { ...c.ledger, repoRoot, authenticationKey: Buffer.from(c.ledger.testAuthenticationKeyHex, "hex") }; }
async function child(file, mode) {
  const c = JSON.parse(readFileSync(validateRuntimeFile(file, repoRoot), "utf8"));
  assert.equal(c.environment, "LOCALNET_REGTEST_TEST_ONLY");
  const ledger = AuthenticatedLocalDepositLedger.openLocal(ledgerOptions(c)), signers = [], attesters = [];
  let unavailableRpc;
  if (mode === "crash-after-mint-record") {
    const update = ledger.updateServiceDeposit.bind(ledger);
    ledger.updateServiceDeposit = (...args) => { update(...args); if (args[1] === "MINTED") process.exit(73); };
  }
  if (mode === "crash-after-credit-accounting") {
    const record = ledger.recordValidatedDeposit.bind(ledger);
    ledger.recordValidatedDeposit = (...args) => { record(...args); process.exit(74); };
  }
  let signingRequests = 0, sends = 0;
  try {
    let nativeEndpoint = c.nativeEndpoint;
    if (mode === "native-rpc-outage") {
      // A real connection failure through the real RPC client, never a forged
      // consensus response or a replacement verifier.
      unavailableRpc = createServer((request, response) => response.destroy());
      await new Promise(resolve => unavailableRpc.listen(0, "127.0.0.1", resolve));
      nativeEndpoint = `http://127.0.0.1:${unavailableRpc.address().port}`;
    }
    const native = new NativeRpcClient({ endpoint: nativeEndpoint, authCookieFile: c.nativeCookie, repoRoot, localOnly: true });
    const original = native.sendRawTransaction.bind(native);
    native.sendRawTransaction = async raw => { sends++; const txid = await original(raw); if (mode === "lose-native-response") throw new Error("TEST_RESPONSE_LOST_AFTER_ACCEPTANCE"); return txid; };
    const verifier = new LocalNativeEvidenceVerifier({ rpc: native, executable: c.nativeVerifier });
    const solana = new LocalDeploymentRpc({ endpoint: c.solanaEndpoint }), p = c.policy;
    const factory = ({ intents, verify }) => {
      signers.splice(0).forEach(s => s.close()); signingRequests += intents.length;
      const policy = createNativeSigningPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: p.nativeGenesis,
        solanaDeployment: p.solanaDeployment, bridgeProgramId: p.managerProgramId, transceiverProgramId: p.transceiverProgramId, mint: p.mint,
        keyEpoch: p.keyEpoch, maxAmountAtomic: p.maximumAmountAtomic, maxFeeAtomic: p.maximumFeeAtomic,
        reserveScriptPubKeyHex: "5120" + p.frostPublicKeyHex, authorizedOperations: intents });
      for (const [index, signerId] of REQUIRED_FROST_SIGNERS.entries()) signers.push(new NativeFrostSigner({ signerId, index, policy,
        nativeEvidenceValidator: verify, stateStore: new FileBackedFrostStateStore({ signerId, repoRoot, root: c.signerRoots[index] }) }));
      if (mode === "crash-after-commitment") {
        const commit = signers[0].signingCommitment.bind(signers[0]);
        signers[0].signingCommitment = request => { commit(request); process.exit(71); };
      }
      const coordinator = new NativeFrostCoordinator({ signers, publicPackage: c.custody.publicPackage, aggregateTweakedXOnlyPublicKey: c.custody.aggregateTweakedXOnlyPublicKey });
      if (mode === "crash-after-aggregate") {
        const signing = coordinator.signAutomaticallyWithNativeEvidence.bind(coordinator);
        coordinator.signAutomaticallyWithNativeEvidence = async intent => { await signing(intent); process.exit(72); };
      }
      return coordinator;
    };
    for (const [i, encoded] of c.testAttesters.entries()) {
      const identity = testIdentity(encoded), role = ["ATTESTER_A", "ATTESTER_B"][i];
      attesters.push(new ProjectAttester({ role, secretKey: identity.seed, policy: { role, attesterPublicKeyHex: identity.signer.publicKeyHex,
        protocolId: p.protocolId, nativeNetwork: p.nativeNetwork, nativeGenesisHex: p.nativeGenesis, solanaDeploymentHex: p.solanaDeployment,
        managerProgramIdHex: p.managerProgramId, transceiverProgramIdHex: p.transceiverProgramId, mintHex: p.mint,
        policyEpoch: p.policyEpoch, keyEpoch: p.keyEpoch, acceptedNativeTrust: ["RPC_OBSERVATION"] } })); identity.seed.fill(0);
    }
    const depositWorker = new AutomaticNativeToSolanaDeposit({ environment: "localnet", ledger, policy: p, manifest: c.manifest, nativeVerifier: verifier,
      nativeRpc: native, solanaRpc: solana, solanaEndpoint: c.solanaEndpoint, createCoordinator: factory, attesters, feePayerSigner: testIdentity(c.testFeePayer).signer });
    const worker = new AutomaticSolanaToNativeWithdrawal({ environment: "localnet", ledger, reader: new FinalizedWithdrawalReader({ rpc: solana, manifest: c.manifest }),
      nativeVerifier: verifier, nativeRpc: native, solanaRpc: solana, manifest: c.manifest, createCoordinator: factory,
      reserveScriptHex: "5120" + p.frostPublicKeyHex, minimumConfirmations: p.minimumConfirmations, maxAmountAtomic: p.maximumAmountAtomic, maxFeeAtomic: p.maximumFeeAtomic });
    const service = new LocalBridgeService({ ledger, worker, depositWorker });
    const userApi = new BridgeUserApi({ service, ledger, depositFeeInputs: async () => c.publicDeposit.feeFundingInputs });
    if (mode === "user-api-withdrawal-request") {
      const before = ledger.checkpoint();
      await assert.rejects(userApi.createSolanaWithdrawal({ ...c.publicWithdrawal, userAuthority: c.manifest.config.attesters[0] }));
      await assert.rejects(userApi.createSolanaWithdrawal({ ...c.publicWithdrawal, amountAtomic: (BigInt(c.policy.maximumAmountAtomic) + 1n).toString() }));
      assert.deepEqual(ledger.checkpoint(), before); assert.equal(service.status().state, "ACTIVE");
      const request = await userApi.createSolanaWithdrawal(c.publicWithdrawal);
      process.stdout.write(JSON.stringify(request) + "\n"); return;
    }
    if (mode === "user-api-intake") {
      const accessToken = randomBytes(32), server = await listenBridgeUserApi({ api: userApi, accessToken });
      try {
        const client = createBridgeClient({ endpoint: `http://127.0.0.1:${server.address().port}/`, accessToken: accessToken.toString("hex") });
        const before = ledger.checkpoint();
        await assert.rejects(client.createNativeDepositRequest({ ...c.publicDeposit.request, recipient: c.manifest.config.attesters[0] }));
        await assert.rejects(client.createNativeDepositRequest({ ...c.publicDeposit.request, policy: c.policy }));
        assert.deepEqual(ledger.checkpoint(), before); assert.equal(service.status().state, "ACTIVE");
        const quote = await client.createNativeDepositRequest(c.publicDeposit.request);
        assert.equal(quote.scriptPubKeyHex, c.publicDeposit.scriptPubKeyHex);
        const input = { request: c.publicDeposit.request, depositTxidHex: c.publicDeposit.depositTxidHex, depositVout: null };
        await client.submitNativeDeposit(input); const checkpoint = ledger.checkpoint();
        await client.submitNativeDeposit(input); assert.deepEqual(ledger.checkpoint(), checkpoint);
        const status = await client.getDepositStatus(quote.operationId); assert.equal(status.state, "OBSERVED");
        service.pause(); await assert.rejects(client.createNativeDepositRequest(c.publicDeposit.request));
        assert.equal((await client.getBridgeStatus()).state, "PAUSED");
        process.stdout.write(JSON.stringify({ state: "USER_API_INTAKE_PASS" }) + "\n"); return;
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); accessToken.fill(0); }
    }
    if (mode === "resume-reviewed") await service.resumeAfterReview();
    const stop = new AbortController(); let result;
    await service.run({ signal: stop.signal, intervalMs: 250, onStatus: value => { result = value; stop.abort(); } });
    process.stdout.write(JSON.stringify({ result, status: service.status(), signingRequests, sends,
      userDeposit: userApi.getDepositStatus(c.publicDeposit.operationId),
      userWithdrawal: ledger.knownWithdrawalIds()[0] ? userApi.getWithdrawalStatus(ledger.knownWithdrawalIds()[0]) : null }) + "\n");
  } finally {
    signers.forEach(s => s.close()); attesters.forEach(a => a.close()); ledger.close();
    if (unavailableRpc) { unavailableRpc.closeAllConnections(); await new Promise(resolve => unavailableRpc.close(resolve)); }
  }
}

export async function runLocalBridgeService(onCheck = () => {}) {
  const passed = [], pass = v => { passed.push(v); onCheck(v); }; let failure, failureLocation, stage = "BOOTSTRAP", solanaSends = 0, report;
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    const { plan, executor, commandPaths } = context; let proxy;
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    try {
      diskGuard();
      const fee = testIdentity(), user = testIdentity(), a = testIdentity(), b = testIdentity();
      const setup = { ...createLocalSolanaSetupContext(), feePayerSigner: fee.signer, feePayerHex: fee.signer.publicKeyHex, feePayerBase58: fee.signer.publicKeyBase58,
        recipientTokenAccountOwnerHex: user.signer.publicKeyHex, recipientTokenAccountOwnerBase58: user.signer.publicKeyBase58,
        attesterASigner: a.signer, attesterBSigner: b.signer, attesterPublicKeysHex: [a.signer.publicKeyHex, b.signer.publicKeyHex] };
      const config = createNativeToSolanaFlowConfig({ plan, repoRoot, mintHex: setup.mintHex, keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
      let f, custody;
      stage = "USER_DEPOSIT_PREPARATION";
      const prepared = await executeNativeDepositObservationFlow({ ...context, flowConfig: config, localSolanaSetupContext: setup,
        custodyFactory: async o => custody = await createLocalFrostTaprootCustodyContext(o), protectedDepositPreparation: o => { f = o; } });
      assert.equal(prepared.state, "LOCAL_PROTECTED_DEPOSIT_PREPARED", "TEST_DEPOSIT_PREPARATION_FAILED");
      assert.equal(prepared.signed, false, "TEST_PREPARATION_UNEXPECTED_SIGNING"); assert.equal(prepared.minted, false, "TEST_PREPARATION_UNEXPECTED_MINT");
      stage = "SOLANA_SETUP";
      const initialized = await submitLocalnetSolanaSetup({ plan, flowConfig: config, localSolanaSetupContext: setup, nativeSource: f.nativeSource });
      assert.equal(initialized.state, "COMPLETED");
      stage = "SOLANA_MANIFEST";
      const manifest = await localDeploymentManifest({ context: { plan, flowConfig: config, localSolanaSetupContext: setup, nativeSource: f.nativeSource }, authority: SYSTEM, sourceSha });
      const realSolana = `http://127.0.0.1:${plan.ports.solanaRpcPort}`;
      // A real network fault, not a mocked chain: forward the signed transaction
      // to the validator, then discard its response. Every observation is live.
      const dropped = new Set(); let heldPacket;
      proxy = createServer(async (req, res) => {
        try {
          const chunks = []; let length = 0;
          for await (const part of req) { length += part.length; if (length > 2_097_152) throw new Error("TEST_REQUEST_LIMIT"); chunks.push(part); }
          const body = Buffer.concat(chunks), value = JSON.parse(body);
          // Hold one real signed receipt until its actual blockhash expires.
          // Status/accounts still come exclusively from the real validator.
          if (value.method === "sendTransaction") {
            heldPacket ??= value.params[0];
            if (value.params[0] === heldPacket) { res.destroy(); return; }
          }
          const response = await fetch(realSolana, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
          const text = await response.text();
          if (value.method === "sendTransaction") { solanaSends++; const packetId = value.params[0];
            if (!dropped.has(packetId)) { dropped.add(packetId); res.destroy(); return; } }
          res.writeHead(response.status, { "content-type": "application/json" }); res.end(text);
        } catch { res.destroy(); }
      });
      await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
      const policy = { environment: "localnet", nativeGenesis: manifest.nativeGenesisHex, solanaDeployment: config.solanaDeploymentHex,
        solanaGenesis: manifest.solanaGenesis, minimumSolanaSlot: "0", managerProgramId: config.bridgeProgramIdHex,
        transceiverProgramId: config.transceiverProgramIdHex, mint: config.mintHex, protocolId: config.protocolId, nativeNetwork: config.nativeNetwork,
        policyEpoch: config.policyEpoch, keyEpoch: config.keyEpoch, frostPublicKeyHex: custody.aggregateTweakedXOnlyPublicKey,
        csvDelayBlocks: f.depositPolicy.csvDelayBlocks, minimumConfirmations: config.depositFinalityBlocks,
        maximumAmountAtomic: config.maxAmountAtomic, maximumFeeAtomic: config.maxFeeAtomic };
      const deploymentHeader = Buffer.alloc(8); deploymentHeader.writeUInt32LE(policy.protocolId); deploymentHeader.writeUInt32LE(policy.nativeNetwork, 4);
      const c = { environment: "LOCALNET_REGTEST_TEST_ONLY", policy, manifest, custody,
        signerRoots: [custody.signerStateRoots.frostA, custody.signerStateRoots.frostB],
        nativeEndpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`, nativeCookie: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"),
        nativeVerifier: path.join(plan.paths.cargoTargetDir, "native-evidence", "debug", "kingpepe-native-evidence"),
        solanaEndpoint: `http://127.0.0.1:${proxy.address().port}`, testFeePayer: fee.encoded, testAttesters: [a.encoded, b.encoded],
        ledger: { environment: "localnet", root: path.join(plan.runRoot, "service-journal"), journalIdHex: randomBytes(32).toString("hex"),
          testAuthenticationKeyHex: randomBytes(32).toString("hex"), deploymentHex: Buffer.concat([deploymentHeader,
            ...[policy.nativeGenesis, policy.solanaDeployment, policy.managerProgramId, policy.transceiverProgramId, policy.mint].map(v => Buffer.from(v, "hex"))]).toString("hex") } };
      const publicRequest = { amountAtomic: f.depositIntentContext.amountAtomic, recipient: setup.recipientTokenAccountBase58,
        userRecoveryPublicKeyHex: f.depositPolicy.userRecoveryPublicKeyHex, nonceHex: f.depositIntentContext.nonceHex };
      const quote = createNativeDepositRequest({ policy, ...publicRequest });
      assert.equal(quote.scriptPubKeyHex, f.depositPolicy.scriptPubKeyHex); assert.deepEqual(quote.depositIntent, f.depositIntentContext);
      const request = { operationId: quote.operationId, depositIntent: f.depositIntentContext, userRecoveryPublicKeyHex: f.depositPolicy.userRecoveryPublicKeyHex,
        depositTxidHex: f.inputs[0].txid, depositVout: null, feeFundingInputs: f.inputs.slice(1) };
      c.publicDeposit = { request: publicRequest, operationId: quote.operationId, scriptPubKeyHex: quote.scriptPubKeyHex,
        depositTxidHex: request.depositTxidHex, feeFundingInputs: request.feeFundingInputs };
      const file = validateRuntimeFile(path.join(plan.runRoot, "local-service-private-test-context.json"), repoRoot);
      writeFileSync(file, JSON.stringify(c), { flag: "wx", mode: 0o600 });
      const useLedger = fn => { const ledger = AuthenticatedLocalDepositLedger.openLocal(ledgerOptions(c)); try { return fn(ledger); } finally { ledger.close(); } };
      stage = "SERVICE_JOURNAL_SETUP";
      const created = AuthenticatedLocalDepositLedger.createLocal(ledgerOptions(c));
      created.close();
      const once = async mode => { diskGuard(); const r = await promisify(execFile)(process.execPath, [self, "--service-child", file, mode ?? "tick"],
        { cwd: repoRoot, timeout: 90000, maxBuffer: 65536, windowsHide: true }); return JSON.parse(r.stdout); };
      const cli = async (command, parameters = [], wallet) => {
        assert(["generatetoaddress", "getnewaddress", "getaddressinfo"].includes(command));
        const r = await executor.runOneShot({ step: "LOCAL_SERVICE_TEST_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
        return String(r.output).trim();
      };
      assert.equal((await once("user-api-intake")).state, "USER_API_INTAKE_PASS");
      pass("SDK_HTTP_DEPOSIT_INTAKE_IDEMPOTENT_EXISTING_JOURNAL");
      const before = await once(); assert.equal(before.status.state, "PAUSED"); assert.equal(before.signingRequests, 0); assert.equal(before.sends, 0);
      pass("PENDING_DEPOSIT_RESTART_PRESERVES_PAUSE_NO_SIGNING");
      useLedger(l => l.resumeAfterReview()); // Explicit test Team policy action, not a per-transfer approval.
      stage = "AUTOMATIC_DEPOSIT_SERVICE";
      await assert.rejects(once("crash-after-commitment"), e => e.code === 71);
      assert.equal(useLedger(l => l.serviceDeposit(request.operationId)).operation.signedTransactionHex, null);
      pass("PROCESS_EXIT_AFTER_NONCE_COMMITMENT_RETAINED");
      await assert.rejects(once("crash-after-aggregate"), e => e.code === 72);
      pass("RESTART_ABORTS_OLD_NONCE_A_B_AND_PERSISTS_NEW_AGGREGATE");
      const broadcast = await once("lose-native-response");
      assert.equal(broadcast.sends, 1); assert(broadcast.signingRequests > 0);
      const retained = useLedger(l => l.serviceDeposit(request.operationId)); assert.equal(retained.operation.broadcastAttempted, true);
      pass("AUTOMATIC_NATIVE_OBSERVER_VALIDATES_AND_FROST_SWEEPS");
      pass("NATIVE_SWEEP_RESPONSE_LOST_SIGNED_OPERATION_RETAINED");
      const restarted = await once(); assert.equal(restarted.sends, 0); assert.equal(restarted.signingRequests, 0);
      pass("PENDING_DEPOSIT_PROCESS_RESTART_NO_DOUBLE_SWEEP_OR_RESIGN");
      await cli("generatetoaddress", [String(config.depositFinalityBlocks), f.miningAddress]);
      await assert.rejects(once("crash-after-credit-accounting"), e => e.code === 74);
      useLedger(l => { assert.equal(l.serviceAccountingPending(), true); assert.equal(l.accountedReserveInputs().length, 0);
        assert.equal(l.bridgeSnapshot().pendingMintAtomic, config.amountAtomic); });
      const unavailable = await once("native-rpc-outage");
      assert.equal(unavailable.status.state, "ACTIVE"); assert.equal(unavailable.result.state, "WAITING_FOR_DEPENDENCY");
      assert.equal(unavailable.result.reconciliation.reason, "DEPOSIT_ACCOUNTING_CATCHUP_REQUIRED");
      assert.equal(unavailable.sends, 0); assert.equal(unavailable.signingRequests, 0);
      pass("CREDIT_APPEND_CRASH_AND_RPC_OUTAGE_WAIT_NOT_FALSE_DEFICIT");
      await once();
      assert.equal(useLedger(l => l.serviceAccountingPending()), false);
      pass("RPC_RECOVERY_RETAINS_EXACT_CREDIT_AND_CANONICAL_RESERVE");
      const creditId = decodeCanonicalBridgeMessage(useLedger(l => l.serviceDeposit(request.operationId)).operation.finalizedCredit.encodedMessageHex).operationIdHex;
      const expired = useLedger(l => l.solanaServiceJournal("RECEIPT").get(creditId).prepared);
      assert.equal(expired.preparedTransactionBase64, heldPacket);
      const heightRpc = async () => {
        const response = await fetch(realSolana, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockHeight", params: [{ commitment: "finalized" }] }), signal: AbortSignal.timeout(10000) });
        return BigInt((await response.json()).result);
      };
      for (let i = 0; await heightRpc() <= BigInt(expired.lastValidBlockHeight); i++) {
        assert(i < 180, "TEST_EXPIRY_TIMEOUT"); diskGuard(); await delay(1000);
      }
      pass("REAL_UNSUBMITTED_SOLANA_PACKET_EXPIRED_NO_MINT");
      let mintRecordCrash = false;
      for (let i = 0; i < 100 && !mintRecordCrash; i++) {
        try { await once("crash-after-mint-record"); } catch (e) { if (e.code !== 73) throw e; mintRecordCrash = true; }
        if (!mintRecordCrash) await delay(500);
      }
      assert(mintRecordCrash, "TEST_MINT_RECORD_CRASH_NOT_REACHED");
      pass("EXPIRED_PACKET_REBUILT_SAME_CREDIT_AFTER_LIVE_ABSENCE_CHECK");
      useLedger(l => { assert.equal(l.bridgeSnapshot().bridgeIssuedOutstandingAtomic, "0"); l.pause(); });
      const mintPaused = await once(); assert.equal(mintPaused.status.state, "PAUSED"); assert.equal(mintPaused.sends, 0);
      assert.equal(mintPaused.status.accounting.bridgeIssuedOutstandingAtomic, config.amountAtomic);
      pass("PAUSED_RESTART_RETAINS_ALREADY_FINALIZED_MINT_WITHOUT_REMINT");
      await once("resume-reviewed");
      let minted;
      for (let i = 0; i < 100; i++) { minted = await once(); if (minted.status.deposits[0]?.state === "COMPLETED") break; await delay(500); }
      assert.equal(minted.status.deposits[0].state, "COMPLETED"); assert.equal(minted.result.reconciliation.state, "MATCH");
      assert.equal(minted.userDeposit.state, "COMPLETED"); assert(minted.userDeposit.transactionIds.solanaClaim);
      assert.equal(dropped.size, 2); pass("LOST_SOLANA_RECEIPT_AND_CLAIM_RESPONSES_RECOVERED");
      pass("AUTOMATIC_NATIVE_TO_SOLANA_COMPLETED_AND_RECONCILED");
      const sendCount = solanaSends, replay = await once();
      assert.equal(replay.sends, 0); assert.equal(replay.signingRequests, 0); assert.equal(solanaSends, sendCount);
      useLedger(l => { const mark = l.checkpoint(); l.watchServiceDeposit(request, policy); assert.deepEqual(l.checkpoint(), mark); });
      pass("DUPLICATE_DEPOSIT_AND_RESTART_NO_DOUBLE_MINT");
      let rpcId = 0;
      const rpc = async (method, params = []) => { const response = await fetch(realSolana, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }), signal: AbortSignal.timeout(10000) }); const value = await response.json();
        if (value.error) console.error(JSON.stringify({ testRpcMethod: method, code: value.error.code, transactionError: value.error.data?.err ?? null }));
        assert(response.ok && !value.error, "TEST_SOLANA_RPC_FAILED:" + method); return value.result; };
      const address = await cli("getnewaddress", ["service-withdrawal", "bech32m"], config.userWalletName);
      const destination = JSON.parse(await cli("getaddressinfo", [address], config.userWalletName)).scriptPubKey;
      // Test faucet funds the USER'S Solana wallet; the bridge SDK cannot sign it.
      const airdrop = await rpc("requestAirdrop", [user.signer.publicKeyBase58, 50000000]);
      for (let i = 0; i < 240; i++) {
        if ((await rpc("getSignatureStatuses", [[airdrop]])).value[0]?.confirmationStatus === "finalized") break;
        if (i === 239) throw new Error("TEST_USER_FEE_BALANCE_TIMEOUT"); await delay(250);
      }
      c.publicWithdrawal = { amountAtomic: "20000000", feeAtomic: "1000", destination: address,
        userAuthority: user.signer.publicKeyBase58, sourceTokenAccount: setup.recipientTokenAccountBase58,
        withdrawalIdHex: randomBytes(32).toString("hex"), nonceHex: randomBytes(32).toString("hex") };
      writeFileSync(file, JSON.stringify(c), { mode: 0o600 }); // Existing isolated test context only.
      stage = "SDK_USER_WITHDRAWAL";
      const walletRequest = await once("user-api-withdrawal-request");
      const walletMessage = decodeCanonicalBridgeMessage(walletRequest.encodedMessageHex);
      assert.equal(walletMessage.destinationHex, destination);
      const clockAccount = (await rpc("getAccountInfo", ["SysvarC1ock11111111111111111111111111111111", { encoding: "base64", commitment: "finalized" }])).value;
      const chainTime = Buffer.from(clockAccount.data[0], "base64").readBigInt64LE(32);
      assert(walletMessage.validFrom <= chainTime && walletMessage.validUntil > chainTime);
      assert.equal(walletMessage.validUntil - walletMessage.validFrom, 3600n);
      const userPacket = Buffer.from(walletRequest.transactionBase64, "base64"); assert(userPacket.subarray(1, 65).equals(Buffer.alloc(64)));
      user.signer.sign(userPacket.subarray(65)).copy(userPacket, 1);
      const bytes = userPacket.toString("base64");
      const signature = await rpc("sendTransaction", [bytes, { encoding: "base64", skipPreflight: false, maxRetries: 0 }]);
      for (let i = 0; i < 240; i++) { const status = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value[0];
        if (status?.confirmationStatus === "finalized") { assert.equal(status.err, null); break; } if (i === 239) throw new Error("TEST_BURN_FINALITY_TIMEOUT"); await delay(250); }
      stage = "AUTOMATIC_WITHDRAWAL_SERVICE";
      pass("SDK_BORSH_WITHDRAWAL_SIGNED_ONLY_BY_USER_ACCEPTED_ON_CHAIN");
      useLedger(l => l.pause()); const burnPaused = await once();
      assert.equal(burnPaused.status.accounting.pendingWithdrawalAtomic, "20000000"); assert.equal(burnPaused.sends, 0); assert.equal(burnPaused.signingRequests, 0);
      pass("PAUSED_SERVICE_OBSERVES_BURN_LIABILITY_WITHOUT_SIGNING");
      // Resume deliberately without running another tick, retaining the lost-
      // response injection for the first payout broadcast below.
      useLedger(l => l.resumeAfterReview());
      const withdrawal = await once("lose-native-response"); assert.equal(withdrawal.sends, 1); assert(withdrawal.signingRequests > 0);
      pass("AUTOMATIC_SOLANA_OBSERVER_FINDS_FINALIZED_WITHDRAWAL");
      const pending = await once(); assert.equal(pending.sends, 0); assert.equal(pending.signingRequests, 0);
      pass("PENDING_WITHDRAWAL_RESTART_LOST_RESPONSE_NO_DOUBLE_PAYOUT");
      assert.equal(pending.status.accounting.pendingWithdrawalAtomic, "20000000"); pass("BURN_REMAINS_PENDING_LIABILITY");
      await cli("generatetoaddress", [String(config.depositFinalityBlocks), f.miningAddress]);
      useLedger(l => l.pause()); const paidPaused = await once();
      assert.equal(paidPaused.status.withdrawals[0].state, "PAID"); assert.equal(paidPaused.sends, 0); assert.equal(paidPaused.signingRequests, 0);
      pass("PAUSED_SERVICE_RETAINS_FINALIZED_PAYOUT_CHANGE_AFTER_RESTART");
      await once("resume-reviewed");
      const completed = await once(); assert.equal(completed.status.withdrawals[0].state, "COMPLETED"); assert.equal(completed.result.reconciliation.state, "MATCH");
      assert.equal(completed.userWithdrawal.state, "COMPLETED"); assert.equal(completed.userWithdrawal.operationId, walletRequest.operationId);
      assert(completed.userWithdrawal.transactionIds.nativePayout); pass("USER_OPERATION_STATUS_HAS_FINALIZED_TRANSACTION_IDS");
      pass("AUTOMATIC_SOLANA_TO_NATIVE_COMPLETED_AND_RECONCILED");
      const duplicated = await once(); assert.equal(duplicated.sends, 0); assert.equal(duplicated.signingRequests, 0); pass("COMPLETED_WITHDRAWAL_REPLAY_NO_SECOND_PAYOUT");
      useLedger(l => l.pause()); const paused = await once(); assert.equal(paused.status.state, "PAUSED"); assert.equal(paused.sends, 0);
      const resumed = await once("resume-reviewed"); assert.equal(resumed.status.state, "ACTIVE"); assert.equal(resumed.result.reconciliation.state, "MATCH");
      pass("PERSISTENT_PAUSE_AND_EXPLICIT_REVIEWED_RESUME");
      const bank = verifyDeploymentSnapshot(manifest, await new LocalDeploymentRpc({ endpoint: realSolana }).snapshot(manifest));
      assert.equal(bank.mintSupplyAtomic, String(BigInt(config.amountAtomic) - 20_000_000n));
      report = { sourceSha, worktreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0,
        nativeToSolana: "COMPLETED", solanaToNative: "COMPLETED", noPerTransferKingPepeTeamApproval: true, accounting: resumed.status.accounting };
      return { state: "COMPLETED" };
    } catch (error) {
      failure = /^[A-Z_a-z0-9: ]{1,160}$/u.test(error.message) ? error.message : "LOCAL_SERVICE_ASSERTION_FAILED";
      if (typeof error.code === "string" && /^[A-Z_]{1,80}$/u.test(error.code)) failure += ":" + error.code;
      if (typeof error.step === "string" && /^[A-Z_]{1,80}$/u.test(error.step)) failure += ":" + error.step;
      if (error.code === "ERR_ASSERTION" && typeof error.actual === "string" && /^[A-Z_]{1,100}$/u.test(error.actual)) failure += ":" + error.actual;
      failureLocation = error.stack?.match(/[a-zA-Z0-9_-]+\.mjs:[0-9]+:[0-9]+/u)?.[0];
      throw error;
    }
    finally { if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); } diskGuard(); }
  });
  const complete = result.state === "LOCAL_E2E_BOOTSTRAP_READY" && report?.nativeToSolana === "COMPLETED" && report?.solanaToNative === "COMPLETED" && !failure && passed.length === 25;
  return { ...report, state: complete ? "COMPLETED" : "BLOCKED", stage, reason: failure ?? result.reason, failureLocation,
    checks: { pass: passed.length, fail: complete ? 0 : 1, passed }, productionReady: false, mainnetActivation: "DISABLED" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  if (process.argv[2] === "--service-child") await child(process.argv[3], process.argv[4]);
  else { const result = await runLocalBridgeService(v => process.stderr.write(v + "\n")); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.state === "COMPLETED" ? 0 : 1; }
}
