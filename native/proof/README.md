# Native proof adapter scaffold

Purpose:

- Define the Native verification interface required by the bridge validator.
- Keep chain-state proof handling separated from service orchestration.

Planned responsibilities:

- Header and block header chain verification policies.
- Transaction parsing and merkle proof checks for qualifying deposits.
- Chain finality and checkpoint binding checks.

Non-goals in this phase:

- Production proof providers.
- Direct wallet management.
- Secret handling.

No production secrets are tracked in this repository.
