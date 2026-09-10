# Phase 08.5 retrospective audit

Date: 2026-09-10. Scope: Phases 01-08 only. This is an internal engineering audit,
not an independent external audit. Phase 09 NOT_STARTED.
productionReady=false; mainnetActivation=DISABLED.

Baseline: `9ea5e198b57f48086a0c7861123a6d79d14e8560`.
Earlier implementation: `0133a6cc7f22bf880249a72a62502aa4bf3a638b`.
The fixes were published at `845f2b22c87a94f79a3b499209260247a5d01acf` and
rerun from a separate clean clone of that SHA. Follow-up checkout/rent-test
changes require their own validation. Exact evidence is in development-status; a commit
cannot contain its own final SHA. Do not attribute historical CI to newer source.

## Verdict

SAFE_TO_BEGIN_PHASE_09 = false. Local component tests are green, but the complete
retrospective gate is BLOCKED by unresolved security dependencies. A passing
single-deposit flow is not full multi-service recovery or production observation.

| Phase | Audit result | Scope / reason |
| --- | --- | --- |
| 01 foundation/legal/guardrails | PASS locally | PRIVATE repository, proprietary original source, complete classifications, retained third-party terms; scans are detection tools, not proof of absence |
| 02 workspace/toolchain | PASS at published 845f2b2 | Exact engines/locks, direct SBF path, separate clean clone/new project builds; LF follow-up fixes cross-platform status noise |
| 03 messages/accounting | PASS for implemented primitives | Canonical vectors, replay and checked arithmetic; fixed early miner-fee surplus; future operation-bound payout journal not implemented |
| 04 FROST | FAIL full audit gate | Real Native-compatible signing passes; protected shares, leases, authenticated state/IPC and full rollback/global restart safety remain incomplete |
| 05 Solana programs | PASS exercised local boundary | Fresh-PDA defect fixed and 26 finalized regressions; SBF/deposit checks pass; not exhaustive account fuzzing or an external audit |
| 06 Native proof/reserve/recovery | PASS exercised REGTEST scope | Raw chain/transaction/sighash checks and real CSV/race tests; canonical choice/UTXO trust remains configured validating-node RPC |
| 07 attestation/observation | FAIL full audit gate | Local attestation/observation tests pass; deployed bytecode/authority watcher and independently configured production source are absent |
| 08 automation | FAIL full audit gate | Fresh automatic deposit completes; full service failure/restart/global fencing and post-mint deep-reorg handling remain unproven |

The conditional CI exception cannot turn failed local security gates into
AUDIT_PASS_LOCALLY_CI_ACCOUNT_BLOCKED. That label is not earned.

## Fixed findings

1. **A85-01 HIGH: fresh withdrawal PDA IllegalOwner.** The handler previously
   demanded an allocated program-owned record that no instruction created.
   It now derives/checks the withdrawal-ID PDA, validates nine accounts and
   Native domain, allocates 283 bytes with correct rent/program ownership,
   supports empty pre-funded System PDAs, rejects initialized records and
   executes BurnChecked plus durable record/counters atomically. No close or
   replay-marker deletion exists. User authority and rent payer sign; normal
   transfers need no Team signature. Supported destination format is P2TR;
   wrong/truncated format and zero-net requests are rejected.
2. **A85-02 HIGH: network-fee allowance appeared as operator surplus after burn.**
   Gross 1000, fee 5 now means 995 unpaid plus 5 reserved fee liability, never
   surplus at burn/broadcast. Finalized payout consumes broadcast net and paid
   fee against reserve simultaneously. Unbroadcast or unreserved settlement
   fails without mutation. This is an aggregate model, not a payout worker.
3. **A85-03 HIGH: observation-model domain/PDA/finality gaps.** The withdrawal
   PDA helper used a JSON hash, not Solana PDA derivation. It now matches the
   program's real record address; Native protocol/network/genesis and exact
   u64 slot/root bounds are checked. Non-localnet observation is blocked even
   with productionObserverConfigured=true. No Phase 09 pipeline was added.
