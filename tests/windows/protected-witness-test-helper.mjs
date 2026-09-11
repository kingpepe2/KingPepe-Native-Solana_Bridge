// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Isolated LOCALNET tests only. No registry deletion/recovery API is exported by
// the runtime. Only exact witness keys for explicitly registered test roots are
// addressed; never enumerate or delete a registry subtree.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { protectedContextDigest } from "../../shared/windows/protected-store.mjs";

export function witnessTestAction(options, action, bytes = undefined) {
  assert.equal(process.platform, "win32"); assert.equal(options.context.environment, "localnet");
  const parent = path.dirname(path.resolve(options.root));
  assert(path.dirname(parent) === path.resolve(os.tmpdir()) && /^kingpepe-(?:protected|ipc|fence)-test-/u.test(path.basename(parent)), "TestWitnessRootRequired");
  assert(path.dirname(path.resolve(options.anchorRoot)) === parent, "TestWitnessRootRequired");
  assert(["READ", "RESTORE", "CORRUPT", "WIDEN", "CHECK_ACL", "DELETE"].includes(action));
  const binding = [protectedContextDigest(options.context), options.context.serviceSid,
    path.resolve(options.root).toUpperCase(), path.resolve(options.anchorRoot).toUpperCase()].join("\n");
  const name = "Software\\KingPepe\\ProtectedWitnessV1\\" + createHash("sha256").update(binding).digest("hex");
  const script = `$ErrorActionPreference='Stop';try{
    $r=[Console]::In.ReadToEnd()|ConvertFrom-Json
    if($r.name -notmatch '^Software\\\\KingPepe\\\\ProtectedWitnessV1\\\\[0-9a-f]{64}$'){throw 'NAME'}
    $user=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::Registry64)
    $key=$user.OpenSubKey($r.name,$true)
    if($null -eq $key){if($r.action -eq 'DELETE'){[Console]::Out.Write('OK');exit 0};throw 'ABSENT'}
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl=$key.GetAccessControl()
    if(-not $acl.GetOwner([Security.Principal.SecurityIdentifier]).Equals($sid) -or $key.SubKeyCount -ne 0){throw 'BOUNDARY'}
    switch($r.action){
      'READ'{[Console]::Out.Write([Convert]::ToBase64String($key.GetValue('state')))}
      'RESTORE'{$key.SetValue('state',[Convert]::FromBase64String($r.bytes),[Microsoft.Win32.RegistryValueKind]::Binary);$key.Flush();[Console]::Out.Write('OK')}
      'CORRUPT'{$v=$key.GetValue('state');$v[$v.Length-1]=$v[$v.Length-1] -bxor 1;$key.SetValue('state',$v,[Microsoft.Win32.RegistryValueKind]::Binary);$key.Flush();[Console]::Out.Write('OK')}
      'WIDEN'{$other=New-Object Security.Principal.SecurityIdentifier -ArgumentList 'S-1-1-0';$rule=New-Object Security.AccessControl.RegistryAccessRule -ArgumentList $other,([Security.AccessControl.RegistryRights]::ReadKey),([Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule);$key.SetAccessControl($acl);$key.Flush();[Console]::Out.Write('OK')}
      'CHECK_ACL'{$rules=$acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]);if(-not $acl.AreAccessRulesProtected -or $rules.Count -ne 1 -or -not $rules[0].IdentityReference.Equals($sid) -or $rules[0].RegistryRights -ne [Security.AccessControl.RegistryRights]::FullControl){throw 'ACL'};[Console]::Out.Write('OK')}
      'DELETE'{$key.Close();$key=$null;$user.DeleteSubKey($r.name,$false);$user.Flush();[Console]::Out.Write('OK')}
      default{throw 'ACTION'}
    };if($null -ne $key){$key.Close()};$user.Close();exit 0
  }catch{[Console]::Error.Write('TEST_WITNESS_REJECTED');exit 1}`;
  const input = Buffer.from(JSON.stringify({ name, action, bytes: bytes?.toString("base64") }));
  let result;
  try {
    result = spawnSync(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", script], { input, windowsHide: true, timeout: 10000, maxBuffer: 32768, stdio: ["pipe", "pipe", "pipe"] });
    assert(result.status === 0 && result.stderr.length === 0, "TestWitnessOperationFailed");
    return action === "READ" ? Buffer.from(result.stdout.toString("utf8"), "base64") : undefined;
  } finally { input.fill(0); result?.stdout?.fill(0); result?.stderr?.fill(0); }
}
