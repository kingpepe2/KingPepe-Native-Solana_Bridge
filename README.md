[![KingPepe](https://i.postimg.cc/rmPh7z7w/King-Pepe-under-2MB.jpg)](https://kingpepe.net/bridge)
# KingPepe Native → Solana Bridge

**Native KPEPE → Solana KPEPE. Check live availability before depositing.**

KingPepe (KPEPE) is a native SHA-256 Proof-of-Work cryptocurrency running on its own independent blockchain. **Native KPEPE** exists on the KingPepe network; **Solana KPEPE** is its bridged SPL representation. The KingPepe Bridge connects them through a verified burn-and-mint process. Mining continues on the native network independently of Solana; the [Explorer](https://kingpepe.net/) shows current blocks. Mining rewards follow the native consensus rules, without any promise of profitability or historical precedence.

Open the official [Bridge](https://kingpepe.net/bridge). The page shows the Bridge workflow and, below it, the KingPepe network story. It shows no market information; the KPEPE price summary is on the [main page](https://kingpepe.net/). The [live status API](https://kingpepe.net/api/v1/bridge/status) determines availability. Publishing this source or updating the page does not clear a verification hold.

KingPepe Bridge is **ONE WAY: KingPepe Native Mainnet → Solana Mainnet**. Native KPEPE is irreversibly burned before the corresponding amount of KPEPE is minted **1:1** on Solana. The maximum KingPepe supply is **21,000,000 KPEPE**.

## Official token and links

**Official KPEPE Solana Mint:** [`4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`](https://explorer.solana.com/address/4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW).

Name: **KingPepe**. Symbol: **KPEPE**. Standard SPL Token, **8 decimals**, no freeze authority. The Mint address identifies the token; it is not a Native deposit address.

- [KingPepe Website](https://kingpepe.carrd.co/)
- [KingPepe Bridge](https://kingpepe.net/bridge)
- [KingPepe on X (@Kingpepe111)](https://x.com/kingpepe111)
- [KingPepe Native → Solana Bridge GitHub](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge)
- [Official token metadata](https://kingpepe.net/metadata/kpepe-mainnet.json)

## How the Bridge works

The Bridge uses the protected operational SOL reserve for Solana-side completion costs. Current availability must permit new operations.

The minimum is **1,000 KPEPE** in one Native transfer. The Bridge processes **one transfer at a time**: while a transfer is being processed it reports that it is busy and issues no new deposit address.

1. Connect Phantom.
2. Bind the Solana destination to the operation.
3. Receive the unique Native KPEPE deposit address bound to that destination.
4. Send Native KPEPE to that address.
5. Wait for **12 Native deposit confirmations**.
6. Before signing an irreversible Native burn, the Bridge dynamically checks whether its protected SOL reserve covers the current Solana completion allowance, rent and fees. If the reserve is insufficient or a quote is unavailable, burn is blocked and the operation waits safely.
7. The exact confirmed Native amount is permanently burned.
8. After verified burn finality and attestation, the corresponding amount is minted on Solana to the original destination, and accounting is reconciled.

## Bridge Fees

**Minimum: 1,000 KPEPE.** A Native transfer below the minimum is not burned and nothing is minted. Transfers to one address are never added together. The minimum is a threshold, not a fee: the whole amount received is bridged.

**KPEPE Bridge Fee: 0 KPEPE.** KingPepe does not deduct a percentage or fixed amount of KPEPE when bridging from the native network to Solana. The exact confirmed Native amount remains subject to the Bridge's 1:1 burn/mint conservation rules.

**Solana execution costs: funded by the Bridge operational SOL reserve.** The Bridge reserve account covers current Solana transaction fees and required rent. Immediately before an irreversible Native burn, the runtime dynamically checks current fee quotes, required account rent, destination-token-account status and completion headroom. If the balance is insufficient or required observations fail, the burn does not proceed. Users do not make an operation-specific SOL prepayment, and SOL costs are never deducted from the Native KPEPE deposit. **This is not a claim that the complete operation has no network costs.**

The pre-burn reserve gate covers the documented bounded completion allowance. It is refreshed from current Mainnet account state and fee/rent quotes. An unavailable quote, RPC error, or insufficient reserve fails closed. A previously signed or possibly broadcast Native burn is recovered by its durable operation record and completed against finalized chain evidence; it is never blindly submitted twice. The Bridge reserve is shared and is not a user-specific account or refundable deposit.

**A successful Native burn is irreversible.** No Solana → Native redemption is offered. Disconnecting or changing wallets does not redirect an existing operation. Deposit addresses are single-use; do not send another transfer to a completed operation's address. The Bridge never asks for a wallet's private credentials.

## Supply and progress

For each completed operation, the confirmed Native deposit, finalized Native burn and Solana mint amounts are equal. Cumulative Bridge issuance cannot exceed verified finalized Native burns or **21,000,000 KPEPE**. Pending burns awaiting mint are not counted as completed transfers.

The [live Bridge](https://kingpepe.net/bridge) shows verified completed Mainnet issuance, the remaining amount below the **21,000,000 KPEPE maximum**, and operation progress. Development activity is excluded. The [public status API](https://kingpepe.net/api/v1/bridge/status) reports current availability and verified accounting. See [current status](docs/development-status.md), [user guidance](docs/user-access.md) and [supply accounting](docs/security/monetary-supply.md).

## Production architecture

| Part | Role |
|---|---|
| Bridge runtime | Private. Issues deposit addresses, watches Native deposits, burns, mints and reconciles accounting. It is not reachable from the internet. |
| Public gateway | Part of the KingPepe Explorer at kingpepe.net. Validates each request, forwards it to the runtime and publishes only public fields. It holds no signing authority. |
| Bridge page | `/bridge`. The Bridge workflow and the network story. |
| Solana programs | The deployed Bridge and Transceiver programs and the official Mint. |

The production policy is reserve-funded execution, one transfer at a time, a 1,000 KPEPE minimum and a 0 KPEPE Bridge fee. The user-funded execution model is **disabled** and its routes are not served. The exact files production serves are listed with their hashes in [`integrations/explorer/reserve-gateway/release.json`](integrations/explorer/reserve-gateway/release.json).

## Public API

All routes are under `https://kingpepe.net/api/v1/bridge`. Details are in the [Bridge API guide](docs/api/bridge-api.md).

| Route | Purpose |
|---|---|
| `GET /status` | Availability, minimum, fee, confirmation requirements, busy state and verified supply accounting |
| `POST /operations` | Bind a Solana destination and receive its Native deposit address |
| `GET /operations/{operationId}` | Progress of one operation |
| `GET /balances/{solana\|native}/{address}` | Finalized public balance of an address |

Market data for the main page is served separately by `GET /api/v1/market` and `GET /api/v1/market/live`. It is read-only and independent of Bridge availability.

## Gateway connection and automatic recovery

The gateway connects to the runtime when the Explorer starts. If the runtime does not answer, the gateway tries again after 5, 10, 20 and 40 seconds and then every 60 seconds until it succeeds. Each attempt is limited to 30 seconds and only one runs at a time. While unconnected, the Bridge routes answer `503`; every other Explorer page and API keeps working. Reconnecting performs one authenticated read. It changes nothing in the Bridge and submits nothing.

An address request may wait up to 30 seconds for the runtime, because the runtime creates an operation between two of its accounting cycles. Reads are limited to 8 seconds. At most two address requests wait at once.

After the runtime itself restarts, it verifies its accounting against both chains before it reports `ACTIVE`. Until then the public status shows a verification hold and no new address is issued.

## Configuration

Configuration values, credentials and host details are private and are never stored in this repository.

| Name | Used by | Meaning |
|---|---|---|
| `KPE_BRIDGE_CONFIG` | Public gateway | Location of the gateway's private Bridge configuration. Without it the gateway serves no Bridge routes. |

Runtime configuration is documented internally.

## Checking health

1. Open the [status API](https://kingpepe.net/api/v1/bridge/status).
2. An available Bridge reports `state: ACTIVE`, `productionReady: true`, `mainnetActivation: ENABLED`, `executionSlot: AVAILABLE` and `accountingRefreshState: VERIFIED`.
3. `supply.observedAt` is recent, and `bridgedSupplyAtomic` plus `remainingSupplyAtomic` equals `maxSupplyAtomic`.
4. The [Bridge page](https://kingpepe.net/bridge) shows **Available** and the 1,000 KPEPE minimum.

## Troubleshooting

| What you see | Meaning | What to do |
|---|---|---|
| `executionSlot: BRIDGE_BUSY`, or `409 BRIDGE_BUSY` | Another transfer is being processed | Wait. The page retries your own request by itself. |
| `state: PAUSED` with `accountingRefreshState: VERIFYING` | A transfer is being processed or accounting is being verified | Wait. It clears without action. |
| `state: PAUSED` for a long time | A verification hold | No new transfers. Existing operations can still be tracked. |
| `503` on Bridge routes only | The gateway is not connected to the runtime | It reconnects automatically. If it persists, the runtime needs attention. |
| `429` | Too many requests | Wait for the time given in `Retry-After`. |
| Deposit below 1,000 KPEPE | Held, not burned, nothing minted | Do not send a second transfer to the same address. |

## Repository layout

| Path | Contents |
|---|---|
| `solana/` | Bridge and Transceiver programs, SDK and chain regressions |
| `native/` | Native burn, proof and node support |
| `services/` | Bridge runtime, Solana observer, reconciliation |
| `shared/` | Protocol and supply rules used by every part |
| `integrations/explorer/` | The Explorer's Bridge gateway and pages |
| `integrations/explorer/reserve-gateway/` | The gateway and page production serves, with `release.json` |
| `cli/`, `scripts/`, `tests/` | Command line, validation scripts, platform tests |
| `docs/` | Public documentation |

Under `integrations/explorer/`, the files in `src/` and `web/` named in `release.json` under `notDeployed` belong to the disabled user-funded model. They are kept for its regression tests and are not served.

## Build, test and deployment

Use the pinned tools in `scripts/local-e2e-toolchain.json` and locked dependencies.

```
npm ci --ignore-scripts
npm test
```

`npm run test:burn` includes the Explorer integration tests. They stage the integration as production composes it and check every file against `release.json`. Chain regressions and platform tests are listed in `package.json`; see [development validation](docs/deployment/local-e2e-build.md). Tests use isolated local chains only and never a production ledger.

A release is one exact commit with passing CI. Deployment and activation on Mainnet are separate, reviewed steps carried out by the Team; passing tests or publishing source activates nothing.

## Security information

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.

No independent security audit has been completed or is claimed. Source review and automated tests are not independent audit certification. Report suspected vulnerabilities through the private reporting guidance in [SECURITY.md](SECURITY.md).

## Source and licensing

Public documentation follows the [documentation policy](docs/public-documentation-policy.md).

Original code: Copyright (c) 2026 KingPepe Team. All Rights Reserved. Preserve [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md) and [provenance](PROVENANCE.json). Historical license grants remain valid.
