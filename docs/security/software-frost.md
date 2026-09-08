# Software FROST A+B

## Phase 04 implementation

The Native signing runtime implements KingPepe Team controlled software FROST with:

- secp256k1 Taproot/BIP340-compatible FROST via pinned `@noble/curves` `2.3.0`.
- Exactly two participants: `KINGPEPE_FROST_A` and `KINGPEPE_FROST_B`.
- Threshold `2-of-2`; no `1-of-2` fallback.
- Coordinator orchestration without a private share.
- Per-signer policy checks before nonce commitment and again before signature share generation.
- Durable nonce reservation before commitments are returned.
- Nonce tombstones before signature material is exposed.
- Independent BIP340 verification of the final aggregate signature.

Signer runtime state is required to live outside the source checkout. Repository examples use placeholders such as `FROST_A_STATE_ROOT` and `FROST_B_STATE_ROOT`; actual local paths are private deployment configuration.

## Native compatibility evidence

Legacy read-only recovery material identifies the Native signing path as Bitcoin-style Taproot/BIP340:

- BIP144 witness transaction encoding.
- BIP341/Taproot `SIGHASH_DEFAULT`.
- P2TR custody script format `5120{32-byte-x-only-key}`.
- 8 decimal atomic Native units.
- Taproot active for KingPepe mainnet and regtest configurations.

Phase 04 validates the FROST signature against the committed 32-byte Taproot sighash. Full Native transaction construction and node acceptance are later Native proof and local end-to-end phases.

## Same-host risk statement

The approved topology runs A and B as separate software participants on the same KingPepe Team controlled computer. This supports automatic normal operation after authorized activation, but it does not provide physical independence:

- A privileged host compromise may affect both participants.
- A host outage may stop both participants.
- Process and filesystem isolation are not equivalent to separate machines.

These are accepted topology risks, not blockers requiring a second physical signing computer. Mainnet activation remains disabled until all readiness gates and the one-time KingPepe Team activation approval are complete.
