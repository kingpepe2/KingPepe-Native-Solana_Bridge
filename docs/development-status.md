# Development status

Cleanup was committed and pushed as e7e7f6f247a18f298cb7d92b247fb2dd43cee609
after source/staged/outgoing/history and publication review. The repository is
PUBLIC; original code remains All Rights Reserved. Baseline before cleanup:
bdb996e45df33535a78d983afab22aa60a47cf15.

## Cleanup

Source inventory: 293 files before, 239 after (55 removed, one small shared
real-validator transaction test helper added). File purposes and origin
classifications are in PROVENANCE.json. Removed README-only placeholders,
unused Rust deterministic test shares, advanced signer fences, registry/file
rollback anchors and duplicated historical reports. Real Noble FROST, nonce
tombstones, process exclusion, DPAPI, replay and durable accounting remain.

Preserved and validated the pending Manager accounting fix: direct SPL burns
must not erase the difference between bridge-issued units and live Mint supply.
A circular import in the withdrawal test harness caused its earlier unsettled
top-level await/hang; the shared packet helper removes that cycle.

## Local results on the pre-commit working tree

- Windows Node: 940 PASS; canonical vectors: 2 PASS.
- WSL Node: 940 PASS; canonical vectors: 2 PASS.
- Rust: 94 PASS; locked check, formatting and Clippy PASS for all four retained
  workspaces. Removed seven unused scaffold tests; added four accounting tests.
- Both SBF programs built and executed on the real local validator.
- Native to Solana: COMPLETED, real A+B FROST accepted by Native, both
  attestations, finalized mint and reconciliation; no per-transfer Team approval.
- Deposit/security/recovery/retry/accounting real-chain checks: 55 PASS.
- Atomic withdrawal-record checks: 29 PASS; subsequent deposit/direct-burn
  counter checks: 5 PASS. These do not include a Native payout.
- Other real-chain runs: acceptance checkpoint 13 PASS; reconciliation 10 PASS
  plus 14 claim checks; deployment identities 18 PASS; Native reorg 8 PASS.
- Windows full security run: 136 PASS, 1 FAIL, zero skipped. Its one failure
  called the removed fence API in a test; corrected to compare actual protected
  signer state. The corrected regression passed independently (1 PASS).
  The removed compatibility-driver comparison is no longer a retained test.
  Do not relabel that earlier full run PASS; a clean current run remains due.
- npm audit: zero vulnerabilities. Cargo audit: no vulnerability failures,
  one unsuppressed bincode 1.3.3 unmaintained warning, RUSTSEC-2025-0141.
- Locked dependency license metadata: PASS on WSL.
- Current-file provenance/boundary check: 239 files, no findings.
- Full historical Gitleaks: 184 commits, no leaks. History boundary review
  identified only dummy credentials in rejection tests, not deployment secrets.
- Historical CI: 158 runs reviewed, 134 executed logs scanned (48.28 MB),
  24 runs with no executed steps; no secrets. One compiler diagnostic used a
  standard GitHub-hosted runner profile, not a Team machine. No artifacts,
  releases or issues were present at review.
- Guardrails: PASS. Fresh-clone validation: PENDING. Exact staged/outgoing
  scanning is required immediately before this cleanup commit/push.

An initial WSL Node invocation inherited the E2E build-root environment and
failed one default-plan fixture; the full clean-environment rerun passed.
These are working-tree results, not certification of a future commit SHA.

Device cleanup attempted only two verified obsolete compiler-output directories;
execution policy rejected deletion before execution. No runtime data, tools,
wallets, backups, source-recovery copies or WSL storage were deleted.

## Next

Exact cleanup clones are validating on Windows and WSL. Begin Phase 09 in a
separate implementation commit; core local gates passed. Fresh-clone evidence
must identify the exact resulting source SHA.

Actions execution resumed after the approved visibility change. Run 34688184212
for cleanup SHA e7e7f6f247a18f298cb7d92b247fb2dd43cee609: history scan and
Foundation Guardrails PASS; Windows failed during protected-helper startup;
Linux E2E is still running at this update. The Windows failure happens before
protected-state tests execute. Fixed-stage-only build diagnostics were added to
identify the runner-specific cause without printing paths, identities or input.
Local compiled-helper tamper/missing/hardlink/ACL regressions: 4 PASS.
The CI failure is not suppressed and is not yet resolved.

CI for baseline bdb996e45df33535a78d983afab22aa60a47cf15:
NOT_RUN_ACCOUNT_BLOCKED, run 34683149831, zero steps/artifacts.
GitHub: "The job was not started because recent account payments have failed
or your spending limit needs to be increased. Please check the 'Billing & plans'
section in your settings". Do not weaken CI or reuse old success.

Phase 08 core: PASS_LOCALLY (pre-commit source; final publication gates remain).
Phase 09: NOT_STARTED.
Devnet, production configuration/deployment and external review: NOT_RUN.
productionReady=false; mainnetActivation=DISABLED.

Full-host rollback resistance, advanced clone detection and cross-service
Windows certification are not Phase 09 gates. No external audit is claimed.
