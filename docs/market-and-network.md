# KingPepe market, network and Bridge

The public [KingPepe Bridge page](https://kingpepe.net/bridge) presents the original KingPepe banner, the full-width Native to Solana Bridge, the full-width market display and the native network story, in that order. The connected Bridge workflow has four desktop stages: wallet connection, execution funding, Native deposit and progress. These stack vertically on phones. There is no sticky Bridge sidebar. The market and story contain no trading, order-management or wallet-signing controls. Bridge actions remain in their own section.

Market prices are labeled by their meaning: a verified finalized trade, an available executable quote, a resting ask or a pool reference. An ask is not a last trade. Charts and trade rows use verified history; missing values appear as unavailable. The display covers the existing Raydium CLMM market only. Other markets are not queried or displayed. Data freshness is independent of Bridge readiness.

Native KPEPE originates on the independent KingPepe SHA-256 Proof-of-Work blockchain. Solana KPEPE is the bridged representation. Mining rewards follow the native network's consensus rules. The network card identifies recent block observations and marks stale or unavailable data. It does not promise mining profitability or claim historical precedence.

The market overview shows Mkt Cap, Liquidity and Price USD. Mkt Cap is labeled an indicative Solana supply estimate, using outstanding on-chain Solana KPEPE and the displayed price. It is not a claim about verified circulating supply, native-network market capitalization or fully diluted valuation. Liquidity is Raydium's reported pool TVL estimate, which may exclude unpriced assets or Native Limit inventory. Unknown or stale inputs remain unavailable instead of becoming zero.

For a completed Bridge operation, the confirmed native deposit, finalized native burn and corresponding Solana mint must match. The KPEPE Bridge fee is zero. The originally bound Solana destination remains fixed. The protocol requires 12 Native deposit confirmations and 12 Native burn confirmations.

The interface supports the approved operation-specific Solana execution funding policy without a global Team completion reserve. When that policy is active, payment verification precedes new deposit-address issuance; a pre-burn shortfall requires the bound user to top up the same operation. Completion funds remain reserved once burn begins. Unused eligible funding is refundable under the disclosed policy. The runtime controls these decisions. A page update alone does not activate a staged funding policy, and current public availability is shown by the Bridge status.

The public page uses the existing official Mint, markets and order identities. It does not create, change or trade them.
