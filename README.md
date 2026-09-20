[![bannerkingpepe.png](https://i.postimg.cc/Xvzs6s0Y/bannerkingpepe.png)](https://postimg.cc/CZbGjH13)
# KingPepe Native → Solana Bridge

**One-way bridge.** Supported: KingPepe Native → Solana KPEPE.
Solana KPEPE → KingPepe Native redemption is not provided.

Mainnet is not deployed or activated. The public one-way TEST interface is
[KingPepe Bridge](https://kingpepe.net/bridge), using REGTEST → DEVNET.
No Mainnet Mint or program
address is published until independently verified after deployment.

## Deposit flow

1. Select a Solana recipient using Wallet Standard or a public address. The
   destination must have an initialized token account for the exact configured Mint.
2. Enter an exact KPEPE amount and the public Native recovery key. Confirm the
   recipient and save the public deposit request and operation ID.
3. Send Native KPEPE from your own Native wallet to the generated deposit address.
4. The observer verifies Native identity, transaction, output and finality.
   Separate FROST A+B participants sign the reserve sweep using exact 2-of-2.
5. Verified reserve credit becomes a canonical Borsh message. Two project
   attesters sign the same bytes; the Solana Transceiver verifies them.
6. The Bridge claims the receipt once and mints to the bound recipient. Finalized
   Solana evidence and reconciliation are required for `COMPLETED`.

The visible states are `OBSERVED`, `VALIDATED`, `SWEPT`, `ATTESTED`, `CLAIMED`,
`MINTED`, `COMPLETED`. Refresh/status lookup never creates a new operation.
The Solana wallet is a recipient connection; the bridge requests no wallet
signature. Native public-address balance lookup is informational. Users retain
their own Native wallets. Never enter a seed phrase, private key or wallet file.

## Accounting and protection

KingPepe Native's monetary ceiling is **21,000,000 KPEPE**. Solana KPEPE is
representation against eligible Native backing, not independent supply or a
21M mint allocation. Both the monetary ceiling and the stronger backing
invariant apply. See [source confirmation, enforcement and counter semantics](docs/security/monetary-supply.md).

Native and SPL units use eight decimals and exact integers. Eligible canonical
reserve equals authorized pending credits plus cumulative bridge-issued units.
Actual reserve must match the recorded reserve. SPL supply must not exceed
cumulative authorized issuance. Ordinary user token burns may reduce supply;
they grant no reserve-release entitlement. Forward sweep fees are paid from
separate operator fee inputs and are explicitly excluded from backing credit.
The Bridge service fee is zero.

Network/genesis, Mint, program, PDA, account ownership, amount, recipient,
finality and replay checks remain mandatory. Journal state is durable before
external action. Ambiguous responses require chain-state checks. A critical
reconciliation contradiction pauses processing; there is no automatic economic
repair. Resume requires explicit operational review.

Production policy is `UNBOUNDED_BY_TEAM_DECISION`: there are no numeric mint
transfer/window caps. This does not waive reserve, accounting, finality, replay
or reconciliation checks. Approved Native deposit/sweep finality is 12 blocks;
recoverable deposits use a 1,440-block CSV delay. Dynamic sweep fee estimation
and measured safety caps must be ready before activation.

## Trust and deployment status

FROST is retained for forward reserve sweeps. Participants have separate
software processes, protected shares and nonce state on a single host.
Common-host compromise or outage may affect both participants; this is an
accepted risk. The coordinator has no share. The upstream Noble FROST primitive
is UNAUDITED. Project attestations and configured RPC sources are trust boundaries.

Upgrade policy: `SINGLE_KEY_WITH_REVIEW_CONTROL`, no fixed timelock or review
waiting window. The dedicated authority may replace program logic. Reviewed
source/build/tests and specific Team approval are operational controls.
`externalSecurityAuditCompleted = false`.

See [current status](docs/development-status.md),
[accounting](docs/security/local-deposit-accounting.md),
[canonical bytes](docs/architecture/protocol-messages.md),
[recovery](docs/security/deposit-operation-recovery.md),
[program upgrades](docs/security/program-upgrades.md), and
[production plan](docs/deployment/production-plan.md).

## Development and licensing

Pinned tools and isolated test commands are in
[local validation](docs/deployment/local-e2e-build.md). Test state, keys,
databases, backups and build outputs stay outside the checkout.
Historical validation applies only to its named source. Rewritten history
requires new exact-SHA CI; it does not inherit an earlier result.

Original code: Copyright © 2026 KingPepe Team. All Rights Reserved.
See [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
and [PROVENANCE.json](PROVENANCE.json). Historical third-party and prior license
grants are preserved. Report security concerns privately to the KingPepe Team;
do not publish credentials or sensitive reproduction material in an issue.
