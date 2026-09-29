# KingPepe market, network and Bridge

The public [KingPepe Bridge page](https://kingpepe.net/bridge) presents the original KingPepe banner, the full-width Native to Solana Bridge and the native network story, in that order. It shows no market information and requests none. The connected Bridge workflow stacks vertically on phones. There is no sticky Bridge sidebar. The story contains no trading, order-management or wallet-signing controls.

## Market summary

The KPEPE market summary is on the [main page](https://kingpepe.net/) only. It shows KPEPE/USD, the last seven days, market capitalization and 24-hour volume.

The price is read from the official Raydium pool of the official Mint. Another verified pool of the same Mint is used only when the Raydium pool gives no valid current price, and is labeled as a fallback. A token is identified by its Mint address, never by its name or symbol. No price is fixed in the source, and an old or unverified price is not shown.

While the pool is small the price is labeled **low liquidity** and is indicative. Market capitalization is the displayed price multiplied by the KPEPE in existence, counting each KPEPE once; with an indicative price it is indicative too. Volume covers the verified pools of the official Mint. History shows only what was observed; a market younger than seven days shows a shorter period. Unknown or stale inputs remain unavailable instead of becoming zero.

Market data is read-only and independent of Bridge availability.

## Network

Native KPEPE originates on the independent KingPepe SHA-256 Proof-of-Work blockchain. Solana KPEPE is the bridged representation. Mining rewards follow the native network's consensus rules. The network card identifies recent block observations and marks stale or unavailable data. It does not promise mining profitability or claim historical precedence.

## Bridge

For a completed Bridge operation, the confirmed native deposit, finalized native burn and corresponding Solana mint must match. The KPEPE Bridge fee is zero. The originally bound Solana destination remains fixed. The protocol requires 12 Native deposit confirmations and 12 Native burn confirmations.

The Bridge's protected operational SOL reserve funds Solana execution fees and required account rent. The runtime checks the current fee/rent allowance before an irreversible Native burn and fails closed when the reserve is insufficient or cannot be verified. Users do not make operation-specific SOL payments. Current public availability is shown by the Bridge status.

The public pages use the existing official Mint and market identities. They do not create, change or trade them.
