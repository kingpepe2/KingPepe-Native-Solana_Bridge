# Local deposit accounting boundary

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

`AuthenticatedLocalDepositLedger` is an original, LOCALNET/REGTEST-only
accounting journal, not a signing authority or chain verifier. It reuses
`ExactDepositLedger` for economic policy. Explicit creation and reopening are
different operations. Runtime paths and authentication material stay outside
the checkout; no missing database or key is silently replaced.

## Integration and encoding

The real deposit harness records verified finalized backing before Solana setup
or either attester can fail. It closes/reopens that pending credit, then records
mint settlement only after the finalized claim observer and single-operation
reconciliation succeed. It closes/reopens settlement before reporting completion.
Failed setup or attestation leaves an owed credit. Contradictory mint results
create an authenticated sticky stop; there is no reset API.

The Native acceptance checkpoint is a versioned, exact genesis/height/block/work/
confirmation-policy/raw-packet-digest record. Delayed signing and attestation
must reproduce that original digest from the current canonical raw data. The
independent Rust verifier checks both the current branch and the accepted prefix;
current UTXO observations must match the freshly verified tip, followed by another
tip check. Prefix inclusion alone never proves an output is unspent. A forged
checkpoint is not trusted even if its attacker-controlled digest is internally
consistent. A removed or insufficiently finalized basis fails closed.

This fixes evidence identity during delay, not the separate crash window between
Native broadcast/finality and creation of the durable credit. Full recovery must
persist the operation intent and acceptance basis with correct ordering; the
checkpoint helper does not automatically discover missing operation context or
repair accounting. It cannot refresh an expired canonical message, create another
allocation, change a recipient or authorize a production checkpoint policy.

The fixed context is `KPDECL01` (8 ASCII bytes), environment byte 1, 32-byte
journal identity and the canonical 168-byte deployment identity. Each event MAC
is HMAC-SHA256 over context, little-endian sequence u64, kind u8, payload length
u32, previous MAC (32 bytes) and payload. The initial MAC uses sequence/kind zero,
empty payload and a zero previous tag. Credit payload is the exact 514-byte
canonical claim plus 32-byte allocation; mint adds a positive little-endian u64.
Stop payloads are bounded uppercase diagnostic codes, never exception text.
Amounts remain BigInt/canonical decimal strings; totals use checked u128 policy.

Two exact STRICT tables hold events and authenticated head metadata. An event
and its head commit in one SQLite transaction before memory changes. Reopening
checks schema, database integrity, context, MAC chain, sequence and economics.
Exact retries do not append; backing reuse or altered serialization is rejected.
SQL is fixed and private, with defensive mode, trusted schema disabled,
extension loading disabled, authorizer restrictions and explicit limits.
The local bounds are 8192 events and 64 MiB database size, not production caps.
Auxiliary SQLite paths also reject links/nonregular files and have size bounds.

## What the tests do and do not establish

Deposit pipeline, Native sweep and Solana claim journals preserve a recorded
HARD_STOP across cooperating-worker retries and file reopen. Exact repetition
is idempotent; late submitted/completed/waiting results cannot clear the stop or
replace its reason. The pipeline checks the journal and exact/authenticated
ledger at authorization boundaries, including after asynchronous dependencies
and between attesters. Unknown ledger status rejects execution. Dependency
HARD_STOP is never transformed into a retryable wait. A shared stopped credit
ledger blocks new operations in replacement pipeline instances using it.

These controls cannot cancel a signature or transaction already handed off.
An observed outcome arriving after a stop needs reconciliation; it does not
authorize a retry, refund, remint or clearing the stop. Accounting stays unchanged
while stopped, so pending credit may temporarily differ from later chain outcomes
until a reviewed recovery process establishes the correct state. The lightweight
JSON operation journals remain unauthenticated and unfenced; flushing their files
does not prove directory-metadata power-loss survival. The common guard is not
an operating-system-wide stop, cross-process atomic transaction or defense against
deletion/substitution/rollback of all relevant state. No automatic stop-reset API
or per-transfer team approval queue is added.

SQLite EXCLUSIVE mode fences cooperating connections/processes on the tested
local filesystems. DELETE journal mode and synchronous EXTRA are required and
read back. Database close finalizes the bounded cached statements. These runtime
choices follow [SQLite's documented pragmas](https://www.sqlite.org/pragma.html)
and are tested on the exact Node/SQLite binaries, not assumed from API names.

Tests exercise process exit before commit and after committed credit, concurrent
process rejection, tampered state, missing keys, sticky stops, exact amounts and
SQLite page-quota exhaustion. Quota exhaustion is not a physical full-disk test;
process exit is not a power-loss or complete bridge-service restart test.

A retained newer checkpoint rejects an older database. Restoring both database
and checkpoint to the same old snapshot leaves no evidence of lost events;
tests explicitly demonstrate this limitation. Chain/journal reconciliation and
an authorized recovery policy remain necessary before production signing.
This code does not detect every hidden clone, privileged filesystem mutation or
hostile mount. Path prechecks are not atomic race-proof file opens or service ACLs.

The harness uses one disposable journal per deposit. Its accounting is not the
protected operation controller. See [operation recovery](deposit-operation-recovery.md)
for the durable service path, reconciliation and retained pause boundaries.
Renewal across message expiry and production recovery policy remain unimplemented.
Other claim/sweep and FROST state stores are not authenticated by this journal.
Plain local test-key storage is not protected production storage or a fallback
for an unavailable protected-secret adapter. Mainnet remains disabled.
