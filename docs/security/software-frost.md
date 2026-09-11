# Software FROST A+B

The Phase 08.5 [Windows protected-storage component](windows-protected-storage.md)
adds real DPAPI-backed DKG/share persistence and local encrypted restart tests.
It does not close the service-isolation, IPC, persistent-fencing or full-rollback
findings. The Linux local-chain harness remains an isolated test-file runtime.

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
from caller JSON. Authenticated inner DKG transcripts/transport and durable
coordinator/signer restart recovery need further hardening.
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
If A already reserved a nonce before B rejects, the synchronous coordinator now
requests bound cleanup from both participants. V2 uncertain-session recovery is
described below; complete service restart remains separate work. No production permission,
protected-state or rollback guarantee follows from this enrollment boundary.

## Coordinated abort boundary

The synchronous coordinator attempts cleanup on both A and B after commitment,
share or aggregate processing fails. This includes calls that may have persisted
and then lost their response. Each abort uses the complete validated V1 request;
bare session IDs, altered metadata and accessors fail before state access.
An unknown valid session returns NOT_RESERVED without writing. An existing
session must match the saved deployment, request, public commitment, counter and
tombstone. Counters require canonical u64 decimal strings; numeric JSON values
are rejected even with recomputed metadata. Missing or contradictory records
are rejected without repair.
No active private-key deserialization or new policy approval is needed to destroy
an existing reservation. RESERVED becomes ABORTED/CONSUMED and its volatile nonce
is discarded before acknowledgment; SIGNED shares are preserved. Repeated abort
is idempotent. Stored share material cannot be hidden by an ABORTED label.

The eight-field local receipt binds protocol, role, request, epoch, session,
intent digest, Native message and outcome. All fields are mandatory and exact.
This is not a cryptographic proof that an untrusted peer erased a nonce. Service
identity and authenticated IPC are separate requirements. Cleanup continues to
the other participant after a failure. Any unconfirmed response permanently
refuses signing in that coordinator instance, with a fixed error excluding
underlying storage/transport details. Callback reentry is rejected; there is no
reset or 1-of-2 fallback. Completed shares are not removed to manufacture a retry.

This is cooperating synchronous-runtime handling, not durable global fencing,
automatic process recovery, full rollback/clone detection or protected storage.
V1 JSON nonce removal was not forensic erasure. V2 no longer serializes these
secret nonce bytes and handles uncertain reservations as described below.
Disk-full/response-loss tests inject failures around
real external file writes, not physical power failures or a filled production
volume. No production signing or services are authorized by these tests.

## Local state creation and reopen boundary

Fresh local setup explicitly calls `FileBackedFrostStateStore.createLocal` with a
genuine immutable localnet/REGTEST policy. The capability is checked before any
filesystem operation. Only exact A/B roles are accepted. Exclusive file creation
prevents competing setup processes from overwriting the same initial envelope;
it does not lease the running signer. DKG-only setup does not acquire transaction
authorization. Signing coordinators reopen the already enrolled state.

Ordinary load/save reject missing, malformed, incompatible or wrong-role state;
neither creates replacement keys nor repairs the file. Saves check both the new
envelope and the current file before committing. Nonce counters are canonical
u64 strings, not coerced Numbers; dictionary fields cannot be arrays. Fixed I/O
and JSON parse errors omit underlying paths/content. Existing checkout, link and
file-type checks still apply. Thirteen added regressions include two real setup
processes, loss of an enrolled file and preserving the original signing session.

No V1 data is migrated or deleted. Exclusive creation alone does NOT establish
uncertain nonce restart recovery; V2 adds the handling below. Rechecks around rename are
not atomic compare-and-swap or protection from a hostile filesystem race; failed
updates may retain external temporary state. No authenticated monotonic anchor,
protected share storage, power-loss proof or ongoing signer exclusivity is
claimed. These remain separate work and prevent production readiness.

## V2 volatile nonce and restart boundary

