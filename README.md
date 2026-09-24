[![bannerkingpepe.png](https://i.postimg.cc/Xvzs6s0Y/bannerkingpepe.png)](https://postimg.cc/CZbGjH13)
# KingPepe Native -> Solana Bridge

The current source implements **ONE_WAY_AUTOMATIC_BURN_AND_MINT**. The public [KingPepe Bridge](https://kingpepe.net/bridge) remains REGTEST -> DEVNET. Mainnet deployment has started with the verified zero-supply KPEPE Mint; the Bridge programs and production processing are not yet deployed or activated. See [current validation and deployment status](docs/development-status.md).

The official Solana Mainnet KPEPE Mint is [`4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`](https://explorer.solana.com/address/4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW). It uses standard SPL Token, 8 decimals, initial supply 0 and no freeze authority. Its Mint authority is the expected Bridge PDA; the program controlling that PDA still awaits deployment. No Mainnet Native deposit or burn has occurred. [Deployment evidence](docs/deployment/mainnet.json) distinguishes the created Mint from pending programs and activation.

Official project links: [KingPepe Website](https://kingpepe.carrd.co/), [KingPepe Bridge](https://kingpepe.net/bridge), [KingPepe on X (@Kingpepe111)](https://x.com/kingpepe111), and [KingPepe Native -> Solana Bridge GitHub](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge). The existing Mint's [canonical metadata](https://kingpepe.net/metadata/kpepe-mainnet.json) preserves the approved logo and describes irreversible Native burn followed by verified exact 1:1 Solana minting.

## Transfer

Connect a Solana Wallet Standard wallet on the configured TEST chain (`solana:devnet`). The Bridge binds the wallet destination before issuing a unique, single-use Native deposit address. Send from your own Native wallet. The deposit is authorization; there is no separate approval button and the website cannot spend your wallet.

After 12 Native deposit confirmations and the pre-burn checks, the next processing cycle signs and broadcasts an exact-value OP_RETURN burn. Separate Bridge operational inputs pay its miner fee. After 12 burn confirmations, two project attesters sign canonical Borsh V4 burn evidence. Solana verifies the attestation, consumes the deposit and burn exactly once, and mints to the original wallet. Finalized execution and matching reconciliation complete the operation.

**A successful Native burn is irreversible.** The Bridge fee is **0**. The deposit is not reduced by the Bridge: confirmed deposit = finalized Native burn = Solana mint. Late deposits to retired addresses and multiple separate deposits enter an exception state; they are not automatically burned or minted. Transfers are not batched. Wallet disconnect or account changes cannot redirect an existing operation.

Solana -> Native redemption, withdrawal and Native payout are not provided. Wallet connection never requests a private key, seed phrase or wallet file. Native public-address balance lookup is informational.

## Supply and accounting

KingPepe Native's source monetary maximum is **21,000,000 KPEPE**. Both Native and Solana use 8 decimals: **2,100,000,000,000,000 base units**. This is a monetary ceiling, not a Bridge mint allocation.

Cumulative Bridge-created Solana units must not exceed either 21M or verified finalized Native burns. Finalized burns awaiting mint are explicit pending obligations. Every completed operation has equal burn and mint amounts. Holder-initiated SPL burns reduce live token supply without reopening the cumulative issuance cap or creating a redemption entitlement. See [the accounting equation and source evidence](docs/security/monetary-supply.md).

The public counter uses completed, canonically accounted burn/mint operations. It does not count requests, observed deposits or pending burns. TEST and future production journals/Mints remain isolated. Missing, stale or contradictory accounting is displayed as unavailable, not as healthy progress.

`productionLimitPolicy=UNBOUNDED_BY_TEAM_DECISION` means no arbitrary per-transfer or time-window monetary cap. Finality, the 21M ceiling, conservation, replay checks and reconciliation remain mandatory. Storage and fee-funding exhaustion hold new work safely; they never reduce the user's burn amount.

## Trust and recovery

Native burn custody uses **SINGLE_KEY_ACCEPTED_RISK**. The root signs independently derived operation addresses and a separate operational fee address. It is server-side and DPAPI-protected; it is separate from Solana payer, upgrade authority and attester keys. No FROST is used. Compromise before burn may permit theft of temporarily held deposits and operational fees. The private automatic signer must prove access isolation from Explorer, restart safety and the existing burn admission controls; Windows Service/SCM hosting is not required.

**OFFLINE_RECOVERY_BACKUP = NOT_REQUIRED_BY_TEAM_DECISION; RECOVERY_RISK = ACCEPTED_BY_KINGPEPE_TEAM.** No offline backup is claimed. Loss of the only usable burn signing material may leave confirmed but unburned Native deposits unavailable for automatic processing/recovery. Cloudflare does not mitigate that risk or protect the key. Removing the offline-copy and SCM requirements does not waive protected storage, automatic signer verification or any burn/mint invariant.

The journal and exact signed transactions persist before broadcast. After an ambiguous response, recovery checks the existing Native transaction or Solana claim before retrying the same action. A finalized burn remains a mint obligation after restart. Critical contradictions persistently pause economic processing; there is no automatic economic repair.

Native header/Merkle checks and configured RPC observations have their stated trust boundaries. Solana relies on two authorized project attesters for Native burn evidence, rather than running Native consensus itself. The upgrade model is `SINGLE_KEY_WITH_REVIEW_CONTROL`, with no fixed timelock or waiting window. The upgrade authority can replace program logic. Specific Team approval is required for production upgrades. No independent external audit is claimed.

## Development

[Validation commands](docs/deployment/local-e2e-build.md), [protocol](docs/architecture/protocol-messages.md), [recovery](docs/security/deposit-operation-recovery.md), [key protection](docs/security/windows-protected-storage.md), [production execution plan](docs/deployment/production-plan.md).

All runtime state, keys, credentials, backups and build outputs stay outside Git. Historical CI certifies only its named source. New commits require matching CI.

Original code: Copyright (c) 2026 KingPepe Team. All Rights Reserved. Preserve [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), and [provenance](PROVENANCE.json). Historical license grants are not revoked. Report security concerns privately to the KingPepe Team; do not post secrets in public issues.
