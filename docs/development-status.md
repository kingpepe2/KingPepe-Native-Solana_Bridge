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

Working-tree evidence based on 3428dd7d0f324c113bdf82bdad8d6a199853b8ba:

- Full Windows and WSL Node: 962 PASS each, zero failures/skips; vectors 2 each.
  Includes the counter-width and exact-source CI-gate regressions.
- Fresh real Native-to-Solana-to-Native round trip: 20 PASS, both COMPLETED.
  Includes actual A+B Native-accepted payout, missing signer, invalid signature,
  lost broadcast response, separate-process restart before/after finality,
  no duplicate payout, direct burn rejection and persistent pause.
- Current source/provenance: 245 files PASS. npm audit: zero vulnerabilities.
- Phase 09 exact committed-SHA fresh-clone/CI validation remains due.

These results explicitly contain worktreeDirty=true; they are not proof that the
base SHA contains the new withdrawal implementation. No per-transfer Team
approval was added. Phase 10 operational integration follows a separate commit.

## CI and remaining work

Actions now execute; the historical billing restriction is no longer the current
status. Cleanup run 34688184212 passed Linux SBF and all its real-chain steps;
Windows failed before protected-state tests. Subsequent explicit fixes addressed
Windows canonical paths, the compiled helper's principal binding and inherited
PowerShell module discovery. No gate was removed or weakened.

Run 34690072892 for 3428dd7d0f324c113bdf82bdad8d6a199853b8ba has source scan
and Foundation Guardrails PASS. Windows executed 138 security tests: 137 PASS,
one interrupted-write fixture failure. The fixture used a default file principal
instead of the real writer's explicit service-SID ACL. Test-only correction
5c93ddf24a613a9414c28b28c7e9353758a327da passed all three candidate regressions
locally and is pushed; run 34691122645 is executing. Runtime ACL enforcement is
unchanged. Do not certify a later implementation using either earlier run.

Phase 08 core: PASS_LOCALLY.
Phase 09: IMPLEMENTED_AND_TESTED_IN_WORKING_TREE; publication in progress.
Simple operational integration, complete CLI/UI, final clean-clone validation,
Devnet, production configuration/deployment and external review remain incomplete.

Residual risks: common-host compromise/availability, unaudited Noble FROST,
CurrentUser-only Windows certification, no full-host rollback guarantee,
project attestation/configured observer trust and upgrade authority.
Cargo reports an unsuppressed bincode 1.3.3 unmaintained warning
(RUSTSEC-2025-0141); no dependency vulnerability failures were reported.
productionReady=false; mainnetActivation=DISABLED.
