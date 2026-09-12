import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FileBackedFrostStateStore, initialSignerState } from "../../native/frost/state/file-state-store.mjs";
import { REQUIRED_FROST_SIGNERS } from "../../native/frost/policy/native-signing-policy.mjs";
import { readAuthorizationHeaderFromCookieFile } from "../../native/node/native-rpc-client.mjs";
import { FileBackedDepositJournal } from "../../services/bridge-validator/automatic-deposit-pipeline.mjs";
import { FileBackedNativeReserveSweepJournal } from "../../services/bridge-validator/native-reserve-sweep-adapters.mjs";
import { FileBackedSolanaDepositClaimJournal } from "../../services/bridge-validator/solana-deposit-claim-submitter.mjs";
import { isSameOrInside, resolveExistingParents, validateRuntimeFile, validateRuntimeStateRoot } from "../../shared/runtime-path-boundary.mjs";
import { createNativeToSolanaFlowConfig } from "../local-e2e-native-to-solana.mjs";
import { validateLocalE2eRunRoot } from "../local-e2e-orchestrator.mjs";

const SOURCE_ROOT = path.resolve(import.meta.dirname, "../..");
const OPERATION_ID = "01".repeat(32); // Public parser fixture, not a signing identity.
const STORE_TYPES = [
  {
    name: "FROST", open: options => new FileBackedFrostStateStore({ ...options, signerId: REQUIRED_FROST_SIGNERS[0] }),
    read: store => store.load(), filename: "frost-signer-state.json",
  },
  ...[
    ["deposit", FileBackedDepositJournal],
    ["Native sweep", FileBackedNativeReserveSweepJournal],
    ["Solana claim", FileBackedSolanaDepositClaimJournal],
  ].map(([name, Store]) => ({ name, open: options => new Store(options), read: store => store.get(OPERATION_ID), filename: `${OPERATION_ID}.json` })),
];

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "kingpepe-path-boundary-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  t.after(() => {
    // Only remove this test's fresh, non-linked directory; never the checkout.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("kingpepe-path-boundary-"));
    assert(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
    rmSync(root, { recursive: true, force: true });
  });
  return { root, repo };
}

function linkDirectory(target, alias) {
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
}

test("path containment treats ..name as a child, not a parent traversal", t => {
  const { root, repo } = fixture(t);
  assert.equal(isSameOrInside(repo, repo), true);
  assert.equal(isSameOrInside(repo, path.join(repo, "..runtime")), true);
  assert.equal(isSameOrInside(repo, root), false);
  assert.equal(isSameOrInside(repo, path.join(root, "repo-sibling")), false);
  assert.equal(isSameOrInside(repo, path.join(repo, "..", "runtime")), false);
  assert.throws(() => validateRuntimeStateRoot(path.join(repo, "..runtime"), repo), /InsideRepositoryRejected/u);
  assert.throws(() => validateLocalE2eRunRoot(path.join(repo, "..runtime"), repo), /InsideRepositoryRejected/u);
  assert(!existsSync(path.join(repo, "..runtime")));
});

test("actual source protection cannot be disabled by omitting or substituting a root", t => {
  const { repo } = fixture(t);
  for (const supplied of [undefined, repo]) {
    // Read-only probes: no file or directory is created in the actual source.
    assert.throws(() => validateRuntimeStateRoot(SOURCE_ROOT, supplied), /InsideRepositoryRejected/u);
    assert.throws(() => validateRuntimeStateRoot(path.join(SOURCE_ROOT, "..runtime-probe"), supplied), /InsideRepositoryRejected/u);
    assert.throws(() => validateRuntimeFile(path.join(SOURCE_ROOT, "README.md"), supplied), /InsideRepositoryRejected/u);
  }
});

test("runtime roots reject ancestors and broad roots but permit dedicated siblings", t => {
  const { root, repo } = fixture(t);
  for (const broad of [root, repo, path.parse(root).root, os.tmpdir(), os.homedir()]) {
    assert.throws(() => validateRuntimeStateRoot(broad, repo), /InsideRepositoryRejected|DedicatedDirectoryRequired/u);
  }
  const outside = path.join(root, "repo-sibling", "new", "state");
  // Windows TEMP may use an 8.3 alias. The boundary returns the physical
  // spelling without creating the missing suffix or accepting a junction.
  const physical = path.join(realpathSync.native(root), "repo-sibling", "new", "state");
  assert.equal(validateRuntimeStateRoot(outside, repo), physical);
  assert.equal(resolveExistingParents(outside), physical);
  assert(!existsSync(outside));
});

