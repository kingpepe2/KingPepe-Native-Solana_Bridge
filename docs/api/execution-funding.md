# Public execution funding API

> **Not the production policy.** Production funds Solana execution from the Bridge operational reserve and does not accept user execution payments. The user-funded model described here is disabled on Mainnet and its routes answer `404`. See [User access](../user-access.md) and the [Bridge API](bridge-api.md).

The official interface is [kingpepe.net/bridge](https://kingpepe.net/bridge). These routes describe the public gateway, not a signing or administrative API. Clients cannot choose another Mint or execution-payment recipient. No wallet signing authority is sent to the Bridge. The KPEPE Bridge fee is **0 KPEPE**; Solana execution costs are separate and user-funded for new operations after cutover.

## Availability and operation binding

`GET /api/v1/bridge/status` reports network identities, confirmation requirements, `bridgeFeeAtomic`, `depositAmountModel`, availability and, when supported by the active runtime, `executionPolicy` and `executionFundingReady`. Require current readiness; missing policy fields do not prove `USER_FUNDED`. Documentation and build success do not activate a policy.

`POST /api/v1/bridge/operations` accepts exactly `destination`, `clientNonce` and `walletChain`. Mainnet uses `solana:mainnet`. The destination is the connected Phantom public address; the client nonce is a nonzero 32-byte lowercase hexadecimal value. Keep the same request for recovery rather than creating a replacement operation. The server derives the operation ID and preserves the destination binding. Public writes require the site's approved Origin and remain subject to validation and rate limits.

A new user-funded response initially has `state: AWAITING_EXECUTION_FUNDING`, `depositAddress: null` and `executionFunding.policy: USER_FUNDED`. It contains a dynamic quote, not permission to send Native KPEPE. Only independently verified finalized funding can unlock address issuance. Never derive or expose an address in place of the runtime's null result.

## Quote and finalized payment

`POST /api/v1/bridge/operations/{operationId}/execution-quote` accepts an empty JSON object. Refresh before wallet approval when a quote expires. A quote binds its operation, bound wallet, server-selected recipient, amount and current validity conditions. Its breakdown separates account rent, transaction fees, bounded retry allowance, refund allowance and the wallet payment fee. Amounts in `*Lamports` fields are decimal integer strings; one SOL is 1,000,000,000 lamports. There is no fixed SOL or USD price.

After explicit Phantom approval, `POST /api/v1/bridge/operations/{operationId}/execution-payment` accepts only `{ "signature": "<finalized-payment-signature>" }`. This is a request to verify the payment; a client signature or wallet success callback is not proof of funding. The server independently checks the finalized transaction, source wallet, destination, exact quoted amount and operation binding. A payment cannot unlock another operation. Repeated verification of one payment does not add credit twice. Rejected or failed wallet payments leave the operation unpaid.

`GET /api/v1/bridge/operations/{operationId}` returns the authoritative operation and public funding state. Poll this existing operation after timeouts rather than paying again blindly. Only display a usable Native deposit address when the runtime returns it after funding verification. The address and destination remain fixed afterward.

## Funding states and reconciliation

| Public funding state | Meaning |
| --- | --- |
| `AWAITING_EXECUTION_FUNDING` | A new operation still needs finalized funding; no address is issued. |
| `EXECUTION_FUNDING_VERIFYING` | Funding or reconciliation is being checked; do not infer readiness. |
| `PAID_VERIFIED` | Finalized payment is credited; normal operation gates still apply. |
| `ADDITIONAL_SOL_REQUIRED` | A pre-burn requote found a shortfall for this operation. |
| `REFUND_PENDING` | Refund processing is unresolved; a new refund must not be inferred. |
| `REFUNDED` | A finalized refund is recorded; inspect its signature and amount. |
| `LEGACY_FUNDING_REVIEW_REQUIRED` | A pre-cutover unburned operation is held for explicit review, not automatically charged under the new policy. |
| `OPERATOR_FUNDED` | A legacy operation retains its existing funding treatment. |

Before burn, the runtime reports `additionalSolRequiredLamports`, `requiredCompletionLamports` and `preBurnFundingVerified`. The UI shows **Pay Remaining SOL & Continue** only for the bound wallet and same operation. Repeated shortfall checks do not authorize duplicate payments. An individual unpaid operation does not require a global pause.

Once burn signing may have begun, `burnCommitted` protects completion funding. There is no normal post-burn top-up, expiry or pre-completion refund. An exceptional shortfall requires operational resolution without borrowing another operation's funds or changing KPEPE accounting. There is no global Team-funded completion backstop; Team reserve required is **0 SOL**.

`fundedLamports`, `actualCostLamports`, `refundedLamports`, `remainderLamports`, `deficitLamports`, `paymentSignatures` and `refundSignatures` describe SOL accounting separately from Native deposits and Solana KPEPE mints. A remainder is not automatically withdrawable or already refunded. Eligible unused allowance returns to the bound wallet after completion, less its disclosed refund transaction cost. Pre-burn funding with no Native deposit becomes eligible for expiry after 24 hours, subject to verified deposit absence and no pending execution. Dust no larger than the refund cost remains a recorded liability. Spent rent is not refunded through this flow.

Legacy operation identities and destinations remain unchanged. Mandatory prepayment applies only to new operations created after activation. The Bridge Program, Transceiver, official Mint, EXACT_RECEIVED, 12-confirmation rules and deposit/burn/mint equality are unchanged.
