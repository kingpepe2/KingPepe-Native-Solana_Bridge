# AGENTS

## Authority and safety

- KingPepe Native - Solana Bridge; KINGPEPE_TEAM_GOVERNANCE. Keep source PRIVATE.
- Original source/documentation is proprietary; preserve required third-party
  notices and exact file-by-file PROVENANCE.json coverage.
- Approved software FROST: exact A+B, 2-of-2, one Team-controlled host. No
  fallback, second-computer requirement or hardware prerequisite.
- Preserve @noble/curves 2.3.0 schnorr_FROST secp256k1/BIP340 and applicable
  BIP342 sighashes. Upstream FROST is UNAUDITED. Ed25519 is separate attestation
  and Solana transaction signing, never Native payment signing.
- Normal transfers are policy-authorized automatically. No per-transfer Team
  approval; missing evidence never becomes authorization.
- productionReady=false; mainnetActivation=DISABLED;
  productionSigningAuthorized=false; productionBroadcastAuthorized=false.
  No production provisioning, services, deployment, signing, funds or activation.
- Phase 09 is NOT_STARTED. Finish the retrospective audit, report the entry-gate
  verdict, then wait for explicit KingPepe Team instruction.
- Legacy material is read-only. Preserve recovery data and original work; no
  destructive Git operations or history imports.
- Keys, protected blobs, nonce state, ledgers, databases, logs and machine-specific
  data remain outside every checkout. No plaintext fallback or replacement-key
  creation on missing storage. README stays introductory; templates use placeholders.
- Project roles use KingPepe Team; preserve official Solana account.owner terms.

## Current exact continuation

Latest PRIVATE publication: 27a4fcf647ccb9518d003eff46c9a152ae0b6ba8,
tree 2c6db89e624a725fc64d5277e1a949cded38a3a6.
Its 279-file protected-delivery increment passed Windows/WSL Node 879 plus two
vectors each, Windows security 147, Rust 97/check/fmt/Clippy, two reproducible
cold SBF build sets, real-chain suites 55/26/18/8/13, raw credit ten and renewed
Linux/Windows reconciliation ten/eight. Actual Native/Solana outbox kill/reopen
checks passed eight/nine, each with fourteen chain checks and COMPLETED.
These are their documented component scopes, not full controller certification.
Source/staged, 181 preceding commits and its outgoing commit passed scans.
Exact Actions 34673553925: NOT_RUN_ACCOUNT_BLOCKED, four jobs with zero steps
and zero artifacts. No CI/security/account policy was bypassed.

The current primary worktree integrates a separate protected Localnet controller,
canonical fee payer and authenticated attester clients. The frozen candidate's
205-file runtime digest is
eec0c7c8f970345c807515404ba08a18cdb30d330f498091db7e79cc1cdca026.
Its Windows/WSL Node runs pass 924 plus two vectors each. Its actual separate
CurrentUser Windows service processes reached COMPLETED through real Native
FROST, sweep/finality, both attestations, receipt/claim, mint/finality and
reconciliation; independent Linux chain rechecks and both process exits pass.
This is NOT cross-service SID certification or the full process-kill matrix.
The candidate full Windows security suite passed 164, zero failed/skipped/
cancelled, with exit zero and unchanged runtime hashes (2831192.5148 ms).
Primary integration/restart tests and final clean-clone validation remain
required. Primary adds five portable preparation/negative-lookup regressions;
all five pass. Do not attribute these newer tests to the frozen candidate.

A prior actual controller run failed before first claim enqueue: an absent
protected delivery record was mistaken for a dependency failure indefinitely.
The correction accepts only an authenticated, exactly bound NOT_ENQUEUED result,
never treating it as finality, enqueue acceptance or permission. Auth, storage
and transport failures still reject. Preserve the failed-run record.

Primary Node reruns pass 929 plus two vectors per platform on the frozen
205-file runtime 907bcf3f6e8168fe8bf0cdf5102cbaebb4142a62b5b5b46ebd830e73b6b401a0.
Its first actual protected-chain rerun FAILED at repeated claim delivery without
an observed finalized mint by the bounded deadline; both harnesses exited one.
The actual cause remains under investigation. Do not substitute candidate
success or assume an infrastructure failure. Full primary Windows security
passes 164, zero failed/skipped/cancelled, exit zero in 2893931.3578 ms;
its runtime digest is unchanged before/after. A separate candidate adds narrowly redacted preflight diagnostics
and selected actual process-kill/reorg tests; these are not yet chain-certified.

Separate candidate d93c130b98a5e6bafb64c9f72ad3e831b7014f613c8bf24a372b6ec066697e2d
exercised five real controller broadcast/credit kills and internally COMPLETED,
but the independent Linux recheck failed before publishing its result. The
overall run is FAIL, not a replacement for the failed primary run. Both causes
remain under investigation; do not assume infrastructure, expiry or consensus
failure without evidence. New host-stage/filtered transaction diagnostics have
six added portable tests (87-pass targeted subset), not a new full-suite result.

A newer separate candidate, runtime c5b55565dfe2c9a7f8d8be813167f00c32f29a038b891f9afa838a43d694f182,
passes nine actual-chain assertion groups: controller kills at retained mint,
pending reconciliation and completed journal; protected flow COMPLETED;
independent Linux reserve/mint checks; genuine higher-work post-mint Native fork;
exact incident retention; all protected service processes and authority reopened
with the stop retained; chain health recovery did not clear the stop or change
Solana supply. Both harnesses exit zero; runtime hashes are unchanged. This
does not retroactively certify either failed run above, cross-SID separation,
host reboot or the complete kill matrix. The two focused concurrent guard-status
tests pass; the suspected guard collision was not reproduced and no speculative
guard implementation change was made.

