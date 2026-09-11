# Protected coordinator signing recovery

This Phase 08.5 control applies to the protected **localnet reserve-sweep**
coordinator. It does not enable a Phase 09 payout, production signing or a
complete durable deposit service. Windows CurrentUser DPAPI, restricted external
files, CAS, a lifetime kernel handle and the existing retained profile witness
protect the journal. There is no plaintext or in-memory protected-runtime fallback.
Opening missing state never enrolls a replacement. Enrollment remains explicit.

The journal binds the public FROST package, aggregate public key, deployment,
Native genesis, service role/principal/instance and key epoch. Each signing
request fixes the complete validated Native intent, transaction/sighash and input
index. One operation/input cannot acquire an alternative request identity. No
private share or secret nonce is retained by or sent to the coordinator.

The durable sequence is:

1. Check fresh global admission and each signer's independent Native evidence.
2. Persist PREPARED with a journal-derived attempt/session before commitments.
3. Obtain A+B commitments and shares through the existing mutually authenticated
   confidential transport. Both signers still independently check policy/evidence.
4. Verify both shares and the single aggregate with the pinned FROST and BIP340
   APIs. Persist SIGNED before releasing the aggregate.
5. Check global admission again and re-read/verify the retained result before return.

A recovered PREPARED record is uncertain: its old session is never resumed for
new signing. The coordinator requests terminal abort receipts from BOTH A and B,
including a participant whose response was lost. Only two correctly bound
receipts permit an ABORTED transition and the next monotonic attempt. Failure to
obtain either receipt leaves PREPARED durable and signing stopped. A transport
outage is not itself a confirmed economic contradiction.

A recovered SIGNED record returns the exact already-produced aggregate, without
new commitments or shares, after journal/context/cryptographic and global checks.
This retrieval does not authorize an external broadcast. The durable operation
controller and relayer must determine any previous Native outcome before acting;
inputs may already be spent by that identical transaction. Neither a cached
signature nor an unavailable RPC authorizes a replacement spend.

A lost protected-write response is resolved by reading the store. Only the exact
expected next CAS revision and payload can count as that uncertain write's
completion. An unrelated authenticated mutation or a detected witness rollback
retains COORDINATOR_JOURNAL_INTEGRITY in the protected supervisor-channel outbox
before trying to report a global stop. If the supervisor is unreachable, restart
cannot discard that incident or reauthorize signing. Successful redelivery
persists the global stop; unavailable delivery is not claimed as acknowledgement.
SIGNED is never
overwritten with ABORTED merely because a response failed. No stop auto-clear,
request pruning, epoch migration or automatic capacity rollover is implemented.
The bounded enrollment retains at most 256 requests; exhaustion fails closed.

The lifetime handle excludes local duplicate processes. The retained service
profile witness detects restoring older file packages while that profile remains
current. These controls do not detect every hidden clone or full privileged
host/profile/state co-restore. Same-host A+B remains the approved topology;
process isolation is not physical independence. Cross-service DPAPI/ACL testing
requires distinct isolated Windows identities, not repeated tests as one user.

Portable codec tests use genuine ephemeral FROST computation but not chain
validation. Windows component tests use actual DPAPI, mTLS, FROST, retained state
and process termination with explicitly synthetic chain evidence. Actual regtest
acceptance and full protected service integration have separate gates. Test kill
hooks exist only in the test actor; there is no runtime crash/approval bypass.

The pinned implementation remains @noble/curves 2.3.0 schnorr_FROST,
secp256k1/BIP340, with Native sighash verification at the signer boundary. The
upstream FROST implementation is UNAUDITED. Ed25519 project attestations remain a
separate identity and protocol. Off-chain stops cannot revoke signatures or
transactions that have already left a service.

Full durable deposit-intent/raw-sweep persistence, broadcast-to-credit recovery,
reconciliation admission, protected real-chain execution and final clean-clone
certification remain separate required Phase 08.5 work. This component alone is
not a complete restart-recovery or production-readiness claim.
In particular, a full operation controller must reserve all input outpoints
across operation IDs and bind every per-input request to the same exact unsigned
transaction and economic policy. Per-request retention alone is not that global
allocation guard and does not authorize a second operation to spend an input.
