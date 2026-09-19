# Current development status

The KingPepe Team has authorized permanent one-way conversion and public-history
filtering. Supported direction: KingPepe Native → Solana. Mainnet remains paused.

Current worktree: canonical forward Borsh V3, forward-only Solana ABI, journal,
SDK, API, CLI and recipient UI. FROST remains necessary for reserve sweeps.
This is work in progress, not a completed deployment or security certification.

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
Public cutover, final history filtering and new exact-SHA CI remain required.

The live Explorer remains on its retained TEST deployment until reviewed
forward changes and a fresh compatible Devnet deployment/journal are ready.
Do not reinterpret the historical deployment as Borsh V3.

A verified private mirror and pre-conversion working-tree evidence preserve
rollback/provenance. A private history-filter candidate is being reviewed;
public history has not yet changed. Old source/CI references do not validate
rewritten source. New current evidence must identify the rewritten HEAD,
artifact hashes and exact matching CI.

Phase 19 continues without Mainnet spending. Native/Solana identity and protected
roles were prepared locally, but complete one-way runtime binding/revalidation is
pending. The maintained Native normal fee estimator reports insufficient data;
dynamic sweep fee/cap readiness is blocked until a valid approved estimate exists.
SOL funding must be requested only after other available readiness work is done.

Production flags remain false/disabled. Deployment approval and a controlled
activation amount must be obtained at their specified boundaries. No new roadmap
phase, external audit claim or automatic economic repair is introduced.
