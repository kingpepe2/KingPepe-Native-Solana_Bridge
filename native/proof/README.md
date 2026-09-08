# Native proof crate

Purpose:

- Define the Native verification interface required by the bridge validator.
- Keep chain-state proof handling separated from service orchestration.
- Validate KingPepe Native headers, PoW, difficulty, chainwork, Merkle proofs,
  transaction outputs, finality, and UTXO observations.

Implemented in Phase 06:

- Header and compact-target validation.
- Mainnet/regtest parameter binding from reviewed recovery material.
- Bounded transaction parsing.
- Merkle branch reconstruction.
- Temporary-deposit validation.
- UTXO-state checks so Merkle inclusion alone is not sufficient.

Non-goals:

- Production proof providers.
- Direct wallet management.
- Secret handling.

No production secrets are tracked in this repository.
