# KingPepe monetary ceiling and represented supply

The Bridge monetary ceiling is **21,000,000 KPEPE**, or
**2,100,000,000,000,000 base units** at eight decimals on both chains.
This is a ceiling, not an available mint allocation. Every mint also requires
unique, finalized eligible Native backing and the existing exact claim binding.

Native source confirmation uses KingPepe's own consensus code at
`3f2621820ffefae59cbe48b350f5f8f6ec8a6da5`:

- [Base units and consensus amount bound](https://github.com/kingpepe2/king-pepe-source-code/blob/3f2621820ffefae59cbe48b350f5f8f6ec8a6da5/src/consensus/amount.h#L15): `COIN = 100000000`, `MAX_MONEY = 21000000 * COIN`.
- [Mainnet parameters](https://github.com/kingpepe2/king-pepe-source-code/blob/3f2621820ffefae59cbe48b350f5f8f6ec8a6da5/src/kernel/chainparams.cpp#L85): 210,000-block halving interval and a 3-KPEPE genesis subsidy.
- [KingPepe emission](https://github.com/kingpepe2/king-pepe-source-code/blob/3f2621820ffefae59cbe48b350f5f8f6ec8a6da5/src/validation.cpp#L1843): height 1 has the 19,740,000-KPEPE premine; other initial rewards are 3 KPEPE, right-shifted by the halving count, with zero after 64 halvings.
- [Coinbase enforcement](https://github.com/kingpepe2/king-pepe-source-code/blob/3f2621820ffefae59cbe48b350f5f8f6ec8a6da5/src/validation.cpp#L2613): coinbase output cannot exceed subsidy plus actual transaction fees.

The integer emission sum, including the genesis subsidy and replacing the
ordinary height-1 reward with the premine, is below 21M. Unspendable genesis
outputs, integer halvings and underclaimed rewards cannot increase that sum.
The conclusion does not rely on the inherited comment around `MAX_MONEY` or
on Bitcoin's reward schedule. Transaction fees redistribute existing value.

The Solana Manager uses checked arithmetic on the actual SPL Mint supply and
its cumulative issuance counter before mint CPI. Both are capped. Ordinary
holder burns do not reopen cumulative issuance allowance. Replay markers for
the Native outpoint and canonical operation remain independent protections.
The on-chain program verifies the bound attestation/receipt; Native reserve
evidence is verified by the existing protected Native/attestation services.
The program does not independently query or verify a Native RPC balance.

Canonical reconciliation verifies `reserve = pendingCredits + cumulativeIssued`,
the independently observed reserve, the Manager counter, and
`liveMintSupply <= cumulativeIssued <= 21M`. The backing check remains stronger
than the monetary ceiling. A confirmed violation records a critical incident
and enters the existing safe paused/stopped state; the public counter cannot
clear it or authorize any mint.

The public counter reports cumulative **completed, reconciled forward issuance**.
Pending and not-yet-completed operations are excluded. Ordinary token-holder
burns reduce live Mint supply but do not undo an already completed deposit;
that difference remains explicit in reconciliation. A bounded fresh snapshot
binds the counter to the exact network and Mint. Missing/stale evidence means
unavailable, never a fabricated zero. TEST figures are labelled REGTEST/DEVNET.

`UNBOUNDED_BY_TEAM_DECISION` means no arbitrary per-transfer or time-window
production quota. It does not override monetary supply, backing, finality,
replay, pause or reconciliation checks. Mainnet remains inactive until its
separate readiness, funding and Team activation boundary pass.
