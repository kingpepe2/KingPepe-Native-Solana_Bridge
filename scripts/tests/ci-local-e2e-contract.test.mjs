// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
const gates = [...workflow.matchAll(/node --input-type=module -e '\r?\n([\s\S]*?)^ {10}'/gmu)].map(match => match[1]);
function gateFor(file) {
  const matches = gates.filter(block => block.includes('"/' + file + '"'));
  assert.equal(matches.length, 1, "ExactUniqueWorkflowResultGateRequired");
  assert(matches[0].length < 16_384, "WorkflowGateSizeBoundRequired"); return matches[0];
}
const code = gateFor("result.json");
assert.ok(code?.includes("localClaimRetry") && code.length < 16_384, "LocalE2eWorkflowGateRequired");
const acceptanceCode = gateFor("acceptance-checkpoint-result.json");
assert(acceptanceCode.includes("acceptanceCheckpoint"), "AcceptanceCheckpointWorkflowGateRequired");
const serviceCode = gateFor("service-result.json");
const forwardAccountingCode = gateFor("forward-accounting-result.json");

for (const [name, mutate, expected] of [
  ["accepts complete two-deposit evidence", () => {}, 0],
  ["rejects an unrelated source", r => { r.sourceSha = "1".repeat(40); }, 1],
  ["rejects a dirty source", r => { r.worktreeDirty = true; }, 1],
  ["rejects unavailable actual chains", r => { r.infrastructure = "BLOCKED"; }, 1],
  ["requires every accounting/replay check", r => { r.forwardAccounting.passed.pop(); }, 1],
  ["rejects a failed check", r => { r.forwardAccounting.fail = 1; }, 1],
]) test(`CI forward accounting gate ${name}`, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ci-gate-test-"));
  try {
    const result = { sourceSha: "0".repeat(40), worktreeDirty: false,
      infrastructure: "LOCAL_E2E_BOOTSTRAP_READY", forwardAccounting: { pass: 6, fail: 0, passed: [
        "DIRECT_OWNER_BURN_REDUCES_SUPPLY_ONLY", "SECOND_NATIVE_SWEEP_VERIFIED_WITH_CREDIT_RETAINED",
        "DIRECT_BURN_DIFFERENCE_SURVIVES_VERIFIED_MINT", "TWO_FINALIZED_RESERVES_RECONCILE_EXACT_ISSUANCE",
        "REOPENED_POST_DIRECT_BURN_MINT_DOES_NOT_MINT_AGAIN", "POST_DIRECT_BURN_NEW_TRANSACTION_CLAIM_REPLAY_REJECTED"] } };
    mutate(result); writeFileSync(path.join(root, "forward-accounting-result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", forwardAccountingCode], {
      cwd: REPO_ROOT, env: { ...process.env, KINGPEPE_CI_TOOL_ROOT: root, GITHUB_SHA: "0".repeat(40) },
      encoding: "utf8", timeout: 10_000, maxBuffer: 8192, windowsHide: true,
    });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, expected);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-ci-gate-test-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink()); rmSync(root, { recursive: true, force: true });
  }
});

test("CI builds the pinned Native proof verifier before starting the real flow", () => {
  const build = workflow.indexOf("- name: Build pinned Native proof verifier before starting test chains");
  const flow = workflow.indexOf("- name: Real automatic Native to Solana local flow");
  assert(build > 0 && build < flow);
  const setup = workflow.slice(build, flow);
  assert(setup.includes("--target wasm32-unknown-unknown nightly-2023-10-29"));
  assert(setup.includes("cargo +nightly-2023-10-29 build --locked --manifest-path native/proof/Cargo.toml"));
  assert(setup.includes("--target-dir \"${KINGPEPE_CI_TOOL_ROOT}/build/native-evidence\""));
});

