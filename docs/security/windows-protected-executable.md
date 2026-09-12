# Source-built Windows protection helper

The synchronous protected-store adapter now compiles the reviewed C# DPAPI,
ACL, retained-witness and CAS implementation once per service process, using
the installed Windows .NET Framework compiler. It does not compile on each
read/write, share a downloaded executable, cache decrypted state, change the
encrypted format, or skip a storage check.

Each process creates a new dedicated external directory with its final
single-principal ACL atomically. The build contains only adjacent reviewed
source files. Compiler errors and warnings reject the build. The adapter pins
the generated executable hash in memory and rechecks the source hashes, file
hash, regular-file identity, hard-link count and path boundary before every
invocation. The executable verifies its directory/file ACL before reading the
private anonymous input pipe. Missing or changed code fails closed, without
recompiling or falling back inside that process.

The same actual DPAPI implementation still validates every state access.
Neither plaintext state nor a cached RUNNING permission replaces it. Service
identities, lifetime leases, persistent fences, nonce tombstones, replay writes,
freshness windows and IPC deadlines are unchanged. A cryptographic share is
never passed to the compiler or through service IPC.

This addresses measured scheduling cost, not an account restriction. Five
read-only calls through the old per-call PowerShell/compiler wrapper took
534–599 ms. The candidate source-built executable took 116–128 ms after a
1437 ms first call including compilation. The measured installed compiler
version was 4.8.9232.0. These timings are not performance promises or proof of
complete bridge liveness. Real-chain protected delivery is a separate gate.

The original PowerShell wrapper remains for compatibility verification; it is
not an automatic runtime fallback. Five isolated executable tests cover the
same implementation/identity, file tampering with no automatic reset, deletion,
hard links and widened ACLs. Those and the existing 31 current-principal
DPAPI/FROST/attester tests passed, 36 total. The separate candidate's full
Windows security regression then passed 140, zero failures/skips/cancellations,
in 2284658.0676 ms with unchanged 186-file runtime digest
37c0361a40d411c40194d37969dc6921eec1b08f7c9559435b67940961890e08.
Node passed 835 plus two vectors on Windows and WSL. These totals belong to
that revision, not later Solana delivery changes or full protected-controller
certification. Actual Native delivery/reopen is separately documented.

Only the exact unchanged generated executable and an empty directory are
removed on ordinary process exit. Uncertain files remain for review. A killed
process may leave disposable compiled code, never a new share or backup.

This is source-to-runtime build evidence, not a reproducible-binary or external
audit claim. The compiled helper is not a new trust anchor against a privileged
host/account compromise. Process memory still contains authorized working
secrets; CurrentUser protection and retained profile evidence do not establish
physical independence or detect a full profile/host co-restore.

Cross-service SID/ACL certification still requires distinct temporary Windows
principals in an isolated elevated environment. No production service, account,
key, installation policy or funds were changed for these tests.
