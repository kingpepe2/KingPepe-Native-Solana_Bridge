import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { REGTEST_GENESIS } from "../../native/node/native-raw-evidence.mjs";
import {
  LOCAL_NATIVE_TO_SOLANA_COMPLETED,
  LOCAL_NATIVE_TO_SOLANA_BLOCKED,
  LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL,
  LOCAL_NATIVE_TO_SOLANA_RECONCILED,
  LOCAL_NATIVE_TO_SOLANA_RESERVE_SWEEP_FINALIZED,
  LOCAL_NATIVE_TO_SOLANA_SOLANA_SETUP_FINALIZED,
  LOCAL_NATIVE_TO_SOLANA_WAITING_FOR_DEPENDENCY,
  createLocalSolanaSetupContext,
  createLocalFrostTaprootCustodyContext,
  createNativeToSolanaFlowConfig,
  draftLocalReserveSweep,
  executeNativeDepositObservationFlow as executeOrchestration,
  findDepositOutput,
  p2trScriptPubKeyHex,
  signLocalReserveSweepWithFrost,
  taprootAddressFromXOnlyPublicKey,
  validateFinalizedLocalReserveSweep,
  publicLocalSolanaSetupContext,
  validateLocalNativeSourceSnapshot,
  validateRawDepositTransaction,
  runLocalNativeToSolanaE2e as runOrchestration,
  openLocalnetDepositCreditLedger,
  validateDepositUtxo,
} from "../local-e2e-native-to-solana.mjs";
import { createLocalE2ePlan } from "../local-e2e-orchestrator.mjs";
import { REQUIRED_LOCAL_E2E_EXECUTABLES } from "../local-e2e-readiness.mjs";
import {
  attachKeyPathTaprootWitnesses,
  attachTaprootWitnesses,
  createLocalTaprootSighashEvidences,
  parseNativeTransactionHex,
} from "../../native/node/native-taproot-transaction.mjs";
import { base58Encode } from "../../services/bridge-validator/solana-deposit-claim-transaction-plan.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
// These are orchestration models, not Native reserve proof. The default real
// E2E recorder requires the verifier's branded receipt and is chain-tested.
const modelReserveAccounting = (_ledger, receipt) => assert.equal(receipt.status, "SOURCE_MODEL_ONLY");
const runLocalNativeToSolanaE2e = options => runOrchestration({ ...options, reserveAccounting: modelReserveAccounting });
const executeNativeDepositObservationFlow = options => executeOrchestration({ ...options, reserveAccounting: modelReserveAccounting });
const DEPOSIT_TXID = h("phase08-real-daemon-deposit-txid");
const FEE_FUNDING_TXID = h("phase08-reserve-sweep-fee-funding-txid");
// Public generator-point fixtures, not operational signing identities.
const FROST_AGGREGATE_XONLY_HEX = Buffer.from(secp256k1.Point.BASE.toBytes()).subarray(1).toString("hex");
const RECOVERY_PUBLIC_KEY_HEX = Buffer.from(secp256k1.Point.BASE.double().toBytes()).toString("hex");
const SCRIPT_HEX = p2trScriptPubKeyHex(FROST_AGGREGATE_XONLY_HEX);
const FEE_FUNDING_SCRIPT_HEX = SCRIPT_HEX;
const FROST_TAPROOT_ADDRESS = taprootAddressFromXOnlyPublicKey(FROST_AGGREGATE_XONLY_HEX, "rkpepe");
const REGTEST_GENESIS_HASH = REGTEST_GENESIS;
const REGTEST_BEST_BLOCK_HASH = h("kingpepe-regtest-best-block");
const UNSIGNED_SWEEP_HEX = buildUnsignedSweepHex();
const UNSIGNED_SWEEP_TXID = parseNativeTransactionHex(UNSIGNED_SWEEP_HEX).txidHex;

test("native-to-solana runner blocks before executing deposit flow when local infrastructure is missing", async () => {
  const executor = new FakeExecutor();
  const result = await runLocalNativeToSolanaE2e({
    repoRoot: REPO_ROOT,
    runRoot: path.join(os.tmpdir(), "kingpepe-native-to-solana-blocked"),
    envPath: "",
    platform: "linux",
    executor,
  });

  assert.equal(result.protocol, LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL);
  assert.equal(result.state, LOCAL_NATIVE_TO_SOLANA_BLOCKED);
  assert.equal(result.reason, "READINESS_BLOCKED");
  assert.equal(result.productionReady, false);
  assert.equal(result.mainnetActivation, "DISABLED");
  assert.equal(result.fullNativeToSolanaE2e, "NOT_RUN_INFRASTRUCTURE_BLOCKED");
  assert.deepEqual(executor.calls, []);
});

