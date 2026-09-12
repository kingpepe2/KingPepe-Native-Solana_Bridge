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

Latest published PRIVATE increment: 9de05a715c8a2c124a2c456b7cb8a50cdb6014ca,
security(phase-08.5): persist coordinator signing and integrity reports.
The 227-file tree passed current/staged and outgoing scans; 177 prior commits
were scanned separately. Exact Actions 34640680967 executed zero steps in four
jobs with no artifacts: NOT_RUN_ACCOUNT_BLOCKED (account payments/spending limit).
Its Windows security 113, Node 612 per platform and vectors two each pass.

Current operation-journal continuation adds protected immutable input reservations,
signed-sweep/broadcast retention, atomic reserve-plus-credit persistence, genuine
finalized claim observations and a read-only authenticated reconciliation snapshot.
It does not yet implement the full unattended controller, protected claim outbox,
live reconciliation or complete protected real-chain restart matrix. The separate
candidate passed Node 699 per platform, vectors two each, seven new Windows
DPAPI/mTLS targets and fourteen actual-chain observation/codec checks. Primary-
checkout Node 699 per platform, vectors two each, 55 existing deposit checks and
fourteen new actual-chain checks also pass. Primary Rust 97/check/fmt/Clippy,
other real-chain checks 26/18/8/13 and seven new protected Windows targets pass.
The complete 120-test Windows security suite finished 116 PASS / 4 FAIL, with
zero skipped/cancelled. Fresh source admission expired the Native result;
SHARE_A and uncertain-abort recovery rejected signature-share IPC; attester
SIGNATURE_CREATED recovery exceeded the unchanged response deadline. The next
correction removes redundant checks before read-only evidence verification,
retains checks before secret actions/result release, and adds explicit stop-
during-evidence tests. Concurrent authenticated source polling replaces the
sequential one-shot admission fixture. The four original failures and both new
stop-before-secret targets now pass. Two additional fixture assertions initially
read a closed store; the corrected current-store rerun passes both attesters.
Renewed Windows/WSL Node 699 and two vectors each pass; fresh actual E2E plus
fourteen operation checks pass. The complete Windows rerun now passes 122 with
zero failures/skips/cancellations for the unchanged 156-file runtime digest
recorded in development-status. This is actual current-principal DPAPI/mTLS
component evidence, not cross-account or full protected-chain certification.
The prior failed runs remain recorded. Final publication scans/review follow;
do not infer final clean-clone certification from this local increment.
The real integration test exposed Native RPC default replacement signaling.
The builder now explicitly disables it and rejects unexpected sequences; both
targeted tests failed before correction and pass afterward. This is not a change
to Native consensus or a claim about the node's full-RBF mempool policy.
See docs/security/deposit-operation-recovery.md. Phase 09 NOT_STARTED.

Prior published PRIVATE increment: 1e0a04152b7be2e87305afcc7bb6d8d093b5981d,
security(phase-08.5): persist protected attester authorizations. Do not attribute
the later coordinator or operation-journal changes to that SHA. Its tree had
224 files, staged/export and all outgoing commits passed Gitleaks. Exact Actions
34622973490 ran zero steps in four failed-to-start jobs, zero artifacts:
NOT_RUN_ACCOUNT_BLOCKED. CI was not weakened.

Current work adds a mandatory protected coordinator signing journal: durable
attempt/session preparation, two terminal abort receipts before a new attempt,
verified aggregate retention before release, and witness/CAS integrity reporting.
Twenty-one new portable codec tests and the updated protected A+B/reopen target pass.
The initial new kill-test fixture failed because it tried to mutate a frozen peer;
the fixture now observes real IPC calls without weakening peer immutability.
The corrected PREPARED process-kill rerun passes, following one IPC rejection
whose cause is not certified. A new real regression exposed loss of an integrity
incident when supervisor delivery failed. The protected transport now persists
that report before connecting; the actual unreachable-TLS/reopen regression and
twelve portable outbox cases pass. Full Windows validation was interrupted for
this fix and was restarted against the final consistent revision, as recorded
below. Full operation/broadcast-credit and
protected real-chain service recovery remain incomplete. See
docs/security/coordinator-signing-recovery.md. Phase 09 must not start.

