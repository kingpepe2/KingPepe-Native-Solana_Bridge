# Development status

The repository is PUBLIC. Original KingPepe code is All Rights Reserved.
Production readiness, signing and broadcasting remain false; Mainnet is disabled.

## Phase 19 local preparation

Phase 18's final Devnet report/policy publication
`d616b67f8b8601388e3533730b8b251839eab60d` passed exact-SHA CI `34855692775`,
attempt 2: four required jobs, 99 passed steps, none skipped. The initial pinned
audit-tool download returned HTTP 504 before audit execution; the unchanged
failed job passed on retry. No code, tool pin or CI requirement was weakened.

Under explicit Team authorization, one new dedicated production upgrade-authority
key was prepared in private local storage. Current-account DPAPI encryption,
private ACL, encrypted round trip, two independent public derivations, wrong-context
and tamper rejection, and refusal to replace an existing key passed. Its public
address is in `BRIDGE-READINESS.json`; private material/configuration and local
paths remain outside Git. It is distinct from the 15 public identities in the
Devnet enrollment record and from the retained runtime fee payer and Native
FROST aggregate public key. No private test shares were read and no production
transaction was submitted.

This is an upgrade-authority-only preparation milestone, not a production runtime
configuration or full Phase-19 PASS. Production RPC/Native reserve, separate fee
payer and other role references, runtime/backup configuration, and final reviewed
deployment identity/artifact plan remain unconfigured or unverified. There is no
claim of comparison against unconfigured production roles or replacement-host
recovery. Do not reuse Devnet credentials or the upgrade key as fee payer.

The policy remains `SINGLE_KEY_WITH_REVIEW_CONTROL`, `upgradeReviewWindow = NONE`,
`fixedTimelock = false`. All retained readiness gates must pass before requesting
`KINGPEPE_TEAM_ACTIVATION_APPROVAL`. This publication requires its own exact-SHA
CI; the preceding run does not certify a later commit. Bridge behavior, normal
transfer approval/timing, SINGLE_HOST topology and scoped TESTED recovery are
unchanged. External review is NOT_REQUIRED_BY_TEAM; no audit is claimed.

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

## Phase 15 finalized Devnet enrollment

Phase 14's publication ddd234e0be44587b44a5d8f9b3ad4ade215b2b97 passed
exact-SHA CI 34735282747: all four jobs, no skipped jobs or steps. Its SBF
hashes match the fresh-clone evidence below.

The first Phase 15 milestone, 9e339122748848a4bc762e3a09bcaecded478d50,
adds an explicit Devnet enrollment path over the
existing Borsh/SPL setup planner, a distinct Devnet test state, and a Devnet-only
purpose in the existing Windows protected store. Localnet entry points remain
local-only. Mainnet activation, production signing and broadcasting stay disabled.
There is no new database, service, transfer engine or wire format. Test enrollment
still requires the exact Mint signer, zero initial supply, Bridge PDA mint
authority, no freeze authority and two attesters. Test keys are never source.

Enrollment milestone validation: 994 Node tests per platform; 102 Rust tests;
nine setup-planner tests; one focused real CurrentUser DPAPI test; both SBF
builds; provenance coverage of 271 files; guardrails, dependency/license and
worktree/full-history secret scans passed. The real local service passed all
25 checks with both directions COMPLETED, including restart, lost responses,
replay, reconciliation and pause/resume. Its temporary ledger database was
removed after shutdown; test key files remain protected and untouched.
These are working-tree results, not a Devnet deployment certificate. The
milestone commit requires matching CI before deployment. No dependency was
changed; the retained non-bridge SDK bincode advisory remains disclosed.
Enrollment's exact-SHA [CI run 34737496362](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34737496362)
must have all four required jobs executed successfully; later status publications
also require their own matching CI.

Funding is resolved: at finalized Devnet slot 497598163, prepared test fee payer
`E7mox7hc7LdSvCu6PH8sf7U7mJQBnEjA7z3xYiwh2m2k` held 5 Devnet SOL. No further
airdrop was requested. Earlier bounded airdrops returned RPC -32603 and HTTP
429; neither limits nor identities were bypassed. ProgramData rent alone was
2.364242160 Devnet SOL, plus fees and setup rent. Test credentials remain in
CurrentUser DPAPI stores; the private CLI pipe check creates no plaintext keys.

