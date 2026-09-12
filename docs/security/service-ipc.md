# Authenticated local service access

Required local service channels use Node TLS 1.3 with mutually pinned
certificates and exact role/method authorization. Loopback is routing only.
Service private keys and replay state are loaded from Windows protected local
storage. FROST private shares have no signing-endpoint export method.

Requests bind deployment/genesis, environment, epoch, both endpoint roles,
connection generation, fresh challenge, TLS exporter, operation, method and
request ID. Canonical bounded framing and explicit admission/completion
deadlines reject tampering, oversized input, stale requests and wrong roles.
The server records consumption before invoking the handler. Replayed transport
IDs are rejected; a new transport request still must satisfy the application's
same-operation idempotency rules. Replay capacity fails closed, never silently
prunes. Private capabilities prevent caller-built objects from impersonating
already validated protected clients.

The FROST handler requires the actual exclusive protected state adapter and
each participant's Native evidence validator. The attester verifies evidence
before signing the exact canonical message. DKG is not exposed through the
transaction-signing endpoint. No unauthenticated or plaintext fallback exists.

Confirmed integrity reports use the same authenticated channel and are retained
before sending. An unavailable supervisor or lost response cannot turn a
retained incident into signing permission. The runtime has no automatic
incident-clear endpoint. This is one bridge pause authority, not independent
consensus or a physically distributed trust model.

Enrollment factories currently permit isolated localnet tests only. Windows
certificate tests use installed OpenSSL to create disposable credentials outside
source and remove generation-time plaintext before enrollment. CurrentUser
certificate/DPAPI tests are not cross-service Windows-principal certification.
No production enrollment, rotation or activation is claimed.

See [operation recovery](deposit-operation-recovery.md) for application retry
ordering and [protected storage](windows-protected-storage.md) for residual
same-host and snapshot limitations. [Node TLS](https://nodejs.org/api/tls.html)
is an external runtime API; its implementation is not copied into the project.
