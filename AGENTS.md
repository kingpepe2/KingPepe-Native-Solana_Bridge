# Working on KingPepe Native - Solana

KingPepe Team directs a simple standard bridge. Keep core signing, finality,
replay, exact accounting, restart safety, protected secrets and a simple pause.
Do not recreate an experimental hardening phase.

The repository is PUBLIC after source, history, documentation, artifact and
license review. Original code remains proprietary All Rights Reserved. Preserve
required third-party notices and historical licensing facts.

## Safety and implementation

- Preserve useful work; no reset/clean/restore/stash. Legacy is read-only.
- Software FROST A+B: exact 2-of-2, separate private state, no fallback or
  coordinator private share. Current local tests use one host. The corrected
  roadmap requires genuinely distinct production hosts/accounts/network paths
  at Phase 13, verified before Phase 19; that deployment is not certified here.
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

Phase 10 simple operational service integration and minimal recovery runbook.
Preserve the completed local bidirectional bridge, the existing journal/inbox and core regression
coverage. Reuse the verifiers and transaction engines in one service loop.
Keep this change set scoped to Phase 10. Finish its validation, publication,
exact-SHA CI verification and report before separate Phase-11 work. No Devnet,
Mainnet or production integration belongs in this change set.
Phase 11 is now Borsh migration (including removal of obsolete bincode paths),
before Devnet. Keep recoveryProcedure NOT_TESTED until the actual snapshot
restore drill passes. Never relabel process restart as host-loss recovery.
Keep full-host rollback, current same-host risk, and upgrade-authority trust
explicit in readiness; the corrected roadmap requires a recorded authority
decision before external review, not an automatically chosen governance policy.

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
