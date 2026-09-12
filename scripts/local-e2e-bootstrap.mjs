import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createLocalE2ePlan,
  initializeLocalE2eRunRoot,
  READY_TO_RUN_LOCAL_E2E,
  REQUIRED_KINGPEPE_REGTEST_VERSION,
  REQUIRED_SOLANA_VERSION,
  REQUIRED_SBF_BUILDER_VERSION,
  sanitizePlanForReport,
} from "./local-e2e-orchestrator.mjs";

export const LOCAL_E2E_BOOTSTRAP_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_E2E_BOOTSTRAP/V1";
export const LOCAL_E2E_BOOTSTRAP_READY = "LOCAL_E2E_BOOTSTRAP_READY";
export const LOCAL_E2E_BOOTSTRAP_BLOCKED = "BLOCKED_LOCAL_INFRASTRUCTURE_MISSING";
export const BLOCKED_LOCAL_E2E_VERSION_MISMATCH = "BLOCKED_LOCAL_E2E_VERSION_MISMATCH";
export const BLOCKED_PROGRAM_ARTIFACT_MISSING = "BLOCKED_PROGRAM_ARTIFACT_MISSING";
export const LOCAL_E2E_BOOTSTRAP_FAILED = "LOCAL_E2E_BOOTSTRAP_FAILED";
export const LOCAL_E2E_FLOW_FAILED = "LOCAL_E2E_FLOW_FAILED";

const MAXIMUM_CAPTURE_BYTES = 16 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
// Fresh Native databases on a Windows-mounted WSL volume can need more than three
// seconds. Keep readiness bounded, but do not mistake database initialization
// for an economic-flow failure. Every attempt still requires a real RPC reply.
const DEFAULT_HEALTH_ATTEMPTS = 120;
const DEFAULT_HEALTH_DELAY_MS = 250;

export async function runLocalE2eBootstrap(options = {}) {
  return withLocalE2eInfrastructure(options, async () => ({
    fullNativeToSolanaE2e: "NOT_RUN_BY_BOOTSTRAP",
  }));
}

