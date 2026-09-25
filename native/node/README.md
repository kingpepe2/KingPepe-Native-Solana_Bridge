# Native node boundary

The RPC client limits bodies, timeouts and methods; sanitizes provider errors; validates matching envelopes; and preserves monetary JSON tokens for exact integer conversion. Cookie/credential files are private and outside Git. Mainnet burn-and-mint uses explicit Mainnet genesis and protected credential admission; development callers retain separate REGTEST entrypoints. The public Mainnet Bridge is activation pending and accepts no deposits. A read-only helper or network label cannot activate the economic runtime.

`native-raw-evidence.mjs` collects raw headers and transaction/Merkle data for the independent Native proof executable. `native-taproot-transaction.mjs` parses exact wire transactions and BIP341 signatures. `native-fee-policy.mjs` quotes integers from live Native estimates/floors and source-derived bounds. The burn layer requires exact deposit amount, separate fee inputs and the per-operation maxburnamount ceiling.
