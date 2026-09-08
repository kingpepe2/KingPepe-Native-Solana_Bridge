# KingPepe Native - Solana Bridge Development Status

## Current phase

- `PHASE 02` - Clean Solana/Native structure and pinned toolchain
- Branch: `main`
- Repository: private by policy
- `productionReady = false`
- `mainnetActivation = DISABLED`

## What changed in this phase

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

## Current blockers

- Runtime crate behavior and protocol logic remain incomplete in this phase.
- Real Native-compatible FROST remains a Phase 04 requirement.
- Local Windows PowerShell does not expose `cargo`; WSL Cargo is available and was used for locked Rust validation.

## Latest local validation

- `python .github/scripts/guardrails.py`: PASS
- `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL
- `cargo check --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL
- `cargo test --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL, 7 tests

## Next phase

- `PHASE 03` - Canonical protocol messages and accounting model.
