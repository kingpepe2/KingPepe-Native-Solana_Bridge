# KingPepe Native ↔ Solana Bridge

This repository contains the implementation of a bridge between **KingPepe Native** and **Solana SPL Token KPEPE**.

## Current operating model

- Project governance: owner/governance-managed project bridge (`KINGPEPE_PROJECT_GOVERNANCE`)
- Signing model: software FROST with exact `2-of-2` policy (`A` and `B`)
- Topology: same-host dual participants are allowed by project approval
- Deployment readiness: project source is being built in phases; production activation is disabled
- `productionReady = false`, `mainnetActivation = DISABLED`

## Trust and safety model

- A transfer requires automated policy checks and verification before mint/payout effects.
- Normal transfers do not require per-transfer administrator approval.
- Secret material, runtime state, and production shares are kept outside this repository.

## Reference lineage

This project uses the Wormhole Native Token Transfers repository as a protocol reference only:

- https://github.com/wormhole-foundation/native-token-transfers

Initial inspection target (legacy pointer) was:
`250d810d42b005526e4fb7e3aea75d2d2ab8fdbb`

Any reused upstream component will be recorded with exact commit references and license provenance in
`UPSTREAM-REFERENCES.json`.

## Repository status

- This repository is under active multi-stage implementation.
- Current phase: Stage 01 (safe foundation and guardrails).
- No production keys, keyshares, wallets, or private endpoints are stored here.

## Build and validation commands

Foundation checks currently available:

- `python .github/scripts/guardrails.py`
- `git status`
 
## License

Project license file is `LICENSE`.
