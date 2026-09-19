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

Phase 19 adds an explicit `--mainnet-verify` entrypoint. It checks every header
from the pinned Mainnet genesis, including PoW, median time, version, difficulty
retargets and accumulated chainwork, then transaction membership and requested
finality. Mainnet packets are bounded to 1,000,000 headers and 96 MB; the existing
REGTEST entrypoint keeps its 4,096-header/8 MB bounds. The Borsh V2 envelope and
response schemas are unchanged; the genesis and verification entrypoint bind
the network. Mainnet economic verification requires at least 12 confirmations.

Read-only header batches and an in-memory cache avoid refetching unchanged
headers. Cached data still undergoes full Rust verification; it is not a trusted
checkpoint. Reorgs discard the changed suffix. Canonical branch selection and
current UTXO availability still rely on the configured fully validating Native
node; this crate does not validate every block's transaction scripts. A public
coinbase used for read-only chain verification creates no Bridge reserve credit.

The historical Mainnet fixture includes two real difficulty retargets and is
shared with Node tests for exact Borsh digest equality. Boundary tests reject
11 confirmations under the approved 12-confirmation policy. This proof support
does not itself enable Mainnet signing, broadcasting, services or activation.

Non-goals:

- Direct wallet management.
- Secret handling.

No production secrets are tracked in this repository.
