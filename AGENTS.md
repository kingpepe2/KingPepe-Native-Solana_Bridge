# AGENTS

## Authority and safety

- KingPepe Native - Solana Bridge; KINGPEPE_TEAM_GOVERNANCE.
- Keep the repository PRIVATE. Original source/documentation is proprietary;
  preserve third-party terms and exact PROVENANCE.json coverage.
- Approved software FROST: exact A+B, 2-of-2, one Team-controlled host. No
  single-signer fallback, second-computer requirement or hardware prerequisite.
- Normal transfers are policy-authorized automatically after the user's wallet
  transaction and one-time activation. Missing evidence never authorizes a transfer.
- productionReady=false; mainnetActivation=DISABLED;
  productionSigningAuthorized=false; productionBroadcastAuthorized=false.
  No production provisioning, services, deployment, signing, funds or activation.
- Legacy material is read-only; preserve its recovery data and do not import history.
- Keys, nonce state, databases, logs and machine-specific deployment data remain
  outside every checkout. Runtime guards supplement, not replace, OS permissions.
- README is introductory. Templates contain placeholders, not operational values.
- Project roles use KingPepe Team. Keep official Solana account.owner/API terms.
- Preserve unrelated work; explicitly stage and review files; scan current/staged
  files, every outgoing commit and publication artifacts. Verify privacy before
  normal push; respect branch protections and check CI for the exact SHA.

## Current task: Phase 08.5 security remediation

Phase 09 is NOT_STARTED. The current published source is
858dc041c922add58f0af1c98efeca8094774339, PRIVATE. Exact Actions
34574760811 started zero steps in four jobs and produced zero artifacts:
NOT_RUN_ACCOUNT_BLOCKED. No account, billing, privacy or protection bypass.

The Native accepted-basis/reorg increment is published. Windows/WSL Node 537,
Windows security 74 and eight real regtest reorg
checks pass. Two of the security tests use synthetic persisted incident
evidence with actual DPAPI/mTLS; they are not protected real-chain integration.
Fresh Rust 97, check/fmt/Clippy, normal SBF builds, 55 deposit checks,
26 record checks and 18 deployment checks pass. This is worktree evidence,
not a final clean-clone certification. Current evidence is in
docs/development-status.md and docs/task-status.md; older passing evidence must
not certify a later SHA.

The retained Windows registry witness increment is published.
Windows security 80, Windows/WSL Node 537, vectors two each, fresh Rust 97 and
quality checks, fresh normal SBF and the 55-check real deposit suite pass. The
full security suite passed after a test-teardown correction; a final exact fence
cleanup adjustment also passed the protected A+B FROST targeted rerun. The
witness survives file-package restore while
the service profile remains current, not full profile/host co-restore. No
runtime reset, automatic legacy enrollment or production provisioning was added.

The source-health admission increment is published after supervisor restart.
Persisted RUNNING policy is effectively paused until all three source roles
complete fresh one-use checks in the current supervisor generation. Windows/WSL
Node 549 and vectors two each, fresh Rust 97/check/fmt/Clippy and the real chain
suites (55 deposit, 26 record, 18 deployment, eight reorg) pass. Full Windows
security regression passes 82 with zero failures/skips. Protected A+B passes with a
separate supervisor process; no signing deadline or freshness gate was relaxed.
Its source watchdog is synthetic component-test evidence only, never runtime or
chain/reconciliation evidence. See development-status for failed-run corrections.

Current uncommitted recovery work retains a fixed Native acceptance checkpoint
while independently verifying the current chain and UTXOs. The new real-chain
13-check regression passes through Native-accepted FROST, both attestations,
mint and reconciliation after deliberate tip advancement. Full Windows/WSL Node
557, vectors two each, Rust 97/check/fmt/Clippy and existing chain checks 55/26/18/8
pass. No complete operation-journal or
crash-recovery claim is made.

Implemented local components: protected CurrentUser DPAPI/file boundaries;
mutual TLS role-bound IPC; separate retained signer fence and lifetime handle;
global integrity authority and protected signer/coordinator/attester guards;
actual Solana deployment identity verification; and current Native accepted-basis
comparison with post-mint reorg incident retention. See docs/security/ for the
precise evidence and limitations, not a claim of complete service integration.

