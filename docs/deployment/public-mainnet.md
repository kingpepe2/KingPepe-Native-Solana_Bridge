# Public Mainnet Bridge

The official [Bridge](https://kingpepe.net/bridge) displays **MAINNET**, **ONE WAY**, **Burn Native → Mint Solana 1:1**, and the official Mint `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`.

On-chain deployment and the earlier controlled activation have completed. Current availability and funding-policy activation still come from the live runtime. Bind a compatible Solana wallet; under the new user-funded policy, finalized execution funding is required before a unique Native deposit address is issued. Changing wallets cannot redirect the destination. The Bridge is one way, with exact 1:1 Burn → Mint accounting, a **0 KPEPE Bridge fee**, separate user-funded Solana execution costs, and 12 Native deposit confirmations.

The live status field `executionPolicy` determines whether new operations require separate SOL execution prepayment. Under `USER_FUNDED`, the bound Phantom wallet approves the dynamic quote; a later pre-burn shortfall requires a top-up for that same operation. Global completion backstop: disabled. Team reserve required: **0 SOL**. Funding is exclusive to each operation; eligible unused allowance is refunded. Legacy identities are preserved: committed burns retain prior treatment, while unburned legacy operations require explicit review rather than automatic conversion. See [User access](../user-access.md) and [API behavior](../api/execution-funding.md). Publication of code does not itself activate the policy.

## Public status API

[`GET /api/v1/bridge/status`](https://kingpepe.net/api/v1/bridge/status) reports the current network, official Mint, amount model, minimum deposit, confirmation requirements, fee and availability. An available production response has `state: ACTIVE`, `productionReady: true` and `mainnetActivation: ENABLED`. `EXACT_RECEIVED` means the operation uses the actual confirmed Native amount; network fees never reduce that amount. The only economic maximum is the global **21,000,000 KPEPE** invariant. Use the technical minimum reported by the live Bridge.

The supply counter derives from canonical completed, finalized Native burn/mint accounting. Historical development balances are excluded. Consult the live response for current totals; documentation does not fix or substitute a supply value.

`accountingRefreshState: VERIFIED` identifies fresh verified accounting. During a transient `VERIFYING` hold, the page may retain its last verified value with a stale/verifying label for at most **120 seconds from the verification timestamp**. Fresh accounting replaces it on recovery. Hard accounting failure, reconciliation or conservation failure, invalid data, or expiry clears the value and displays Unavailable. A retained display value never enables transfers or changes availability checks.

Historical reports describe their dated source and network. Visual and wallet acceptance checks are reported separately; a static source check does not establish a manual browser result.
