# Burn-and-mint TEST validation

Recorded 2026-09-24 (Asia/Dubai). Runtime source `adcca2ba412ed45266041d73b16207f665a55c34` passed [CI 35931741887](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/35931741887): all four required jobs and every step, none skipped. This report is an evidence-only publication; its own commit requires matching CI. Mainnet is not deployed or activated.

[Verified TEST programs, Mint, PDAs, hashes and transactions](burn-devnet.json) are separate from the historical reserve deployment. The new programs were built/deployed from `8aa17e827fc2bf70cbef028e39674c0003ae62f7`; the later runtime correction changed no program bytes. The old Mint and journal are never imported into burn accounting.

| Check | Current evidence |
| --- | --- |
| Authoritative Native source | KingPepe 31.1.0, `3f2621820ffefae59cbe48b350f5f8f6ec8a6da5`; OP_RETURN, nonzero burn ceiling, standardness and UTXO exclusion independently checked |
| Actual isolated Native proof | Nonzero burn mined; attempted overage/spend rejected; 11 confirmations and pre-finality reorg ineligible; 12 eligible; restart/full reindex preserved evidence |
| Required local tests | 182 retained Node tests, canonical vectors, Windows DPAPI tests, locked Rust check/test/fmt/Clippy and pinned SBF builds; exact-source CI passed |
| Actual Windows runtime regression | 17 checks passed, including lost Native/Solana responses, finalized-read race, real process crash after burn, automatic service, late/multiple deposits, retained pause and counter refresh |
| Fresh real REGTEST -> DEVNET | Operation `67fac0d5f7cdf5adad97b79f39aa822a76429453998196d2bd6875da223da791` COMPLETED |
| Conservation | Deposit = finalized burn = mint = 100,000 base units (0.001 TEST KPEPE); separate operational input paid 235 Native base units |
| Actual process crash | Process exited after finalized burn was persisted and before mint; new process recovered that burn and minted once to the original destination |
| Supply delta | Fresh operation changed verified Mint supply from 100,000 to 200,000 base units; no additional mint on repeated processing |
| Borsh | Actual 563 signed bytes round-trip identically through TypeScript and Rust; both signatures and finalized on-chain receipt/claim digest match |
| Reconciliation / private counter | MATCH; completed burn/mint accounting 200,000 base units (0.002 TEST KPEPE), remaining 20,999,999.998 KPEPE, displayed percentage <0.01% |
| Encrypted restore | Eight TEST protected stores restored from an AES-256 encrypted snapshot under the same Windows account; identities/journal unchanged, MATCH, no extra burn or mint |
| Reviewed Explorer gateway | Real loopback integration passed status/counter, Native/Solana balances and idempotent resume of the same completed operation; reverse/sign/RPC routes returned 404; no new economic operation |
| Public cutover | BLOCKED: Windows UAC request cancelled/rejected; new Explorer TEST files/private gateway not applied |
| Browser / Phantom | No connected browser; desktop/mobile visual checks unverified; manual Phantom acceptance PENDING_MANUAL |

The first Devnet operation minted once but paused before journal completion. A claim finalized between its earlier claim RPC read and a later issuance RPC read, causing a false reconciliation mismatch. The correction re-reads journaled claims at or after the newer finalized slot before comparing issuance. An isolated real-chain regression reproduced the race. After reviewed source and exact-SHA CI passed, read-only recovery completed the original operation without another deposit, burn or mint. Its original failure record is preserved. Stable unexplained issuance, insufficient finalized burns and other critical mismatches still pause processing.

Measured fresh-operation time from observed deposit finality to burn broadcast was 13,701 ms, including the next normal runtime cycle and security checks. The first operation took 29,977 ms including preparation/finality of its destination token account. Neither required manual approval after deposit.

The restore result certifies a closed, same-account TEST snapshot only. Dedicated Windows service-principal separation, replacement-identity DPAPI recovery, an offline media copy and production recovery remain unproven. The current TEST Explorer and Bridge run under the existing account; directory ACLs cannot isolate processes sharing that identity. Production requires the documented separate service identity and protected recovery procedure.

The public site still uses the retained historical TEST implementation until reviewed cutover. The old reserve/FROST service must then be retired gracefully without deleting its private evidence, wallet or journal. Source removal alone does not prove retirement of that running process. A current public baseline returned HTTP 200 for Home/Bridge and 404 for retired reverse routes; public responses/assets passed the redacted secret scan. This is not burn-UI deployment or browser-rendering evidence.

Mainnet remains disabled. Its new burn admission/signing/fee-wallet/journal bindings, dedicated identity, portable offline recovery, operational funding/minimum policy and metadata hosting require further work. A read-only quote for current ELF bytes was 1.775622000 SOL with zero payer balance, including five early operations and retry headroom. Metadata rent is pending the reviewed metadata plan; rent/fees must be requoted before any future deployment. No funding or activation approval is requested.
