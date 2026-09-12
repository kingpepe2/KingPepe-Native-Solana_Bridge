# Attestation and Solana observation

## Implemented local boundaries

Native signing is separate from two project Ed25519 attesters. Each local
attester's policy checks the same canonical deposit-credit bytes, deployment,
epochs, reserve transition and evidence digest. The local E2E additionally
invokes raw Native evidence validation for each role. The generic attester class
alone accepts evidence through a policy interface; it is not a validating node.
Two signatures prove who signed, not that their chain assertions are true.

The attester copies its key into a private field, freezes normalized policy
and identity, isolates caller mutation, makes close irreversible and checks the
actual clock when no test clock is supplied. Explicit historical vector clocks
are test inputs, not an expiry bypass or a production clock source.

The real Transceiver requires two distinct authorized Ed25519 verification
instructions over identical canonical bytes. Instructions sysvar identity,
program/index/offset/length/key/message constraints are checked. Finalized receipt
creation precedes a separate atomic claim/mint transaction. The Manager, not
the Transceiver, holds mint authority through a PDA.

The local deposit observer reports RPC_OBSERVATION, even for a locally launched
validator. It reads transaction meta, finalized slot, claim account and SPL Mint;
checks PDA, layout, account program, snapshot freshness, decimals and mint
authority; and exposes freeze authority for downstream hard-stop policy.
Its RPC transport is loopback-only, redirect-disabled, timeout/body-bounded and
requires matching JSON-RPC response IDs. Malformed, oversized, unavailable or
error responses never become evidence; provider details are not surfaced.

The retained withdrawal policy model checks supplied protocol fields. The local
FinalizedWithdrawalReader reads actual finalized creation transactions, exact
BurnChecked execution, canonical messages and withdrawal PDAs. Its bounded
discovery feeds the existing durable journal and Native payout service.
Solana evidence remains RPC_OBSERVATION; non-localnet operation is blocked.

## Trust and missing guarantees

RPC_OBSERVATION, LOCAL_VALIDATION (the current code's local-validation label),
and PROJECT_ATTESTATION are distinct. LOCAL_VALIDATION labels supplied to a policy
model are not independent chain proofs. Shared-host services or sources are not
physically independent observers. The model is KingPepe Team controlled,
PROJECT_ATTESTED_2_OF_2, not decentralized or trustless.

The separate deployment adapter reads actual genesis, program/ProgramData,
authority, Mint and configuration accounts against a pinned manifest. Confirmed
changes pause new authorization; missing/stale sources suspend it. See
[chain checks](../security/solana-deployment-monitor.md). A static program ID or
arbitrary RPC finalized label is not independent consensus proof.

Protected local storage, authenticated IPC and durable operation recovery are
implemented separately from the lightweight test adapters. Full-host snapshot
freshness and distinct service-principal certification are not claimed. Current
executed results belong in development-status.md. Production observation is
NOT_CONFIGURED and external review is NOT_RUN.
