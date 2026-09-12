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

Published baseline: fb9f7b6ac7d29a6f1ab7c9072b88f2e11487addc,
tree dad6284c59e1ce2ae6331e8c326e356dcc3573f4. Its exact Actions run
34679522812 is NOT_RUN_ACCOUNT_BLOCKED: four jobs, zero steps/artifacts.
Repository privacy was rechecked. No account or CI policy was bypassed.

The next logical increment fixes confirmed signer startup rollback/corruption
not reaching the durable global stop before the request handler existed.
Startup now validates role/domain, opens existing protected state and reports
only confirmed integrity faults through the retained authenticated incident
outbox. Missing storage/lease contention remains unavailable and fail-closed.
No FROST algorithm, nonce recovery, protection or authorization gate is relaxed.

Frozen candidate and integrated primary runtime: 206 files,
9053a1ef0e55180c957bd0728d9052ff2711ae748febc4937a55831b9d50c1ad.
Actual CurrentUser Windows startup regressions: 14 PASS, zero failed/skipped/
cancelled; existing lifetime fencing regressions: 15 PASS. The valid baseline
probe failed because restored signer state rejected startup without a global
stop. Earlier probes stopped first at the executable hard-link boundary and
are INVALID for this defect, not additional reproductions.

Actual candidate deposit-mode recovery: seven assertion groups PASS, four
controller kills/reopens (deposit observed, Native validated, sweep prepared,
aggregate retained), automatic COMPLETED, independent Linux raw Native and
finalized Solana checks, both exits zero, unchanged runtime hashes. It used a
fresh source-built Windows verifier copied to a standalone external artifact
with its hash unchanged; Cargo's hard-linked output itself remains rejected.
This is NOT distinct service-SID or the complete all-service kill matrix.

A separate remote clean clone of fb9f7b6 passed locked installs, Node 935 and two
vectors per platform, Windows security 166, Rust 97/check/fmt/Clippy, two cold
reproducible SBF build sets, guardrails/provenance/license checks, source and
183-commit scans. npm reported zero vulnerabilities. Five Cargo audits retain
the bincode unmaintained warning. Those results belong to fb9f7b6, not this fix.
Primary Node reruns now pass 935 plus two vectors per platform, zero failures,
skips/cancellations and both exits zero on the unchanged 206-file runtime.
The Windows CI job now builds its genuine verifier using pinned Native Rust
before startup regressions; that CI step remains NOT_RUN_ACCOUNT_BLOCKED.
Publication checks, final remote clean-clone and complete retrospective
validation remain required.

Preserve two earlier failed real-chain runs in the historical audit record:
907bcf3f runtime timed out at claim delivery without observed finalized mint;
d93c130b runtime completed internally but failed the independent Linux recheck.
Their causes are NOT_ESTABLISHED; later passes do not rewrite these failures.
The original ENOSPC malformed-journal fixture was rerun and passed after storage
recovery; its earlier infrastructure failure is neither a code defect nor PASS.

Next: validate/publish this logical startup fix, then remaining actual claim/
settlement kill groups and full fresh-clone Phases 01-08 re-audit. No Phase 09.

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
