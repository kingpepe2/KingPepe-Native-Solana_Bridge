# Native reserve crate

Purpose:

- Track canonical reserve accounting boundaries in code.
- Keep reserve transitions separate from signing and attestation logic.

Implemented in Phase 06:

- Temporary deposits are recorded as recoverable and do not authorize minting.
- Reserve sweeps must spend the exact temporary outpoint.
- Reserve output script, amount, separately funded Native fee evidence, Merkle
  inclusion, and finality are checked.
- The credited temporary-deposit amount must become the canonical reserve
  allocation. Native miner fees are tracked separately and must not silently
  reduce the user's backing allocation.
- Canonical reserve allocation IDs are stable and single-use.
- Mint credits are consumed once by allocation ID.

Settlement rechecks the recorded temporary amount and allocation derivation,
then computes all checked totals before removing temporary backing or inserting
consumption markers. Arithmetic failure preserves the entire ledger. Consumed
temporary outputs cannot be reintroduced; failed mint-credit consumption also
leaves existing balances and markers unchanged.

This is an in-memory reserve primitive. Public record fields are not chain proof;
callers must supply independently validated reserve evidence. The crate does not
provide durable journals, service fencing, snapshot rollback detection or the
complete bridge's global reconciliation mechanism.

No operational secrets are committed in this repository.