4. **A85-04 HIGH: mutable attester key/policy references and implicit expiry skip.**
   Key bytes are copied/private, policy and identity fixed, public-key access
   returns a copy, close is absorbing, and omitted clocks use current time.
   Adversarial caller-mutation, close and expiry regressions pass. This does not
   establish hostile-code isolation, protected storage or authenticated peers.
5. **A85-05 MEDIUM: unbounded/redirectable Solana observation transport.**
   Local RPC now forbids redirects/path credentials, bounds timeout/body size,
   checks JSON-RPC IDs/envelopes and redacts provider errors. Real HTTP tests
   cover malformed/chunked/oversized/error/redirect/timeout responses.
6. **A85-06 MEDIUM: parser/parameter boundaries.** Native finality rejects zero
   confirmations; difficulty rejects overflowing height/spacing and zero
   retarget timespan without panic. Authoritative consensus values are unchanged.
   Coordinator construction now rejects extra participants as well as missing
   or duplicate required participants. Native signing remains exact A+B.
7. **A85-07 documentation/provenance.** Lockfiles classified GENERATED_FILE;
   exact source/provenance coverage and additional publication guards are CI
   gates. Stale IDL, production-key loading, observer and CI-pause claims were
   corrected. Current NTT main/tree/releases were compared, with no code import.

## Measured local validation and published-source fresh clone

| Check | PASS | FAIL | SKIP | Qualification |
| --- | ---: | ---: | ---: | --- |
| Windows Node | 501 | 0 | 0 | Pinned portable runtime; not Windows Rust/services |
| WSL Node | 501 | 0 | 0 | Ubuntu 24.04 / WSL2 |
| Canonical vectors | 2 per platform | 0 | 0 | Rust and TypeScript binary agreement, not generated IDL |
| WSL Rust | 97 | 0 | 0 | 66 Solana, 31 Native; all five check/fmt/clippy gates |
| SBF programs | 2 | 0 | 0 | Direct Linux/WSL SBF builds; generated keypairs external |
| Existing local flow checks | 55 | 0 | 0 | 22 security, 7 CSV, 4 PSBT, 10 pre-mint races, 7 claim retries, 5 accounting |
| New withdrawal record checks | 26 | 0 | 0 | Finalized validator execution, not mocked/preflight-only failures |

These counts were repeated in the separate 845f2b2 clone, not copied from the
baseline report. Compiled project targets started empty; verified pinned compiler
and dependency downloads were reused. Windows and WSL locked npm installs ran.

Node groups: 159 FROST, 35 Native, 8 attester, 28 observer, 174 pipeline/ledger,
97 scripts/guards/CI contracts. Vectors are separate, not two extra Node tests.
No Windows native Rust/ACL/protected-secret adapter tests ran. IDL generation,
complete fuzz campaign, full service restart, Devnet and external review are NOT_RUN.

Fresh deposit: raw Native transaction -> verified headers/PoW/difficulty/
chainwork/Merkle/UTXO source -> FROST A+B reserve sweep -> Native acceptance/
finality -> separate Ed25519 A+B attestations -> verified receipt -> claim
consumption -> actual SPL mint -> finalized observation -> reconciliation ->
COMPLETED, ALL_REQUIRED_CHECKS_PASSED. Reserve/supply each 100000000 atomic;
pending credit and unexplained surplus zero. Miner fee 1000 comes from explicit
separate test funding, project fee zero. No per-transfer Team approval.

SOLANA_DEPOSIT_CLAIM_PENDING is intermediate only. Existing tests retry identical
completed messages, reject a new nonce against the same backing, restart claim
workers before/after send, wait for actual blockhash expiry and reopen pending/
finalized credit journals without a second mint. The record suite completes its
deposit first, then deliberately leaves unpaid disposable withdrawals; it is
not a reconciled withdrawal payout or Phase 09 E2E.

