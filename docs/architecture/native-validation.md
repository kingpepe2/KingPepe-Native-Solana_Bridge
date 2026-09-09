# Native proof, reserve, and recovery validation

Phase 06 adds KingPepe Native validation primitives for source-side evidence.

Implemented boundaries:

- Native chain parameters for Mainnet and regtest from reviewed recovery material.
- 8-decimal atomic KPEPE accounting.
- KingPepe REGTEST local-runner facts from reviewed recovery material:
  coinbase maturity `20`, Bech32m HRP `rkpepe`, and Taproot active from height
  zero.
- SHA256d 80-byte block-header parsing.
- Compact target decoding/encoding, PoW target checks, difficulty retargeting, and chainwork accumulation.
- Header version activation checks for the pinned KingPepe Native rules.
- Bounded transaction parsing for non-witness and BIP144 witness serialization.
- Merkle branch reconstruction and verification.
- UTXO observation checks so Merkle inclusion alone is not treated as proof that a deposit output remains unspent.
- Temporary deposit validation for exact outpoint, amount, script, recipient commitment, finality, and UTXO state.
- Canonical reserve sweep validation before mint credit is authorized; the
  credited temporary-deposit amount must reach canonical reserve, while Native
  miner fees require separate fee-funding evidence and are accounted separately.
- Recovery eligibility checks for CSV maturity, unspent status, wrong network, sweep/mint conflicts, duplicate recovery, fee bounds, and dust.

Trust boundary:

- `RPC_OBSERVATION` is not equivalent to consensus.
- `LOCALLY_VALIDATED_CHAIN_STATE` means the local proof engine accepted headers, work, and inclusion evidence according to configured parameters.
- `PROJECT_ATTESTATION` remains a later attestation layer and does not make unchecked chain data true.

The Phase 06 code does not broadcast transactions, manage wallets, load secrets, or activate Mainnet. Local end-to-end flows with a running KingPepe regtest node remain later phases.