test("raw runtime paths reject relative, control-character and device namespace inputs", t => {
  const { root, repo } = fixture(t);
  for (const value of [undefined, null, 42, "", "relative", "..", root + "\nchild", root + "\0child", "x".repeat(32768)]) {
    assert.throws(() => validateRuntimeStateRoot(value, repo), /RuntimePathAbsoluteRequired/u);
  }
  for (const value of ["//server/share/state", "\\\\server\\share\\state", "\\\\?\\C:\\state"]) {
    assert.throws(() => validateRuntimeStateRoot(value, repo), /RuntimePathAbsoluteRequired|RuntimePathNamespaceRejected/u);
  }
  if (process.platform === "win32") {
    for (const leaf of ["stream:alternate", "trailing.", "trailing ", "NUL", "CON.txt", "COM1", "LPT².txt", "wild*card", "bad?name"]) {
      assert.throws(() => validateRuntimeStateRoot(path.join(root, leaf), repo), /RuntimePathNamespaceRejected/u);
    }
    assert.throws(() => validateRuntimeStateRoot("\\drive-relative", repo), /RuntimePathNamespaceRejected/u);
  } else {
    // Colons and these ordinary basenames are not Windows streams/devices here.
    assert.equal(validateRuntimeStateRoot(path.join(root, "stream:ordinary"), repo), path.join(root, "stream:ordinary"));
  }
});

test("resolved roots reject linked ancestors and dangling links even outside source", t => {
  const { root, repo } = fixture(t);
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  const alias = path.join(root, "outside-alias");
  linkDirectory(outside, alias);
  for (const value of [alias, path.join(alias, "new", "child")]) {
    assert.throws(() => validateRuntimeStateRoot(value, repo), /RuntimePathLinkRejected/u);
  }
  const dangling = path.join(root, "dangling");
  linkDirectory(path.join(root, "absent-target"), dangling);
  assert.throws(() => validateRuntimeStateRoot(path.join(dangling, "state"), repo), /RuntimePathLinkRejected/u);
  assert(!existsSync(path.join(root, "absent-target")));
});

test("filesystem identity detects source case aliases on case-insensitive mounts", () => {
  const alias = path.join(path.dirname(SOURCE_ROOT), path.basename(SOURCE_ROOT).toUpperCase());
  const original = statSync(SOURCE_ROOT, { bigint: true });
  const same = existsSync(alias) && statSync(alias, { bigint: true }).ino === original.ino &&
    statSync(alias, { bigint: true }).dev === original.dev;
  const candidate = path.join(alias, "..runtime-probe");
  if (same) assert.throws(() => validateRuntimeStateRoot(candidate), /InsideRepositoryRejected/u);
  else assert.equal(validateRuntimeStateRoot(candidate), candidate);
});

test("runtime files require existing dedicated directories and single-link regular files", t => {
  const { root, repo } = fixture(t);
  const state = path.join(root, "state");
  assert.throws(() => validateRuntimeFile(path.join(state, "entry.json"), repo), /ParentDirectoryMissing/u);
  mkdirSync(state);
  const file = path.join(state, "entry.json");
  assert.equal(validateRuntimeFile(file, repo), file);
  writeFileSync(file, "public marker", { flag: "wx" });
  assert.equal(validateRuntimeFile(file, repo), file);
  assert.throws(() => validateRuntimeStateRoot(file, repo), /DirectoryRequired/u);
  const directoryLeaf = path.join(state, "directory");
  mkdirSync(directoryLeaf);
  assert.throws(() => validateRuntimeFile(directoryLeaf, repo), /LinkedOrNonRegularFileRejected/u);
  const hardLink = path.join(state, "alias.json");
  linkSync(file, hardLink);
  assert.throws(() => validateRuntimeFile(file, repo), /LinkedOrNonRegularFileRejected/u);
  assert.throws(() => validateRuntimeFile(hardLink, repo), /LinkedOrNonRegularFileRejected/u);
});

