# KingPepe Native - Solana Bridge

KingPepe Native - Solana is a proprietary bridge project maintained by the
KingPepe Team.

Purpose:

- Provide a reserve-backed representation of KPEPE on Solana through verified,
  policy-driven bridge operations.
- Keep `mainnetActivation = DISABLED` until explicit KingPepe Team approval.

Status:

- Development / Pre-Activation

Production constraints:

- No production secrets, key shares, or wallet material is stored in this repository.
- No per-transfer KingPepe Team approval is required for normal validated operations.
- `productionReady = false`
- `mainnetActivation = DISABLED`

## Build and validation references

- `python .github/scripts/guardrails.py`
- `npm ci --ignore-scripts`
- `npm run test:frost`
- `cargo test --manifest-path native/frost/Cargo.toml` (where operational environment includes matching toolchain)

Copyright (c) 2026 KingPepe Team.
All Rights Reserved.
