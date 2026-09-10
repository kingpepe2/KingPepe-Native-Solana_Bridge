import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { evaluateLocalE2eReadiness } from "./local-e2e-readiness.mjs";

export const LOCAL_E2E_ORCHESTRATOR_PROTOCOL =
  "KINGPEPE_NATIVE_SOLANA_BRIDGE/LOCAL_E2E_ORCHESTRATOR/V1";
export const READY_TO_RUN_LOCAL_E2E = "READY_TO_RUN_LOCAL_E2E";
export const BLOCKED_LOCAL_E2E = "BLOCKED_LOCAL_INFRASTRUCTURE_MISSING";
const toolchain = JSON.parse(readFileSync(new URL("./local-e2e-toolchain.json", import.meta.url), "utf8"));
export const REQUIRED_KINGPEPE_REGTEST_VERSION = toolchain.native.version;
export const REQUIRED_SOLANA_VERSION = toolchain.solana.version;
export const REQUIRED_SBF_BUILDER_VERSION = toolchain.solana.sbfBuilderVersion;
export const REQUIRED_SBF_TOOLS_VERSION = toolchain.solana.platformToolsVersion;

export const ALLOWED_REGTEST_CLI_COMMANDS = Object.freeze(
  new Set([
    "createwallet",
    "createrawtransaction",
    "generatetoaddress",
    "getblock",
    "getblockchaininfo",
    "getblockhash",
    "getblockheader",
    "getaddressinfo",
    "getnewaddress",
    "getrawtransaction",
    "gettxout",
    "sendtoaddress",
    "sendrawtransaction",
    "testmempoolaccept",
    "stop",
  ]),
);

const PROGRAM_ID_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const DEFAULT_NATIVE_RPC_PORT = 18443;
const DEFAULT_NATIVE_P2P_PORT = 18444;
const DEFAULT_SOLANA_RPC_PORT = 8899;
const DEFAULT_SOLANA_FAUCET_PORT = 9900;

