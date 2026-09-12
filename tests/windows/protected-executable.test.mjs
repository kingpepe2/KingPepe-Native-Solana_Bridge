// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
if (process.platform !== "win32") throw new Error("WINDOWS_PROTECTED_EXECUTABLE_TESTS_REQUIRE_WINDOWS");
const repoRoot = path.resolve(import.meta.dirname, "../..");
for (const mode of ["TAMPER", "MISSING", "HARDLINK", "WRONG_ACL", "CANONICAL_PATH", "FOREIGN_MODULE_PATH"]) {
  test("source-built protected executable " + mode.toLowerCase(), t => {
    const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-helper-test-"));
    validateRuntimeStateRoot(root, repoRoot);
    t.after(() => {
      assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("kingpepe-helper-test-"));
      // This actor creates only one disposable code cache, no keys or state.
      for (const child of readdirSync(root)) {
        assert(child.startsWith("kingpepe-protected-helper-"));
        const directory = path.join(root, child); assert(!lstatSync(directory).isSymbolicLink());
        assert(readdirSync(directory).every(file => file === "protected-store.exe"));
      }
      rmSync(root, { recursive: true });
    });
    let runtimeRoot = root;
    if (mode === "CANONICAL_PATH") {
      // Exercise the OS-provided short spelling when 8.3 aliases are enabled,
      // and the canonical spelling on volumes that do not create aliases.
      const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const short = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", '$ErrorActionPreference="Stop";$f=New-Object -ComObject Scripting.FileSystemObject;[Console]::Out.Write($f.GetFolder([Console]::In.ReadToEnd()).ShortPath)'],
        { input: root, encoding: "utf8", timeout: 30000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      assert(short.status === 0 && short.stderr.length === 0 && short.stdout.length > 0, "TestShortPathUnavailable");
      runtimeRoot = short.stdout;
      assert.equal(validateRuntimeStateRoot(runtimeRoot, repoRoot), validateRuntimeStateRoot(root, repoRoot));
    }
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "protected-executable-actor.mjs"), mode],
      { env: { ...process.env, TEMP: runtimeRoot, TMP: runtimeRoot,
        ...(mode === "FOREIGN_MODULE_PATH" ? { PSModulePath: path.join(root, "foreign-host-module-path") } : {}) }, timeout: 60000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    assert(result.status === 0 && result.stderr.length === 0 &&
      result.stdout.toString("utf8").trim() === "PROTECTED_EXECUTABLE_TEST_PASS", "ProtectedExecutableActorRejected");
  });
}
