# FROST state

`windows-protected-state-store.mjs` is a separate, real DPAPI-backed adapter for
Windows tests. It is never selected as a fallback to or from plaintext storage.
See [its boundary and remaining service/rollback gaps](../../../docs/security/windows-protected-storage.md).
The following paragraphs describe the isolated JSON test adapter specifically.

`file-state-store.mjs` provides the V2 localnet JSON signer-state adapter. It rejects
source-tree roots, linked paths and nonregular files. The constructor may prepare
an empty external directory, but does not create state or generate a key.

Only `FileBackedFrostStateStore.createLocal({ ...options, policy })` initializes
an empty role-bound envelope. It requires a genuine localnet/REGTEST policy
capability and uses exclusive file creation; an existing file is never replaced.
Use it only for deliberate fresh isolated setup. Ordinary `load()` and `save()`
reject a missing, malformed, incompatible or wrong-role envelope. Missing state
is not a request for replacement keys. Parse/I/O errors do not expose file content
or paths. Public source templates do not contain actual state locations.

Save flushes a new temporary file and renames it after rechecking existing state.
This is not atomic concurrent-update fencing, an ongoing signer lease, directory
power-loss durability or authenticated rollback detection. A failed update may
leave a temporary file in the private external root; it is never published or
automatically adopted as current state. No automatic migration/repair is provided.
V1 state is rejected without migration or deletion. V2 contains the full validated
request, public nonce commitment and persistent tombstone, never the signing
nonce bytes. Those live only in the signer instance and are discarded on abort,
close, failure or consumption. Reopening a signer validates all retained sessions
before burning uncertain RESERVED entries. Completed shares remain idempotent.
This does not protect against process-memory snapshots or privileged clones.
Long-term DKG private shares still use external JSON; protected storage,
authentication, service isolation and full rollback assurance remain incomplete.
The limitations concern this adapter, not the approved single-host topology.

DKG setup temporarily retains each verified incoming contribution and its
request/transcript-bound digest outside Git. The coordinator stages both before
either finalizes. Finalization removes the staged contribution and previous DKG
secret, retaining the final private share and retry digest. Resume never creates
replacement keys. Completed older setup without this digest cannot resume setup
automatically; no migration or deletion is performed. This is not protected or
authenticated storage, and does not prove a rollback-resistant key ceremony.
