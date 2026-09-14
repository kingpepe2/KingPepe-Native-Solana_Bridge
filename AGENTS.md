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

Phase 14 fresh-clone validation and the isolated encrypted restore drill passed
at 1f8ce111f10f31e6984c25d02903071d2f893076 with exact-SHA CI 34732975925.
Its publication ddd234e0be44587b44a5d8f9b3ad4ade215b2b97 also passed matching
CI 34735282747 (four required jobs passed, none skipped).
Phase 15 TEST-only Devnet enrollment is PASS using canonical Borsh V2. Publication
36f9e3a4d5af8495d8abb7fde6871894e3fec195 passed exact-SHA CI 34766210723:
all four required jobs and every step, none skipped. Phase 16 real regtest/Devnet
flows in both directions are PASS at e8f282fbe34975f96f4e0a1271072bbd7de5982e,
with exact-SHA CI 34774289824: all four jobs and every step, none skipped.
Phase 17 scoped validation passed on runtime e54a53160b09809d838b6388c67844186e70db02
with exact-SHA CI 34837775528 (four jobs, no skipped steps). Its evidence-only
publication also requires matching CI before Phase 18. The next gate is the
Phase-18 Team upgrade-authority decision and independent external review.
Public deployment identities, source, build hashes and
transactions are in docs/deployment/devnet.json. Both programs and the Mint
already exist; do not redeploy them or recreate enrollment on a routine restart.
Source 5ad33201402813503d31b6d97c2e3e6fdb7908c1 passed all four jobs and every
step in CI 34745104679. Enrollment CI 34737496362 attempt 2 also passed; its
attempt 1 exception is not recoverable from retained diagnostics, so do not
invent a root cause. The safe-diagnostic/pinned-verifier setup fixes are retained.
The funded test fee payer needs no further airdrops. Preserve its prepared
protected credentials. Read SOLANA_DEVNET_RPC_URL from local process configuration
without exposing it in source, logs, CLI diagnostics or public evidence.
Service integration d747e0bea0925079d88ffe08b164df30d35264bb passed exact-SHA
CI 34769417206, four required jobs and every step, none skipped. Prepared-runtime
1d89e5493a9e70131d132c6808301b85bd72edae also passed all jobs/steps in CI
34771920080. The configured RPC tier denies getProgramAccounts; Devnet discovery
now uses supported, bounded finalized Manager address history instead, feeding
the same transaction/BurnChecked/record verifier. Missing history waits; no
permission bypass, second index or database. Localnet discovery is unchanged.
Both real regtest/Devnet directions reached COMPLETED with reconciliation MATCH
in the retained protected test run. The original Native wallet, signing state,
journal and signed packets remain outside Git. Preserve that exact state for
restart/drill checks; do not redeploy or regenerate signing state. The first
user withdrawal packet expired without landing; its replacement preserved the
exact Borsh message and operation ID after live absence/expiry checks. The test
runner checks history capability before opening signers or spending test fees.
A clean-source restart at that Phase-16 publication recognized both completed
operations without new signing or submissions; reconciliation remained MATCH.
The final KingPepe Team Phase 17 decision requires five actual monitored hours,
excluding stopped intervals, with both-direction traffic and the Devnet recovery
drill. This is not a long-term soak. The controlled same-account Devnet drill
passed for pending sweep and payout; it does not certify production DPAPI
portability or arbitrary stale snapshots. The retained audit credits 20,280
monitored seconds across explicit intervals, excluding downtime: a preserved
18,132-second MATCH span plus 2,148 seconds of new traffic/recovery observations.
Two new round trips and the scoped network edge checks passed. Do not describe
this accumulated short test as a long-term soak or uninterrupted calendar window.
Per-run observation flags alone cannot certify the aggregate Phase-17 gate.
The pinned compiler's supported --arch v3 builds reproduce the deployed bytes;
do not confuse them with default v0 local-test binaries or enable experimental ABI.
Devnet test state must not enable Mainnet. Existing local callers stay local-only.
No production configuration, keys, funds or deployment.
Preserve the completed transfer engines, accounting, lifecycle, replay semantics,
FROST topology, authorities and existing journal/inbox. Recovery is TESTED only
for closed localnet/regtest and the controlled Devnet same-account drill with
a known quiescent gap, not production DPAPI portability or full-host rollback.
Use external build directories and locked dependencies. No new security platform.
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
