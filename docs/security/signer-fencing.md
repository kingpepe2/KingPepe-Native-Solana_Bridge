# Protected signer lifetime fencing

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

The Windows fenced store combines a process-lifetime OS handle with a separate
DPAPI-protected fence record. The private helper holds an existing, restrictive
FileShare.None handle until its parent pipe closes. A missing lease is rejected,
not created during startup. A second cooperating signer cannot acquire the
same lease. Parent termination releases its pipe and the helper's handle;
uncertain release blocks a restart rather than deleting a lock.

The fence binds signer role/instance, environment, Native genesis, deployment,
key epoch, persistent fence epoch, exact state revision and nonce high-water
mark. Opening increments the authenticated fence epoch before the signer can
participate. Every state load/save checks the matching image. A stale loaded
object, decreasing counter or changed epoch closes the instance.

Writes first persist an exact adjacent-revision intent in the separate fence,
then update protected signer state, then finalize the fence. Reopen accepts only
the authenticated exact before/after image of that intent. Unknown intermediate
images are rejected. The Native signer's existing uncertain-nonce destruction
and signed-share retry rules remain unchanged. Remote FROST service handlers
require the genuine fenced adapter; legacy local in-process test adapters are
not promoted into protected services by configuration fallback.

Tests use actual Windows file handles, DPAPI and separate Node processes. They
exercise duplicate A/B processes, SIGKILL, restored state plus its state anchor,
stale revisions/epochs, wrong role/deployment, nonce-counter rollback and prepared
write recovery. Cryptographic crash tests use real FROST shares and independently
verify recovered aggregate signatures; their chain-evidence inputs are explicit
unit fixtures, not evidence of Native chain execution. Regtest E2E is separate.

## Remaining assurance boundaries

The fence must remain outside signer-state backup/restore packages. Restoring
state and its own anchor is detected while the independent fence is retained.
Restoring **every** file, fence and enforcement mechanism can evade a fresh
process. These are cooperating-process/local filesystem guarantees, not a TPM
monotonic counter, remote witness, full-host rollback guarantee or protection
against code running with the signing service's privileges. Host compromise can
affect both participants. No second signing computer is required.

No machine reboot or power-loss test has been performed. Distinct Windows
service accounts/profile/ACL denial still require an isolated elevated test
environment. The current tests must not be labeled cross-service certification.
Durable global stop propagation, full bridge crash recovery and stronger
chain-progress freshness are separate remaining control groups.
