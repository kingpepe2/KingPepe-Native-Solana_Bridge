# Shared utilities

Shared code contains service-side helpers that are reused across bridge
components.

Current implementation:

- `protocol/canonical-message.mjs` decodes, validates, encodes, and hashes the
  canonical bridge message format used by attesters and observers.
- Amounts and timestamps are handled as exact `BigInt` values.
- Message bytes are length-bound and operation IDs are re-derived before use.
- `runtime-path-boundary.mjs` protects the actual checkout (plus any additional
  configured source root) before runtime paths are used. It distinguishes a
  `..` component from a child beginning with `..`, resolves existing parents,
  rejects source ancestors, broad roots, linked components, hard-linked or
  nonregular files, and rechecks file paths on access. Windows device/stream
  namespaces and relative paths are not supported runtime configuration.

Runtime paths must be dedicated, non-linked local directories outside source.
This helper does not create keys, reset journals, enforce Windows ACLs or prove
cross-process fencing. A precheck followed by a file operation is not an atomic
security boundary against concurrent directory replacement. Filesystem identity
checks cover tested case aliases; they are not comprehensive mount/clone
detection. Privileged host compromise remains a shared A+B risk. The pinned
[Node filesystem documentation](https://raw.githubusercontent.com/nodejs/node/v22.23.2/doc/api/fs.md)
describes pathname aliasing and check/use races. Service permissions, protected
storage, authenticated journals and rollback assurance remain separate work.