test("native-to-solana orchestration model executes observation sequence without a team approval state", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-runner-"));
  const executor = new FakeExecutor();
  try {
    const result = await runLocalNativeToSolanaE2e({
      plan: readyPlan(runRoot),
      executor,
      programArtifactExists: () => true,
      healthAttempts: 1,
      custodyFactory: fakeCustodyFactory,
      reserveSweepSigner: fakeReserveSweepSigner,
      nativeEvidenceVerifierFactory: fakeNativeEvidenceVerifierFactory,
      localSolanaSetupFactory: fakeLocalSolanaSetupFactory,
      solanaSetup: fakeSolanaSetup,
      solanaDepositClaim: fakeSolanaDepositClaim,
      flowConfig: {
        runId: "test-run",
        amountNative: "1.00000000",
      },
    });

    assert.equal(
      result.state,
      LOCAL_NATIVE_TO_SOLANA_COMPLETED,
      JSON.stringify({
        state: result.state,
        reason: result.reason,
        bootstrapError: result.infrastructure?.error,
        flowReason: result.nativeToSolanaE2e?.reason,
      }),
    );
    assert.equal(result.reason, "ALL_REQUIRED_CHECKS_PASSED");
    assert.equal(result.fullNativeToSolanaE2e, "PASS");
    assert.equal(result.nativeToSolanaE2e.completedStage, LOCAL_NATIVE_TO_SOLANA_RECONCILED);
    assert.equal(result.nativeToSolanaE2e.noPerTransferKingPepeTeamApprovalState, true);
    assert.equal(result.nativeToSolanaE2e.solanaSetup.state, "COMPLETED");
    assert.equal(result.nativeToSolanaE2e.solanaSetup.reason, "LOCALNET_SOLANA_SETUP_FINALIZED");
    assert.equal(result.nativeToSolanaE2e.solanaSetup.transactionPlan.initialSupplyAtomic, "0");
    assert.equal(result.nativeToSolanaE2e.solanaSetup.transactionPlan.freezeAuthority, null);
    assert.equal(result.nativeToSolanaE2e.solanaSetup.request.mintHex, result.nativeToSolanaE2e.solanaSetup.transactionPlan.mintHex);
    assert.equal(result.nativeToSolanaE2e.depositClaim.state, "VERIFIED_READY");
    assert.equal(result.nativeToSolanaE2e.depositClaim.threshold, 2);
    assert.equal(result.nativeToSolanaE2e.depositClaim.amountAtomic, "100000000");
    assert.equal(result.nativeToSolanaE2e.depositClaim.solanaRecipientHex, result.nativeToSolanaE2e.solanaSetup.request.recipientTokenAccountHex);
    assert.equal(result.nativeToSolanaE2e.depositClaim.sourceTrust, "RPC_OBSERVATION");
    assert.match(result.nativeToSolanaE2e.depositClaim.messageDigestHex, /^[0-9a-f]{64}$/u);
    assert.match(result.nativeToSolanaE2e.depositClaim.reserveAllocationIdHex, /^[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(result.nativeToSolanaE2e.depositClaim).includes("sign"), false);
    assert.equal(result.nativeToSolanaE2e.solanaDepositClaim.state, "COMPLETED");
    assert.equal(result.nativeToSolanaE2e.solanaDepositClaim.reason, "SOLANA_DEPOSIT_CLAIM_FINALIZED");
    assert.equal(result.nativeToSolanaE2e.solanaDepositClaim.mintedAmountAtomic, "100000000");
    assert.equal(result.nativeToSolanaE2e.reconciliation.state, "RECONCILED");
    assert.equal(result.nativeToSolanaE2e.reconciliation.canonicalReserve, "100000000");
    assert.equal(result.nativeToSolanaE2e.reconciliation.mintedSupply, "100000000");
    assert.equal(result.nativeToSolanaE2e.reconciliation.coverageRequired, "100000000");
    assert.equal(result.nativeToSolanaE2e.reconciliation.surplus, "0");
    assert.equal(result.nativeToSolanaE2e.deposit.txidHex, DEPOSIT_TXID);
    assert.equal(result.nativeToSolanaE2e.deposit.vout, 1);
    assert.equal(result.nativeToSolanaE2e.deposit.amountAtomic, "100000000");
    assert.equal(result.nativeToSolanaE2e.deposit.nativeNetwork, "regtest");
    assert.equal(result.nativeToSolanaE2e.deposit.nativeGenesisHash, REGTEST_GENESIS_HASH);
    assert.equal(result.nativeToSolanaE2e.deposit.sourceBestBlockHash, REGTEST_BEST_BLOCK_HASH);
    assert.equal(result.nativeToSolanaE2e.deposit.sourceBestHeight, 26);
    assert.equal(result.nativeToSolanaE2e.deposit.scriptPubKeyHex, result.nativeToSolanaE2e.depositIntent.policy.scriptPubKeyHex);
    assert.notEqual(result.nativeToSolanaE2e.deposit.scriptPubKeyHex, SCRIPT_HEX);
    assert.match(result.nativeToSolanaE2e.deposit.proofFingerprintHex, /^[0-9a-f]{64}$/u);
    assert.notEqual(result.nativeToSolanaE2e.depositIntent.address, FROST_TAPROOT_ADDRESS);
    assert.equal(result.nativeToSolanaE2e.depositIntent.scriptPubKeyHex, result.nativeToSolanaE2e.deposit.scriptPubKeyHex);
    assert.equal(result.nativeToSolanaE2e.depositIntent.custody, "LOCAL_RECOVERABLE_TAPSCRIPT_TO_FROST_RESERVE");
    assert.equal(result.nativeToSolanaE2e.depositIntent.recoverable, true);
    assert.equal(result.nativeToSolanaE2e.depositIntent.policy.userRecoveryPublicKeyHex, RECOVERY_PUBLIC_KEY_HEX.slice(2));
    assert.equal(result.nativeToSolanaE2e.frostCustody.aggregateTweakedXOnlyPublicKey, FROST_AGGREGATE_XONLY_HEX);
    assert.equal(result.nativeToSolanaE2e.frostCustody.depositAddress, result.nativeToSolanaE2e.depositIntent.address);
    assert.equal(result.nativeToSolanaE2e.frostCustody.canonicalReserveAddress, FROST_TAPROOT_ADDRESS);
    assert.equal(result.nativeToSolanaE2e.nativeSource.trust, "RPC_OBSERVATION");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.state, "FINALIZED_CANONICAL_RESERVE");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.reserveAmountAtomic, "100000000");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.nativeMinerFeeAtomic, "1000");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.reserveAmountNative, "1.00000000");
    assert.deepEqual(result.nativeToSolanaE2e.reserveSweep.feeFundingOutpoints, [`${FEE_FUNDING_TXID}:0`]);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.signed, true);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.broadcast, true);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.finalitySatisfied, true);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionHex, UNSIGNED_SWEEP_HEX);
    assert.match(result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionFingerprintHex, /^[0-9a-f]{64}$/u);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionId, UNSIGNED_SWEEP_TXID);
    assert.match(result.nativeToSolanaE2e.reserveSweep.operationIdHex, /^[0-9a-f]{64}$/u);
    assert.match(result.nativeToSolanaE2e.reserveSweep.signedNativeTransactionHex, /^[0-9a-f]+$/u);
    assert.match(result.nativeToSolanaE2e.reserveSweep.signedNativeTransactionFingerprintHex, /^[0-9a-f]{64}$/u);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.nativeSweepTxidHex, UNSIGNED_SWEEP_TXID);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.broadcastTxidHex, UNSIGNED_SWEEP_TXID);
    assert.match(result.nativeToSolanaE2e.reserveSweep.nativeSweepWtxidHex, /^[0-9a-f]{64}$/u);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.witnessInputCount, 2);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.finalizedReserveSweep.state, "FINALIZED_CANONICAL_RESERVE");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.finalizedReserveSweep.finalitySatisfied, true);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.finalizedReserveSweep.reserveTransitionState, "CANONICAL_RESERVE");
    assert.equal(result.nativeToSolanaE2e.reserveSweep.finalizedReserveSweep.mintCreditState, "AUTHORIZED_UNCONSUMED");
    assert.deepEqual(result.nativeToSolanaE2e.reserveSweep.finalizedReserveSweep.inputOutpoints, [
      `${DEPOSIT_TXID}:1`,
      `${FEE_FUNDING_TXID}:0`,
    ]);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.signingIntents.length, 2);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.frostResults.length, 2);
    assert.equal(result.nativeToSolanaE2e.reserveSweep.taprootSighashEvidences.length, 2);
    assert.deepEqual(
      result.nativeToSolanaE2e.reserveSweep.taprootSighashEvidences.map((entry) => entry.signingInputIndex),
      [0, 1],
    );
    for (const evidence of result.nativeToSolanaE2e.reserveSweep.taprootSighashEvidences) {
      assert.equal(evidence.state, "LOCALLY_VALIDATED_NATIVE_SIGHASH");
      assert.equal(evidence.unsignedNativeTransactionFingerprintHex, result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionFingerprintHex);
      assert.equal(evidence.nativeSweepTxidHex, result.nativeToSolanaE2e.reserveSweep.unsignedNativeTransactionId);
      assert.equal(evidence.recipientScriptPubKeyHex, SCRIPT_HEX);
      assert.equal(evidence.nativeMinerFeeAtomic, "1000");
      assert.match(evidence.taprootSighashHex, /^[0-9a-f]{64}$/u);
      assert.match(evidence.taprootSigMsgWithEpochHex, /^00/u);
    }
    assert.match(result.nativeToSolanaE2e.stateRoot, /^\$\{LOCAL_E2E_RUN_ROOT\}/u);
    assert.equal(result.nativeToSolanaE2e.stateRoot.includes(runRoot), false);
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_INITIALIZE_EPHEMERAL_FROST_CUSTODY"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_CREATE_RECOVERABLE_DEPOSIT_INTENT"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_SELECT_FROST_CANONICAL_RESERVE"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_COMPUTE_VALIDATED_TAPROOT_SIGHASHES"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_SIGN_RESERVE_SWEEP_WITH_FROST_A_B"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_ATTACH_FROST_TAPROOT_WITNESSES"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_MINE_RESERVE_SWEEP_FINALITY"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_OBSERVE_FINALIZED_RESERVE_SWEEP"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_PREPARE_LOCALNET_SOLANA_SETUP"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_SUBMIT_AND_FINALIZE_LOCALNET_SOLANA_SETUP"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_PREPARE_SOLANA_DEPOSIT_CLAIM"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_SUBMIT_SOLANA_DEPOSIT_CLAIM"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_OBSERVE_FINALIZED_SOLANA_MINT"));
    assert(result.nativeToSolanaE2e.stages.includes("LOCAL_E2E_RECONCILE_RESERVE_SUPPLY_AND_LIABILITIES"));
    assert.equal(
      result.nativeToSolanaE2e.nextRequiredImplementation.includes(
        "COMPUTE_VALIDATED_TAPROOT_SIGHASHES_FOR_EACH_FROST_CONTROLLED_INPUT",
      ),
      false,
    );
    assert.equal(
      result.nativeToSolanaE2e.nextRequiredImplementation.includes(
        "SIGN_EACH_RESERVE_SWEEP_INPUT_WITH_REAL_NATIVE_COMPATIBLE_FROST_A_B",
      ),
      false,
    );
    assert.equal(
      result.nativeToSolanaE2e.nextRequiredImplementation.includes(
        "ATTACH_FROST_SIGNATURE_WITNESSES_TO_NATIVE_TRANSACTION",
      ),
      false,
    );
    assert.equal(
      result.nativeToSolanaE2e.nextRequiredImplementation.includes("BROADCAST_AND_FINALIZE_RESERVE_SWEEP"),
      false,
    );
    assert.equal(
      result.nativeToSolanaE2e.nextRequiredImplementation.includes("SUBMIT_SOLANA_DEPOSIT_CLAIM"),
      false,
    );
    const prohibitedApprovalState = "WAITING_FOR_" + "ADMIN_APPROVAL";
    assert.equal(JSON.stringify(result).includes(prohibitedApprovalState), false);
    assert.deepEqual(
      executor.calls.filter((step) => step.startsWith("LOCAL_E2E_")),
      [
        "LOCAL_E2E_CREATE_USER_WALLET",
        "LOCAL_E2E_OBSERVE_NATIVE_GENESIS_HASH",
        "LOCAL_E2E_GET_USER_RECOVERY_ADDRESS",
        "LOCAL_E2E_GET_USER_RECOVERY_PUBLIC_KEY",
        "LOCAL_E2E_GET_USER_MINING_ADDRESS",
        "LOCAL_E2E_MINE_USER_FUNDS",
        "LOCAL_E2E_SEND_NATIVE_DEPOSIT",
        "LOCAL_E2E_MINE_DEPOSIT_FINALITY",
        "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT",
        "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
        "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT",
        "LOCAL_E2E_FUND_RESERVE_SWEEP_FEE_INPUT",
        "LOCAL_E2E_MINE_RESERVE_SWEEP_FEE_FUNDING_FINALITY",
        "LOCAL_E2E_OBSERVE_RESERVE_SWEEP_FEE_FUNDING_TRANSACTION",
        "LOCAL_E2E_VERIFY_RESERVE_SWEEP_FEE_UTXO_UNSPENT",
        "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP",
        "LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP",
        "LOCAL_E2E_MINE_RESERVE_SWEEP_FINALITY",
        "LOCAL_E2E_OBSERVE_FINALIZED_RESERVE_SWEEP",
      ],
    );
    assert(executor.commandArgs.some((args) => args.includes("sendtoaddress")));
    assert(executor.commandArgs.some((args) => args.includes("createrawtransaction")));
    assert(!executor.commandArgs.some((args) => args.includes("signrawtransactionwithwallet")));
    assert(executor.commandArgs.some((args) => args.includes("sendrawtransaction")));
    assert.deepEqual(executor.stopped, ["START_KINGPEPE_REGTEST", "START_SOLANA_LOCAL_VALIDATOR"]);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("either attester changing raw evidence prevents claim submission in the orchestration model", async () => {
  for (const changedInvocation of [2, 3]) {
    const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-attester-evidence-model-"));
    let submitted = false;
    let invocations = 0;
    try {
      const verifier = fakeNativeEvidenceVerifierFactory();
      const result = await runLocalNativeToSolanaE2e({ plan: readyPlan(runRoot), executor: new FakeExecutor(),
        programArtifactExists: () => true, healthAttempts: 1, custodyFactory: fakeCustodyFactory,
        reserveSweepSigner: fakeReserveSweepSigner, localSolanaSetupFactory: fakeLocalSolanaSetupFactory,
        solanaSetup: fakeSolanaSetup, solanaDepositClaim: async () => { submitted = true; throw new Error("UNEXPECTED_SUBMISSION"); },
        nativeEvidenceVerifierFactory: () => ({ ...verifier, verifyReserve: async () => {
          invocations += 1;
          return invocations === changedInvocation ? { digestHex: h("changed-attester-evidence") } : verifier.verifyReserve();
        } }), flowConfig: { runId: "attester-model", amountNative: "1.00000000" } });
      assert.equal(result.state, "LOCAL_NATIVE_TO_SOLANA_E2E_FAILED");
      assert.equal(result.fullNativeToSolanaE2e, "FAILED");
      assert.equal(submitted, false);
      assert.equal(invocations, 3);
    } finally { rmSync(runRoot, { recursive: true, force: true }); }
  }
});