Signing nonce bytes are never serialized in V2 state. A private Map retains the
generated Uint8Arrays only for the active signer instance, bound to the persisted
public commitment. The complete validated V1 request is stored with the public
reservation. Save must succeed before exposing its commitment; an uncertain save
discards the nonce. Before signing, the Map entry is removed, the consumed marker
is persisted, and only then is the primitive invoked. A finally block clears the
nonce even if the consumed-marker write or primitive fails. Completed share
publication rechecks the saved session/tombstone; exact retries return the same
share without new nonce generation. Temporary decoded key/share byte buffers are
also cleared after use. This does not erase all JavaScript/OS memory copies.

A valid abort discards the volatile nonce even if its subsequent state read fails.
close() discards all nonce capabilities and permanently disables that instance.
On reopen, every saved session and tombstone is validated before any recovery
write: full request/session/deployment/key binding, exact metadata fields,
canonical counters, unique reservation/counter identities and state consistency.
Uncertain RESERVED entries are persisted as ABORTED/CONSUMED with the explicit
RECOVERY_UNCERTAIN_NONCE outcome before the constructor returns. Missing or
contradictory stored metadata or failed persistence stops reopening. Completed
shares remain intact. This is not independent verification of chain evidence.
V1 state is rejected without migration, replacement keys or deletion. The local
4096-session ceiling fails before adding another session and never prunes markers.

Sixteen new regressions include actual child-process SIGKILL after reservation,
reopen, before/after-persistence errors, exact completed aggregate reconstruction,
closed-instance refusal, malformed-state rejection and restoration of an earlier
public reservation snapshot. Test children receive no keys/nonces through IPC or
output. A restored public snapshot cannot recreate the destroyed nonce bytes.
This does not prove detection of every rollback, cloned memory image, privileged
host access, OS swap/dump or power failure. Long-term DKG shares remain in private
external JSON, and this adapter still lacks authenticated/protected share storage
and a retained signer lease. Global economic stops, fencing and multi-service
recovery remain separate requirements. Mainnet and production signing stay disabled.

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
checks. Local DKG handoff/retry handling is described below; complete service
recovery remains open. These checks do not establish full service crash safety.

## Local DKG transcript and durable handoff

The original message adapter uses exact A+B role identifiers, two compressed
33-byte commitments and a 64-byte proof in round one, and one peer's 32-byte
contribution in round two. These are the pinned Taproot-compatible primitive's
encodings, not another FROST ciphersuite. Plain bounded snapshots reject getters,
proxies, sparse/extended arrays, extra fields and noncanonical hex before state
reads. The participant's own round-one message must equal its saved announcement;
the private polynomial's identifier, threshold, step and public commitments must
also agree. The unchanged pinned primitive checks the peer proof and contribution.

Both participants persist their verified incoming contribution and a digest of
the full deployment request and exact round-one/round-two transcript before the
coordinator asks either to finalize. A temporary candidate used for contribution
verification is discarded, not activated. Finalization rechecks saved state,
derives the same key, persists it and removes old DKG and handoff secret material.
The request-bound digest remains. Completed requests still validate supplied
retry payloads; a separate request-only resume API validates its saved phase and
handoff. Full setup can reopen after one participant finalized without rebuilding
either key. A finalized peer plus missing handoff at the other participant stops.
Old completed V2 setup without this digest is rejected for setup resume, unchanged.
There is no automatic migration, deletion or replacement-key generation.

Eighteen new regressions use real ephemeral DKG and external files, including
before/after-save failures, exact reopen, absent/changed handoff, malformed input,
caller mutation and private/public polynomial substitution. Final local Windows/
WSL tests pass. Failures are injected; this is not physical power-loss testing.
Owned decoded byte buffers are cleared, but JavaScript/OS forensic erasure is not
proven. Runtime contributions, final shares and retry records are never published.

This is cooperating local API/storage handling, not authenticated confidential
DKG transport, a protected state adapter, an ongoing signer lease, rollback-proof
ceremony or independent cryptographic audit. The coordinator currently routes
private DKG contributions in-process; it has no final private signing share, but
service transport isolation is still required. Successful local setup does not
authorize production provisioning or activation. Key generation is outside
[RFC 9591's scope](https://www.rfc-editor.org/rfc/rfc9591.html); the pinned
[Noble FROST component](https://github.com/paulmillr/noble-curves/blob/2.3.0/README.md#frost-threshold-signatures)
explicitly lacks an external audit. No upstream implementation or vectors copied.

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
