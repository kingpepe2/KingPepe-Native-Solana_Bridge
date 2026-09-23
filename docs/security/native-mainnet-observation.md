# Native Mainnet observation preparation

Retained read-only Mainnet helpers verify genesis, headers/work, transaction membership and explicit transaction block hints. The maintained node's earlier audit required explicit block-hash lookup for confirmed transactions; a TXID-only lookup was insufficient. Current unit tests reject missing/substituted hints and changed chain tips. Historical node observations are not current burn-runtime admission.

The new burn runtime is REGTEST-only. Before a future Mainnet implementation, preserve source-derived identity, twelve-confirmation deposit and burn policy, explicit retained block locations for spent inputs and finalized burns, exact raw transaction/witness checks, bounded scans and restart recovery. Do not relabel REGTEST evidence or reserve journal records. No Mainnet burn is permitted by this preparation document.