// Report fixtures exercise the exact CI gate; actual chain execution is a
// separate mandatory job step and cannot be replaced by this contract test.
for (const [name, change, expected] of [
  ["accepts all thirteen actual-chain checks", () => {}, 0],
  ["rejects an incomplete count", r => { r.acceptanceCheckpoint.pass = 12; }, 1],
  ["requires independent forged-work rejection", r => { r.acceptanceCheckpoint.passed.splice(1, 1); }, 1],
  ["rejects any failure", r => { r.acceptanceCheckpoint.fail = 1; }, 1],
  ["requires the completed economic flow", r => { r.fullNativeToSolanaE2e = "NOT_RUN"; }, 1],
]) test(`CI immutable acceptance gate ${name}`, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ci-gate-test-"));
  try {
    const result = { fullNativeToSolanaE2e: "COMPLETED", acceptanceCheckpoint: { pass: 13, fail: 0,
      passed: ["REAL_NATIVE_ACCEPTED_FROST_AND_SOLANA_MINT_AFTER_TIP_ADVANCE", "FORGED_PREFIX_WORK_AND_DIGEST_REJECTED_BY_INDEPENDENT_RUST",
        "HISTORICALLY_INCLUDED_BUT_NOW_SPENT_INPUT_REJECTED", "REORGANIZED_ACCEPTED_SWEEP_REJECTED_WITHOUT_NEW_CREDIT"] } };
    change(result);
    writeFileSync(path.join(root, "acceptance-checkpoint-result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", acceptanceCode], {
      cwd: REPO_ROOT, env: { ...process.env, KINGPEPE_CI_TOOL_ROOT: root, GITHUB_SHA: "0".repeat(40) },
      encoding: "utf8", timeout: 10_000, maxBuffer: 8192, windowsHide: true,
    });
    assert.equal(child.error, undefined, "WorkflowGateExecutionFailed"); assert.equal(child.signal, null);
    assert.equal(child.status, expected); assert.equal(JSON.parse(child.stdout).sourceSha, "0".repeat(40));
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-ci-gate-test-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink()); rmSync(root, { recursive: true, force: true });
  }
});

function completeResult() {
  return {
    state: "COMPLETED", fullNativeToSolanaE2e: "PASS",
    localSecurity: { pass: 22, fail: 0 }, localRecovery: { pass: 7, fail: 0 },
    localRecoveryPsbt: { pass: 4, fail: 0 }, localRecoveryRaces: { pass: 10, fail: 0 },
    localClaimRetry: { pass: 7, fail: 0, passed: [
      "CLAIM_IDENTITY_PERSISTED_BEFORE_PROCESS_EXIT_AND_NETWORK_SEND",
      "RESTART_REBROADCASTS_IDENTICAL_PACKET_AFTER_PRE_SEND_EXIT",
      "PROCESS_EXITS_AFTER_REAL_VALIDATOR_ACCEPTANCE_BEFORE_COMPLETION_RECORD",
      "FINALIZED_CLAIM_OBSERVED_AFTER_REAL_BLOCKHASH_EXPIRY_WITHOUT_RESEND",
      "COMPLETED_PROCESS_REOPEN_HAS_NO_SECOND_MINT",
      "STOPPED_CLAIM_WORKER_REOPEN_DOES_NOT_OBSERVE_OR_SEND",
      "LATE_COMPLETION_CANNOT_CLEAR_STOPPED_CLAIM_JOURNAL",
    ] },
    localAccounting: { pass: 5, fail: 0 },
    nativeToSolanaE2e: { depositAccounting: { snapshot: { authorizedUnmintedCredits: "0" } },
      depositIntent: { recoverable: true, recoveryAvailableAfterSweep: false, scriptPubKeyHex: "51" },
      frostCustody: { taprootScriptPubKeyHex: "52" } },
  };
}

