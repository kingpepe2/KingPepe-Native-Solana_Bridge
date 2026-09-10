# Third-party notices

This repository tracks selected upstream references for architectural guidance.

- Node.js `24.21.0` and its built-in SQLite `3.53.4`
  - Node license: MIT, with separately licensed bundled components retained in
    the runtime distribution's LICENSE. Node is not KingPepe-exclusive code.
  - SQLite deliverable code is dedicated to the public domain by its authors:
    https://www.sqlite.org/copyright.html.
  - Use: external pinned runtime for the original local accounting journal;
    no Node/SQLite source or binary is vendored and no database addon is added.
    Existing distribution notices must accompany any future redistributed runtime.
  - References and archive checksums: `UPSTREAM-REFERENCES.json` and
    `scripts/local-e2e-toolchain.json`. Built-in SQLite is not covered by the
    npm dependency audit; its runtime version and upstream security changes
    are reviewed separately. This is not an external legal or security review.

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
  - BIP-341 authors: Pieter Wuille, Jonas Nick, Anthony Towns.
  - The selected vector values remain third-party BSD-3-Clause material, not
    KingPepe-exclusive data. The test harness around them is original KingPepe
    code. Source: https://github.com/bitcoin/bips/tree/master/bip-0341

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

No complete upstream source implementation is vendored. Selected public
BIP-341 vectors are retained with attribution and their BSD-3-Clause terms.

The pinned Solana dependency graph uses solana-program 3.0.0,
solana-system-interface 2.0.0, spl-token-interface 2.0.0 and their locked
dependencies. Their original licenses remain in the registry packages.
The exact declared-license expressions are checked by
`.github/scripts/dependency-license-audit.mjs`; unknown or missing licenses
fail. This metadata check is not an audit of distributable binary notices.
No third-party dependency is relicensed by the KingPepe LICENSE.

The inherited curve25519-dalek 3.2.1 dependency was replaced with 4.1.3 through
the Solana SDK graph upgrade. The bincode 1.3.3 unmaintained warning remains
reported: https://rustsec.org/advisories/RUSTSEC-2025-0141.html. It is used by the
upstream Solana system-instruction serialization interface. No advisory ignore
has been added; this remains a maintenance concern for later review.

Phase 08 build tooling is downloaded separately into isolated local/CI storage.
The KingPepe Native reference source, Solana SDK, Node, Rust and Gitleaks retain
their upstream license files there; their sources/binaries are not copied into
this repository or relicensed by its proprietary LICENSE. Tool and source pins
are recorded in `scripts/local-e2e-toolchain.json`. Direct SBF command integration
is original glue code; the upstream compiler is used without source modification.

## BSD-3-Clause terms for the selected BIP-341 vector material

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
