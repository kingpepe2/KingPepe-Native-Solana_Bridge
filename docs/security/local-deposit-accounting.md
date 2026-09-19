# One-way reserve and issuance accounting

All quantities are exact integer atomic units. Define R as eligible canonical
Native reserve, P as authorized but not yet minted forward credits, I as
cumulative authorized bridge issuance, A as independently observed eligible
reserve, M as the on-chain Bridge cumulative minted counter, and S as the actual
configured SPL Mint supply.

The implementation requires:

```
R = P + I
A = R
M = I
0 <= S <= M
coverage requirement = S + P <= R
direct-burn difference = M - S
```

Only a verified finalized Native reserve sweep creates a credit. Credit and
allocation identities prevent a deposit/output being counted twice. Claim PDA
replay protection and the persistent Solana outbox prevent repeated issuance.
Completion follows finalized chain evidence and MATCH reconciliation.

Direct SPL token burns can reduce S without reducing I. Their difference grants
no reserve-release entitlement and is not available for new minting. Pending
credits are explicit and deterministic. A mint that landed between catch-up and
a bank read may explain a bounded temporary observation; processing waits for
its exact receipt instead of repairing counters or minting again.

Forward sweep transactions preserve the full deposit amount as backing. Separate
operator fee inputs pay Native miner fees; the current single-output sweep spends
their exact approved sum. Production must obtain a node estimate, use actual
signed weight, enforce relay floor and measured fee caps, and verify exact fee
inputs before broadcast. Fee funding cannot spend any already credited reserve
or registered service sweep output. The service fee remains zero.

The authenticated journal uses `KPDECL02`. Credit messages are exactly 482 bytes.
It persists forward watches, operation states, signed sweeps, Solana packets,
accounting, economic policy and pauses. Previous journal formats are rejected;
conversion never silently imports their records. Pause and integrity stops
survive restart. No second ledger or automatic balancing transaction is created.

Before new signing or sending, the service catches up and reconciles actual
Native reserve, current Solana deployment and counters. A proven contradictory
spend or mismatch records a stop and blocks new economic processing. Unavailable
RPC evidence waits; it is not proof of a deficit. Resume requires resolved state
and explicit operator review. Production mint limits are unbounded by Team
decision; these accounting checks and the mismatch breaker remain mandatory.
