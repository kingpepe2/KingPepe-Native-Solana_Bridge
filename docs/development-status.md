# Current development status

The KingPepe Team has authorized permanent one-way conversion and public-history
filtering. Supported direction: KingPepe Native → Solana. Mainnet remains paused.

Current worktree: canonical forward Borsh V3, forward-only Solana ABI, journal,
SDK, API, CLI and recipient UI. FROST remains necessary for reserve sweeps.
The one-way TEST programs and forward operation are validated. The reviewed
public Explorer cutover is complete; Mainnet runtime preparation remains in progress.

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
from that source match the fresh Devnet deployment exactly. Public Home and
Bridge verification passed after the reviewed one-way Explorer deployment:
desktop/mobile navigation and rendering, forward fields, balance reads,
operation refresh/resume, absent retired routes, existing Explorer pages/APIs,
CSP and checked public-secret exposure. Automated wallet checks used an explicit
Wallet Standard fixture; a real Phantom session remains a manual check. The
retired local TEST service stopped after the successful cutover. The live public
Bridge remains REGTEST to DEVNET, using the new one-way deployment and journal.

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
bindings at `bee04e870528837135e839d1441e8bdc49db1da6` passed
[CI 35466341236](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/35466341236):
four required jobs, every step passed, none skipped. Protected Mainnet intake
adds a bounded pending queue, atomic registration, public status projection and
explicit activation admission. Synthetic intake and actual Windows protected
storage tests cover restart, duplicate inputs/submissions and pre-finality
rejection; they do not constitute a Mainnet economic operation. These later
changes require their own matching CI before deployment. No Mainnet transaction
has been submitted and private Mainnet configuration was not changed by this update.
The maintained Native normal fee estimator reports insufficient data;
dynamic sweep fee/cap readiness is blocked until a valid approved estimate exists.
The maintained node also lacks a synchronized transaction index; current
TXID-only confirmed-transaction reads fail, while explicit block-hint reads work.
Production evidence retrieval must be bound to a supported lookup path before
runtime readiness can pass. Neither condition is waived because SOL is unfunded.
SOL funding must be requested only after other available readiness work is done.

Production flags remain false/disabled. Deployment approval and a controlled
activation amount must be obtained at their specified boundaries. No new roadmap
phase, external audit claim or automatic economic repair is introduced.
