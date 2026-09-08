# Shared utilities

Shared code contains service-side helpers that are reused across bridge
components.

Current implementation:

- `protocol/canonical-message.mjs` decodes, validates, encodes, and hashes the
  canonical bridge message format used by attesters and observers.
- Amounts and timestamps are handled as exact `BigInt` values.
- Message bytes are length-bound and operation IDs are re-derived before use.