export function createLocalE2ePlan(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const runRoot = validateLocalE2eRunRoot(
    options.runRoot ?? path.join(os.tmpdir(), `kingpepe-native-solana-local-e2e-${randomUUID()}`),
    repoRoot,
  );
  const cargoTargetDir = validateLocalE2eRunRoot(
    options.buildRoot ?? process.env.KINGPEPE_LOCAL_BUILD_ROOT ?? path.join(runRoot, "cargo-target"),
    repoRoot,
  );
  const nativeRpcPort = validateNonPrivilegedPort(
    options.nativeRpcPort ?? DEFAULT_NATIVE_RPC_PORT,
    "Native REGTEST RPC port",
  );
  const nativeP2pPort = validateNonPrivilegedPort(
    options.nativeP2pPort ?? DEFAULT_NATIVE_P2P_PORT,
    "Native REGTEST P2P port",
  );
  if (nativeRpcPort === nativeP2pPort) {
    throw new Error("Native REGTEST RPC and P2P ports must be distinct");
  }

  const solanaRpcPort = validateNonPrivilegedPort(
    options.solanaRpcPort ?? DEFAULT_SOLANA_RPC_PORT,
    "Solana local-validator RPC port",
  );
  const solanaFaucetPort = validateNonPrivilegedPort(
    options.solanaFaucetPort ?? DEFAULT_SOLANA_FAUCET_PORT,
    "Solana local-validator faucet port",
  );
  if (solanaRpcPort === solanaFaucetPort) {
    throw new Error("Solana local-validator RPC and faucet ports must be distinct");
  }

  const programIds = readLocalnetProgramIds(repoRoot);
  const paths = Object.freeze({
    nativeDatadir: path.join(runRoot, "native-regtest"),
    solanaLedger: path.join(runRoot, "solana-ledger"),
    sbfOutDir: path.join(runRoot, "sbf-output"),
    cargoTargetDir,
    bridgeProgramSo: path.join(runRoot, "sbf-output", "kingpepe_bridge.so"),
    transceiverProgramSo: path.join(
      runRoot,
      "sbf-output",
      "kingpepe_transceiver.so",
    ),
  });
  validatePathOutsideRepo(paths.nativeDatadir, repoRoot, "Native REGTEST datadir");
  validatePathOutsideRepo(paths.solanaLedger, repoRoot, "Solana local-validator ledger");

  const readiness =
    options.readiness ??
    evaluateLocalE2eReadiness({
      repoRoot,
      envPath: options.envPath ?? process.env.PATH ?? "",
      platform: options.platform ?? process.platform,
      pathExt: options.pathExt ?? process.env.PATHEXT,
    });
  const blockers = [...readiness.blockers];

  return Object.freeze({
    protocol: LOCAL_E2E_ORCHESTRATOR_PROTOCOL,
    state: blockers.length === 0 ? READY_TO_RUN_LOCAL_E2E : BLOCKED_LOCAL_E2E,
    productionReady: false,
    mainnetActivation: "DISABLED",
    requiredKingPepeRegtestVersion: REQUIRED_KINGPEPE_REGTEST_VERSION,
    repoRoot,
    runRoot,
    readiness,
    blockers,
    programIds,
    ports: Object.freeze({
      nativeRpcPort,
      nativeP2pPort,
      solanaRpcPort,
      solanaFaucetPort,
    }),
    paths,
    commands: Object.freeze([
      // Separate builds keep the bridge's no-entrypoint dependency feature
      // from disabling the transceiver's standalone entrypoint.
      ...["kingpepe-transceiver", "kingpepe-bridge"].map((program) => Object.freeze({
        step: `BUILD_SBF_${program.replaceAll("-", "_").toUpperCase()}`,
        executable: "cargo-build-sbf",
        cwd: path.join(repoRoot, "solana"),
        args: Object.freeze([
          "--manifest-path", path.join(repoRoot, "solana", "programs", program, "Cargo.toml"),
          "--sbf-out-dir", paths.sbfOutDir,
          "--tools-version", REQUIRED_SBF_TOOLS_VERSION,
          "--", "--locked", "--jobs", "2", "--target-dir", path.join(paths.cargoTargetDir, program),
        ]),
      })),
      Object.freeze({
        step: "START_SOLANA_LOCAL_VALIDATOR",
        executable: "solana-test-validator",
        cwd: repoRoot,
        args: buildSolanaValidatorArguments({
          ledgerDir: paths.solanaLedger,
          bridgeProgramId: programIds.kingpepeBridge,
          bridgeProgramSo: paths.bridgeProgramSo,
          transceiverProgramId: programIds.kingpepeTransceiver,
          transceiverProgramSo: paths.transceiverProgramSo,
          rpcPort: solanaRpcPort,
          faucetPort: solanaFaucetPort,
        }),
      }),
      Object.freeze({
        step: "START_KINGPEPE_REGTEST",
        executable: "kingpeped",
        cwd: repoRoot,
        args: buildRegtestDaemonArguments({
          datadir: paths.nativeDatadir,
          rpcPort: nativeRpcPort,
          p2pPort: nativeP2pPort,
        }),
      }),
    ]),
    nativeCliTemplates: Object.freeze({
      stop: buildRegtestCliArguments({
        datadir: paths.nativeDatadir,
        rpcPort: nativeRpcPort,
        command: "stop",
      }),
      chainInfo: buildRegtestCliArguments({
        datadir: paths.nativeDatadir,
        rpcPort: nativeRpcPort,
        command: "getblockchaininfo",
      }),
    }),
    safetyAssertions: Object.freeze([
      "LOCAL_ONLY",
      "NO_PRODUCTION_SECRETS",
      "MAINNET_ACTIVATION_DISABLED",
      "NO_PER_TRANSFER_KINGPEPE_TEAM_APPROVAL",
      "COOKIE_AUTH_OR_LOCAL_TEST_AUTH_ONLY",
      "RUNTIME_STATE_OUTSIDE_REPOSITORY",
    ]),
  });
}