export async function withLocalE2eInfrastructure(options = {}, runFlow = async () => ({})) {
  const plan =
    options.plan ??
    createLocalE2ePlan({
      repoRoot: options.repoRoot ?? process.cwd(),
      runRoot: options.runRoot ?? process.env.KINGPEPE_LOCAL_E2E_ROOT,
      buildRoot: options.buildRoot,
      envPath: options.envPath,
      platform: options.platform,
      pathExt: options.pathExt,
    });

  if (plan.state !== READY_TO_RUN_LOCAL_E2E) {
    return bootstrapResult(LOCAL_E2E_BOOTSTRAP_BLOCKED, "READINESS_BLOCKED", plan, {
      blockers: plan.blockers,
      commandsStarted: [],
    });
  }

  if (typeof runFlow !== "function") {
    throw new Error("LocalE2eFlowCallbackRequired");
  }

  const executor = options.executor ?? new DefaultLocalE2eExecutor();
  const commandPaths = resolveCommandPaths(plan);
  const services = [];
  const checks = [];
  const programArtifactExists = options.programArtifactExists ?? existsSync;

  try {
    // The default executor starts real services; it must claim a new private
    // test directory before any compiler can generate disposable keypairs.
    if (executor instanceof DefaultLocalE2eExecutor) initializeLocalE2eRunRoot(plan);
    await runVersionCheck({
      executor,
      commandPaths,
      command: "kingpeped",
      expectedSubstring: REQUIRED_KINGPEPE_REGTEST_VERSION,
      checks,
    });
    await runVersionCheck({
      executor,
      commandPaths,
      command: "kingpepe-cli",
      expectedSubstring: REQUIRED_KINGPEPE_REGTEST_VERSION,
      checks,
    });
    for (const command of ["solana", "solana-test-validator"]) {
      await runVersionCheck({ executor, commandPaths, command, expectedSubstring: REQUIRED_SOLANA_VERSION, checks });
    }
    await runVersionCheck({ executor, commandPaths, command: "cargo-build-sbf", expectedSubstring: REQUIRED_SBF_BUILDER_VERSION, checks });
    for (const command of plan.commands.filter((entry) => entry.step.startsWith("BUILD_SBF_"))) {
      await runPlanCommand({ executor, commandPaths, command, checks, timeoutMs: options.commandTimeoutMs ?? 600_000 });
    }
    for (const artifactPath of [plan.paths.bridgeProgramSo, plan.paths.transceiverProgramSo]) {
      if (!programArtifactExists(artifactPath)) {
        return bootstrapResult(BLOCKED_PROGRAM_ARTIFACT_MISSING, "SBF_BUILD_ARTIFACT_MISSING", plan, {
          checks,
          missingArtifact: artifactBasename(artifactPath),
          commandsStarted: [],
        });
      }
    }

    const solana = executor.startLongRunning({
      step: "START_SOLANA_LOCAL_VALIDATOR",
      executable: commandPaths.get("solana-test-validator"),
      args: plan.commands.find((entry) => entry.step === "START_SOLANA_LOCAL_VALIDATOR").args,
      cwd: plan.repoRoot,
    });
    services.push(solana);
    const native = executor.startLongRunning({
      step: "START_KINGPEPE_REGTEST",
      executable: commandPaths.get("kingpeped"),
      args: plan.commands.find((entry) => entry.step === "START_KINGPEPE_REGTEST").args,
      cwd: plan.repoRoot,
    });
    services.push(native);

    await retryHealthCheck({
      executor,
      step: "CHECK_SOLANA_LOCAL_VALIDATOR_HEALTH",
      executable: commandPaths.get("solana"),
      args: ["--url", `http://127.0.0.1:${plan.ports.solanaRpcPort}`, "cluster-version"],
      cwd: plan.repoRoot,
      checks,
      attempts: options.healthAttempts,
      delayMs: options.healthDelayMs,
    });
    await retryHealthCheck({
      executor,
      step: "CHECK_KINGPEPE_REGTEST_HEALTH",
      executable: commandPaths.get("kingpepe-cli"),
      args: plan.nativeCliTemplates.chainInfo,
      cwd: plan.repoRoot,
      checks,
      attempts: options.healthAttempts,
      delayMs: options.healthDelayMs,
    });

    const flowExtra = await runLocalE2eFlowCallback(runFlow, {
      plan,
      executor,
      commandPaths,
      services,
      checks,
    });

    return bootstrapResult(LOCAL_E2E_BOOTSTRAP_READY, "LOCAL_INFRASTRUCTURE_BOOTSTRAPPED", plan, {
      checks,
      commandsStarted: services.map((service) => service.step),
      ...sanitizeFlowExtra(flowExtra),
    });
  } catch (error) {
    return bootstrapResult(LOCAL_E2E_BOOTSTRAP_FAILED, error.code ?? "BOOTSTRAP_COMMAND_FAILED", plan, {
      checks,
      error: error.code === LOCAL_E2E_FLOW_FAILED ? "Local economic flow failed" : "Local infrastructure command failed",
      ...(error.step === undefined ? {} : { failedStep: error.step }),
      ...(error.sourceLocation === undefined ? {} : { failureSource: error.sourceLocation }),
      commandsStarted: services.map((service) => service.step),
      fullNativeToSolanaE2e: error.code === LOCAL_E2E_FLOW_FAILED ? "FAILED" : "NOT_RUN",
    });
  } finally {
    await stopServices({ executor, commandPaths, plan, services });
  }
}

export class DefaultLocalE2eExecutor {
  async runOneShot({ step, executable, args = [], cwd, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS }) {
    return await new Promise((resolve, reject) => {
      execFile(
        executable,
        [...args],
        {
          cwd,
          encoding: "utf8",
          maxBuffer: MAXIMUM_CAPTURE_BYTES,
          shell: false,
          timeout: timeoutMs,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const output = `${stdout ?? ""}${stderr ?? ""}`.slice(-MAXIMUM_CAPTURE_BYTES);
          if (error !== null) {
            reject(commandError(step, output || error.message));
            return;
          }
          resolve({
            step,
            output,
          });
        },
      );
    });
  }

  startLongRunning({ step, executable, args = [], cwd }) {
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    return {
      step,
      pid: child.pid,
      async stop() {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
      },
    };
  }
}

export function resolveCommandPaths(plan) {
  const paths = new Map();
  for (const entry of plan.readiness.requiredExecutables) {
    if (entry.state !== "FOUND" || typeof entry.path !== "string" || entry.path.length === 0) {
      throw Object.assign(new Error(`missing executable: ${entry.command}`), {
        code: LOCAL_E2E_BOOTSTRAP_BLOCKED,
      });
    }
    paths.set(entry.command, entry.path);
  }
  return paths;
}

function bootstrapResult(state, reason, plan, extra = {}) {
  return Object.freeze({
    protocol: LOCAL_E2E_BOOTSTRAP_PROTOCOL,
    state,
    reason,
    productionReady: false,
    mainnetActivation: "DISABLED",
    plan: sanitizePlanForReport(plan),
    ...extra,
  });
}

