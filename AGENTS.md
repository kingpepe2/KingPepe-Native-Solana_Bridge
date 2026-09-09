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

- Current implementation phase: `PHASE 08 - Automatic Native to Solana local end-to-end`
- Objective: connect the automated local Native-to-Solana deposit path using validated Native reserve transitions, project attestations, Solana mint receipt consumption, and reconciliation while keeping live activation disabled outside local testing.
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
- Phase 04 implementation commit: `3494ebf70f9a432bd786ea17ca73a1177d8bf66d`
- Phase 04 CI: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34281044175` PASS
- Required local checks:
  - `npm ci --ignore-scripts`
  - `npm run test:frost`
  - `npm audit --audit-level=low`
- Keep all generated test key material outside the repository.

## Phase 05 phase notes

- Bridge manager must not accept caller-provided proof flags.
- Transceiver owns attestation verification and receipts but must not hold mint authority.
- Mint authority must be a bridge PDA; freeze authority remains none.
- Production activation remains disabled.

## Phase 06 phase notes

- Native proof/reserve/recovery crates validate KingPepe Native headers, PoW,
  difficulty, chainwork, transactions, Merkle proofs, UTXO observations,
  reserve sweeps, and temporary-deposit recovery eligibility.
- Temporary recoverable deposits do not authorize minting.
- CI verified Phase 06 at `836b8e62e2c87fe8b2d3df48f7fc54466206b646`.

## Phase 07 phase notes

- Attestation uses Ed25519 project attestations, not FROST.
- Attestation keys remain separate from Native FROST shares and outside the
  repository.
- Transceiver instruction parsing binds Solana Ed25519 verifier instructions to
  the exact canonical message bytes.
- Solana observer logic must distinguish RPC observation from local validation
  and must `HARD_STOP` on unauthorized program, binary, upgrade-authority, Mint,
  or mint-authority changes.
- CI verified Phase 07 at `d17ba8fe61d20a88d4206f72d68a010a2d146524`.

## Phase 08 phase notes

- Phase 08 has a source-level automatic Native-to-Solana deposit pipeline
  boundary in `services/bridge-validator/automatic-deposit-pipeline.mjs`.
- The pipeline uses existing real FROST A+B signing, project attestation,
  canonical messages, adapter boundaries, replay checks, and exact BigInt
  accounting. It has no per-transfer KingPepe Team approval state.
- Required local executables were not available in the checked environment:
  `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- Current Solana crates include deterministic non-production localnet Program
  IDs and validate-only economic ABI decoding. Solana economic execution is
  still disabled, so they are not ready for a real local-validator E2E flow.
- Do not mark Native-to-Solana local E2E as passed until a disposable
  KingPepe regtest node and Solana local validator execute the full automated
  deposit flow without per-transfer KingPepe Team approval.
- Current local source-boundary check:
  - `npm run test:bridge-validator`
- Current local E2E readiness check:
  - `npm run test:local-e2e-readiness`
  - `npm run doctor:local-e2e` reports
    `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING` until the required localnet
    executables exist and Solana economic instruction execution is implemented.
- Phase 08 local E2E readiness gate commit:
  `6f22309770f3a2f85c96093bcf8af10b47065f31`
- Phase 08 local E2E readiness gate CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34293107931` PASS
- Phase 08 source-boundary implementation commit:
  `09e42e6856312a0c617eb9c14a0312012263722a`
- Phase 08 source-boundary CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34292181114` PASS
- Phase 08 fail-closed Solana entrypoint shell commit:
  `7eafd8a38d346dcb018005a7357a0012a84b0e0c`
- Phase 08 fail-closed Solana entrypoint shell CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34295554332` PASS
- Phase 08 validate-only Solana ABI status:
  instruction decoding and malformed/trailing-data rejection are implemented
  locally; account execution and SPL CPI remain disabled.
- Phase 08 validate-only Solana ABI commit:
  `201c5bdc2a2fb65601331b58115e0a7543179e12`
- Phase 08 validate-only Solana ABI CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34298518315` PASS.
- Phase 08 mint-authority PDA correction:
  the bridge manager now derives the mint authority with Solana
  `Pubkey::find_program_address` seeds and exposes the bump for future account
  initialization.
- Phase 08 mint-authority PDA correction commit:
  `94da519e7a50ea6692c445cfd307beb0fa491347`
- Phase 08 mint-authority PDA correction CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34299827083` PASS.
- Phase 08 Solana account-codec status:
  fixed binary account codecs exist for bridge state, deposit claims,
  withdrawal records, transceiver config, and verified receipts. Account
  execution and SPL CPI are still disabled; source publication/CI verification
  is pending for this increment.
