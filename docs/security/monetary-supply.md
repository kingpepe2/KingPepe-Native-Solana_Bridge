# Supply and exact accounting

KingPepe's maximum supply is **21,000,000 KPEPE**. The Native source at commit `3f2621820ffefae59cbe48b350f5f8f6ec8a6da5` defines 100,000,000 base units per KPEPE and the 21,000,000 KPEPE monetary maximum in `src/consensus/amount.h`. Native and Solana KPEPE both use eight decimals.

Each completed Bridge operation requires exact equality between confirmed Native deposit, verified finalized Native burn and Solana mint amounts. The KPEPE Bridge fee is **0 KPEPE**, and network transaction fees do not reduce the bridged amount. Solana execution costs are paid from the Bridge operational reserve and are checked before an irreversible Native burn; if the required cost cannot be verified or covered, the operation is held before burn. SOL execution costs are separate from KPEPE deposited, burned and minted.

Cumulative Bridge-created Solana KPEPE cannot exceed verified finalized Native burns or the 21M maximum. Finalized burns awaiting mint remain pending obligations and are excluded from the completed-transfer counter. A holder's ordinary SPL token burn reduces live supply without reopening cumulative Bridge issuance capacity or creating a Native redemption entitlement.

The Mainnet counter is independent of development activity. Before the first successful Mainnet operation, the verified baseline is **0 / 21,000,000 KPEPE**. Missing or contradictory observations must not be displayed as successful completion.
