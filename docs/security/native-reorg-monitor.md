# Accepted Native basis and deep reorganization response

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

The localnet verifier now supplies a separately branded current-chain result
after the existing independent Rust parser validates raw regtest headers,
PoW, difficulty, chainwork and Merkle data. A current coinbase provides the
Merkle anchor when an old deposit/sweep has disappeared; it is never credited
as reserve. Canonical chain choice and current UTXO availability still depend
on the configured validating Native node. This is not an independent network
consensus oracle. Existing bounded regtest verification is not a production
genesis-to-tip service.

Actual reserve verification also identifies the deposit and sweep inclusion
blocks. The observer retains operation identity, outpoints, inclusion heights
and hashes, exact atomic value and reserve script. The admission policy binds
network, deployment, key epoch and required confirmations. A caller's plain
object or `verified` flag cannot replace a verified reserve result. Repeated
registration cannot duplicate a deposit or reserve outpoint. New tip progress
does not change the identity of a retained allocation.

A freshly validated higher-work branch is compared with every accepted block
basis. A shallow fork above those blocks can continue. Lower work, an unresolved
equal-work competing tip, missing data or stale/no-progress observations cause
waiting, not fabricated surplus or a confirmed deficit. A conflict invalidating
an accepted basis creates an incident with exact affected operations and value.
The original basis is retained. Whether each affected liability is pending mint
or already represented on Solana must be determined from the economic journal;
the chain monitor does not invent that accounting classification.

The protected Windows wrapper uses a genuine identity-bound DPAPI store,
exclusive lifetime lease and authenticated global integrity client. It writes
the incident before acknowledging it and reports a durable global stop. A failed
local incident write still attempts the separately protected global report.
Existing incident state is replayed on restart; a subsequently healthy chain
does not clear it. No runtime method clears incidents, burns users' tokens,
confiscates funds, remints or fabricates replacement reserve.

## Evidence boundary and remaining work

Pure comparison tests are parser/policy fixtures, not chain proof. The separate
`solana/tests/local-native-reorg.mjs` test completes a real Native-to-Solana flow,
then creates actual regtest competing branches excluding the old sweep. Its
restart probe uses explicitly public test evidence outside the checkout. It is
not protected Windows storage or cross-service certification. Refer to current
development-status for actual executed results; files existing is not a pass.

The Windows wrapper still requires actual protected/chain integration tests.
The independent supervisor progress witness, source-health admission for every
economic service and full broadcast/credit operation recovery remain incomplete.
Retained revisions and current chain checks do not guarantee detection if all
state, anchors and enforcement mechanisms are restored together. A privileged
common-host compromise can defeat local controls; the approved same-host topology
does not require migration to a second signing computer. A production verification
policy, incident resolution and any economic correction need separate Team
authorization and review. Mainnet remains disabled.
