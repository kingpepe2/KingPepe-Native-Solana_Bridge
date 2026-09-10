# Canonical Protocol Messages

Phase 03 defines one versioned binary authorization format for bridge economic messages.

## Encoding

- Magic: `KPEPBRG1`
- Message version: `1`
- Endianness: little-endian for all integer fields
- Message length: `514` bytes
- Destination field: 2-byte length plus 128-byte zero-padded payload
- Hash/public-key fields: fixed 32-byte values
- Amounts and fees: unsigned 64-bit atomic units

The operation ID is `SHA-256` over the canonical economic fields, excluding the operation ID itself. Message digest is `SHA-256` over the complete encoded message.

## Validation

The codec rejects:

- Wrong magic, version, action, or direction.
- Action/direction mismatches.
- Empty or oversized destinations.
- Non-zero destination padding.
- Zero amount.
- Fee greater than amount.
- Zero policy/key epoch.
- Invalid validity window.
- Missing or unexpected deposit outpoint or withdrawal ID.
- Mutated operation ID.
- Trailing data.

## Lifecycle

The shared state machine uses these public state labels:

- `OBSERVED`
- `WAITING_FOR_FINALITY`
- `WAITING_FOR_DEPENDENCY`
- `QUEUED_BY_LIMIT`
- `VERIFIED_READY`
- `SIGNING`
- `BROADCAST`
- `WAITING_SETTLEMENT`
- `COMPLETED`
- `REJECTED`
- `HARD_STOP`

There is no `WAITING_FOR_ADMIN_APPROVAL` state for normal valid transfers.

## Accounting

The Phase 03 ledger model tracks reserve coverage using exact integers:

- Canonical Native reserve.
- Minted Solana supply.
- Authorized but unminted credits.
- Burned but unpaid withdrawals.
- Reserved UTXO liabilities.
- Broadcast payout liabilities.
- Finalized payouts.
- Fees accrued.
- Reserved Native network-fee liabilities and finalized network fees paid.
- Reserved change.
- Unsettled operation count.

Coverage is checked as:

`reserve >= minted_supply + authorized_unminted_credits + burned_unpaid_withdrawals + reserved_utxo_liabilities + broadcast_payout_liabilities + network_fees_reserved + change_reserved`

A Solana burn moves liability form. It does not remove the bridge's Native payout obligation until the payout is finalized.

Phase 08.5 corrected early fee-surplus recognition. Burning gross 1000 with a
5-atomic miner-fee allowance creates 995 net unpaid plus 5 reserved fee liability,
not 5 operator surplus. Reservation and broadcast move only the net liability.
Finalized settlement requires a broadcast obligation and discharges net and
actually paid fee together with the reserve decrease. Project fee remains zero;
network fees are not project income. Unspent fee allowances remain covered until
an operation-bound settlement policy discharges them; the aggregate model is not
that future per-withdrawal policy. Finalized payout is discharged even if a later
Solana acknowledgment is unavailable. No refund/remint or extraction is added.

Every Rust snapshot transition validates a candidate copy before committing it.
Overflow, underflow, invalid operation count, zero/net-zero amounts or failed
coverage leave the previous snapshot unchanged. An already uncovered snapshot
cannot be silently repaired by accepting a donation or another operation.

`LedgerSnapshot` is an aggregate arithmetic model, not an operation journal,
on-chain account, validated chain snapshot or mint/payout authority. It does not
provide operation-level idempotence. The later withdrawal integration still
must bind individual obligations, miner-fee quotes, inputs, change and finalized
outcomes to a consistent durable journal; these aggregate tests do not prove
that integration exists. Generic model fee fields do not authorize a nonzero
project bridge fee or extraction of surplus.

The service's separate `ExactDepositLedger` binds canonical deposit messages
and reserve allocation IDs and retains in-memory operation/backing markers.
Identical pending/minted retries are no-ops; a distinct operation cannot consume
another credit or reuse backing. Finalized reserve settlement creates a credit
even when attestation or minting fails. See the bridge-validator README for its
explicit in-memory and restart limitations.
