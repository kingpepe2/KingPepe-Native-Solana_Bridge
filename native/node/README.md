# Native node adapter boundary

Phase 06 models node/RPC observations as public evidence structures in the
`kingpepe_native_proof` crate.

The source distinguishes:

- `RPC_OBSERVATION`
- `LOCALLY_VALIDATED_CHAIN_STATE`
- `PROJECT_ATTESTATION`

RPC data alone is not treated as consensus proof. Live node transport, regtest
startup, and production observer configuration remain later phases.

Node adapter and RPC abstraction layer will be implemented in this directory.
