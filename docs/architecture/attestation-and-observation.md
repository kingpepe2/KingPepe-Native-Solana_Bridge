# Attestation and Solana observation

## Phase 07 implementation

Phase 07 adds service-level attestation and observation code. It does not deploy
Solana programs, configure production identities, or authorize Mainnet.

Project attestations use `PROJECT_ATTESTED_2_OF_2_ED25519`:

- Attestation A and Attestation B are distinct Ed25519 identities.
- Attestation keys are not Native FROST shares.
- Each attester validates canonical message domain, epochs, Native evidence,
  finality, reserve transition state, mint-credit availability, amount,
  recipient, and evidence digest before signing.
- The attester signs the canonical binary bridge message bytes, not JSON.
- One attestation or the same attester twice is rejected.

The transceiver model now validates Solana Ed25519 verifier instruction layout:

- Exact Solana Ed25519 verifier program ID.
- One signature per instruction.
- Public-key, signature, and message offsets are bounded.
- The signed message bytes must equal the canonical bridge message bytes.
- The attester public keys must be two distinct configured identities.

The Solana observer validates finalized withdrawal evidence:

- RPC observation is separated from local validation and project attestation.
- RPC-only evidence is not promoted to local validation.
- Program IDs, ProgramData addresses, binary hashes, upgrade authorities, Mint,
  Token Program, mint authority PDA, decimals, and freeze authority are checked.
- Unauthorized program, binary, authority, or Mint changes create `HARD_STOP`.
- Direct SPL burns without bridge withdrawal records create no Native payout
  entitlement.

## Remaining limits

- This is not a trustless Solana light client.
- Production observer configuration is still absent; Mainnet remains disabled.
- Local validator end-to-end flows are later phases.
- External review has not been performed.
