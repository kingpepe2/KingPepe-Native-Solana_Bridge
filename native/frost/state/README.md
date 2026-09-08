# FROST state

`file-state-store.mjs` provides a JSON state-store boundary for development and
test use. It rejects roots inside the source repository and persists signer
state atomically enough for local Phase 04 nonce-reservation tests.

Production storage and protected-secret adapters remain later operational
service work.
