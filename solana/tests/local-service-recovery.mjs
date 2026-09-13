// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Isolated manual-runbook drill, NOT a production backup service or rollback
// guarantee. GNU tar/GnuPG handle the archive; the existing service handles chains.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AuthenticatedLocalDepositLedger } from "../../services/bridge-validator/local-deposit-ledger.mjs";
import { MESSAGE_VERSION } from "../../shared/protocol/canonical-message.mjs";
import { validateRuntimeFile, validateRuntimeStateRoot, isSameOrInside } from "../../shared/runtime-path-boundary.mjs";
import { runLocalBridgeService } from "./local-bridge-service.mjs";

const MAX_ARCHIVE = 64 * 1024 * 1024;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const check = (value, message = "TEST_RECOVERY_REJECTED") => assert(value, message);
const options = (c, repoRoot) => ({ ...c.ledger, repoRoot, authenticationKey: Buffer.from(c.ledger.testAuthenticationKeyHex, "hex") });

// No shell interpolation, passphrase argument, plaintext disk archive or copied
// crypto implementation. Complete decryption must succeed BEFORE extraction.
function tool(name, args, { input, passphrase } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, { stdio: ["pipe", "pipe", "ignore", passphrase ? "pipe" : "ignore"], windowsHide: true });
    let length = 0, timedOut = false; const chunks = [];
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 60000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("TEST_RECOVERY_TOOL_UNAVAILABLE")); });
    child.stdout.on("data", chunk => { length += chunk.length; if (length > MAX_ARCHIVE) { timedOut = true; child.kill("SIGTERM"); } else chunks.push(chunk); });
    child.stdin.on("error", e => { if (e.code !== "EPIPE") { timedOut = true; child.kill("SIGTERM"); } });
    if (passphrase) { child.stdio[3].on("error", () => {}); child.stdio[3].end(passphrase); }
    child.stdin.end(input);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut || signal) { chunks.forEach(b => b.fill(0)); reject(new Error("TEST_RECOVERY_TOOL_INTERRUPTED")); }
      else resolve({ code, bytes: Buffer.concat(chunks) });
    });
  });
}
async function successful(name, args, input) {
  const result = await tool(name, args, input);
  if (result.code !== 0) { result.bytes.fill(0); throw new Error("TEST_RECOVERY_TOOL_FAILED:" + name); }
  return result.bytes;
}
function closedFiles(c, contextFile, repoRoot) {
  const roots = [c.ledger.root, ...c.signerRoots];
  const names = ["deposit-ledger.sqlite", "frost-signer-state.json", "frost-signer-state.json"];
  const files = [validateRuntimeFile(contextFile, repoRoot)];
  roots.forEach((root, i) => {
    validateRuntimeStateRoot(root, repoRoot);
    check(readdirSync(root).length === 1 && readdirSync(root)[0] === names[i], "TEST_SNAPSHOT_WRITER_OR_AUXILIARY_FILE_PRESENT");
    files.push(validateRuntimeFile(path.join(root, names[i]), repoRoot));
  });
  check(new Set(files).size === 4);
  for (const file of files) check(lstatSync(file).isFile() && lstatSync(file).size < MAX_ARCHIVE / 4);
  return files;
}
function confirmManualGapReview(ledger, expected, gapAccounted) {
  // A deliberate operator decision in this TEST drill, not an automatic anchor
  // or a claim that an unknown full-host rollback can be detected.
  check(ledger.status().state === "PAUSED", "TEST_RESTORE_MUST_START_PAUSED");
  check(gapAccounted, "TEST_POST_SNAPSHOT_ACTIVITY_REQUIRES_REVIEW");
  for (const id of expected.deposits) check(ledger.serviceDeposit(id), "TEST_EXPECTED_OPERATION_MISSING");
  for (const id of expected.withdrawals) check(ledger.knownWithdrawalIds().includes(id), "TEST_EXPECTED_OPERATION_MISSING");
}

