# AGENTS

## Project authority

- Project: KingPepe Native - Solana Bridge
- Operating model: `INDEPENDENT_PROJECT_OPERATED_BRIDGE`
- Governance role: `KINGPEPE_TEAM_GOVERNANCE`
- Backing model: 1:1 Native reserve backing with explicit reserve/liability accounting.
- Signing model: software FROST, exact `2-of-2` with `requiredParticipants = [A, B]`
- Deployment topology: same-host, project-controlled (`SINGLE_HOST_PROJECT_CONTROLLED_FROST`)
- Mainnet activation: `DISABLED` (authoritative for this repository)
- `productionReady = false`
- `mainnetActivation = DISABLED`
- `productionSigningAuthorized = false`
- `productionBroadcastAuthorized = false`

## Core constraints retained in code and operations

- Same-host FROST A and FROST B are approved and documented. Physical dual-host is not required.
- Normal bridge transfers are automated and must not require per-transfer KingPepe Team approval.
- FROST A/B, attestation services, coordinator, observers, and relayers are separate service roles.
- No production secrets are permitted in source, documentation, commit history, or artifacts.
- Secret-bearing runtime state and operational keys are external to this repository and loaded only from private deployment configuration.

## Current phase status

- Current implementation phase: `PHASE 01 - Safe Foundation`
- Objective: baseline private-source compliance, provenance, and secure guardrails before any additional functional changes.
- Required authority: `KINGPEPE_TEAM_GOVERNANCE`

## Authoritative status files

- `AGENTS.md`
- `docs/development-status.md`
- `docs/task-status.md` (historical)
- `BRIDGE-READINESS.json`
- `PROVENANCE.json`
- `.github/workflows/ci.yml`

## Phase 01 safe commands

- `python .github/scripts/guardrails.py`
- `git status`
- `git remote -v`
- `git branch --show-current`
- `Get-Content -Raw PROVENANCE.json` (local provenance verification)
