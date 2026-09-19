# One-way Mainnet preparation and activation

Scope: KingPepe Native MAINNET → Solana MAINNET. Mainnet deployment and economic
transactions are not yet authorized at the current execution boundary.
Keep productionReady=false, mainnetActivation=DISABLED,
productionSigningAuthorized=false and productionBroadcastAuthorized=false.

Use local protected `SOLANA_MAINNET_RPC_URL` and
`KINGPEPE_NATIVE_MAINNET_RPC_URL`. Never publish values or credential-bearing URLs.
Admission checks actual genesis and complete configured deployment identity,
not just a network label. No fallback to a test network is allowed.

Prepared dedicated fee payer: `47EPgcpqc11Bo3ghi22LrTA2AERFLnuXccnZhTqoEkFb`.
Prepared dedicated upgrade authority: `4C6VWWdS7CPx7Rdv6iJpB3bfpabr8Tq1dnFDCgMc8qzY`.
Verify the protected keys, ACLs and public identities without printing secrets.
The fee payer and authority cannot substitute for attesters or FROST participants.

The Native reserve requires forward FROST A+B exact 2-of-2 sweeps, separate
processes/protected shares/nonces on the approved single host. The coordinator
has no share. Configure forward attesters, isolated production journal, reserve
identity and encrypted backup references. No test state or funded test script
can become a Mainnet economic operation.

Approved policy:

```
nativeDepositConfirmations = 12
nativeReserveSweepConfirmations = 12
nativeRecoveryCsvDelayBlocks = 1440
solanaCommitment = finalized
nativeMinerFeePolicy = DYNAMIC_NODE_ESTIMATE_WITH_CAP
productionLimitPolicy = UNBOUNDED_BY_TEAM_DECISION
maxMintPerTransfer = UNBOUNDED
maxMintPerWindow = UNBOUNDED
windowDuration = NOT_APPLICABLE
```

Measure relay floor, normal node estimate and actual representative sweep weight
before selecting safety caps. Insufficient estimator data is a real blocker;
there is no fixed-fee fallback. Operator funding pays sweep fees separately from
the credited deposit. Excessive required fee holds the sweep for review.
Unbounded transfer/window policy never waives the absolute Native monetary
ceiling of 21,000,000 KPEPE, or 2,100,000,000,000,000 canonical base units at
eight decimals. It is not a mint allocation. Resulting represented supply must
also remain within eligible Native backing. Checked integer arithmetic, replay
protection, finality and reconciliation remain mandatory.

The public supply counter reads completed, reconciled issuance for the exact
configured network and Mint. Pending requests do not count. TEST and Mainnet
accounting remain separate; stale or inconsistent data cannot display a healthy
progress bar. A critical supply/backing mismatch pauses further mint processing.

Finish all non-funding readiness and freeze artifacts at the reviewed rewritten
source. Run locked dependencies, Node/Rust/FROST/Borsh/security tests, SBF builds,
forward local and Devnet execution, scans, provenance and new exact-SHA CI.
Requote live Mainnet account rent/deployment fees from final artifact sizes and
include modest explicit operational headroom. Request only the measured shortfall.
No funding estimate from an earlier binary is authoritative.

After funding, recheck unchanged source/artifacts/identities and all preflight
conditions. Then request `KINGPEPE_TEAM_ACTIVATION_APPROVAL`. Funding alone is
not approval. After approval deploy only the reviewed forward programs, create a
new Mint with eight decimals, zero supply, Bridge PDA authority and no freeze
authority, and independently verify all identities and owners on-chain.

`services/bridge-validator/mainnet-solana-setup-plan.mjs` prepares unsigned
Mainnet Mint/config initialization bytes with pinned network/domain identities.
It creates no recipient account or initial tokens and initializes the Bridge
paused. Its public synthetic Borsh vectors are decoded and validated by both
the Node tests and the actual Rust program implementations. Preparation does
not verify deployment on-chain or authorize a signature or submission.

The same module prepares the existing Mainnet mode instruction. The Mint
enrollment key must sign mode changes; this is separate from the Bridge PDA's
SPL mint authority and the program upgrade authority. Keep that enrollment key
protected for reviewed pause/activation operations. Creating mode bytes does
not satisfy the funding, deployment-approval or controlled-operation gates.

Start production PAUSED. Record zero-start reconciliation and a clean forward
journal. Only then switch the existing public Explorer gateway/UI from TEST to
the verified Mainnet identities. Keep RPC secrets server-side, Wallet Standard
recipient connection, strict gateway validation and CSP. Publish actual public
Mint/Program/PDA identities; never placeholders described as deployed accounts.

Phase 20 is one small forward operation. Request
`CONTROLLED_ACTIVATION_TRANSFER_AMOUNT` if not yet approved. Require finality,
exact canonical bytes, attestation, exact supply delta, no duplicate claim/mint
and MATCH reconciliation. Any failure pauses and stops activation. Only complete
success permits normal forward operation and productionReady=true with
mainnetActivation=ENABLED. Normal valid transfers need no per-transfer approval.

Accepted risks: SINGLE_HOST FROST; SINGLE_KEY_WITH_REVIEW_CONTROL upgrade authority;
no fixed timelock; no completed external security audit. Cleanup of obsolete test
runtime occurs only after successful activation, after per-path review. Retain
forward security tests, legal notices and required provenance.
