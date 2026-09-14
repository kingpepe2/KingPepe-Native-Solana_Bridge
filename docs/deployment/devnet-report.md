# DEVNET REPORT

Status: Phase 17 scoped PASS; Phase 18 final report publication requires its own
exact-SHA CI. `productionReady = false`; `mainnetActivation = DISABLED`.
This is the single consolidated public Devnet report. It contains no private
runtime configuration, keys, endpoints or recovery contents.

## Source and evidence identity

| Evidence | Exact source SHA | Exact-SHA CI |
| --- | --- | --- |
| Phase 17 reviewed publication baseline | `424089ec1e344d2732ed58160b33fd18a24f71f1` | [34841406825](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34841406825), 4/4 PASS, no skipped jobs/steps |
| Phase 17 tested runtime | `e54a53160b09809d838b6388c67844186e70db02` | [34837775528](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34837775528), 4/4 PASS |
| Deployed Devnet programs | `5ad33201402813503d31b6d97c2e3e6fdb7908c1` | [34745104679](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34745104679), 4/4 PASS |

This report's source identity is its containing Git commit; its publication
requires a matching exact-SHA CI run, not an inherited result. Documentation-only
additions do not change the deployed program source or retrospectively certify
a different runtime. Detailed source-bound results and artifact hashes remain
in [BRIDGE-READINESS.json](../../BRIDGE-READINESS.json). No private runtime or
recovery material is required for this public report.

## Devnet deployment

These are **test-only public identities**, not production configuration. The
verified Solana Devnet genesis is
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Native testing used KingPepe
regtest, not the live Native monetary network.

| Role | Public address |
| --- | --- |
| Bridge / Manager | `JB8cngNshwyUzsxz3HiiVvY5CrHQsfUxo3dcfzQsemBJ` |
| Transceiver | `EFkUHysqyqyPJdqEJbiWj8e4cHVe6Wde1qTDr3aaQ4YM` |
| KPEPE Mint | `5mhfBnB4u5w8V9Fu1gT7U57prZf5Und6z5n2rrNAC9S` |
| Bridge PDA mint authority | `Gny9RALjiAUcQWtApqSqCbf68Tv6FVycXcscmsiHDuy9` |
| Bridge configuration PDA | `3YsiEkchuQkfKZoe4daFXbC8LwPkWsCmD6zRcCZF9cSE` |
| Transceiver configuration PDA | `6V3Rks1Aca7JgFRpK7MSUmcFTJurAPCpTaTGBHcEZDRr` |
| Test upgrade authority | `E7mox7hc7LdSvCu6PH8sf7U7mJQBnEjA7z3xYiwh2m2k` |

Initial KPEPE supply was verified **0**, decimals **8**, standard SPL Token
Program, Bridge PDA mint authority, and freeze authority **None**. Enrollment
verification at `2026-09-13T15:27:18.840Z` / finalized slot `497778617` checked
program identities, authorities, config PDAs, Borsh config and bytecode. Later
zero supply after test burns is a separate accounting result, not evidence of
initial zero supply. No programs, Mint or authority were redeployed in Phase 18.

The canonical deployment record, including ProgramData addresses and pinned
build options, is [devnet.json](devnet.json). Deployment transactions:

- Manager deployment: `5XX2s87ECWq1mwzqC2a84w21WSpjqZtCYM4vj7GqNDURsNCdDDye1bSBqXvRPa1WQH4zbVmvun5h9ye9s7ZWCirY`.
- Transceiver deployment: `3xx4LkAxJjQPUwjrD1iZ6uAfNZTt44m5yiDBdd5woWYWVn7u1tpfAvfL2Tvuiv2DiuCuuXHJP667GQFCweWRi6qi`.
- Mint/configuration: `vThEqLS3yfsrgTxei7wTmTQqxy4Nw5yj4a2PB42fc4naAj2KoEw2MJ3f7gETtUNxKJf1EJvahA4KsHwJ7pxGkDV`.

Deployed-byte and independent pinned `--arch v3` build verification passed:

| Program | Bytes | SHA-256 |
| --- | ---: | --- |
| Manager | 225488 | `994593c2e160e28a06e396e34c47ad9f93472ac79e711e2dcd0ea6798d3f0ff0` |
| Transceiver | 222664 | `d2369ded502ebd24540146f388271dd0fcdc6c978e1ffedbd9599b830fdf8186` |

## Canonical Borsh and real bridge operations

Canonical bridge Borsh V2 uses `KPEPBRG2`, a 514-byte fixed canonical message,
explicit integer widths, little-endian encoding, strict bounds and deterministic
padding. Operation IDs hash the Borsh `KPEPID02` inputs. Attesters sign the full
canonical message bytes. See the [protocol specification](../architecture/protocol-messages.md),
`solana/modules/bridge-messages/vectors/` and `native/proof/vectors/` for schemas,
ABI/input vectors and their Rust/TypeScript implementations.
Rust/TypeScript canonical vectors PASS (53 shared vectors plus retained Native
packet vectors). Live finalized claim, receipt and withdrawal messages were
decoded, reconstructed and compared byte-for-byte and digest-for-digest:
`LIVE_BORSH_MATCH = PASS`. This is not merely a local-vector claim.

