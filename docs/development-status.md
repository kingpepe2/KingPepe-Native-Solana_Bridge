# Development status

The repository is PUBLIC. Original KingPepe code remains All Rights Reserved.
Mainnet activation, production signing and production broadcasting are disabled.

## Completed cleanup

Baseline: bdb996e45df33535a78d983afab22aa60a47cf15.
Cleanup: e7e7f6f247a18f298cb7d92b247fb2dd43cee609.

293 source files became 239: 55 removed, one shared real-validator packet helper
added. PROVENANCE.json records each retained file's origin and bridge purpose.
Removed placeholders, unused deterministic Rust signing scaffolds, advanced
fencing/rollback anchors and duplicated historical reports. Real Noble FROST,
nonce tombstones, process exclusion, DPAPI and core chain/accounting tests remain.
No npm dependency was removed or changed.

Preserved the pending Manager accounting correction: direct burns do not erase
the difference between bridge-issued units and actual SPL supply. Fixed the
test harness circular import rather than suppressing its failing test.

Fresh clones of that exact cleanup SHA passed:

- Windows Node 940; WSL Node 940; canonical vectors 2 per platform.
- Windows CurrentUser protected-storage/security 136, zero failures/skips.
  This does not certify separate Windows service identities.
- Rust 94; locked check, formatting and Clippy for all four retained workspaces.
- Two independent SBF build outputs matched:
  Manager: 996d0f1ac65b97160bf8ea0cd4c5e77361f4d83f9c15aa0c2ca2c238ea350f46
  Transceiver: 58bacbe7119e8793ae93dc0e025ed2ebc96c9a1407b16fdcbbdab2ec4d706eb0
- Real Native-to-Solana COMPLETED and 55 local-chain checks.
- Locked installation, source/provenance guardrails and dependency/license checks.

Other pre-cleanup-commit working-tree real-chain results: withdrawal record 29,
subsequent deposit/direct-burn accounting 5, acceptance checkpoint 13,
reconciliation 10 plus 14 claim checks, deployment identity 18, Native reorg 8.
Those remain distinct from fresh-clone evidence, not certification of later code.

Publication review found no secrets in the current/staged/outgoing tree,
184 historical commits or 134 executed historical CI logs. No published
artifacts, releases or issues were present. Required third-party terms remain.
The only attempted device cleanup targeted two verified obsolete compiler
output directories; policy denied deletion before execution. No source,
wallets, runtime state, backups, tools or WSL storage were deleted.

## Phase 09 local implementation

Six focused source/test files extend the existing bridge, not a new service
framework. The existing authenticated operation journal now persists canonical
reserve inputs, finalized user withdrawals, signed transactions, broadcast
attempts, final payments and reconciliation. Input locks precede signing;
signed bytes precede broadcast. A burned unpaid amount remains a liability.
Direct SPL burns grant no payout right and do not create spendable surplus.

The reader checks the actual finalized transaction, BurnChecked CPI, exact
withdrawal PDA, user authorization, canonical message, Mint and deployed
configuration. Each FROST participant independently checks the Solana request
and Native UTXOs/sighash. Native finality is checked against raw evidence by
the pinned verifier. Configured Solana RPC observation is not trustless proof.

Published implementation: 7f4bb7b3db3a61802b956aba8ee0f76d5e340772.
Completely separate fresh Windows and WSL clones of that SHA passed:

- Full Windows and WSL Node: 962 PASS each, zero failures/skips; vectors 2 each.
  Includes the counter-width and exact-source CI-gate regressions.
- Fresh real Native-to-Solana-to-Native round trip: 20 PASS, both COMPLETED.
  Includes actual A+B Native-accepted payout, missing signer, invalid signature,
  lost broadcast response, separate-process restart before/after finality,
  no duplicate payout, direct burn rejection and persistent pause.
- Windows CurrentUser protected-storage/security: 138 PASS, no failures/skips.
- Rust 94 PASS; locked check, fmt and Clippy; two fresh SBF builds matched the
  hashes above. Real deposit-chain checks: 55 PASS.
- Source/provenance: 245 files PASS. npm audit: zero vulnerabilities.
- Full history scan: 192 commits, no leaks. Dependency/license gates passed;
  the bincode maintenance warning below remains visible.

These fresh-clone results contain worktreeDirty=false and the exact published
SHA. No per-transfer Team approval was added. Native payout signing in the
round-trip harness uses isolated local test stores, not production keys or a
certification of production Windows service integration.