Publication 66c292beeda8c30c1c02bc078f2df549e8515634 passed CI 34737786267,
all four required jobs with no skipped steps. Its independently built program
hashes match the local artifacts. Earlier enrollment run 34737496362 attempt 1
failed the first local flow before any security/accounting checks completed;
later chain checks were skipped. Its public gate omitted the runner's sanitized
source location and its detailed result was not retained. The original exception
cannot be recovered; the later pass is not proof of its cause.

The workflow now prints that existing safe source location, never raw subprocess
errors, and explicitly prepares the pinned Native Rust verifier before starting
chains rather than allowing hidden first-use toolchain setup inside a flow.
These are concrete reporting/setup fixes, not a claimed reconstruction of the
old exception. Thirty-nine focused checks and a fresh 55-check actual-chain
deposit run passed, with automatic test-ledger cleanup. Exact-SHA revalidation
is required before deployment; all original acceptance checks remain unchanged.

Source `5ad33201402813503d31b6d97c2e3e6fdb7908c1` subsequently passed all four
jobs and every step in exact-SHA CI `34745104679`. The enrollment rerun
`34737496362`, attempt 2, also passed every job/step. This resolves the current
CI gate without inventing the cause of the original lost diagnostic.

Both Devnet programs and the Mint/config enrollment are now finalized. The
[public deployment record](deployment/devnet.json) lists their exact identities,
transactions and source. At finalized slot 497778617, supply was zero, decimals
eight, authority the Bridge PDA, and freeze authority None. Both config accounts
matched the expected canonical Borsh bytes. Each deployment transaction was
identified at its ProgramData deployment slot; the atomic enrollment transaction
was recovered from finalized Mint history. Verification submitted no transaction
and did not redeploy the Manager or Transceiver. No further airdrop was needed.

Fresh external builds with the pinned compiler and supported `--arch v3` reproduced
both deployed hashes. CI also checks these release hashes; default v0 local-test
hashes are a separate artifact identity. RPC credentials stay in local process
configuration, never in public evidence. Publication
`36f9e3a4d5af8495d8abb7fde6871894e3fec195` passed exact-SHA CI `34766210723`:
all four required jobs and every step, none skipped. Phase 15 is PASS.

Phase 16 integrates and validates Native regtest against this real Devnet
deployment. No Devnet transfer, soak,
external review or production readiness is certified by Phase 15. See
[Devnet deployment](deployment/devnet.md).

## Phase 16 real Devnet round trip: PASS

The retained Solana clients now accept explicitly configured HTTPS Devnet access
with the pinned genesis. Default local callers remain local-only; Mainnet and
automatic Devnet airdrops are rejected. The same deployment verifier understands
the existing Borsh DevnetTesting config and constructs its runtime manifest from
the reviewed public enrollment record, not from arbitrary RPC account values.
The retained transfer workers, observers, delivery checks and SDK now carry the
explicit Devnet policy through the existing flow. Accounting, finality, replay,
Borsh bytes, FROST and on-chain authorities are unchanged. The existing journal
uses a Devnet context discriminator; relabeling a copied journal as localnet is
rejected. Existing localnet journals remain compatible. Attesters and journal
keys load from existing DPAPI stores only after exact test-domain checks.
No new transfer engine, database or service layer was added.
Service integration validation: 1,005 Node tests passed on Windows and WSL,
plus three focused real CurrentUser DPAPI checks. The existing lost-response
and journal-reopen regression now exercises explicit localnet and Devnet
configurations. Full-tree secret scan, exact 275-file provenance coverage and
guardrails passed. These are not live Devnet transfer results.

Service integration `d747e0bea0925079d88ffe08b164df30d35264bb` passed exact-SHA
CI `34769417206`: all four required jobs and every step, none skipped.

The protected Devnet test runtime is prepared, reusing the existing A/B
processes, journal, attesters and transfer workers. It verifies the deployed
identities and uses separate test runtime fees, not the upgrade authority as
the relayer. Test credentials, Native wallet, operation records and signed
packets remain outside Git for safe resume. Signed user packets are retained
before submission; retries check their chain status and reuse the same packet.

Prepared runtime `1d89e5493a9e70131d132c6808301b85bd72edae` passed exact-SHA
CI `34771920080`: four required jobs, every step passed, none skipped. Its 1,006
Node tests per platform, secret/provenance/guardrail checks and read-only
enrollment recheck preceded the real transfers; that CI alone does not certify
the subsequent working-tree Devnet implementation.