for (const spec of STORE_TYPES) {
  test(`${spec.name} store protects the actual checkout without trusting caller repoRoot`, t => {
    const { repo } = fixture(t);
    for (const supplied of [undefined, repo]) {
      // The actual root already exists: a defective constructor still must not
      // generate state here. This test never calls a write or signing operation.
      assert.throws(() => spec.open({ root: SOURCE_ROOT, repoRoot: supplied }), /InsideRepositoryRejected/u);
    }
  });

  test(`${spec.name} store rejects source junctions before creating runtime files`, t => {
    const { root, repo } = fixture(t);
    const alias = path.join(root, "alias");
    linkDirectory(repo, alias);
    assert.throws(() => spec.open({ root: path.join(alias, "state"), repoRoot: repo }), /InsideRepositoryRejected/u);
    assert.throws(() => spec.open({ root: path.join(repo, "..state"), repoRoot: repo }), /InsideRepositoryRejected/u);
    assert.deepEqual(readdirSync(repo), []);
  });

  test(`${spec.name} store distinguishes absent external signer state from an empty operation journal`, t => {
    const { root, repo } = fixture(t);
    const state = path.join(root, "state");
    const store = spec.open({ root: state, repoRoot: repo });
    if (spec.name === "FROST") {
      assert.throws(() => spec.read(store), /FrostStateMissing/u);
      assert.throws(() => store.save(initialSignerState(REQUIRED_FROST_SIGNERS[0])), /FrostStateMissing/u);
      assert.deepEqual(readdirSync(state), []);
    } else {
      assert.equal(spec.read(store), undefined);
    }
    assert.deepEqual(readdirSync(repo), []);
  });

  test(`${spec.name} store does not silently recreate a disappeared state directory`, t => {
    const { root, repo } = fixture(t);
    const state = path.join(root, "state");
    const store = spec.open({ root: state, repoRoot: repo });
    rmdirSync(state); // Fresh, empty test directory only.
    assert.throws(() => spec.read(store), /ParentDirectoryMissing/u);
    if (spec.name === "FROST") assert.throws(() => store.save(initialSignerState(REQUIRED_FROST_SIGNERS[0])), /ParentDirectoryMissing/u);
    assert(!existsSync(state));
  });

  test(`${spec.name} store rechecks a directory replaced with a source junction`, t => {
    const { root, repo } = fixture(t);
    const state = path.join(root, "state");
    const store = spec.open({ root: state, repoRoot: repo });
    rmdirSync(state);
    linkDirectory(repo, state);
    assert.throws(() => spec.read(store), /InsideRepositoryRejected/u);
    if (spec.name === "FROST") assert.throws(() => store.save(initialSignerState(REQUIRED_FROST_SIGNERS[0])), /InsideRepositoryRejected/u);
    assert.deepEqual(readdirSync(repo), []);
  });

  test(`${spec.name} store rejects a hard-linked leaf before reading its contents`, t => {
    const { root, repo } = fixture(t);
    const state = path.join(root, "state");
    const store = spec.open({ root: state, repoRoot: repo });
    const marker = path.join(repo, "public-marker.txt");
    writeFileSync(marker, "public marker, deliberately not JSON", { flag: "wx" });
    linkSync(marker, path.join(state, spec.filename));
    assert.throws(() => spec.read(store), /LinkedOrNonRegularFileRejected/u);
    if (spec.name === "FROST") assert.throws(() => store.save(initialSignerState(REQUIRED_FROST_SIGNERS[0])), /LinkedOrNonRegularFileRejected/u);
    assert.equal(readFileSync(marker, "utf8"), "public marker, deliberately not JSON");
  });

  test(`${spec.name} store rejects a directory or junction substituted for a state file`, t => {
    const { root, repo } = fixture(t);
    const state = path.join(root, "state");
    const store = spec.open({ root: state, repoRoot: repo });
    const leaf = path.join(state, spec.filename);
    mkdirSync(leaf);
    assert.throws(() => spec.read(store), /LinkedOrNonRegularFileRejected/u);
    rmdirSync(leaf);
    linkDirectory(repo, leaf);
    assert.throws(() => spec.read(store), /LinkedOrNonRegularFileRejected/u);
    assert.deepEqual(readdirSync(repo), []);
  });
}

