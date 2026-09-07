# Security and secret publication boundary

## Scope

This repository contains non-secret source code, tests, and build metadata.
Operational secret material must remain outside the repository.

## Enforced rules

- No production keys, signing shares, nonces, session state, or wallet material in source.
- No `.env` files with real values in this repository.
- No recovery, backup, or private operational state files in source.
- Runtime credentials loaded only from private deployment configuration held outside this repository.

## Review rules

- Every phase must include a secret scan of staged and outgoing commits.
- Any policy or governance change must be reflected in `docs/development-status.md`.
- Any file-level secret suspicion found in tracked content blocks release until resolved.

