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

Attestation keys are separate from Native FROST shares. The current class accepts
an explicitly supplied test key, copies it into private memory and fixes its
policy/identity. A protected production key-loading adapter is NOT_IMPLEMENTED;
no production keys are loaded or provisioned by this source. Tests generate
ephemeral in-memory keys only. Policy checks and local E2E raw-evidence callbacks
are not a standalone production validating service or independent consensus.

This service does not mint, sweep reserves, sign Native transactions, or bypass
the bridge manager/transceiver checks.
