# Automatic Bridge processing

Implements the deposit, confirmation, burn, burn-finality, mint and completion lifecycle. Finality, EXACT_RECEIVED, 12 Native confirmations, immutable destinations, replay checks and matching accounting remain required. Live runtime checks determine public availability.

New operations after the user-funded cutover require finalized SOL execution funding before address issuance and a fresh funding check before burn. Shortfalls require that operation's bound wallet to top up. No global Team completion reserve is required. Once burn is committed, funds stay reserved through completion. Eligible unused SOL is refunded; another operation's funding cannot be spent. Legacy operations are preserved and are not automatically converted. The KPEPE Bridge fee remains **0 KPEPE**. See [public funding behavior](../../docs/api/execution-funding.md).
