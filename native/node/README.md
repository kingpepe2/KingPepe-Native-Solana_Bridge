# Native node adapter boundary

Phase 06 models node/RPC observations as public evidence structures in the
`kingpepe_native_proof` crate.

The source distinguishes:

- `RPC_OBSERVATION`
- `LOCALLY_VALIDATED_CHAIN_STATE`
- `PROJECT_ATTESTATION`

RPC data alone is not treated as consensus proof. Live node transport through
the Phase 08 local adapter is implemented for KingPepe REGTEST and remains a
source of `RPC_OBSERVATION` evidence only.

Implemented source:

- `native-rpc-client.mjs` provides a loopback-first KingPepe JSON-RPC client
  for local REGTEST integration.
- RPC methods are allowlisted for chain observation, UTXO checks, controlled
  local broadcast, and local daemon shutdown.
- Auth material is read only from an optional cookie file outside the source
  checkout. Credentials embedded in endpoint URLs are rejected.
- Amounts are converted from raw JSON decimal text into exact atomic units.
- `native-taproot-transaction.mjs` parses and serializes Bitcoin-style Native
  transactions for local REGTEST testing, computes BIP-341 key-path
  `SIGHASH_DEFAULT` evidence from unsigned transactions and public spent-output
  data, and attaches key-path Taproot witnesses after FROST signatures are
  supplied.
- The Taproot helper contains no key generation, private-key loading, signing,
  broadcast, or wallet access.

This adapter does not make production source configuration ready and does not
claim independent consensus validation.