for (const scenario of ["setup-waits", "setup-throws", "claim-throws", "claim-hard-stop", "wrong-mint-amount", "wrong-observed-supply"]) {
  test(`real local journal preserves owed credit when orchestration model ${scenario}`, async () => {
    const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-pending-credit-model-"));
    let setupInput;
    try {
      const result = await runLocalNativeToSolanaE2e({ plan: readyPlan(runRoot), executor: new FakeExecutor(),
        programArtifactExists: () => true, healthAttempts: 1, custodyFactory: fakeCustodyFactory,
        reserveSweepSigner: fakeReserveSweepSigner, localSolanaSetupFactory: fakeLocalSolanaSetupFactory,
        nativeEvidenceVerifierFactory: fakeNativeEvidenceVerifierFactory,
        solanaSetup: async input => {
          setupInput = input;
          assert.equal(input.depositAccounting.snapshot.authorizedUnmintedCredits, "100000000");
          assert.equal(input.depositAccounting.checkpoint.sequence, "1");
          if (scenario === "setup-waits") return { state: "WAITING_FOR_DEPENDENCY", reason: "MODEL_SETUP_UNAVAILABLE" };
          if (scenario === "setup-throws") throw new Error("MODEL_SETUP_INTERRUPTED");
          return fakeSolanaSetup(input);
        },
        solanaDepositClaim: async input => {
          if (scenario === "claim-throws") throw new Error("MODEL_CLAIM_INTERRUPTED");
          if (scenario === "claim-hard-stop") return { state: "HARD_STOP", reason: "MODEL_CLAIM_INTEGRITY_FAILURE" };
          const claim = await fakeSolanaDepositClaim(input);
          return { ...claim, ...(scenario === "wrong-mint-amount" ? { mintedAmountAtomic: "1" } : { mintSupplyAtomic: "1" }) };
        }, flowConfig: { runId: "pending-credit", amountNative: "1.00000000" } });
      assert.notEqual(result.state, "COMPLETED");
      const ledger = openLocalnetDepositCreditLedger({ ...setupInput, credit: setupInput.depositCredit });
      try {
        assert.equal(ledger.snapshot().authorizedUnmintedCredits, "100000000");
        assert.equal(ledger.snapshot().mintedSupply, "0");
        assert.equal(ledger.pendingCredits().length, 1);
        const stopped = ["claim-hard-stop", "wrong-mint-amount", "wrong-observed-supply"].includes(scenario);
        assert.equal(ledger.status().state, stopped ? "HARD_STOP" : "OPEN_LOCAL_ACCOUNTING_ONLY");
        if (stopped) assert.throws(() => ledger.recordValidatedDeposit(setupInput.depositCredit), /HardStop/u);
      } finally { ledger.close(); }
      // Reopen never generates a missing key. Preserve this disposable test key
      // elsewhere inside the same external test directory, then check absence.
      const keyFile = path.join(setupInput.flowConfig.stateRoot, "credit-authentication", "local-test-key.bin");
      renameSync(keyFile, path.join(runRoot, "retained-local-test-key.bin"));
      assert.throws(() => openLocalnetDepositCreditLedger({ ...setupInput, credit: setupInput.depositCredit }), /StorageRejected/u);
      assert.equal(existsSync(keyFile), false);
    } finally { rmSync(runRoot, { recursive: true, force: true }); }
  });
}

