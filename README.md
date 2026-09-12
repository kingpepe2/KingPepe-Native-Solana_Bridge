# KingPepe Native ↔ Solana Bridge

A proprietary bridge maintained by the KingPepe Team, providing a
reserve-backed KPEPE representation on Solana.

Native deposits are verified and swept into reserve before minting.
Solana withdrawals burn KPEPE and record the Native payout request.
Normal valid transfers are intended to run automatically after verification.

Status: Development / Pre-Activation. Mainnet is disabled.

With pinned tools: `npm ci --ignore-scripts`, `npm test`.
See [build instructions](docs/deployment/local-e2e-build.md).

Copyright (c) 2026 KingPepe Team. All Rights Reserved.
See [LICENSE](LICENSE); required third-party terms are preserved.
