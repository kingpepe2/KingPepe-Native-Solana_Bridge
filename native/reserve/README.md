# Native reserve crate

Purpose:

- Track canonical reserve accounting boundaries in code.
- Keep reserve transitions separate from signing and attestation logic.

Implemented in Phase 06:

- Temporary deposits are recorded as recoverable and do not authorize minting.
- Reserve sweeps must spend the exact temporary outpoint.
- Reserve output script, amount, fee, Merkle inclusion, and finality are checked.
- Canonical reserve allocation IDs are stable and single-use.
- Mint credits are consumed once by allocation ID.

No operational secrets are committed in this repository.
