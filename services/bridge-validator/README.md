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

`FileBackedDepositJournal` persists completed deposit terminal results and
deposit-outpoint reservations outside the source repository. It is used for
local restart/retry safety so a completed deposit replay does not rebroadcast
the Native reserve sweep or resubmit the Solana claim, and a conflicting
operation cannot reuse an already-reserved deposit outpoint.

`solana-deposit-claim-submitter.mjs` implements the localnet Solana deposit
claim submission boundary used after A+B attestation. It accepts prebuilt
transaction bytes from the local harness/SDK layer, verifies the canonical
deposit message and two project attestations before RPC submission, persists the
operation before broadcast, checks the prior signature outcome before retry, and
requires a finalized deposit-claim observation before returning `COMPLETED`.

`solana-deposit-claim-transaction-plan.mjs` prepares the localnet Solana
deposit-claim instruction and transaction bytes before submission. It derives
the expected bridge state, deposit claim, mint-authority, and transceiver
receipt PDAs; validates the canonical deposit message against configured
Program IDs, Mint, and recipient token account; builds the legacy Solana
message; and can sign with an injected local fee-payer signer. It does not
load, create, or store key files.

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

The current implementation is still not the required real local E2E run. That
gate remains blocked until a disposable KingPepe regtest daemon/CLI and Solana
local-validator/Anchor toolchain are available and the Solana programs are
deployable in that environment.