export async function restoreClosedTestSnapshot({ context: c, contextFile, repoRoot, runRoot, sourceSha, boundary }) {
  check(process.platform === "linux" && c.environment === "LOCALNET_REGTEST_TEST_ONLY");
  check(/^[a-f0-9]{40}$/.test(sourceSha) && ["PENDING_NATIVE_SWEEP", "FINALIZED_MINT_PENDING_ACCOUNTING", "PENDING_NATIVE_PAYOUT"].includes(boundary));
  if (process.env.WSL_DISTRO_NAME) check(typeof process.env.KINGPEPE_TEST_RECOVERY_ROOT === "string", "TEST_PRIVATE_WINDOWS_RECOVERY_PARENT_REQUIRED");
  const start = Date.now(), files = closedFiles(c, contextFile, repoRoot);
  const original = AuthenticatedLocalDepositLedger.openLocal(options(c, repoRoot));
  let checkpoint, expected;
  try {
    checkpoint = original.checkpoint();
    expected = { deposits: original.serviceDeposits().map(v => v.operationId), withdrawals: original.knownWithdrawalIds() };
    check(expected.deposits.length === 1 && expected.withdrawals.length === (boundary === "PENDING_NATIVE_PAYOUT" ? 1 : 0));
  } finally { original.close(); }
  closedFiles(c, contextFile, repoRoot); // No live SQLite auxiliary file may be copied.
  const parent = validateRuntimeStateRoot(process.env.KINGPEPE_TEST_RECOVERY_ROOT ?? path.join(runRoot, "recovery-drill"), repoRoot);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  check(realpathSync(parent) === parent);
  // DrvFS uses Windows ACLs, not chmod. The local operator provisions the NEW
  // private test parent with Windows ACLs before this run; no ACL is changed here.
  if (!process.env.WSL_DISTRO_NAME) check((lstatSync(parent).mode & 0o077) === 0, "TEST_PRIVATE_RECOVERY_DIRECTORY_REQUIRED");
  const root = mkdtempSync(path.join(parent, boundary + "-"));
  const metadataFile = path.join(root, "snapshot-inventory.json");
  let base = path.dirname(files[0]);
  while (![...files, metadataFile].every(file => isSameOrInside(base, file))) base = path.dirname(base);
  validateRuntimeStateRoot(base, repoRoot);
  const inventory = files.map(file => ({ name: path.relative(base, file), digest: hash(readFileSync(file)) }));
  const metadata = { environment: c.environment, sourceSha, messageVersion: MESSAGE_VERSION, node: process.versions.node,
    sqlite: process.versions.sqlite, nativeGenesis: c.policy.nativeGenesis, solanaGenesis: c.policy.solanaGenesis,
    deployment: c.policy.solanaDeployment, capturedAt: new Date().toISOString(), checkpoint, expected, inventory };
  writeFileSync(metadataFile, JSON.stringify(metadata), { flag: "wx", mode: 0o600, flush: true });
  const names = [...inventory.map(v => v.name), path.relative(base, metadataFile)];
  check(names.every(name => name.length > 0 && !name.startsWith("-") && !name.split(path.sep).includes("..") && !/[\r\n\0]/u.test(name)));
  const gpgParent = process.env.KINGPEPE_SOCKET_ROOT ?? "/tmp";
  const gpgRoot = mkdtempSync(validateRuntimeStateRoot(path.join(gpgParent, "kp-recovery-gpg-"), repoRoot));
  check((lstatSync(gpgRoot).mode & 0o077) === 0, "TEST_PRIVATE_GPG_CONTROL_DIRECTORY_REQUIRED");
  const gpgArgs = ["--no-options", "--homedir", gpgRoot, "--batch", "--no-tty", "--pinentry-mode", "loopback",
    "--passphrase-fd", "3", "--no-symkey-cache"];
  const passphrase = Buffer.from(randomBytes(32).toString("hex") + "\n"), archive = path.join(root, "state.tar.gpg");
  let plain, verified;
  try {
    const tarVersion = (await successful("tar", ["--version"])).toString().split("\n")[0];
    const gpgVersion = (await successful("gpg", ["--version"])).toString().split("\n")[0];
    plain = await successful("tar", ["--create", "--file=-", "--no-recursion", "--directory", base, "--", ...names]);
    const encrypted = await successful("gpg", [...gpgArgs, "--symmetric", "--cipher-algo", "AES256", "--compress-algo", "none"], { input: plain, passphrase });
    plain.fill(0); plain = undefined;
    writeFileSync(archive, encrypted, { flag: "wx", mode: 0o600, flush: true });
    const corrupt = Buffer.from(encrypted); corrupt[Math.floor(corrupt.length / 2)] ^= 1;
    const corruptFile = path.join(root, "corrupt-test-copy.tar.gpg");
    writeFileSync(corruptFile, corrupt, { flag: "wx", mode: 0o600 });
    const wrong = Buffer.from(randomBytes(32).toString("hex") + "\n");
    try {
      const rejected = await tool("gpg", [...gpgArgs, "--decrypt", archive], { passphrase: wrong });
      rejected.bytes.fill(0); check(rejected.code === 2, "TEST_WRONG_PASSPHRASE_NOT_REJECTED");
    } finally { wrong.fill(0); }
    const rejected = await tool("gpg", [...gpgArgs, "--decrypt", corruptFile], { passphrase });
    rejected.bytes.fill(0); check(rejected.code === 2, "TEST_ARCHIVE_CORRUPTION_NOT_REJECTED");
    verified = await successful("gpg", [...gpgArgs, "--decrypt", archive], { passphrase });
    // Only this fully authenticated, bounded in-memory archive is extracted.
    const listed = (await successful("tar", ["--list", "--file=-"], { input: verified })).toString().trimEnd().split("\n");
    check(JSON.stringify([...listed].sort()) === JSON.stringify([...names].sort()), "TEST_ARCHIVE_INVENTORY_REJECTED");
    const destination = mkdtempSync(path.join(root, "restored-"));
    await successful("tar", ["--extract", "--file=-", "--directory", destination, "--keep-old-files", "--no-same-owner", "--no-same-permissions"], { input: verified });
    verified.fill(0); verified = undefined;
    for (const item of inventory) {
      const restoredFile = validateRuntimeFile(path.join(destination, item.name), repoRoot);
      check(hash(readFileSync(restoredFile)) === item.digest, "TEST_RESTORED_FILE_HASH_MISMATCH");
      check(hash(readFileSync(path.join(base, item.name))) === item.digest, "TEST_ORIGINAL_STATE_CHANGED");
    }
    check(hash(readFileSync(path.join(destination, path.relative(base, metadataFile)))) === hash(readFileSync(metadataFile)));
    const map = file => path.join(destination, path.relative(base, file));
    const restored = JSON.parse(readFileSync(map(contextFile), "utf8"));
    restored.ledger.root = path.dirname(map(files[1]));
    restored.signerRoots = files.slice(2).map(file => path.dirname(map(file)));
    restored.custody.signerStateRoots = { frostA: restored.signerRoots[0], frostB: restored.signerRoots[1] };
    const ledger = AuthenticatedLocalDepositLedger.openLocal({ ...options(restored, repoRoot), minimumCheckpoint: checkpoint });
    try {
      check(JSON.stringify(ledger.checkpoint()) === JSON.stringify(checkpoint), "TEST_JOURNAL_CHECKPOINT_MISMATCH");
      ledger.pause("RECOVERY_MANUAL_REVIEW");
      assert.throws(() => confirmManualGapReview(ledger, { ...expected, deposits: [...expected.deposits, "00".repeat(32)] }, true), /TEST_EXPECTED_OPERATION_MISSING/);
      assert.throws(() => confirmManualGapReview(ledger, expected, false), /TEST_POST_SNAPSHOT_ACTIVITY_REQUIRES_REVIEW/);
      check(ledger.status().state === "PAUSED");
      confirmManualGapReview(ledger, expected, true); // The parent launched no writer after the closed cut.
    } finally { ledger.close(); }
    const restoredContext = validateRuntimeFile(path.join(root, "restored-private-test-context.json"), repoRoot);
    writeFileSync(restoredContext, JSON.stringify(restored), { flag: "wx", mode: 0o600, flush: true });
    return { context: restored, contextFile: restoredContext, evidence: { boundary, capturedAt: metadata.capturedAt,
      restoreMilliseconds: Date.now() - start, tarVersion, gpgVersion, encryptedCapture: true, fileHashesMatched: true,
      sourceStateUnchanged: true, originalJournalIdentityRetained: true, consumedSignerStateRetained: true,
      wrongPassphraseRejected: true, corruptArchiveRejectedBeforeExtraction: true,
      missingExpectedOperationKeptPaused: true, ambiguousPostSnapshotActivityKeptPaused: true,
      scope: "CLOSED_LOCALNET_TEST_STATE_AND_KNOWN_QUIESCENT_GAP_NOT_FULL_HOST_OR_DPAPI_RECOVERY" } };
  } finally {
    plain?.fill(0); verified?.fill(0); passphrase.fill(0);
    // Only the agent for this newly created TEST control directory is stopped.
    await successful("gpgconf", ["--homedir", gpgRoot, "--kill", "gpg-agent"]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const result = await runLocalBridgeService(v => process.stderr.write(v + "\n"), { restoreSnapshot: restoreClosedTestSnapshot });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.state === "COMPLETED" && result.recoveryProcedure === "TESTED" ? 0 : 1;
}
