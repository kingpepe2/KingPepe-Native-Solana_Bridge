# Solana Program Boundary

## Phase 05 implementation

Phase 05 replaces the placeholder bridge and transceiver crates with Rust
program-boundary logic:

- `kingpepe-transceiver`
  - Validates canonical message domain against configured manager, mint,
    deployment, and key epoch.
  - Requires exactly two distinct authorized attestation identities.
  - Creates verified-message receipts.
  - Rejects duplicate attesters, inactive transceiver state, wrong domains, and
    already consumed receipts.

- `kingpepe-bridge`
  - Enforces protected initialization and rejects reinitialization.
  - Requires zero initial KPEPE supply.
  - Requires mint decimals to match verified Native decimals.
  - Requires the bridge-derived mint authority PDA.
  - Requires freeze authority to be none.
  - Rejects wrong mint, token program, transceiver, PDA, account aliasing, and
    wrong message kind.
  - Consumes transceiver receipts before mint accounting and prevents deposit
    replay.
  - Records Solana-to-Native withdrawals only with a matching BurnChecked model.
  - Keeps burned withdrawals as unpaid liabilities until later settlement.
  - Keeps Mainnet activation disabled.

## Boundary limits

This phase is not a production SBF/Anchor deployment:

- Ed25519 instruction parsing and attestation services are Phase 07.
- Native proof/reserve validation is Phase 06.
- Local validator end-to-end flows are Phase 08 and Phase 09.
- Production program IDs, Mint, ProgramData, and authority manifests are not
  configured.

The current crates provide tested program-state and account-validation logic
that later phases will bind to deployable Solana instructions and IDL.
