// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Real zero-state REGTEST + local validator; no production state or funds.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withLocalE2eInfrastructure } from "../../scripts/local-e2e-bootstrap.mjs";
import { buildRegtestCliArguments } from "../../scripts/local-e2e-orchestrator.mjs";
import { createLocalSolanaSetupContext, createNativeToSolanaFlowConfig, createLocalFrostTaprootCustodyContext,
  executeNativeDepositObservationFlow, openLocalnetDepositCreditLedger, submitLocalnetSolanaSetup, submitLocalnetSolanaDepositClaim } from "../../scripts/local-e2e-native-to-solana.mjs";
import { createLocalNativeEvidenceVerifier } from "../../scripts/local-native-evidence-verifier.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";
import { SPL_TOKEN_PROGRAM_ID_BASE58 as TOKEN, SYSTEM_PROGRAM_ID_BASE58 as SYSTEM } from "../../services/bridge-validator/localnet-solana-setup-plan.mjs";
import { decodeCanonicalBridgeMessage, encodeCanonicalBridgeMessage } from "../../shared/protocol/canonical-message.mjs";
import { NativeRpcClient } from "../../native/node/native-rpc-client.mjs";
import { LocalDeploymentRpc } from "../../services/solana-observer/deployment-integrity.mjs";
import { FinalizedWithdrawalReader } from "../../services/solana-observer/finalized-withdrawal.mjs";
import { AutomaticSolanaToNativeWithdrawal, verifyWithdrawalSigning } from "../../services/bridge-validator/automatic-withdrawal.mjs";
import { LocalWithdrawalService } from "../../services/relayer/withdrawal-service.mjs";
import { NativeFrostSigner, NativeFrostCoordinator, FileBackedFrostStateStore, REQUIRED_FROST_SIGNERS, createNativeSigningPolicy } from "../../native/frost/index.mjs";
import { withdrawalSigningIntents, validateSignedWithdrawal } from "../../native/reserve/withdrawal-plan.mjs";
import { createWithdrawalInstruction } from "../ts/sdk/withdrawal.mjs";
import { localDeploymentManifest } from "./local-deployment-integrity.mjs";
import { packet } from "./local-transaction-packet.mjs";
import { validateRuntimeFile } from "../../shared/runtime-path-boundary.mjs";

