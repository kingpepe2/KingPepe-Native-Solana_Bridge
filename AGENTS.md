# AGENTS

## Project authority

- Project: KingPepe Native - Solana Bridge
- Operating model: `INDEPENDENT_PROJECT_OPERATED_BRIDGE`
- Governance role: `KINGPEPE_TEAM_GOVERNANCE`
- Backing model: 1:1 Native reserve backing with explicit reserve/liability accounting.
- Signing model: software FROST, exact `2-of-2` with `requiredParticipants = [A, B]`
- Deployment topology: same-host, project-controlled (`SINGLE_HOST_PROJECT_CONTROLLED_FROST`)
- Mainnet activation: `DISABLED` (authoritative for this repository)
- `productionReady = false`
- `mainnetActivation = DISABLED`
- `productionSigningAuthorized = false`
- `productionBroadcastAuthorized = false`

## Core constraints retained in code and operations

- Same-host FROST A and FROST B are approved and documented. Physical dual-host is not required.
- Normal bridge transfers are automated and must not require per-transfer KingPepe Team approval.
- FROST A/B, attestation services, coordinator, observers, and relayers are separate service roles.
- No production secrets are permitted in source, documentation, commit history, or artifacts.
- Secret-bearing runtime state and operational keys are external to this repository and loaded only from private deployment configuration.

## Current phase status

- Current implementation phase: `PHASE 04 - Real Native-Compatible FROST 2-of-2`
- Objective: validate and publish the real secp256k1 Taproot/BIP340-compatible `2-of-2` FROST runtime.
- Required authority: `KINGPEPE_TEAM_GOVERNANCE`

## Authoritative status files

- `AGENTS.md`
- `docs/development-status.md`
- `docs/task-status.md` (historical)
- `BRIDGE-READINESS.json`
- `PROVENANCE.json`
- `.github/workflows/ci.yml`

## Phase 01 safe commands

- `python .github/scripts/guardrails.py`
- `git status`
- `git remote -v`
- `git branch --show-current`
- `Get-Content -Raw PROVENANCE.json` (local provenance verification)

## Phase 02 safe commands

- `python .github/scripts/guardrails.py`
- `cd solana && cargo check --locked --workspace --all-targets`
- `cargo check --locked --manifest-path native/frost/Cargo.toml`
- `cargo test --locked --manifest-path native/frost/Cargo.toml`
- Stage intended files explicitly after review.
- `git status`
- `git diff --name-only`

## Phase 02 phase notes

- Added initial non-empty structure directories and configuration schema templates under:
  - `solana/ts`, `solana/tests`, `solana/fuzz`, `solana/scripts`
  - `native/proof`, `native/reserve`, `native/recovery`
  - `config`, `deployment`, `db-backup`, `shared`, `cli`, `app`, `scripts`, `monitoring`, `tests`
- Pinned toolchain and dependency versions in manifest files.
- Added locked dependency files for the current Solana and native Rust workspaces.
- Removed the phase-02 Ed25519 placeholder dependency from the native runtime to keep CI compatible with the pinned toolchain.
- Kept all sensitive runtime data and live credentials outside repository scope.
- Updated source comparison records: `UPSTREAM-REFERENCES.json`, `docs/architecture/ntt-comparison.md`.
- The Rust crate remains supporting policy/state scaffold. Phase 04 Native signatures are implemented in the Node FROST runtime.

## Phase 03 phase notes

- Keep message authorization binary and canonical; do not use JSON as an economic authorization encoding.
- Use exact integer accounting only.
- Keep production readiness false and Mainnet activation disabled.

## Phase 04 phase notes

- Do not treat Ed25519 attestation or phase-02 deterministic Rust test shares as FROST.
- KingPepe Native signing evidence from read-only recovery material identifies the required path as Taproot/BIP340.
- The Phase 04 runtime uses pinned `@noble/curves` `2.3.0` `schnorr_FROST`.
- Required local checks:
  - `npm ci --ignore-scripts`
  - `npm run test:frost`
  - `npm audit --audit-level=low`
- Keep all generated test key material outside the repository.
