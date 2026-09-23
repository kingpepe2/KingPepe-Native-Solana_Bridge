# Burn-and-mint real-chain tests

`burn-chain-regression.mjs` runs isolated real REGTEST and a local Solana validator with current SBF artifacts. It verifies deposit and burn finality, Native reorg and maxburnamount rejection, exact separately funded burn, V4 attestation, exact finalized mint, replay rejection and reconciliation. TEST keys are ephemeral in this harness; it is not a production storage implementation.

`burn-runtime-regression.mjs` runs the actual Windows DPAPI service components against owned real chains and kills/restarts a process after finalized burn before mint. It preserves the original destination and recovers exactly once. Fresh Devnet validation and public UI verification are separate required gates. See docs/deployment/local-e2e-build.md.
