# Protected sweep signing dispatch

This Phase 08 localnet component separates durable job acceptance from the
multi-request FROST execution. Bridge Validator and Coordinator use distinct,
pinned, mutually authenticated TLS credentials; neither a socket location nor
receipt of a request authorizes signing. Admission and response deadlines are
unchanged. The accepted reply contains a stable job ID, not a signature.

The Coordinator retains the complete exact intent in CurrentUser DPAPI storage
before acknowledgement. Its purpose/identity/deployment/path binding, retained
profile witness, revision comparison and lifetime handle are mandatory. Missing
state is not enrolled automatically. No FROST private share crosses this API.

One worker executes queued work through the existing protected A+B signing
journal. Both signers still validate evidence and policy. A fresh worker resolves
the retained attempt; it cannot reset tombstones or silently drop to one signer.
If result acknowledgement is lost, the exact already-retained aggregate can be
recovered without new nonces. Result release checks current integrity admission
and independently verifies the aggregate against the exact requested sighash.

Retries retain one request identity and immutable transaction commitment. Attempts
and retry timing are persisted before starting work; the local resource bounds
are 256 records and 32 attempts per record, with bounded backoff. Exhaustion is
waiting/queued-by-limit, never approval or an automatic reset. These are local
test resource ceilings, not approved production throughput policy. No job
pruning, replacement spend, payout, mint, key export or recovery override exists.

A stopped or corrupt store cannot authorize another attempt. A detected retained
state rollback reports through the durable global integrity outbox. Full privileged
profile/host co-restore remains outside this local protection guarantee.

Portable codec tests include real ephemeral BIP340 signatures with synthetic
chain facts. The primary Windows dispatch/reopen tests pass within the full
147-pass DPAPI/mTLS suite, zero failures/skips/cancellations. These tests do not
certify distinct service identities, real Native-chain acceptance, or complete
protected deposit recovery. Native credit reconstruction and Solana delivery
have separate actual-chain component results. Full protected-controller
integration and every-boundary real-chain restart matrix remain required. Phase 09 has not
started; Mainnet and production signing/broadcasting remain disabled.