Two **new** Native -> Solana Devnet operations and two **new** Solana Devnet ->
Native operations completed during the Phase 17 traffic/recovery observations.
Together with the retained Phase 16 round trip, three completed operations in
each direction were known. Restarts and rediscovery were not counted as new
transfers. No per-transfer Team approval was used.

Representative second-round-trip public evidence:

| Item | ID / digest |
| --- | --- |
| Deposit operation | `c891acc732a51b340b89d25d3f7ef61d7fd0a1654ed1c3ed89c78c5d72b89524` |
| Finalized claim | `24C2cMGT6YXFFJqzs4xA92YzkyL9fiKxb3FZWGPFQKL27JksDVEPnKTGvM87sd8WxQ5zswQzCAGYZGfwYpdh7j5D` |
| Claim message SHA-256 | `cf041e938341b97ac8e605a23164b843f2d1e90d020d02ce30c283842a532ef9` |
| Withdrawal operation | `4d5882c1fe1f80b3e8b8b03b55186f683cd81d8ca9002abbd40259ba4f699c20` |
| Finalized burn / withdrawal | `5QyshBVZiox4KaEW2phk453atk1fRuTa23d3hL3VtoapzZ5hdvX6HfTZotA758y3Gh4SrgAzARYjvF4tNNdMgw4k` |
| Native payout | `738d51041f6b108cd7ae72413ba920b96ec6aac00bca940c3f6a6a86bfd5b3f0` |
| Withdrawal message SHA-256 | `570a3d7acd545bc77173d8e28eb6cb132785e867a6bb97a7de92b88b412318b0` |

Each new round trip used 100000000 atomic units; each withdrawal paid 99999000
with 1000 Native fee units. Final observed reserve and Solana supply were both
0, pending liabilities were 0, and reconciliation was MATCH. Across all three
known withdrawals, finalized gross payout accounting was 300000000 with fees
3000. Accounting uses integers, not floating point.

Solana finality was observed on the real public test cluster: representative
withdrawals finalized in 11.701 seconds (Phase 16) and 11.944 seconds (Phase 17).
The latter deliberately lost the accepted submission response and completed
after checking the original signature, with one submission attempt. Native
confirmation timing was controlled by mining regtest blocks; this does not
certify real public Native confirmation latency or force a public Solana stall.

## Monitored duration and practical edge results

The final Team requirement was `soakDuration = 5 monitored hours`. Credited
duration was **5h38m00s (20,280 seconds)**. This was **NOT a long-term soak**, an
uninterrupted calendar window or a sustained-load test.

- Preserved MATCH interval: `2026-09-13T20:09:43.201Z` through
  `2026-09-14T01:11:55.849Z`, 18,132 seconds. It monitored completed operations;
  no new traffic was generated in that interval.
- Post-compaction traffic/recovery intervals: 2,148 seconds between
  `2026-09-14T10:01:00.581Z` and the published MATCH cutoff at
  `2026-09-14T11:15:47.113Z`. New round trips occurred in these intervals.
- All gaps, disk-guard downtime, manual restore time, six earlier WAIT samples
  and the unobserved tail were excluded. The exact intervals, end reasons and
  retained artifact hashes are in `phase17.monitoredTimeAudit` in readiness.
  Requested future runtime was not credited.

| Check | Observed result and scope |
| --- | --- |
| Restarts / lost responses | Pending sweep and payout resumed from protected journal/state and actual chain results; completed operations were rediscovered without repeat signing or submission. |
| RPC outage / reconnect | Controlled outage and real reconnect passed; missing facts waited rather than authorized payment. |
| Replay / duplicate claim | Fresh-signed replay attempts rejected on finalized Devnet with no token CPI or economic account changes; funded user account prevented insufficient balance from masking the test. |
| Double mint / payout | No duplicate economic action across retries, restarts or isolated restores. |
| Native reorg | Two unaccepted pre-finality regtest blocks removed: WAIT, no signing/mint, accepted base unchanged, then normal completion. No post-mint automatic reversal was tested or implemented. |
| Conflicting spend | Mature test-wallet-signed spend of the already-swept input rejected by Native mempool acceptance and broadcast. |
| Pause / reviewed resume | Paused read-only observation and explicit reviewed resume passed. |
| Reconciliation / queues | MATCH; no pending operations at completion. No confirmed accounting contradiction or unexpected economic repair. |

Retained samples covered process memory, logs, journal/queues and host free
space. Historical memory ranged approximately 166-266 MB; resumed samples were
approximately 266-304 MB, journal size 184320 bytes and pending queue empty.
These bounded samples do not establish long-term leak freedom. Storage-guard
diagnostics and disk samples were retained; the guard was not lowered.

