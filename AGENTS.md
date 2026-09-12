# Working on KingPepe Native ↔ Solana

## Current direction

KingPepe Team directs a simple standard bridge, not another hardening phase.
Simplify first, validate core Native → Solana, then implement Solana → Native
in separate commits. Follow with simple services, SDK/CLI/UI and local validation.
Production requires explicit Team authorization and independent review.

Visibility target: PUBLIC. Remain PRIVATE until cleaned source, staged changes,
full history, docs, artifacts and legal provenance pass publication checks.
Original code remains proprietary All Rights Reserved.

Preserve useful uncommitted work. No reset/clean/restore/stash. Legacy is
read-only. No production keys, systems, wallets, funds or deployment now.

## Core boundaries

- Software FROST A+B, exact 2-of-2, separate processes/protected state on one
  Team-controlled host. No fallback or coordinator private share.
- Preserve @noble/curves 2.3.0 schnorr_FROST secp256k1/BIP340/BIP342.
  Upstream FROST is UNAUDITED. Ed25519 is for attestations/Solana identities.
- Keep nonce tombstones, exact request binding, a simple process lock, replay
  prevention, integer accounting and durable operation IDs.
- Protected local secrets, no plaintext fallback. No clone/fence or multiple
  rollback-anchor framework; complete restored host snapshots are not proved fresh.
- Simple pause, read-only reconciliation, no automatic economic repair.
- No per-transfer Team approval. Users sign their wallets. Missing evidence
  never grants authority.
- Runtime secrets/state, ledgers, keys, databases, logs and private configuration
  stay outside every checkout. No generated keys in Git.
- productionReady=false; mainnetActivation=DISABLED;
  productionSigningAuthorized=false; productionBroadcastAuthorized=false.
- Use KingPepe Team terminology; preserve official Solana account.owner terms.

## Current continuation

Baseline before cleanup: bdb996e45df33535a78d983afab22aa60a47cf15.

Preserve the pending Manager accounting correction: direct SPL burns must not
erase the difference between bridge-issued and actual Mint supply. The baseline
real-validator regression failed at that invariant.

Cleanup removed README-only placeholders, unused Rust deterministic test shares,
persistent signer fencing and registry/file rollback anchors. Real Node FROST,
atomic DPAPI state, process exclusion and core chain tests remain.

Current pre-commit validation: Windows/WSL Node 940 PASS each plus 2 vectors;
Rust 94 PASS with check/fmt/Clippy; both SBF builds; real Native-to-Solana
COMPLETED; 55 core-chain checks; 29 withdrawal-record plus 5 later-deposit
accounting checks. The test harness circular import was fixed, not suppressed.
Windows security's old run had one obsolete fence-API test failure; its corrected
regression passed separately. Do not call the old full run PASS. Re-run the
current full suite from the cleanup clone. Complete publication gates, commit
cleanup and then start Phase 09 separately. No Phase 08.5 is being recreated.

Current status: docs/development-status.md and BRIDGE-READINESS.json.
Historical source-bound evidence remains in Git, not duplicate progress files.
Never reuse old SHA results as current proof.

## Commands

Pins: scripts/local-e2e-toolchain.json and docs/deployment/local-e2e-build.md.
Node 24.21.0/npm 11.19.0; Solana Rust 1.89.0; Native nightly-2023-10-29;
Linux/WSL Agave 4.2.2, SBF builder 4.1.0, platform-tools v1.54.
Direct SBF: no Anchor CLI required. Source-built Native REGTEST 31.1.0 only.

- npm ci --ignore-scripts; npm test; npm audit --audit-level=low
- npm run test:windows-security (CurrentUser, not distinct service-SID proof)
- python .github/scripts/guardrails.py; node scripts/source-audit.mjs
- node .github/scripts/dependency-license-audit.mjs
- solana/: cargo check --locked --workspace --all-targets;
  cargo test --locked --workspace; cargo fmt --check --all;
  cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
- Native proof/reserve/recovery: locked check/test/fmt/Clippy for each manifest.
- Real chains: documented scripts, NEW external run roots and external outputs.

Implement → tests → source/staged/outgoing scans → diff review → explicit
staging → commit → push → exact-SHA CI when available. Cleanup first, Phase 09
separately. Baseline Actions run 34683149831 is NOT_RUN_ACCOUNT_BLOCKED
(zero steps/artifacts); do not weaken CI or create meaningless retry commits.

Delete only reviewed obsolete source and proven disposable project test/build
outputs. Unknown wallets, recovery data, backups, Native source, tools and WSL
stay untouched. No unrelated device cleanup or virtual-disk manipulation.