export function buildRegtestDaemonArguments({ datadir, rpcPort, p2pPort }) {
  const normalizedDatadir = validateAbsolutePath(datadir, "Native REGTEST datadir");
  return Object.freeze([
    "-regtest=1",
    `-datadir=${normalizedDatadir}`,
    "-server=1",
    "-listen=0",
    "-connect=0",
    "-dnsseed=0",
    "-txindex=1",
    "-fallbackfee=0.00001000",
    `-rpcport=${validateNonPrivilegedPort(rpcPort, "Native REGTEST RPC port")}`,
    "-rpcbind=127.0.0.1",
    "-rpcallowip=127.0.0.1",
    `-port=${validateNonPrivilegedPort(p2pPort, "Native REGTEST P2P port")}`,
  ]);
}

export function buildRegtestCliArguments({
  datadir,
  rpcPort,
  command,
  parameters = [],
  wallet,
}) {
  const normalizedDatadir = validateAbsolutePath(datadir, "Native REGTEST datadir");
  if (!ALLOWED_REGTEST_CLI_COMMANDS.has(command)) {
    throw new Error("Native REGTEST CLI command is not allowlisted");
  }
  if (!Array.isArray(parameters) || parameters.some((entry) => typeof entry !== "string")) {
    throw new Error("Native REGTEST CLI parameters must be strings");
  }
  if (wallet !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/u.test(wallet)) {
    throw new Error("Native REGTEST wallet name is invalid");
  }
  return Object.freeze([
    "-regtest=1",
    `-datadir=${normalizedDatadir}`,
    `-rpcport=${validateNonPrivilegedPort(rpcPort, "Native REGTEST RPC port")}`,
    ...(wallet === undefined ? [] : [`-rpcwallet=${wallet}`]),
    command,
    ...parameters,
  ]);
}

export function buildSolanaValidatorArguments({
  ledgerDir,
  bridgeProgramId,
  bridgeProgramSo,
  transceiverProgramId,
  transceiverProgramSo,
  rpcPort = DEFAULT_SOLANA_RPC_PORT,
  faucetPort = DEFAULT_SOLANA_FAUCET_PORT,
}) {
  const normalizedLedger = validateAbsolutePath(ledgerDir, "Solana local-validator ledger");
  const bridgeSo = validateAbsolutePath(bridgeProgramSo, "Bridge program shared object");
  const transceiverSo = validateAbsolutePath(
    transceiverProgramSo,
    "Transceiver program shared object",
  );
  validateSolanaProgramId(bridgeProgramId, "Bridge Program ID");
  validateSolanaProgramId(transceiverProgramId, "Transceiver Program ID");
  return Object.freeze([
    "--ledger",
    normalizedLedger,
    "--bind-address",
    "127.0.0.1",
    "--rpc-port",
    String(validateNonPrivilegedPort(rpcPort, "Solana local-validator RPC port")),
    "--faucet-port",
    String(validateNonPrivilegedPort(faucetPort, "Solana local-validator faucet port")),
    "--bpf-program",
    bridgeProgramId,
    bridgeSo,
    "--bpf-program",
    transceiverProgramId,
    transceiverSo,
  ]);
}

export function readLocalnetProgramIds(repoRoot) {
  const anchorToml = path.join(path.resolve(repoRoot), "solana", "Anchor.toml");
  if (!existsSync(anchorToml)) {
    throw new Error("Solana Anchor.toml is missing");
  }
  const config = readFileSync(anchorToml, "utf8");
  const bridge = readTomlString(config, "kingpepe_bridge");
  const transceiver = readTomlString(config, "kingpepe_transceiver");
  validateSolanaProgramId(bridge, "Bridge Program ID");
  validateSolanaProgramId(transceiver, "Transceiver Program ID");
  return Object.freeze({
    kingpepeBridge: bridge,
    kingpepeTransceiver: transceiver,
  });
}

export function validateLocalE2eRunRoot(runRoot, repoRoot) {
  const normalized = validateAbsolutePath(runRoot, "Local E2E run root");
  validatePathOutsideRepo(resolveExistingParents(normalized), resolveExistingParents(repoRoot), "Local E2E run root");
  if (normalized === path.parse(normalized).root || normalized === path.resolve(os.homedir())) {
    throw new Error("Local E2E run root must be a dedicated directory");
  }
  return normalized;
}

