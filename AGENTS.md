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

The current continuation starts at 84ef95fba316944dd9c205e0f965d3b9ff725e64.
That SHA's clean clone passed Windows/WSL Node 505 each, Windows security 27,
Rust 97/quality, two SBF builds, deposit 55 and withdrawal-record 26; E2E
COMPLETED. These are historical baseline results, not new-commit certification.
The next increment adds DPAPI-backed mutual TLS and persistent transport replay
checks, with restricted FROST and attester service handlers. See
docs/security/service-ipc.md. All five remaining control groups must still be
implemented/integrated and validated; do not stop merely because the elevated
Windows cross-service environment or Actions is unavailable. Neither condition
authorizes weaker tests, Phase 09, production provisioning or live funds.

The latest Team request starts from 2b5c82971834d6299969c05a9889c950dae2ef91
and authorizes remediation of the remaining Phase 01-08 security findings, not
Phase 09. See docs/security/windows-protected-storage.md for the new DPAPI
component, its tests and limits. Distinct Windows service-identity execution is
BLOCKED on the present non-elevated token. No production accounts, keys or
services have been provisioned. Do not equate current-user DPAPI tests with
cross-service isolation, full rollback assurance or secured service-wide E2E.
No plaintext fallback is permitted. Keep the remaining IPC, persistent fencing,
global-stop, service recovery, deployment watcher and post-mint reorg gaps open.
Historical audit results below do not certify this remediation's source SHA.

Protected-store implementation published PRIVATE at
cba77159f5afbbea5aa1f95030e1b90c5fc990df. That exact clean clone passed 505 Node
tests per platform, 25 Windows security tests, 97 Rust tests/quality gates, two
new SBF builds, 55 deposit checks and 26 withdrawal-record checks. Actions
34545506371 started zero steps. A follow-up removes secret-bearing byte values
from test assertion failures and adds a fixed-error regression: 26 Windows
security tests pass locally. It changes tests/status, not cryptographic/runtime
logic. Verify its own SHA after publication; never infer CI success. The full
remediation gate remains blocked; next requires isolated Windows service-test
capability and further IPC/fencing/recovery/monitor/reorg implementation.

Test-output correction published at f212983a67a43d7f988eb3ec878a322c2c16190d;
its clean clone passed Windows/WSL Node 505 each, Windows security 26, Rust 97/quality, SBF, deposit 55
and withdrawal-record 26. CI 34546962076 started no steps. The next file-policy
correction adds OS fixed-volume checks and explicit per-file security descriptors;
27 Windows security tests passed on that worktree. Validate the new SHA rather
than attributing f212983 evidence to it. Cross-service testing still needs a
privileged isolated Windows test environment, not production credentials.

## Previous retrospective audit context

Phase 09 is NOT_STARTED and MUST NOT start automatically. The Team requested
audit/fixes of Phases 01-08, including the fresh withdrawal-record PDA prerequisite,
but not a Native withdrawal payout or the full Phase 09 E2E.

Audit baseline: 9ea5e198b57f48086a0c7861123a6d79d14e8560.
Prior implementation: 0133a6cc7f22bf880249a72a62502aa4bf3a638b.
Published audit fixes: 845f2b22c87a94f79a3b499209260247a5d01acf; separate-clone
Windows/WSL Node, Rust, SBF and real-chain reruns passed for that SHA. Its exact
Actions run 34519943346 was rejected before steps. Follow-up changes need new
SHA-bound validation; the remaining security findings still prevent Phase 09.
Current evidence and outstanding findings: docs/phase-08-5-audit.md,
docs/development-status.md, docs/task-status.md and BRIDGE-READINESS.json.
Historical passing runs do not certify a later SHA.

The latest instructions authorize local audit fixes and private pushes while
Actions is account-blocked. This supersedes old status entries that paused all
fixes pending CI. It does not authorize Phase 09 or weaker security gates.
Current external blocker: GITHUB_ACTIONS_ACCOUNT_EXECUTION_BLOCKED. No account,
billing, privacy or protection changes are authorized. A rejected job with no
steps is NOT_RUN, never a test PASS.

The audit repairs fresh withdrawal-record allocation, Native-domain/P2TR checks,
gross withdrawal/fee liabilities, canonical observer PDA derivation, bounded RPC,
immutable attester policy/key references and provenance coverage checks. The
new real-validator regression is a Phase 08.5 prerequisite, not Phase 09:
it deliberately leaves unpaid disposable withdrawals and never builds a payout.

Native signing uses @noble/curves 2.3.0 schnorr_FROST, secp256k1/BIP340 with
BIP342 script-path sighashes where applicable. Its FROST implementation is
explicitly UNAUDITED upstream. Ed25519 is used for separate attestations and
Solana wallet transactions, never the final Native sweep signature. The Native
Rust FROST crate is a supporting policy/state model, not this cryptographic signer.

V2 nonces are volatile private buffers; public reservations/tombstones persist
before exposure and uncertain sessions are burned on reopen. Local process crash
tests are not full rollback, cloned-signer or power-loss assurance. Long-term DKG
shares in the Linux test harness still use external plaintext test JSON; the
new Windows protected adapter is separately tested and never a fallback.
Cross-identity protected-service validation, authenticated
confidential IPC, ongoing signer leases, durable global stops and service-wide
fencing/recovery remain incomplete. A co-restored database and checkpoint cannot
prove freshness. The approved same-host topology is not the cause of these gaps.

Raw local Native headers/PoW/difficulty/Merkle data are verified; canonical choice
and UTXO state still come from the configured validating node. Solana deposit
observation is RPC_OBSERVATION. Identity-policy fixtures are not a running
ProgramData/upgrade watcher, full Solana validation or production approval.
Post-mint deep-reorg response and complete service crash recovery remain open.
Finish the audit report with an honest gate verdict, then wait for explicit
KingPepe Team direction. Do not reinterpret a local E2E pass as all audits passing.

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
