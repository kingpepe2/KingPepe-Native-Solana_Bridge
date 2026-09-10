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
leaves use the V2 public-intent SHA256 lock described below. The
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
pinned Native P2TR dust boundary.

Ten script/intent/witness unit tests and seven real-node recovery checks pass in
the Phase 08 local harness.
The real checks cover immature and one-block-early recovery, wrong signing
amount, attempts to disable CSV, a substituted public intent preimage, mature
broadcast/finality and replay rejection.
The simulated user's test key exists in memory only; its original buffer is
cleared afterward, without claiming complete managed-runtime memory erasure.
All test wallets and daemon state stay outside the checkout. The recovery test
uses separate test funds and does not create an additional Solana mint credit.

The normal automatic deposit flow now obtains a public recovery key from the
isolated Native user wallet and uses this temporary script. Real FROST A+B
signatures spend the sweep leaf; separately funded key-path inputs pay the miner
fee, preserving the full credited deposit in the distinct canonical reserve.
Only after sweep finality and both attesters' raw-evidence/witness checks does
the local Solana program mint the credit. The same user's recovery leaf is not
present in the canonical reserve. Windows orchestration tests reject missing,
watch-only or malformed recovery public identities before any deposit payment.

Not yet proved: competing sweep/recovery race and reorg handling. End-user
wallet onboarding remains future SDK/app work. The Rust
eligibility model is not a substitute for actual script tests. Mainnet stays
disabled; a happy-path local run is not production activation approval.

## V2 script and offline recovery PSBT

The pinned Native wallet parses tapscript as Miniscript. The prior V1 OP_DROP
intent prefix was consensus-valid but the actual wallet could not sign its
recovery PSBT. V2 uses these standard fragments, where H is SHA256 of the
32-byte public intent commitment, A is the FROST public key and U the user's
Native public key:

- Sweep: `and_v(v:sha256(H),pk(A))`.
- Recovery: `and_v(v:older(delay),and_v(v:sha256(H),pk(U)))`.

The witness contains signature, public commitment, script and control block.
The commitment is not a secret or access-control credential: a valid signature
is still required, and the recovery branch additionally enforces CSV on-chain.
V2 changes the temporary output script. Old V1 outputs are not silently
reinterpreted; funding/script mismatch rejects preparation. No production output
or identity was created or migrated. Existing external test data is preserved.

`recovery-psbt.mjs` prepares bounded PSBTv0/BIP371 data entirely offline. It includes
the unsigned transaction, exact witness UTXO, SIGHASH_DEFAULT, recovery leaf and
control block, public commitment preimage, public key origin, NUMS internal key
and Merkle root. It includes no sweep leaf or private wallet material. The
fingerprint and derivation path must be explicitly supplied as public data.
A proprietary public field records Native genesis and the intent commitment;
ordinary wallets need not enforce it, so it is not a network-verification proof.

The unsigned subset inspector rejects duplicate/unknown or alternate-encoded
fields, unsupported versions, signature fields, malformed lengths, inconsistent
tree metadata and oversized data. This is structural inspection, not UTXO,
script-policy, maturity or user authorization. Preparation/inspection always
return signing and broadcasting unauthorized; wallet compatibility is not
inferred for an arbitrary user's wallet.

Four unit tests cover encoding, public origins and malformed/adversarial inputs.
The isolated real-wallet test uses only a Native public key and its public
origin, asks that test wallet to sign/finalize, and checks actual node acceptance,
finality, receipt at a wallet-recognized address and replay rejection. No private
key is exported. Compatibility is
limited to the pinned Native wallet; other wallets and production are untested.

Standard references (not copied implementations): [BIP341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki),
[BIP342](https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki), and
[BIP112](https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki),
[BIP174](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki) and
[BIP371](https://github.com/bitcoin/bips/blob/master/bip-0371.mediawiki). Native
activation/interpreter facts are pinned in `UPSTREAM-REFERENCES.json`.
