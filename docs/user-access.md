# Public Mainnet access — activation pending

[KingPepe Bridge](https://kingpepe.net/bridge) presents KingPepe Native Mainnet -> Solana Mainnet. **ACTIVATION PENDING: no deposits are accepted. Do not send KPEPE yet.** The official standard SPL Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`, with eight decimals and no freeze authority. Program/configuration deployment and controlled activation must complete before public operation creation is enabled.

After activation, the Wallet Standard interface uses `solana:mainnet`, connects the wallet first and binds its destination before issuing a unique single-use Native address. A Native deposit authorizes automatic processing after 12 deposit confirmations. The full amount is irreversibly burned; after 12 burn confirmations, the exact amount is minted to the original Solana destination. Bridge fee is zero; Bridge operations fund the Native miner fee separately. There is no additional approval-to-Bridge button or reverse operation.

The display follows real deposit/confirmation/burn/burn-finality/attestation/mint/completion state. Technical TXIDs, signature, operation ID, Mint and exact state remain collapsed. Resume stores public identifiers only. Disconnect or another wallet account cannot redirect an issued operation. Native address balance is read-only; no private recovery material is requested.

The counter uses only canonical Mainnet burn/mint accounting, with a 21,000,000 KPEPE maximum. Before controlled activation its verified baseline is zero. Historical REGTEST/DEVNET totals are excluded. The activation-pending warning remains until controlled Mainnet activation succeeds; see current development status. The retained loopback SDK/CLI is a development transport and does not replace the public Mainnet wallet flow.

Browser -> Explorer gateway -> authenticated loopback Bridge service. Public capabilities are status, wallet-bound operation creation, operation status and public balances. No admin, raw signing, arbitrary RPC or reverse route is exposed. Mutations require approved same origin, exact schemas, rate/body limits and sanitized errors.

While activation is pending, only read-only status is available; operation/address requests return `ACTIVATION_PENDING`. The pending backend has no signing or deposit-issuance capability.
