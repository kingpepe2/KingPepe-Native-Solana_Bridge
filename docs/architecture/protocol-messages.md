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
- Reserved change.
- Unsettled operation count.

Coverage is checked as:

`reserve >= minted_supply + authorized_unminted_credits + burned_unpaid_withdrawals + reserved_utxo_liabilities + broadcast_payout_liabilities + change_reserved`

A Solana burn moves liability form. It does not remove the bridge's Native payout obligation until the payout is finalized.
