# Native proof, reserve, and recovery validation

## Phase 08 raw evidence integration

The isolated REGTEST deposit harness now builds `kingpepe-native-evidence`
from the locked Native proof crate into an external build root. Its only mode
is `--regtest-verify`: a configuration string cannot select Mainnet. The process
receives a bounded binary packet over stdin, uses its own clock and emits only
a packet digest, verified tip identity and counts. No operational packet, cookie,
wallet, key or log is published. Process failure, timeout or output mismatch
fails closed; there is no verification-flag fallback.

The packet begins with `KPNEVD01`. Hashes are 32-byte display-order bytes;
integer counts/heights/indexes are unsigned little-endian u32. Chainwork is an
unsigned big-endian 32-byte value. Fields, in order:

| Field | Encoding/bound |
| --- | --- |
| Magic, Native genesis, expected tip hash | 8 + 32 + 32 bytes |
| Expected tip height, chainwork, minimum confirmations | 4 + 32 + 4 bytes |
| Header count, headers at heights 1 through tip | 4 + count * 80 bytes; count 1..4096 |
| Transaction proof count | 4 bytes; 1..16 |
| Each raw transaction | u32 byte length, then at most 4,000,000 bytes |
| Containing height, transaction index, block txid count | 3 * u32; txid count 1..65536 |
| Complete containing-block txid list | count * 32 bytes |

The whole packet is at most 8,000,000 bytes; trailing bytes are rejected.
Compiled genesis is implicit in the header sequence. The verifier checks
header hashes/linkage, version activations, difficulty, PoW, cumulative work,
median-time-past and the pinned Native two-hour future bound, exact expected
tip, transaction serialization/txid, duplicate identities, Merkle root and
confirmation depth. REGTEST difficulty rules are not substituted for Mainnet.
The synthetic Rust proof fixture tests these boundaries only; it is explicitly
not a full consensus-valid block fixture.

Before either FROST participant exposes a commitment or share, it must have a
fresh private authorization entry for the immutable intent digest. Each role
fetches and verifies the input packet, checks per-input confirmations against
the verified header height, checks fresh unspent outputs from the configured
node and recomputes the transaction/sighash, ordered inputs, output commitments,
recipient, amount, fees and change. The 30-second monotonic in-process fence is
not persistent rollback protection or authenticated IPC. Core cryptographic
fixtures without a source adapter do not represent an operational service.

After sweep finality, each attester fetches/verifies the parents and exact sweep
again, independently verifies actual witness signatures, checks the canonical
reserve UTXO and verifies the same evidence digest
before Ed25519 signing. Signing the claim without a verifier is rejected. The
pre-sweep FROST operation and later mint claim have distinct identities: finalized
sweep evidence does not exist when the sweep itself is authorized. Finalized
raw evidence is bound into the canonical claim evidence digest. Permanent
on-chain outpoint markers still prevent reuse across either identity/epoch.

Native RPC responses are streamed with a byte limit, strict UTF-8 and matching
request IDs. The collector rejects wrong genesis/network, unknown/true IBD,
header/tip mismatch, source changes and substituted raw transaction/block data.
Economic amounts stay exact integers.

Important limitations: raw header/Merkle verification is not full block-script
validation, independent fork-choice proof or UTXO proof. Canonical-chain selection
and unspent state retain `CONFIGURED_LOCAL_VALIDATING_NODE_RPC_OBSERVATION`
trust. A/B use the same host and Native node, not physically independent sources.
The CLI is REGTEST-only and bounded to short local chains; production evidence
sources and resource policy remain unconfigured. The normal REGTEST deposit now
uses the committed recovery script and a real FROST BIP342 sweep to a separate
reserve. See [recovery construction and scope](../../native/recovery/README.md).
Competing recovery/sweep transactions, reorgs, PSBT wallet support, production
storage/fencing and complete failure testing remain Phase 08 gaps.

Each role rebuilds the temporary script against the expected deployment, Mint,
recipient, amount, epochs, intent nonce, Native user recovery public key, FROST
public key and CSV delay. The user's Native wallet supplies only a public key;
its private material stays in the isolated test wallet. The 144-block default is
explicitly REGTEST-only, not a production policy value. Fee inputs use reserve
key-path scripts; the deposit input uses the committed sweep leaf. A and B each
recompute the corresponding BIP342/BIP341 sighash before participating.

The finalized witness checker requires the exact committed sweep script/control
block, one default 64-byte signature for each input, the configured FROST public
key and recomputed sighashes over actual inputs/outputs. Altered witness bytes
can leave the legacy txid unchanged, so raw transaction inclusion alone does not
replace this check. The helper accepts the bridge's limited sweep script, not
arbitrary Native scripts, annexes or alternative sighash types. Native consensus
validity and canonical UTXO selection retain the node trust boundary above.

## Phase 06 primitives

Phase 06 adds KingPepe Native validation primitives for source-side evidence.

Implemented boundaries:

- Native chain parameters for Mainnet and regtest from reviewed recovery material.
- 8-decimal atomic KPEPE accounting.
- KingPepe REGTEST local-runner facts from reviewed recovery material:
  coinbase maturity `20`, Bech32m HRP `rkpepe`, and Taproot active from height
  zero.
- SHA256d 80-byte block-header parsing.
- Compact target decoding/encoding, PoW target checks, difficulty retargeting, and chainwork accumulation.
- Header version activation checks for the pinned KingPepe Native rules.
- Bounded transaction parsing for non-witness and BIP144 witness serialization.
- Merkle branch reconstruction and verification.
- UTXO observation checks so Merkle inclusion alone is not treated as proof that a deposit output remains unspent.
- Temporary deposit validation for exact outpoint, amount, script, recipient commitment, finality, and UTXO state.
- Canonical reserve sweep validation before mint credit is authorized; the
  credited temporary-deposit amount must reach canonical reserve, while Native
  miner fees require separate fee-funding evidence and are accounted separately.
- Recovery eligibility checks for CSV maturity, unspent status, wrong network, sweep/mint conflicts, duplicate recovery, fee bounds, and dust.

Trust boundary:

- `RPC_OBSERVATION` is not equivalent to consensus.
- `LOCALLY_VALIDATED_CHAIN_STATE` means the local proof engine accepted headers, work, and inclusion evidence according to configured parameters.
- `PROJECT_ATTESTATION` remains a later attestation layer and does not make unchecked chain data true.

The Phase 06 primitives do not broadcast transactions, manage wallets, load
secrets or activate Mainnet. The Phase 08 harness above exercises real isolated
REGTEST and Solana local-validator operations; this is not live deployment.