async function resumeInChild(file) {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const c = JSON.parse(readFileSync(validateRuntimeFile(file, repoRoot), "utf8"));
  assert.equal(c.accounting.plan.repoRoot, repoRoot);
  const ledger = openLocalnetDepositCreditLedger(c.accounting);
  try {
    const plan = c.accounting.plan, config = c.accounting.flowConfig;
    const solanaRpc = new LocalDeploymentRpc({ endpoint: `http://127.0.0.1:${plan.ports.solanaRpcPort}` });
    const nativeRpc = new NativeRpcClient({ endpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`, authCookieFile: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot, localOnly: true });
    nativeRpc.sendRawTransaction = async () => { throw new Error("TEST_SECOND_BROADCAST_FORBIDDEN"); };
    const worker = new AutomaticSolanaToNativeWithdrawal({ environment: "localnet", ledger,
      reader: new FinalizedWithdrawalReader({ rpc: solanaRpc, manifest: c.manifest }), nativeVerifier: await createLocalNativeEvidenceVerifier({ plan }),
      nativeRpc, solanaRpc, manifest: c.manifest, reserveScriptHex: c.reserveScriptHex, minimumConfirmations: config.depositFinalityBlocks,
      maxAmountAtomic: config.maxAmountAtomic, maxFeeAtomic: config.maxFeeAtomic, createCoordinator: () => { throw new Error("TEST_RESIGN_FORBIDDEN"); } });
    const service = new LocalWithdrawalService({ ledger, worker });
    const stop = new AbortController(); let tick;
    await service.run({ signal: stop.signal, intervalMs: 250, onStatus: value => { tick = value; stop.abort(); } });
    assert.equal(tick.operations.length, 1);
    const result = tick.operations[0];
    console.log(JSON.stringify({ state: result.state, accounting: result.accounting }));
  } finally { ledger.close(); }
}

export async function runLocalWithdrawalE2e(repoRoot, onCheck = () => {}) {
  const checks = []; let stage = "BOOTSTRAP", failure, report;
  const pass = label => { checks.push(label); onCheck(label); };
  const result = await withLocalE2eInfrastructure({ repoRoot }, async context => {
    let ledger;
    try {
      const { plan, executor, commandPaths } = context;
      const cli = async (command, parameters = [], wallet) => {
        assert(["getnewaddress", "getaddressinfo", "generatetoaddress", "testmempoolaccept", "invalidateblock", "generateblock"].includes(command));
        const r = await executor.runOneShot({ step: "LOCAL_WITHDRAWAL_TEST_" + command.toUpperCase(), executable: commandPaths.get("kingpepe-cli"),
          args: buildRegtestCliArguments({ datadir: plan.paths.nativeDatadir, rpcPort: plan.ports.nativeRpcPort, wallet, command, parameters }), cwd: repoRoot });
        return String(r.output).trim();
      };
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const userBytes = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
      const user = { publicKeyBase58: base58Encode(userBytes), publicKeyHex: userBytes.toString("hex"), sign: b => sign(null, b, privateKey) };
      const generated = createLocalSolanaSetupContext(), setup = { ...generated, recipientTokenAccountOwnerBase58: user.publicKeyBase58, recipientTokenAccountOwnerHex: user.publicKeyHex };
      const config = createNativeToSolanaFlowConfig({ plan, repoRoot, mintHex: setup.mintHex, keyEpoch: setup.keyEpoch, policyEpoch: setup.policyEpoch });
      let custody, verifier, reserveReceipt, accounting, claimContext;
      stage = "NATIVE_TO_SOLANA";
      const deposit = await executeNativeDepositObservationFlow({ ...context, flowConfig: config, localSolanaSetupContext: setup,
        custodyFactory: async o => custody = await createLocalFrostTaprootCustodyContext(o),
        nativeEvidenceVerifierFactory: async o => {
          verifier = await createLocalNativeEvidenceVerifier(o);
          const actual = verifier.verifyReserve.bind(verifier);
          verifier.verifyReserve = async p => { const receipt = await actual(p); reserveReceipt = receipt; return receipt; };
          return verifier;
        },
        solanaSetup: async o => { accounting = { plan, flowConfig: config, credit: o.depositCredit }; return submitLocalnetSolanaSetup(o); },
        solanaDepositClaim: async o => { claimContext = o; return submitLocalnetSolanaDepositClaim(o); } });
      assert.equal(deposit.state, "COMPLETED"); pass("FRESH_NATIVE_TO_SOLANA_COMPLETED");
      ledger = openLocalnetDepositCreditLedger(accounting);
      const depositMessage = decodeCanonicalBridgeMessage(accounting.credit.encodedMessageHex);
      assert.equal(ledger.availableReserveInputs()[0].txid, reserveReceipt.reserveBasis.sweep.txid);
      const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
      const manifest = await localDeploymentManifest({ context: claimContext, authority: SYSTEM, sourceSha });
      const solana = new LocalDeploymentRpc({ endpoint: `http://127.0.0.1:${plan.ports.solanaRpcPort}` });
      const reader = new FinalizedWithdrawalReader({ rpc: solana, manifest });
      const native = new NativeRpcClient({ endpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`, authCookieFile: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot, localOnly: true });
      let rpcId = 0;
      const rpc = async (method, params) => {
        const response = await fetch(`http://127.0.0.1:${plan.ports.solanaRpcPort}`, { method: "POST", headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(10000), body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
        const value = await response.json(); assert(response.ok && !value.error, "TEST_SOLANA_RPC_REJECTED"); return value.result;
      };
      const send = async instructions => {
        const budget = Buffer.alloc(5); budget[0] = 2; budget.writeUInt32LE(600000, 1);
        const latest = (await rpc("getLatestBlockhash", [{ commitment: "finalized" }])).value;
        const bytes = await packet(setup.feePayerSigner, [user], latest.blockhash, [{ program: "ComputeBudget111111111111111111111111111111", accounts: [], data: budget }, ...instructions]);
        const signature = await rpc("sendTransaction", [bytes, { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
        for (let i = 0; i < 240; i++) {
          const status = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value[0];
          if (status?.confirmationStatus === "finalized") return { signature, error: status.err };
          await delay(250);
        }
        throw new Error("TEST_SOLANA_FINALITY_TIMEOUT");
      };
      stage = "USER_BURN";
      const destinationAddress = await cli("getnewaddress", ["withdrawal", "bech32m"], config.userWalletName);
      const destination = JSON.parse(await cli("getaddressinfo", [destinationAddress], config.userWalletName)).scriptPubKey;
      const encoded = encodeCanonicalBridgeMessage({ ...depositMessage, operationId: undefined, action: "WithdrawalRequest", direction: "SolanaToNative",
        depositOutpoint: { txid: new Uint8Array(32), vout: 0 }, withdrawalId: randomBytes(32), nonce: randomBytes(32), amountAtomic: 20_000_000n,
        feeAtomic: 1000n, destination: Buffer.from(destination, "hex") });
      const message = decodeCanonicalBridgeMessage(encoded);
      const instruction = createWithdrawalInstruction({ encodedMessageHex: Buffer.from(encoded).toString("hex"), userAuthority: user.publicKeyBase58,
        payer: setup.feePayerSigner.publicKeyBase58, sourceTokenAccount: setup.recipientTokenAccountBase58 });
      const sent = await send([instruction]); assert.equal(sent.error, null, "VALID_WITHDRAWAL_FAILED");
      stage = "FINALIZED_READER";
      const observed = await reader.read(sent.signature); assert.equal(observed.grossAtomic, "20000000"); assert.equal(observed.destinationHex, destination);
      pass("REAL_FINALIZED_BURN_CHECKED_AND_WITHDRAWAL_RECORD");
      const duplicate = await send([instruction]); assert(duplicate.error); await assert.rejects(() => reader.read(duplicate.signature)); pass("DUPLICATE_WITHDRAWAL_REJECTED_ON_CHAIN");
      const wrong = encodeCanonicalBridgeMessage({ ...message, operationId: undefined, amountAtomic: 19_000_000n });
      await assert.rejects(() => reader.read(sent.signature, Buffer.from(wrong).toString("hex"))); pass("WRONG_AMOUNT_OBSERVATION_REJECTED");
      const options = () => ({ environment: "localnet", ledger, reader, nativeVerifier: verifier, nativeRpc: native, solanaRpc: solana, manifest,
        reserveScriptHex: custody.taprootScriptPubKeyHex, minimumConfirmations: config.depositFinalityBlocks,
        maxAmountAtomic: config.maxAmountAtomic, maxFeeAtomic: config.maxFeeAtomic });
      let signerCalls = 0;
      const factory = ({ intents, verify }) => {
        const policy = createNativeSigningPolicy({ environment: "localnet", nativeNetwork: "regtest", nativeGenesisHash: config.nativeChainName === "regtest" ? manifest.nativeGenesisHex : "",
          solanaDeployment: config.solanaDeploymentHex, bridgeProgramId: config.bridgeProgramIdHex, transceiverProgramId: config.transceiverProgramIdHex, mint: config.mintHex,
          keyEpoch: config.keyEpoch, maxAmountAtomic: config.maxAmountAtomic, maxFeeAtomic: config.maxFeeAtomic, reserveScriptPubKeyHex: custody.taprootScriptPubKeyHex, authorizedOperations: intents });
        const signers = REQUIRED_FROST_SIGNERS.map((signerId, index) => new NativeFrostSigner({ signerId, index, policy,
          nativeEvidenceValidator: async intent => { signerCalls++; return verify(intent); },
          stateStore: new FileBackedFrostStateStore({ signerId, repoRoot, root: index === 0 ? custody.signerStateRoots.frostA : custody.signerStateRoots.frostB }) }));
        return new NativeFrostCoordinator({ signers, publicPackage: custody.publicPackage, aggregateTweakedXOnlyPublicKey: custody.aggregateTweakedXOnlyPublicKey });
      };
      stage = "MISSING_SIGNER";
      const absent = new AutomaticSolanaToNativeWithdrawal({ ...options(), createCoordinator: () => new NativeFrostCoordinator({ signers: [], publicPackage: custody.publicPackage,
        aggregateTweakedXOnlyPublicKey: custody.aggregateTweakedXOnlyPublicKey }) });
      const service = new LocalWithdrawalService({ ledger, worker: absent });
      await service.submit(sent.signature);
      const queued = ledger.checkpoint(); await service.submit(sent.signature);
      assert.deepEqual(ledger.checkpoint(), queued); assert.equal(ledger.withdrawal(message.operationIdHex), undefined);
      assert.equal(service.status().accounting.pendingWithdrawalAtomic, "20000000");
      assert.equal(service.status().withdrawals[0].operationId, message.operationIdHex);
      pass("DURABLE_INBOX_RETAINS_FINALIZED_LIABILITY_BEFORE_INPUT_SELECTION");
      await assert.rejects(() => absent.run(sent.signature));
      assert.equal(ledger.withdrawal(message.operationIdHex).state, "FINALIZED_ON_SOLANA"); assert.equal(ledger.availableReserveInputs().length, 0);
      assert.equal(ledger.bridgeSnapshot().pendingWithdrawalAtomic, "20000000"); pass("MISSING_SIGNER_NO_FALLBACK_DURABLE_LIABILITY_AND_INPUT_LOCK");
      const p = ledger.withdrawal(message.operationIdHex).plan, intent = withdrawalSigningIntents(p)[0];
      for (const [label, patch] of [["AMOUNT", { amountAtomic: "1" }], ["RECIPIENT", { recipientScriptPubKeyHex: "5120" + "01".repeat(32) }],
        ["FEE", { feeAtomic: "2" }], ["SIGHASH", { taprootSighashHex: "ff".repeat(32) }], ["PROGRAM", { bridgeProgramId: "ff".repeat(32) }]]) {
        await assert.rejects(() => verifyWithdrawalSigning({ plan: p, intent: { ...intent, ...patch }, reader, nativeVerifier: verifier })); pass("LIVE_SIGNING_REJECTS_WRONG_" + label);
      }
      stage = "FROST_AND_LOST_BROADCAST_RESPONSE";
      const actualSend = native.sendRawTransaction.bind(native); let sends = 0;
      native.sendRawTransaction = async raw => { sends++; const id = await actualSend(raw); assert.equal(typeof id, "string"); throw new Error("TEST_LOST_BROADCAST_RESPONSE"); };
      const worker = new AutomaticSolanaToNativeWithdrawal({ ...options(), createCoordinator: factory });
      await assert.rejects(() => worker.run(sent.signature), /TEST_LOST_BROADCAST_RESPONSE/u);
      const broadcast = ledger.withdrawal(message.operationIdHex); assert.equal(broadcast.state, "BROADCAST"); assert.equal(broadcast.attempts, 1); assert.equal(signerCalls, 2);
      validateSignedWithdrawal(broadcast.plan, broadcast.signedTransactionHex); pass("REAL_FROST_A_B_NATIVE_ACCEPTED_PAYOUT");
      const badSignature = broadcast.signedTransactionHex.slice(0, -20) + (broadcast.signedTransactionHex.slice(-20, -18) === "00" ? "01" : "00") + broadcast.signedTransactionHex.slice(-18);
      assert.throws(() => validateSignedWithdrawal(broadcast.plan, badSignature)); pass("INVALID_PAYOUT_SIGNATURE_REJECTED_BEFORE_RELAY");
      const checkpoint = ledger.checkpoint(); ledger.close();
      ledger = openLocalnetDepositCreditLedger({ ...accounting, minimumCheckpoint: checkpoint });
      assert.equal(ledger.withdrawal(message.operationIdHex).signedTransactionHex, broadcast.signedTransactionHex);
      pass("RESTART_RESTORES_EXACT_BROADCAST_TRANSACTION_AND_UNPAID_LIABILITY");
      native.sendRawTransaction = async () => { throw new Error("TEST_SECOND_BROADCAST_FORBIDDEN"); };
      const restarted = new AutomaticSolanaToNativeWithdrawal({ ...options(), createCoordinator: () => { throw new Error("TEST_RESIGN_FORBIDDEN"); } });
      assert.equal((await restarted.run(sent.signature)).state, "BROADCAST"); pass("LOST_RESPONSE_OBSERVED_WITHOUT_RESIGN_OR_ALTERNATE_INPUTS");
      // Only test public context and local paths; no share or private key is
      // serialized. The new process loads the durable accounting journal.
      const resumeFile = validateRuntimeFile(path.join(plan.runRoot, "withdrawal-resume-test.json"), repoRoot);
      writeFileSync(resumeFile, JSON.stringify({ accounting, manifest, reserveScriptHex: custody.taprootScriptPubKeyHex }), { flag: "wx", mode: 0o600, flush: true });
      const resume = () => {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--resume", resumeFile], { cwd: repoRoot,
          env: process.env, timeout: 120000, maxBuffer: 4096, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        assert.equal(child.status, 0, "WITHDRAWAL_RESUME_PROCESS_FAILED"); assert.equal(child.stderr.length, 0, "WITHDRAWAL_RESUME_PROCESS_ERROR");
        return JSON.parse(child.stdout);
      };
      ledger.close(); assert.equal(resume().state, "BROADCAST"); pass("SEPARATE_PROCESS_RESUMES_UNFINALIZED_PAYOUT_WITHOUT_REBROADCAST");
      pass("SERVICE_RESTART_FINDS_DURABLE_REQUEST_WITHOUT_CLIENT_RESUBMISSION");
      stage = "NATIVE_FINALITY_AND_RECONCILIATION";
      await cli("generatetoaddress", [String(config.depositFinalityBlocks), destinationAddress]);
      const completed = resume(); assert.equal(completed.state, "COMPLETED"); assert.equal(sends, 1);
      ledger = openLocalnetDepositCreditLedger(accounting);
      const finalizedWorker = new AutomaticSolanaToNativeWithdrawal({ ...options(), createCoordinator: () => { throw new Error("TEST_RESIGN_FORBIDDEN"); } });
      assert.equal(completed.accounting.pendingWithdrawalAtomic, "0"); assert.equal(completed.accounting.reserveAtomic, (BigInt(config.amountAtomic) - message.amountAtomic).toString());
      pass("NATIVE_FINALITY_RECONCILIATION_COMPLETED");
      assert.equal((await finalizedWorker.run(sent.signature)).replay, true); assert.equal(sends, 1); pass("DUPLICATE_OPERATION_NO_DOUBLE_PAYOUT");
      const direct = Buffer.alloc(10); direct[0] = 15; direct.writeBigUInt64LE(1n, 1); direct[9] = 8;
      const directBurn = await send([{ program: TOKEN, accounts: [{ key: setup.recipientTokenAccountBase58, writable: true, signer: false },
        { key: setup.mintBase58, writable: true, signer: false }, { key: user.publicKeyBase58, writable: false, signer: true }], data: direct }]);
      assert.equal(directBurn.error, null); await assert.rejects(() => reader.read(directBurn.signature)); pass("REAL_DIRECT_SPL_BURN_NO_PAYOUT_RIGHT");
      assert.equal((await finalizedWorker.reconcile()).directBurnDifferenceAtomic, "1"); pass("DIRECT_BURN_NOT_SPENDABLE_SURPLUS");
      stage = "ACCEPTED_PAYOUT_REORG";
      const paid = ledger.withdrawal(message.operationIdHex).payment, beforeReorg = ledger.bridgeSnapshot();
      await cli("invalidateblock", [paid.blockHash]);
      // Empty competing blocks do not simply re-include the old payout.
      for (let n = 0; n <= config.depositFinalityBlocks; n++) await cli("generateblock", [destinationAddress, "[]"]);
      const incident = await finalizedWorker.reconcile();
      assert.equal(incident.state, "PAUSED"); assert.equal(incident.reason, "ACCEPTED_NATIVE_OPERATION_REORG");
      assert(incident.affectedOperations.includes(message.operationIdHex)); assert.deepEqual(ledger.bridgeSnapshot(), beforeReorg); assert.equal(sends, 1);
      pass("ACCEPTED_PAYOUT_REORG_PAUSES_WITHOUT_SECOND_PAYMENT_OR_BALANCE_REPAIR");
      const stop = ledger.checkpoint(); ledger.close(); ledger = openLocalnetDepositCreditLedger({ ...accounting, minimumCheckpoint: stop });
      assert.equal(ledger.status().state, "HARD_STOP"); assert.throws(() => ledger.recordCanonicalReserve(reserveReceipt, depositMessage.operationIdHex)); pass("PAUSE_SURVIVES_RESTART_NO_NEW_AUTHORIZATION");
      const pausedService = new LocalWithdrawalService({ ledger, worker: new AutomaticSolanaToNativeWithdrawal({ ...options(), createCoordinator: () => { throw new Error("TEST_SIGN_WHILE_PAUSED_FORBIDDEN"); } }) });
      assert.equal((await pausedService.tick()).state, "PAUSED"); assert.deepEqual(pausedService.status().accounting, beforeReorg);
      pass("SERVICE_RESTART_PRESERVES_PAUSE_AND_READ_ONLY_ACCOUNTING");
      report = { state: "COMPLETED", checks: { pass: checks.length, fail: 0, passed: checks }, nativeToSolana: "COMPLETED", solanaToNative: "COMPLETED",
        noPerTransferKingPepeTeamApproval: true, sourceSha, worktreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0 };
      return { withdrawalE2e: report };
    } catch (error) {
      failure = { stage, code: /^[A-Za-z][A-Za-z0-9_:-]{0,100}$/u.test(error.message) ? error.message : "LOCAL_WITHDRAWAL_ASSERTION_FAILED",
        testLine: Number(error.stack?.match(/local-withdrawal-e2e\.mjs:(\d+):/u)?.[1]) || undefined };
      throw error;
    } finally { ledger?.close(); }
  });
  if (result.state !== "LOCAL_E2E_BOOTSTRAP_READY" || !report?.checks) {
    // Bootstrap reports callback failures without exposing private command output.
    throw new Error("LOCAL_WITHDRAWAL_E2E_FAILED", { cause: failure ?? { stage, code: "INFRASTRUCTURE_NOT_COMPLETED" } });
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--resume") await resumeInChild(process.argv[3]);
    else console.log(JSON.stringify(await runLocalWithdrawalE2e(process.argv[2] ?? path.resolve(import.meta.dirname, "../.."), label => process.stderr.write("CHECK " + label + "\n"))));
  }
  catch (e) { console.error(JSON.stringify({ error: "LOCAL_WITHDRAWAL_E2E_FAILED", detail: e.cause })); process.exitCode = 1; }
}
