import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BLOCKED_LOCAL_INFRASTRUCTURE_MISSING,
  READY,
  REQUIRED_LOCAL_E2E_EXECUTABLES,
  evaluateLocalE2eReadiness,
  findExecutable,
} from "../local-e2e-readiness.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

for (const [label, cFree, dFree, blocked] of [
  ["C below floor", 8n * 1024n ** 3n - 1n, 4n * 1024n ** 3n, true],
  ["D below floor", 8n * 1024n ** 3n, 4n * 1024n ** 3n - 1n, true],
  ["exact floors", 8n * 1024n ** 3n, 4n * 1024n ** 3n, false],
]) test(`Devnet observation disk guard retains a safe failing sample: ${label}`, () => {
  // Exercise the actual entrypoint before any RPC/state access, without filling
  // a disk. The child-only Windows/statfs substitution is not a Windows storage
  // certificate. Even the accepted-floor case stops at the production guard.
  const entry = new URL("../../solana/tests/devnet-bridge-service.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    Object.defineProperty(process, "platform", { value: "win32" });
    fs.statfsSync = drive => ({ bavail: drive === "C:/" ? ${cFree}n : ${dFree}n, bsize: 1n });
    syncBuiltinESMExports();
    globalThis.fetch = () => { throw new Error("UNEXPECTED_NETWORK_ACCESS"); };
    await import(${JSON.stringify(entry)});
  `], { cwd: REPO_ROOT, encoding: "utf8", timeout: 20000, windowsHide: true,
    env: { ...process.env, TEMP: "D:/test-output", TMP: "D:/test-output", KINGPEPE_E2E_ROOT: "D:/test-output",
      KINGPEPE_PRODUCTION_ACTIVATION: "1", SOLANA_DEVNET_RPC_URL: "https://example.invalid/PRIVATE_RPC_SENTINEL" } });
  assert.equal(child.error, undefined); assert.equal(child.status, 1);
  assert(!child.stdout.includes("PRIVATE_RPC_SENTINEL") && !child.stderr.includes("PRIVATE_RPC_SENTINEL"));
  const events = child.stdout.trim().split(/\r?\n/u).map(line => JSON.parse(line));
  const failure = events.find(value => value.name === "DEVNET_TEST_FAILED");
  assert.equal(failure.stage, "PREFLIGHT");
  assert.equal(events.at(-1).evidenceRetained, false);
  assert.equal(events.at(-1).status, blocked ? "BLOCKED" : "FAIL");
  if (blocked) {
    assert.equal(failure.diagnostic.reason, "TEST_DISK_HEADROOM_REQUIRED");
    assert.equal(failure.diagnostic.disk.cFree, cFree.toString());
    assert.equal(failure.diagnostic.disk.dFree, dFree.toString());
    assert.equal(failure.diagnostic.disk.minimumCFree, (8n * 1024n ** 3n).toString());
    assert.equal(failure.diagnostic.disk.minimumDFree, (4n * 1024n ** 3n).toString());
    assert(Number.isFinite(Date.parse(failure.diagnostic.disk.observedAt)));
  } else assert.equal(failure.diagnostic.disk, undefined);
});

test("current repository readiness gate remains blocked without local E2E executables", () => {
  const result = evaluateLocalE2eReadiness({
    repoRoot: REPO_ROOT,
    envPath: "",
    platform: "linux",
  });
  assert.equal(result.state, BLOCKED_LOCAL_INFRASTRUCTURE_MISSING);
  assert.equal(result.canRunRealLocalE2e, false);
  for (const command of REQUIRED_LOCAL_E2E_EXECUTABLES) {
    assert(result.blockers.includes(`MISSING_EXECUTABLE:${command}`));
  }
  assert(!result.blockers.includes("SOLANA_PROGRAM_EXECUTION_NOT_READY:kingpepe-bridge"));
  assert(!result.blockers.includes("SOLANA_PROGRAM_EXECUTION_NOT_READY:kingpepe-transceiver"));
});

test("executable discovery is path-delimited and does not inspect unrelated environment data", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-local-e2e-tools-"));
  try {
    const commandPath = path.join(root, "solana-test-validator");
    writeFileSync(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(commandPath, 0o700);
    const found = findExecutable("solana-test-validator", {
      envPath: root,
      platform: "linux",
    });
    assert.equal(found.state, "FOUND");
    assert.equal(found.path, commandPath);

    const missing = findExecutable("kingpeped", {
      envPath: root,
      platform: "linux",
    });
    assert.equal(missing.state, "MISSING");
    mkdirSync(path.join(root, "kingpeped"));
    assert.equal(findExecutable("kingpeped", { envPath: root, platform: process.platform }).state, "MISSING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fake complete toolchain and deployable fixture reports READY", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-local-e2e-ready-"));
  const bin = path.join(root, "bin");
  const repo = path.join(root, "repo");
  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(path.join(repo, "solana", "programs", "kingpepe-bridge", "src"), { recursive: true });
    mkdirSync(path.join(repo, "solana", "programs", "kingpepe-transceiver", "src"), { recursive: true });
    for (const command of REQUIRED_LOCAL_E2E_EXECUTABLES) {
      const commandPath = path.join(bin, command);
      writeFileSync(commandPath, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
      chmodSync(commandPath, 0o700);
    }
    for (const program of ["kingpepe-bridge", "kingpepe-transceiver"]) {
      writeFileSync(
        path.join(repo, "solana", "programs", program, "Cargo.toml"),
        [
          "[package]",
          `name = "${program}"`,
          'version = "0.1.0"',
          'edition = "2021"',
          "",
          "[lib]",
          `name = "${program.replaceAll("-", "_")}"`,
          'crate-type = ["cdylib", "lib"]',
          "",
          "[dependencies]",
          'solana-program = "=3.0.0"',
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(repo, "solana", "programs", program, "src", "lib.rs"),
        [
          "use solana_program::{declare_id, entrypoint};",
          'declare_id!("11111111111111111111111111111111");',
          "entrypoint!(process_instruction);",
          'pub const PROGRAM_ABI_STATUS: &str = "ECONOMIC_ABI_ENABLED";',
          "pub enum TestInstruction {}",
          "pub fn decode_test_instruction() {}",
          "pub fn process_instruction() {}",
          "",
        ].join("\n"),
      );
    }
    writeFileSync(
      path.join(repo, "solana", "Anchor.toml"),
      [
        "[programs.localnet]",
        'kingpepe_bridge = "11111111111111111111111111111111"',
        'kingpepe_transceiver = "11111111111111111111111111111111"',
        "",
      ].join("\n"),
    );

    const result = evaluateLocalE2eReadiness({
      repoRoot: repo,
      envPath: bin,
      platform: "linux",
    });
    assert.equal(result.state, READY);
    assert.equal(result.canRunRealLocalE2e, true);
    assert.deepEqual(result.blockers, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
