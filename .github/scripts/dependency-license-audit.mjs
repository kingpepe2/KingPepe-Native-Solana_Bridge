// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Declared-license metadata gate, not an independent legal or source audit.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifests = ["solana", "native/proof", "native/reserve", "native/recovery"];
// Exact expressions reviewed in the locked graph. A new expression requires review.
const reviewedExpressions = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
  "MIT OR Apache-2.0", "Apache-2.0 OR MIT", "MIT/Apache-2.0",
  "Unlicense OR MIT", "Zlib OR Apache-2.0 OR MIT",
  "MIT OR Apache-2.0 OR Zlib", "MIT OR Apache-2.0 OR BSD-1-Clause",
  "BSD-3-Clause OR MIT OR Apache-2.0", "CC0-1.0 OR MIT-0 OR Apache-2.0",
  "CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception",
  "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT",
  "(MIT OR Apache-2.0) AND Unicode-3.0",
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

export function inspectCargoMetadata(metadata, root) {
  requireCondition(Array.isArray(metadata.packages) && metadata.packages.length > 0, "EMPTY_CARGO_METADATA");
  const summary = { originalPackages: 0, dependencyPackages: 0, expressions: new Set() };
  for (const pkg of metadata.packages) {
    if (pkg.source === null) {
      const manifest = path.resolve(pkg.manifest_path);
      const relative = path.relative(root, manifest);
      requireCondition(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "LOCAL_PACKAGE_OUTSIDE_SOURCE");
      requireCondition(Array.isArray(pkg.publish) && pkg.publish.length === 0, "LOCAL_PACKAGE_PUBLICATION_ENABLED");
      requireCondition(pkg.license === null && typeof pkg.license_file === "string", "LOCAL_PROPRIETARY_LICENSE_MISSING");
      requireCondition(path.resolve(path.dirname(manifest), pkg.license_file) === path.resolve(root, "LICENSE"), "LOCAL_LICENSE_SUBSTITUTION");
      summary.originalPackages += 1;
    } else {
      requireCondition(pkg.source === "registry+https://github.com/rust-lang/crates.io-index", "UNREVIEWED_DEPENDENCY_SOURCE");
      requireCondition(reviewedExpressions.has(pkg.license), "UNREVIEWED_DEPENDENCY_LICENSE");
      summary.expressions.add(pkg.license);
      summary.dependencyPackages += 1;
    }
  }
  return { ...summary, expressions: [...summary.expressions].sort() };
}

export function inspectNpmPackage(locked, installed) {
  requireCondition(locked.version === installed.version, "NPM_VERSION_MISMATCH");
  requireCondition(locked.license === installed.license && reviewedExpressions.has(installed.license), "NPM_LICENSE_UNREVIEWED_OR_MISMATCHED");
  requireCondition(typeof locked.resolved === "string" && locked.resolved.startsWith("https://registry.npmjs.org/"), "NPM_SOURCE_UNREVIEWED");
  requireCondition(/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(locked.integrity ?? ""), "NPM_INTEGRITY_MISSING");
}

export function runLicenseAudit() {
  const licenseText = readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
  requireCondition(licenseText.includes("Copyright (c) 2026 KingPepe Team.") && licenseText.includes("All Rights Reserved."), "PROPRIETARY_LICENSE_TEXT_MISSING");
  const cargo = [];
  for (const directory of manifests) {
    // Captured stderr is never echoed: it may include private cache paths.
    let output;
    try {
      output = execFileSync("cargo", ["metadata", "--locked", "--format-version", "1"], {
        cwd: path.join(repoRoot, directory), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"], timeout: 300_000,
      });
    } catch {
      throw new Error("CARGO_METADATA_UNAVAILABLE");
    }
    cargo.push({ manifest: `${directory}/Cargo.toml`, ...inspectCargoMetadata(JSON.parse(output), repoRoot) });
  }
  const packageInfo = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  requireCondition(packageInfo.private === true && packageInfo.license === "UNLICENSED", "NPM_PROPRIETARY_BOUNDARY_MISSING");
  const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  requireCondition(lock.lockfileVersion === 3, "NPM_LOCK_VERSION_UNSUPPORTED");
  let npmDependencies = 0;
  for (const [directory, pkg] of Object.entries(lock.packages)) {
    if (directory === "") continue;
    requireCondition(directory.startsWith("node_modules/") && !directory.split(/[\\/]/u).includes(".."), "NPM_PATH_INVALID");
    const installed = JSON.parse(readFileSync(path.join(repoRoot, directory, "package.json"), "utf8"));
    inspectNpmPackage(pkg, installed);
    npmDependencies += 1;
  }
  return { status: "PASS_DECLARED_LICENSE_METADATA", cargo, npmDependencies,
    scope: "Locked metadata and proprietary package boundary; not bundled-artifact notice verification or external legal review." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(runLicenseAudit()));
  } catch (error) {
    // Only our fixed symbolic codes may leave the process; never a path/content dump.
    console.error(/^[A-Z_]+$/u.test(error.message) ? error.message : "LICENSE_AUDIT_FAILED");
    process.exitCode = 1;
  }
}
