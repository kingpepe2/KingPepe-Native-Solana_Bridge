[![KingPepe](https://i.postimg.cc/rmPh7z7w/King-Pepe-under-2MB.jpg)](https://kingpepe.net/bridge)
# KingPepe Native → Solana Bridge

**Native KPEPE → Solana KPEPE. Check live availability before depositing.**

KingPepe (KPEPE) is a native SHA-256 Proof-of-Work cryptocurrency running on its own independent blockchain. **Native KPEPE** exists on the KingPepe network; **Solana KPEPE** is its bridged SPL representation. The KingPepe Bridge connects them through a verified burn-and-mint process. Mining continues on the native network independently of Solana; the [Explorer](https://kingpepe.net/) shows current blocks. Mining rewards follow the native consensus rules, without any promise of profitability or historical precedence.

Open the official [Bridge](https://kingpepe.net/bridge). Its full-width Bridge workflow appears above a separate, read-only Raydium market display and the KingPepe network story. The market has no trading or wallet-signing controls. The [live status API](https://kingpepe.net/api/v1/bridge/status) determines availability and the active execution policy. Publishing this source or updating the page does not activate a staged policy or clear a verification hold.

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

The following flow applies to **new operations after the user-funded policy is activated** (`executionPolicy: USER_FUNDED`). Current availability must also permit new operations.

1. Connect Phantom.
2. Bind the Solana destination to the operation.
3. Receive and review the current SOL execution quote.
4. Approve **Pay & Continue** from the bound Phantom wallet.
5. Wait for the Bridge to verify finalized, operation-specific funding.
6. Receive the unique Native KPEPE deposit address.
7. Send Native KPEPE to that address.
8. Wait for **12 Native deposit confirmations**.
9. The Bridge rechecks execution funding before irreversible burn. If required, approve **Pay Remaining SOL & Continue** from the same wallet; do not repeat the Native deposit.
10. The exact confirmed Native amount is permanently burned.
11. After verified burn finality and attestation, the corresponding amount is minted on Solana to the original destination, and accounting is reconciled.
12. Unused operation-specific SOL is reconciled and refunded according to the policy below.

## Bridge Fees

**KPEPE Bridge Fee: 0 KPEPE.** KingPepe does not deduct a percentage or fixed amount of KPEPE when bridging from the native network to Solana. The exact confirmed Native amount remains subject to the Bridge's 1:1 burn/mint conservation rules.

**Solana execution costs: user-funded for new operations after cutover.** The connected and bound Phantom wallet funds only its own operation's Solana execution allowance. The required SOL amount is calculated dynamically from current account state, rent, required token-account creation, transaction fees, bounded retries and the refund transaction allowance. The quote is displayed before payment; Phantom's payment-transaction fee is separate. SOL funding is never deducted from the Native KPEPE deposit. This is not a claim that the complete operation has no network costs.

The remaining requirement is recalculated immediately before burn. A shortfall holds only that operation and displays the exact additional SOL required from the bound wallet. Burn waits for sufficient verified funding. There is **no global Team-funded completion backstop; Team reserve required: 0 SOL**. One operation's funds cannot pay for another operation.

Unused SOL allowance is returned to the bound wallet after successful completion, less the disclosed refund transaction cost. Before burn, funding with no Native deposit becomes eligible for expiry after 24 hours; refund waits for verified absence of a deposit and pending execution. A remainder no larger than its refund network cost stays recorded as a liability; it is not an undisclosed fee. Spent account rent is not refunded through this flow. Once burn signing begins or broadcast is possible, completion funds cannot expire, be refunded before completion, or pay for another operation. There is no normal post-burn top-up step. An exceptional shortage beyond the reserved allowance requires operational resolution without changing KPEPE accounting or using another user's funds.

**Legacy / pre-cutover operations:** existing operation IDs, issued addresses and destinations are preserved. Committed or already-burned operations retain their prior operator-funded treatment. Unburned legacy operations remain held for explicit funding-policy review; the cutover does not automatically convert them into user-funded operations. Mandatory new-policy prepayment applies only to operations created after cutover.

**A successful Native burn is irreversible.** No Solana → Native redemption is offered. Disconnecting or changing wallets does not redirect an existing operation. Deposit addresses are single-use; do not send another transfer to a completed operation's address. The Bridge never asks for a wallet's private credentials.

## Supply and progress

For each completed operation, the confirmed Native deposit, finalized Native burn and Solana mint amounts are equal. Cumulative Bridge issuance cannot exceed verified finalized Native burns or **21,000,000 KPEPE**. Pending burns awaiting mint are not counted as completed transfers.

The [live Bridge](https://kingpepe.net/bridge) shows verified completed Mainnet issuance, the remaining amount below the **21,000,000 KPEPE maximum**, and operation progress. Development activity is excluded. The [public status API](https://kingpepe.net/api/v1/bridge/status) reports current availability and verified accounting. See [current status](docs/development-status.md), [user guidance](docs/user-access.md) and [supply accounting](docs/security/monetary-supply.md).

## Security information

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.

No independent security audit has been completed or is claimed. Source review and automated tests are not independent audit certification. Report suspected vulnerabilities through the private reporting guidance in [SECURITY.md](SECURITY.md).

## Source and licensing

Build and regression information is in [development validation](docs/deployment/local-e2e-build.md). Public documentation follows the [documentation policy](docs/public-documentation-policy.md).

Original code: Copyright (c) 2026 KingPepe Team. All Rights Reserved. Preserve [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md) and [provenance](PROVENANCE.json). Historical license grants remain valid.
