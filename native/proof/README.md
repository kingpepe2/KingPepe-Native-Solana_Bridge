# Native raw proof verifier

Locked Native Rust code verifies source-derived KingPepe genesis/header/difficulty/work/transaction/Merkle rules. REGTEST and read-only Mainnet use distinct compiled profiles. Bounded canonical packets and exact transaction membership are required; a configured network label is insufficient.

The original KingPepe source is pinned in scripts/local-e2e-toolchain.json. This crate does not replace full Native block validation, fork choice or UTXO observation. Burn signing and attestation additionally verify current node state, exact input/output scripts, signature, amount and twelve confirmations in native/burn.

Only retained DepositEvidence hash inputs and source proof vectors remain; obsolete reserve-allocation messages are removed. Build/test/check/fmt/Clippy with the pinned Native toolchain and an external target directory.
