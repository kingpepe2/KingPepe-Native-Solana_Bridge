# Automatic Bridge processing

Implements the deposit, confirmation, burn, burn-finality, mint and completion lifecycle. Finality, EXACT_RECEIVED, 12 Native confirmations, immutable destinations, replay checks and matching accounting remain required. Live runtime checks determine public availability.

Production funds Solana execution from the Bridge reserve. The reserve needed for an operation is held for it before the irreversible Native burn and released at completion. One operation executes at a time, and the minimum is **1,000 KPEPE** in one transfer. The KPEPE Bridge fee is **0 KPEPE**. The user-funded model is retained in source and disabled; see [public funding behavior](../../docs/api/execution-funding.md) and the [Bridge API](../../docs/api/bridge-api.md).