Failures found during development are not erased: the default 200000-unit
withdrawal budget exhausted; explicit disposable 600000-unit budget was required.
A test used a public-key Base58 decoder for short instruction bytes; corrected
to exact instruction-byte comparison. Freezing attesters exposed four fixture
monkey-patches; fault injection now wraps transport adapters and still invokes
real signing. A signer-set test's existing missing-participant error contract
was retained. Earlier failing runs are not included as passing final checks.

## Security/failure coverage and limits

| Requested case | Actual evidence / remaining limit |
| --- | --- |
| Replay/duplicate claim/backing/double mint | Host and real validator deposit rejection; record ID replay survives new nonce |
| Wrong amount/recipient/fee/change/transaction/sighash | Both signer policy plus raw Native validation; Native node accepted valid FROST |
| Wrong Mint/PDA/program/authority/domain/epoch | 26 finalized record cases; existing deposit domain/backing preflight cases and host tests |
| Partial transaction failure/rent/token shortage | Finalized failed transactions preserve pre-transaction token, Mint, state and record snapshots |
| Recovery maturity/spent UTXO/races/reorg | Actual REGTEST CSV, wallet PSBT and competing pre-mint forks; not post-mint compensation |
| Nonce reuse/signer restart | Volatile nonces, persisted public tombstones, actual SIGKILL child; not cloned-memory/full-snapshot rollback |
| Coordinator restart | Saved DKG handoff/retry tests; instance abort stop is NOT durable global fencing |
| Claim worker restart | Actual process exit before/after validator submission and real expiry; not all services |
| RPC outage/malformed response | HTTP adapter and injected waiting/retry tests; complete running-daemon outage/restart E2E NOT_RUN |
| Corrupt/stale/rollback/disk-full state | Ledger/path/store fault-injection and retained-checkpoint tests; whole-machine rollback/physical disk exhaustion NOT_RUN |
| Queues/limits/hard stop | Scoped state-machine and absorbing journal/callback regressions; full rate-limit service and global stop NOT_IMPLEMENTED |
| Unauthorized upgrades | Supplied identity-policy tests only; actual deployed upgrade -> persistent global stop NOT_RUN |

Test doubles test their stated policy boundaries; they are not counted as real
chain or OS failure evidence. Failure counts of zero above apply only to suites
that actually ran, not to the missing cases.

## Open security dependencies

- **A85-08 HIGH / MUST_FIX_BEFORE_PHASE09:** protect long-term FROST/attester
  keys, authenticate/fence signer state, enforce separate service identities,
  ongoing local leases and confidential authenticated IPC. Current external
  plaintext test JSON and path checks do not enforce those guarantees.
- **A85-09 HIGH / MUST_FIX_BEFORE_PHASE09:** durable bridge-wide integrity stop,
  full coordinator/validator/service restart, broadcast-to-credit persistence
  gap and multi-operation fencing. Existing SQLite/claim worker tests cannot
  prove the whole service lifecycle.
- **A85-10 HIGH / MUST_FIX_BEFORE_PHASE09:** actual program/genesis/ProgramData/
  upgrade-authority observation and stop propagation, rather than supplied
  identity objects. Configuration must not imply this service already exists.
- **A85-11 HIGH / MUST_FIX_BEFORE_PHASE09:** tested post-mint deep-reorg response
  and an explicit rollback/freshness recovery boundary. Co-restoring state and
  its anchor cannot detect rollback. No absolute hidden-clone guarantee is claimed.
- **A85-12 / LATER_PHASE:** full withdrawal payout/relayer, SDK/IDL/CLI/app,
  operational monitoring and complete backup software. No Phase 09 work started.
