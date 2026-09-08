# Native recovery crate

Purpose:

- Prepare offline-safe recovery helpers for temporary deposit control proof flows.
- Keep recovery state modeling distinct from live runtime state.

Implemented in Phase 06:

- CSV maturity checks for block-based BIP68/CSV recovery delays.
- Wrong network/genesis rejection.
- Exact temporary outpoint, amount, and script matching.
- Rejection after mint, canonical reserve sweep, spent UTXO, or observed recovery.
- Fee-bound and dust checks.

This module has no secret material, does not request private wallet material,
and does not sign or broadcast recovery transactions.
