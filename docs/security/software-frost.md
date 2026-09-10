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
from caller JSON. Authenticated inner DKG transcripts/transport and coordinator
failure cleanup need further hardening.
Signer-state authentication, service access and
rollback assurance remain incomplete. No production signing is authorized and
none of these deficiencies requires a second physical host.

## Complete intent enrollment

The policy now captures the entire normalized 28-field immutable signing intent.
The intent field set is exact: missing fields and unknown additions are rejected
before enrollment or request construction. At authorization, the full intent
digest must match the privately stored snapshot, as well as the independently
checked policy domain, epoch, amount/fee limits, reserve-change script and stop
flags. Purpose, proof fingerprint and unsigned-transaction identity cannot be
substituted while retaining an enrolled request ID and sighash. Public inspection
records remain frozen copies; no mutable enrollment Map is exposed.

The sweep builder supplies that complete intent instead of manually selecting
fields. Partial older enrollment records are rejected, not upgraded with guessed
metadata. The actual Native signature message and existing valid V1 request
digests are unchanged. A digest match states equality with local policy input;
it does not prove Native/Solana chain truth or replace each participant's evidence
validator. A different B policy cannot be overridden by A or the coordinator.
If A already reserved a nonce before B rejects, coordinated abort and uncertain
session recovery remain necessary separate work. No production permission,
protected-state or rollback guarantee follows from this enrollment boundary.

## Signing-request boundary

The current shared V1 builder and validator snapshot plain data and bind request
ID/epoch to the normalized intent, require a positive u32 attempt and exact A+B
ordering, and recompute the session ID from the complete existing V1 transcript.
All nine wire fields are mandatory; unknown fields, accessors and custom
iterators are rejected. Each participant validates the envelope and its local
policy before loading signing state or reading an active key. Commitment and
signature-share calls both enforce the boundary. Coordinator callbacks use the
same immutable normalized intent; original input mutation cannot substitute it.

The Native signature still signs the exact Taproot sighash. Project intent and
session digests are metadata bindings, not a replacement Native message or new
cryptography. Valid V1 transcripts remain identical to the independent fixture.
An unrelated invalid packet is rejected before touching a valid pending session;
this is not complete protocol-abort, uncertain-session recovery or rollback
assurance. The pinned library's own mathematical commitment check is preserved.
Application-specific participant input checks are discussed in
[RFC 9591 section 7.7](https://www.rfc-editor.org/rfc/rfc9591.html#section-7.7);
that reference does not audit this bridge or specify its project DKG protocol.

## DKG deployment boundary

The original V2 DKG context contains its protocol, localnet environment, REGTEST
network/genesis, Solana deployment, Manager/Transceiver IDs, Mint and key epoch.
Hashes are normalized 32-byte lowercase hex; the epoch is a positive u32. Its
canonical project-metadata digest and the exact ordered A/0, B/1 participant-set
digest bind the DKG session. This is application metadata, not a change to the
pinned primitive, its proof of knowledge or the Native signing message.

All request fields are mandatory and unknown fields are rejected. The request,
context and participant records are detached frozen snapshots. Both participants
recompute the binding before any DKG state load, and the coordinator compares
their configured contexts before starting rounds. Signer roles/indexes cannot be
changed after construction. Saved context, session-map key and public/final-key
participant identifiers are checked before reuse; the active key must be in the
exact session for the configured deployment and epoch. Old compatible epochs can
be retained but cannot be selected as the current epoch. Delayed DKG completion
cannot replace a later active epoch: all three rounds reject a request older than
the stored active epoch before writing. This comparison is not rollback proof if
the complete state is restored to an earlier snapshot. Forty retained DKG
records is a local resource ceiling, not a production rotation policy; capacity
failure occurs before creating a new record and never prunes existing material.

Legacy V1 and incompatible state are rejected without automatic migration,
replacement keys or deletion. Fresh isolated local tests use V2; missing or
incompatible production material must never trigger setup. This increment is
not stored-state authentication, confidential/authenticated DKG peer transport,
full inner-transcript retry binding, production key ceremony or rollback/clone
detection. Rewriting all stored metadata with its anchor can defeat structural
checks. Complete DKG finalization retry and uncertain nonce/session recovery remain
open; no assertion of service crash safety follows from metadata validation.

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
