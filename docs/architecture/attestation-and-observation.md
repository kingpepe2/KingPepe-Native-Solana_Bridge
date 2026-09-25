# Verified burn before mint

A Native deposit authorizes bridging to its originally bound Solana destination. Deposit observation alone is not permission to mint. After 12 deposit confirmations, automatic processing burns the exact amount. Only verified Native burn finality can make that amount eligible for the corresponding Solana mint.

The operation's identity, destination and exact amount remain bound throughout the lifecycle. Duplicate observation or submission cannot create another economic burn or mint. Completion requires confirmed execution and matching accounting. Missing evidence is not treated as successful verification.

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.