Remaining MUST_FIX_BEFORE_PHASE09 work: full service/broadcast-credit recovery,
fresh source-health admission for every economic service and protected Windows
chain integration. Final
clean-clone validation and retrospective audit remain incomplete. Do not stop
source work merely because elevated cross-service testing or Actions is blocked.
Cross-service DPAPI/ACL certification requires an isolated elevated Windows
environment with distinct temporary identities; same-principal tests are not
that evidence. Full privileged host/profile/state co-restore remains a risk.

Preserve @noble/curves 2.3.0 schnorr_FROST secp256k1/BIP340 and applicable
BIP342 sighashes, exact A+B. Upstream FROST is explicitly UNAUDITED. Ed25519 is
separate attestation/Solana transaction signing, not Native payment signing.
Volatile private nonces are burned on uncertain restart; retained public
tombstones and exact prepared-state recovery do not prove full-host rollback
detection. Linux test-only external JSON is not production protected storage
and must never become a fallback.

Native raw verification still relies on the configured validating node for
canonical choice and UTXO state. Solana local observation is RPC_OBSERVATION,
not independent consensus. Off-chain stops cannot revoke already released
attestations or already sent blockchain transactions. No automatic economic
repair, confiscation, remint, stop clearing, production setup or activation.

Finish the audit with an honest entry-gate verdict and then wait for explicit
KingPepe Team direction. Historical details remain in the status files and
docs/phase-08-5-audit.md; no old CI/local pass is relabeled as new evidence.

## Actual build and test commands

Pins: scripts/local-e2e-toolchain.json and docs/deployment/local-e2e-build.md.
Use verified process-local tools; do not modify global defaults just for tests.

- Node 24.21.0 / npm 11.19.0 / bundled SQLite 3.53.4.
  The exact runtime guard is required; wrong defaults fail with
  LocalLedgerPinnedRuntimeRequired. SQLite API remains release-candidate.
- Solana host Rust/Cargo 1.89.0; Native crates nightly-2023-10-29.
- Linux/WSL: Agave/validator 4.2.2; cargo-build-sbf 4.1.0; platform-tools v1.54.
  Direct solana-program builds, not Anchor CLI or Anchor-generated IDLs.
- Native test node/CLI 31.1.0 from the checksum/commit-pinned source, REGTEST only.
- npm ci --ignore-scripts; npm test; npm audit --audit-level=low.
- Windows only: npm run test:windows-security. These are real DPAPI tests under
  the current test identity, not completed cross-service account/ACL validation.
- python .github/scripts/guardrails.py; node scripts/source-audit.mjs.
- node .github/scripts/dependency-license-audit.mjs (requires Cargo metadata).
- In solana/: cargo check --locked --workspace --all-targets;
  cargo test --locked --workspace; cargo fmt --check --all;
  cargo clippy --locked --workspace --all-targets --all-features -- -D warnings.
- For native/{frost,proof,reserve,recovery}, use --manifest-path for locked
  check/test, fmt --check and clippy --all-targets --all-features -- -D warnings.
- Audit all five Cargo.lock files with pinned cargo-audit; no ignored advisories.
  Retain the visible bincode 1.3.3 RUSTSEC-2025-0141 unmaintained warning.
- npm run doctor:local-e2e; node solana/tests/local-deposit-security.mjs.
- node solana/tests/local-withdrawal-record.mjs.
- node solana/tests/local-deployment-integrity.mjs (requires the exact reviewed
  KINGPEPE_TEST_SOURCE_SHA; no inferred worktree certification).
- node solana/tests/local-native-reorg.mjs.
- node solana/tests/local-acceptance-checkpoint.mjs.
  Each daemon run requires a NEW external KINGPEPE_LOCAL_E2E_ROOT. Never reset an
  existing ledger. See the build guide for external outputs and locked SBF builds.
- Fresh-clone proof requires new compiled project outputs, not copied targets.

Windows portable Node tests differ from Linux/WSL SBF and Windows service/ACL
tests. Native Windows Cargo is absent from this workstation's PATH; do not
claim native Windows Rust, SBF or protected-service validation from WSL results.
No workspace, ledger, target/deploy directory or generated keypair is uploaded.

## Continuity

Keep exact-SHA evidence in status files/reports without circular self-SHA edits.
Implement -> test -> scan -> review -> commit -> PRIVATE push -> exact-SHA CI
when executable. CI success is not deployment, governance or activation authority.
