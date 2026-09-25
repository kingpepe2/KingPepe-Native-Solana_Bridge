# Using KingPepe Bridge

**ACTIVATION PENDING — no deposits are accepted. Do not send KPEPE yet.** Use only the official [KingPepe Bridge](https://kingpepe.net/bridge).

The official Solana KPEPE Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`. It identifies the token and must not be used as a Native deposit address.

After activation, connect Phantom or a compatible Solana wallet. The Bridge binds that wallet before issuing a unique Native deposit address. Send Native KPEPE only to the address displayed for your operation. After **12 Native deposit confirmations**, the Bridge automatically burns the full amount. After verified burn finality, the corresponding amount is minted **1:1** to the original Solana wallet. No separate approval-to-Bridge step is required.

The Bridge fee is **0**; the user's bridged amount is not reduced. Network transaction fees are separate. A successful Native burn is irreversible, and there is no Solana → Native redemption.

Progress shows the actual deposit, confirmations, burn, burn finality, mint and completion status. Public transaction identifiers allow the user to inspect the operation. Changing wallets does not redirect an existing operation. Do not reuse a completed deposit address; late or multiple deposits require resolution before processing.

The supply counter includes completed Mainnet bridging only, up to **21,000,000 KPEPE**. No development balances are included. The Bridge never asks for private wallet credentials.