The configured RPC tier still denies `getProgramAccounts` (HTTP 400 / RPC
-32600). This no longer blocks Devnet discovery: supported finalized Manager
address history feeds the same retained withdrawal verifier. It validates
complete bounded pagination to the enrollment slot, exact transaction, Borsh
bytes, BurnChecked CPI, token delta and live record/PDA. Missing or malformed
history waits, never implies zero withdrawals. No account permission bypass,
second database or weakened withdrawal check is used. Capability preflight
still runs before opening signing state or spending test fees.

The real round trip reached COMPLETED in both directions on 2026-09-13, with
reconciliation MATCH. One KPEPE was minted, burned through the bridge record,
then paid on Native regtest with a 1000 atomic Native fee. Final reserve, supply
and pending liabilities were zero. Public operation IDs, transaction IDs and
canonical digests are in `BRIDGE-READINESS.json`. The first user withdrawal
packet expired with no on-chain signature/record; a replacement preserved the
exact canonical message and operation ID. Its burn finalized in 11.701 seconds.
The initial dropped submission's underlying cause is not established. Bounded
identical-packet retries now retain sanitized diagnostics rather than swallowing
preflight failures. No redeployment, new airdrop or production action occurred.
The discovery/round-trip milestone passed 1,009 retained Node tests on each
platform, 19 focused history/SDK checks, full-tree secret scanning, exact 276-file
provenance coverage, guardrails and locked dependency/license metadata checks;
npm reports zero vulnerabilities. No dependency or on-chain program was changed.
Publication `e8f282fbe34975f96f4e0a1271072bbd7de5982e` passed exact-SHA CI
`34774289824`: all four required jobs and every step, none skipped. A clean-source
restart recognized both completed operations with identical transaction IDs,
zero new submissions/signing and reconciliation MATCH. Read-only decoding of the
finalized claim, withdrawal and Transceiver verification instructions confirmed
exact canonical Borsh bytes and digests. Phase 16 is PASS.

## Phase 17 scoped Devnet observation and recovery: PASS

The validated runtime is `e54a53160b09809d838b6388c67844186e70db02`, with
exact-SHA [CI 34837775528](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34837775528):
four required jobs and every step passed, none skipped. The preceding traffic/
recovery milestone `cd11982dba8ed9c728b03e4a39a53c67e96c57c4` also passed all
jobs/steps in CI `34835285166`. This evidence publication requires its own
matching CI before automatic progression to Phase 18; an older run cannot
certify a newer commit. The public interval/operation evidence is in
`BRIDGE-READINESS.json`, with usage in [Devnet deployment](deployment/devnet.md).

The final KingPepe Team requirement is **five actual monitored hours**,
accumulated across interruptions with downtime excluded. The audit conservatively
credits 20,280 seconds (5h38m): a preserved 18,132-second MATCH span from
2026-09-13 20:09:43.201 UTC to 2026-09-14 01:11:55.849 UTC, plus 2,148 seconds
of post-compaction traffic/recovery intervals ending at 11:15:47.113 UTC.
The historical span used source `b8326497bbef21d3cbcbacb0687b46616ccb8898`
with exact-SHA CI `34777214469` (four jobs, no skipped steps), and contains 221
additional observations with no WAIT. Preserved artifact hashes matched the
pre-compaction inventory. Requested future runtime is not credited.

The original run stopped at 01:15:53.898 UTC in the disk guard; six earlier
WAIT samples and the tail after its last MATCH are excluded, as are all stopped,
restore and maintenance gaps. The old run omitted the exact failing free-space
sample; that value remains unknown. The later diagnostic fix retains it without
lowering the guard. Historical completed-operation monitoring is combined with
subsequent new both-direction traffic under the approved accumulation rule.
This is not an uninterrupted calendar window, long-term soak or load test.

Two NEW regtest/Devnet round trips completed after compaction. Together with
the retained Phase-16 round trip, the journal recognizes three completed deposits
and three completed withdrawals, with zero pending operations and reconciliation
MATCH. Restarts/retries did not create additional economic operations. Finalized
claim, receipt and withdrawal instructions matched exact canonical Borsh V2
bytes/digests. Native blocks were mined by the isolated regtest driver; this is
not public Native-network timing evidence.