The reviewed changes are now integrated into the primary 205-file runtime
df5ef0920b5c4a1315384fd43d223dee7f99aea186989d4921828d851e188d6f.
Fresh primary Node runs pass 935 plus two vectors per platform, zero failed/
skipped/cancelled, both exits zero. Actual primary broadcast/credit recovery
passes eleven assertion groups, including all five real kills/reopens, independent
Linux chain rechecks, protected flow COMPLETED, post-mint higher-work fork and
retained stop over all protected service process restarts/chain recovery. Both
harnesses exit zero and runtime hashes remain unchanged.
Do not attribute older Windows full-security counts to this newer runtime.

Resume with remaining deposit/claim kill groups, fresh primary settlement
coverage and the final clean-clone/full re-audit. Do not replace
actual-chain behavior with synthetic test fixtures. The original ENOSPC
malformed-journal fixture failure was rerun and passed after host recovery;
the earlier infrastructure failure is neither a code defect nor passing evidence.

## Evidence and remaining boundaries

Authoritative status: docs/development-status.md, docs/task-status.md,
docs/phase-08-5-audit.md and BRIDGE-READINESS.json. Prior dated increment records
remain historical; never relabel old passing results as evidence for newer code.
Update status after logical increments without circular self-SHA edits.

- Full protected service restart/side-effect matrix and final re-audit remain
  incomplete. Do not promote Phases 04/07/08 solely from component passes.
- Cross-service DPAPI/ACL certification requires an isolated elevated Windows
  environment with distinct temporary service principals. The current token is
  non-elevated; same-principal tests do not certify cross-account denial.
- Retained profile witnesses reject stale file packages while the witness is
  current. Full privileged host/profile/state co-restore is not absolutely detected.
- Native canonical choice and UTXO state rely on the configured validating node.
  Solana remains RPC_OBSERVATION, not independent consensus or a trustless proof.
- An off-chain stop cannot revoke previously released attestations or transactions.
  No automatic economic repair, confiscation, remint or integrity-stop clearing.
- Capacity/credential/credit-window exhaustion fails closed; production recovery
  and rotation are not certified by a short Localnet run.
- Monitor host headroom. New compiler outputs use external development storage.
  Disposable Linux tmpfs chains prove process recovery, not host-reboot durability;
  protected Windows journals remain on disk. Do not repair, compact or recreate WSL.

## Actual build and test commands

Pins: scripts/local-e2e-toolchain.json and docs/deployment/local-e2e-build.md.
Use verified process-local tools and external runtime/output directories.

- Node 24.21.0 / npm 11.19.0 / SQLite 3.53.4. Wrong runtime fails with
  LocalLedgerPinnedRuntimeRequired; do not relax it.
- Rust/Cargo 1.89.0 for Solana host; nightly-2023-10-29 for Native crates.
- Linux/WSL Agave/validator 4.2.2; cargo-build-sbf 4.1.0; platform-tools v1.54.
  Direct SBF programs, not an Anchor CLI/IDL build.
- Native node/CLI 31.1.0 from pinned authoritative source, isolated REGTEST only.
- npm ci --ignore-scripts; npm test; npm audit --audit-level=low.
- Windows: npm run test:windows-security (actual CurrentUser DPAPI, not distinct SIDs).
- python .github/scripts/guardrails.py; node scripts/source-audit.mjs.
- node .github/scripts/dependency-license-audit.mjs with configured Cargo metadata.
- In solana/: cargo check --locked --workspace --all-targets;
  cargo test --locked --workspace; cargo fmt --check --all;
  cargo clippy --locked --workspace --all-targets --all-features -- -D warnings.
- Native frost/proof/reserve/recovery: corresponding locked manifest check/test,
  fmt --check, clippy --all-targets --all-features -- -D warnings.
- Audit all five Cargo.lock files without ignored advisories. Retain the visible
  bincode 1.3.3 RUSTSEC-2025-0141 unmaintained warning.
- Actual chain scripts: solana/tests/local-deposit-security.mjs,
  local-withdrawal-record.mjs, local-deployment-integrity.mjs,
  local-native-reorg.mjs, local-acceptance-checkpoint.mjs,
  local-protected-claim-observation.mjs and local-reconciliation.mjs.
- New protected controller pairs solana/tests/local-windows-protected-controller-host.mjs
  with tests/windows/local-protected-controller.mjs using isolated external test
  control/state roots. It requires real Linux chains and verified Windows Native
  verifier plus protected services; it does not deploy production.
- Every daemon run uses a NEW external KINGPEPE_LOCAL_E2E_ROOT. No existing ledger
  reset. Bind source SHA plus dirty runtime digest when applicable.
- Fresh-clone evidence requires fresh compiled outputs, not copied build targets.

Windows portable tests are not Windows SBF/Anchor or service-account certification.
Never upload an entire workspace, ledger, target/deploy or generated keypair.

## Publication

Implement -> relevant tests -> source/staged/outgoing/artifact scans -> exact
diff review -> explicit staging -> clear commit -> PRIVATE push -> exact-SHA CI
when executable. Respect protections; no bypass. Account-blocked CI is NOT_RUN.
Continue safe source work despite that external blocker. CI is not Mainnet authority.
