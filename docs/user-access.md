# Using KingPepe Bridge

**KINGPEPE MAINNET BRIDGE — ACTIVE.** Use only the official [KingPepe Bridge](https://kingpepe.net/bridge) and follow its current availability checks.

The official Solana KPEPE Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`. It identifies the token and must not be used as a Native deposit address.

Connect Phantom or a compatible Solana wallet. The Bridge binds that wallet before issuing a unique Native deposit address. When the live policy requires user-funded execution, review the SOL execution quote and approve **Pay & Continue**. Wait for **PAID / VERIFIED** and your unique Native address. Send Native KPEPE only to the address displayed for your operation. After **12 Native deposit confirmations**, the Bridge automatically burns the full amount. After verified burn finality, the corresponding amount is minted **1:1** to the original Solana wallet.

The KPEPE Bridge fee is **0 KPEPE**; the user's bridged amount is not reduced. The separate SOL quote includes account rent, execution fees, retry allowance and refund network cost. Unused allowance is refunded to the same wallet after completion; a payment with no Native deposit expires after 24 hours and is refunded after verification. Rent already spent is not refunded. A remainder below its refund network cost remains recorded as refundable. Previously issued operations retain operator funding. A successful Native burn is irreversible, and there is no Solana → Native redemption.

Progress shows the actual deposit, confirmations, burn, burn finality, mint and completion status. Public transaction identifiers allow the user to inspect the operation. Changing wallets does not redirect an existing operation. Do not reuse a completed deposit address; late or multiple deposits require resolution before processing.

The supply counter includes completed Mainnet bridging only, up to **21,000,000 KPEPE**. No development balances are included. The Bridge never asks for private wallet credentials.
