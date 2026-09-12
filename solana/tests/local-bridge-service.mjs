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
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";
import { createWithdrawalInstruction } from "../ts/sdk/withdrawal.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { packet } from "./local-transaction-packet.mjs";

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
    if (mode === "resume-reviewed") await service.resumeAfterReview();
    const stop = new AbortController(); let result;
    await service.run({ signal: stop.signal, intervalMs: 250, onStatus: value => { result = value; stop.abort(); } });
    process.stdout.write(JSON.stringify({ result, status: service.status(), signingRequests, sends }) + "\n");
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
      const request = { operationId: f.operationIdHex, depositIntent: f.depositIntentContext, userRecoveryPublicKeyHex: f.depositPolicy.userRecoveryPublicKeyHex,
        depositTxidHex: f.inputs[0].txid, depositVout: null, feeFundingInputs: f.inputs.slice(1) };
      const file = validateRuntimeFile(path.join(plan.runRoot, "local-service-private-test-context.json"), repoRoot);
      writeFileSync(file, JSON.stringify(c), { flag: "wx", mode: 0o600 });
      const useLedger = fn => { const ledger = AuthenticatedLocalDepositLedger.openLocal(ledgerOptions(c)); try { return fn(ledger); } finally { ledger.close(); } };
      stage = "SERVICE_JOURNAL_SETUP";
      const created = AuthenticatedLocalDepositLedger.createLocal(ledgerOptions(c));
      try { created.watchServiceDeposit(request, policy); created.pause(); } finally { created.close(); }
      const once = async mode => { diskGuard(); const r = await promisify(execFile)(process.execPath, [self, "--service-child", file, mode ?? "tick"],
        { cwd: repoRoot, timeout: 90000, maxBuffer: 65536, windowsHide: true }); return JSON.parse(r.stdout); };
      const cli = async (command, parameters = [], wallet) => {
        assert(["generatetoaddress", "getnewaddress", "getaddressinfo"].includes(command));
        const r = await executor.runOneShot({ step: "LOCAL_SERVICE_TEST_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
        return String(r.output).trim();
      };
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
      assert.equal(dropped.size, 2); pass("LOST_SOLANA_RECEIPT_AND_CLAIM_RESPONSES_RECOVERED");
      pass("AUTOMATIC_NATIVE_TO_SOLANA_COMPLETED_AND_RECONCILED");
      const sendCount = solanaSends, replay = await once();
      assert.equal(replay.sends, 0); assert.equal(replay.signingRequests, 0); assert.equal(solanaSends, sendCount);
      useLedger(l => { const mark = l.checkpoint(); l.watchServiceDeposit(request, policy); assert.deepEqual(l.checkpoint(), mark); });
      pass("DUPLICATE_DEPOSIT_AND_RESTART_NO_DOUBLE_MINT");
      let rpcId = 0;
      const rpc = async (method, params = []) => { const response = await fetch(realSolana, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }), signal: AbortSignal.timeout(10000) }); const value = await response.json(); assert(response.ok && !value.error, "TEST_SOLANA_RPC_FAILED"); return value.result; };
      const address = await cli("getnewaddress", ["service-withdrawal", "bech32m"], config.userWalletName);
      const destination = JSON.parse(await cli("getaddressinfo", [address], config.userWalletName)).scriptPubKey;
      const depositCredit = useLedger(l => l.serviceDeposit(request.operationId).operation.finalizedCredit);
      const originalMessage = decodeCanonicalBridgeMessage(depositCredit.encodedMessageHex);
      const encoded = encodeCanonicalBridgeMessage({ ...originalMessage, operationId: undefined, action: "WithdrawalRequest", direction: "SolanaToNative",
        depositOutpoint: { txid: new Uint8Array(32), vout: 0 }, withdrawalId: randomBytes(32), nonce: randomBytes(32), amountAtomic: 20_000_000n,
        feeAtomic: 1000n, destination: Buffer.from(destination, "hex") });
      const instruction = createWithdrawalInstruction({ encodedMessageHex: Buffer.from(encoded).toString("hex"), userAuthority: user.signer.publicKeyBase58,
        payer: fee.signer.publicKeyBase58, sourceTokenAccount: setup.recipientTokenAccountBase58 });
      const budget = Buffer.alloc(5); budget[0] = 2; budget.writeUInt32LE(600000, 1);
      const latest = (await rpc("getLatestBlockhash", [{ commitment: "finalized" }])).value;
      const bytes = await packet(fee.signer, [user.signer], latest.blockhash, [{ program: "ComputeBudget111111111111111111111111111111", accounts: [], data: budget }, instruction]);
      const signature = await rpc("sendTransaction", [bytes, { encoding: "base64", skipPreflight: false, maxRetries: 0 }]);
      for (let i = 0; i < 240; i++) { const status = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value[0];
        if (status?.confirmationStatus === "finalized") { assert.equal(status.err, null); break; } if (i === 239) throw new Error("TEST_BURN_FINALITY_TIMEOUT"); await delay(250); }
      stage = "AUTOMATIC_WITHDRAWAL_SERVICE";
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
  const complete = result.state === "LOCAL_E2E_BOOTSTRAP_READY" && report?.nativeToSolana === "COMPLETED" && report?.solanaToNative === "COMPLETED" && !failure && passed.length === 22;
  return { ...report, state: complete ? "COMPLETED" : "BLOCKED", stage, reason: failure ?? result.reason, failureLocation,
    checks: { pass: passed.length, fail: complete ? 0 : 1, passed }, productionReady: false, mainnetActivation: "DISABLED" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  if (process.argv[2] === "--service-child") await child(process.argv[3], process.argv[4]);
  else { const result = await runLocalBridgeService(v => process.stderr.write(v + "\n")); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.state === "COMPLETED" ? 0 : 1; }
}
