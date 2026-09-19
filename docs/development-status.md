# Current development status

The latest [86-section implementation audit](deployment/final-oneway-audit.md)
is **BLOCKED**, not Mainnet-ready. Reviewed implementation source
`e4fde3be722aa072051d300d50aa681a216af077` passed
[CI 35475685890](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/35475685890)
with all four jobs and every step passed. Its frozen v3 program artifacts and
actual Mainnet rent/fee quote are recorded in that report. A fresh public
forward TEST transfer completed with 1.02 → 1.03 TEST KPEPE supply, exact backing,
canonical live Borsh, finalized claim, idempotent resume and MATCH reconciliation.

Independent blockers remain: the maintained Native node has insufficient normal
fee-estimator data; measured caps, operator sweep-fee funding, protected production
journal/process composition and operational recovery binding are incomplete.
GitHub still serves retired content via old unreferenced commits despite clean
intended public refs. Complete provider-side erasure is not proven. Fee-payer
balance is zero against the current 2.236787960 SOL quote, and real Phantom
acceptance remains manual. Funding is not the only blocker and is not approval.

Explorer Mainnet gateway/recipient preparation is locally reviewed and tested at
`3be9a145a0fffa1b693ecef41493b7e995a71b01`; the live simple TEST interface remains
unchanged. Its stale vendor provenance metadata was corrected to the actually
served one-way helper without restarting services. All six served helper/license
hashes match. Mainnet deployment, official identities and controlled activation
remain pending. The following paragraphs preserve source-bound validation history.

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
The maintained node also lacks a synchronized transaction index. The current
forward observer, independent proof inputs, reserve-credit recovery and relayer
now use explicit block locations or exact unspent-output discovery. Mainnet V2
checkpoints retain verified locations for spent-input reads after restart. A
read-only Mainnet check at height 289,533 passed independent headers/work/Merkle
verification; no transaction was submitted. See
[Mainnet observation](security/native-mainnet-observation.md). This source change
requires its own tests and matching CI and does not clear the fee-estimate blocker.
SOL funding must be requested only after other available readiness work is done.

The retained Devnet Bridge program now includes the reviewed 21M checked-integer
cap from source `4b2812d55dae5d69d40ab4453943591408a4d4ba` (matching CI
`35470732577`). Its upgrade finalized at slot `501083180`; the existing Mint,
configuration, Transceiver and represented TEST supply of 1.02 KPEPE were unchanged.
The reviewed ELF is 206,288 bytes. The loader extended the account by its minimum
allocation and left exactly 10,000 trailing zero bytes. Both the compiled-artifact
hash and the complete deployed-image hash are recorded in
[the Devnet manifest](deployment/devnet.json). The historical zero-supply enrollment
and original deployment transaction remain separately identified there.

Production flags remain false/disabled. Deployment approval and a controlled
activation amount must be obtained at their specified boundaries. No new roadmap
phase, external audit claim or automatic economic repair is introduced.
