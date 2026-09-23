# Current development status

Architecture: ONE_WAY_AUTOMATIC_BURN_AND_MINT. TEST conversion is under validation; Mainnet is not deployed, funded by this task or activated. productionReady=false and mainnetActivation=DISABLED.

The authoritative KingPepe 31.1.0 source at 3f2621820ffefae59cbe48b350f5f8f6ec8a6da5 passed the source burn gate. Actual isolated REGTEST proved a nonzero canonical OP_RETURN burn, exact maxburnamount rejection, UTXO exclusion, restart/full reindex, twelve confirmations and pre-finality reorg rejection. Sixteen Windows protected-runtime checks passed against real REGTEST and a local Solana validator, including a process kill between finalized burn and mint, deliberately lost Native and Solana responses, automatic authenticated-service processing, counter refresh, late/multiple deposits and retained operator pause. The valid operations each deposited, burned and minted 100,000 base units; a separate operational input paid the 235-base-unit miner fee. These worktree results are source-scoped development evidence, not final exact-SHA CI or a Devnet production claim.

Current source removes active FROST, reserve signing/accounting, deposit-only Borsh V3 and the old standalone reserve UI. Borsh V4 includes finalized Native burn evidence. The Explorer burn UI is prepared separately. The retained public REGTEST/DEVNET service and its historical journal have not been relabelled as burn evidence; TEST cutover and a fresh Devnet burn/mint remain pending.

Outstanding gates: final exact-source CI, new real REGTEST -> DEVNET run and recovery/security evidence, reviewed public TEST deployment/verification, dedicated service-identity isolation, encrypted offline key/journal recovery, and architecture-specific Mainnet readiness. Manual Phantom acceptance remains PENDING_MANUAL. Prior reserve-model funding estimates and recovery/CI passes are not current burn-model certification.

`BRIDGE-READINESS.json` carries the machine-readable status. Historical Devnet identities/results remain labelled in the deployment record. No new official Mainnet identity exists.
