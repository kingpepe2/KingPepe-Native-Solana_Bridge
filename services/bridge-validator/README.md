# Bridge validator service

Responsible for sequencing inbound events and orchestrating the canonical flow
between validator observers and signing/observation services.

## Phase 08 source implementation

`automatic-deposit-pipeline.mjs` implements the service-side Native-to-Solana
deposit orchestration boundary for local testing and later adapter integration.
It does not contain production secrets, real operational paths, or live
deployment identities.

The pipeline:

- accepts only configured Native trust levels for deposit evidence;
- refuses to mint against a recoverable-only temporary deposit;
- requires finalized canonical reserve-sweep evidence before attestation;
- drives automatic FROST A+B reserve-sweep signing through the existing
  Native-compatible FROST runtime;
- requires two distinct project attestations over the same canonical message;
- submits one Solana deposit claim through an injected bridge adapter;
- tracks exact BigInt accounting for reserve, unminted credits, minted supply,
  fees, and unsettled operations;
- returns `COMPLETED` only when all required checks pass;
- has no per-transfer KingPepe Team approval state.

The pipeline exposes synchronous and asynchronous processing entrypoints. The
asynchronous entrypoint is for promise-returning local RPC adapters and keeps
the same validation, FROST, attestation, replay, and accounting checks.
Phase 08 source tests also connect this pipeline to the localnet Solana
deposit-claim bridge, durable submitter, and finalized claim observer through
fake loopback RPC fixtures; this is not a substitute for daemon-backed local
E2E validation.

An additional Phase 08 integration test connects the same automatic pipeline to
the real Native reserve-sweep relayer/verifier adapter classes and the localnet
Solana claim bridge/observer adapter classes at the same time, still using fake
loopback RPC fixtures. The separate real-daemon harness is described below;
these fixtures are not independent end-to-end evidence.

The restart/retry integration coverage now uses file-backed deposit, Native
reserve-sweep, and Solana claim journals together. A restart after Native sweep
broadcast but before reserve finality resumes from persisted state, avoids a
second Native broadcast, and mints once after reserve finality is observed.

`FileBackedDepositJournal` persists completed deposit terminal results and
deposit-outpoint reservations outside the source repository. It is used for
local restart/retry safety so a completed deposit replay does not rebroadcast
the Native reserve sweep or resubmit the Solana claim, and a conflicting
operation cannot reuse an already-reserved deposit outpoint.

`solana-deposit-claim-submitter.mjs` implements the localnet Solana deposit
claim submission boundary used after A+B attestation. It accepts prebuilt
transaction bytes from the local harness/SDK layer, verifies the canonical
deposit message and two project attestations before RPC submission, persists the
operation and actual signed transaction identity before broadcast, checks that
signature's prior outcome before retry, and
requires a finalized deposit-claim observation before returning `COMPLETED`.

`solana-deposit-claim-transaction-plan.mjs` prepares the localnet Solana
deposit-claim instruction and transaction bytes before submission. It derives
the expected bridge state, deposit claim, mint-authority, and transceiver
receipt PDAs; validates the canonical deposit message against configured
Program IDs, Mint, and recipient token account; builds the legacy Solana
message; and can sign with an injected local fee-payer signer. It does not
load, create, or store key files.

`localnet-solana-deposit-claim-bridge.mjs` wires the transaction-plan builder
to the Solana deposit submitter for localnet. It fetches or accepts a finalized
local blockhash, prepares the exact signed claim transaction through an injected
fee-payer signer, and submits through the existing durable submitter boundary.
It passes the derived per-operation deposit-claim PDA and configured Mint
account to the finalized claim observer, remains localnet-only, and does not
load production keys or runtime state.

`native-reserve-sweep-adapters.mjs` implements local Native reserve-sweep
adapter boundaries. The relayer validates the FROST A+B transcript, persists
the signed sweep transaction before broadcast, broadcasts through the local
REGTEST RPC boundary, and retries idempotently. The verifier checks source
readiness, sweep finality, deposit-input consumption, reserve script, and exact
atomic reserve output evidence. Its current trust classification remains
`RPC_OBSERVATION`; it is not production consensus validation.

The Solana submitter and transaction-plan builder are intentionally
localnet-only in this phase. They do not configure production RPC or mark
Mainnet ready.

## Signed claim retry boundary

The submitter reconstructs the entire current one-signer legacy claim message
with the existing planner and verifies its Ed25519 fee-payer signature. The
packet must bind the configured programs, traditional SPL Token Program, Mint,
recipient, PDAs, canonical message and reported blockhash. Alternate formats,
extra instructions/trailing bytes and substituted accounts are rejected.

The first signature is known before RPC submission. The external journal saves
that identity before sending; retries query it with transaction-history search.
A missing response is not a failed transaction. Before expiry, only the same
saved packet may be rebroadcast if no status is observed. After expiry, unknown
outcome waits; this implementation never rebuilds the packet. A finalized old
signature can still be observed and settled after its blockhash expires.
Missing/malformed status or height cannot authorize sending or completion.
A substituted RPC-returned signature causes a persistent HARD_STOP.

Journal file contents are flushed before rename. This is not authenticated
storage, cross-process fencing, complete rollback detection or a power-loss
guarantee for directory metadata. Those production requirements remain open.

`solana/tests/local-deposit-security.mjs` runs actual REGTEST/local-validator
deposits and adversarial checks with pinned tools, including claim workers that
exit abruptly before send and after validator acceptance, then resume after
real blockhash expiry. Workers use existing signed packets/public attestations,
not signing keys. This is claim-worker process recovery, not restart of all
services, nonce rollback assurance or completion of both bridge directions.
See `docs/development-status.md` for exact tested source and results.

RPC semantics are reference-only: [sendTransaction](https://solana.com/docs/rpc/http/sendtransaction)
and [getSignatureStatuses](https://solana.com/docs/rpc/http/getsignaturestatuses).
No upstream implementation is copied or audit coverage implied.
