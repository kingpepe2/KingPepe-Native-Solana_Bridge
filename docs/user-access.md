# Using KingPepe Bridge

Use only the official [KingPepe Bridge](https://kingpepe.net/bridge) and follow its current availability checks. The live runtime determines whether new operations are available. A published release is not proof of activation.

The official Solana KPEPE Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`. It identifies the token and must not be used as a Native deposit address.

The minimum is **1,000 KPEPE** per transfer and the Bridge processes **one transfer at a time**.

Connect Phantom or a compatible Solana wallet. When the Bridge is available it immutably binds that wallet and issues a unique Native deposit address. Send Native KPEPE only to the address displayed for your operation. After **12 Native deposit confirmations**, the Bridge checks its protected operational SOL reserve against current Solana completion requirements before signing an irreversible Native burn. If the reserve is insufficient or the estimate cannot be verified, processing waits safely and the burn is not signed. After verified burn finality, the corresponding amount is minted **1:1** to the originally bound Solana wallet.

The KPEPE Bridge fee is **0 KPEPE**; the user's bridged amount is not reduced. Solana-side execution fees and required account rent are paid from the protected Bridge operational SOL reserve. Before burn, the runtime refreshes the balance, account state, rent and fee observations and requires adequate completion headroom. Users do not pay an operation-specific SOL execution deposit. The reserve is not a user deposit and is not refunded to the user's Phantom wallet.

If reserve funding is insufficient, the operation remains safely pending and the Native burn does not proceed. If a burn may have been submitted, the runtime first checks authoritative Native and Solana chain state and recovers the original operation rather than blindly resubmitting. A successful Native burn is irreversible, and there is no Solana → Native redemption.

Progress shows the actual deposit, confirmations, burn, burn finality, mint and completion status. Public transaction identifiers allow the user to inspect the operation. Changing wallets does not redirect an existing operation. Do not reuse a completed deposit address; late or multiple deposits require resolution before processing.

The supply counter includes completed Mainnet bridging only, up to **21,000,000 KPEPE**. No development balances are included. The Bridge never asks for private wallet credentials.

## Common questions

- **Does 0 KPEPE mean no SOL is needed?** No. The Bridge operational reserve pays the required Solana network and account costs.
- **What is the smallest amount I can bridge?** **1,000 KPEPE**, in one Native transfer. The whole amount received is bridged; the minimum is not a fee.
- **What if I send less than 1,000 KPEPE?** It is not burned and nothing is minted. It stays recorded against your operation. Do not send a second transfer to make up the difference: transfers to one address are never added together.
- **Why does the Bridge say it is busy?** It processes one transfer at a time. While another transfer is being processed no new deposit address is issued. Wait until the Bridge is available, then start your transfer.
- **Can I change the destination?** No. Reconnecting another wallet does not redirect an operation.
- **Does market data availability control the Bridge?** No. The Bridge page shows no market information. The price summary on the main page and Bridge readiness are independent.

Public API responses expose availability, the minimum amount and operation progress. Users make no SOL payment to the Bridge.
