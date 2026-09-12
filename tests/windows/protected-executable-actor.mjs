// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Disposable compiled-code integrity tests, not service account certification.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, linkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { windowsProtectedExecutable } from "../../shared/windows/protected-executable.mjs";
import { windowsCurrentServiceSid } from "../../shared/windows/protected-store.mjs";
try {
  assert.equal(process.platform, "win32");
  const mode = process.argv[2], helper = windowsProtectedExecutable();
  assert(Object.isFrozen(helper));
  const identity = windowsCurrentServiceSid(); assert(typeof identity === "string");
  const ps = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (mode === "TAMPER") {
    const old = readFileSync(helper.executable), changed = Buffer.from(old); changed[0] ^= 1;
    writeFileSync(helper.executable, changed);
    assert.throws(windowsCurrentServiceSid, { message: "WindowsProtectedExecutableRejected" });
    writeFileSync(helper.executable, old); old.fill(0); changed.fill(0);
    assert.throws(windowsCurrentServiceSid, { message: "WindowsProtectedExecutableRejected" }, "NoAutomaticHelperIntegrityReset");
  } else if (mode === "MISSING") {
    unlinkSync(helper.executable);
    assert.throws(windowsCurrentServiceSid, { message: "WindowsProtectedExecutableRejected" });
  } else if (mode === "HARDLINK") {
    const link = path.join(helper.root, "test-hardlink.exe"); linkSync(helper.executable, link);
    try { assert.throws(windowsCurrentServiceSid, { message: "WindowsProtectedExecutableRejected" }); }
    finally { unlinkSync(link); }
  } else if (mode === "WRONG_ACL") {
    const script = '$ErrorActionPreference="Stop";try{$p=[Console]::In.ReadToEnd();$a=[IO.Directory]::GetAccessControl($p);$s=New-Object Security.Principal.SecurityIdentifier("S-1-1-0");$r=New-Object Security.AccessControl.FileSystemAccessRule($s,[Security.AccessControl.FileSystemRights]::ReadAndExecute,[Security.AccessControl.AccessControlType]::Allow);$a.AddAccessRule($r);[IO.Directory]::SetAccessControl($p,$a);exit 0}catch{exit 1}';
    const result = spawnSync(ps, ["-NoProfile", "-NonInteractive", "-Command", script],
      { input: helper.root, windowsHide: true, timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
    assert(result.status === 0 && result.stderr.length === 0, "TestHelperAclMutationFailed");
    assert.throws(windowsCurrentServiceSid, { message: "WindowsProtectedStoreRejected" });
  } else if (!["CANONICAL_PATH", "FOREIGN_MODULE_PATH"].includes(mode)) throw new Error("TEST_MODE_REJECTED");
  console.log("PROTECTED_EXECUTABLE_TEST_PASS");
} catch { console.error("PROTECTED_EXECUTABLE_TEST_FAILED"); process.exitCode = 1; }
