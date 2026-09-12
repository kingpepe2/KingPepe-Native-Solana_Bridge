# Deposit operations, delivery and reconciliation

The protected localnet controller composes the Native verifier, FROST
coordinator, attesters, fee payer and delivery adapters. Components have narrow
roles; the controller and relayers contain no private FROST shares. Separate
journal records represent distinct side effects, not alternative economic
ledgers. The operation journal is authoritative for reserve and pending credit.

The public lifecycle is observation, validation, sweep, attestation, claim,
mint and completion. Internal persisted steps distinguish an action prepared
from a blockchain result observed; collapsing those distinctions would make a
lost response unsafe. One immutable operation ID binds deposit outpoint,
recipient, inputs, amount, fees, unsigned transaction and network/deployment.
Inputs and reserve allocations cannot be reused by a second operation.

## Persist before an external action

1. Retain observed intent; independently validate Native inputs/finality.
2. Reserve the exact sweep plan and all input outpoints.
3. Persist the FROST request/attempt before asking A+B. Both independently
   validate. Save the verified aggregate before releasing signed bytes.
4. Retain signed sweep and broadcast intent before enqueue/send.
5. Query the actual Native outcome, verify finality and retain reserve plus
   pending credit together. Death before that write leaves a rediscoverable
   broadcast obligation; death after it must not allocate another credit.
6. Each attester retains the exact canonical message and unique allocation
   before signing, then retains its deterministic Ed25519 result before reply.
7. Retain the Solana unsigned request, then exact signed packet before delivery.
8. Observe actual finalized claim execution and settle the pending mint credit.
9. Reconcile a consistent snapshot before marking COMPLETED.

An uncertain FROST PREPARED attempt needs bound abort receipts from both
participants before another attempt. A saved aggregate can be returned exactly
without generating new nonces. A fee-payer signature is not mint authority.
Only verified project receipts and the bridge PDA authorize on-chain minting.

## Retry rules

Native delivery observes the old transaction first. Retry cannot change inputs
or signed bytes; no RBF/CPFP or replacement payout is generated. A not-found
response is uncertainty, not proof that a transaction never existed.

Solana receipt/claim delivery retains every packet and previous signature.
Before rebuilding an expired blockhash, it checks actual status, finalized
height and claim state. A new packet is the same economic operation, not a new
credit. RPC errors, absent authentication and missing state cannot be interpreted
as a successful negative lookup. An already finalized claim must not mint again.

Expired canonical credit remains owed. Renewal across expiry/epochs is not
implemented by silently changing the message. Queue/session capacity is bounded
and does not auto-prune replay records. These limits need operational planning
before production; they are not approved production transfer limits.

## Accounting and pause

Under one consistent observation:

- journal reserve = pending credits + recorded issued value;
- observed registered reserve = journal reserve;
- Manager issued counter + unpaid bridge burns = recorded issued value;
- actual SPL supply cannot exceed the Manager issued counter;
- required backing = actual supply + unpaid bridge burns + pending credits.

A direct SPL burn reduces actual supply, not bridge-issued accounting or payout
rights. Subsequent bridge burns/mints must preserve that difference. Donations
and unregistered reserve moves do not automatically become available backing.
Native miner fees cannot consume another operation's reserve.

Reconciliation reads a stable journal revision and finalized Solana bank,
bracketed by an unchanged Native tip. Concurrent change, missing/stale sources,
mempool uncertainty or a mint needing journal catch-up means WAIT, not fabricated
surplus/deficit. A confirmed contradiction pauses new authorization and retains
the affected operation/evidence for KingPepe Team review.

The current authority uses RUNNING (ACTIVE), PAUSED_POLICY and
HARD_STOP_INTEGRITY (serious PAUSED) labels. It requires fresh observer and
reconciliation results after restart. Healthy sources never clear a manual or
integrity pause. Read-only observation may continue. No automatic balance repair,
token confiscation, refund, remint or pause-clear path is provided.

## Limits and evidence

Protected records use the shared DPAPI atomic-state/process-lock implementation,
not separate rollback anchors. Reopening validates the complete retained image.
Missing state is never replaced automatically. Off-chain pause cannot revoke
a signature or transaction already released; those outcomes must still be
observed and accounted.

Portable fixtures, CurrentUser Windows protected tests and actual-chain tests
are different evidence. Current results are in development-status.md.
The Linux E2E fixture is explicitly isolated test storage. Full service/power-loss
recovery and complete host-snapshot freshness must not be inferred from a happy
path or a component test. The protected controller is localnet-only and does not
implement Native withdrawals yet. No production systems are enabled.
