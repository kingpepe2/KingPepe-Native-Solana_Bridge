// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { checkProvenance, publicationRisks } from "../source-audit.mjs";

const entry = { path: "example.rs", classification: "ORIGINAL_KINGPEPE_CODE", notes: "Original test fixture classification." };
test("source audit enforces exact provenance coverage and valid unique classifications", () => {
  assert.equal(checkProvenance([entry.path], { trackedFiles: [entry] }).ORIGINAL_KINGPEPE_CODE, 1);
  for (const list of [[], [entry, entry], [{ ...entry, classification: "EXCLUSIVE_UPSTREAM" }], [{ ...entry, notes: "" }]]) {
    assert.throws(() => checkProvenance([entry.path], { trackedFiles: list }), /PROVENANCE_/u);
  }
  assert.throws(() => checkProvenance([entry.path, "unreviewed.rs"], { trackedFiles: [entry] }), /PROVENANCE_COVERAGE_MISMATCH/u);
});
test("source audit rejects operational file names without reading real secret material", () => {
  for (const name of ["wallet.dat", ".env", ".env.private", ".cookie", "a-keypair.json", "signer/frost-signer-state.json", "data.db", "diagnostic.log", "certificate.pfx"]) {
    assert.ok(publicationRisks(name, "{}").includes("OPERATIONAL_FILE"));
  }
});
test("source audit rejects standalone byte key arrays but keeps structured public vectors", () => {
  // Synthetic public zero bytes, never wallet/key generation.
  assert.ok(publicationRisks("unsafe.json", JSON.stringify(Array(64).fill(0))).includes("RAW_KEY_ARRAY"));
  assert.deepEqual(publicationRisks("vectors.json", JSON.stringify({ publicVector: Array(64).fill(0) })), []);
});
test("source audit permits source/templates and no secret-looking diagnostic content", () => {
  assert.deepEqual(publicationRisks("native/frost/state/source.mjs", "export const stateRoot = process.env.FROST_A_STATE_ROOT;"), []);
  assert.deepEqual(publicationRisks("config/example.json", JSON.stringify({ rpc: "${SOLANA_RPC}" })), []);
});
