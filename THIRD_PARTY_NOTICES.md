# Third-party notices

This repository tracks selected upstream references for architectural guidance.

- `wormhole-foundation/native-token-transfers`
  - License: Apache License, Version 2.0
  - Reference commit: `250d810d42b005526e4fb7e3aea75d2d2ab8fdbb`
  - Use: technical comparison only in the current source tree

- `bitcoin/bips`
  - License: BSD-3-Clause
  - References: BIP-341 Taproot specification and selected wallet test vector
    values from `bip-0341/wallet-test-vectors.json`
  - Use: reference-only Taproot key-path `SIGHASH_DEFAULT` implementation
    guidance and public test-vector verification in
    `native/node/tests/native-taproot-transaction.test.mjs`

- `@noble/curves` `2.3.0`
  - License: MIT
  - Copyright: Copyright (c) 2022 Paul Miller
  - Use: pinned runtime dependency for secp256k1 Taproot/BIP340-compatible FROST implementation and Ed25519 project attestation tests/services

- `@noble/hashes` `2.3.0`
  - License: MIT
  - Copyright: Copyright (c) 2022 Paul Miller
  - Use: transitive dependency of `@noble/curves`

- Rust crates used by the Native proof/reserve/recovery and supporting workspaces:
  - `serde` / `serde_derive` / `serde_core`
    - License: MIT OR Apache-2.0
    - Use: serialization-compatible typed data structures
  - `sha2`, `digest`, `crypto-common`, `block-buffer`, `generic-array`, `typenum`, `cfg-if`, `cpufeatures`
    - License: MIT OR Apache-2.0
    - Use: SHA-256/SHA256d hashing support and transitive hashing dependencies
  - `thiserror` / `thiserror-impl`
    - License: MIT OR Apache-2.0
    - Use: typed Rust error definitions
  - `num-bigint`, `num-traits`, `num-integer`, `autocfg`
    - License: MIT OR Apache-2.0
    - Use: exact 256-bit target, PoW, difficulty, and chainwork arithmetic

No upstream source files are vendored into this repository in this phase.

Phase 08 build tooling is downloaded separately into isolated local/CI storage.
The KingPepe Native reference source, Solana SDK, Node, Rust and Gitleaks retain
their upstream license files there; their sources/binaries are not copied into
this repository or relicensed by its proprietary LICENSE. Tool and source pins
are recorded in `scripts/local-e2e-toolchain.json`. Direct SBF command integration
is original glue code; the upstream compiler is used without source modification.