The same-account Windows recovery drill stopped a new sweep and payout after
accepted Native broadcasts whose replies were deliberately lost. Two encrypted,
closed-state snapshots restored into restricted isolated locations. Complete
inventories, journal checkpoints and signed packets matched; original snapshots
were retained. Read-only real-chain catch-up and reviewed resume completed both
operations without signing or broadcasting either saved transaction again.
Archive verification/extraction took 5.746 and 3.920 seconds; manual stop-to-
completion took about 18m44s and 3m42s. The documented path rebinding and matching
test temporary root required explicit manual steps, preserving complete protected
envelopes, revisions and consumed nonces. Failed starts stayed stopped/paused.
`recoveryProcedure = TESTED` is scoped to this known-gap, same-account drill;
production DPAPI portability, cold custody and arbitrary stale snapshots are not
certified. See the [recovery runbook](security/deposit-operation-recovery.md).

Approved edge checks passed: two-confirmation and pre-finality reorg WAIT without
signing/mint; fresh-signed Devnet withdrawal replay and duplicate-claim rejection
without token CPI/account changes; mature wallet-signed conflicting Native spend
rejected; accepted Solana reply lost with one send and finalized in 11.944 seconds;
pending-operation restart, RPC outage/reconnect, pause/reviewed resume, no double
mint/payout and reconciliation MATCH. Two test-driver errors (wrong context method
and CLI empty-null parsing) were fixed with existing adapters and focused tests;
their downtime is excluded. No core bridge or signing algorithm was redesigned.

Published historical resident-memory samples were 165.8-266.1 MB. The resumed
observer was approximately 266-299 MB; the journal remained 184,320 bytes with
no pending queue, and the current observation log was 7,942 bytes at review.
WSL VHD size remained stable, C: retained more than 21 GiB in bounded samples,
and heavy retained evidence stayed on the development-data volume. No guard was
bypassed, unknown data deleted or demonstrated memory leak concealed. These
short measurements do not prove long-term memory/log behavior.

The recovery milestone passed 1,015 Node tests on Windows and WSL. The final
edge change passed 23 focused checks on each, followed by exact-SHA CI including
the retained suites, 142 Windows CurrentUser security checks, 102 Rust tests,
both SBF builds, real local-chain/reorg tests and the encrypted three-boundary
local recovery flow. Source/history/staged secret scans, exact 276-file provenance,
guardrails and dependency/license checks passed; npm reported zero vulnerabilities.
The evidence-only publication passed 14 focused checks per platform. Its first
WSL run had two 20-second subprocess-startup timeouts while a 399.92 MB tree
scan ran concurrently; the identical sequential rerun passed in 9.142 seconds.
Failure diagnostics are retained. Contention is suspected, not proven by a
profiler; no timeout, test or core behavior was changed to obtain the pass.
No unresolved Critical/High operational defect was observed in the exercised
scope. This is NOT independent security review.

Phase-17 publication `424089ec1e344d2732ed58160b33fd18a24f71f1` passed matching
CI `34841406825`: all four jobs and every step, none skipped. Phase 18 uses that
verified baseline for the [single final Devnet report](deployment/devnet-report.md).
The Team's final upgrade policy is SINGLE_KEY_WITH_REVIEW_CONTROL, review window
NONE, fixedTimelock=false. The [manual procedure](security/program-upgrades.md)
requires testing/review and specific Team approval for each production upgrade,
without changing normal transfer behavior. The existing Devnet test key is not
an implicit production key choice; production authority configuration remains
unprovisioned/unverified.

The Team removed independent external review, a review package and external
Critical/High clearance as mandatory roadmap gates. Record
externalSecurityReview=NOT_REQUIRED_BY_TEAM and externalSecurityAuditCompleted=false;
no audit or zero-finding conclusion is claimed. After Phase-18 scans, provenance,
reviewed publication and its own exact-SHA CI pass, proceed to Phase 19. All other
readiness gates and the explicit activation approval remain. Mainnet, production
signing/broadcast and activation stay disabled; known unsafe blockers cannot be
ignored. Common-host and full-host rollback limitations remain explicit.

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

## Phase 14 fresh-clone validation and recovery

PASS at clean source 1f8ce111f10f31e6984c25d02903071d2f893076, cloned
independently from the public repository. Locked dependencies were installed and
project build directories were new; pinned tools and download caches were reused.
Source and lockfiles remained unchanged. No legacy source directory was required.
Matching [CI run 34732975925](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34732975925)
passed all four required jobs, with no skipped jobs or steps. Later status-only
publication commits require their own exact-SHA CI before Phase 15.

