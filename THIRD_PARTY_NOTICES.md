# Third-party notices

This repository tracks selected upstream references for architectural guidance.

- `wormhole-foundation/native-token-transfers`
  - License: Apache License, Version 2.0
  - Reference commit: `250d810d42b005526e4fb7e3aea75d2d2ab8fdbb`
  - Use: technical comparison only in the current source tree

- `@noble/curves` `2.3.0`
  - License: MIT
  - Copyright: Copyright (c) 2022 Paul Miller
  - Use: pinned runtime dependency for secp256k1 Taproot/BIP340-compatible FROST tests and implementation

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
