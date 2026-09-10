# AGENTS

## Authority and safety boundaries

- Project: KingPepe Native - Solana Bridge; KINGPEPE_TEAM_GOVERNANCE.
- Repository must remain PRIVATE. Original source is proprietary; preserve
  third-party licenses and exact file-by-file PROVENANCE.json coverage.
- Exact software FROST A+B, 2-of-2 on one team-controlled host is approved.
  No second computer, hardware prerequisite or 1-of-2 fallback.
- Valid normal transfers are automatic after user wallet authorization and
  one-time activation. No per-transfer KingPepe Team approval queue.
- Mainnet DISABLED; productionReady=false; productionSigningAuthorized=false;
  productionBroadcastAuthorized=false. No production provisioning, deployment,
  services, signing, broadcasting or activation without the required gates.
- Legacy material is read-only. Do not import legacy Git history.
- Keys, nonce state, databases, logs and machine-specific deployment data stay
  outside the checkout. Do not create secrets inside source and rely on ignores.
- README remains introductory. Repository templates use placeholders.
- Preserve official Solana account.owner and third-party API terms; project
  roles use KingPepe Team terminology.
- Preserve unrelated work; stage explicit files. Scan current/staged files and
  every outgoing commit, verify privacy, push normally and check exact-SHA CI.
  Never weaken security gates or bypass branch protections.

## Current phase

PHASE 08 INCOMPLETE. Phase 09 NOT_STARTED.
Last verified source: 60b873a001fb8b72a3d56daa27cea31b1943c8ef, private push and
all four exact-SHA CI jobs PASS:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34461051003
Its current/staged/outgoing source and all 150 commits scanned clean; zero
workflow artifacts were uploaded. That evidence does not certify newer source.

Current unpublished increment: authenticated local pending-credit journal.
The real harness persists verified finalized backing before Solana setup or
attestation can fail, reopens pending credit, then persists/reopens finalized
mint settlement after observer/reconciliation checks. It reuses the exact
accounting model; no duplicate economic-policy implementation or SQLite addon.
Node 24.21.0 / npm 11.19.0 / bundled SQLite 3.53.4 are now required. The SQLite
API remains release-candidate stability 1.2, not production approval.
See docs/development-status.md for current measured tests and publication state.

The local SQLite journal has context-bound HMAC replay, atomic event/head commits,
exclusive local leases, resource/path bounds and sticky stops. Explicit reopen
never creates missing keys or databases. A retained checkpoint detects an older
database, but co-restoring database and anchor cannot prove freshness. This is
not protected production storage, nonce rollback protection, complete bridge-wide
reconciliation or service restart. Existing claim/sweep/FROST stores have their
own remaining authentication/fencing gaps. Do not equate a local credit journal
with full automated crash recovery. See docs/security/local-deposit-accounting.md.

Real local deposit evidence includes Native-node-accepted FROST A+B BIP340/BIP342
sweeps from user-recoverable scripts into a distinct reserve, two Ed25519
attestations, actual SBF receipt/claim execution and observed SPL supply.
The Node signer uses pinned @noble/curves schnorr_FROST; native/frost Rust is
supporting policy/state-model code, NOT the cryptographic signer.
Canonical choice/UTXO and Solana observation trust the configured local validating
nodes. RPC_OBSERVATION is not independent proof or a production observer.
Production observation, service ACLs/protected storage/IPC, full restart,
global hard stops, post-mint deep-reorg response and external review remain open.

## Build and validation

Use scripts/local-e2e-toolchain.json and docs/deployment/local-e2e-build.md.
Node/npm engines are exact; use verified portable tools without global upgrades.
Solana host Rust 1.89.0; Native crates nightly-2023-10-29.
Linux/WSL SBF: Agave 4.2.2, cargo-build-sbf 4.1.0, platform-tools v1.54.
Programs use solana-program directly, not Anchor-generated IDLs.

- npm ci --ignore-scripts
- npm test
- npm audit --audit-level=low
- python .github/scripts/guardrails.py
- node .github/scripts/dependency-license-audit.mjs (requires Cargo metadata)
- In solana/: cargo fmt --check --all; cargo clippy --locked --workspace
  --all-targets -- -D warnings; cargo test --locked --workspace
- For native/{frost,proof,reserve,recovery}: cargo fmt --check, cargo clippy
  --locked --all-targets -- -D warnings, cargo test --locked with --manifest-path.
- Audit all five Cargo.lock files with the pinned cargo-audit; no ignored
  advisories. Retain the reported bincode 1.3.3 unmaintained warning.
- npm run doctor:local-e2e; npm run local:e2e:native-to-solana
- node solana/tests/local-deposit-security.mjs: fresh external
  KINGPEPE_LOCAL_E2E_ROOT plus the pinned isolated REGTEST/local-validator tools.
  Includes real raw-evidence, CSV, wallet PSBT, pre-mint race, claim-worker retry
  and authenticated accounting-boundary tests. Never use production material.

Windows portable Node tests differ from Linux/WSL SBF or service ACL tests.
Native Windows Cargo is not on this workstation's PATH; use WSL for the combined
dependency-license audit. Windows service ACL/protected-secret integration and
native Windows SBF are NOT_RUN. CI reports Windows Rust results separately.
No runtime/build workspace is uploaded as an artifact.

## Continuity

Authoritative: docs/development-status.md, docs/task-status.md,
BRIDGE-READINESS.json, PROVENANCE.json, UPSTREAM-REFERENCES.json and CI workflow.
Keep prior exact-SHA evidence in status documents, not relabeled as new results.
Implement/test/scan/commit/private-push/verify CI for each coherent increment.
Resolve Phase 08 dependencies before starting Phase 09. Green CI does not
authorize Mainnet, production key creation or an upgrade.
