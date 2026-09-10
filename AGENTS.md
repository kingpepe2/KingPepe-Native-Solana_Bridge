# AGENTS

## Authority and safety boundaries

- Project: KingPepe Native - Solana Bridge; governance: KINGPEPE_TEAM_GOVERNANCE.
- Source repository must remain PRIVATE. Original source is proprietary; retain
  third-party licenses and file-by-file PROVENANCE.json entries.
- Exact software FROST A+B, 2-of-2, on one KingPepe Team-controlled host is the
  approved topology. No second signing computer or 1-of-2 fallback is required.
- Normal valid transfers are automatic after user wallet authorization and
  one-time activation; no per-transfer KingPepe Team approval queue.
- Mainnet activation DISABLED; productionReady=false;
  productionSigningAuthorized=false; productionBroadcastAuthorized=false.
- No production provisioning, service installation, signing, broadcasting,
  deployment or activation without the applicable gates and authorization.
- Legacy recovery material is read-only. Do not import old Git history.
- Keys, nonce/session state, operational databases, logs, deployment identities
  and real machine-specific configuration belong outside the checkout.
- Public README remains minimal. Templates use placeholder references only.
- Review project-role terminology; preserve official Solana account.owner and
  third-party API terminology.
- Preserve unrelated changes. Stage explicit files; scan working/staged files
  and EVERY outgoing commit before pushing. Recheck repository privacy.
- Never weaken a failing security gate or bypass GitHub protections.

## Current phase and evidence

PHASE 08: real local Native-to-Solana happy-path integration is now exercised.
Corrective commit 507c94f39b1f91630baf22824ca4094e3f99d5b6 was pushed to PRIVATE
origin/main and passed all four jobs, including the actual local deposit:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34437591936
It fixed the SBF host-toolchain selection failure on bfc704c561fcf47e9625c7aff6c8bb72b1997ba7.
The current security increment needs its own exact-SHA CI before certification.

A pinned Native REGTEST node accepted real FROST A+B Taproot sweep signatures;
the Agave local validator verified two Ed25519 attestations, created a receipt,
then minted exactly 100000000 atomic units. Finalized reserve and observed SPL
Mint supply matched, without a per-transfer approval. The current local checks
also prove completed-operation retry is idempotent, newly signed reuse of a
consumed outpoint is rejected by validator preflight, and supply stays unchanged.
Permanent backing PDAs omit nonce/epochs. Initial enrollment requires the exact
Mint identity's signature; this is not SPL mint authority or normal approval.

This does NOT prove the complete bridge is finished. Phase 08 security
dependencies still need review: recoverable temporary-deposit scripts and
recovery races, full evidence-source wiring, on-chain Native genesis binding,
failure/restart scenarios and durable storage guarantees. Phase 09 has not
started. Production observers, configuration, review and activation are absent.
Never relabel RPC_OBSERVATION as independent chain validation.

The Node FROST runtime uses pinned @noble/curves schnorr_FROST. The native/frost
Rust crate is supporting policy/state-model code, NOT the Native cryptographic
signer. Ed25519 is only for project attestations.

## Build and test

Use scripts/local-e2e-toolchain.json and docs/deployment/local-e2e-build.md.
Solana host Rust: 1.89.0; Native supporting crates: nightly-2023-10-29.
SBF: pinned Agave 4.2.2, bundled cargo-build-sbf 4.1.0, platform-tools v1.54.
These are direct solana-program crates, not Anchor-generated programs.

Safe checks:
- npm ci --ignore-scripts
- npm test
- npm audit --audit-level=low
- python .github/scripts/guardrails.py
- node .github/scripts/dependency-license-audit.mjs
- In solana/: cargo fmt --check --all
- In solana/: cargo clippy --locked --workspace --all-targets -- -D warnings
- In solana/: cargo test --locked --workspace
- For each native/{frost,proof,reserve,recovery}/Cargo.toml: cargo test --locked
  --manifest-path <manifest>; also run fmt --check and clippy -- -D warnings.
- npm run doctor:local-e2e; npm run local:e2e:native-to-solana
  only with the pinned isolated REGTEST/local-validator tools and an external,
  fresh KINGPEPE_LOCAL_E2E_ROOT. Generated SBF keypairs also stay external.
- node solana/tests/local-deposit-security.mjs uses the same isolated tools/root
  and runs the real deposit plus three local-validator security checks.
- CI runs cargo-audit against all five lockfiles without ignored advisories.
  bincode 1.3.3 has a retained, reported unmaintained warning, not a clean bill
  of health or production approval.

Latest measured local suites: 133 Node tests plus two vectors on Windows and
WSL; 56 Solana Rust tests and 22 Native supporting-crate tests in WSL.
Windows service/ACL/protected-storage and native Windows SBF tests are NOT_RUN.
Do not reuse these counts as evidence after code changes without rerunning.

## Continuity

Authoritative files: docs/development-status.md (current evidence and history),
docs/task-status.md (stage/commit history), BRIDGE-READINESS.json,
PROVENANCE.json, UPSTREAM-REFERENCES.json, .github/workflows/ci.yml.
Historical passing tests do not certify a newer tree. Commit/push each coherent
validated increment, verify CI for the exact SHA, record failures/corrections,
and resolve Phase 08 dependencies before moving to Phase 09.
