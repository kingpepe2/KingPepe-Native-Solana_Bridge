// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const workflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
const code = workflow.match(/node --input-type=module -e '\r?\n([\s\S]*?)^ {10}'/mu)?.[1];
assert.ok(code?.includes("localClaimRetry") && code.length < 16_384, "LocalE2eWorkflowGateRequired");
const withdrawalCode = [...workflow.matchAll(/node --input-type=module -e '\r?\n([\s\S]*?)^ {10}'/gmu)][1]?.[1];
assert.ok(withdrawalCode?.includes("withdrawalRecord") && withdrawalCode.length < 16_384, "WithdrawalRecordWorkflowGateRequired");

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

for (const [name, change, expected] of [
  ["accepts all record prerequisites", () => {}, 0],
  ["rejects the previous 23-check subset", r => { r.withdrawalRecord.pass = 23; }, 1],
  ["requires the real fresh-PDA check", r => { r.withdrawalRecord.passed.shift(); }, 1],
  ["rejects a record regression failure", r => { r.withdrawalRecord.fail = 1; }, 1],
  ["rejects an expanded Phase 09 scope", r => { r.phase09 = "STARTED"; }, 1],
]) {
  test(`CI withdrawal prerequisite gate ${name}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-ci-gate-test-"));
    try {
      const result = { phase09: "NOT_STARTED", withdrawalRecord: { pass: 26, fail: 0, passed: [
        "FRESH_USER_FRESH_PDA_FINALIZED_BURN_AND_RECORD", "DUPLICATE_WITHDRAWAL_NEW_NONCE_REJECTED",
        "MISSING_USER_SIGNATURE_REJECTED", "INSUFFICIENT_RECORD_RENT_ROLLS_BACK",
        "PREFUNDED_SYSTEM_PDA_SAFELY_INITIALIZED", "LATER_INSTRUCTION_FAILURE_ROLLS_BACK_BURN_RECORD_AND_RENT",
        "DIRECT_SPL_BURN_CREATES_NO_WITHDRAWAL_ENTITLEMENT",
      ] } };
      change(result);
      writeFileSync(path.join(root, "withdrawal-record-result.json"), JSON.stringify(result), { flag: "wx", mode: 0o600 });
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", withdrawalCode], {
        cwd: REPO_ROOT, env: { ...process.env, KINGPEPE_CI_TOOL_ROOT: root, GITHUB_SHA: "0".repeat(40) },
        encoding: "utf8", timeout: 10_000, maxBuffer: 8192, windowsHide: true,
      });
      assert.equal(child.error, undefined, "WorkflowGateExecutionFailed");
      assert.equal(child.signal, null);
      assert.equal(child.status, expected);
    } finally {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert(path.basename(root).startsWith("kingpepe-ci-gate-test-"));
      assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// Executes the actual checked-in workflow gate against non-economic report
// fixtures. This tests CI's acceptance contract, not a blockchain or signer.
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
