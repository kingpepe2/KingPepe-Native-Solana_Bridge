# Burn/mint accounting

Reconciles finalized Native burns, pending mint obligations and completed Solana issuance. Cumulative issuance cannot exceed verified burns or 21,000,000 KPEPE. Pending work is not reported as completed.

SOL execution funding, actual costs and eligible refunds are reconciled separately for each operation. This accounting never reduces KPEPE deposits, burns or mints and cannot transfer another user's reserved funding. The KPEPE Bridge fee remains 0 KPEPE.
