# Native Token Transfers (NTT) Comparison

## Reference

- Project: `wormhole-foundation/native-token-transfers`
- Reference commit: `250d810d42b005526e4fb7e3aea75d2d2ab8fdbb`
- License: Apache-2.0
- Date checked: `2026-09-07`

## Why this reference is used

- Message and replay structure patterns.
- Program boundary separation between bridge manager and witness verification.
- Typed account and integration organization for Solana workspaces.

## What is reused in this phase

- Design only, no source file imported yet.
- Planned reuse patterns:
  - Solana workspace layout families.
  - Canonical replay protection and claim tracking model.
  - Test and fuzz organization approach.

## What is excluded in this project

- TON-specific governance, config, and lite-client adapters.
- Chain-specific modules not in scope (EVM/SUI/XRPL patterns).
- Legacy examples or scripts that assume external multi-host Guardian trust assumptions.
- Direct import of any `proof` or `telemetry` code until protocol-specific compatibility is proven.

## Required local differences

- KingPepe Native signature requirements must be handled by project-specific crypto path.
- Same-host dual FROST participants (A+B) are approved by KingPepe Team governance for this project.
- Automatic transfer authorization remains local and policy-driven after user wallet signatures.
- Canonical reserve/liability model is bound to Native-backed operations and reconciliation.

## Compliance notes

- If any upstream file is imported later, license headers and NOTICE lines must be preserved.
- Source hashes for imported commits must match tracked in `UPSTREAM-REFERENCES.json`.