- **A85-13 / PRODUCTION_BLOCKER:** unaudited upstream FROST, external bridge
  review, production chain observation/configuration, backup/restore assurance,
  verified deployed identities and one-time Team activation authorization.
  No Devnet/Mainnet deployment or production key/service actions were performed.
- **A85-14 / EXTERNAL_BLOCKER:** GitHub Actions account execution. All four jobs
  rejected before steps on audit-source run 34519943346 attempt 1, SHA 845f2b2;
  zero artifacts, tests NOT_RUN. Baseline run 34509774457 attempt 2 was also blocked.
  Exact annotation: "The job was not started because recent account payments
  have failed or your spending limit needs to be increased. Please check the
  'Billing & plans' section in your settings". No account/gate changes authorized.

The Team must restore account execution and direct the remaining Phase 08
security remediation/review. This audit does not choose unpublished production
identities, anti-rollback operational anchors, limits or funded operations.

## Provenance and keyword disposition

Original code remains Copyright (c) 2026 KingPepe Team, All Rights Reserved.
BIP-341 derived public vectors retain their attribution/license; Noble and
Solana/Rust dependency licenses remain applicable. No NTT or legacy source/history
was imported in this audit; original work is not a claim over third-party code.
Earlier Apache distributions are not retroactively revoked. In particular,
the existing origin/main graph includes foundation commit
d7778be782054fe77a42133b01a799b19833cb96 with an Apache-2.0 LICENSE.
The current checkout is proprietary, but this is not a newly empty proprietary
history. The audit does not import or rewrite that graph. Any request to replace
existing published history needs separate Team direction; changing current
LICENSE does not delete earlier grants. This is a source/history observation,
not an external legal opinion about exclusive rights.

See phase-08-5-blocker-inventory.json for matching source locations/classifications.
Operational TEMPORARY names refer to recoverable deposits, not placeholder
validation. Config placeholders and fail-closed readiness states are intentional.
The sole panic! occurrence is a public-vector test case dispatcher, not runtime.
The solana-example-mocks lock dependency is upstream host compatibility metadata,
not a replacement for the two SBF programs. Documentary historical blockers are
not hidden: current actionable findings above supersede obsolete status wording.
Project-facing roles use KingPepe Team; official Solana account/token terms and
third-party flags remain. Future-scope README descriptions are not code.
Ignored host Cargo target outputs also exist in the original checkout. They have
no detected keypair/wallet/state filenames, are not staged or publication artifacts
and are not used as clean-clone evidence. Their presence is not a source build
or runtime-secret guarantee; this audit does not delete another session's cache.

## Published-source reproducibility and scan evidence

The separate 845f2b2 clone reproduced both programs with new project targets:

- kingpepe_bridge.so: `88e2f8413eafbcb800fb8c8e8db2df20e4aa8188304922bf59bd80e2e0eb004c`
- kingpepe_transceiver.so: `58bacbe7119e8793ae93dc0e025ed2ebc96c9a1407b16fdcbbdab2ec4d706eb0`

Those hashes match the primary reviewed builds. This is measured same-toolchain
reproducibility across two source locations, not a universal or independent audit.
Keys and build/runtime outputs stayed external and were not uploaded. Current,
staged and every outgoing snapshot passed publication review; full 164-commit
Gitleaks scan passed. The supplementary historical boundary scan's four
URL-userinfo candidates were reviewed inert negative-test fixtures; no real
credential was identified and no blanket exception was added.

The Windows clone had no normalized content diff, but WSL Git could report
CRLF-only modifications. The follow-up .gitattributes enforces LF without changing
global configuration or rewriting history. A stronger failure assertion also
checks transaction-fee-only loss by the payer, so record rent must roll back.
All 26 tightened finalized cases passed in a new isolated worktree run before
the follow-up commit, with no partial Mint/token/state/record/rent changes.
Post-publication evidence for that follow-up must be reported against its own SHA,
not inherited from 845f2b2. No local result certifies CI or production.
