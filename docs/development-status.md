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

## Phase 12 user access

The SDK, same-process user HTTP boundary and CLI milestone is published as
6e8230ae67671dec9e373c012590af0751f3f394; matching CI run 34727112550 passed
all four required jobs, with none skipped.
It prepares public Native deposit requests and unsigned Solana withdrawals, and
reads operation/bridge status from the existing journal. Wallets sign user-owned
transactions; the boundary has no minting, FROST signing or administration route.
Deployment, initialized KPEPE token account, withdrawal authority/balance and
finalized network time are checked through the existing Solana reader. There is
no new database or transfer engine.

The simple interface uses the same authenticated loopback listener with a fixed
public-asset allowlist. It shows exact decimal amounts, destinations, public
request downloads, operation states and transaction IDs. Wallet Standard delegates
Solana signing/sending to the user's wallet; Native funding stays in the user's
Native wallet. No key import, private wallet material or persistent browser token
storage is added. A fresh pause check precedes wallet handoff; an unknown wallet
outcome cannot trigger automatic re-signing or a replacement economic operation.

The reviewed interface worktree based on the SDK milestone passed 991 Node tests
on both Windows and WSL (zero failures/skips), including nine SDK/HTTP/CLI and
three display/request tests. Four additional isolated real-Chrome UI tests pass
with desktop/mobile visual review. Their wallet/status fixtures have no signing
key and are explicitly not economic evidence. CI retains all existing jobs and
adds the browser checks to Windows, failing rather than skipping if unavailable.
The existing
real service harness now passes 25 checks: both directions COMPLETED, user-only
Solana wallet signature, authenticated intake, restart/lost-response recovery,
no duplicate economic action, status transaction IDs and reconciliation MATCH.
CI requires all 25 checks and explicitly names the three additions. The initial
host-time withdrawal window failed finalized preflight; network Clock-based
construction fixed it without changing on-chain validity rules. This is localnet
evidence, not an executed browser-wallet or Devnet certification.

Provenance covers 269 files; guardrails, source/history secret scans and the
dependency/license audit passed. The latter ran in WSL with pinned Cargo metadata;
the Windows shell without that metadata could not run that particular audit.
The npm audit has zero vulnerabilities. The interface milestone is published as
71c68af9e8ec01737a52b6ab48a54e32263d0554; exact-SHA CI run 34728490291 passed
all four required jobs, with none skipped. Its fresh real-chain service rerun
passed all 25 checks: both directions COMPLETED, reserve/supply 80,000,000 atomic units, no
pending mint/withdrawal liabilities and reconciliation MATCH. Temporary validator
databases were removed after shutdown; test key files and diagnostic evidence
remain external to Git. At Phase 12, recoveryProcedure was NOT_TESTED. The
Phase-14 section records the later actual encrypted snapshot/chain-resume drill;
process-restart results alone did not certify it.

See [user access](user-access.md) for the local-only API and CLI contract.

## Phase 14 recovery milestone and fresh-clone gate

The isolated encrypted snapshot/chain-resume drill passes on the reviewed
Phase-14 milestone worktree based on eb105cba5276f99e76572c824fe5c190b1fe1a75.
This is not certification of that parent commit. The existing service harness
passes all 25 checks and both directions reach COMPLETED after three restores:
pending Native sweep, finalized mint awaiting accounting, and pending Native
payout. Restored services start PAUSED, query real chain state, and issue no new
signing or broadcast during catch-up. Original state, journal identity, consumed
signer records and exact file hashes are preserved. Final reserve/outstanding
supply is 80,000,000 atomic units with zero pending liabilities and MATCH.

GNU tar 1.35 and GnuPG 2.4.4 provide encrypted capture without a plaintext disk
archive. Wrong passphrases and corrupted ciphertext fail before extraction.
The manual runbook's expected-operation and activity-gap checks retain pause on
ambiguity; this is not automatic full-host rollback detection. The local test
uses a newly provisioned private Windows destination and native Linux GnuPG
control sockets; no existing ACLs, production keys or system configuration change.
`recoveryProcedure = TESTED` refers only to this controlled local drill, not
production DPAPI recovery, a cold-backup policy or the required Phase-17 Devnet
drill. See [the recovery runbook](security/deposit-operation-recovery.md).

No transfer engine, database, codec, economics or signing topology changes.
The temporary validator database is removed after shutdown; original test keys,
encrypted snapshots and useful evidence remain outside Git. Matching milestone
CI and complete fresh-clone validation remain required before Phase 15. Devnet
and production are not started by this milestone.

## Phase 13 core hardening

PASS at eb105cba5276f99e76572c824fe5c190b1fe1a75. Exact-SHA CI 34730712772
passed all four required jobs with no skipped steps. The retained suites cover
replay, duplicate-action, wrong identity/amount/recipient, signature/participant,
RPC, restart, pause, reorg and exact reconciliation regressions. A bounded
deterministic test flips every bit of the three canonical Borsh message vectors
in Rust and TypeScript, including the maximum-amount withdrawal. This tests
strict decoding and operation-ID binding, not authentication of a newly
constructed self-consistent message. No new service, database, codec, security
framework or economic behavior is introduced.

