# Finalized Native burn protocol

The sole active economic message is Borsh V4, magic `KPBRMSG4`, exactly 563 bytes. `shared/protocol/burn-message.mjs` and `solana/modules/bridge-messages/src/burn.rs` encode the same 530-byte finalized-burn evidence plus version/domain, key/policy epochs and validity interval. The fixed vector is `burn-borsh-v4.json`; old V3 deposit/reserve messages are rejected.

The operation binding contains protocol and Native network/genesis, actual Solana genesis/deployment, Bridge/Transceiver/Mint identities, destination wallet, burn public identity and nonce. Its digest is the operation ID, created before the deposit address. Evidence adds original deposit outpoint/height/block, burn outpoint/height/block, exact amount and versioned commitment. Burn height must follow the 12-confirmation deposit boundary. Verifiers independently require 12 burn confirmations from Native chain evidence.

The 57-byte OP_RETURN script carries `KINGPEPE_BRIDGE_BURN_V1` and a compact SHA-256 commitment to the operation, original deposit and exact amount. It contains no secret. Native RPC maxburnamount is a per-output ceiling, so Bridge validation independently permits exactly one canonical nonzero unspendable output and an approved operational change output.

Both Ed25519 project attesters sign the complete canonical bytes. Transceiver verifies two distinct authorized signatures and exact context. Bridge validates the receipt, bound wallet's exact-Mint ATA, account owners, programs, PDAs, amount, epochs, pause and cumulative cap. Operation, Native deposit and Native burn replay accounts prevent reuse, even after authorization renewal. Solana trusts these project attestations for Native consensus evidence; it does not independently run a Native light client.

Malformed, trailing, truncated, non-canonical and cross-context encodings are rejected. The TEST evidence package records actual signed bytes as well as shared Rust/TypeScript vectors.
