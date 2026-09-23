# Monetary ceiling and burn/mint conservation

Authoritative KingPepe Native commit: `3f2621820ffefae59cbe48b350f5f8f6ec8a6da5` (31.1.0). `src/consensus/amount.h` defines COIN=100000000 and MAX_MONEY=21000000*COIN. `src/validation.cpp::GetBlockSubsidy` defines the height-one 19,740,000 KPEPE allocation, then the Native emission and halving schedule; `src/kernel/chainparams.cpp` sets the Mainnet 210,000-block interval. These are the KingPepe implementation's rules, not inferred Bitcoin defaults.

Native and Solana decimals are 8. The canonical maximum is 2100000000000000 base units, computed and enforced with checked integers. The ceiling is not a mint allocation.

For the active burn architecture define F=independently verified finalized Native burn total, P=finalized burns not yet minted, I=completed/finalized Bridge mint total, and S=live official SPL Mint supply. The journal reconciles `F = P + I`, `0 <= S <= I <= F`, and `I <= 2100000000000000`. All planned/committed burns also reserve cap capacity before irreversible action. A holder's ordinary SPL burn explains `I-S` and cannot reopen cumulative issuance capacity. Each completed operation requires deposit=burn=mint exactly.

`services/bridge-validator/burn-journal-state.mjs` records these quantities. Runtime independently revalidates Native burns and finalized Solana execution/account state; no browser value grants credit. Missing observations hold processing; contradictions persist a critical pause. The public numerator is canonical completed burn/mint accounting, checked against cumulative issuance and exact Mint supply. Pending burns do not increase the counter.

No permanent spendable reserve remains after successful burning. Temporary pre-burn custody and operational fee coins are separate. Native fees equal operational inputs minus operational change; user deposit value goes entirely to the burn output. Reconciliation never counts operational fee funds as mint authority.

UNBOUNDED_BY_TEAM_DECISION removes arbitrary product transfer/window caps, not monetary, conservation, replay, finality, identity or pause controls.