## Encrypted recovery drill

`recoveryProcedure = TESTED` for the scoped
[manual recovery runbook](../security/deposit-operation-recovery.md). Two
closed-writer snapshots used Windows CurrentUser DPAPI encryption. Protected
state/config inventories and ciphertext rejection were checked; no plaintext
archive or secret backup content is published.

| Restore | Files | Archive verify / extract | Controlled stop to completed operation |
| --- | ---: | ---: | --- |
| Pending sweep | 164 | 5746 ms | `10:10:33.911Z` -> `10:29:18.260Z`, approximately 18m44s on 2026-09-14 |
| Pending payout | 183 | 3920 ms | `10:33:23.524Z` -> `10:37:05.870Z`, approximately 3m42s on 2026-09-14 |

Manual steps included stopping writers, verifying the encrypted inventory,
isolated same-account restore, supported re-protection of path-bound envelopes
with identical payload/revisions/nonce state, matching private temporary-root
configuration, reconnecting both chains and reviewing the quiescent gap.
Chain queries recognized accepted broadcasts; pending operations completed
without new signing or rebroadcast of their saved Native transactions.
Completed operations were not repeated; reconciliation returned MATCH.

Path binding and private runtime configuration were real recovery requirements,
not reasons to reset counters or regenerate shares. `replacementHostRecovery =
NOT_CERTIFIED`: the drill does not certify another Windows account/host, cold
custody, arbitrary stale snapshots, production backup configuration or full-host
rollback resistance. Archive extraction time is not total recovery time.

## Incidents, fixes and limits

The initial observation stopped at the existing disk guard. Its failing free-space
sample was not retained, so the exact triggering sample is unknown; a focused
diagnostic fix now retains it without lowering the guard. Downtime was excluded.
An invalid pause-test label and two test-driver adapter/CLI-null handling errors
were corrected using existing APIs; protected journal validation was not weakened.
Affected tests and matching CI passed. No economic operation was repeated.

The evidence-publication WSL focused run initially had two child-startup timeouts
during a concurrent full-tree scan. The identical sequential run passed 14/14
with unchanged timeouts; contention is suspected, not a profiled root cause.
The Phase 16 expired user packet was replaced only after live absence/expiry
checks, preserving the Borsh operation ID; the original drop cause is unknown.
Retained readiness records preserve these qualifications and relevant source/CI.

`signerTopology = SINGLE_HOST`: A/B have separate processes, protected shares and
nonce state, exact 2-of-2, no fallback and no coordinator share. Common-host
compromise/outage can affect both; the Team explicitly accepts that risk. Noble
FROST remains unaudited; removing the external-review gate does not resolve that
limitation. CurrentUser checks do not certify distinct Windows service principals.
Full-host/snapshot rollback
is not guaranteed. Project attesters and configured RPC sources remain trust
dependencies. Bincode remains required for non-bridge Solana SDK serialization;
the unmaintained-dependency advisory remains visible, not waived by Borsh migration.

## Production authority and Team review decision

The final Team decision is `upgradeAuthorityModel = SINGLE_KEY_WITH_REVIEW_CONTROL`,
`upgradeReviewWindow = NONE`, `fixedTimelock = false`. The
[upgrade procedure](../security/program-upgrades.md) requires reviewed source,
diff/build/hash verification, tests, exact-SHA CI, secret scan, live target and
authority verification, and Team approval of each specific production upgrade.
There is **no enforced time delay**. Critical incidents may expedite this process
but do not waive its required checks/approval. The dedicated authority remains
a centralized trust point; no decentralization or on-chain enforcement is claimed.
This policy adds no delay or approval to normal bridge transfers.

The final KingPepe Team decision removes mandatory independent external review,
the review-package gate and external-audit Critical/High clearance as roadmap
requirements. Record `externalSecurityReview = NOT_REQUIRED_BY_TEAM` and
`externalSecurityAuditCompleted = false`. No independent security audit is claimed;
Codex preparation/self-review and green CI are not one. External findings have
not been assessed and must not be reported as zero.

After this report's required scans, provenance, reviewed publication and exact-SHA
CI pass, proceed to Phase 19 without waiting for an auditor. Retain both local
and Devnet E2E, Borsh, soak, recovery, reserve/accounting, replay/double-action,
restart, reconciliation, secret-scan and exact-SHA CI gates. SINGLE_HOST risk
must remain documented and production upgrade-authority configuration must be
verified. No unresolved known blocker making activation unsafe may be ignored.
The [production checklist](../../config/examples/production-readiness.example.json)
is unconfigured planning material, not operational configuration or proof of
readiness. No production keys, deployment or activation are certified here.
All retained gates must pass before requesting explicit
`KINGPEPE_TEAM_ACTIVATION_APPROVAL`; do not deploy before it.