## Phase 10 local service increment

The existing journal now retains finalized withdrawal requests before input
selection; duplicate submissions cannot add another liability. One bounded
service loop resumes the journal queue without client resubmission, reports
read-only paged status and retries dependencies. No second database, approval
queue or automatic pause-clearing path was introduced.

The deposit flow itself registers verified canonical reserve inputs. Recorded
deposit/sweep and paid-withdrawal block identities support simple reorg checks.
A higher-work conflict with an accepted basis pauses the bridge and preserves
the original accounting evidence. Reconciliation distinguishes a recorded
pending payout from an unexplained canonical spend. Missing evidence waits;
confirmed contradiction pauses. It never repairs balances or pays again.

Published service increments: efd8595ed1a23e49511ea958bd68ec13cf22b36d and
d8ff95d06e0df6c5a54bc351a6b87dedbfb06ea9. Their working-tree validation passed
24 real-chain checks, both directions COMPLETED. Added durable-inbox
recovery, restart without client resubmission, an actual accepted-payout block
reorg and pause-preserving service restart. Full Node regressions passed on Windows and
WSL: 963 each, zero failures/skips, plus 2 vectors each. The retained real deposit
suite passed all 55 checks again after reserve registration was integrated.

The discovery follow-up, tested with worktreeDirty=true on base
d8ff95d06e0df6c5a54bc351a6b87dedbfb06ea9, passed 25 real-chain checks and the
same 963 Node tests plus two vectors per platform. It discovers finalized
withdrawal PDAs and verifies each creation transaction without a client
callback. The same durable journal suppresses duplicate operations; no new
index database. Local bounds are 256 records, 64 signatures per record and 16
new requests per scan. Missing creation history or malformed RPC evidence
waits safely. General production history indexing remains incomplete.

This remains LOCALNET/REGTEST software. Old disposable journals lacking accepted
reserve/payout block facts fail closed; no silent migration or reset is offered.
It is not yet a production launcher or multi-deposit indexer. Those integration
limitations are not hidden by local E2E. A follow-up adapter connects the common
signing API to existing protected FROST peers (mixed transports reject), and
opens the local journal with an existing DPAPI MAC key instead of a plaintext
test key. Real Windows protected A+B signing and key/reopen tests passed;
this is not yet a complete protected Windows round-trip service deployment.

## CI and remaining work

Actions now execute; the historical billing restriction is no longer the current
status. Cleanup run 34688184212 passed Linux SBF and all its real-chain steps;
Windows failed before protected-state tests. Subsequent explicit fixes addressed
Windows canonical paths, the compiled helper's principal binding and inherited
PowerShell module discovery. No gate was removed or weakened.

Exact Phase 09 run 34691297712 passed Linux SBF/all real-chain steps, source
history scanning and Foundation Guardrails. Windows executed 138 security tests:
137 PASS, one interrupted-write fixture failure. The fixture's first ACL-copy
attempt did not persist an unchanged .NET FileSecurity object. Correction
79e586424c852639d52b55251ac18198ef0c3abe constructs a modified descriptor,
persists it and checks the result. Exact run 34692481377 passed all Windows
protected-storage checks, Linux real-chain checks, history and guardrails.
Three Windows readiness tests then failed because TEMP used an 8.3 alias while
the runtime correctly returned its expanded physical path. Correction
e9485ad0cd9a33d185cd45d590fbc2b946fc050c compares independently resolved physical
paths: 72 local tests PASS on Windows and WSL. Run 34694101465 is queued for
that exact SHA. Runtime ACL/path enforcement is unchanged. No older run
certifies newer source; complete exact-SHA CI is still pending.

Phase 08 core: PASS_LOCALLY.
Phase 09: IMPLEMENTED_AND_TESTED_LOCALLY; exact source is published.
Phase 10: LOCAL_SERVICE_INCREMENT_TESTED; production integration remains incomplete.
Simple operational integration, complete CLI/UI, final clean-clone validation,
Devnet, production configuration/deployment and external review remain incomplete.

Residual risks: common-host compromise/availability, unaudited Noble FROST,
CurrentUser-only Windows certification, no full-host rollback guarantee,
project attestation/configured observer trust and upgrade authority.
Cargo reports an unsuppressed bincode 1.3.3 unmaintained warning
(RUSTSEC-2025-0141); no dependency vulnerability failures were reported.
productionReady=false; mainnetActivation=DISABLED.
