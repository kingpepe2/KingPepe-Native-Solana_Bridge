# Software FROST A+B

## Review boundary (2026-09-10)

The pinned upstream release explicitly identifies its FROST implementation as
new and unaudited. Native node acceptance and independent BIP340 verification
are compatibility evidence, not a security audit of FROST, DKG or this bridge.
Do not transfer audit claims from other portions of the library to this component.
See the [upstream FROST warning](https://github.com/paulmillr/noble-curves/blob/2.3.0/README.md#frost-threshold-signatures).

A read-only diagnostic reproduced matching Mainnet-policy approval and mutation
of the exposed authorized-operation Map on the preceding source. No keys,
signing or network were used. The current original policy implementation rejects
both paths: creation requires localnet and the pinned REGTEST genesis, the lookup
is module-private, and all exposed authorization records/arrays are frozen copies.
Clones, proxies and caller-built lookups are not recognized policy capabilities.
Explicit attempts to enable production flags fail closed. A separate local
DKG-only capability permits disposable setup but never transaction signing.

Policy data uses exact u64 amounts, positive u32 epochs and canonical u32
outpoints. Accessors, proxies, sparse arrays, duplicate request IDs, malformed
pause/stop flags and out-of-range input indexes are rejected. Resource ceilings
are 256 operations, 256 inputs, 256 output commitments, 40 record fields and
10000 bytes per nonempty script. These are local API ceilings, not approved
production transfer limits or assertions of Native consensus maxima.

These controls protect cooperative API use, not arbitrary hostile code with
process/host access. Policy enrollment is not proof of chain truth; each signing
participant still needs its independent configured raw-evidence checks. The
current in-memory policy is reconstructed from validated evidence, not restored
from caller JSON. Request-envelope/intent identity and DKG deployment transcript
binding need further hardening. Signer-state authentication, service access and
rollback assurance remain incomplete. No production signing is authorized and
none of these deficiencies requires a second physical host.

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

Phase 04 originally validated the committed 32-byte Taproot sighash. Phase 08
now constructs real test transactions and obtains independent REGTEST node
acceptance, including recovery-script sweeps. Exact-SHA evidence is in
[development status](../development-status.md); this does not establish
production signing, full restart/rollback safety or an external security audit.

## Same-host risk statement

The approved topology runs A and B as separate software participants on the same KingPepe Team controlled computer. This supports automatic normal operation after authorized activation, but it does not provide physical independence:

- A privileged host compromise may affect both participants.
- A host outage may stop both participants.
- Process and filesystem isolation are not equivalent to separate machines.

These are accepted topology risks, not blockers requiring a second physical signing computer. Mainnet activation remains disabled until all readiness gates and the one-time KingPepe Team activation approval are complete.
