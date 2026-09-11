# Protected attester authorization recovery

This is Phase 08.5 localnet service source, not production activation or a
completed end-to-end service recovery certification. FROST remains separate:
these retained results are project Ed25519 attestations, not Native signatures.

The protected attester IPC handler requires an enrolled authorization journal.
There is no in-memory or plaintext fallback. Enrollment is separate from opening
existing state. Missing state must not create a replacement journal or identity.
The journal uses CurrentUser DPAPI, restricted files, a lifetime kernel lease,
revision CAS and the retained service-profile witness. The seed and journal must
match the same role, service principal, instance, environment, genesis,
deployment and key epoch. The normalized attester policy/public identity is also
bound to the protected journal image. Actual values remain outside source.

For each verified deposit the service retains the exact canonical message,
operation ID, Native deposit outpoint and reserve allocation ID. The operation,
outpoint and allocation are all unique. A different message or allocation that
collides with an existing binding is not a retry. It retains a conflict incident,
stops the local attester, and reports the contradiction to the authenticated
global integrity authority. Reopening a retained incident reports it again and
refuses authorization. No automatic clearing, pruning or epoch migration exists.

The ordering is:

1. Independently verify the current Native evidence inside the attester service.
2. Check global admission and local policy; persist the PREPARED message binding.
3. Check global admission, protected key and journal again; sign the exact bytes.
4. Persist the signed result before acknowledging it.
5. Check global admission again before returning the result.

A prepared record with no result can resume only for the identical message and
allocation, after new Native verification. Repeating deterministic Ed25519 signing
of those same bytes after uncertain result persistence does not reuse a FROST
nonce ([RFC 8032 signing procedure](https://www.rfc-editor.org/rfc/rfc8032#section-5.1.6)).
A durable result is returned without signing again, but only after current
evidence, protected-key, policy, validity-window and global-stop checks. The new
signing step applies only to a prepared record without a result; a retained
signature still requires the final global/revision check and a policy/expiry
recheck after that asynchronous boundary. An expired message is
not automatically replaced by a differently encoded credit. Reauthorization
across expired messages or key/policy epochs is not implemented here.

The local enrollment has a maximum of 256 retained records and a bounded image.
Exhaustion rejects new work; it never deletes replay bindings to restore
availability. Capacity planning and a safely reviewed retention/migration policy
are still required before any production adoption.

Malformed authenticated journal contents and a detected retained-witness rollback
are integrity reports. Unavailable or unauthenticatable storage fails closed;
it is not fabricated evidence of an economic deficit. A failed incident write
does not acknowledge a durable local stop; reporting to the global authority is
still attempted. If either authority is unavailable, no result is released.

Test evidence distinguishes portable codec tests, same-principal Windows
DPAPI/mTLS tests, process-kill tests and real blockchain tests. Synthetic Native
evidence in a component test is never a chain proof. Cross-service DPAPI/ACL
certification remains environment-dependent. A same-principal or privileged host
attacker, or restoration of all state and the profile witness together, remains
outside the claimed rollback guarantee. An off-chain stop cannot revoke an
attestation already delivered or a transaction already sent to a chain.

The Windows security runner executes test files serially to bound unrelated
DPAPI fixture contention. Tests within those files still launch the required
competing services/processes and perform actual kill/restart checks. Transport
admission/response deadlines and source freshness bounds are unchanged. A failed
run remains failed even if a subsequent isolated retry passes. IPC diagnostics
expose fixed symbolic codes only; they are not authorization or automatic retry
permission.

This journal addresses the attester boundary only. Complete durable deposit
intents, pre-broadcast sweep persistence, broadcast-to-credit reconstruction,
reconciliation admission and full protected Windows chain integration remain
required Phase 08.5 work. No Phase 09 implementation or payout flow is added.
