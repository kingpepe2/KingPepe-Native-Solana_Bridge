# Solana observer service

The Solana observer validates finalized withdrawal records before Native payout
authorization can proceed.

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

Production observation remains disabled until a production-grade source policy
and private deployment configuration are provided outside the repository.
