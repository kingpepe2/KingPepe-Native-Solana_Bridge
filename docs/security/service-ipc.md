# Protected service IPC increment

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

This Phase 08.5 increment uses Node's TLS 1.3 implementation, mutually trusted
certificate pins and exact service-role pairings. Loopback is only routing.
TLS private keys and replay state are loaded from service-auth Windows DPAPI
stores outside the checkout. No plaintext or unauthenticated fallback exists.
Private FROST shares have no IPC export route. Native signing still uses the
unchanged, upstream-unaudited Noble 2.3.0 schnorr_FROST implementation.

The channel binds Native genesis, Solana deployment, key epoch, environment,
both roles, endpoint generation, a fresh challenge and TLS exporter. Each
request also binds an operation ID, method, request ID, admission expiry and
bounded completion deadline (V2; see global-integrity.md).
Canonical bounded framing rejects alternate encodings, malformed/oversized
input and unauthorized methods. The server persists a consumed request ID
before invoking the service. Replay records are never silently pruned; capacity
exhaustion stops service pending controlled maintenance. Clock rollback fails
closed. A lost response does not authorize replay of a transport request ID;
application operation/session idempotency is a separate required control.

The FROST handler validates the operation against the real signing request and
invokes the participant's configured Native verifier. The remote coordinator
reuses the existing signature-share, aggregate and independent BIP340 checks.
The attester handler requires its own configured evidence verifier; caller
proof flags cannot supply the verifier result. DKG provisioning is not exposed
through the coordinator signing endpoint. Supervisor integrity transport now
supports role-restricted status, action checks and contradiction reports; there
is no runtime clear/reset endpoint. Complete bridge recovery remains unfinished.

Current enrollment factories are explicitly localnet-only. This is not a
production certificate ceremony, rotation service or activation mechanism.
Credentials use distinct certificates, but tests on the present workstation
still share one Windows security principal. A process with that same token can
potentially access its DPAPI stores. Cross-service denial requires actual
separate service accounts and an isolated elevated Windows test environment.
TLS authentication tests are not a substitute for that test.

The Windows suite generates disposable certificates using the installed Git
for Windows OpenSSL test executable (observed 3.5.7), selected through the
test-only KINGPEPE_TEST_OPENSSL setting when it is not on PATH. All generated
material remains outside the source tree; temporary plaintext key-generation
output is removed before DPAPI enrollment. No certificates or keys are tracked.
This utility is a test prerequisite, not the bridge's TLS implementation.

The separate protected signer adapter now requires a lifetime OS handle and
persistent fence (signer-fencing.md). Co-restoring every protected checkpoint is
still outside the rollback guarantee. The tests do not yet prove separate
Windows service-process crash recovery or the secured whole-bridge E2E.

Reference-only API use: [Node TLS](https://nodejs.org/api/tls.html).
No Node/OpenSSL implementation or example code is copied or vendored.
