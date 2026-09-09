import assert from "node:assert/strict";
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
          'solana-program = "1.18.26"',
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
