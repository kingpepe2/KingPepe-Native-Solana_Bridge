# Native Token Transfers comparison

Rechecked 2026-09-10 against the actual upstream tree, main and releases:
`wormhole-foundation/native-token-transfers` at
`250d810d42b005526e4fb7e3aea75d2d2ab8fdbb`.
Main still identifies this commit (2026-07-30, Sui rate-limit fixes).
Recent releases inspected include CLI 1.10.0+cli (2026-05-22), 1.9.0, 1.8.0 and
EVM 2.0.0. A CLI/EVM release is not a KingPepe Solana production compatibility
certification. No new upstream commit was selected merely to appear current.

| Actual upstream area | KingPepe use | Difference / exclusion |
| --- | --- | --- |
| solana/programs/example-native-token-transfers: manager, inbox/outbox, rate_limit, transfer/redeem/release | Reference-only Manager, claim and permanent backing boundaries | Native reserve verification and liability journal are original, incomplete operationally |
| ntt-transceiver and Wormhole receive-message accounts | Reference-only separation of verification and economic authority | Project-attested A+B Ed25519; no Guardian dependency or attestation-to-consensus equivalence |
| solana/modules/ntt-messages and trimmed_amount | Reference-only typed binary message organization | Original fixed-width protocol, exact eight-decimal Native atomic units; no amount trimming |
| solana/ts versioned IDLs and SDK organization | Comparison only | Direct solana-program implementation; no Anchor-generated IDL or completed SDK claim |
| solana/tests and fixtures | Test-organization reference only | KingPepe REGTEST plus local validator; no upstream Guardian/node fixtures copied |
| solana/fuzz/trimmed_amount | Organization reference, not implemented fuzz coverage | A complete KingPepe fuzz campaign remains pending |
| dummy-transfer-hook, wormhole-governance, other chain programs | Excluded | No Token-2022 hook, imported governance, unrelated chain runtime or official Wormhole chain ID |

Upstream uses its own Solana/Anchor/toolchain/dependency definitions and test
submodules. They were inspected, not copied as compatible defaults. KingPepe pins
its direct SBF compiler, Agave validator, Rust, Node and locks separately in
scripts/local-e2e-toolchain.json. Cargo metadata/locked tests validate that chosen
combination locally; this is not approval for production versions.

Direct reuse: none. Modified source reuse: none. Reference-only architectural use
does not transfer upstream audit coverage. NTT is not KingPepe Native custody,
UTXO verification, Taproot signing, recovery or full reserve/liability accounting.

Upstream root LICENSE is Apache-2.0; no root NOTICE was present in the inspected
tree. No NTT source is vendored or claimed as KingPepe-exclusive third-party code.
Any future source/derived import requires file-by-file provenance and preservation
of applicable copyright, license and notices. Existing BIP-341 derived public
vectors have their own separately preserved terms.

Sources: [pinned tree](https://github.com/wormhole-foundation/native-token-transfers/tree/250d810d42b005526e4fb7e3aea75d2d2ab8fdbb),
[releases](https://github.com/wormhole-foundation/native-token-transfers/releases).