export function initializeLocalE2eRunRoot(plan) {
  validateLocalE2eRunRoot(plan.runRoot, plan.repoRoot);
  // Existing state must be inspected explicitly; never reset it for a new run.
  mkdirSync(plan.runRoot, { mode: 0o700 });
  for (const directory of [plan.paths.nativeDatadir, plan.paths.sbfOutDir]) {
    mkdirSync(directory, { mode: 0o700 });
  }
  validateLocalE2eRunRoot(plan.paths.cargoTargetDir, plan.repoRoot);
  mkdirSync(plan.paths.cargoTargetDir, { recursive: true, mode: 0o700 });
}

export function validateNonPrivilegedPort(value, label) {
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${label} must be a non-privileged TCP port`);
  }
  return value;
}

export function sanitizePlanForReport(plan) {
  return deepSanitize(plan, [
    [plan.repoRoot, "${REPO_ROOT}"],
    [plan.runRoot, "${LOCAL_E2E_RUN_ROOT}"],
    [plan.paths.cargoTargetDir, "${LOCAL_E2E_BUILD_ROOT}"],
    ...plan.readiness.requiredExecutables
      .filter((entry) => entry.path !== undefined)
      .map((entry) => [entry.path, `\${LOCAL_E2E_BIN}/${entry.command}`]),
  ]);
}

function validateAbsolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function validatePathOutsideRepo(value, repoRoot, label) {
  if (isSameOrInside(path.resolve(repoRoot), path.resolve(value)) ||
      isSameOrInside(path.resolve(value), path.resolve(repoRoot))) {
    throw new Error(`${label} must be outside the source repository`);
  }
}

function resolveExistingParents(value) {
  const absolute = path.resolve(value);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = path.dirname(absolute);
  if (parent === absolute) throw new Error("Local E2E path cannot be resolved");
  return path.join(resolveExistingParents(parent), path.basename(absolute));
}

function isSameOrInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateSolanaProgramId(value, label) {
  if (typeof value !== "string" || !PROGRAM_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a Solana base58 public key`);
  }
}

function readTomlString(config, key) {
  const escapedKey = key.replaceAll("_", "[_]");
  const match = new RegExp(`^\\s*${escapedKey}\\s*=\\s*"([^"]+)"\\s*$`, "mu").exec(config);
  if (match === null) throw new Error(`missing localnet Program ID for ${key}`);
  return match[1];
}

function deepSanitize(value, replacements) {
  if (typeof value === "string") {
    return replacements.reduce(
      (current, [prefix, replacement]) => replacePathPrefixOccurrences(current, prefix, replacement),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((entry) => deepSanitize(entry, replacements));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepSanitize(entry, replacements)]),
    );
  }
  return value;
}

function replacePathPrefixOccurrences(value, prefix, replacement) {
  const normalizedPrefix = path.resolve(prefix);
  const variants = new Set([
    normalizedPrefix,
    normalizedPrefix.split(path.sep).join("/"),
    normalizedPrefix.split(path.sep).join("\\"),
  ]);
  let output = value;
  for (const variant of variants) {
    output = output.replaceAll(variant, replacement);
  }
  return output;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const command = process.argv[2] ?? "plan";
  if (command !== "plan" && command !== "doctor") {
    process.stderr.write("usage: node scripts/local-e2e-orchestrator.mjs [plan|doctor]\n");
    process.exitCode = 64;
  } else {
    const plan = createLocalE2ePlan({
      repoRoot: path.resolve(process.argv[3] ?? process.cwd()),
      runRoot: process.env.KINGPEPE_LOCAL_E2E_ROOT,
    });
    process.stdout.write(`${JSON.stringify(sanitizePlanForReport(plan), null, 2)}\n`);
    process.exitCode = plan.state === READY_TO_RUN_LOCAL_E2E ? 0 : 2;
  }
}
