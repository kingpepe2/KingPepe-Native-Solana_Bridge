// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Each service process compiles its own reviewed helper into an atomic private
// external directory. Existing executables or adjacent hash files are NOT trusted.
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { validateRuntimeStateRoot, validateRuntimeFile } from "../runtime-path-boundary.mjs";
const sourceRoot = path.resolve(import.meta.dirname, "../..");
const sources = ["ProtectedStore.cs", "ProtectedStoreExecutable.cs", "protected-helper-build.ps1"];
let retained, failed = false;
const BUILD_STAGES = new Set(["INPUT", "SOURCE_COMPILE", "PRIVATE_DIRECTORY", "FRAMEWORK_COMPILER", "EXECUTABLE_COMPILE", "EXECUTABLE_POLICY", "RESULT"]);
const check = value => { if (!value) throw new Error("WindowsProtectedExecutableRejected"); };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceDigest = () => hash(JSON.stringify(sources.map(name => [name, hash(readFileSync(path.join(import.meta.dirname, name)))])));
function verify(value) {
  check(sourceDigest() === value.sourceDigest);
  validateRuntimeStateRoot(value.root, sourceRoot); validateRuntimeFile(value.executable, sourceRoot);
  const directory = lstatSync(value.root), file = lstatSync(value.executable);
  check(directory.isDirectory() && !directory.isSymbolicLink() && file.isFile() && !file.isSymbolicLink() &&
    file.nlink === 1 && file.size > 0 && file.size <= 1048576 && hash(readFileSync(value.executable)) === value.sha256);
}
export function windowsProtectedExecutable() {
  check(process.platform === "win32" && !failed);
  let rejectedBuildStage;
  try {
    if (!retained) {
      const windowsRoot = process.env.SystemRoot;
      check(typeof windowsRoot === "string" && /^[A-Z]:\\[^\r\n\0]+$/iu.test(windowsRoot));
      const root = validateRuntimeStateRoot(path.join(path.resolve(os.tmpdir()),
        "kingpepe-protected-helper-" + process.pid + "-" + randomBytes(16).toString("hex")), sourceRoot);
      const parent = path.dirname(root);
      const before = sourceDigest(), input = Buffer.from(JSON.stringify({ root }));
      let result;
      try {
        result = spawnSync(path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(import.meta.dirname, "protected-helper-build.ps1")],
          { input, encoding: "buffer", timeout: 30000, maxBuffer: 4096, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        const [stage, reason] = (result.stderr?.toString("utf8").replace(/^WINDOWS_PROTECTED_HELPER_BUILD_REJECTED:/u, "") ?? "").split(":");
        if (BUILD_STAGES.has(stage) && /^(POLICY|ROOT_CANONICAL|ROOT_FIXED_DRIVE|ROOT_SOURCE_BOUNDARY|ROOT_REPARSE|DIRECTORY_PARENT|DIRECTORY_CREATE_[0-9]{1,6}|ACL_PRINCIPAL|ACL_INHERITANCE|ACL_RULE_COUNT|ACL_ACCESS)$/u.test(reason ?? "")) rejectedBuildStage = stage + "_" + reason;
        check(!result.error && result.status === 0 && result.stderr.length === 0);
        const built = JSON.parse(result.stdout.toString("utf8"));
        check(Object.keys(built).sort().join() === "compilerVersion,protocol,sha256" && built.protocol === "KINGPEPE_PROTECTED_EXECUTABLE_BUILD_V1" &&
          typeof built.sha256 === "string" && /^[0-9a-f]{64}$/u.test(built.sha256) && typeof built.compilerVersion === "string" && /^[0-9. ]{1,80}$/u.test(built.compilerVersion));
        check(sourceDigest() === before);
        retained = Object.freeze({ root, executable: path.join(root, "protected-store.exe"), sourceRoot,
          sourceDigest: before, sha256: built.sha256, compilerVersion: built.compilerVersion });
        verify(retained);
        process.once("exit", () => {
          // Only the exact generated executable and then an EMPTY directory.
          // Never recursively delete a cache, operational root or unknown file.
          try {
            verify(retained);
            check(path.dirname(retained.root) === parent && readdirSync(retained.root).join() === "protected-store.exe");
            unlinkSync(retained.executable); rmdirSync(retained.root);
          } catch { /* Preserve uncertain files; no private path logging. */ }
        });
      } finally { input.fill(0); result?.stdout?.fill(0); result?.stderr?.fill(0); }
    }
    verify(retained); return retained;
  } catch {
    failed = true;
    const error = new Error("WindowsProtectedExecutableRejected");
    if (rejectedBuildStage) error.code = "PROTECTED_HELPER_BUILD_" + rejectedBuildStage;
    throw error;
  }
}