// Executes the actual checked-in workflow gate against non-economic report
// fixtures. This tests CI's acceptance contract, not a blockchain or signer.
test("CI failed flow preserves the runner's sanitized source location without printing raw errors", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ci-gate-test-"));
  try {
    const result = completeResult();
    result.state = "LOCAL_NATIVE_TO_SOLANA_E2E_FAILED";
    result.fullNativeToSolanaE2e = "FAILED";
    result.infrastructure = { failureSource: "scripts/local-native-evidence-verifier.mjs:16",
      error: "DO_NOT_PUBLISH_RAW_SUBPROCESS_ERROR" };
    writeFileSync(path.join(root, "result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: REPO_ROOT, env: { ...process.env, KINGPEPE_CI_TOOL_ROOT: root, GITHUB_SHA: "0".repeat(40) },
      encoding: "utf8", timeout: 10_000, maxBuffer: 8192, windowsHide: true,
    });
    assert.equal(child.status, 1);
    assert.equal(JSON.parse(child.stdout).failureSource, result.infrastructure.failureSource);
    assert(!child.stdout.includes(result.infrastructure.error));
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("kingpepe-ci-gate-test-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, change, expected] of [
  ["accepts all seven claim-worker checks", () => {}, 0],
  ["rejects the obsolete five-check result", r => { r.localClaimRetry.pass = 5; }, 1],
  ["requires the stopped-worker reopen check", r => { r.localClaimRetry.passed.splice(5, 1); }, 1],
  ["requires the late-completion rejection check", r => { r.localClaimRetry.passed.splice(6, 1); }, 1],
  ["rejects any claim-worker failure", r => { r.localClaimRetry.fail = 1; }, 1],
  ["rejects an incomplete economic flow", r => { r.fullNativeToSolanaE2e = "NOT_RUN"; }, 1],
]) {
  test(`CI local E2E gate ${name}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ci-gate-test-"));
    try {
      const result = completeResult();
      change(result);
      writeFileSync(path.join(root, "result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: REPO_ROOT, env: { ...process.env, KINGPEPE_CI_TOOL_ROOT: root, GITHUB_SHA: "0".repeat(40) },
        encoding: "utf8", timeout: 10_000, maxBuffer: 8192, windowsHide: true,
      });
      assert.equal(child.error, undefined, "WorkflowGateExecutionFailed");
      assert.equal(child.signal, null);
      assert.equal(child.status, expected);
      assert.equal(JSON.parse(child.stdout).sourceSha, "0".repeat(40));
    } finally {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert(path.basename(root).startsWith("kingpepe-ci-gate-test-"));
      assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// The forward service gate must require the actual restart/recovery evidence.
for (const [name, mutate, expected] of [
  ["accepts complete forward evidence", () => {}, 0],
  ["rejects a different source", r => { r.sourceSha = "1".repeat(40); }, 1],
  ["rejects a dirty tree", r => { r.worktreeDirty = true; }, 1],
  ["rejects an incomplete operation", r => { r.nativeToSolana = "OBSERVED"; }, 1],
  ["requires every retained recovery check", r => { r.checks.passed.pop(); }, 1],
  ["requires both forward restore boundaries", r => { r.recovery.pop(); }, 1],
  ["rejects renewed signing during restore", r => { r.recovery[0].newSigningOrBroadcast = true; }, 1],
  ["rejects missing chain catch-up", r => { r.recovery[0].liveChainCatchUp = "PENDING"; }, 1],
]) test(`CI forward service gate ${name}`, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ci-gate-test-"));
  try {
    const recovery = () => ({ encryptedCapture: true, fileHashesMatched: true, sourceStateUnchanged: true,
      originalJournalIdentityRetained: true, consumedSignerStateRetained: true, wrongPassphraseRejected: true,
      corruptArchiveRejectedBeforeExtraction: true, missingExpectedOperationKeptPaused: true,
      ambiguousPostSnapshotActivityKeptPaused: true, resumedPaused: true, liveChainCatchUp: "PASS", newSigningOrBroadcast: false });
    const result = { sourceSha: "0".repeat(40), worktreeDirty: false, state: "COMPLETED", nativeToSolana: "COMPLETED",
      noPerTransferKingPepeTeamApproval: true, recoveryProcedure: "TESTED", recovery: [recovery(), recovery()],
      checks: { pass: 16, fail: 0, passed: ["SDK_HTTP_DEPOSIT_INTAKE_IDEMPOTENT_EXISTING_JOURNAL", "PENDING_DEPOSIT_RESTART_PRESERVES_PAUSE_NO_SIGNING", "PROCESS_EXIT_AFTER_NONCE_COMMITMENT_RETAINED", "RESTART_ABORTS_OLD_NONCE_A_B_AND_PERSISTS_NEW_AGGREGATE", "AUTOMATIC_NATIVE_OBSERVER_VALIDATES_AND_FROST_SWEEPS", "NATIVE_SWEEP_RESPONSE_LOST_SIGNED_OPERATION_RETAINED", "PENDING_DEPOSIT_PROCESS_RESTART_NO_DOUBLE_SWEEP_OR_RESIGN", "CREDIT_APPEND_CRASH_AND_RPC_OUTAGE_WAIT_NOT_FALSE_DEFICIT", "RPC_RECOVERY_RETAINS_EXACT_CREDIT_AND_CANONICAL_RESERVE", "REAL_UNSUBMITTED_SOLANA_PACKET_EXPIRED_NO_MINT", "EXPIRED_PACKET_REBUILT_SAME_CREDIT_AFTER_LIVE_ABSENCE_CHECK", "PAUSED_RESTART_RETAINS_ALREADY_FINALIZED_MINT_WITHOUT_REMINT", "LOST_SOLANA_RECEIPT_AND_CLAIM_RESPONSES_RECOVERED", "AUTOMATIC_NATIVE_TO_SOLANA_COMPLETED_AND_RECONCILED", "DUPLICATE_DEPOSIT_AND_RESTART_NO_DOUBLE_MINT", "PERSISTENT_PAUSE_AND_EXPLICIT_REVIEWED_RESUME"] } };
    mutate(result); writeFileSync(path.join(root, "service-result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", serviceCode], {
      cwd: REPO_ROOT, env: { ...process.env, KINGPEPE_CI_TOOL_ROOT: root, GITHUB_SHA: "0".repeat(40) },
      encoding: "utf8", timeout: 10_000, maxBuffer: 8192, windowsHide: true,
    });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, expected);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-ci-gate-test-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink()); rmSync(root, { recursive: true, force: true });
  }
});
