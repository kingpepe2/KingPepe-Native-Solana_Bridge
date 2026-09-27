# Verified burn before mint

A Native deposit authorizes bridging to its originally bound Solana destination. Deposit observation alone is not permission to mint. For new user-funded operations, finalized operation-specific SOL funding precedes Native address issuance. After 12 deposit confirmations, the remaining SOL requirement is recalculated; only sufficient funding allows the exact Native burn. Only verified Native burn finality can make that amount eligible for the corresponding Solana mint.

The KPEPE Bridge fee remains 0 KPEPE. SOL costs and refunds are separate accounting. Once burn signing may have begun, the operation's reserved completion funds cannot expire or be refunded before completion; no normal post-burn top-up is required. A funding shortfall in one operation does not authorize use of another operation's funds.

The operation's identity, destination and exact amount remain bound throughout the lifecycle. Duplicate observation or submission cannot create another economic burn or mint. Completion requires confirmed execution and matching accounting. Missing evidence is not treated as successful verification.

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.
