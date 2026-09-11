# Protected global integrity authority

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

The supervisor authority persists RUNNING, PAUSED_POLICY or HARD_STOP_INTEGRITY
in a context-bound Windows DPAPI store under an exclusive lifetime handle.
Enrollment is explicit and localnet-only; missing state is never recreated by
startup. Restart increments a protected generation. Every status/action rereads
and validates the protected state, not just an in-memory flag. Confirmed incident
records are persisted before acknowledgement. Repeated identical reports are
idempotent. The incident log is bounded and never automatically pruned.

## Fresh source admission

The authority now separates persisted policy from effective service readiness.
Opening it, including with persisted RUNNING policy, creates an empty source
health window. Effective state is PAUSED_POLICY until NATIVE_OBSERVER,
SOLANA_OBSERVER and RECONCILIATION each complete a new challenge over their
role-bound authenticated channel. Each challenge binds the supervisor generation,
role and observation operation ID, is random and one-use, and expires thirty
seconds after issuance. Delayed replies do not renew the deadline. A pending
poll may retain only the preceding verified result's unexpired lease; it cannot
extend that lease or manufacture new evidence. An unavailable result revokes it
immediately, and a lost reporter expires without renewal. This prevents routine
periodic polling from starving valid transfers while preserving the fixed age
bound. Initial/restarted authorities have no preceding health lease. Clock rollback,
wrong role/generation, substitution and replay fail closed. State is bounded to
three pending and three completed checks; no observation queue grows indefinitely.

The Native and Solana monitor wrappers request the challenge before reading the
source. They report a match only after verification and durable progress update;
unavailability produces safe suspension, not an invented reserve deficit. Failed
health reports cannot renew authorization. A healthy report changes neither the
durable policy nor an integrity incident. Even all three healthy sources cannot
clear PAUSED_POLICY or HARD_STOP_INTEGRITY. Ordinary service recovery is automatic;
there is no per-transfer Team approval or automatic integrity-stop clearing.

Authenticated source reports identify a trusted detector; they do not prove chain
consensus and are not economic authorization. The signers and attesters still
perform their own transaction/evidence checks. Current role/generation admission
tests with synthetic source payloads are explicitly component tests, not proof
of complete reconciliation or protected real-chain execution. A live, independently
checking reconciliation publisher and full operation recovery remain required.
Source health does not bypass the IPC's explicit bounded replay-store capacity;
capacity exhaustion remains fail-closed, not automatic record pruning.

Authenticated service clients use mutually pinned TLS. Exact roles control
allowed actions and incident types. Native/Solana observers, reconciliation and
signers can report their respective contradictions; an indexer cannot authorize
signing or claim submission. SOURCE_UNAVAILABLE is not an integrity incident.
Unreachable/corrupt authority state makes authorization unavailable, not RUNNING
and not proof of a successfully persisted stop. Read-only status remains possible
during a valid persisted hard stop. No runtime clear/resume/reset API exists.
If incident persistence fails, the active authority latches closed and never
acknowledges durable success. The reporting service now retains the exact
role/code/operation/evidence digest in its protected authentication store BEFORE
connecting. A lost report or acknowledgement therefore survives service restart;
the guard redelivers it and requires a persisted HARD_STOP_INTEGRITY response
before read-only observations can proceed. It cannot obtain RUNNING permission
with a retained incident, even through the underlying transport API. Duplicate
delivery does not duplicate the supervisor incident. Acknowledgement never
prunes the outbox, and neither a healthy chain nor a new supervisor generation
clears it. Both outbox and authority have fixed 64-incident bounds.

If the local protected write itself fails, no report is acknowledged or sent
and the active guard remains stopped. Simultaneous loss of all writable state
before any incident record exists is not a solved persistence guarantee. Startup
still needs fresh independent source checks and validated journals; full service
recovery and those integration boundaries remain required. Retained profile
witnesses detect file-package rollback, not privileged full-profile/host restore.

Protected FROST handlers and the remote coordinator require a genuine integrity
client matching their role, genesis, deployment and key epoch. They check before
acting and again before releasing their result. Abort may still burn uncertain
nonce sessions during a stop. Fencing integrity failures report signer rollback;
each commitment/share also refreshes the participant's Native evidence before
using secret material. The existing thirty-second Native freshness limit remains
unchanged; the coordinator's initial verification is not cached authorization
for the entire multi-service session.
Confirmed invalid signing transcripts report an incident. An unavailable abort
response keeps its coordinator instance fail-closed but is not mislabeled as a
confirmed economic contradiction. Durable per-operation recovery is still needed.
Protected attester handlers
likewise require matching integrity clients and current protected seed access;
they independently verify Native evidence and check the stop again before signing
and before returning an attestation. The evidence-only helper returns verified
input, never a signature, and is not a service authorization API.

## Transport timing

IPC V2 binds distinct deadlines: at most ten seconds to admit a fresh request,
and at most thirty seconds to finish it. The previous single ten-second deadline
rejected real protected signing once multiple DPAPI commits and authenticated
supervisor round trips were required. This change does not accept stale requests
or late results. Both server and client enforce the completion deadline. Framing,
TLS handshake, size, replay and role checks remain bounded and mandatory. V1
enrollment/request state is not silently promoted to V2.

## Remaining integration and trust limits

The authenticated reporter is trusted to classify its validated evidence; its
signature or incident report is not a blockchain consensus proof. Live chain
detectors, the durable operation journal, broadcast-to-credit reconstruction and
complete service restarts are separate unfinished work. The Linux regtest harness
still uses its explicit isolated test adapters; its happy path is not proof of
full protected Windows service integration.

An off-chain stop cannot revoke an attestation already released or a transaction
already dispatched to a blockchain. New protected boundaries stop authorization;
in-flight outcomes still require observation and reconciliation. No claim is made
that this component alone atomically pauses the Solana program. There is no
automatic SPL confiscation, remint, balance repair or hard-stop clearing.

Co-restoring all protected state and enforcement records can evade a fresh local
instance. Same-principal tests do not certify separate Windows accounts/ACLs;
that still requires an isolated elevated environment. No production services,
accounts, credentials or funds are used by this increment.
