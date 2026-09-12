# Authenticated local service access

Local services use Node TLS 1.3 with mutually pinned certificates. Each endpoint
accepts only its configured peer role and allowed methods. TLS provides message
integrity; loopback supplies routing. Credentials and replay records use Windows
protected storage. No endpoint exports a private FROST share.

The V3 wire format carries one request and response per connection. Requests bind
the deployment/genesis, environment, epoch, both roles, operation, method and
request ID. Bounded canonical framing and admission/completion deadlines reject
malformed or stale input. There is no additional application challenge or TLS
exporter exchange.

The server persists each consumed request ID before dispatch. IDs are retained
across restart and never silently pruned. Capacity exhaustion fails closed.
A fresh transport ID still must satisfy the application's operation idempotency.
One retained listener counter invalidates a superseded listener; it is not a
signer clone-detection framework. Existing protected credentials/replay state
remain intact; old wire peers must be updated together.

Protected client checks require the real authenticated adapters. FROST A and B
independently validate the exact transaction and Native evidence. Attesters
validate the canonical credit before signing. DKG is separate from signing.

Confirmed incidents are persisted before reporting to the single bridge pause
authority. An unavailable authority or lost reply cannot grant signing
permission. Read-only status and monitoring may continue while paused.

Enrollment and certificate fixtures are isolated localnet tests. They exercise
CurrentUser DPAPI and real mTLS, without certifying distinct Windows service
principals or production provisioning. See [protected storage](windows-protected-storage.md)
and [operation recovery](deposit-operation-recovery.md).
