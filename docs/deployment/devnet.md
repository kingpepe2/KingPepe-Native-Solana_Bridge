> HISTORICAL RESERVE-MODEL TEST EVIDENCE. This record does not certify the current burn-and-mint source, CI, runtime, counter or production readiness. See ../development-status.md.

# Forward Devnet validation

Only REGTEST â†’ Solana DEVNET is tested. No Mainnet action is authorized here.
The forward-only Borsh V3 program/account layout requires new reviewed test
identities and a clean `KPDECL02` journal. Do not relabel an earlier deployment,
silently migrate its economic records, or regenerate its protected signing state.
Retain historical private evidence and state separately.

`solana/tests/devnet-bridge-service.mjs` uses an explicitly configured local
protected profile and private `SOLANA_DEVNET_RPC_URL`. It verifies Devnet genesis,
the reviewed enrollment manifest, actual ProgramData/authority/Mint/PDAs and
finalized configuration before opening signing state or spending test fees.
It requests no faucet funds and sends no Mainnet transactions.

The service uses the existing journal, forward observer, protected FROST A+B
reserve sweeps, project attesters, receipt and claim delivery. The fresh result
must show COMPLETED, exact authorized supply delta and MATCH reconciliation.
Check canonical Rust/TypeScript bytes against finalized actual instructions.
Record source SHA, artifact identity and public transaction IDs without secrets.

Retained retry/restart checks preserve exact Native and Solana packets. A planned
`NATIVE_SWEEP_BROADCAST` checkpoint permits a same-account encrypted restore
drill. Review actual chain state before resuming; no new signature or broadcast
may be created to hide an already accepted transaction.

Bounded network-edge tests cover pre-finality Native reorg, claim replay and an
already-spent deposit's CSV recovery rejection. They must not damage retained
economic state or overload a public provider. No monitored-soak or historical
CI result automatically certifies a different source.

The public Explorer switches only after fresh forward validation and reviewed
gateway/UI tests pass. Its backend stays loopback-only and authenticated. Wallet
Standard is recipient-only on `solana:devnet`, with exact-Mint balance reads.
