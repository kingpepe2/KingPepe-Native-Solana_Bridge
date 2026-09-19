# Current development status

The KingPepe Team has authorized permanent one-way conversion and public-history
filtering. Supported direction: KingPepe Native → Solana. Mainnet remains paused.

Current worktree: canonical forward Borsh V3, forward-only Solana ABI, journal,
SDK, API, CLI and recipient UI. FROST remains necessary for reserve sweeps.
The one-way TEST programs and forward operation are validated. Mainnet runtime
preparation and the reviewed public Explorer cutover remain in progress.

Working-tree validation passed the retained Node suite, Rust checks/tests/fmt/
Clippy, SBF v0/v3 builds, Windows protected-state checks, Explorer unit/browser
tests, source secret scan, guardrails and provenance review. The isolated forward
chain runs passed security/recovery, service restart and encrypted restore,
acceptance checkpoints, supply accounting, deployment identity, reconciliation
and Native reorg checks. A stale test expectation and retired test selector were
corrected; the affected checks passed again. REGTEST setup mining uses a bounded
longer test-only timeout on mounted Windows storage.

The clean conversion source also passed all four CI jobs with no skipped steps.
Fresh one-way Devnet deployment and a new forward operation are complete:
12 Native confirmations, canonical Borsh V3, exact 1 TEST KPEPE supply increase,
finalized Solana claim and reconciliation MATCH. Restart recognized the same
completed operation without new signing. See the source-bound Devnet report.
Rewritten source `50d8dcb73e254cbba85fdf06c4a1f09626400d4d` passed
[CI 35464725988](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/35464725988):
four required jobs, every step passed, none skipped. The program bytes rebuilt
from that source match the fresh Devnet deployment exactly. Public cutover is
pending the existing Explorer supervisor's Windows elevation confirmation.

The live Explorer remains on its retained TEST deployment until reviewed
forward changes and a fresh compatible Devnet deployment/journal are ready.
Do not reinterpret the historical deployment as Borsh V3.

A verified private mirror and pre-conversion evidence preserve rollback and
provenance. The authorized history filtering is published. The reviewed public
main lineage contains 234 commits and 1,243 unique blobs at the named source;
the retained license/third-party notice history is unchanged. Repository refs,
tags, releases, artifacts and pull-request refs were checked for retained retired
implementation. This review covers project-controlled reachable refs, not other
people's clones or hosting-provider caches. New evidence uses rewritten source
identities and matching CI; old CI never certifies a changed commit.

Phase 19 continues without Mainnet spending. Native/Solana identity and protected
roles were prepared locally, but complete one-way runtime binding/revalidation is
pending. Explicit Mainnet claim and protected forward-controller/credit/sweep
bindings are being validated with default paused/unauthorized behavior. The
retained Node suite and isolated Windows protected-state tests cover their
network, proof, restart and admission boundaries; later changes require their
own matching CI before deployment. No Mainnet transaction has been submitted.
The maintained Native normal fee estimator reports insufficient data;
dynamic sweep fee/cap readiness is blocked until a valid approved estimate exists.
SOL funding must be requested only after other available readiness work is done.

Production flags remain false/disabled. Deployment approval and a controlled
activation amount must be obtained at their specified boundaries. No new roadmap
phase, external audit claim or automatic economic repair is introduced.
