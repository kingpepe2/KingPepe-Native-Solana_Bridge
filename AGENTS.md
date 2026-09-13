# Working on KingPepe Native - Solana

KingPepe Team directs a simple standard bridge. Keep core signing, finality,
replay, exact accounting, restart safety, protected secrets and a simple pause.
Do not recreate an experimental hardening phase.

The repository is PUBLIC after source, history, documentation, artifact and
license review. Original code remains proprietary All Rights Reserved. Preserve
required third-party notices and historical licensing facts.

## Safety and implementation

- Preserve useful work; no reset/clean/restore/stash. Legacy is read-only.
- Software FROST A+B: exact 2-of-2, separate processes/services, protected private
  shares and nonce state; no fallback or coordinator private share. SINGLE_HOST
  is the final KingPepe Team decision. Common-host compromise/outage may affect
  both participants; record that accepted risk for Phase 13 and external review.
  Do not require another physical host, HSM or hardware signer.
- Preserve @noble/curves 2.3.0 schnorr_FROST secp256k1/BIP340/BIP342.
  Upstream FROST is UNAUDITED. Ed25519 is for attestations/Solana identities.
- Keep nonce tombstones, exact transaction binding, simple process exclusion,
  durable operation IDs and persist-before-broadcast ordering.
- Protected secrets have no plaintext production fallback. Local test material
  is explicitly isolated outside every checkout. No keys, ledgers, databases,
  operational paths or private configuration in source or published artifacts.
- No advanced clone/fence/rollback-anchor frameworks. Full-host snapshot
  rollback and distinct Windows service principals are not locally certified.
- No per-transfer Team approval; users sign their wallets. Missing evidence
  never authorizes minting or payment. Serious contradiction pauses the bridge;
  read-only monitoring may continue. No automatic economic repair.
- No production systems, keys, wallets, funds or deployment now.
  productionReady=false; mainnetActivation=DISABLED;
  productionSigningAuthorized=false; productionBroadcastAuthorized=false.
- Use KingPepe Team terminology; preserve official account.owner/API terms.

## Current review scope

Phase 13 practical core failure coverage and the accepted SINGLE_HOST decision.
Phase 12 SDK, CLI and interface passed at
71c68af9e8ec01737a52b6ab48a54e32263d0554 with exact-SHA CI 34728490291
(four required jobs passed, none skipped). Preserve the completed transfer
engines, canonical Borsh, accounting, lifecycle, replay semantics, FROST topology,
authorities and existing journal/inbox. Reuse existing failure tests, add only
bounded exposed-parser checks, and fix actual defects. No new security platform.
User wallets sign their own transactions; no user-facing signing, minting or
administrative API.
Keep implementation commits phase-scoped. Commit/push each meaningful,
self-contained milestone after its tests, scans and review, then verify its
exact-SHA CI; do not accumulate the entire phase or commit trivial edits.
Encoding changes and their callers must land together without mixed formats.
After required validation, scans,
publication and exact-SHA CI pass, continue automatically to the next approved
roadmap phase. Stop on a real blocker, concurrent writer, incomplete soak or
external review, missing Team upgrade-authority decision, or the Phase 19
activation approval gate. No Devnet before Borsh and fresh-clone validation.
Remove obsolete encoding and bincode
paths/dependencies only when no retained code genuinely requires them. Do not
suppress a remaining upstream advisory or change Native/Solana consensus encoding.
Recovery uses manual or existing OS-scheduled encrypted snapshots, not a custom
backup service. Keep recoveryProcedure NOT_TESTED until the actual snapshot
restore/chain-resume drill passes, before Phase 15; repeat in Phase 17 and require
TESTED before Phase 19. Do not power off the host or recreate WSL for the drill.
Keep full-host rollback, accepted same-host risk and upgrade-authority trust
explicit in readiness. At Phase 18 stop for a KingPepe Team authority-model
decision if undecided. At Phase 19 stop for KINGPEPE_TEAM_ACTIVATION_APPROVAL
before production deployment. Do not choose either decision for the Team.

Source-bound status and evidence: docs/development-status.md and
BRIDGE-READINESS.json. Historical validation certifies only its named source.
GitHub Actions execution is restored. Fix actual failures; do not weaken gates.

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
- Native proof/reserve/recovery: locked check/test/fmt/Clippy per manifest.
- npm run local:e2e:native-to-solana
- npm run local:e2e:round-trip
- npm run local:e2e:service
- Real chains require a NEW external run root, external build outputs and the
  pinned executables. Never reuse production state or an existing test ledger.

Implement -> tests -> source/staged/outgoing scans -> review -> explicit staging
-> commit -> push -> exact-SHA CI. Clean-clone results must name their source SHA.
Delete only reviewed obsolete source and proven disposable project test/build
outputs. Preserve unknown wallets, backups, recovery, Native source, tools and WSL.
