# Attesters service

Attester services produce project attestations for canonical bridge messages
after independent policy and evidence checks.

Phase 07 implements:

- Ed25519 project attestations over the exact canonical message bytes.
- Two distinct attestation roles: `ATTESTER_A` and `ATTESTER_B`.
- Native deposit-credit evidence checks before signing.
- Rejection of RPC-only Native evidence unless the local policy explicitly
  accepts that trust level.
- Rejection of recoverable temporary deposits as mint authority.
- Signature verification and two-of-two attestation combination helpers.

Attestation keys are separate from Native FROST shares. Production key material
is loaded from private deployment configuration outside this repository. Tests
generate ephemeral in-memory keys only.

This service does not mint, sweep reserves, sign Native transactions, or bypass
the bridge manager/transceiver checks.
