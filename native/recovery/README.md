# Native recovery crate

Purpose:

- Prepare offline-safe recovery helpers for temporary deposit control proof flows.
- Keep recovery state modeling distinct from live runtime state.

Implemented in Phase 06:

- CSV maturity checks for block-based BIP68/CSV recovery delays.
- Wrong network/genesis rejection.
- Exact temporary outpoint, amount, and script matching.
- Rejection after mint, canonical reserve sweep, spent UTXO, or observed recovery.
- Fee-bound and dust checks.

This module has no secret material, does not request private wallet material,
and does not sign or broadcast recovery transactions.

## Phase 08 REGTEST script and unsigned preparation

`taproot-deposit.mjs` constructs a temporary two-leaf Taproot deposit using the
public BIP341 NUMS internal point. No key-path secret is provisioned. The sweep
leaf checks the existing FROST aggregate x-only public key; the recovery leaf
checks a distinct user Native public key after a block-based CSV delay. Both
leaves commit the deposit intent with a fixed 32-byte push and OP_DROP. The
canonical reserve remains a different key-path P2TR output without that user's
recovery branch. A Solana wallet is not assumed to control the Native recovery
key. This construction is REGTEST-only; no production delay is selected.

The deposit-intent commitment is SHA256 of a fixed binary preimage:

- ASCII `KPDINT01` (8 bytes).
- Seven 32-byte fields: Native genesis, Solana deployment, Manager program,
  Transceiver program, Mint, recipient and nonce, in that order.
- Amount as u64 little-endian; protocol ID, Native network code, policy epoch
  and key epoch as four u32 little-endian integers.

Inputs require canonical lowercase hex, positive checked integer amounts and
the compiled Native REGTEST genesis. The local recipient field is the intended
Solana token-account identity. CSV is bounded to 1..65535 blocks with minimally
encoded script numbers; time-based and disable flags are unavailable. Public
control-block validation checks leaf version, sibling hashes, internal key,
output parity and the actual spent script. It does not assert arbitrary scripts
are safe. BIP342 signing supports only SIGHASH_DEFAULT, no annex and no executed
OP_CODESEPARATOR. Existing key-path vectors remain unchanged.

`prepareRegtestRecoveryTransaction` accepts the raw funding transaction, exact
outpoint/value/script, P2TR destination and explicit fee/max-fee. It returns a
version-2 unsigned transaction and public witness metadata. It never signs or
broadcasts, and does not claim that the UTXO is currently unspent or mature.
It rejects unauthorized fees and conservatively requires net value above the
pinned Native P2TR dust boundary. This is not yet wallet-compatible PSBT tooling.

Eight unit tests and six real-node checks pass in the Phase 08 local harness.
The real checks cover immature and one-block-early recovery, wrong signing
amount, attempts to disable CSV, mature broadcast/finality and replay rejection.
The simulated user's test key exists in memory only; its original buffer is
cleared afterward, without claiming complete managed-runtime memory erasure.
All test wallets and daemon state stay outside the checkout. The recovery test
uses separate test funds and does not create an additional Solana mint credit.

Not yet proved: recoverable-deposit integration into the automatic bridge path,
real FROST signatures spending the sweep leaf, sweep/recovery race and reorg
handling, or offline PSBT wallet compatibility. The Rust eligibility model is
not a substitute for these actual Native script tests. Mainnet stays disabled.

Standard references (not copied implementations): [BIP341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki),
[BIP342](https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki), and
[BIP112](https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki). Native
activation/interpreter facts are pinned in `UPSTREAM-REFERENCES.json`.
