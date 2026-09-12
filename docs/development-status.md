# Development status

The repository is PUBLIC. Original KingPepe code is All Rights Reserved.
Production readiness, signing and broadcasting remain false; Mainnet is disabled.

## Current bridge

Phase 10 composes both retained workers in `LocalBridgeService`, with one
authenticated SQLite operation journal. Registered public Native deposit intents
are observed and validated automatically; finalized Solana withdrawal records
are discovered without client resubmission. The loop catches up landed effects
and reconciles before new authorization, rotates bounded queues, retains exact
signed packets/results, and reports ACTIVE/PAUSED status. No new database,
service tier, verifier or payment-signing algorithm was introduced.

Policy pause and explicit reviewed resume survive restart. Paused catch-up may
record a burn, finalized reserve, mint or payout which already happened; it never
signs or sends. Expired transaction packets can be renewed for the same credit
after live expiry/account/history checks. Expired canonical CREDIT authorization
is different: the liability stays owed, the bridge pauses, and ordinary resume
cannot clear it. Automatic credit renewal/refund is not implemented.

The API and shutdown/restart procedure are described in
`services/bridge-validator/README.md`. User wallets still sign their own actions;
there is no per-transfer KingPepe Team approval.

Native deposits pass independent raw-evidence and finality checks, exact A+B
FROST reserve sweep, attestation, finalized Solana claim/mint and reconciliation.
Finalized BurnChecked withdrawal records drive exact Native payout planning,
independent A+B validation/signing, persist-before-broadcast delivery and finality.
Both directions use durable operation IDs and the existing accounting journal.

The bounded local service discovers withdrawal records, retains pending
liabilities and resumes without client resubmission. Missing creation history or
uncertain delivery waits. Confirmed accepted-chain or accounting contradiction
records an incident and pauses new mint/payout authorization. Read-only monitoring
may continue; no automatic repair or unpause exists.

## Final simplification

Review baseline: ab15b2f38084f024e49d8fae9a13182dfe85721d.
Tracked source files: 246 to 240. PROVENANCE.json classifies every retained file
and records the six removals: three unused facades and three duplicate FROST
readmes. No dependency, useful regression or third-party notice was removed.

IPC V3 retains pinned TLS 1.3, exact roles, deadlines and durable replay protection
without a second challenge/exporter exchange. FROST shares never cross its signing
channel. Deployment manifests V2 retain identities, authorities, configuration
and accepted deployment slots; reproducible hashes are build evidence only.
Old wire peers must be updated together. Old manifest-bound progress fails closed;
there is no automatic operational-state migration or deletion.

The separately reviewed coordinator correction is
84d8fa0f0eb830a3c9217813f9a907abf437415f. Its protected journal admits only reserve
sweep and withdrawal purposes, preserves exact intent binding and reuses a retained
aggregate after restart. Worker errors expose fixed public classes, not secrets.

## Phase 11 migration milestone

The schema, caller, vector and legacy-encoder changes form one atomic migration
based on e60d4d70261114b075049b0bd5076495ce9f7f2e. Bridge messages now use Borsh
V2 (`KPEPBRG2`); the old encoder/fixture and duplicate TypeScript implementation
are removed. Accounting, lifecycle, authority and Native/FROST consensus
signatures are unchanged. There is no V1 reader or automatic runtime-state
migration. Update components together; do not discard old private state.

The reviewed migration worktree passed 53 Rust/TypeScript byte/digest vectors
per platform, plus the two Native verifier packet vectors. Windows and WSL Node
each passed 979 tests without failures/skips; Rust passed 100 tests with locked
checks, formatting and Clippy. Both SBF programs build. The 55 deposit checks
and 25 round-trip checks passed on real local chains; both directions completed
using Borsh. These results do not certify the parent SHA.

Remaining retained chain regressions and the Windows CurrentUser security suite
are still running. Phase 11 remains IN_PROGRESS until all required validation,
publication scans and matching exact-SHA CI pass. The schema inventory is in
`docs/architecture/protocol-messages.md`. Bincode is still required by the
retained Solana SDK/System-instruction path, not by a legacy bridge codec;
its maintenance warning remains visible. Devnet has not started.

## Phase 10 validation

Service commit: 5512963398d6c2070102cd6781e72f129e3b6cc4, based on
5926bb1f56e7b7d708a60469af8e51282fe6274f. The local results below describe its
reviewed implementation worktree. The exact published service commit is verified
by [Actions run 34713517512](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34713517512):
all four required jobs passed, none skipped, including the combined service E2E.
Later commits must use their own matching CI run, not inherit this certification.

