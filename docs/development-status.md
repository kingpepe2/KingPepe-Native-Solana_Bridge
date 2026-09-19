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

These are conversion worktree results, not a clean rewritten-SHA certification.
Fresh one-way Devnet deployment/traffic, public cutover, history filtering and
new exact-SHA CI remain required. The fresh Devnet harness uses 12 Native
confirmations and the approved 1,440-block recoverable-deposit delay.

The live Explorer remains on its retained TEST deployment until reviewed
forward changes and a fresh compatible Devnet deployment/journal are ready.
Do not reinterpret the historical deployment as Borsh V3.

A verified private mirror and pre-conversion working-tree evidence preserve
rollback/provenance. History filtering has not yet run. Old source/CI references
do not validate the new source. New current evidence must identify the rewritten
HEAD, artifact hashes and exact matching CI.

Phase 19 continues without Mainnet spending. Native/Solana identity and protected
roles were prepared locally, but complete one-way runtime binding/revalidation is
pending. The maintained Native normal fee estimator reports insufficient data;
dynamic sweep fee/cap readiness is blocked until a valid approved estimate exists.
SOL funding must be requested only after other available readiness work is done.

Production flags remain false/disabled. Deployment approval and a controlled
activation amount must be obtained at their specified boundaries. No new roadmap
phase, external audit claim or automatic economic repair is introduced.
