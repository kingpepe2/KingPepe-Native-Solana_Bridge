import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const LOCAL_E2E_READINESS_PROTOCOL = "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_E2E_READINESS/V1";
export const REQUIRED_LOCAL_E2E_EXECUTABLES = Object.freeze([
  "kingpeped",
  "kingpepe-cli",
  "solana",
  "solana-test-validator",
  "anchor",
]);
export const REQUIRED_SOLANA_PROGRAMS = Object.freeze(["kingpepe-bridge", "kingpepe-transceiver"]);
export const READY = "READY";
export const BLOCKED_LOCAL_INFRASTRUCTURE_MISSING = "BLOCKED_LOCAL_INFRASTRUCTURE_MISSING";

export function evaluateLocalE2eReadiness(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const commandResults = REQUIRED_LOCAL_E2E_EXECUTABLES.map((command) =>
    findExecutable(command, {
      envPath: options.envPath ?? process.env.PATH ?? "",
      platform: options.platform ?? process.platform,
      pathExt: options.pathExt ?? process.env.PATHEXT,
    }),
  );
  const solanaPrograms = REQUIRED_SOLANA_PROGRAMS.map((program) => inspectSolanaProgram(repoRoot, program));
  const anchorConfig = inspectAnchorConfig(repoRoot);
  const missingExecutables = commandResults.filter((entry) => entry.state !== "FOUND").map((entry) => entry.command);
  const nonDeployablePrograms = solanaPrograms.filter((entry) => entry.state !== "DEPLOYABLE").map((entry) => entry.program);
  const blockers = [
    ...missingExecutables.map((command) => `MISSING_EXECUTABLE:${command}`),
    ...nonDeployablePrograms.map((program) => `SOLANA_PROGRAM_NOT_DEPLOYABLE:${program}`),
    ...(anchorConfig.state === "READY" ? [] : [`ANCHOR_CONFIG_NOT_READY:${anchorConfig.reason}`]),
  ];

  return Object.freeze({
    protocol: LOCAL_E2E_READINESS_PROTOCOL,
    state: blockers.length === 0 ? READY : BLOCKED_LOCAL_INFRASTRUCTURE_MISSING,
    requiredExecutables: commandResults,
    solanaPrograms,
    anchorConfig,
    blockers,
    canRunRealLocalE2e: blockers.length === 0,
  });
}

export function findExecutable(command, options = {}) {
  const platform = options.platform ?? process.platform;
  const envPath = options.envPath ?? process.env.PATH ?? "";
  const pathExt = options.pathExt ?? process.env.PATHEXT;
  const candidateNames = executableCandidateNames(command, platform, pathExt);
  for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
    for (const name of candidateNames) {
      const candidate = path.join(directory, name);
      if (isExecutableFile(candidate, platform)) {
        return Object.freeze({
          command,
          state: "FOUND",
          path: candidate,
        });
      }
    }
  }
  return Object.freeze({
    command,
    state: "MISSING",
  });
}

export function inspectSolanaProgram(repoRoot, program) {
  const programRoot = path.join(repoRoot, "solana", "programs", program);
  const manifestPath = path.join(programRoot, "Cargo.toml");
  const sourcePath = path.join(programRoot, "src", "lib.rs");
  const missing = [];
  if (!existsSync(manifestPath)) missing.push("Cargo.toml");
  if (!existsSync(sourcePath)) missing.push("src/lib.rs");
  if (missing.length > 0) {
    return Object.freeze({
      program,
      state: "MISSING",
      missing,
    });
  }

  const manifest = readFileSync(manifestPath, "utf8");
  const source = readFileSync(sourcePath, "utf8");
  const checks = Object.freeze({
    hasCdylibCrateType: /crate-type\s*=\s*\[[^\]]*"cdylib"/u.test(manifest),
    hasSolanaProgramDependency: /^\s*solana-program\s*=/mu.test(manifest),
    hasEntrypoint: /entrypoint!\s*\(|process_instruction\s*\(/u.test(source),
    hasProgramIdDeclaration: /declare_id!\s*\(/u.test(source),
  });
  const failed = Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  return Object.freeze({
    program,
    state: failed.length === 0 ? "DEPLOYABLE" : "BOUNDARY_MODEL_ONLY",
    checks,
    failed,
  });
}

export function inspectAnchorConfig(repoRoot) {
  const anchorToml = path.join(repoRoot, "solana", "Anchor.toml");
  if (!existsSync(anchorToml)) {
    return Object.freeze({ state: "MISSING", reason: "ANCHOR_TOML_MISSING" });
  }
  const config = readFileSync(anchorToml, "utf8");
  const hasLocalnetPrograms = /\[programs\.localnet\]/u.test(config);
  const hasPlaceholderIds = /=\s*"[^"]*\.\.\.[^"]*"/u.test(config) || /placeholder/iu.test(config);
  if (!hasLocalnetPrograms) {
    return Object.freeze({ state: "BLOCKED", reason: "LOCALNET_PROGRAM_SECTION_MISSING" });
  }
  if (hasPlaceholderIds) {
    return Object.freeze({ state: "BLOCKED", reason: "LOCALNET_PROGRAM_IDS_PLACEHOLDER" });
  }
  return Object.freeze({ state: "READY", reason: "LOCALNET_PROGRAM_IDS_CONFIGURED" });
}

function executableCandidateNames(command, platform, pathExt) {
  if (platform !== "win32") return [command];
  const lower = command.toLowerCase();
  const extensions = (pathExt ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
  if (extensions.some((extension) => lower.endsWith(extension))) return [command];
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

function isExecutableFile(candidate, platform) {
  try {
    accessSync(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = evaluateLocalE2eReadiness({
    repoRoot: path.resolve(process.argv[2] ?? process.cwd()),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.canRunRealLocalE2e ? 0 : 2;
}
