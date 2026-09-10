// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NativeRpcClient } from "../native/node/native-rpc-client.mjs";
import { LocalNativeEvidenceVerifier } from "../native/node/native-raw-evidence.mjs";
import { validateLocalE2eRunRoot } from "./local-e2e-orchestrator.mjs";

export async function createLocalNativeEvidenceVerifier({ plan }) {
  const target = path.join(plan.paths.cargoTargetDir, "native-evidence");
  validateLocalE2eRunRoot(target, plan.repoRoot);
  try {
    await promisify(execFile)("cargo", ["build", "--quiet", "--locked", "--manifest-path", "native/proof/Cargo.toml",
      "--bin", "kingpepe-native-evidence", "--target-dir", target],
    { cwd: plan.repoRoot, windowsHide: true, timeout: 120_000, maxBuffer: 4096 });
  } catch { throw new Error("LOCAL_NATIVE_EVIDENCE_BUILD_FAILED"); }
  const executable = path.join(target, "debug", process.platform === "win32" ? "kingpepe-native-evidence.exe" : "kingpepe-native-evidence");
  const rpc = new NativeRpcClient({
    endpoint: `http://127.0.0.1:${plan.ports.nativeRpcPort}`,
    authCookieFile: path.join(plan.paths.nativeDatadir, "regtest", ".cookie"), repoRoot: plan.repoRoot, localOnly: true,
  });
  return new LocalNativeEvidenceVerifier({ rpc, executable });
}
