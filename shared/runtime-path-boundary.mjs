import { lstatSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The caller cannot disable protection of this actual source checkout by
// omitting or substituting repoRoot. A supplied root adds another boundary.
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function isSameOrInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function resolveExistingParents(value) {
  let current = absolutePath(value);
  const missing = [];
  while (true) {
    try {
      return path.join(realpathSync(current), ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("RuntimePathResolutionFailed");
      // A dangling link must not be mistaken for a new directory.
      if (statEntry(current)?.isSymbolicLink()) throw new Error("RuntimePathLinkRejected");
      const parent = path.dirname(current);
      if (parent === current) throw new Error("RuntimePathResolutionFailed");
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export function validateRuntimeStateRoot(root, repoRoot = undefined, label = "Runtime state root") {
  const candidate = absolutePath(root);
  const protectedRoots = [SOURCE_ROOT, ...(repoRoot === undefined ? [] : [absolutePath(repoRoot)])];
  const resolved = resolveExistingParents(candidate);
  for (const protectedRoot of protectedRoots) {
    const source = resolveExistingParents(protectedRoot);
    if (isSameOrInside(source, resolved) || isSameOrInside(resolved, source) ||
        hasAncestorIdentity(resolved, source) || hasAncestorIdentity(source, resolved)) {
      throw new Error(`${label}:InsideRepositoryRejected; must be outside the source repository`);
    }
  }
  if ([path.parse(candidate).root, path.resolve(os.homedir()), path.resolve(os.tmpdir())]
    .some(broadRoot => sameDirectory(candidate, broadRoot))) {
    throw new Error(`${label}:DedicatedDirectoryRequired`);
  }
  rejectLinkedComponents(candidate);
  const entry = statEntry(candidate);
  if (entry !== undefined && !entry.isDirectory()) throw new Error(`${label}:DirectoryRequired`);
  return candidate;
}

export function validateRuntimeFile(file, repoRoot = undefined, label = "Runtime state file") {
  const candidate = absolutePath(file);
  const parent = validateRuntimeStateRoot(path.dirname(candidate), repoRoot, label);
  if (!statEntry(parent)?.isDirectory()) throw new Error(`${label}:ParentDirectoryMissing`);
  const entry = statEntry(candidate);
  if (entry !== undefined && (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1n)) {
    throw new Error(`${label}:LinkedOrNonRegularFileRejected`);
  }
  return candidate;
}

function absolutePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32767 ||
      /[\x00-\x1f]/u.test(value) || !path.isAbsolute(value)) {
    throw new Error("RuntimePathAbsoluteRequired");
  }
  // UNC/device namespaces and Windows alternate streams are not local state roots.
  if (/^[\\/]{2}/u.test(value) || (process.platform === "win32" &&
      (!/^[a-z]:[\\/]/iu.test(value) ||
       value.slice(path.parse(value).root.length).split(/[\\/]/u).some(part =>
         /[:<>"|?*]/u.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part) ||
         (part !== "." && part !== ".." && /[ .]$/u.test(part)))))) {
    throw new Error("RuntimePathNamespaceRejected");
  }
  return path.resolve(value);
}

function statEntry(value) {
  try { return lstatSync(value, { bigint: true }); }
  catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error("RuntimePathInspectionFailed");
  }
}

function rejectLinkedComponents(value) {
  let current = value;
  while (true) {
    const entry = statEntry(current);
    if (entry?.isSymbolicLink()) throw new Error("RuntimePathLinkRejected");
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function sameDirectory(left, right) {
  if (path.relative(left, right) === "") return true;
  const a = statEntry(left);
  const b = statEntry(right);
  return a?.isDirectory() && b?.isDirectory() && a.ino !== 0n && a.ino === b.ino && a.dev === b.dev;
}

function hasAncestorIdentity(candidate, ancestor) {
  let target;
  try { target = statSync(ancestor, { bigint: true }); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error("RuntimePathInspectionFailed");
  }
  if (!target.isDirectory() || target.ino === 0n) return false;
  let current = candidate;
  while (true) {
    const entry = statEntry(current);
    // Also detects case aliases on case-insensitive mounted filesystems where
    // the platform's lexical path implementation itself is case-sensitive.
    if (entry !== undefined && entry.ino === target.ino && entry.dev === target.dev) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
