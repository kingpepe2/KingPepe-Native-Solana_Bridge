# Public Mainnet Bridge — ACTIVE

The official [Bridge](https://kingpepe.net/bridge) displays **MAINNET**, **ONE WAY**, **Burn Native → Mint Solana 1:1**, and the official Mint `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`.

Deployment and controlled activation have completed. Connect a compatible Solana wallet to receive a unique Native deposit address after the live availability checks pass. The destination is bound before the address is issued and cannot be redirected by changing wallets. The Bridge is one way, with exact 1:1 Burn → Mint accounting, zero Bridge fee and 12 Native deposit confirmations.

## Public status API

[`GET /api/v1/bridge/status`](https://kingpepe.net/api/v1/bridge/status) reports the current network, official Mint, amount model, minimum deposit, confirmation requirements, fee and availability. An available production response has `state: ACTIVE`, `productionReady: true` and `mainnetActivation: ENABLED`. `EXACT_RECEIVED` means the operation uses the actual confirmed Native amount; network fees never reduce that amount. The only economic maximum is the global **21,000,000 KPEPE** invariant. Use the technical minimum reported by the live Bridge.

The supply counter derives from canonical completed, finalized Native burn/mint accounting. Historical development balances are excluded. Consult the live response for current totals; documentation does not fix or substitute a supply value.

`accountingRefreshState: VERIFIED` identifies fresh verified accounting. During a transient `VERIFYING` hold, the page may retain its last verified value with a stale/verifying label for at most **120 seconds from the verification timestamp**. Fresh accounting replaces it on recovery. Hard accounting failure, reconciliation or conservation failure, invalid data, or expiry clears the value and displays Unavailable. A retained display value never enables transfers or changes availability checks.

Historical reports describe their dated source and network. Visual and wallet acceptance checks are reported separately; a static source check does not establish a manual browser result.
