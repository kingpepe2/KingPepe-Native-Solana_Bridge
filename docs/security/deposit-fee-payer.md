# Protected deposit transaction preparation

This Localnet-only boundary uses a distinct FEE_PAYER service identity and
CurrentUser DPAPI seed. It is not the coordinator, attester, Native signer or
mint authority. The coordinator and relayer receive no private key. Existing
role-pinned TLS IPC permits only the bridge validator to request a canonical
deposit receipt or claim transaction.

Before key access, the service validates the exact unsigned intent, both
distinct authorized project attestations, message/deployment/epoch, amount and
recipient, configured fee payer, current deployment accounts and finalized
block height. The normal global integrity guard is checked before signing and
before releasing the result. Only the standard SPL Token Program is bound.
No arbitrary transaction, instruction, payer, program or transfer is accepted.

The seed is read through protected storage only when needed, checked against
the pinned public identity and immutable revision, and zeroed after use. A
lifetime lease prevents simultaneous use of the same local state. Wrong
protected role/context, missing storage or changed keys fail closed. Confirmed
key or deployed-identity changes propagate durable integrity stop. Neither
runtime creation of replacement keys nor plaintext fallback is implemented.

The controller must retain an exact unsigned request before asking for a
signature and retain the returned packet before enqueuing delivery. Ed25519
transaction signing of the same bytes is deterministic; a lost signing reply
can be requested again without constructing a different economic operation.
The separate delivery outbox still owns outcome-before-rebuild and actual
broadcast. This service does not mint, broadcast or settle credit.

Thirteen portable request/response/role tests pass. The initial eight Windows
targets were four PASS/four FAIL because the new builder omitted the mandatory
Token Program argument; positive signatures and the changed-key hook were never
reached. The correction explicitly binds the configured traditional program;
the complete targeted rerun passes eight, zero failed/skipped/cancelled, in
136893.6 ms. The original four failures remain failed evidence. This is not a
full-suite, actual-validator or final clean-clone certificate.

Component tests use actual CurrentUser DPAPI/TLS but synthetic RPC accounts.
They are not full protected-chain or cross-service SID certification. Distinct
temporary service principals still require an isolated elevated environment.
The same-host privileged compromise/profile co-restore risks and unaudited
upstream FROST status are unchanged. Native signing remains exact A+B BIP340,
not this Ed25519 transaction identity. Mainnet and Phase 09 remain disabled.
