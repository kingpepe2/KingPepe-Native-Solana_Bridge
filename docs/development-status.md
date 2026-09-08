# KingPepe Native - Solana Bridge Development Status

## Current phase

- `PHASE 03` - Canonical protocol messages and accounting model
- Branch: `main`
- Repository: private by policy
- `productionReady = false`
- `mainnetActivation = DISABLED`

## Phase 02 result

- Added root and workspace toolchain pins:
  - `rust-toolchain.toml`
  - `solana/rust-toolchain.toml`
  - Dependency pins in `solana/*/Cargo.toml` and `native/frost/Cargo.toml`
- Created non-empty structural scaffolding directories with policy-safe placeholders:
  - `solana/ts/{idl,lib,sdk,scripts}`
  - `solana/tests`, `solana/fuzz`, `solana/scripts`
  - `native/proof`, `native/reserve`, `native/recovery`
  - `config/schemas`, `config/examples`
  - `deployment/{localnet,devnet,mainnet,windows,manifests}`
  - `shared`, `cli`, `app`, `db-backup`, `scripts`, `monitoring`, `tests`
- Updated comparison and toolchain governance docs:
  - `docs/architecture/ntt-comparison.md`
  - `UPSTREAM-REFERENCES.json`
  - `PROVENANCE.json` (coverage updated to include all tracked files)
- Updated CI action pins in `.github/workflows/ci.yml`
- Added `solana/Cargo.lock` and tightened CI Rust commands to `--locked`.
- Removed the phase-02 Ed25519 signing placeholder dependency from `native/frost`; the current deterministic test-share model is build scaffolding only and is not final Native-compatible FROST.
- Confirmed secret scan remains clean via `python .github/scripts/guardrails.py`.
- Confirmed repository remains private.
- Corrective commit: `218cff1dacea2a2f6ba0564fc49593c85b3f4f9f`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34276946620`
- CI status: PASS

## Current blockers

- Phase 03 GitHub Actions verification is pending for the implementation commit.
- Real Native-compatible FROST remains a Phase 04 requirement.
- Native proof validation, Solana programs, local end-to-end flows, Devnet, production configuration, external review, and activation remain later phases.

## Latest local validation

- `python .github/scripts/guardrails.py`: PASS
- `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL
- `cd solana && cargo test --locked --workspace`: PASS under WSL, 23 tests
- `node solana/ts/scripts/verify-vectors.mjs`: PASS, 2 vectors
- `cargo check --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL
- `cargo test --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL, 7 tests

## Phase 03 local implementation

- Replaced the phase-02 message scaffold with a fixed-length 514-byte canonical binary protocol message.
- Added operation ID derivation and message digest generation with SHA-256.
- Added deposit and withdrawal constructors, domain-bound deployment identity, native outpoint handling, validity windows, policy/key epochs, and bounded destination encoding.
- Added lifecycle states for automatic transfer processing without per-transfer KingPepe Team approval.
- Added exact integer ledger primitives for reserve, minted supply, unminted credits, burned unpaid withdrawals, reserved UTXOs, broadcast payouts, finalized payouts, fees, change, and unsettled operation counts.
- Added shared JSON golden vectors plus Rust and Node verification.

## Next phase

- Push Phase 03 implementation, verify CI for the exact SHA, then start Phase 04 real Native-compatible FROST.
