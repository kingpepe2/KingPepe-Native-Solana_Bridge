# Solana observer service

The Solana observer validates localnet deposit-claim results and finalized
withdrawal records before downstream authorization can proceed.

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

Production observation remains disabled until a production-grade source policy
and private deployment configuration are provided outside the repository.
