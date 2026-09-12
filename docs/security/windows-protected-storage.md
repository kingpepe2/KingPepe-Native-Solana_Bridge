# Protected local storage

The Windows adapter uses CurrentUser DPAPI, a single-principal protected DACL,
and external fixed-volume state roots. It checks the configured SID against
the executing identity. Secrets travel to its local helper through inherited
anonymous pipes, not command arguments, environment variables or logs.
No plaintext or non-Windows fallback exists. Plaintext necessarily exists in
authorized process memory while cryptographic operations run.

Role, purpose, identity, environment, genesis, deployment, instance and epoch
are authenticated in each envelope. FROST A/B, attester A/B and service
credentials have distinct contexts and roots. Source containment, linked paths,
hard links, wrong permissions and missing/corrupt state fail closed. Enrollment
is explicit and exclusive; opening never creates replacement secret material.

## Small persistence mechanism

The V2 store has one encrypted state image, an exclusive write lock and an
optional service-lifetime process lock. Updates compare the authenticated
revision, flush an encrypted candidate, then atomically replace the state.
Recovery accepts only an authenticated adjacent-revision candidate; corrupt,
conflicting or skipped revisions fail closed. Failed-write responses can be
resolved only by rereading the exact intended next image.

There is no registry witness, second checkpoint directory, persistent signer
fence or automatic migration from older storage formats. Never discard old
operational state merely to make the new format open. A full old snapshot
restored before a new process starts is not guaranteed detectable. Safe
production recovery/provisioning remains separately reviewed work.

The original C# helper is compiled with the installed .NET Framework compiler
in a fresh restricted external directory. Source/executable hashes and file/ACL
boundaries are rechecked before use. Changed or missing code fails, without
automatic recompilation fallback. There is no second compatibility storage driver.

## Test and trust scope

Run npm run test:windows-security with the pinned Node runtime on Windows.
CurrentUser tests exercise actual DPAPI, encrypted FROST signing, distinct
attestation material, invalid contexts, corruption, atomic replacement and
process exclusion. They do not certify access under distinct service SIDs.
That requires an isolated Windows environment able to run separate temporary
service principals; no production accounts or paths belong in repository data.

Same-token and privileged host access can subvert these controls. Complete
memory erasure, sudden-power-loss and full-host rollback resistance are not
claimed. Mainnet remains disabled.

API references are retained in UPSTREAM-REFERENCES.json. No Microsoft source,
sample implementation or runtime binary is vendored or relicensed.
