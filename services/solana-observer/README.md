# Solana observer service

The implemented RPC adapter reads localnet deposit-claim results. Withdrawal
validation is a separate policy model over supplied observations, not a running
withdrawal or deployed-program monitoring service.

Phase 07 implements:

- Explicit source-boundary states: `RPC_OBSERVATION`, `LOCAL_VALIDATION`, and
  `PROJECT_ATTESTATION`.
- Finalized transaction/root checks.
- Bridge program, transceiver program, ProgramData, binary hash, and upgrade
  authority identity checks.
- Mint, Token Program, PDA mint authority, decimals, and freeze-authority
  checks.
- Withdrawal-record and BurnChecked consistency checks.
- Direct-burn rejection when no bridge withdrawal record exists.
- `HARD_STOP` on unauthorized program, binary, upgrade-authority, Mint, or
  mint-authority changes.

Phase 08 adds a localnet-only deposit-claim observer:

- Loopback-only Solana JSON-RPC access for local validation.
- Finalized transaction, root slot, bridge deposit-claim account, and SPL Mint
  account reads.
- Decoding of the bridge deposit-claim account layout emitted by the local
  manager program test path.
- Freeze-authority extraction so downstream checks can reject a configured Mint
  with freeze authority set.
- No production RPCs, keys, Program IDs, Mint identities, or operational state.

ProgramData/hash/authority comparisons above do not independently fetch or verify
deployed bytecode. Localnet RPC is bounded and fail-closed, not trustless consensus.
Production observation remains disabled; configuration alone cannot enable it.
See [trust boundaries](../../docs/architecture/attestation-and-observation.md)
and the Phase 08.5 audit for missing service-wide protections.
