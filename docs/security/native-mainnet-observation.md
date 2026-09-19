# Mainnet transaction observation

The maintained KingPepe Mainnet node does not provide confirmed transactions
through a TXID-only lookup. An explicit block hash works. The forward runtime
therefore resolves an unspent output's block from the configured node's current
UTXO observation. A late deposit notification without an output index may scan
only its already-derived recoverable-deposit script. RPC responses are bounded;
a missing transaction or a changed tip waits without granting finality.

The observer verifies the exact raw transaction, amount, output script and
unspent output. The independent Native proof verifier then checks the complete
bounded header chain, work and Merkle inclusion. Deposit inputs and reserve
sweeps each require the approved twelve confirmations. Lookup observations do
not authorize signing, reserve credit or minting.

Mainnet acceptance checkpoints use `KINGPEPE_MAINNET_ACCEPTANCE_CHECKPOINT_V2`.
They retain each verified transaction's block location in the existing protected
operation journal. This lets signers, reserve-credit recovery, attesters and
reconciliation reread spent deposit/fee-input transactions after restart without
a transaction index. Every reread verifies current membership and the retained
packet digest. A changed hint, substituted block or reorg fails closed. The
checkpoint's packet minimum is distinct from the twelve-confirmation signing
policy. The Native relayer uses that policy and checks the exact retained signed
bytes when resolving an ambiguous broadcast acknowledgement.

This changes no Native consensus encoding, forward Borsh V3 wire message or
REGTEST checkpoint format. No Mainnet economic journal exists to migrate from
the earlier preparation-only checkpoint format. Old serialized Mainnet
checkpoints cannot be relabelled as the new format.

Read-only validation against the maintained Mainnet node at height 289,533
passed genesis, explicit-block lookup, unspent-output lookup and independent
headers/work/Merkle verification. No transaction was signed or submitted.
Synthetic regressions cover late notifications, missing data, substituted
membership, changed tips and retained hints. These tests do not constitute a
Mainnet bridge transfer. Final deployment still requires matching source CI,
the remaining readiness checks, funding and Team deployment approval.