- Windows and WSL Node: 978 PASS each, zero failures/skips; two vectors each.
- Rust: 94 PASS; locked checks, formatting and Clippy in all four workspaces.
- Both SBF programs build; their hashes match the preceding release evidence.
- Combined service: 22 real-chain checks PASS, both directions COMPLETED.
  Includes abrupt process exits after nonce commitment and aggregate persistence,
  lost Native/Solana responses, real blockhash expiry, no duplicate mint/payout,
  pause/resume, and catch-up after mint/burn/payout settlement while paused.
  An interrupted credit/reserve append plus a real RPC outage waits without a
  false deficit; restored observation completes the exact retained accounting.
- Retained chain regression: deposit 55, withdrawal-record 29 plus subsequent
  deposit accounting five, and round-trip 25 PASS. The startup wait now accommodates
  fresh database initialization without skipping health verification. The payout
  restart check verifies chain/journal state during preflight settlement WAIT.
- Exact-SHA CI must be read from the matching GitHub Actions run; no older run
  or dirty working-tree result certifies the publication commit.
- Guardrails/provenance: PASS. Gitleaks full history and working tree: no leaks.
- npm audit: zero vulnerabilities. Locked dependency/license gates: PASS;
  the existing bincode maintenance warning remains visible.

Phase 10 did not include production deployment or Borsh migration. The separate
Phase 11 milestone above replaces bridge-owned encoding only; Native and Solana
consensus transaction encodings remain their actual external protocol formats.
Devnet must wait for completed migration and fresh-clone validation. Do not
suppress RUSTSEC-2025-0141 or remove unrelated retained SDK dependencies.

The final directive permits manual encrypted snapshots or existing OS scheduling;
neither a fixed schedule nor a custom backup service is required. The runbook is
`docs/security/deposit-operation-recovery.md`. A local-only archive check on the
closed, completed service test state passed with GNU tar 1.35 and GnuPG 2.4.4:
encrypted capture, exact restored file hashes, corrupt/wrong-passphrase rejection,
authenticated journal reopening and pause of the restored copy. Original test
state was unchanged. This check used no chains or production identities and did
not install a production backup job; its disposable copies were removed.

Phase 10 service and runbook requirements are complete under that scope.
`recoveryProcedure` remains NOT_TESTED: archive verification is not the actual
snapshot/chain-resume drill. That drill must pass before Phase 15, repeat during
Phase 17, and be TESTED before Phase 19. A stale snapshot is not permission to
reuse nonce state. Unknown post-snapshot history still requires pause/manual
review. Do not power off the physical host or recreate WSL for the runtime drill.

`signerTopology = SINGLE_HOST` is the final KingPepe Team decision: separate
software participants, processes/services, protected shares and nonce state;
exact A+B 2-of-2, no fallback and no coordinator share. Common-host compromise
or outage may affect both, and that risk is explicitly accepted by the Team.
Record this decision at Phase 13 and present it honestly to external review;
do not require a second physical host or hardware signer.
Phase 18 requires a recorded KingPepe Team upgrade-authority decision
(multisig, single-key with timelock, or explicitly justified single-key without
timelock). If not selected, stop and ask the Team; no choice or deployment is made
here. Phase 19 separately requires explicit KINGPEPE_TEAM_ACTIVATION_APPROVAL
before production deployment. Accepted common-host risk and full-host rollback
limits remain visible; documentation does not claim either has been eliminated.

## Prior baseline validation

These results cover the combined reviewed working tree based on the baseline
above, not an exact-SHA clean clone or certification of its parent commit.
See BRIDGE-READINESS.json and the matching GitHub Actions run for source scope.

- Windows and WSL Node: 963 PASS each, two canonical vectors each.
- Windows CurrentUser security: 139 PASS, zero failures/skips, fresh Native verifier.
- Fresh-verifier protected controller regressions: six PASS.
- Rust: 94 PASS; locked checks, formatting and Clippy passed in all four workspaces.
- Two independent fresh SBF builds matched; hashes are in BRIDGE-READINESS.json.
- Real deposit checks: 55 PASS. Round trip: 25 PASS, both directions COMPLETED.
- Withdrawal record: 29 PASS; subsequent deposit/direct-burn accounting: five PASS.
- Reconciliation: ten PASS; acceptance checkpoint: 13 PASS.
- Native reorg: eight PASS; deployment identity/authority/upgrade: 18 PASS.
- Source/provenance and secret scans passed. npm audit: zero vulnerabilities.
- Dependency/license gates passed; the bincode maintenance warning remains visible.

Historical Phase 09 evidence remains bound to
7f4bb7b3db3a61802b956aba8ee0f76d5e340772, not relabeled as later-source validation.

## Limits

This remains LOCALNET/REGTEST software, not production Windows service integration
or deployment approval. Phase 11 validation is in progress; Devnet and Mainnet
have not started here.
Common-host compromise/availability, unaudited Noble FROST, CurrentUser-only Windows
coverage, no full-host rollback guarantee, configured RPC/attester trust and upgrade
authority remain explicit limitations. Cargo reports the unsuppressed bincode
1.3.3 unmaintained warning RUSTSEC-2025-0141. No advisory gate was weakened.
