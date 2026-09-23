# Native node boundary

The RPC client limits bodies, timeouts and methods; sanitizes provider errors; validates matching envelopes; and preserves monetary JSON tokens for exact integer conversion. Cookie/credential files are private and outside Git. The current economic engine is REGTEST burn-and-mint. Mainnet helpers are read-only preparation.

`native-raw-evidence.mjs` collects raw headers and transaction/Merkle data for the independent Native proof executable. `native-taproot-transaction.mjs` parses exact wire transactions and BIP341 signatures. `native-fee-policy.mjs` quotes integers from live Native estimates/floors and source-derived bounds. The burn layer requires exact deposit amount, separate fee inputs and the per-operation maxburnamount ceiling.
