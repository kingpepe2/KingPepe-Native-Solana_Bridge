# Canonical forward protocol

The only economic message is `DepositClaim` with direction `NativeToSolana`.
Canonical Borsh V3 uses magic `KPEPBRG3`, version 3 and exactly 482 bytes.
Amounts and fees are unsigned 64-bit atomic integers. Integers use little endian.
The destination is a u16 length and 128-byte zero-padded array; a deposit claim
requires exactly 32 destination bytes. The reserved header byte must be zero.

Field order: magic, version, action, direction, reserved byte, deployment,
operation ID, Native deposit outpoint, amount, fee, destination length/storage,
policy epoch, key epoch, nonce, validity start/end, evidence digest.
No alternative encoding or trailing bytes is accepted.

The operation ID is SHA-256 of the typed Borsh operation inputs, with domain
`KPEPID03`. The full message SHA-256 is its digest. Attesters sign the complete
canonical message, not JSON or a digest wrapper. Rust, the shared JavaScript
codec and the TypeScript SDK use the same pinned vectors.

`canonical-borsh-v3.json` pins three forward messages, including one atomic
unit and u64 maximum. `abi-borsh-v3.json` pins 14 ABI cases.
`inputs-borsh-v2.json` pins 27 retained application preimages. Their `KPINPUT2`
typed envelope is unchanged for retained shapes; the forward-only signing
intent uses kind 31. Removed kinds have no decoder.

Native consensus transactions, scripts, header proof bytes, BIP340/341/342
hashes, Solana transactions and standard System/SPL/Ed25519 instructions retain
their upstream encoding. Native input/evidence vectors remain intact. Required
Solana SDK/System bincode dependencies are not an economic message codec, and
their advisory status is not suppressed.

V3 is incompatible with previous bridge messages and account layouts.
Validation uses a fresh, isolated journal and deployment. Existing credentials,
funded scripts, nonces, signatures and private evidence must not be relabeled.
Old source/CI identity does not validate rewritten source.