Further review fixed exact IPC payload capture before asynchronous TLS connection
and prototype-forged transport/peer capabilities. The former had an actual TLS
failing regression and the latter two portable failures; their corrections pass
targeted checks. The redundant outbox pre-read was folded into the transport's
mandatory protected preflight, retaining unchanged freshness/response deadlines.
Final Node reruns pass 612 per platform plus two canonical vectors each. The
complete Windows security rerun now passes 113 / 0 FAIL / 0 SKIP for the
unchanged 148-file runtime snapshot. This includes eight coordinator kill
boundaries, lost writes, outbox restart, attester restart and signer fencing.
It uses actual current-principal DPAPI/mTLS/FROST with synthetic chain fixtures,
not cross-service account certification or full protected-chain recovery.
Current exact source publication follows staged/outgoing scans and review.
Separate unpublished operation-journal integration is being tested; it also
exposed the pinned Native RPC's default replacement signaling. Its explicit
non-replacement correction belongs to that next increment, not this source SHA.

Phase 09 is NOT_STARTED. The validation-resumption baseline is
f99c08c6bb50803b7db9ddbd0c3c7862f5d23d15, verified PRIVATE. Its exact Actions
34576782766 started zero steps in four jobs and produced zero artifacts:
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

The published acceptance recovery work retains a fixed Native acceptance checkpoint
while independently verifying the current chain and UTXOs. The new real-chain
13-check regression passes through Native-accepted FROST, both attestations,
mint and reconciliation after deliberate tip advancement. Full Windows/WSL Node
557, vectors two each, Rust 97/check/fmt/Clippy and existing chain checks 55/26/18/8
pass. No complete operation-journal or
crash-recovery claim is made.

The current increment adds a mandatory protected attester authorization journal
to the actual attester IPC handler. It retains one exact canonical message per
operation/outpoint/allocation, persists preparation before signing and the result
before release, and keeps conflicts fail-closed across reopen. Portable codec
tests and real Windows process-kill/DPAPI/mTLS tests have separate evidence;
synthetic Native evidence in component tests is not chain verification. Full
operation recovery and protected Windows chain integration remain incomplete.

Validation resumed after separately authorized host storage recovery and a
successful WSL startup check. The prior Node bus error, WSL I/O failures and
protected-fixture creation failure occurred during storage exhaustion; they are
not passing evidence or demonstrated source defects. The interrupted
authenticated-malformed-journal test was rerun first and PASSED its intended
durable global-stop/reopen assertions. No source work was discarded. Keep all
new test state external and monitor headroom; do not repair or relocate WSL.

The attester increment has completed its pre-publication local regression. Fresh resumed
Windows/WSL Node 576, vectors two each, Rust 97/check/fmt/Clippy, npm zero and
declared-license metadata pass. All five renewed Cargo advisory scans pass with
the existing unmaintained bincode warning retained. Fresh real-chain withdrawal
record 26, deployment 18, Native reorg eight, acceptance 13 and deposit/security
55 checks pass, each following a COMPLETED deposit prerequisite. The first
full Windows security run was 89 PASS / 2 FAIL / 0 SKIP: rejected IPC calls in a
signed-result restart and conflict fixture. Isolated reruns passed but do NOT
replace the failed full gate. Fixed-code diagnostics, a retained-result path
without a nonexistent new-signing step, and a final expiry recheck passed the
complete Windows security rerun: 93 PASS / 0 FAIL / 0 SKIP. Security files run
serially; deadlines and actual competing-process tests are unchanged. The
earlier failed run remains recorded, not relabeled as a pass.
The async deposit pipeline now awaits both coordinator and attester results;
five added tests cover genuine cryptographic computation with fixture chains,
rejected promises and late hard stops. Source export and all 176 existing commits
passed Gitleaks before the final status edit. Staged/outgoing scans and exact-SHA
publication evidence follow this local evidence; final clean-clone validation
and full service recovery remain incomplete.

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
- node solana/tests/local-protected-claim-observation.mjs.
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
