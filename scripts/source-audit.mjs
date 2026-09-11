// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Repository boundary/provenance coverage, not an external legal/security audit.
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROVENANCE_CLASSES = Object.freeze([
  "ORIGINAL_KINGPEPE_CODE", "ORIGINAL_KINGPEPE_DOCUMENTATION", "THIRD_PARTY_CODE",
  "DERIVED_FROM_THIRD_PARTY", "GENERATED_FILE", "BUILD_OR_CONFIGURATION_METADATA",
]);

export function checkProvenance(paths, provenance) {
  if (!Array.isArray(provenance?.trackedFiles)) throw new Error("PROVENANCE_FILE_LIST_REQUIRED");
  const entries = new Map();
  for (const entry of provenance.trackedFiles) {
    if (typeof entry.path !== "string" || entries.has(entry.path) || !PROVENANCE_CLASSES.includes(entry.classification)
      || typeof entry.notes !== "string" || entry.notes.trim().length === 0) throw new Error("PROVENANCE_ENTRY_INVALID");
    entries.set(entry.path, entry);
  }
  if (new Set(paths).size !== paths.length || paths.length !== entries.size || paths.some(p => !entries.has(p))) {
    throw new Error("PROVENANCE_COVERAGE_MISMATCH");
  }
  return Object.fromEntries(PROVENANCE_CLASSES.map(c => [c, [...entries.values()].filter(e => e.classification === c).length]));
}

export function publicationRisks(name, content) {
  const findings = [];
  if (/(^|\/)(\.env(?:\..*)?|wallet\.dat|\.cookie|frost-signer-state\.json)$|(-keypair\.json|\.(?:db|sqlite3?|log|pem|p12|pfx|key|dump|protected))$/iu.test(name)) findings.push("OPERATIONAL_FILE");
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/u.test(content)) findings.push("PRIVATE_KEY_MATERIAL");
  if (/(?:[a-z]+:\/\/)[^\s/"']+:[^\s/@"']+@/iu.test(content)) findings.push("URL_CREDENTIALS");
  if (/[A-Z]:[\\/]+Users[\\/]+(?!\$\{|<)[a-z0-9_.-]+/iu.test(content)) findings.push("PRIVATE_USER_PATH");
  if (/[A-Z]:[\\/]+KingPepe[\\/]+FROST_[AB](?:[\\/]|["'])/iu.test(content)) findings.push("PRIVATE_SIGNER_PATH");
  if (/(?:^|[^\d.])(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?:$|[^\d.])/u.test(content)) findings.push("PRIVATE_NETWORK_ADDRESS");
  if (name.endsWith(".json")) {
    const value = JSON.parse(content);
    if (Array.isArray(value) && [32, 64].includes(value.length) && value.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) findings.push("RAW_KEY_ARRAY");
  }
  return findings;
}

export function auditSource(root = path.resolve(import.meta.dirname, "..")) {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  const provenance = JSON.parse(readFileSync(path.join(root, "PROVENANCE.json"), "utf8"));
  const classifications = checkProvenance(paths, provenance);
  const findings = [];
  for (const name of paths) {
    const absolute = path.resolve(root, name);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("SOURCE_PATH_OUTSIDE_ROOT");
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4_000_000) throw new Error("SOURCE_FILE_BOUNDARY_INVALID");
    const content = readFileSync(absolute, "utf8");
    for (const code of publicationRisks(name, content)) findings.push({ path: name, code });
  }
  if (findings.length) return { status: "FAIL", findings };
  return { status: "PASS", files: paths.length, classifications,
    scope: "Exact provenance coverage and selected publication boundaries; Gitleaks/history review and file-by-file provenance judgment remain separate." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = auditSource();
    console.log(JSON.stringify(result));
    if (result.status !== "PASS") process.exitCode = 1;
  } catch (error) {
    console.error(/^[A-Z_]+$/u.test(error.message) ? error.message : "SOURCE_AUDIT_FAILED");
    process.exitCode = 1;
  }
}