- Windows and WSL Node: 991 PASS each, zero failures/skips. Windows CurrentUser
  security: 139 PASS with a freshly built verifier; four real-browser checks PASS.
- Rust: 101 PASS with locked check, formatting and Clippy across four workspaces.
  Both languages pass 53 fixed Borsh vectors and reject 12,336 single-bit message
  corruptions. Borsh V2 is the only bridge wire format; external consensus/SDK
  serialization is unchanged.
- Both SBF programs build from new output directories. Binary hashes match the
  independent exact-SHA CI builds and Phase-11 evidence in BRIDGE-READINESS.json.
- Real-chain deposit 55, acceptance-checkpoint 13, reconciliation 10 plus claim
  14, withdrawal-record 29 plus subsequent-deposit accounting five, round-trip
  25, service 25, deployment-integrity 18 and Native-reorg eight checks PASS.
  Both directions reach COMPLETED without per-transfer KingPepe Team approval.
- Fresh-tree/full-history secret scans, 270-file provenance, guardrails and
  dependency-license checks PASS; npm reports zero vulnerabilities. Bincode is
  still required by the non-bridge Solana SDK/System-instruction path and its
  maintenance warning is unsuppressed.

The first Windows verifier command named a nonexistent binary and was rejected
before compilation or tests. The corrected existing target built from the clone
and all security tests passed; the failed invocation's log remains local.

The existing service harness passes all 25 checks after three encrypted restores:
pending Native sweep, finalized mint awaiting accounting, and pending Native
payout. Restored services start PAUSED, query real chain state, and issue no new
signing or broadcast during catch-up. Original state, journal identity, consumed
signer records and exact file hashes are preserved. Final reserve/outstanding
supply is 80,000,000 atomic units with zero pending liabilities and MATCH.
The three restore procedures took 3.605, 4.740 and 5.964 seconds respectively;
these timings exclude the surrounding chain finality waits.

GNU tar 1.35 and GnuPG 2.4.4 provide encrypted capture without a plaintext disk
archive. Wrong passphrases and corrupted ciphertext fail before extraction.
The manual runbook's expected-operation and activity-gap checks retain pause on
ambiguity; this is not automatic full-host rollback detection. The local test
uses a newly provisioned private Windows destination and native Linux GnuPG
control sockets; no existing ACLs, production keys or system configuration change.
`recoveryProcedure = TESTED` refers only to this controlled local drill, not
production DPAPI recovery, a cold-backup policy or the required Phase-17 Devnet
drill. See [the recovery runbook](security/deposit-operation-recovery.md).

No transfer engine, database, codec, economics or signing topology changed.
All eight test runs stopped their processes and removed temporary validator
databases: 4,057,631,222 bytes total, not a claim of equivalent Windows-volume
space recovery or VHD compaction. No ledger is retained for debugging. Original
test keys, encrypted snapshots and useful evidence remain outside Git; reusable
SBF caches, wallets, backups, production state and WSL are untouched.
After this status publication's exact-SHA CI passes, Phase 15 follows
automatically. Devnet and production have not started here.

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
Record this decision at Phase 13 and preserve it honestly in the Devnet report;
do not require a second physical host or hardware signer.
Phase 18 records the final Team single-key review-control policy with no fixed
delay and the explicit removal of the mandatory external-review gate. The
[production checklist](../config/examples/production-readiness.example.json)
is planning-only, not loaded runtime configuration or proof of key custody.
Phase 19 retains all other readiness gates, including verified production
upgrade-authority configuration and no known unsafe activation blocker, then
requires explicit KINGPEPE_TEAM_ACTIVATION_APPROVAL before deployment. Accepted
common-host and full-host rollback limits remain visible; neither is eliminated.

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

The exercised environments are LOCALNET/REGTEST and the explicit Solana Devnet
test deployment, not production Windows service integration or deployment
approval. Phase 14 validates its named source from a clean clone and matching
CI; each later publication needs its own exact-SHA CI. Mainnet has not started.
Common-host compromise/availability, unaudited Noble FROST, CurrentUser-only Windows
coverage, no full-host rollback guarantee, configured RPC/attester trust and upgrade
authority remain explicit limitations. Cargo reports the unsuppressed bincode
1.3.3 unmaintained warning RUSTSEC-2025-0141. No advisory gate was weakened.
