# FROST state

`file-state-store.mjs` provides the localnet JSON signer-state adapter. It rejects
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
V1 state still contains private shares and RESERVED secret nonces; uncertain
nonce restart handling, protected storage and service isolation remain incomplete.
The limitation is the current adapter, not the approved single-host topology.
