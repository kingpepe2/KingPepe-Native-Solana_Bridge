# Using KingPepe Bridge

Use only the official [KingPepe Bridge](https://kingpepe.net/bridge) and follow its current availability checks. The live runtime determines whether new operations are available and whether the user-funded execution policy has been activated. A published release is not proof of activation.

The official Solana KPEPE Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`. It identifies the token and must not be used as a Native deposit address.

Connect Phantom or a compatible Solana wallet. The Bridge binds that wallet before issuing a unique Native deposit address. When the live policy requires user-funded execution, review the SOL execution quote and approve **Pay & Continue**. Wait for **PAID / VERIFIED** and your unique Native address. Send Native KPEPE only to the address displayed for your operation. After **12 Native deposit confirmations**, the Bridge rechecks the operation's remaining SOL requirement. If it shows **Additional SOL required**, approve **Pay Remaining SOL & Continue** from the same wallet. Do not repeat the Native deposit. The irreversible burn waits for **FULLY FUNDED / VERIFIED**. After verified burn finality, the full corresponding amount is minted **1:1** to the original Solana wallet.

The KPEPE Bridge fee is **0 KPEPE**; the user's bridged amount is not reduced. For new operations after cutover, the user pays the separate SOL execution cost from the bound Phantom wallet. The dynamic quote includes current account rent, execution fees, bounded retry and account-recreation allowance, and refund network cost; the wallet payment transaction has its own network fee. Each operation has its own reserved funding, with no Team-funded global completion reserve or cross-operation subsidy. **Team reserve required: 0 SOL.** Unused allowance is refunded to the same wallet after completion, less the disclosed refund transaction cost. Funding with no Native deposit is eligible for expiry after 24 hours, with refund only after absence of a deposit and pending execution is verified. Rent already spent is not refunded. A remainder no larger than its refund network cost stays recorded as a liability.

After burn signing begins or broadcast is possible, reserved completion funds cannot expire or be refunded until completion. There is no normal post-burn payment request. An exceptional shortage beyond the reserved allowance is held for operational review; it cannot use another operation's funding or alter the KPEPE amounts. **Legacy / pre-cutover operations** keep their identities and destinations. Committed burns retain their prior operator-funded treatment; unburned legacy operations require explicit review and are not automatically converted to user-funded operations. A successful Native burn is irreversible, and there is no Solana → Native redemption.

Progress shows the actual deposit, confirmations, burn, burn finality, mint and completion status. Public transaction identifiers allow the user to inspect the operation. Changing wallets does not redirect an existing operation. Do not reuse a completed deposit address; late or multiple deposits require resolution before processing.

The supply counter includes completed Mainnet bridging only, up to **21,000,000 KPEPE**. No development balances are included. The Bridge never asks for private wallet credentials.

## Common questions

- **Does 0 KPEPE mean no SOL is needed?** No. New-policy operations require their own SOL execution funding, quoted before payment.
- **What if Phantom rejects or a payment fails?** The operation stays unpaid. No usable new-policy Native address is issued and no burn is authorized.
- **Should I create another operation when a top-up is requested?** No. Pay only the displayed shortfall for the existing operation from its bound wallet, and do not repeat the Native deposit.
- **Does a payment signature prove funding?** No. The Bridge verifies finalized payment, exact binding and its own accounting before advancing.
- **Can I change the destination?** No. Reconnecting another wallet does not redirect an operation or its refund.
- **Does market data availability control the Bridge?** No. The read-only Raydium display and Bridge readiness are independent.

Public integration concepts are documented in the [execution funding API guide](api/execution-funding.md).
