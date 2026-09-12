# Protected local storage

Windows services use CurrentUser DPAPI, a single-principal protected DACL and
external fixed-volume state roots. The configured SID must match the executing
identity. Secrets reach the helper through inherited anonymous pipes, never
command arguments, environment variables or logs. There is no plaintext fallback.

Role, purpose, identity, environment, genesis, deployment, instance and epoch
are authenticated in each envelope. FROST A/B shares, attester secrets and service
credentials use separate contexts and roots. Missing/corrupt state, incorrect
permissions and linked or source-contained paths fail closed. Opening a store
never creates replacement secret material.

The V2 store uses one encrypted state image, an exclusive write lock and an
optional service-lifetime process lock. A write checks the authenticated revision,
flushes an encrypted candidate and atomically replaces the image. Recovery
accepts only an authenticated adjacent-revision candidate. Uncertain write
responses require the exact intended image to be read back.

The original C# helper is compiled using the installed .NET Framework compiler
into a fresh restricted external directory. Source/executable hashes and file
boundaries are checked before use. Changed or missing code fails closed.

Run `npm run test:windows-security` with the pinned Node runtime on Windows.
Tests cover actual DPAPI, encrypted FROST signing, protected attester material,
wrong contexts, corruption, interrupted writes and process exclusion.
They certify only the current test identity, not separate service SIDs.

Authorized process memory contains plaintext while cryptography runs. Same-token
or privileged host compromise can affect both signers. Full-host snapshot
rollback, complete memory erasure and sudden-power-loss durability are not
certified. No registry witness, rollback-anchor hierarchy or production
provisioning is implemented. Mainnet remains disabled.

API references and third-party terms remain in UPSTREAM-REFERENCES.json.
