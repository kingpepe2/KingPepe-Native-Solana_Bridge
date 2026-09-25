[![KingPepe](https://i.postimg.cc/Xvzs6s0Y/bannerkingpepe.png)](https://kingpepe.carrd.co/)
# KingPepe Native → Solana Bridge

**MAINNET BRIDGE — ACTIVATION PENDING. DO NOT SEND KPEPE YET.**

The official KPEPE Solana Mint exists. The Bridge is completing Mainnet deployment and controlled activation. Public deposit addresses are not being issued, and deposits are not accepted. The public status will change to **MAINNET BRIDGE ACTIVE** only after activation succeeds.

KingPepe Bridge is **ONE WAY: KingPepe Native Mainnet → Solana Mainnet**. Native KPEPE is irreversibly burned before the corresponding amount of KPEPE is minted **1:1** on Solana. The maximum KingPepe supply is **21,000,000 KPEPE**.

## Official token and links

**Official KPEPE Solana Mint:** [`4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`](https://explorer.solana.com/address/4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW).

Name: **KingPepe**. Symbol: **KPEPE**. Standard SPL Token, **8 decimals**, no freeze authority. The Mint address identifies the token; it is not a Native deposit address.

- [KingPepe Website](https://kingpepe.carrd.co/)
- [KingPepe Bridge](https://kingpepe.net/bridge)
- [KingPepe on X (@Kingpepe111)](https://x.com/kingpepe111)
- [KingPepe Native → Solana Bridge GitHub](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge)
- [Official token metadata](https://kingpepe.net/metadata/kpepe-mainnet.json)

## How the Bridge works after activation

1. Connect Phantom or a compatible Solana Wallet Standard wallet.
2. Receive a unique KingPepe Native deposit address bound to that Solana wallet.
3. Send Native KPEPE to the issued address.
4. Wait for **12 Native deposit confirmations**.
5. The Bridge automatically burns the Native amount irreversibly.
6. After verified Native burn finality, the exact corresponding amount is minted on Solana.
7. The KPEPE arrives in the originally bound Solana wallet, and the operation completes after verification.

There is no separate “Approve to Bridge” step. **Bridge fee: 0.** The Bridge does not reduce the user's deposited amount. Network transaction fees are separate from the bridged amount.

**A successful Native burn is irreversible.** No Solana → Native redemption is offered. Disconnecting or changing wallets does not redirect an existing operation. Deposit addresses are single-use; do not send another transfer to a completed operation's address. The Bridge never asks for a wallet's private credentials.

## Supply and progress

For each completed operation, the confirmed Native deposit, finalized Native burn and Solana mint amounts are equal. Cumulative Bridge issuance cannot exceed verified finalized Native burns or **21,000,000 KPEPE**. Pending burns awaiting mint are not counted as completed transfers.

The Mainnet counter currently shows **0 KPEPE bridged / 21,000,000 KPEPE maximum**. Development activity is excluded. See [current status](docs/development-status.md), [user guidance](docs/user-access.md) and [supply accounting](docs/security/monetary-supply.md).

## Security information

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.

No independent security audit has been completed or is claimed. Source review and automated tests are not independent audit certification. Report suspected vulnerabilities through the private reporting guidance in [SECURITY.md](SECURITY.md).

## Source and licensing

Build and regression information is in [development validation](docs/deployment/local-e2e-build.md). Public documentation follows the [documentation policy](docs/public-documentation-policy.md).

Original code: Copyright (c) 2026 KingPepe Team. All Rights Reserved. Preserve [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md) and [provenance](PROVENANCE.json). Historical license grants remain valid.
