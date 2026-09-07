# Native reserve adapter scaffold

Purpose:

- Track canonical reserve accounting boundaries in code.
- Keep reserve transitions separate from signing and attestation logic.

Planned responsibilities:

- Canonical reserve allocation records.
- State transitions for sweep, claim, settlement, and rollback.
- Invariant checks for backing and liabilities.

No operational secrets are committed in this repository.
