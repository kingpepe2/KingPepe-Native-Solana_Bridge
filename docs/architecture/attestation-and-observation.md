# Burn observation and attestation

A Native deposit is authorization to the permanently bound Solana recipient, not mint proof. The Native observer discovers the operation's unique address, preserves transaction/block identity and counts confirmations. It holds multiple or late deposits as explicit exceptions. Only finalized deposits with healthy journal, attesters, actual Solana configuration, accounting and separate fee funding enter automatic burn construction.

A finalized Native burn produces the full V4 evidence described in [protocol messages](protocol-messages.md). Two distinct Ed25519 project identities independently verify Native evidence and sign the same canonical bytes. Protected authorization state prevents cross-operation, amount or destination substitution. Renewal after expiry keeps the same burn and operation and cannot bypass on-chain replay state.

Solana observation checks finalized actual program bytes/loader/authority, configuration, exact SPL Mint, replay/claim accounts, destination ATA and signed execution metadata. A receipt alone is not completion. Ambiguous submissions recover from signature/account state before any replacement. Reconciliation accounts for finalized burns pending mint and completed issuance separately.