test("local FROST Taproot custody context derives disposable rkpepe P2TR custody outside the repository", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-frost-custody-"));
  try {
    const plan = readyPlan(runRoot);
    const config = createNativeToSolanaFlowConfig({
      plan,
      repoRoot: REPO_ROOT,
      runId: "frost-custody",
    });
    const custody = await createLocalFrostTaprootCustodyContext({
      plan,
      flowConfig: config,
    });

    assert.equal(custody.state, "READY");
    assert.equal(custody.localOnly, true);
    assert.deepEqual(custody.signerIds, ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]);
    assert.equal(custody.keyEpoch, 1);
    assert.match(custody.aggregateTweakedXOnlyPublicKey, /^[0-9a-f]{64}$/u);
    assert.equal(custody.taprootScriptPubKeyHex, p2trScriptPubKeyHex(custody.aggregateTweakedXOnlyPublicKey));
    assert.match(custody.taprootAddress, /^rkpepe1p[ac-hj-np-z02-9]+$/u);
    assert.equal(custody.taprootAddress.includes(String(REPO_ROOT)), false);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("missing, watch-only or substituted Native recovery identity prevents payment initiation", async () => {
  for (const info of [{}, { ismine: false, pubkey: RECOVERY_PUBLIC_KEY_HEX },
    { ismine: true, iswatchonly: true, pubkey: RECOVERY_PUBLIC_KEY_HEX },
    { ismine: true, pubkey: "ff".repeat(33) }]) {
    const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-invalid-recovery-public-"));
    const executor = new FakeExecutor({ outputs: new Map([["LOCAL_E2E_GET_USER_RECOVERY_PUBLIC_KEY", JSON.stringify(info)]]) });
    try {
      const result = await runLocalNativeToSolanaE2e({ plan: readyPlan(runRoot), executor,
        programArtifactExists: () => true, healthAttempts: 1, custodyFactory: fakeCustodyFactory,
        reserveSweepSigner: fakeReserveSweepSigner, nativeEvidenceVerifierFactory: fakeNativeEvidenceVerifierFactory,
        localSolanaSetupFactory: fakeLocalSolanaSetupFactory, solanaSetup: fakeSolanaSetup, solanaDepositClaim: fakeSolanaDepositClaim });
      assert.notEqual(result.state, "COMPLETED");
      assert.equal(executor.calls.includes("LOCAL_E2E_SEND_NATIVE_DEPOSIT"), false);
      assert.equal(executor.calls.includes("LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP"), false);
    } finally { rmSync(runRoot, { recursive: true, force: true }); }
  }
});

test("local reserve sweep signer uses real A+B FROST signatures and attaches Taproot witnesses", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-frost-signing-"));
  try {
    const plan = readyPlan(runRoot);
    const config = createNativeToSolanaFlowConfig({
      plan,
      repoRoot: REPO_ROOT,
      runId: "frost-signing",
      amountNative: "1.00000000",
    });
    const custody = await createLocalFrostTaprootCustodyContext({
      plan,
      flowConfig: config,
    });
    const unsignedSweepHex = buildUnsignedTransactionHex({
      inputs: [
        { txid: DEPOSIT_TXID, vout: 1 },
        { txid: FEE_FUNDING_TXID, vout: 0 },
      ],
      outputs: [{ amountAtomic: "100000000", scriptPubKeyHex: custody.taprootScriptPubKeyHex }],
    });
    const proofFingerprintHex = h("real-frost-local-proof-fingerprint");
    const reserveSweepDraft = await draftLocalReserveSweep({
      cli: async () => unsignedSweepHex,
      depositTxidHex: DEPOSIT_TXID,
      depositVout: 1,
      depositAmountAtomic: "100000000",
      nativeMinerFeeAtomic: "1000",
      nativeDecimals: 8,
      canonicalReserveAddress: custody.taprootAddress,
      feeFundingInputs: [{ txidHex: FEE_FUNDING_TXID, vout: 0 }],
      proofFingerprintHex,
    });
    const taprootSighashEvidences = createLocalTaprootSighashEvidences({
      unsignedNativeTransactionHex: reserveSweepDraft.unsignedNativeTransactionHex,
      spentOutputs: [
        {
          amountAtomic: "100000000",
          scriptPubKeyHex: custody.taprootScriptPubKeyHex,
        },
        {
          amountAtomic: "1000",
          scriptPubKeyHex: custody.taprootScriptPubKeyHex,
        },
      ],
      proofFingerprintHex,
      reserveAmountAtomic: "100000000",
      nativeMinerFeeAtomic: "1000",
      expectedRecipientScriptPubKeyHex: custody.taprootScriptPubKeyHex,
      expectedChangeScriptPubKeyHex: custody.taprootScriptPubKeyHex,
    });

    const signed = await signLocalReserveSweepWithFrost({
      plan,
      flowConfig: config,
      frostCustody: custody,
      nativeSource: {
        nativeNetwork: "regtest",
        nativeGenesisHash: REGTEST_GENESIS_HASH,
      },
      deposit: {
        depositOutpoint: `${DEPOSIT_TXID}:1`,
        amountAtomic: "100000000",
        proofFingerprintHex,
        finalitySatisfied: true,
        utxoUnspent: true,
        noPriorConsumption: true,
      },
      reserveSweepDraft,
      taprootSighashEvidences,
      operationIdHex: h("real-frost-local-reserve-sweep-operation"),
      // Cryptographic fixture, not a Native chain-validation claim.
      nativeEvidenceValidator: async (intent) => ({ digestHex: intent.proofFingerprint }),
    });

    assert.equal(signed.state, "SIGNED_WITNESS_ATTACHED");
    assert.equal(signed.localOnly, true);
    assert.equal(signed.productionReady, false);
    assert.equal(signed.mainnetActivation, "DISABLED");
    assert.equal(signed.nativeSweepTxidHex, reserveSweepDraft.unsignedNativeTransactionId);
    assert.equal(signed.witnessInputCount, 2);
    assert.equal(signed.signingIntents.length, 2);
    assert.equal(signed.frostResults.length, 2);
    assert.deepEqual(
      signed.signingIntents.map((entry) => entry.signingInputIndex),
      [0, 1],
    );
    const parsedSigned = parseNativeTransactionHex(signed.signedNativeTransactionHex);
    assert.equal(parsedSigned.hasWitness, true);
    assert.equal(parsedSigned.txidHex, reserveSweepDraft.unsignedNativeTransactionId);
    assert.notEqual(parsedSigned.wtxidHex, reserveSweepDraft.unsignedNativeTransactionId);
    assert.equal(parsedSigned.inputs[0].witness.length, 1);
    assert.equal(parsedSigned.inputs[1].witness.length, 1);
    for (const result of signed.frostResults) {
      assert.deepEqual(result.signerIds, ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"]);
      assert.equal(
        schnorr.verify(
          Uint8Array.from(Buffer.from(result.signatureHex, "hex")),
          Uint8Array.from(Buffer.from(result.messageHex, "hex")),
          Uint8Array.from(Buffer.from(custody.aggregateTweakedXOnlyPublicKey, "hex")),
        ),
        true,
      );
    }
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("finalized reserve sweep validation requires exact txid, inputs, output, and finality", () => {
  const finalized = validateFinalizedLocalReserveSweep({
    rawTransaction: finalizedReserveSweepFixture(),
    expectedTxidHex: UNSIGNED_SWEEP_TXID,
    expectedInputOutpoints: [`${DEPOSIT_TXID}:1`, `${FEE_FUNDING_TXID}:0`],
    reserveAmountAtomic: "100000000",
    canonicalReserveScriptPubKeyHex: SCRIPT_HEX,
    expectedConfirmations: 6,
    nativeDecimals: 8,
  });
  assert.equal(finalized.state, "FINALIZED_CANONICAL_RESERVE");
  assert.equal(finalized.nativeSweepTxidHex, UNSIGNED_SWEEP_TXID);
  assert.equal(finalized.reserveAmountAtomic, "100000000");
  assert.equal(finalized.reserveOutputVout, 0);

  assert.throws(
    () =>
      validateFinalizedLocalReserveSweep({
        rawTransaction: { ...finalizedReserveSweepFixture(), txid: h("wrong-finalized-sweep-txid") },
        expectedTxidHex: UNSIGNED_SWEEP_TXID,
        expectedInputOutpoints: [`${DEPOSIT_TXID}:1`, `${FEE_FUNDING_TXID}:0`],
        reserveAmountAtomic: "100000000",
        canonicalReserveScriptPubKeyHex: SCRIPT_HEX,
        expectedConfirmations: 6,
        nativeDecimals: 8,
      }),
    /LocalNativeReserveSweepFinalizedTxidMismatch/u,
  );
  assert.throws(
    () =>
      validateFinalizedLocalReserveSweep({
        rawTransaction: { ...finalizedReserveSweepFixture(), confirmations: 5 },
        expectedTxidHex: UNSIGNED_SWEEP_TXID,
        expectedInputOutpoints: [`${DEPOSIT_TXID}:1`, `${FEE_FUNDING_TXID}:0`],
        reserveAmountAtomic: "100000000",
        canonicalReserveScriptPubKeyHex: SCRIPT_HEX,
        expectedConfirmations: 6,
        nativeDecimals: 8,
      }),
    /LocalNativeReserveSweepFinalityInsufficient/u,
  );
  assert.throws(
    () =>
      validateFinalizedLocalReserveSweep({
        rawTransaction: finalizedReserveSweepFixture({ reserveScriptPubKeyHex: `5120${h("wrong-reserve-script")}` }),
        expectedTxidHex: UNSIGNED_SWEEP_TXID,
        expectedInputOutpoints: [`${DEPOSIT_TXID}:1`, `${FEE_FUNDING_TXID}:0`],
        reserveAmountAtomic: "100000000",
        canonicalReserveScriptPubKeyHex: SCRIPT_HEX,
        expectedConfirmations: 6,
        nativeDecimals: 8,
      }),
    /LocalNativeReserveSweepFinalizedReserveOutputNotUnique/u,
  );
});

test("Taproot address helper matches the BIP350 v1 witness address vector", () => {
  assert.equal(
    taprootAddressFromXOnlyPublicKey(
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      "bc",
    ),
    "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
  );
});

test("flow config keeps local runtime state under the local E2E run root and outside the repository", () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-config-"));
  try {
    const plan = readyPlan(runRoot);
    const config = createNativeToSolanaFlowConfig({
      plan,
      repoRoot: REPO_ROOT,
      runId: "config-test",
    });
    assert.equal(config.amountAtomic, "100000000");
    assert.equal(path.relative(runRoot, config.stateRoot).startsWith(".."), false);
    assert.throws(
      () =>
        createNativeToSolanaFlowConfig({
          plan,
          repoRoot: REPO_ROOT,
          stateRoot: path.join(REPO_ROOT, "local-private-state"),
        }),
      /StateRootInsideRepositoryRejected/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("local Solana setup context creates disposable localnet identities without public signing handles", () => {
  const context = createLocalSolanaSetupContext({
    flowConfig: {
      policyEpoch: 7,
      keyEpoch: 8,
    },
  });
  const publicContext = publicLocalSolanaSetupContext(context);

  assert.equal(context.state, "READY");
  assert.equal(context.localOnly, true);
  assert.equal(context.productionReady, false);
  assert.equal(context.mainnetActivation, "DISABLED");
  assert.equal(context.policyEpoch, 7);
  assert.equal(context.keyEpoch, 8);
  assert.match(context.mintHex, /^[0-9a-f]{64}$/u);
  assert.match(context.feePayerBase58, /^[1-9A-HJ-NP-Za-km-z]{32,64}$/u);
  assert.notEqual(context.attesterPublicKeysHex[0], context.attesterPublicKeysHex[1]);
  assert.equal(typeof context.feePayerSigner.sign, "function");
  assert.equal(typeof context.attesterASigner.sign, "function");
  assert.equal(typeof context.attesterBSigner.sign, "function");
  assert.equal(publicContext.feePayerSigner, undefined);
  assert.equal(publicContext.mintSigner, undefined);
  assert.equal(publicContext.recipientTokenAccountSigner, undefined);
  assert.equal(publicContext.attesterASigner, undefined);
  assert.equal(publicContext.attesterBSigner, undefined);
  assert.equal(JSON.stringify(publicContext).includes("sign"), false);
  assert.throws(
    () =>
      createLocalSolanaSetupContext({
        flowConfig: {
          mintHex: h("externally-pinned-mint-without-signer"),
        },
      }),
    /PinnedMintRequiresInjectedMintSigner/u,
  );
});

test("deposit output and UTXO validation reject ambiguous or unsafe observations", () => {
  assert.throws(
    () =>
      findDepositOutput({
        rawTransaction: {
          vout: [
            {
              n: 0,
              value: "1.00000000",
              scriptPubKey: { hex: SCRIPT_HEX, address: "bcrt1deposit" },
            },
            {
              n: 1,
              value: "1.00000000",
              scriptPubKey: { hex: SCRIPT_HEX, address: "bcrt1deposit" },
            },
          ],
        },
        depositAddress: "bcrt1deposit",
        amountAtomic: "100000000",
        nativeDecimals: 8,
      }),
    /LocalNativeDepositOutputNotUnique/u,
  );

  assert.throws(
    () =>
      findDepositOutput({
        rawTransaction: {
          vout: [
            {
              n: 0,
              value: "1.00000000",
              scriptPubKey: { hex: `5120${h("wrong-frost-script")}`, address: FROST_TAPROOT_ADDRESS },
            },
          ],
        },
        depositAddress: FROST_TAPROOT_ADDRESS,
        expectedScriptPubKeyHex: SCRIPT_HEX,
        amountAtomic: "100000000",
        nativeDecimals: 8,
      }),
    /LocalNativeDepositOutputNotUnique/u,
  );

  assert.throws(
    () =>
      validateDepositUtxo({
        utxo: {
          value: "1.00000000",
          scriptPubKey: { hex: SCRIPT_HEX },
          confirmations: 5,
        },
        output: {
          amountAtomic: "100000000",
          scriptPubKeyHex: SCRIPT_HEX,
        },
        expectedConfirmations: 6,
        nativeDecimals: 8,
      }),
    /LocalNativeDepositUtxoFinalityInsufficient/u,
  );

  assert.throws(
    () =>
      validateLocalNativeSourceSnapshot({
        blockchainInfo: {
          chain: "main",
          blocks: 107,
          headers: 107,
          bestblockhash: REGTEST_BEST_BLOCK_HASH,
          chainwork: "01",
          initialblockdownload: false,
        },
        genesisHash: REGTEST_GENESIS_HASH,
        expectedChain: "regtest",
      }),
    /LocalNativeSourceWrongNetwork/u,
  );

  assert.throws(
    () =>
      validateRawDepositTransaction({
        rawTransaction: {
          txid: h("different-deposit-txid"),
          vout: [],
        },
        expectedTxidHex: DEPOSIT_TXID,
      }),
    /LocalNativeDepositTxidMismatch/u,
  );
});

test("unsigned reserve sweep draft preserves credited reserve and requires explicit fee funding", async () => {
  const calls = [];
  const draft = await draftLocalReserveSweep({
    cli: async (request) => {
      calls.push(request);
      return UNSIGNED_SWEEP_HEX;
    },
    depositTxidHex: DEPOSIT_TXID,
    depositVout: 1,
    depositAmountAtomic: "100000000",
    nativeMinerFeeAtomic: "1000",
    nativeDecimals: 8,
    canonicalReserveAddress: FROST_TAPROOT_ADDRESS,
    feeFundingInputs: [{ txidHex: FEE_FUNDING_TXID, vout: 0 }],
    proofFingerprintHex: h("proof-fingerprint"),
  });

  assert.equal(draft.depositOutpoint, `${DEPOSIT_TXID}:1`);
  assert.equal(draft.reserveAmountAtomic, "100000000");
  assert.equal(draft.nativeMinerFeeAtomic, "1000");
  assert.equal(draft.reserveAmountNative, "1.00000000");
  assert.deepEqual(draft.feeFundingOutpoints, [`${FEE_FUNDING_TXID}:0`]);
  assert.equal(draft.unsignedNativeTransactionHex, UNSIGNED_SWEEP_HEX);
  assert.match(draft.unsignedNativeTransactionId, /^[0-9a-f]{64}$/u);
  assert.equal(draft.signed, false);
  assert.equal(draft.broadcast, false);
  assert.deepEqual(calls[0], {
    step: "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP",
    command: "createrawtransaction",
    parameters: [
      JSON.stringify([
        { txid: DEPOSIT_TXID, vout: 1 },
        { txid: FEE_FUNDING_TXID, vout: 0 },
      ]),
      JSON.stringify({ [FROST_TAPROOT_ADDRESS]: "1.00000000" }),
      "0",
      "false",
    ],
  });

  await assert.rejects(
    () =>
      draftLocalReserveSweep({
        cli: async () => UNSIGNED_SWEEP_HEX,
        depositTxidHex: DEPOSIT_TXID,
        depositVout: 1,
        depositAmountAtomic: "1000",
        nativeMinerFeeAtomic: "1000",
        nativeDecimals: 8,
        canonicalReserveAddress: FROST_TAPROOT_ADDRESS,
        proofFingerprintHex: h("proof-fingerprint"),
      }),
    /LocalNativeReserveSweepFeeFundingInputRequired/u,
  );
});

test("unsigned reserve sweep rejects unexpected replacement signaling from Native RPC", async () => {
  const bytes = Buffer.from(UNSIGNED_SWEEP_HEX, "hex");
  bytes.writeUInt32LE(0xffff_fffd, 42);
  assert.equal(parseNativeTransactionHex(bytes.toString("hex")).inputs[0].sequence, 0xffff_fffd);
  await assert.rejects(draftLocalReserveSweep({
    cli: async () => bytes.toString("hex"), depositTxidHex: DEPOSIT_TXID, depositVout: 1,
    depositAmountAtomic: "100000000", nativeMinerFeeAtomic: "1000", nativeDecimals: 8,
    canonicalReserveAddress: FROST_TAPROOT_ADDRESS,
    feeFundingInputs: [{ txidHex: FEE_FUNDING_TXID, vout: 0 }], proofFingerprintHex: h("proof-fingerprint"),
  }), /LocalNativeReserveSweepReplacementDisabled/u);
});

test("deposit observation flow rejects missing deposit output before claiming E2E completion", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-missing-output-"));
  try {
    const plan = readyPlan(runRoot);
    const executor = new FakeExecutor({
      outputs: new Map([
        [
          "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
          JSON.stringify({
            txid: DEPOSIT_TXID,
            vout: [
              {
                n: 0,
                value: "1.00000000",
                scriptPubKey: { hex: SCRIPT_HEX, address: "bcrt1other" },
              },
            ],
          }),
        ],
      ]),
    });
    const setup = fakeFlowConfigWithSetup(plan, "missing-output");
    await assert.rejects(
      () =>
        executeNativeDepositObservationFlow({
          plan,
          executor,
          commandPaths: commandPathMap(),
          flowConfig: setup.flowConfig,
          localSolanaSetupContext: setup.localSolanaSetupContext,
          solanaSetup: fakeSolanaSetup,
          custodyFactory: fakeCustodyFactory,
        }),
      /LocalNativeDepositOutputNotUnique/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("deposit observation flow rejects wrong local Native source before reserve sweep construction", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-wrong-source-"));
  try {
    const plan = readyPlan(runRoot);
    const executor = new FakeExecutor({
      outputs: new Map([
        [
          "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT",
          JSON.stringify({
            chain: "main",
            blocks: 107,
            headers: 107,
            bestblockhash: REGTEST_BEST_BLOCK_HASH,
            chainwork: "01",
            initialblockdownload: false,
          }),
        ],
      ]),
    });
    const setup = fakeFlowConfigWithSetup(plan, "wrong-source");
    await assert.rejects(
      () =>
        executeNativeDepositObservationFlow({
          plan,
          executor,
          commandPaths: commandPathMap(),
          flowConfig: setup.flowConfig,
          localSolanaSetupContext: setup.localSolanaSetupContext,
          solanaSetup: fakeSolanaSetup,
          custodyFactory: fakeCustodyFactory,
        }),
      /LocalNativeSourceWrongNetwork/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("deposit observation flow rejects raw transaction txid mismatch", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-native-to-solana-wrong-txid-"));
  try {
    const plan = readyPlan(runRoot);
    const executor = new FakeExecutor({
      outputs: new Map([
        [
          "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION",
          JSON.stringify({
            txid: h("wrong-observed-deposit-txid"),
            vout: [
              {
                n: 1,
                value: "1.00000000",
                scriptPubKey: {
                  hex: SCRIPT_HEX,
                  address: FROST_TAPROOT_ADDRESS,
                },
              },
            ],
          }),
        ],
      ]),
    });
    const setup = fakeFlowConfigWithSetup(plan, "wrong-txid");
    await assert.rejects(
      () =>
        executeNativeDepositObservationFlow({
          plan,
          executor,
          commandPaths: commandPathMap(),
          flowConfig: setup.flowConfig,
          localSolanaSetupContext: setup.localSolanaSetupContext,
          solanaSetup: fakeSolanaSetup,
          custodyFactory: fakeCustodyFactory,
        }),
      /LocalNativeDepositTxidMismatch/u,
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

for (const mode of ["prepared", "rejected", "malformed"]) test("protected preparation model never falls through to legacy economic execution: " + mode, async () => {
  // Explicit orchestration model; actual protected-chain execution is separate.
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "kingpepe-preparation-boundary-"));
  const executor = new FakeExecutor(); let calls = 0, legacy = 0;
  try {
    const plan = readyPlan(runRoot), setup = fakeFlowConfigWithSetup(plan, "protected-preparation");
    const forbidden = async () => { legacy++; throw new Error("LegacyEconomicActionForbidden"); };
    const preparation = mode === "malformed" ? true : async input => {
      calls++; assert.equal(input.inputEvidence.digestHex, h("model-input-proof"));
      assert.equal(input.inputs.length, 2); assert.equal(input.taprootSighashEvidences.length, 2);
      assert.equal(input.depositIntentContext.amountAtomic, "100000000");
      assert.match(input.operationIdHex, /^[0-9a-f]{64}$/u);
      if (mode === "rejected") throw new Error("ProtectedPreparationRejected");
      return { state: "COMPLETED", minted: true }; // Caller cannot fabricate the runner's result.
    };
    const action = () => executeNativeDepositObservationFlow({ plan, executor, commandPaths: commandPathMap(),
      ...setup, custodyFactory: fakeCustodyFactory, nativeEvidenceVerifierFactory: fakeNativeEvidenceVerifierFactory,
      reserveSweepSigner: forbidden, solanaSetup: forbidden, solanaDepositClaim: forbidden,
      protectedDepositPreparation: preparation });
    if (mode === "prepared") {
      assert.deepEqual(await action(), { state: "LOCAL_PROTECTED_DEPOSIT_PREPARED", signed: false, broadcast: false, minted: false,
        productionReady: false, mainnetActivation: "DISABLED" });
    } else await assert.rejects(action, mode === "rejected" ? /ProtectedPreparationRejected/u : /ProtectedDepositPreparationCallbackRequired/u);
    assert.equal(calls, mode === "malformed" ? 0 : 1); assert.equal(legacy, 0);
    assert(!executor.calls.some(c => c.step === "LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP"));
  } finally {
    assert.equal(path.dirname(runRoot), path.resolve(os.tmpdir()));
    assert(path.basename(runRoot).startsWith("kingpepe-preparation-boundary-"));
    rmSync(runRoot, { recursive: true });
  }
});

function fakeNativeEvidenceVerifierFactory() {
  // Explicit orchestration model only. Real E2E uses the compiled Rust verifier.
  return { verifyInputs: async () => ({ status: "SOURCE_MODEL_ONLY", digestHex: h("model-input-proof") }),
    verifyReserve: async () => ({ status: "SOURCE_MODEL_ONLY", digestHex: h("model-reserve-proof") }) };
}

function buildUnsignedSweepHex() {
  return buildUnsignedTransactionHex({
    inputs: [
      { txid: DEPOSIT_TXID, vout: 1 },
      { txid: FEE_FUNDING_TXID, vout: 0 },
    ],
    outputs: [{ amountAtomic: "100000000", scriptPubKeyHex: SCRIPT_HEX }],
  });
}

function buildUnsignedTransactionHex({ inputs, outputs }) {
  return [
    "02000000",
    varintHex(inputs.length),
    ...inputs.map((input) => `${reverse32(input.txid)}${uint32Hex(input.vout)}00ffffffff`),
    varintHex(outputs.length),
    ...outputs.map(
      (output) =>
        `${uint64Hex(BigInt(output.amountAtomic))}${varintHex(output.scriptPubKeyHex.length / 2)}${output.scriptPubKeyHex}`,
    ),
    "00000000",
  ].join("");
}

function readyPlan(runRoot) {
  return createLocalE2ePlan({
    repoRoot: REPO_ROOT,
    runRoot,
    readiness: {
      protocol: "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_E2E_READINESS/V1",
      state: "READY",
      requiredExecutables: REQUIRED_LOCAL_E2E_EXECUTABLES.map((command) => ({
        command,
        state: "FOUND",
        path: `/fake/bin/${command}`,
      })),
      solanaPrograms: [],
      anchorConfig: { state: "READY", reason: "LOCALNET_PROGRAM_IDS_CONFIGURED" },
      blockers: [],
      canRunRealLocalE2e: true,
    },
  });
}

function commandPathMap() {
  return new Map(REQUIRED_LOCAL_E2E_EXECUTABLES.map((command) => [command, `/fake/bin/${command}`]));
}

function fakeFlowConfigWithSetup(plan, runId) {
  const localSolanaSetupContext = fakeLocalSolanaSetupContext();
  return {
    localSolanaSetupContext,
    flowConfig: createNativeToSolanaFlowConfig({
      plan,
      repoRoot: REPO_ROOT,
      runId,
      mintHex: localSolanaSetupContext.mintHex,
      policyEpoch: localSolanaSetupContext.policyEpoch,
      keyEpoch: localSolanaSetupContext.keyEpoch,
    }),
  };
}

async function fakeCustodyFactory() {
  return {
    state: "READY",
    localOnly: true,
    keyEpoch: 1,
    signerIds: ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"],
    aggregateTweakedXOnlyPublicKey: FROST_AGGREGATE_XONLY_HEX,
    taprootScriptPubKeyHex: SCRIPT_HEX,
    taprootAddress: FROST_TAPROOT_ADDRESS,
  };
}

async function fakeLocalSolanaSetupFactory() {
  return fakeLocalSolanaSetupContext();
}

function fakeLocalSolanaSetupContext() {
  const feePayer = fakeEd25519Signer("local-solana-fee-payer");
  const mint = fakeEd25519Signer("local-kpepe-mint");
  const recipientTokenAccount = fakeEd25519Signer("local-recipient-token-account");
  const recipientTokenAccountOwner = fakeSolanaPubkey("local-recipient-token-account-owner");
  const attesterA = fakeEd25519Signer("local-attester-a");
  const attesterB = fakeEd25519Signer("local-attester-b");
  return {
    protocol: `${LOCAL_NATIVE_TO_SOLANA_E2E_PROTOCOL}/LOCAL_SOLANA_SETUP_CONTEXT/V1`,
    state: "READY",
    localOnly: true,
    productionReady: false,
    mainnetActivation: "DISABLED",
    policyEpoch: 1,
    keyEpoch: 1,
    feePayerBase58: feePayer.publicKeyBase58,
    feePayerHex: feePayer.publicKeyHex,
    mintBase58: mint.publicKeyBase58,
    mintHex: mint.publicKeyHex,
    recipientTokenAccountBase58: recipientTokenAccount.publicKeyBase58,
    recipientTokenAccountHex: recipientTokenAccount.publicKeyHex,
    recipientTokenAccountOwnerBase58: recipientTokenAccountOwner.base58,
    recipientTokenAccountOwnerHex: recipientTokenAccountOwner.hex,
    attesterPublicKeysHex: [attesterA.publicKeyHex, attesterB.publicKeyHex],
    feePayerSigner: feePayer,
    mintSigner: mint,
    recipientTokenAccountSigner: recipientTokenAccount,
    attesterASigner: attesterA,
    attesterBSigner: attesterB,
  };
}

async function fakeSolanaSetup({ flowConfig, localSolanaSetupContext, operationIdHex }) {
  assert.equal(localSolanaSetupContext.mintHex, flowConfig.mintHex);
  assert.equal(localSolanaSetupContext.policyEpoch, flowConfig.policyEpoch);
  assert.equal(localSolanaSetupContext.keyEpoch, flowConfig.keyEpoch);
  return {
    state: "COMPLETED",
    reason: "LOCALNET_SOLANA_SETUP_FINALIZED",
    productionReady: false,
    mainnetActivation: "DISABLED",
    request: {
      mintBase58: localSolanaSetupContext.mintBase58,
      mintHex: localSolanaSetupContext.mintHex,
      feePayerBase58: localSolanaSetupContext.feePayerBase58,
      recipientTokenAccountBase58: localSolanaSetupContext.recipientTokenAccountBase58,
      recipientTokenAccountHex: localSolanaSetupContext.recipientTokenAccountHex,
      recipientTokenAccountOwnerBase58: localSolanaSetupContext.recipientTokenAccountOwnerBase58,
      attesterPublicKeysHex: localSolanaSetupContext.attesterPublicKeysHex,
    },
    transactionPlan: {
      setupScope: "LOCALNET_ONLY_DISPOSABLE_SOLANA_SETUP",
      operationIdHex,
      mintBase58: localSolanaSetupContext.mintBase58,
      mintHex: localSolanaSetupContext.mintHex,
      initialSupplyAtomic: "0",
      freezeAuthority: null,
      tokenProgramIdBase58: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    },
    accounts: [
      { role: "mint", state: "READY" },
      { role: "recipientTokenAccount", state: "READY" },
      { role: "bridgeState", state: "READY" },
      { role: "transceiverConfig", state: "READY" },
    ],
  };
}

async function fakeSolanaDepositClaim({ flowConfig, localSolanaSetupContext, depositClaimRequest, operationIdHex }) {
  assert.equal(depositClaimRequest.operationIdHex, operationIdHex);
  assert.equal(depositClaimRequest.request.operationIdHex, operationIdHex);
  assert.equal(depositClaimRequest.request.amountAtomic, flowConfig.amountAtomic);
  assert.equal(depositClaimRequest.request.solanaRecipientHex, localSolanaSetupContext.recipientTokenAccountHex);
  assert.equal(depositClaimRequest.request.attestations.length, 2);
  assert.notEqual(
    depositClaimRequest.request.attestations[0].attesterPublicKeyHex,
    depositClaimRequest.request.attestations[1].attesterPublicKeyHex,
  );
  assert.equal(depositClaimRequest.request.combinedAttestation.threshold, 2);
  assert.deepEqual(
    depositClaimRequest.request.combinedAttestation.attesterPublicKeys,
    [...localSolanaSetupContext.attesterPublicKeysHex].sort(),
  );
  assert.equal(JSON.stringify(depositClaimRequest.publicRequest).includes("sign"), false);
  return {
    state: "COMPLETED",
    reason: "SOLANA_DEPOSIT_CLAIM_FINALIZED",
    operationIdHex,
    messageDigestHex: depositClaimRequest.messageDigestHex,
    solanaSignature: fakeSolanaSignature("local-e2e-solana-deposit-claim"),
    mintedAmountAtomic: flowConfig.amountAtomic,
    mintSupplyAtomic: flowConfig.amountAtomic,
    slot: "88",
    sourceBoundary: "LOCAL_VALIDATION",
  };
}

function fakeEd25519Signer(label) {
  const signingKey = createHash("sha256").update(label).digest();
  const publicKey = ed25519.getPublicKey(signingKey);
  return {
    publicKeyHex: Buffer.from(publicKey).toString("hex"),
    publicKeyBase58: base58Encode(publicKey),
    sign(message) {
      return ed25519.sign(message, signingKey);
    },
  };
}

function fakeSolanaSignature(label) {
  return base58Encode(Buffer.concat([
    createHash("sha256").update(label).digest(),
    createHash("sha256").update("tail").update(label).digest(),
  ]));
}

function fakeSolanaPubkey(label) {
  const bytes = createHash("sha256").update(label).digest();
  return {
    hex: bytes.toString("hex"),
    base58: base58Encode(bytes),
  };
}

function fakeReserveSweepSigner({ reserveSweepDraft, taprootSighashEvidences, operationIdHex, spentOutputs, tapscriptSpends }) {
  const signatures = taprootSighashEvidences.map((_, index) => h(`fake-local-taproot-signature-${index}`) + h(`fake-local-taproot-tail-${index}`));
  const attached = attachTaprootWitnesses({
    unsignedNativeTransactionHex: reserveSweepDraft.unsignedNativeTransactionHex,
    signatures,
    spentOutputs,
    tapscriptSpends,
  });
  return {
    state: "SIGNED_WITNESS_ATTACHED",
    localOnly: true,
    productionReady: false,
    mainnetActivation: "DISABLED",
    operationIdHex,
    nativeSweepTxidHex: attached.txidHex,
    nativeSweepWtxidHex: attached.wtxidHex,
    signedNativeTransactionHex: attached.rawSignedTransactionHex,
    signedNativeTransactionFingerprintHex: h(attached.rawSignedTransactionHex),
    witnessInputCount: attached.witnessInputCount,
    signingIntents: taprootSighashEvidences.map((evidence, index) => ({
      state: "VERIFIED_READY",
      signingInputIndex: evidence.signingInputIndex,
      signingRequestId: h(`fake-local-signing-request-${index}`),
      signingIntentDigestHex: h(`fake-local-signing-intent-${index}`),
      signerPolicyDecision: { result: "APPROVED" },
    })),
    frostResults: taprootSighashEvidences.map((evidence, index) => ({
      state: "SIGNED",
      requestId: h(`fake-local-signing-request-${index}`),
      epoch: 1,
      sessionId: h(`fake-local-frost-session-${index}`),
      intentDigest: h(`fake-local-signing-intent-${index}`),
      messageHex: evidence.taprootSighashHex,
      signatureHex: signatures[index],
      aggregateTweakedXOnlyPublicKey: FROST_AGGREGATE_XONLY_HEX,
      signerIds: ["KINGPEPE_FROST_A", "KINGPEPE_FROST_B"],
    })),
  };
}

class FakeExecutor {
  constructor(options = {}) {
    this.outputs = options.outputs ?? new Map();
    this.failures = options.failures ?? new Set();
    this.calls = [];
    this.commandArgs = [];
    this.started = [];
    this.stopped = [];
  }

  async runOneShot(command) {
    this.calls.push(command.step);
    this.commandArgs.push(command.args ?? []);
    if (this.failures.has(command.step)) {
      throw new Error(`${command.step} rejected by fake executor`);
    }
    if (command.step === "LOCAL_E2E_SEND_NATIVE_DEPOSIT") {
      this.depositAddress = command.args[command.args.indexOf("sendtoaddress") + 1];
      // Decode only the encoder-produced fixture for fake RPC observations.
      // No checksum/consensus validation is claimed by this orchestration model.
      const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
      let accumulator = 0; let bits = 0; const bytes = [];
      for (const char of this.depositAddress.slice(this.depositAddress.lastIndexOf("1") + 2, -6)) {
        accumulator = ((accumulator << 5) | alphabet.indexOf(char)) & 0xffff;
        bits += 5;
        if (bits >= 8) { bits -= 8; bytes.push((accumulator >>> bits) & 0xff); }
      }
      assert.equal(bytes.length, 32);
      this.depositScript = `5120${Buffer.from(bytes).toString("hex")}`;
    }
    return {
      step: command.step,
      output: this.outputs.get(command.step) ?? defaultOutput(command.step, this),
    };
  }

  startLongRunning(command) {
    this.started.push(command.step);
    return {
      step: command.step,
      stop: async () => {
        this.stopped.push(command.step);
      },
    };
  }
}

function defaultOutput(step, fixture = {}) {
  if (step === "CHECK_KINGPEPED_VERSION" || step === "CHECK_KINGPEPE_CLI_VERSION") {
    return "KingPepe Core version v31.1.0";
  }
  if (["CHECK_SOLANA_VERSION", "CHECK_SOLANA_TEST_VALIDATOR_VERSION"].includes(step)) {
    return "Solana 4.2.2";
  }
  if (step === "CHECK_CARGO_BUILD_SBF_VERSION") return "solana-cargo-build-sbf 4.1.0";
  if (step === "LOCAL_E2E_GET_USER_MINING_ADDRESS") return "bcrt1qkingpepeminingaddress";
  if (step === "LOCAL_E2E_GET_USER_RECOVERY_ADDRESS") return "fixture-native-recovery-address";
  if (step === "LOCAL_E2E_GET_USER_RECOVERY_PUBLIC_KEY") return JSON.stringify({ ismine: true, pubkey: RECOVERY_PUBLIC_KEY_HEX });
  if (step === "LOCAL_E2E_SEND_NATIVE_DEPOSIT") return DEPOSIT_TXID;
  if (step === "LOCAL_E2E_FUND_RESERVE_SWEEP_FEE_INPUT") return FEE_FUNDING_TXID;
  if (step === "LOCAL_E2E_CREATE_UNSIGNED_NATIVE_RESERVE_SWEEP") return UNSIGNED_SWEEP_HEX;
  if (step === "LOCAL_E2E_BROADCAST_FROST_SIGNED_RESERVE_SWEEP") return UNSIGNED_SWEEP_TXID;
  if (step === "LOCAL_E2E_OBSERVE_NATIVE_SOURCE_SNAPSHOT") {
    return JSON.stringify({
      chain: "regtest",
      blocks: 26,
      headers: 26,
      bestblockhash: REGTEST_BEST_BLOCK_HASH,
      chainwork: "01",
      initialblockdownload: false,
    });
  }
  if (step === "LOCAL_E2E_OBSERVE_NATIVE_GENESIS_HASH") return REGTEST_GENESIS_HASH;
  if (step === "LOCAL_E2E_OBSERVE_DEPOSIT_TRANSACTION") {
    return JSON.stringify({
      txid: DEPOSIT_TXID,
      vout: [
        {
          n: 0,
          value: "0.25000000",
          scriptPubKey: { hex: `5120${h("change-script")}`, address: "bcrt1change" },
        },
        {
          n: 1,
          value: "1.00000000",
          scriptPubKey: {
            hex: fixture.depositScript ?? SCRIPT_HEX,
            address: fixture.depositAddress ?? FROST_TAPROOT_ADDRESS,
          },
        },
      ],
    });
  }
  if (step === "LOCAL_E2E_OBSERVE_RESERVE_SWEEP_FEE_FUNDING_TRANSACTION") {
    return JSON.stringify({
      txid: FEE_FUNDING_TXID,
      vout: [
        {
          n: 0,
          value: "0.00001000",
          scriptPubKey: {
            hex: FEE_FUNDING_SCRIPT_HEX,
            address: FROST_TAPROOT_ADDRESS,
          },
        },
      ],
    });
  }
  if (step === "LOCAL_E2E_VERIFY_DEPOSIT_UTXO_UNSPENT") {
    return JSON.stringify({
      value: "1.00000000",
      scriptPubKey: { hex: fixture.depositScript ?? SCRIPT_HEX },
      bestblock: REGTEST_BEST_BLOCK_HASH,
      confirmations: 6,
      coinbase: false,
    });
  }
  if (step === "LOCAL_E2E_VERIFY_RESERVE_SWEEP_FEE_UTXO_UNSPENT") {
    return JSON.stringify({
      value: "0.00001000",
      scriptPubKey: { hex: FEE_FUNDING_SCRIPT_HEX },
      bestblock: REGTEST_BEST_BLOCK_HASH,
      confirmations: 6,
      coinbase: false,
    });
  }
  if (step === "LOCAL_E2E_OBSERVE_FINALIZED_RESERVE_SWEEP") {
    return JSON.stringify(finalizedReserveSweepFixture());
  }
  return `${step} ok`;
}

function finalizedReserveSweepFixture(overrides = {}) {
  const reserveScriptPubKeyHex = overrides.reserveScriptPubKeyHex ?? SCRIPT_HEX;
  return {
    txid: overrides.txid ?? UNSIGNED_SWEEP_TXID,
    confirmations: overrides.confirmations ?? 6,
    vin: overrides.vin ?? [
      { txid: DEPOSIT_TXID, vout: 1 },
      { txid: FEE_FUNDING_TXID, vout: 0 },
    ],
    vout: overrides.vout ?? [
      {
        n: 0,
        value: "1.00000000",
        scriptPubKey: {
          hex: reserveScriptPubKeyHex,
          address: FROST_TAPROOT_ADDRESS,
        },
      },
    ],
  };
}

function h(label) {
  return createHash("sha256").update(label).digest("hex");
}

function reverse32(hex) {
  assert.match(hex, /^[0-9a-f]{64}$/u);
  return Buffer.from(hex, "hex").reverse().toString("hex");
}

function varintHex(value) {
  assert.ok(Number.isSafeInteger(value) && value >= 0 && value < 0xfd);
  return value.toString(16).padStart(2, "0");
}

function uint32Hex(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out.toString("hex");
}

function uint64Hex(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out.toString("hex");
}
