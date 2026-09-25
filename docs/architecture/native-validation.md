# Native burn validation

The Bridge verifies the actual KingPepe Native network and transaction evidence. It does not infer KingPepe behavior from another blockchain. The authoritative source and development tool versions are pinned for reproducible validation.

The Native burn amount remains verifiable on-chain even though the burned output cannot be spent. Deposit observation and burn broadcast alone are insufficient for Solana minting: verified burn finality is required. A changed, orphaned or invalid burn cannot authorize a corresponding mint.

Tests of Native policy and reorganization handling use isolated development chains. They do not constitute a Mainnet transfer or independent audit certification.
