# AGENTS

## Project authority

- Project: KingPepe Native ↔ Solana Bridge
- Owner model: `INDEPENDENT_PROJECT_OPERATED_BRIDGE`
- Governance: `KINGPEPE_PROJECT_GOVERNANCE`
- Backing model: 1:1 Native reserve backing with explicit liability accounting
- Signing: software FROST, `2-of-2` with `requiredParticipants = [A, B]`
- Deployment topology: same-host, project-controlled (`SINGLE_HOST_PROJECT_CONTROLLED_FROST`)
- Mainnet activation: `DISABLED` (authoritative for this repository)
- `productionReady = false`

## Core constraints retained in code and operations

- No physical-host dependency for FROST signers; same-host A/B is approved and documented.
- Normal bridge transfers are automated and must not require per-transfer administrator approval.
- FROST A/B, attestation services, coordinator, observers, and relayers are separate service roles.
- No production secrets are permitted in source, documentation, history, or artifacts.
- `mainnetActivation` and signing/broadcast production authorization remain off by default.

## Current phase status

- Current implementation phase: `PHASE 02 - Recovery, Comparison, and Clean Structure`
- Objective: establish the Solana workspace/layout baseline, compare with NTT, pin baseline dependencies, and prepare compliance artifacts.

## Authoritative status files

- `AGENTS.md`
- `docs/task-status.md`
- `BRIDGE-READINESS.json` (to be created in a later phase)
- `.github/workflows/ci.yml`

## Phase 02 safe commands

- Run guardrail checks:
  - `python .github/scripts/guardrails.py`
- Review staged changes before commit:
  - `git diff --cached`
- Inspect repository remotes and branch:
  - `git remote -v`
  - `git branch --show-current`
- Validate Solana workspace:
  - `cargo check --workspace --all-targets` (run in `solana/`)
- Verify commit and push:
  - `git status`
  - `git log --oneline -n 3`
