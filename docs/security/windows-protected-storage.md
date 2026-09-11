# Windows protected-storage remediation

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

This is an implemented storage component, not certification of Phase 04 or a
production service. Phase 09 remains NOT_STARTED. Mainnet and production signing
remain disabled. The approved single-host A+B topology is unchanged.

## Implemented boundary

`shared/windows/protected-store.mjs` invokes the original C# helper through
redirected anonymous child-process pipes. The helper uses Windows DPAPI
CurrentUser protection, not LocalMachine protection. It checks the executing
Windows SID against the configured service SID before accessing state. No secret
is passed through arguments or environment variables; helper errors are fixed,
redacted codes. There is no plaintext file or non-Windows fallback. Plaintext
necessarily exists in the intended service's memory during signing.

Creation is explicit and exclusive. A directory is created atomically with a
non-inherited DACL granting only the configured identity full access. Existing
directories are never silently re-permissioned or adopted. Reads and updates
require existing state and exact permissions; missing state cannot create keys.
Roots must be local, separate, non-nested and outside the actual source checkout.
The helper requires Windows to classify the drive as Fixed; a drive-letter path
alone is insufficient. Network, removable and unknown drive types fail closed.
New files receive an explicit identity-bound, protected DACL and security owner
at creation rather than relying on the process token's default file descriptor.
Linked/reparse paths, hard-linked files and broadened state ACLs are rejected.

Each DPAPI envelope binds role, purpose, service identity, environment, Native
genesis, Solana deployment, signer instance, key epoch and both storage locations.
These are storage metadata, not the canonical economic message encoding. FROST,
attester and service-authentication purposes are distinct. Actual configuration
values remain local only; repository examples must use placeholders.

`WindowsProtectedFrostStateStore` fits the real signer's synchronous load/save
interface. It checks the genuine immutable Native policy before opening signer
state. DKG state, long-term share and public nonce tombstones are encrypted.
The existing volatile-secret-nonce and uncertain-session destruction policy is
unchanged. The coordinator never receives the final private share. Attesters can
load a separately protected seed with deployment/epoch checks. The provided
FROST creation and attester factory APIs are explicitly localnet-only; no
production key ceremony, enrollment or service installation is implemented here.

## Commit and rollback semantics

An authenticated state revision and a separately protected checkpoint hash are
updated using exclusive per-operation Windows file locks, flushed encrypted
candidate files and atomic file replacements. A compare-and-swap revision rejects
stale writers. FROST saves bind that revision to the exact object loaded, so a
later read cannot authorize saving an older object. The revision is checked u64.

Recovery completes only an authenticated, adjacent-revision prepared pair or an
already committed checkpoint with its exact candidate state. An incomplete,
corrupt, mismatched or skipped-generation pair fails closed; recovery does not
invent state or discard ambiguous evidence. Tests reconstruct actual encrypted
disk images at each replacement boundary. This is not a sudden-power-loss test
or a hardware durability guarantee.

The retained registry witness increment additionally binds each store to an
explicitly enrolled, nonvolatile service-profile registry record with a private
DACL. It contains only a DPAPI-protected revision and hash of encrypted state,
never a private share or nonce. Encrypted candidate files are flushed before
advancing the witness; the witness is flushed before replacing committed files
or acknowledging the write. Recovery admits only the exact witnessed image or
one authenticated adjacent candidate pair. Missing enrollment is never recreated.

This detects restoration of state, file checkpoint and signer-fence packages
while the separately retained service profile remains current. It is not an
unconditional monotonic counter: **restoring the registry/profile together with
all state files can still evade a fresh process**. Tests explicitly preserve this
limitation rather than asserting a nonexistent hardware guarantee. Whole-host
snapshots must not be treated as safe automatic signer restore packages. Existing
stores without a witness fail closed; no automatic migration or re-enrollment is
provided. Refer to current status for actual executed test results.

## Actual tests and outstanding requirements

Run `npm run test:windows-security` with the pinned Node runtime on Windows.
It fails, rather than skips, on other platforms. The suite exercises real DPAPI,
ACL rejection, encrypted FROST DKG/sign/reopen, distinct Ed25519 attestation,
stale writes, copied roots, corrupted/missing files and prepared-commit recovery.
The ordinary portable suite tests strict immutable context parsing separately.
Byte comparisons in the Windows suite produce only boolean assertion fields and
fixed errors, never private bytes or protected envelopes in an assertion diff.
A forced-failure regression checks that reporter boundary. Cleanup failures are
also redacted. Passing tests alone would not have exercised these error outputs.

The present workstation token is not elevated. The current-identity tests do not
prove denial under another Windows service account. Wrong configured SID rejection
is not a wrong-user DPAPI test. Completing cross-identity tests needs a disposable
Windows environment with rights to provision and run distinct test service
identities. Do not request account passwords or weaken ACLs to manufacture a pass.
No real service identities or operational paths belong in source or test output.

Separate source components now implement authenticated confidential IPC and
persistent lifetime signer fencing; see signer-fencing.md and service-ipc.md.
Cross-identity access, protected real-chain service integration and complete
recovery remain incomplete. The helper's inherited anonymous pipes are not the
coordinator-to-signer transport. Storage purpose support is not a completed
production certificate/enrollment lifecycle.

A process with the same service token, or a privileged host compromise, may
access protected material or subvert code and ACLs. Host outage affects both A
and B; process isolation is not physical isolation. DPAPI profile availability,
service-profile setup, code integrity, PowerShell policy, restricted parent
directories and backup recovery still require deployment validation. JavaScript
and .NET string erasure and complete forensic memory zeroization are not proven.
No protection against hidden privileged clones is claimed.

Separate components implement global stop guards, live Solana deployment checks
and accepted Native reorg incident handling. Complete broadcast-to-credit recovery
and their full protected-service integration remain separate blockers.
The upstream `@noble/curves` 2.3.0 FROST implementation remains unaudited.

## API references and provenance

The glue and tests are original KingPepe code. No Microsoft implementation or
sample code is copied or redistributed. Windows and .NET are external OS/runtime
prerequisites, not KingPepe-exclusive dependencies. Reference semantics:
[DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata),
[ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata),
[FileShare](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare) and
[service access rights](https://learn.microsoft.com/en-us/windows/win32/services/service-security-and-access-rights).
Also reviewed: [DriveInfo](https://learn.microsoft.com/en-us/dotnet/api/system.io.driveinfo.drivetype)
and the [FileStream security-descriptor overload](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream.-ctor).
Registry semantics: [RegCreateKeyEx](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regcreatekeyexw)
and [RegistryKey.Flush](https://learn.microsoft.com/en-us/dotnet/api/microsoft.win32.registrykey.flush).
These references and local tests are not an independent security audit.
