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

Attestation keys are separate from Native FROST shares. Test construction accepts
an explicitly supplied ephemeral key. Mainnet construction requires the Windows
protected store and the complete expected deployment, key epoch and public
attester identity; a plaintext Mainnet key constructor is rejected. Mainnet policy
accepts only locally validated Native chain evidence. Loading a protected key
does not approve a deposit or activate processing.

The authenticated service uses its own Native evidence verifier, the protected
authorization journal and the matching supervisor. It checks the pause state
before preparation, signing and result release, and persists the exact canonical
signature before acknowledgement. Restart and duplicate requests reuse that
binding; contradictory reserve evidence stops authorization. Callers' proof
booleans are not a substitute for the service verifier. These adapters alone are
not independent consensus or evidence of a deployed production runtime.

This service does not mint, sweep reserves, sign Native transactions, or bypass
the bridge manager/transceiver checks.
