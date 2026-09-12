# Canonical Protocol Messages

Phase 11 migrates bridge-owned wire formats to canonical Borsh. Accounting,
state transitions, authority and replay rules remain unchanged. The migration
and new local E2E validation are recorded in `../development-status.md`;
previous-format E2E evidence does not certify this encoding.

## Encoding

- Serialization: Borsh (https://borsh.io/)
- Magic: `KPEPBRG2`
- Message version: `2`
- Endianness: little-endian for all integer fields
- Message length: `514` bytes
- Destination field: 2-byte length plus 128-byte zero-padded payload
- Hash/public-key fields: fixed 32-byte values
- Amounts and fees: unsigned 64-bit atomic units

The fixed-size destination is a Borsh struct with a `u16` length and a
`[u8;128]` array, not a Borsh `Vec`. Its unused tail must be zero. Fixed storage
preserves the bounded Solana instruction/account sizes. All fields are encoded
in the order declared by `BorshBridgeMessage` and `CANONICAL_MESSAGE_SCHEMA`:
magic, version, action, direction, reserved zero, deployment, operation ID,
deposit outpoint, withdrawal ID, amount, fee, destination length/storage,
policy epoch, key epoch, nonce, validity start/end, evidence digest.

The operation ID is `SHA-256(Borsh(OperationIdInputs))`, domain `KPEPID02`.
It retains every previous binding but excludes the operation ID and message
padding. Here destination is a Borsh `Vec<u8>` with a `u32` length. Message
digest is `SHA-256` over the complete Borsh message. The attestation payload is
that same complete message, not a JSON wrapper or its digest. Attester A/B and
the Solana transceiver must use identical bytes.

Only version 2 is accepted. There is no V1 compatibility reader. Existing
runtime journals, signatures, funded deposit commitments and keys must not be
silently rewritten or discarded; validation uses fresh isolated test state.

The TypeScript SDK delegates to the shared runtime codec rather than retaining
a second encoder. Rust and TypeScript consume `canonical-borsh-v2.json`, which
pins message bytes, operation-ID preimage bytes, operation IDs and digests.

## Cross-component migration inventory

| Boundary | Bridge-owned schema/input | Scope |
|---|---|---|
| Attesters / relayer / Solana | Deposit claim, withdrawal request, complete attestation payload, operation-ID inputs | Fixed canonical message and separate ID preimage |
| JS Native observer / Rust verifier | Regtest evidence envelope, headers/proof containers, acceptance checkpoint | Bounded envelope; consensus header/transaction bytes unchanged |
| Validator / attesters | Deposit policy, reserve allocation, credit evidence and nonce inputs | Preserve both initial and finalized acceptance checkpoints |
| Solana programs / observers / SDK | Initialization, claim/withdrawal/receipt instructions and account records | Preserve tags, account lengths, authority and PDA meaning |
| Validator / coordinator / FROST | Signing intent/request/session, commitments, share envelopes, DKG context/handoff | Typed application metadata; Native sighash and Noble primitive unchanged |
| Recovery / reserve / verifier | Deposit commitment, reserve allocation, transaction/evidence fingerprints | Preserve existing consensus-script commitments where already Borsh-compatible |

Native consensus transactions, Script, CompactSize and BIP341/342 hashing, and
Solana transactions/System/SPL/Ed25519 instructions are external protocol
formats, not bridge formats to redesign. Local SQLite persistence, diagnostic
JSON and private protected-store records are not an alternative bridge wire
codec. Bincode remains required by the retained Solana SDK/System-instruction
graph; its upstream advisory is not suppressed by this migration.

### Schema and vector locations

- `canonical-message.mjs` / Rust `BorshBridgeMessage` and `OperationIdInputs`:
  deposit, withdrawal, attester-signed bytes and economic operation identity.
  `canonical-borsh-v2.json` pins three messages, including maximum-width values.
- `solana-bridge-abi.mjs` / Rust `abi.rs`: 14 instruction/account schemas,
  checked by 15 `abi-borsh-v2.json` vectors. Fixed account tags and discriminator
  values are fields, not implicit Rust enum indexes. The existing fixed
  freeze-authority tag/padded key remains a struct, not a Borsh `Option`.
- `bridge-inputs.mjs` / Rust `inputs.rs`: 30 application signing/evidence
  preimages, checked by 31 `inputs-borsh-v2.json` vectors. Each is
  `Borsh([u8;8] = KPINPUT2, u16 kind, typed fields)`; kind IDs and field order
  are explicit in both sources. Strings/collections have bounded `u32` lengths.
  Amounts/counters are typed integers, byte strings decode to actual bytes,
  and participant/public-share ordering is fixed. These are application hash
  bindings; the Native sighash and Noble FROST cryptographic transcript are
  unchanged. JSON transport envelopes carry these typed values or encoded
  bytes; they are not a second economic message encoding.
- `native-inputs.mjs` / Native proof `bridge_inputs.rs`: deposit script intent,
  Native deposit evidence and reserve allocation hash inputs, pinned by four
  Native `inputs-borsh-v2.json` vectors. The fixed `KPDINT01` commitment remains
  byte-identical, as does the fixed Native reserve-allocation preimage. The
  variable raw transaction in deposit evidence now has a Borsh `u32` length.
  The Native Rust allocation ID is not the separate policy-bound service credit
  allocation ID; neither changes reserve accounting.
- Native evidence `borsh-v2.json`: the bounded `KPNEVD02` request envelope and
  fixed 80-byte `KPNEVR02` verifier response. Header/transaction contents are
  opaque consensus bytes; chainwork remains an opaque big-endian 32-byte value.

ABI and application-preimage vectors compare the same logical input, complete
bytes and SHA-256 in both languages. Native input vectors also pin SHA-256d.
They are serialization fixtures, not evidence of valid signatures or real-chain
execution. Actual FROST and both local-chain flows are validated separately.

Local configuration fingerprints, journal integrity/equality checks, outbox
delivery-attempt IDs, status diagnostics and authenticated IPC framing remain
their existing local storage/transport formats. They do not replace a bridge
operation ID, attester payload, Native payment signature or Solana instruction.
No legacy economic-wire reader remains. Existing operational state is not
automatically migrated, erased or made safe to restore by this format change.

`BINCODE = STILL_REQUIRED_FOR_NON_BRIDGE_SDK_SERIALIZATION`.

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

The model prevents early fee-surplus recognition. Burning gross 1000 with a
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
