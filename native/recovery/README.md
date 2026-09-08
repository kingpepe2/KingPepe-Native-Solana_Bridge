# Native recovery tooling scaffold

Purpose:

- Prepare offline-safe recovery helpers for temporary deposit control proof flows.
- Keep recovery state modeling distinct from live runtime state.

Planned responsibilities:

- Recovery candidate discovery and validation.
- CSV maturity and outpoint checks.
- Duplicate, spent, and cross-network safety checks.

This module has no secret material and does not include live wallet logic.
