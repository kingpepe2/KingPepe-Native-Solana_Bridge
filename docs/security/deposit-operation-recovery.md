# Bridge operations and restart recovery

The operation journal retains reserve, pending credit and withdrawal liabilities.
Controller, signer, attester and delivery records retain the exact side effects
needed for retry. Coordinators and relayers hold no private FROST share.
One immutable operation ID binds the request, deployment, amounts, recipient,
inputs, fees and transaction. Inputs cannot fund a second operation.

## Deposit ordering

1. Retain the observed deposit and independently verify Native inputs/finality.
2. Reserve the exact sweep and input outpoints before requesting A+B signatures.
3. Persist the signing attempt and verified aggregate before releasing bytes.
4. Retain signed sweep and broadcast intent before sending.
5. Observe Native finality; retain verified reserve and pending credit together.
6. Each attester retains its exact canonical credit and allocation before signing.
7. Retain the Solana request and signed packet before delivery.
8. Observe finalized claim/mint execution, settle pending credit and reconcile.
9. Mark COMPLETED only after consistent accounting.

An uncertain FROST attempt requires bound abort receipts from both participants
before retry. A saved aggregate is returned exactly without new nonces.
A fee-payer signature does not grant mint authority. Verified attestations and
the Manager PDA remain required.

## Withdrawal ordering

The local withdrawal service discovers finalized withdrawal records and verifies
their creation transaction, user authorization, BurnChecked, exact Mint,
canonical message and deployment. It persists the request as an unpaid liability
before selecting reserve inputs.

A and B independently verify the payout context and Native UTXOs. Input locks
precede signing; exact signed bytes and broadcast intent precede payment.
After a lost response or restart, the worker observes the existing transaction
before considering delivery. Native finality and reconciliation precede COMPLETED.
The same journal/inbox resumes without client resubmission. Duplicate operations
cannot add another liability or payout. Direct SPL burns create no payout right.

## Retry and reconciliation

Native retries preserve inputs and signed bytes. A not-found response is
uncertainty, not permission for a replacement transaction. Solana retries check
previous signatures, finalized height and claim state before refreshing an
expired blockhash for the same economic operation. Missing or malformed evidence
cannot establish a successful negative lookup or authorize another mint.

Expired pending credit remains owed. Replay records and queues are bounded and
never silently pruned. No automatic message renewal or journal migration exists.

Reconciliation reads a stable journal revision, a finalized Solana bank and an
unchanged Native tip. It compares registered reserve with actual supply, pending
credits and unpaid bridge burns, accounting for legitimate pending payout spends.
Direct SPL burns cannot create spendable surplus. Donations and unregistered
reserve moves are not automatically backing. Missing/stale evidence or required
journal catch-up means WAIT. A confirmed contradiction pauses new authorization.

The local service reports ACTIVE or PAUSED. Protected services retain RUNNING,
PAUSED_POLICY and HARD_STOP_INTEGRITY labels for active, policy pause and serious
pause. Healthy observations and restart cannot clear a manual/integrity pause.
Read-only monitoring may continue. Resumption requires KingPepe Team review;
there is no automatic economic repair or runtime pause-clear endpoint.

Protected records use shared DPAPI atomic storage and process locks. The local
chain fixture uses explicitly isolated disposable test storage. Complete protected
Windows service integration is incomplete; local round trips do not certify
production operation, sudden power loss or full-host snapshot recovery.
A released transaction cannot be revoked by an off-chain pause and must still
be observed and accounted. All production activation remains disabled.