test("deposit outpoint index applies the same non-linked file boundary", t => {
  const { root, repo } = fixture(t);
  const state = path.join(root, "state");
  const store = new FileBackedDepositJournal({ root: state, repoRoot: repo });
  const marker = path.join(repo, "public-marker.txt");
  writeFileSync(marker, "public index marker", { flag: "wx" });
  linkSync(marker, path.join(state, "deposit-outpoints.json"));
  assert.throws(() => store.reserveOperation(OPERATION_ID, `${OPERATION_ID}:0`, "00"), /LinkedOrNonRegularFileRejected/u);
  assert(!existsSync(path.join(state, `${OPERATION_ID}.json`)));
});

test("cookie reader rejects source paths even when repoRoot is absent or substituted", t => {
  const { repo } = fixture(t);
  for (const supplied of [undefined, repo]) {
    assert.throws(() => readAuthorizationHeaderFromCookieFile(path.join(SOURCE_ROOT, "README.md"), supplied), /NativeRpcAuthCookieInsideRepositoryRejected/u);
    assert.throws(() => readAuthorizationHeaderFromCookieFile(path.join(SOURCE_ROOT, "..runtime-probe", ".cookie"), supplied), /NativeRpcAuthCookieInsideRepositoryRejected/u);
  }
});

test("cookie reader accepts an isolated ephemeral fixture without exposing it", t => {
  const { root, repo } = fixture(t);
  const state = path.join(root, "rpc");
  mkdirSync(state);
  const cookie = path.join(state, ".cookie");
  const fixtureValue = `local-test:${randomUUID()}`;
  writeFileSync(cookie, fixtureValue, { flag: "wx", mode: 0o600 });
  assert(readAuthorizationHeaderFromCookieFile(cookie, repo) === `Basic ${Buffer.from(fixtureValue).toString("base64")}`, "Cookie roundtrip failed; fixture redacted");
  assert.equal(readAuthorizationHeaderFromCookieFile(undefined), undefined);
});

test("cookie reader rejects linked parents, hard links and nonregular files", t => {
  const { root, repo } = fixture(t);
  const state = path.join(root, "rpc");
  mkdirSync(state);
  const marker = path.join(state, "public-marker");
  writeFileSync(marker, "public:marker", { flag: "wx" });
  const hardLink = path.join(state, "alias");
  linkSync(marker, hardLink);
  assert.throws(() => readAuthorizationHeaderFromCookieFile(hardLink, repo), /NativeRpcAuthCookiePathRejected/u);
  const directoryLeaf = path.join(state, "directory");
  mkdirSync(directoryLeaf);
  assert.throws(() => readAuthorizationHeaderFromCookieFile(directoryLeaf, repo), /NativeRpcAuthCookiePathRejected/u);
  assert.throws(() => readAuthorizationHeaderFromCookieFile("relative", repo), /NativeRpcAuthCookiePathRejected/u);
  const alias = path.join(root, "rpc-alias");
  linkDirectory(state, alias);
  assert.throws(() => readAuthorizationHeaderFromCookieFile(path.join(alias, "new"), repo), /NativeRpcAuthCookiePathRejected/u);
});

test("local flow configuration rejects linked state and a ..name escape from its run root", t => {
  const { root, repo } = fixture(t);
  const runRoot = path.join(root, "run");
  mkdirSync(runRoot);
  const plan = { runRoot, repoRoot: repo };
  const alias = path.join(runRoot, "alias");
  linkDirectory(repo, alias);
  assert.throws(() => createNativeToSolanaFlowConfig({ plan, stateRoot: path.join(alias, "state") }), /StateRootInsideRepositoryRejected/u);
  const outside = path.join(root, "..run");
  assert.throws(() => createNativeToSolanaFlowConfig({ plan, stateRoot: outside }), /StateRootOutsideRunRootRejected/u);
  assert.throws(() => createNativeToSolanaFlowConfig({ plan, stateRoot: "relative" }), /RuntimePathAbsoluteRequired/u);
  assert.deepEqual(readdirSync(repo), []);
});
