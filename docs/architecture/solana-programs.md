# Solana Program Boundary

## Current Phase 08 update

Both direct Rust programs compile to SBF and execute the real local deposit
path. The historical Phase 05 model description below is not a complete
on-chain security certification. Initialization authorization needs further
review before Phase 08 security completion.

The transceiver requires the actual current instruction from the real
Instructions sysvar. Two preceding Ed25519 instructions use strict self-indexed
signature/key fields and cross-reference the same canonical bytes in that
transceiver instruction. Wrong indexes, offsets, current program, bytes or
attester identities fail. Receipt creation and later claim/mint are separate
packet-sized transactions; a persistent claim PDA prevents replay.

Actual bridge deposit/withdrawal paths enforce local activation, pause/hard-stop
and environment gates. Deposits enforce Clock validity and exact recipient
token-account binding. Production activation remains unreachable. Tests may
bypass token CPI only in cfg(test); the SBF entrypoint always performs the CPI.
Solana-program 3.0.0 and SPL Token interface 2.0.0 retain traditional SPL Token.
No Token-2022 behavior or alternate minter is introduced.

The local deposit run validates bridge PDA Mint authority, zero initial supply,
freeze authority None, and the finalized 100000000 atomic-unit Mint supply.
Withdrawal daemon E2E, complete security cases and production deployment are
not certified by this run. No Anchor-generated IDL is claimed.

## Historical Phase 05 implementation

Phase 05 replaces the placeholder bridge and transceiver crates with Rust
program-boundary logic:

- `kingpepe-transceiver`
  - Validates canonical message domain against configured manager, mint,
    deployment, and key epoch.
  - Requires exactly two distinct authorized attestation identities.
  - Parses Solana Ed25519 verifier instruction data and binds the verified
    instruction message bytes to the canonical bridge message.
  - Creates verified-message receipts.
  - Rejects duplicate attesters, inactive transceiver state, wrong domains, and
    already consumed receipts.
  - Rejects wrong Ed25519 program IDs, offset substitution, message
    substitution, and duplicate public keys.

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

## Historical Phase 05 boundary limits

This phase is not a production SBF/Anchor deployment:

- Attestation services and Solana observer models are implemented in Phase 07,
  but are not yet connected to local end-to-end flows.
- Native proof/reserve validation is implemented in Phase 06.
- Local validator end-to-end flows are Phase 08 and Phase 09.
- Production program IDs, Mint, ProgramData, and authority manifests are not
  configured.

The current crates provide tested program-state and account-validation logic
that later phases will bind to deployable Solana instructions and IDL.
