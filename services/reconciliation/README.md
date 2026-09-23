# Burn/mint reconciliation

The active implementation is `services/bridge-validator/burn-journal-state.mjs` with independent chain observations in `burn-runtime.mjs`. Finalized Native burns equal completed/finalized mint obligations plus pending unminted burns. Live official SPL supply cannot exceed cumulative Bridge issuance; issuance cannot exceed verified burns or 21M. Operational fee coins are not issuance credit. A contradiction records a persistent pause; no automatic economic repair exists.