`signerTopology = SINGLE_HOST` records the final KingPepe Team accepted-risk
decision. The approved deployment requires both software participants, separate
processes, protected shares and nonce state; the coordinator has no private share and
there is no fallback. Common-host compromise or outage may affect both at once.
This limitation, unaudited Noble FROST and the lack of a full-host snapshot
rollback guarantee remain explicit disclosures for the Phase-18 reviewer.
Local tests do not certify production service-account isolation or recovery.

Windows and WSL each pass 991 retained Node tests and 53 canonical vectors,
with 12,336 single-bit corruptions rejected in each language. Rust passes 101
tests with locked checks, formatting and Clippy; all four browser regressions
pass. Both pinned SBF builds execute in the fresh local-chain runs using retained
compiler intermediates; their hashes match the Phase-11 release evidence. A
fresh-target build remains part of Phase 14.

The real service run passes 25 checks with both directions COMPLETED and exact
80,000,000-atomic-unit reserve/outstanding supply, zero pending liabilities and
reconciliation MATCH. The reconciliation run passes ten checks plus fourteen
finalized-claim checks. The independent regtest reorg run passes eight checks,
including incident persistence after restart and no automatic clear after chain
recovery. Existing replay, invalid-identity/signature, amount/recipient, timeout,
duplicate-action and pause coverage remains intact. No runtime defect was found
in these exercised paths; this is not an external security audit.

The first reconciliation invocation omitted its required source-SHA variable
and was rejected before chain startup; the corrected invocation passed, with the
failed command's evidence retained. Source/history secret scans, provenance for
269 files, guardrails and dependency/license checks pass; npm reports zero
vulnerabilities. Final staging/outgoing scans remain publication gates. Each
test's validator database was removed after shutdown, while test keys and useful
evidence remain outside Git. No validator ledger is retained for debugging.

## Phase 11 canonical Borsh validation

The schema, caller, vector and legacy-encoder changes form atomic migration
commit 3b083b34477c0d2c841f43561eb91d104e73a9b8, based on
e60d4d70261114b075049b0bd5076495ce9f7f2e. Bridge messages now use Borsh
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

The remaining retained local checks also passed:

- Windows CurrentUser security: 139 PASS, no failures/skips, using a fresh
  source-built Native verifier. This is not distinct-service-principal proof.
- Withdrawal records: 29 PASS plus five subsequent-deposit/direct-burn checks.
- Combined automatic service: 22 PASS on the clean migration commit, both
  directions COMPLETED, including lost replies, restart and pause/resume.
- Deployment identity/authority: 18 PASS; acceptance checkpoint: 13 PASS;
  actual Native reorg: eight PASS; reconciliation: ten plus 14 claim checks.
- Exact provenance: 255 files. Guardrails, dependency/license checks and npm
  audit passed (zero npm vulnerabilities). Gitleaks working tree, staged diff
  and all 205 commits through the migration milestone reported no leaks.

One initial local mining setup timed out during host I/O contention before the
bridge flow. A fresh isolated rerun passed unchanged; failure evidence remains
local. Local wrappers preserve diagnostic evidence externally, stop owned test
processes and remove only recognized temporary validator databases after every
run. Generated key files are preserved, not swept by generic cleanup. Reusable
tool caches, private/operational state, wallets and backups are untouched.

All local Phase 11 validation is complete. Migration commit
3b083b34477c0d2c841f43561eb91d104e73a9b8 passed all four required jobs, none
skipped, in [Actions run 34722632015](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34722632015).
The final publication commit 2a37d0d0dc093a3ad545014bd45b2760ec6fd3db also
passed all four jobs, none skipped, in
[Actions run 34723965490](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34723965490).
Later commits require their own matching exact-SHA CI; do not inherit an older run.
The schema inventory is in
`docs/architecture/protocol-messages.md`. Bincode remains required by the
retained Solana SDK/System-instruction path, not by a legacy bridge codec;
its maintenance warning is unsuppressed. Devnet has not started. Phase 12 follows
the completed Phase 11 gate without routine approval.

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
At that Phase-10 milestone, `recoveryProcedure` remained NOT_TESTED: archive
verification was not the actual snapshot/chain-resume drill. The later Phase-14
result above supplies the local drill; repeat it during Phase 17 and require
TESTED before Phase 19. A stale snapshot is not permission to
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
or deployment approval. Phase 11 is locally validated and requires matching
exact-SHA CI; Devnet and Mainnet have not started here.
Common-host compromise/availability, unaudited Noble FROST, CurrentUser-only Windows
coverage, no full-host rollback guarantee, configured RPC/attester trust and upgrade
authority remain explicit limitations. Cargo reports the unsuppressed bincode
1.3.3 unmaintained warning RUSTSEC-2025-0141. No advisory gate was weakened.
