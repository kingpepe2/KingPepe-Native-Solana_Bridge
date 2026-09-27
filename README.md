[![KingPepe](https://i.postimg.cc/Xvzs6s0Y/bannerkingpepe.png)](https://kingpepe.carrd.co/)
# KingPepe Native → Solana Bridge

**KINGPEPE MAINNET BRIDGE — ACTIVE.**

The public Mainnet Bridge is active. Deployment and controlled activation have completed. Open the official [Bridge](https://kingpepe.net/bridge), connect your Solana wallet, and use the unique Native deposit address issued for your operation after the current availability checks pass.

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

1. Connect Phantom or a compatible Solana Wallet Standard wallet.
2. If the live Bridge requires user-funded execution, review the SOL cost and approve Pay & Continue in your connected wallet. After finalized payment verification, receive a unique KingPepe Native deposit address bound to that wallet.
3. Send Native KPEPE to the issued address.
4. Wait for **12 Native deposit confirmations**.
5. The Bridge automatically burns the Native amount irreversibly.
6. After verified Native burn finality, the exact corresponding amount is minted on Solana.
7. The KPEPE arrives in the originally bound Solana wallet, and the operation completes after verification.

**KPEPE Bridge fee: 0 KPEPE.** The Bridge does not reduce the user's deposited amount. When the live policy is `USER_FUNDED`, new operations require a separate SOL execution payment before address issuance. The quote reflects account rent, network fees, a retry allowance and the refund network cost; Phantom's payment fee is shown separately. Existing operations keep their original operator-funded treatment.

Unused SOL allowance is returned to the bound wallet after completion. A payment with no Native deposit expires after 24 hours and is refunded after verification, less the refund network cost. A remainder smaller than its refund network cost remains recorded as refundable, rather than being treated as a charge. Spent account rent is not refundable through this flow. A signed Native burn remains the Bridge's completion obligation; it never requires another user payment to finish minting.

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