async function runVersionCheck({
  executor,
  commandPaths,
  command,
  expectedSubstring,
  checks,
}) {
  const result = await executor.runOneShot({
    step: `CHECK_${command.toUpperCase().replaceAll("-", "_")}_VERSION`,
    executable: commandPaths.get(command),
    args: ["--version"],
  });
  const exactVersion = expectedSubstring === undefined ? undefined :
    new RegExp(`(?:^|\\s)${expectedSubstring.replaceAll(".", "\\.")}(?=\\s|$)`, "u");
  if (exactVersion !== undefined && !exactVersion.test(result.output)) {
    throw Object.assign(new Error(`${command} version does not include ${expectedSubstring}`), {
      code: BLOCKED_LOCAL_E2E_VERSION_MISMATCH,
    });
  }
  checks.push({
    step: result.step,
    state: "PASS",
  });
}

async function runPlanCommand({ executor, commandPaths, command, checks, timeoutMs }) {
  const result = await executor.runOneShot({
    step: command.step,
    executable: commandPaths.get(command.executable),
    args: command.args,
    cwd: command.cwd,
    timeoutMs,
  });
  checks.push({
    step: result.step,
    state: "PASS",
  });
}

async function retryHealthCheck({
  executor,
  step,
  executable,
  args,
  cwd,
  checks,
  attempts = DEFAULT_HEALTH_ATTEMPTS,
  delayMs = DEFAULT_HEALTH_DELAY_MS,
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await executor.runOneShot({
        step,
        executable,
        args,
        cwd,
      });
      checks.push({
        step,
        state: "PASS",
        attempts: attempt,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(delayMs);
    }
  }
  throw commandError(step, lastError?.message ?? "health check did not pass");
}

async function stopServices({ executor, commandPaths, plan, services }) {
  if (services.some((service) => service.step === "START_KINGPEPE_REGTEST")) {
    try {
      await executor.runOneShot({
        step: "STOP_KINGPEPE_REGTEST",
        executable: commandPaths.get("kingpepe-cli"),
        args: plan.nativeCliTemplates.stop,
        cwd: plan.repoRoot,
        timeoutMs: 5_000,
      });
    } catch {
      // The process handle below is still stopped. The original failure is
      // preserved by the caller; shutdown errors are not promoted.
    }
  }
  for (const service of services.toReversed()) {
    await service.stop();
  }
}

function commandError(step, detail) {
  return Object.assign(new Error(`${step} failed: ${String(detail).trim().slice(0, 512)}`), {
    code: "BOOTSTRAP_COMMAND_FAILED",
    step,
  });
}

function artifactBasename(value) {
  return path.basename(value);
}

async function runLocalE2eFlowCallback(runFlow, context) {
  try {
    return await runFlow(context);
  } catch (error) {
    throw Object.assign(new Error(String(error.message ?? error).slice(0, 512)), {
      code: LOCAL_E2E_FLOW_FAILED,
      step: error.step,
      sourceLocation: sanitizedErrorSource(error, context.plan.repoRoot),
    });
  }
}

function sanitizedErrorSource(error, repoRoot) {
  // Only a source-relative location is reportable; never echo error messages,
  // subprocess output, credentials, or runtime paths.
  for (const frame of String(error.stack ?? "").split("\n").slice(1)) {
    const match = /\b(file:\/\/\/[^\s)]+):(\d+):(\d+)/u.exec(frame);
    if (match === null) continue;
    try {
      const relative = path.relative(repoRoot, fileURLToPath(match[1]));
      if (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return `${relative.split(path.sep).join("/")}:${match[2]}`;
      }
    } catch {
      // Unrecognized frames are not diagnostic evidence.
    }
  }
  return undefined;
}

function sanitizeFlowExtra(value) {
  if (value === undefined) return {};
  const extra = requirePlainObject(value, "localE2eFlowResult");
  const forbidden = new Set([
    "protocol",
    "state",
    "reason",
    "productionReady",
    "mainnetActivation",
    "plan",
    "checks",
    "commandsStarted",
  ]);
  return Object.freeze(
    Object.fromEntries(Object.entries(extra).filter(([key]) => !forbidden.has(key))),
  );
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label}:ExpectedObject`), {
      code: LOCAL_E2E_FLOW_FAILED,
    });
  }
  return value;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runLocalE2eBootstrap({
    repoRoot: path.resolve(process.argv[2] ?? process.cwd()),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.state === LOCAL_E2E_BOOTSTRAP_READY ? 0 : 2;
}
