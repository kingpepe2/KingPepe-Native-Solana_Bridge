# Solana Program Boundary

## Current program boundary

The withdrawal-record lifecycle is implemented on chain. Instruction
tag 3 uses nine accounts, in order: writable bridge state, writable withdrawal
record PDA, writable source token account, writable Mint, user burn authority
signer, SPL Token Program, read-only Transceiver config PDA, writable rent payer
signer, System Program. The payer may equal the user's authority but cannot alias
an economic/config/program account. The old six-account ABI is rejected.

The record uses seeds ["kingpepe-withdrawal-record", withdrawal_id] under the
Manager. The program validates its exact PDA, Native domain from the bound
Transceiver config, message/epoch/time, source authorization, Mint and amount.
It creates the 283-byte rent-exempt account with System CPI and PDA signing;
an empty System-owned pre-funded PDA is safely topped up/allocated/assigned.
Nonzero initialized records and substituted accounts are rejected. There is no
close/reuse instruction. Native destinations currently require the supported
34-byte P2TR script format and a nonzero net amount; other formats are not
silently accepted. This format check is not proof of control of a recipient key.

BurnChecked CPI, record creation and both bridge counters commit atomically.
Any later instruction failure rolls back allocation, rent, burn and record.
The Manager counter tracks bridge-issued value minus recorded bridge burns;
it is not overwritten with actual SPL supply. Direct SPL burns change actual
Mint supply but create no payout entitlement. Later bridge burns and mints
preserve that difference, while gross recorded burns remain owed. Reconciliation
reads both counters and actual supply. No Native withdrawal payout exists yet.
The real-validator suite is solana/tests/local-withdrawal-record.mjs; host models
explicitly do not prove Token CPI or fresh-account creation.

Both direct Rust programs compile to SBF and execute the real local deposit
path. Host-only models are not complete on-chain security certification.
Initial enrollment requires the exact Mint
identity to sign both Manager and Transceiver setup; the fee payer alone cannot
take over that Mint's configuration. SPL mint authority stays exclusively a PDA.

The transceiver requires the actual current instruction from the real
Instructions sysvar. Two preceding Ed25519 instructions use strict self-indexed
signature/key fields and cross-reference the same canonical bytes in that
transceiver instruction. Wrong indexes, offsets, current program, bytes or
attester identities fail. Receipt creation and later claim/mint are separate
packet-sized transactions. Persistent claim and Native-outpoint backing PDAs
prevent new nonce/evidence/epoch envelopes from reusing consumed backing.
The backing marker has no close instruction. Receipt/mint does not require the
Mint identity's enrollment signature or per-transfer KingPepe Team approval.

The Transceiver binds protocol ID (u32 LE), Native network code (u32 LE), and
Native genesis (32 bytes) in addition to its previous deployment identities.
Initialize data is tag 1 plus 237 config bytes: Transceiver, Manager, Mint,
Solana deployment (32 bytes each); protocol ID; Native network; Native genesis;
two attesters (32 bytes each); active (u8 boolean); key epoch (u32 LE).
The config account uses KPTCFG02, version 1 and these config bytes (246 bytes).
Old unbound config is rejected. These are project protocol network codes,
not Wormhole chain registrations.

Bridge initialize data is tag 1 plus a compact 207-byte config: environment
(u8); Manager, Transceiver, Solana deployment, Mint, Token Program, mint-authority
PDA (32 bytes each); decimals and Native decimals (u8 each); policy/key epochs
(u32 LE each); deposit-pause, withdrawal-pause, hard-stop and Mainnet-activation
(u8 boolean each). None freeze authority and zero initial supply are mandatory
implicit values; encoders reject requests for other values. The previous
257-byte initialization instruction is rejected, not accepted as an alternative.
Persisted bridge state keeps its previous 256-byte full config representation;
claim/withdrawal/receipt encodings and canonical economic messages are unchanged.
The setup transaction includes all enrollment signatures and is bounded to
1232 bytes before any signer is invoked.

Actual bridge deposit/withdrawal paths enforce local activation, pause/hard-stop
and environment gates. Deposits enforce Clock validity and exact recipient
token-account binding. Production activation remains unreachable. Tests may
bypass token CPI only in cfg(test); the SBF entrypoint always performs the CPI.
Solana-program 3.0.0 and SPL Token interface 2.0.0 retain traditional SPL Token.
No Token-2022 behavior or alternate minter is introduced.

The local deposit run validates bridge PDA Mint authority, zero initial supply,
freeze authority None, and the finalized 100000000 atomic-unit Mint supply.
Withdrawal daemon E2E, complete security cases and production deployment are
not certified by this run. No Anchor-generated IDL is claimed.
