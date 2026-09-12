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
for (const mode of ["SAME_IMPLEMENTATION", "TAMPER", "MISSING", "HARDLINK", "WRONG_ACL"]) {
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
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "protected-executable-actor.mjs"), mode],
      { env: { ...process.env, TEMP: root, TMP: root }, timeout: 60000, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    assert(result.status === 0 && result.stderr.length === 0 &&
      result.stdout.toString("utf8").trim() === "PROTECTED_EXECUTABLE_TEST_PASS", "ProtectedExecutableActorRejected");
  });
}
