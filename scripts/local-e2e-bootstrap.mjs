import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  createLocalE2ePlan,
  READY_TO_RUN_LOCAL_E2E,
  REQUIRED_KINGPEPE_REGTEST_VERSION,
  sanitizePlanForReport,
} from "./local-e2e-orchestrator.mjs";

export const LOCAL_E2E_BOOTSTRAP_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_E2E_BOOTSTRAP/V1";
export const LOCAL_E2E_BOOTSTRAP_READY = "LOCAL_E2E_BOOTSTRAP_READY";
export const LOCAL_E2E_BOOTSTRAP_BLOCKED = "BLOCKED_LOCAL_INFRASTRUCTURE_MISSING";
export const BLOCKED_LOCAL_E2E_VERSION_MISMATCH = "BLOCKED_LOCAL_E2E_VERSION_MISMATCH";
export const BLOCKED_PROGRAM_ARTIFACT_MISSING = "BLOCKED_PROGRAM_ARTIFACT_MISSING";
export const LOCAL_E2E_BOOTSTRAP_FAILED = "LOCAL_E2E_BOOTSTRAP_FAILED";

const MAXIMUM_CAPTURE_BYTES = 16 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
const DEFAULT_HEALTH_ATTEMPTS = 12;
const DEFAULT_HEALTH_DELAY_MS = 250;

export async function runLocalE2eBootstrap(options = {}) {
  const plan =
    options.plan ??
    createLocalE2ePlan({
      repoRoot: options.repoRoot ?? process.cwd(),
      runRoot: options.runRoot ?? process.env.KINGPEPE_LOCAL_E2E_ROOT,
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

  const executor = options.executor ?? new DefaultLocalE2eExecutor();
  const commandPaths = resolveCommandPaths(plan);
  const services = [];
  const checks = [];
  const programArtifactExists = options.programArtifactExists ?? existsSync;

  try {
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
    await runVersionCheck({ executor, commandPaths, command: "solana", checks });
    await runVersionCheck({ executor, commandPaths, command: "anchor", checks });

    await runPlanCommand({
      executor,
      commandPaths,
      command: plan.commands[0],
      checks,
      timeoutMs: options.commandTimeoutMs,
    });
    for (const artifactPath of [plan.paths.bridgeProgramSo, plan.paths.transceiverProgramSo]) {
      if (!programArtifactExists(artifactPath)) {
        return bootstrapResult(BLOCKED_PROGRAM_ARTIFACT_MISSING, "ANCHOR_BUILD_ARTIFACT_MISSING", plan, {
          checks,
          missingArtifact: artifactBasename(artifactPath),
          commandsStarted: [],
        });
      }
    }

    const solana = executor.startLongRunning({
      step: "START_SOLANA_LOCAL_VALIDATOR",
      executable: commandPaths.get("solana-test-validator"),
      args: plan.commands[1].args,
      cwd: plan.commands[1].cwd,
    });
    services.push(solana);
    const native = executor.startLongRunning({
      step: "START_KINGPEPE_REGTEST",
      executable: commandPaths.get("kingpeped"),
      args: plan.commands[2].args,
      cwd: plan.commands[2].cwd,
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

    return bootstrapResult(LOCAL_E2E_BOOTSTRAP_READY, "LOCAL_INFRASTRUCTURE_BOOTSTRAPPED", plan, {
      checks,
      commandsStarted: services.map((service) => service.step),
      fullNativeToSolanaE2e: "NOT_RUN_BY_BOOTSTRAP",
    });
  } catch (error) {
    return bootstrapResult(LOCAL_E2E_BOOTSTRAP_FAILED, error.code ?? "BOOTSTRAP_COMMAND_FAILED", plan, {
      checks,
      error: String(error.message ?? error).slice(0, 512),
      commandsStarted: services.map((service) => service.step),
      fullNativeToSolanaE2e: "NOT_RUN",
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
  if (expectedSubstring !== undefined && !result.output.includes(expectedSubstring)) {
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
  });
}

function artifactBasename(value) {
  return path.basename(value);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runLocalE2eBootstrap({
    repoRoot: path.resolve(process.argv[2] ?? process.cwd()),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.state === LOCAL_E2E_BOOTSTRAP_READY ? 0 : 2;
}
