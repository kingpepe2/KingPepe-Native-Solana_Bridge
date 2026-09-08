# KingPepe Native - Solana Bridge Development Status

## Current phase

- `PHASE 05` - Solana Bridge Manager and Transceiver
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

- Solana Bridge Manager and Transceiver implementation is the current phase.
- Full Native transaction construction, Native node acceptance, local end-to-end flows, Devnet, production configuration, external review, and activation remain later phases.

## Latest local validation

- `python .github/scripts/guardrails.py`: PASS
- `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL
- `cd solana && cargo test --locked --workspace`: PASS under WSL, 23 tests
- `node solana/ts/scripts/verify-vectors.mjs`: PASS, 2 vectors
- `cargo check --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL
- `cargo test --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL, 7 tests
- `npm ci --ignore-scripts`: PASS
- `npm test`: PASS, 2 protocol vectors and 5 FROST Node tests
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities

## Phase 03 local implementation

- Replaced the phase-02 message scaffold with a fixed-length 514-byte canonical binary protocol message.
- Added operation ID derivation and message digest generation with SHA-256.
- Added deposit and withdrawal constructors, domain-bound deployment identity, native outpoint handling, validity windows, policy/key epochs, and bounded destination encoding.
- Added lifecycle states for automatic transfer processing without per-transfer KingPepe Team approval.
- Added exact integer ledger primitives for reserve, minted supply, unminted credits, burned unpaid withdrawals, reserved UTXOs, broadcast payouts, finalized payouts, fees, change, and unsettled operation counts.
- Added shared JSON golden vectors plus Rust and Node verification.
- Commit: `1b95cf0`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34278735928`
- CI status: PASS

## Next phase

- Implement Phase 05 Solana Bridge Manager and Transceiver, then push and verify CI for the exact source SHA.

## Phase 04 local implementation

- Determined from read-only recovery material that the Native signing path is Bitcoin-style Taproot/BIP340 with P2TR custody scripts and 8-decimal atomic Native units.
- Added a pinned Node runtime dependency on `@noble/curves` `2.3.0`.
- Implemented secp256k1 Taproot/BIP340-compatible software FROST for exactly `KINGPEPE_FROST_A` + `KINGPEPE_FROST_B`.
- Implemented two-party DKG without a coordinator private share.
- Implemented per-signer authorization checks bound to a validated operation snapshot.
- Implemented file-backed signer state with source-tree boundary rejection.
- Implemented durable nonce reservation before commitments and nonce tombstones before signature shares.
- Added Node tests proving:
  - A+B produce one aggregate signature verified by independent BIP340 verification.
  - A alone cannot complete signing.
  - B absence does not trigger a weaker threshold.
  - The coordinator alone cannot be constructed as a signer substitute.
  - Wrong sighash, epoch, deployment, recipient, amount, fee, change script, and change amount are rejected before signing.
  - Signing retry is idempotent and does not allocate a second economic signature.
  - Runtime state inside the repository is rejected.
- Commit: `3494ebf70f9a432bd786ea17ca73a1177d8bf66d`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34281044175`
- CI status: PASS
