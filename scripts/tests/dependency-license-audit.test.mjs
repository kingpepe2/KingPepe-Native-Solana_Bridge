// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { inspectCargoMetadata, inspectNpmPackage } from "../../.github/scripts/dependency-license-audit.mjs";

test("license audit requires original packages to remain proprietary and unpublished", () => {
  const root = path.resolve("test-source");
  const pkg = { source: null, manifest_path: path.join(root, "native/frost/Cargo.toml"),
    license: null, license_file: "../../LICENSE", publish: [] };
  assert.equal(inspectCargoMetadata({ packages: [pkg] }, root).originalPackages, 1);
  for (const change of [{ publish: null }, { license: "MIT" }, { license_file: "OTHER" },
    { manifest_path: path.resolve(root, "../outside/Cargo.toml") }]) {
    assert.throws(() => inspectCargoMetadata({ packages: [{ ...pkg, ...change }] }, root));
  }
});

test("license audit fails closed for missing licenses and unreviewed dependencies", () => {
  const pkg = { source: "registry+https://github.com/rust-lang/crates.io-index", license: "MIT OR Apache-2.0" };
  assert.equal(inspectCargoMetadata({ packages: [pkg] }, path.resolve("test-source")).dependencyPackages, 1);
  for (const change of [{ license: null }, { license: "LicenseRef-Unreviewed" }, { source: "git+https://example.invalid/code" }]) {
    assert.throws(() => inspectCargoMetadata({ packages: [{ ...pkg, ...change }] }, path.resolve("test-source")));
  }
  assert.throws(() => inspectCargoMetadata({ packages: [] }, path.resolve("test-source")));
});

test("npm license metadata must match installed pinned dependency and registry integrity", () => {
  const locked = { version: "2.3.0", license: "MIT", resolved: "https://registry.npmjs.org/example/-/example-2.3.0.tgz", integrity: "sha512-" + "A".repeat(86) + "==" };
  inspectNpmPackage(locked, { version: "2.3.0", license: "MIT" });
  assert.throws(() => inspectNpmPackage(locked, { version: "2.4.0", license: "MIT" }));
  assert.throws(() => inspectNpmPackage(locked, { version: "2.3.0", license: "LicenseRef-Unreviewed" }));
  for (const change of [{ integrity: undefined }, { resolved: "https://example.invalid/pkg.tgz" }]) {
    assert.throws(() => inspectNpmPackage({ ...locked, ...change }, locked));
  }
});
