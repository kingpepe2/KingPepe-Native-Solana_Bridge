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

The current implementation is still not the required real local E2E run. That
gate remains blocked until a disposable KingPepe regtest daemon/CLI and Solana
local-validator/Anchor toolchain are available and the Solana programs are
deployable in that environment.
