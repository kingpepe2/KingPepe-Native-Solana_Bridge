# Verified burn before mint

A Native deposit authorizes bridging to its originally bound Solana destination. Deposit observation alone is not permission to mint. After 12 deposit confirmations, the protected Bridge operational SOL reserve is checked against current fees, rent and completion headroom; only sufficient verified reserve allows the exact Native burn. Only verified Native burn finality can make that amount eligible for the corresponding Solana mint.

The KPEPE Bridge fee remains 0 KPEPE. Solana execution costs are paid by the Bridge reserve and do not change KPEPE deposit/burn/mint accounting.

The operation's identity, destination and exact amount remain bound throughout the lifecycle. Duplicate observation or submission cannot create another economic burn or mint. Completion requires confirmed execution and matching accounting. Missing evidence is not treated as successful verification.

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.
