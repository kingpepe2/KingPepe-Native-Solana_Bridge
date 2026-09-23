# One-way Solana programs

`kingpepe-transceiver` verifies canonical V4 finalized-burn bytes and two distinct configured Ed25519 attestations. `kingpepe-bridge` consumes that verification, checks the bound wallet and exact Mint/Program/PDA/account owners, and performs exact MintToChecked. It has no reverse redemption instruction.

The Bridge retains separate operation, deposit and burn replay markers. The deposit marker records consumption, not reserve backing. Native burn outpoint and operation cannot authorize a second mint. Checked cumulative issuance is bounded by 21M; current SPL supply must not exceed that counter. Direct SPL holder burns never reopen the counter.

The standard SPL Token Program is sufficient: no Token-2022 extension is required. Fresh enrollment requires eight decimals, zero supply, Bridge PDA mint authority and no freeze authority. Production enrollment remains prohibited in this task. Both existing public reserve-model TEST artifacts and new burn TEST artifacts must be labelled accurately and isolated.

Program upgrades remain subject to [the Team's specific review/approval procedure](../security/program-upgrades.md). Code, source SHA and pinned v3 artifact hashes must match actual deployed bytes before economic admission.
