# FROST signer

`native-frost-signer.mjs` implements one software FROST participant.

Each signer performs its own policy checks, persists nonce reservations before
exposing commitments, tombstones nonce material before producing signature
shares, and stores private runtime state only through a caller-provided state
store outside the source repository.
