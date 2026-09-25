# Reproducible development validation

Use the tool versions and archive hashes in `scripts/local-e2e-toolchain.json`, locked dependencies and external build directories. Native reference source is pinned by commit and archive hash. Solana host Rust is 1.89.0; Native proof uses nightly-2023-10-29. Both SBF programs use platform-tools v1.54 and `--arch v3`; default v0 builds are not interchangeable artifact evidence.

Run `npm ci --ignore-scripts`, `npm test`, required platform tests, dependency/license checks, guardrails and source/provenance checks. The Solana and Native proof workspaces require locked check/test, formatting and Clippy. Publication also requires documentation review and secret scans.

The real-chain regression commands in package.json use fresh isolated REGTEST and Solana local-validator state. They cover Native burn policy, finality, reorganizations, restart, exact accounting, replay and Solana execution. Never reuse a production ledger for tests. Run-time test options are validated by the harnesses. Missing prerequisites are failures, not skipped security checks.

CI includes source history review, reproducible SBF builds, real-chain tests, Node/Rust checks and platform-specific regressions. Each release candidate requires passing CI for that exact commit. The workflow is the executable reference for build and test commands; passing development tests alone does not activate Mainnet or constitute an independent audit.
