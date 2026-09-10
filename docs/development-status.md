# KingPepe Native - Solana Bridge Development Status

## Current Phase 08 integration evidence (2026-09-10)

Current claim-retry increment is UNPUBLISHED / LOCALLY_TESTED. It reconstructs
the whole current signed claim packet using the existing canonical planner,
verifies its fee-payer signature and binds the actual programs, SPL Token
Program, Mint, recipient, PDAs, message and blockhash. The signature is recorded
before broadcast; a lost response never permits a new packet/operation.
Prior status is queried even after expiry. A mismatched RPC-returned signature
causes persistent HARD_STOP; malformed/missing status or height fails closed.
Finalized failure is distinguished from non-final execution observation.

Windows and WSL each: 172 Node tests + two vectors PASS. Eight added unit tests
cover packet/metadata substitution, lost-response reopen after expiry, pre-send
interruption, signature substitution, malformed status, failed-transaction
finality, write failure and invalid heights. Existing fixtures used fabricated
Token Program IDs and response signatures; they were corrected to the official
SPL Token Program and actual signed packets, not excepted from verification.

WSL: 58 Solana Rust + 26 Native Rust tests, fmt/clippy and both SBF builds PASS.
A fresh real REGTEST/local-validator run passes the automatic deposit, 22
security + seven CSV + four PSBT + ten race checks, plus five new process-retry
checks: saved identity before abrupt exit, identical packet after restart,
exit after actual validator acceptance but before completion is recorded,
reopen after actual blockhash expiry without sending, and completed reopen
without another mint. Each restart uses a new process without signing keys.
Final reserve and observed SPL supply each equal 100000000 atomic units.
There is no per-transfer KingPepe Team approval. Executed final suites have
zero failures/skips. Five Rust audits and npm audit find no known vulnerabilities;
bincode's unmaintained warning remains. Declared license metadata passes.

File contents flush before rename, but authenticated/fenced journals, power-loss
directory-metadata guarantees and rollback assurance are NOT established. Full
service restart, durable unminted credits, post-mint reorg response and other
Phase 08 source/validation dependencies remain open. Phase 09 NOT_STARTED.
No production configuration, keys, services, deployment or activation changed.

Provenance: 168 -> 169 files; one original local test added, no deletions, moves,
dependency changes or imported source. Obsolete scaffold/missing-tool wording
in the relevant test/validator READMEs was corrected. Current source and all 147
existing commits scan clean; private-path/IP checks and exact 169-file provenance
coverage pass. Staged/outgoing review, private push and exact-SHA CI remain
required. No runtime/build artifacts are uploaded.

Previous source `9ead67ccd1b04ea53f9b878feff3a168120f2844`, message
`fix(phase-08): verify recovery races and Native RPC errors`, is pushed privately;
[all four exact-SHA CI jobs PASS](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34451366099).
Its 164 Node + two vectors, 84 Rust, SBF and 22/7/4/10 real checks apply to that
source only. Current, staged, outgoing and all 147 commits scanned clean at its
publication; no artifacts were uploaded. New changes need their own validation.

### Previous recovery-race increment (verified source above)

The recovery-race increment was locally tested and then CI-verified. Both possible
first winners (real FROST A+B sweep or Native-wallet CSV recovery) are exercised
with separate test deposits and fees. Equal-fee mempool conflict, finalized
exclusion, disconnected reserve rejection and an alternative pre-mint branch
are checked against the actual Native node. Ten checks pass; these operations
do not request a Solana mint. The original automatic deposit remains reconciled
at 100000000 atomic reserve/supply. Post-mint deep forks are NOT covered.

Current Windows/WSL: 164 Node tests + two vectors each PASS. WSL: 58 Solana Rust
and 26 Native Rust tests, fmt/clippy and both SBF builds PASS. Real automatic
deposit + 22 security + seven CSV + four PSBT + ten race checks PASS, zero
failures/skips in executed final suites. Five new unit tests enforce the REGTEST CLI
boundary, prohibit fork controls through the ordinary RPC adapter and distinguish
unconfirmed transactions from parser/RPC failures. Race rejection checks require
specific chain-state errors; infrastructure failure cannot count as PASS. Five Rust
audits and npm audit find no known vulnerabilities; bincode's unmaintained
warning remains. Declared dependency licenses pass. Provenance 167 -> 168 files,
one original test added; no deletions/moves/dependency or licensing changes.
At publication, current/staged/outgoing source and all 147 commits scanned clean;
private-path/IP checks and exact 168-file provenance coverage passed. Private push
and exact-SHA CI passed as recorded above. No runtime/build artifacts uploaded.

The stricter real run initially FAILED when a never-broadcast losing sweep was
queried. The Native adapter discarded the structured RPC error on HTTP 500,
which obscured transaction-not-found. The pinned Native `JSONErrorReply` source
confirms this legacy behavior. The adapter now parses bounded, request-matched
400/404/500 error envelopes and reports only signed-32-bit numeric codes. It
never accepts a success result on a failing HTTP status or echoes provider error
text. Transport, malformed, oversized and wrong-ID responses remain failures.
This is a real adapter correction, not an expanded catch-all passing assertion.
The fresh complete rerun passes all ten strict race checks and the original
deposit/security/CSV/PSBT checks. No gate was removed or weakened.

PSBT source `710ad4afce5ca169868dc618acc870fdb221bf3f`, message
`feat(phase-08): support Native wallet recovery PSBTs`, is pushed privately;
[all four exact-SHA CI jobs PASS](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34449370653).
The following 159-test evidence belongs to that source, not the new race tests.

Previous verified source: `38cabeccd14c9e011e1c91fe1224d0b7bb721961`, message
`feat(phase-08): sweep recoverable deposits with real FROST tapscript signatures`,
has been pushed privately. [All four exact-SHA CI jobs passed](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34447032014).
That SHA passed 155 Node tests + two vectors, 58 Solana Rust + 26 Native Rust tests,
both SBF builds, the recoverable deposit, 22 security checks and six recovery checks.

PSBT increment: locally tested and pushed, with exact-SHA CI PASS as above.
Bounded offline PSBTv0/BIP371 preparation includes only public
recovery information, never a private key. The unsigned inspector rejects
duplicate/alternate/unknown fields, signed inputs, version/domain/tree
substitution, trailing bytes and oversized data; it does not grant authorization.
Four new unit tests pass. In the real Native wallet test, the wallet signs and
finalizes the PSBT without exporting a private key, the node accepts the spend,
the payout appears at a normal wallet-recognized address and replay is rejected.
Compatibility is limited to the pinned REGTEST wallet.

The initial real wallet test FAILED: Native's Miniscript signer could not sign
the V1 OP_DROP-prefixed recovery leaf, despite valid node/script tests. V2 uses
standard SHA256/CSV/signature fragments. Its 32-byte intent preimage is public,
not an authorization secret. FROST and user signatures remain mandatory; CSV is
still enforced by Native consensus. No old output is silently reinterpreted,
no production output was migrated, and external test wallets were preserved.
Fresh reruns pass; no gate was removed or weakened.

Current measured Windows and WSL suites: 159 Node tests + two vectors each.
WSL: 58 Solana Rust + 26 Native Rust tests, fmt/clippy and two SBF builds PASS.
Real REGTEST + local-validator run: automatic deposit, 22 security checks,
seven CSV recovery checks and four Native-wallet PSBT checks PASS. Reserve and
SPL supply each equal 100000000 atomic units; no per-transfer team approval.
All executed final suites have zero failures/skips. Five Rust audits and npm
audit find no known vulnerabilities; the bincode unmaintained warning remains.
Declared dependency licenses pass. Provenance: 164 -> 167 files, three original
source/test additions; zero deletions/moves, new dependencies or upstream imports.
Current source and all 145 existing commits scan without secret findings;
private-path/IP boundary checks and exact provenance-path coverage pass. Staged
and outgoing scans remain mandatory before commit/publication. No build or
runtime artifacts are uploaded.

Remaining Phase 08 work includes competing sweep/recovery transactions and reorgs,
remaining account/source checks, real crash/restart cases and durable
liability/fencing guarantees. End-user wallet onboarding remains SDK/app work.
Phase 09 is NOT_STARTED; production remains disabled and unconfigured.

### Previous checkpoints

Recovery-script source: `7640dedcbadd9c31c120b3ebc5b7231eaa36cde2`, message
`feat(phase-08): validate Native CSV recovery scripts on regtest`, pushed to
PRIVATE origin/main; all four [CI jobs passed](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34445169540).
That SHA passed 152 Node tests + two vectors, 58 Solana Rust + 26 Native Rust tests,
both SBF builds, the real deposit, 17 security checks and six real recovery checks.

The verified recoverable-deposit integration obtains a public recovery
key from the isolated Native user wallet, commits the deployment/recipient/amount/
epoch-bound deposit intent into a temporary two-branch script, signs its sweep
leaf with real FROST A+B, and finalizes a distinct non-user-recoverable reserve.
Separate fee inputs preserve the full deposit credit. Each role reconstructs
the intent/script; each attester also independently checks actual sweep witness
signatures against the configured group key and recomputed sighashes. Ed25519
remains attestation-only. No per-transfer KingPepe Team approval was introduced.

Windows and WSL each pass 155 Node tests + two vectors; WSL passes 58 Solana Rust
and 26 Native Rust tests, fmt/clippy and both SBF builds. Fresh real-daemon runs
pass the automatic recoverable deposit, 22 security checks and six CSV recovery
checks. Reserve and SPL supply both equal 100000000 atomic units. New real checks
reject unswept mint eligibility, script-path downgrade, control-block substitution
and altered witness signatures with an unchanged txid; both attesters verify one
BIP342 deposit input and one key-path fee input. Three new unit tests cover intent
substitution, witness integrity and invalid Native recovery-public-key handling.
The orchestration sequence assertion was updated for the new public-key calls
and early genesis check, then fully rerun. Final measured suites have no failures
or skips. No security gate was removed. All five Rust audits and npm audit find
zero vulnerabilities; the unmaintained bincode warning remains. Declared dependency
licenses pass. Current source and all 144 existing commits scan clean; staged and
outgoing scans remain required. Provenance stays at 164 files with no additions,
deletions, moves, third-party imports or new dependencies in this increment.

Those 155-test counts describe the prior integration; the newer PSBT work and
its measured scope are recorded at the top of this document.

Raw-evidence source: `ef15e6e648935044edbb4b09874119bc6c823fc7`, message
`fix(phase-08): validate raw Native evidence before signing and attesting`, pushed
to PRIVATE origin/main. All four [CI jobs passed](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34442633781),
including the real deposit and all 17 Native/Solana security checks.
Recovery-script increment `7640dedcbadd9c31c120b3ebc5b7231eaa36cde2` passed its
private push and exact-SHA CI above. Eight construction/encoding/sighash/unsigned
preparation tests pass. A fresh isolated REGTEST + local-validator run passed
the automatic deposit, all 17 existing security checks, and six real CSV recovery
checks: immature and one-block-early rejection, wrong sighash amount rejection,
CSV-disable bypass rejection, mature recovery and replay rejection. Reserve and
SPL supply both equal 100000000 atomic units. The recovery checks use separate
test funds and a simulated user key, not FROST for the user-recovery branch.

Windows and WSL each pass 152 Node tests plus two vectors; WSL passes 58 Solana
Rust and 26 Native Rust tests, fmt and clippy. Both SBF programs build. No final
suite failures or skips. An initial real-node attempt failed while parsing the
CLI's empty output for a null UTXO result; the bounded JSON-RPC adapter now checks
the explicit unspent=false observation, and the complete fresh rerun passes.
The earlier unit offset assertion was also corrected and fully rerun. No failing
gate was weakened. npm audit and all five Rust audits find zero vulnerabilities;
the reported unmaintained bincode warning remains. Declared license checks pass.
The source and all 143 existing commits scan without secrets. Staged and outgoing
scans remain mandatory before publication. Provenance covers 164 files, up from
160: four original code/test files, no deletions, moves or new dependencies.

That checkpoint did not integrate recoverable deposits or the FROST BIP342 sweep
branch into the normal flow. The newer integration is described above; PSBT and
race/reorg coverage remain incomplete. Earlier CI is not evidence for newer code.
See [recovery scope](../native/recovery/README.md).

The following raw-evidence and earlier increment counts are historical.

Domain-binding commit `33b622638617258660019302b6db8d8868e7093f`, message
`fix(phase-08): bind attestations to configured native domain`, pushed to PRIVATE
origin/main; all four [CI jobs passed](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34440113182),
including six real-validator security checks. The subsequent raw-evidence
increment and exact-SHA CI are recorded above.

Current increment: the REGTEST deposit harness invokes a bounded locked Rust
executable to check raw genesis-to-tip headers, PoW/difficulty/chainwork, header
time rules, transaction bytes/txids, Merkle roots and confirmations. Each FROST
participant independently invokes it, checks live inputs and recomputes Native
transaction/sighash and fee/change policy. Each separate Ed25519 attester invokes
it again for finalized sweep evidence and checks the reserve UTXO. Claim evidence
binds the verified packet digest; sweep and mint-claim identities are distinct.
Native RPC streaming, request-ID and UTF-8 boundaries fail closed. The old unused
RPC-object-only fingerprint helper was removed. No dependency was added.

Latest real run: both programs built; Native REGTEST and Agave local validator
completed the automatic deposit, reserve 100000000 / SPL supply 100000000 atomic.
Input evidence validated 33 headers/two transactions for each role/input; reserve
evidence validated 39 headers/three transactions for both attesters. All 17 real
checks passed: six prior Solana checks, ten Native substitution/spent-output
checks, and one role-by-role raw evidence coverage check. Windows and WSL each
passed 144 Node tests plus two vectors; WSL passed 58 Solana Rust and 26 Native
Rust tests, fmt and clippy. One initial new unit assertion mismatched the exact
error wording; corrected assertion and complete reruns passed. No gate was removed.
All five Rust audits found zero vulnerabilities; the known unmaintained bincode
warning remains reported. npm and declared dependency-license audits passed.
Current tracked/untracked source and 142 pre-increment commits scanned without
secret findings; staged/outgoing scans must also pass before publication.
Provenance now covers 160 files (155 before, five original source/test additions,
zero deleted/moved files); existing third-party legal notices are unchanged.

These runs use separate signer objects/state roots and repeat raw validation
against the same local Native node. They do not prove deployed service/process
isolation, Windows ACLs, protected storage or authenticated IPC. Canonical-chain
selection and UTXO state remain configured validating-node RPC observations;
raw header/Merkle checks are not full block-script validation or trustlessness.
See [Native boundaries](architecture/native-validation.md). Production sources,
user CSV recovery, durable fencing and the full failure matrix remain incomplete.

Security commit `95d00b19026dd56320cc012f580802bff6300fc0`, message
`fix(phase-08): authorize mint enrollment and prevent backing replay`, pushed to
PRIVATE origin/main; all four [CI jobs passed](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34439119240).
CI measured the real deposit plus three retry/replay/supply checks. Its exact-SHA
evidence does not certify newer changes described above.

Integration source `bfc704c561fcf47e9625c7aff6c8bb72b1997ba7` was pushed to the
private repository. [CI run 34437324660](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34437324660)
failed in the SBF job: running host Cargo metadata from the repository root
selected the old Native toolchain, which could not parse Solana lockfile v4.
The corrective workflow builds from solana/ so the pinned Rust 1.89.0 applies.
Correction `507c94f39b1f91630baf22824ca4094e3f99d5b6`, message
`fix(ci): select Solana host toolchain for SBF metadata`, was pushed to PRIVATE
origin/main; all four [CI jobs passed](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34437591936).
The Linux job built both SBF programs and executed the real automatic deposit,
observing reserve and Mint supply of 100000000 atomic units. No gate was disabled.

Previous source `cb7b44544f8c3935ddc8065eee5d67ee220afee2`, message
`fix(phase-08): isolate pinned SBF builds and validate real native sweep`,
was pushed to PRIVATE origin/main and passed all four
[CI jobs](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34432312954).
The newer raw-evidence increment and its exact-SHA CI are recorded above.
CI emits the tested GITHUB_SHA; no self-referential commit SHA is embedded.

- Bounded same-signature setup/receipt/claim finality waiting is implemented.
- The invalid oversized bundle was removed. A packet-sized receipt transaction
  shares the exact canonical bytes with two Ed25519 verification instructions;
  a separate finalized-receipt claim/mint transaction preserves replay identity.
  Both fit 1232 bytes; compute budget 600000 units is LOCALNET-only.
- Transactions are persisted before broadcast. Retry uses immutable request
  snapshots and known signatures. Lost-response/reopened-journal tests avoid
  a second receipt broadcast; persisted integrity HARD_STOP does not clear.
- Actual entrypoints enforce pause, hard-stop, local activation/environment,
  recipient binding and expiry. Test CPI bypass is cfg(test)-only.
- Manager and Transceiver initial enrollment require the exact Mint identity's
  signature. An arbitrary fee payer cannot initialize that Mint's configuration;
  substitution and reinitialization are rejected. The Mint identity is not an
  alternate SPL minter and is never required for normal transfer approval.
- A permanent manager-owned backing marker binds Mint, Native genesis and exact
  outpoint, excluding nonce, validity, evidence and epochs. It is written with
  claim/mint atomically and has no close instruction. Rust checks cover changed
  nonce/evidence and epoch rotation; the matching planner derives the same PDA.
- Real-validator security checks pass: completed-operation retry is idempotent;
  a new valid two-attester receipt with a changed nonce cannot credit consumed
  backing; actual supply is unchanged. Rejection is validator preflight, not a
  claimed finalized failed transaction. A test-harness account-wrapper mismatch
  initially failed the final supply check; the corrected full run passed all
  three checks. These are not the complete failure/reorg/restart matrix.
- The current Transceiver configuration additionally binds protocol ID, Native
  network code and genesis. Three more real-validator checks reject separately
  substituted domains signed by both disposable attesters and verify no receipt
  was created. The full six-check run passed with unchanged supply.
- Compact bridge initialization makes zero premine and None freeze authority
  implicit, mandatory values. Old initialization serialization is rejected;
  persisted bridge state layout is unchanged. Transceiver config uses KPTCFG02
  and rejects old unbound config. Setup signing enforces the 1232-byte packet cap.
- The observer checks account program ownership, PDA, freshness, Mint layout,
  exact supply, decimals, PDA mint authority and no freeze authority. It reports
  RPC_OBSERVATION, not independent chain validation.
- A real Native REGTEST + Agave 4.2.2 local-validator flow completed: Native user
  payment, node-accepted FROST A+B Taproot sweep, reserve finality, separate
  Ed25519 attestations, receipt, finalized mint, and exact reconciliation.
  Finalized reserve and actual Mint supply both measured 100000000 atomic units.
  There was no per-transfer KingPepe Team approval.
- Solana host Rust 1.89.0, solana-program 3.0.0, SPL Token interface 2.0.0,
  Agave 4.2.2 / builder 4.1.0 / platform-tools v1.54 replace the affected 1.18
  graph. Traditional SPL Token and the economic ABI are unchanged.
- cargo-audit 0.22.2: five lockfiles, zero vulnerabilities, one unmaintained
  bincode 1.3.3 warning (RUSTSEC-2025-0141). No ignored advisory. npm audit: zero.
  License metadata checks cover five Cargo graphs and two npm dependencies;
  seven original crates are unpublished and reference the proprietary LICENSE.
  This is not an external legal/source audit or distributable-artifact audit.
- CI now includes the actual daemon-backed deposit flow and Rust advisory/license
  checks. Runtime output, keys and workspace artifacts are not uploaded.
- Stale AGENTS/readiness summaries were consolidated; historical evidence below
  is not proof of this newer source.

Measured current tests: 155 Node tests + two vectors on Windows and WSL; 58 Solana
Rust tests + 26 Native proof/supporting-crate tests in WSL. Formatting/clippy pass.
Zero failures/skips in these final measured suites; two SBF builds and real deposit
E2E plus 22 security checks and six Native recovery checks pass. Native Windows SBF,
Windows service ACL/protected storage, full
failure matrix, withdrawal E2E, Devnet and fresh-clone reproducibility: NOT_RUN.

Phase 08 is still incomplete. Next: publish/verify this integration increment,
then add competing recovery/sweep, reorg, PSBT and remaining source/failure/restart
tests. The normal local deposit now uses a user-recoverable temporary script and
real FROST BIP342 sweep. File-journal tests do not prove production fsync, authenticated
storage, fencing or rollback guarantees. Production observers remain BLOCKED.
Phase 09 has not started; productionReady=false; Mainnet activation DISABLED.

## Historical stage records (superseded where noted above)

- `PHASE 08` - Automatic Native to Solana local end-to-end
- Branch: `main`
- Repository: private by policy
- `productionReady = false`
- `mainnetActivation = DISABLED`

## Phase 02 result

- Added root and workspace toolchain pins:
  - `rust-toolchain.toml`
  - `solana/rust-toolchain.toml`
  - Dependency pins in `solana/*/Cargo.toml` and `native/frost/Cargo.toml`
- Created non-empty structural scaffolding directories with policy-safe placeholders:
  - `solana/ts/{idl,lib,sdk,scripts}`
  - `solana/tests`, `solana/fuzz`, `solana/scripts`
  - `native/proof`, `native/reserve`, `native/recovery`
  - `config/schemas`, `config/examples`
  - `deployment/{localnet,devnet,mainnet,windows,manifests}`
  - `shared`, `cli`, `app`, `db-backup`, `scripts`, `monitoring`, `tests`
- Updated comparison and toolchain governance docs:
  - `docs/architecture/ntt-comparison.md`
  - `UPSTREAM-REFERENCES.json`
  - `PROVENANCE.json` (coverage updated to include all tracked files)
- Updated CI action pins in `.github/workflows/ci.yml`
- Added `solana/Cargo.lock` and tightened CI Rust commands to `--locked`.
- Removed the phase-02 Ed25519 signing placeholder dependency from `native/frost`; the current deterministic test-share model is build scaffolding only and is not final Native-compatible FROST.
- Confirmed secret scan remains clean via `python .github/scripts/guardrails.py`.
- Confirmed repository remains private.
- Corrective commit: `218cff1dacea2a2f6ba0564fc49593c85b3f4f9f`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34276946620`
- CI status: PASS

## Historical blockers (not current)

- Phase 08 is blocked because the local environment does not provide `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, or `anchor`.
- Current Solana crates have deterministic non-production localnet Program IDs, economic ABI decoding, source-level account execution, SPL Token CPI construction, a localnet-only deposit-claim observer, a bundled localnet transaction-plan builder that includes Ed25519 attestations, transceiver receipt creation, and bridge claim/mint, plus a localnet adapter that connects signed bundled planning to durable submission. Real local-validator execution remains untested because required localnet executables are missing.
- Full Native FROST signature aggregation, witness broadcast, Native node acceptance, local end-to-end flows, Devnet, production configuration, external review, and activation remain later phases.

## Historical local validation

- `python .github/scripts/guardrails.py`: PASS
- `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL
- `cd solana && cargo test --locked --workspace`: PASS under WSL, 23 tests
- `node solana/ts/scripts/verify-vectors.mjs`: PASS, 2 vectors
- `cargo check --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL
- `cargo test --locked --manifest-path native/frost/Cargo.toml`: PASS under WSL, 7 tests
- `npm ci --ignore-scripts`: PASS
- `npm test`: PASS, 2 protocol vectors and 5 FROST Node tests
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities
- Phase 05 `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL
- Phase 05 `cd solana && cargo test --locked --workspace`: PASS under WSL, 35 Rust tests
- Phase 05 local `cargo fmt` / `cargo clippy`: NOT_RUN; local WSL Cargo 1.75 lacks the subcommands
- Phase 05 CI: PASS for `7e8212b1ca80ccbcdafbad1c72422bb0eafaa300`
- Phase 06 `cargo test --locked --manifest-path native/proof/Cargo.toml`: PASS under WSL, 8 Rust tests
- Phase 06 `cargo test --locked --manifest-path native/reserve/Cargo.toml`: PASS under WSL, 3 Rust tests
- Phase 06 `cargo test --locked --manifest-path native/recovery/Cargo.toml`: PASS under WSL, 3 Rust tests
- Phase 06 CI: PASS for `836b8e62e2c87fe8b2d3df48f7fc54466206b646`
- Phase 07 `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL
- Phase 07 `cd solana && cargo test --locked --workspace`: PASS under WSL, 38 Rust tests
- Phase 07 `npm test`: PASS, 2 protocol vectors, 5 FROST Node tests, 5 attester tests, and 7 Solana observer tests
- Phase 07 `npm audit --audit-level=low`: PASS, 0 vulnerabilities
- Phase 07 `python .github/scripts/guardrails.py`: PASS
- Phase 07 local `cargo fmt` / `cargo clippy`: NOT_RUN; local WSL has Cargo but not `rustup`, `rustfmt`, or `clippy`
- Phase 07 CI: PASS for `d17ba8fe61d20a88d4206f72d68a010a2d146524`
- Phase 08 `Get-Command kingpeped kingpepe-cli solana solana-test-validator anchor`: NOT_FOUND on Windows
- Phase 08 `command -v kingpeped kingpepe-cli solana-test-validator solana anchor`: NOT_FOUND under WSL
- Phase 08 `npm run test:bridge-validator`: PASS, 47 bridge-validator tests (automatic deposit pipeline, file-backed deposit journal, async adapter path, Native reserve-sweep adapters, adapter-journal restart retry, signing-intent boundary, Solana deposit claim submitter, Solana transaction-plan builder including bundled transceiver receipt planning, and localnet Solana deposit-claim bridge adapter)
- Phase 08 `npm run test:native-node`: PASS, 10 Native REGTEST RPC adapter and Taproot transaction tests
- Phase 08 `npm run test:solana-observer`: PASS, 14 Solana observer tests including the localnet deposit-claim observer
- Phase 08 `npm run test:local-e2e-readiness`: PASS, 27 readiness/orchestration/bootstrap/runner tests
- Phase 08 `npm run doctor:local-e2e`: BLOCKED_LOCAL_INFRASTRUCTURE_MISSING; missing localnet executables; both Solana programs report `READY` at the source/readiness-gate level after account-execution wiring
- Phase 08 `npm run local:e2e:plan`: BLOCKED_LOCAL_INFRASTRUCTURE_MISSING with redacted local paths and no production configuration
- Phase 08 `npm run local:e2e:bootstrap`: BLOCKED_LOCAL_INFRASTRUCTURE_MISSING before command execution; missing localnet executables
- Phase 08 source-boundary CI: PASS for `09e42e6856312a0c617eb9c14a0312012263722a`
- Phase 08 local E2E readiness gate CI: PASS for `6f22309770f3a2f85c96093bcf8af10b47065f31`
- Phase 08 fail-closed Solana entrypoint shell CI: PASS for `7eafd8a38d346dcb018005a7357a0012a84b0e0c`
- Phase 08 validate-only Solana ABI CI: PASS for `201c5bdc2a2fb65601331b58115e0a7543179e12`
- Phase 08 mint-authority real Solana PDA correction CI: PASS for `94da519e7a50ea6692c445cfd307beb0fa491347`
- Phase 08 Solana account-state codecs: PASS for `804e03d4909ad002c0cf97798bd30cda56a7d4be`
- Phase 08 Solana account execution and SPL Token CPI source: PASS for `8309b3fc95bea4b84224852cb13e2f9b75099dfa`
- Phase 08 local E2E orchestration plan: PASS for `7ffd331358146bb990f9830d4f39c0849cc0bdeb`
- Phase 08 local E2E bootstrap runner: PASS for `d392403733bbfb92fcfd2d50a1d3879d63f0e3bb`
- Phase 08 Native REGTEST RPC adapter: PASS for `845dfc4a86a1ef87f15e3d5ec2ca4ad91fd8fe8d`
- Phase 08 Solana deposit claim submitter: PASS for `905a45b4c79d879e6ae27a05b3c7a39fed0a30f6`
- Phase 08 async deposit pipeline entrypoint: PASS for `024c0019745bc4671299af135740aa9d29963116`
- Phase 08 Native reserve-sweep adapters: PASS for `9af93d22b9af9c1278354a33e35db469311332d9`
- Phase 08 deposit pipeline file-backed journal: PASS for `73df9906998f9783c309a0671739d19cfc6b589f`
- Phase 08 Solana deposit-claim observer: PASS for `df49793f0595bb501e83405b79d21215283a1d0a`
- Phase 08 Solana deposit-claim transaction plan: PASS for `42a5cdb3bcc60e0be7fb5d2395503f148b6d632f`
- Phase 08 localnet Solana deposit-claim bridge adapter: PASS for `0a4c39a146d150b5291935fb2ce800100accc898`
- Phase 08 local FROST Taproot deposit/fee/reserve intent: PASS for
  `5e98101e1b47380ade3d5fa00c445b24f37efd70`
- Phase 08 local Taproot sighash evidence: PASS for
  `36c3dbbaad092fab750abc66e2bfdb8838f05941`
- Phase 08 current `npm test`: PASS, 2 protocol vectors plus 108 Node tests
- Phase 08 `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL after validate-only ABI update
- Phase 08 `cd solana && cargo test --locked --workspace --all-targets`: PASS under WSL, 52 Rust tests after account-execution update
- Phase 08 local Native-to-Solana E2E: BLOCKED / NOT_RUN

## Phase 08 local E2E Native wallet raw-signing boundary

- Source status: implemented and CI verified.
- Source commit:
  `8d091c2867eda2e1e8e6818216e23d8220f78279`.
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34339945822` PASS.
- Local tests:
  - `npm run test:local-e2e-readiness`: PASS, 23 readiness/orchestration/bootstrap/runner tests.
  - `npm run test:bridge-validator`: PASS, 39 bridge-validator tests.
  - `npm test`: PASS, 2 protocol vectors plus 93 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - `npm run local:e2e:native-to-solana`: expected `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- What changed:
  - The local REGTEST CLI allowlist no longer permits
    `signrawtransactionwithwallet`.
  - `sendrawtransaction` remains allowlisted for already FROST-signed Native
    transactions.
  - Added a regression that rejects wallet raw-signing while preserving the
    FROST-signed broadcast boundary.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 Native reserve-sweep signing-intent boundary

- Source status: implemented and CI verified.
- Source commit:
  `3c473d75891707950a4bfefd889e95b6649a43b7`
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34342995604` PASS.
- Local tests:
  - `npm run test:bridge-validator`: PASS, 43 bridge-validator tests.
  - `npm run test:local-e2e-readiness`: PASS, 23 local readiness/orchestration/bootstrap/runner tests.
  - `npm test`: PASS, 2 protocol vectors plus 97 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - `npm run local:e2e:native-to-solana`: expected `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- What changed:
  - Added a localnet-only bridge-validator boundary that prepares a
    Native-compatible FROST reserve-sweep signing intent only after receiving
    validated Native Taproot sighash evidence.
  - The boundary binds the operation ID, deposit outpoint, unsigned transaction
    fingerprint, proof fingerprint, canonical reserve allocation, Native fee,
    reserve script, transaction commitment, Taproot sighash, key epoch, and
    Solana deployment domain into the FROST signing intent and signer-policy
    authorization.
  - The credited deposit amount must reach canonical reserve; Native miner fees
    are bound separately and require local fee-funding evidence instead of
    silently reducing the user's reserve allocation.
  - Corrected the local unsigned reserve-sweep draft path to create an explicit
    local fee-funding UTXO for nonzero miner fees and to preserve the credited
    deposit amount as the canonical reserve output.
  - Missing, RPC-only, or altered sighash evidence is rejected before FROST can
    sign.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - The new boundary does not compute a real Native sighash; real daemon-backed
    E2E still requires actual local Native transaction/sighash verification.

## Phase 03 local implementation

- Replaced the phase-02 message scaffold with a fixed-length 514-byte canonical binary protocol message.
- Added operation ID derivation and message digest generation with SHA-256.
- Added deposit and withdrawal constructors, domain-bound deployment identity, native outpoint handling, validity windows, policy/key epochs, and bounded destination encoding.
- Added lifecycle states for automatic transfer processing without per-transfer KingPepe Team approval.
- Added exact integer ledger primitives for reserve, minted supply, unminted credits, burned unpaid withdrawals, reserved UTXOs, broadcast payouts, finalized payouts, fees, change, and unsettled operation counts.
- Added shared JSON golden vectors plus Rust and Node verification.
- Commit: `1b95cf0`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34278735928`
- CI status: PASS

## Next phase

- Continue Phase 08 by providing the missing disposable KingPepe regtest and
  Solana local-validator executables, then run the full automated
  Native-to-Solana local E2E flow.

## Phase 08 Native reserve fee-funding model alignment

- Source status: implemented and CI verified.
- Source commit:
  `74bd3742e8b5846f477ac90054a6f9fd83fc17b8`
- Corrective/tested source SHA:
  `894cdb6b9361b5b0bba46d66741d2cf6ecd2bc4e`
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34345811287` PASS.
- Superseded CI failure:
  `74bd3742e8b5846f477ac90054a6f9fd83fc17b8` failed Linux native reserve
  formatting and was corrected by
  `894cdb6b9361b5b0bba46d66741d2cf6ecd2bc4e`.
- What changed:
  - The Rust Native reserve primitive now matches the Phase 08 local
    reserve-sweep fee model.
  - The credited temporary-deposit amount must become the canonical reserve
    allocation.
  - Nonzero Native miner fees require exact separate fee-funding inputs.
  - Missing, duplicated, temporary-outpoint-aliasing, not-spent, or wrong-amount
    fee-funding evidence is rejected before the reserve allocation can be
    settled.
  - Reserve records retain non-secret fee-funding outpoints for accounting and
    reconciliation provenance.
- Local tests:
  - `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/frost cargo test --locked --all-targets`: PASS, 7 tests.
  - `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/proof cargo test --locked --all-targets`: PASS, 8 tests.
  - `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/reserve cargo test --locked --all-targets`: PASS, 4 tests.
  - `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/recovery cargo test --locked --all-targets`: PASS, 3 tests.
  - `npm test`: PASS, 2 protocol vectors plus 97 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - `git diff --check`: PASS.
  - `rustfmt` / `cargo fmt`: NOT_RUN locally; the WSL toolchain has Cargo but
    no installed rustfmt component.
  - `npm run local:e2e:native-to-solana`: BLOCKED_LOCAL_INFRASTRUCTURE_MISSING.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 local FROST Taproot deposit, fee, and reserve intent

- Source status: implemented and CI verified.
- Source commit:
  `5e98101e1b47380ade3d5fa00c445b24f37efd70`
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34349340644` PASS.
- What changed:
  - The local Native-to-Solana runner now derives a disposable software
    FROST A+B aggregate Taproot custody address under the local E2E run root
    outside the repository.
  - The runner uses the recovered KingPepe REGTEST parameters:
    8 atomic decimals, coinbase maturity `20`, and Bech32m HRP `rkpepe`.
  - The local deposit, separate reserve-sweep fee-funding output, and canonical
    reserve output now use the FROST-controlled P2TR script instead of
    wallet-owned deposit/reserve addresses.
  - Deposit observation now requires both the expected address and exact P2TR
    script before creating the non-secret proof fingerprint.
  - The runner still stops before validated Taproot sighash computation,
    multi-input FROST witness attachment, Native broadcast, Solana mint
    submission, and reconciliation.
- Local tests:
  - `node --test scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS, 10 tests.
  - `npm test`: PASS, 2 protocol vectors plus 99 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - WSL Rust regression gates: PASS, 52 Solana Rust tests, 7 Native FROST
    Rust tests, 8 Native proof Rust tests, 4 Native reserve Rust tests, and 3
    Native recovery Rust tests.
  - `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 local Taproot sighash evidence

- Source status: implemented and CI verified.
- Source commit:
  `36c3dbbaad092fab750abc66e2bfdb8838f05941`
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34352340935` PASS.
- What changed:
  - Added `native/node/native-taproot-transaction.mjs`.
  - Added `native/node/tests/native-taproot-transaction.test.mjs`.
  - The helper parses and serializes Bitcoin-style Native transactions, computes
    BIP-341 key-path `SIGHASH_DEFAULT` evidence from unsigned transactions and
    public spent-output data, verifies the exact reserve output and separate
    Native miner fee, and attaches key-path Taproot witnesses after signatures
    are supplied.
  - The local Native-to-Solana runner now verifies the unsigned reserve-sweep
    input outpoints and computes per-input sighash evidence for the deposit and
    fee-funding P2TR inputs.
  - The runner now stops at `LOCAL_NATIVE_TAPROOT_SIGHASHES_VALIDATED` with
    `FROST_RESERVE_SWEEP_SIGNATURES_PENDING`; it still does not claim a real
    daemon-backed reserve broadcast, Solana mint, or reconciliation pass.
- Local tests:
  - `node --test native/node/tests/native-taproot-transaction.test.mjs`: PASS,
    3 tests.
  - `node --test scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS, 10
    tests.
  - `npm test`: PASS, 2 protocol vectors plus 102 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - WSL Rust regression gates: PASS, 52 Solana Rust tests, 7 Native FROST
    Rust tests, 8 Native proof Rust tests, 4 Native reserve Rust tests, and 3
    Native recovery Rust tests.
  - CI Linux formatting, clippy, Rust/Node tests, guardrails, and audit: PASS.
  - CI Windows portable checks: PASS.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 source-boundary implementation

- Added `services/bridge-validator/automatic-deposit-pipeline.mjs`.
- Added `services/bridge-validator/tests/automatic-deposit-pipeline.test.mjs`.
- Added `services/bridge-validator/index.mjs`.
- Added `scripts/local-e2e-readiness.mjs`.
- Added `scripts/tests/local-e2e-readiness.test.mjs`.
- Updated CI to run `npm run test:bridge-validator` on Linux and Windows.
- Updated CI to run `npm run test:local-e2e-readiness` on Linux and Windows.
- Implemented service-side automatic Native-to-Solana orchestration that:
  - validates configured Native evidence before signing;
  - performs automatic FROST A+B reserve-sweep signing through the existing
    Native-compatible FROST runtime;
  - waits for finalized canonical reserve-sweep evidence before attestation;
  - requires two distinct project attesters over the identical canonical
    deposit message;
  - submits exactly one deposit claim through a Solana bridge adapter;
  - records exact BigInt reserve, mint-credit, minted-supply, fee, and
    unsettled-operation accounting;
  - prevents completed replay from minting or broadcasting twice;
  - rejects invalid trust, altered reserve evidence, and FROST quorum loss;
  - contains no per-transfer KingPepe Team approval state.
- Implemented a local E2E readiness gate that explicitly blocks real E2E
  reporting until `kingpeped`, `kingpepe-cli`, `solana`,
  `solana-test-validator`, `anchor`, deployable Solana program markers, and
  non-placeholder localnet program IDs are present.
- Implementation commit: `09e42e6856312a0c617eb9c14a0312012263722a`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34292181114`
- CI status: `PASS`
- Local E2E readiness gate commit:
  `6f22309770f3a2f85c96093bcf8af10b47065f31`
- Local E2E readiness gate CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34293107931`
- Local E2E readiness gate CI status: `PASS`
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 validate-only Solana ABI implementation

- Added typed binary instruction decoders for bridge manager instructions:
  initialization, deposit-claim acceptance, and withdrawal-record creation.
- Added typed binary instruction decoders for transceiver instructions:
  initialization and canonical-message verification from Ed25519 instruction
  indexes.
- Added strict fixed-length decoding, canonical message decoding, duplicate
  Ed25519 instruction-index rejection, and trailing-data rejection.
- Kept on-chain economic execution disabled. The entrypoints decode recognized
  instructions, then fail closed with execution disabled until account state,
  SPL Token CPI, and local-validator execution are implemented.
- Updated the readiness gate to classify the current programs as
  `ABI_VALIDATE_ONLY` and report `SOLANA_PROGRAM_EXECUTION_NOT_READY`.
- Source commit: `201c5bdc2a2fb65601331b58115e0a7543179e12`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34298518315`
- CI status: `PASS`
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 Solana account-state codec implementation

- Added fixed binary account layouts for bridge state, deposit claim records,
  withdrawal records, transceiver configuration, and verified-message receipts.
- Added magic bytes, version checks, exact account-length validation, and
  canonical padding checks for bounded recipient/destination data.
- Added tests for state/record/receipt round trips, wrong magic, unsupported
  versions, truncated account data, overlong destinations, and alternate
  padding.
- Account execution and SPL Token CPI remain disabled and fail-closed.
- Implementation commit:
  `16dec337ba321b4f37f6dd1dfb13cf5a221db3eb`
- Corrective format commit / tested source SHA:
  `804e03d4909ad002c0cf97798bd30cda56a7d4be`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34301859073`
- CI status: `PASS`
- Superseded CI failure:
  `16dec337ba321b4f37f6dd1dfb13cf5a221db3eb` failed Linux rustfmt and was
  corrected by `804e03d4909ad002c0cf97798bd30cda56a7d4be`.
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 Solana account execution and SPL Token CPI source implementation

- Added economic account execution entrypoints for the bridge manager and
  transceiver while preserving Mainnet-disabled configuration policy.
- Bridge manager account execution now validates program-owned bridge state,
  deposit claim, and withdrawal record PDA accounts; verifies the SPL Mint and
  standard Token Program binding; writes fixed account records; constructs
  `mint_to_checked` and `burn_checked` SPL Token CPIs; and keeps withdrawal
  burn plus record creation atomic inside one program instruction.
- Transceiver account execution now validates program-owned config and receipt
  PDA accounts, loads referenced Ed25519 verifier instructions from the Solana
  instructions sysvar, and writes verified-message receipt accounts.
- Local unit tests cover initialization, PDA mismatches, receipt writes,
  deposit-claim recording/mint CPI planning, and withdrawal burn/record CPI
  planning. Unit tests skip actual Token Program CPI invocation only because
  no local validator is available in this environment.
- Source commit: `c3b2686cf701bc7ed795aefe9c4ba1dfd75bf11e`
- Corrective format commit / tested source SHA:
  `8309b3fc95bea4b84224852cb13e2f9b75099dfa`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34304533970`
- CI status: `PASS`
- Superseded CI failure:
  `c3b2686cf701bc7ed795aefe9c4ba1dfd75bf11e` failed Linux rustfmt and was
  corrected by `8309b3fc95bea4b84224852cb13e2f9b75099dfa`.
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 local E2E orchestration plan

- Added `scripts/local-e2e-orchestrator.mjs`.
- Added `npm run local:e2e:plan`.
- Added orchestration tests to `scripts/tests/local-e2e-orchestrator.test.mjs`.
- The orchestrator builds a local-only plan for:
  - `anchor build`;
  - `solana-test-validator` with localnet Program IDs from `solana/Anchor.toml`;
  - `kingpeped` REGTEST startup with absolute disposable datadir, loopback RPC,
    no public listening, and non-privileged ports;
  - allowlisted `kingpepe-cli` templates for local health/stop commands.
- Runtime datadir and Solana ledger paths must be outside the repository.
- CLI output redacts local paths and continues to report
  `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING` until the required executables are
  present.
- Source commit: `7ffd331358146bb990f9830d4f39c0849cc0bdeb`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34305873353`
- CI status: `PASS`
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 local E2E bootstrap runner

- Added `scripts/local-e2e-bootstrap.mjs`.
- Added `npm run local:e2e:bootstrap`.
- Added bootstrap tests to `scripts/tests/local-e2e-bootstrap.test.mjs`.
- The bootstrap runner performs executable version checks, `anchor build`,
  Solana local-validator startup, KingPepe REGTEST startup, health checks, and
  cleanup when the required local-only toolchain is present.
- The runner exits blocked before command execution when required executables
  are missing.
- The runner explicitly reports that it does not run or prove the full
  economic Native-to-Solana E2E flow.
- Source commit: `d392403733bbfb92fcfd2d50a1d3879d63f0e3bb`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34307355800`
- CI status: `PASS`
- Tests:
  - `npm run test:local-e2e-readiness` (pass, 13 readiness/orchestration/bootstrap tests)
  - `npm test` (pass, 2 protocol vectors plus 36 Node tests)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 Native REGTEST RPC adapter

- Added `native/node/native-rpc-client.mjs`.
- Added `native/node/tests/native-rpc-client.test.mjs`.
- Added `npm run test:native-node`.
- Added Linux and Windows CI gates for the Native node adapter tests.
- The adapter implements a loopback-first KingPepe JSON-RPC boundary for local
  REGTEST source observation, source snapshots, UTXO checks, controlled local
  raw transaction broadcast, and local daemon stop.
- Endpoint URLs with embedded credentials are rejected.
- Optional auth-cookie material must live outside the repository checkout.
- UTXO values are converted from raw JSON decimal text into exact atomic units;
  scientific notation and precision loss are rejected.
- RPC results remain classified as `RPC_OBSERVATION`; this does not claim
  independent consensus validation or production observer readiness.
- Source commit: `845dfc4a86a1ef87f15e3d5ec2ca4ad91fd8fe8d`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34308850060`
- CI status: `PASS`
- Tests:
  - `npm run test:native-node` (pass, 7 Native RPC adapter tests)
  - `npm test` (pass, 2 protocol vectors plus 43 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 Solana deposit claim submitter

- Added `services/bridge-validator/solana-deposit-claim-submitter.mjs`.
- Added `services/bridge-validator/tests/solana-deposit-claim-submitter.test.mjs`.
- Updated bridge-validator documentation and CI step labels.
- The submitter is localnet-only in this phase and accepts prebuilt Solana
  deposit-claim transaction bytes from the local harness/SDK boundary.
- Before Solana RPC submission it validates:
  - canonical deposit message action, direction, domain, operation ID, digest,
    amount, recipient, policy epoch, and key epoch;
  - exactly two valid project attestations over the same canonical message;
  - prepared transaction encoding, recent blockhash, and last valid block
    height.
- It persists the prepared operation before broadcast, records the submitted
  signature, checks the previous signature outcome before retry, and refuses to
  rebuild a new economic operation when a submitted transaction's blockhash has
  expired but the outcome is unknown.
- It returns `COMPLETED` only after finalized claim observation confirms the
  expected operation, message digest, Mint, recipient, and minted amount.
- Local test status:
  - `npm run test:bridge-validator` (pass, 13 tests)
  - real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.
- Source commit: `905a45b4c79d879e6ae27a05b3c7a39fed0a30f6`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34310531798`
- CI status: `PASS`
- Tests:
  - `npm run test:bridge-validator` (pass, 13 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 50 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)

## Phase 08 async deposit pipeline entrypoint

- Added `processDepositAsync` to
  `services/bridge-validator/automatic-deposit-pipeline.mjs`.
- The async path awaits promise-returning Native relayer, reserve verifier, and
  Solana bridge adapters while preserving the same Native evidence validation,
  FROST A+B signing, reserve finality, two-attester threshold, idempotency, and
  exact-accounting behavior as the synchronous path.
- Added bridge-validator coverage using promise-returning adapters.
- Source commit: `024c0019745bc4671299af135740aa9d29963116`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34312011059`
- CI status: `PASS`
- Local test status:
  - `npm run test:bridge-validator` (pass, 14 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 51 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 Native reserve-sweep adapters

- Added `services/bridge-validator/native-reserve-sweep-adapters.mjs`.
- Added `services/bridge-validator/tests/native-reserve-sweep-adapters.test.mjs`.
- Exported the adapter boundary from `services/bridge-validator/index.mjs`.
- The relayer validates the FROST A+B transcript, signed local sweep
  transaction shape, expected operation, and expected Native sweep txid;
  persists before broadcast; and retries without rebroadcasting an already
  submitted operation.
- The verifier builds reserve-sweep evidence from local RPC observations,
  checking source readiness, sweep finality, the deposit input, reserve script,
  exact text atomic output values, and mismatch handling.
- Current verifier trust is `RPC_OBSERVATION`; this is not independent
  consensus validation or production observer readiness.
- Local test status:
  - `npm run test:bridge-validator` (pass, 22 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 59 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.
- Source commit: `9af93d22b9af9c1278354a33e35db469311332d9`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34313600140`
- CI status: `PASS`

## Phase 08 deposit pipeline file-backed journal

- Added `FileBackedDepositJournal` to the automatic Native-to-Solana deposit
  pipeline.
- The journal persists completed deposit results and deposit-outpoint
  reservations outside the source tree.
- Restart replay of a completed deposit returns the persisted terminal result
  without rebroadcasting the Native reserve sweep or resubmitting the Solana
  deposit claim.
- Conflicting operation IDs for an already-reserved deposit outpoint are
  rejected across restarts.
- Source-tree journal roots are rejected.
- Local test status:
  - `npm run test:bridge-validator` (pass, 25 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 62 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.
- Source commit: `73df9906998f9783c309a0671739d19cfc6b589f`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34315069345`
- CI status: `PASS`

## Phase 08 Solana deposit-claim observer

- Added `services/solana-observer/solana-deposit-claim-observer.mjs`.
- Added `services/solana-observer/tests/solana-deposit-claim-observer.test.mjs`.
- Exported the observer through `services/solana-observer/index.mjs`.
- The observer is localnet-only and uses a loopback-only Solana JSON-RPC
  boundary or an injected test client.
- It reads a finalized Solana transaction, finalized root slot, bridge
  deposit-claim account, and SPL Mint account.
- It decodes the fixed bridge deposit-claim account layout and fails closed if
  the observed operation ID or message digest does not match the requested
  operation.
- It extracts SPL Mint freeze-authority state so downstream checks can
  hard-stop if freeze authority is present.
- It does not introduce production RPCs, keys, Program IDs, Mint identities, or
  operational state.
- Source commit: `df49793f0595bb501e83405b79d21215283a1d0a`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34316743630`
- CI status: `PASS`
- Local test status:
  - `npm run test:solana-observer` (pass, 14 tests)
  - `npm test` (pass, 2 protocol vectors plus 69 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - targeted changed-file secret-pattern scan (pass)
  - `npm run doctor:local-e2e` (BLOCKED / NOT_RUN for real E2E; missing
    localnet executables)
  - `npm run local:e2e:bootstrap` (BLOCKED / NOT_RUN before command execution;
    missing localnet executables)
  - real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 Solana deposit-claim transaction plan

- Added `services/bridge-validator/solana-deposit-claim-transaction-plan.mjs`.
- Added
  `services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`.
- Exported the builder through `services/bridge-validator/index.mjs`.
- The builder derives bridge state, deposit claim, mint-authority, and
  transceiver receipt PDAs using Solana-compatible seeds and off-curve PDA
  checks.
- It validates the canonical deposit message against configured localnet
  Program IDs, Mint, and recipient token account.
- It builds exact `AcceptDepositClaim` instruction data and a Solana legacy
  transaction message with the expected account-meta ordering.
- It can produce signed localnet transaction bytes only through an injected
  fee-payer signer. No key files are loaded, generated on disk, or stored.
- Source commit: `42a5cdb3bcc60e0be7fb5d2395503f148b6d632f`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34318547667`
- CI status: `PASS`
- Local test status:
  - `npm run test:bridge-validator` (pass, 30 tests)
  - `npm test` (pass, 2 protocol vectors plus 74 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - targeted changed-file and outgoing-range secret-pattern scans (pass)
  - real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 localnet Solana deposit-claim bridge adapter

- Added `services/bridge-validator/localnet-solana-deposit-claim-bridge.mjs`.
- Added
  `services/bridge-validator/tests/localnet-solana-deposit-claim-bridge.test.mjs`.
- Exported the adapter through `services/bridge-validator/index.mjs`.
- Added `SolanaLocalRpcClient.getLatestBlockhash()` for the localnet
  blockhash dependency.
- The adapter fetches or accepts a localnet blockhash, prepares a signed
  deposit-claim transaction through the localnet transaction-plan builder, and
  submits through the durable Solana deposit submitter.
- Fee-payer signing remains injected; no key files are loaded, generated on
  disk, or stored.
- It remains localnet-only and returns `WAITING_FOR_DEPENDENCY` when the
  latest blockhash dependency is unavailable.
- Source commit: `0a4c39a146d150b5291935fb2ce800100accc898`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34320747968`
- CI status: `PASS`
- Local test status:
  - `npm run test:bridge-validator` (pass, 35 tests)
  - `npm test` (pass, 2 protocol vectors plus 79 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`;
    missing `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`,
    and `anchor`)
- Real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 Solana deposit-claim observer account pass-through

- Updated `services/bridge-validator/localnet-solana-deposit-claim-bridge.mjs`
  so the prepared localnet request includes the derived deposit-claim PDA and
  Mint account used by the Solana transaction plan.
- Updated `services/bridge-validator/solana-deposit-claim-submitter.mjs` so
  those per-operation accounts are persisted in the prepared journal entry,
  checked during retry conflict detection, and passed to the finalized claim
  observer.
- Extended
  `services/bridge-validator/tests/localnet-solana-deposit-claim-bridge.test.mjs`
  with a real `SolanaDepositClaimObserver` fixture proving the localnet bridge
  observes the derived per-operation accounts.
- Source commit: `dab03e8696267fa98488f312e1f2158df51dc815`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34322782563`
- CI status: `PASS`
- Local test status:
  - `npm run test:bridge-validator` (pass, 36 tests)
  - `npm test` (pass, 2 protocol vectors plus 80 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`;
    missing `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`,
    and `anchor`)
- Real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 automatic pipeline to localnet Solana bridge/observer integration

- Extended
  `services/bridge-validator/tests/automatic-deposit-pipeline.test.mjs` with a
  source-level integration test that connects the automatic deposit pipeline to
  `LocalnetSolanaDepositClaimBridge`.
- The test exercises the real localnet Solana deposit-claim bridge, durable
  submitter, and `SolanaDepositClaimObserver` using fake loopback RPC fixtures.
- It verifies automatic completion without a per-transfer KingPepe Team
  approval state, one Solana submission, finalized claim observation, exact
  minted amount, and ledger mint accounting.
- Source commit: `3b5c0e873a37bafb24ac69dd1cadc1761d921d4f`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34324525303`
- CI status: `PASS`
- Local test status:
  - `npm run test:bridge-validator` (pass, 37 tests)
  - `npm test` (pass, 2 protocol vectors plus 81 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`;
    missing `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`,
    and `anchor`)
- Real Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 automatic pipeline Native plus Solana adapter integration

- Source commit: `2f0d2dd63d1ec096044c8f07032e8b12a3cbd998`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34326646202`
- CI status: `PASS`
- Added a source-level integration test that runs the automatic
  Native-to-Solana deposit pipeline through:

  - real Native reserve-sweep relayer and verifier adapter classes;
  - real software FROST A+B signing runtime;
  - real project attestation combination;
  - real localnet Solana deposit-claim bridge, durable submitter, and finalized
    claim observer classes.
- The test uses fake loopback RPC fixtures for Native REGTEST and Solana
  localnet because the required daemon/toolchain executables are not present in
  the current environment.
- Local test status:
  - `npm run test:bridge-validator` (pass, 38 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 82 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - staged and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`;
    missing `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`,
    and `anchor`)
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 adapter-journal restart retry coverage

- Source commit: `6fa2a41bc29d46c1a24308a6a46ca1b5df99e9a1`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34328709477`
- CI status: `PASS`
- Added source-level integration coverage for a restart after Native sweep
  broadcast but before reserve finality.
- The test uses file-backed deposit, Native reserve-sweep, and Solana claim
  journals together outside the repository checkout.
- First pass broadcasts the local Native sweep and stops at reserve finality.
- Restart pass reuses persisted journals, avoids a second Native broadcast,
  waits for finalized reserve evidence, submits one Solana claim, and mints
  once.
- Local test status:
  - `npm run test:bridge-validator` (pass, 39 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 83 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - staged and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`;
    missing localnet executables)
  - real daemon-backed Native-to-Solana E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 reusable local E2E infrastructure harness

- Source commit: `f4372d9276946ebe7a8dad1d2903f60821dcaae8`
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34330731668`
- CI status: `PASS`
- Refactored `scripts/local-e2e-bootstrap.mjs` so the local-only bootstrap
  path exposes a reusable harness for the future real Native-to-Solana daemon
  flow.
- The harness performs the same readiness, version, Anchor build, disposable
  Solana local-validator startup, disposable KingPepe REGTEST startup, and
  health checks before calling an injected flow callback.
- Services remain active while the callback runs and are stopped afterward.
- Callback failure is reported as `LOCAL_E2E_FLOW_FAILED` and does not claim a
  local E2E pass.
- Local test status:
  - `npm run test:local-e2e-readiness` (pass, 15
    readiness/orchestration/bootstrap/harness tests)
  - `npm test` (pass, 2 protocol vectors plus 85 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - staged and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`;
    missing localnet executables)
  - real daemon-backed Native-to-Solana E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 mint-authority real Solana PDA correction

- Replaced the bridge manager's prior SHA-256 mint-authority model with
  `Pubkey::find_program_address`.
- Added fixed mint-authority PDA seeds and a derivation helper that returns the
  bump for later account initialization and CPI signer checks.
- Removed the bridge manager's direct `sha2` dependency and updated
  `solana/Cargo.lock`.
- Added a regression test that reconstructs the PDA with
  `Pubkey::create_program_address` and the returned bump.
- Source commit: `94da519e7a50ea6692c445cfd307beb0fa491347`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34299827083`
- CI status: `PASS`
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 08 fail-closed Solana entrypoint shell update

- Added deterministic non-production localnet Program IDs in `solana/Anchor.toml`.
- Added `solana_program` entrypoint shells for `kingpepe-bridge` and
  `kingpepe-transceiver`.
- Both entrypoint shells intentionally fail closed:
  - empty instruction data is rejected;
  - tag `0` reports the economic ABI as disabled;
  - all other tags are unsupported.
- Added `no-entrypoint` features so host tests can link both programs without
  duplicate Solana entrypoint symbols.
- Expanded `solana/Cargo.lock` for the Solana dependency graph and compatible
  transitive pins under the repository toolchain.
- Updated the local E2E readiness gate to distinguish:
  - missing local infrastructure;
  - fail-closed entrypoint shells;
  - future economic ABI readiness.
- Source commit: `09d314aa1755bc5e07549ad5d919df93cebaf497`
- Corrective formatting commit: `7eafd8a38d346dcb018005a7357a0012a84b0e0c`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34295554332`
- CI status: `PASS`
- Real daemon-backed Native-to-Solana E2E: `BLOCKED / NOT_RUN`

## Phase 04 local implementation

- Determined from read-only recovery material that the Native signing path is Bitcoin-style Taproot/BIP340 with P2TR custody scripts and 8-decimal atomic Native units.
- Added a pinned Node runtime dependency on `@noble/curves` `2.3.0`.
- Implemented secp256k1 Taproot/BIP340-compatible software FROST for exactly `KINGPEPE_FROST_A` + `KINGPEPE_FROST_B`.
- Implemented two-party DKG without a coordinator private share.
- Implemented per-signer authorization checks bound to a validated operation snapshot.
- Implemented file-backed signer state with source-tree boundary rejection.
- Implemented durable nonce reservation before commitments and nonce tombstones before signature shares.
- Added Node tests proving:
  - A+B produce one aggregate signature verified by independent BIP340 verification.
  - A alone cannot complete signing.
  - B absence does not trigger a weaker threshold.
  - The coordinator alone cannot be constructed as a signer substitute.
  - Wrong sighash, epoch, deployment, recipient, amount, fee, change script, and change amount are rejected before signing.
  - Signing retry is idempotent and does not allocate a second economic signature.
  - Runtime state inside the repository is rejected.
- Commit: `3494ebf70f9a432bd786ea17ca73a1177d8bf66d`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34281044175`
- CI status: PASS

## Phase 05 local implementation

- Replaced Solana program placeholders with bridge manager and transceiver boundary logic.
- Added configured transceiver receipts with exact message-domain binding.
- Required two distinct authorized attestation identities at the transceiver boundary.
- Added bridge initialization protections, zero initial supply enforcement, PDA mint-authority derivation, freeze-authority rejection, mint/native decimal matching, wrong-account rejection, and account-aliasing rejection.
- Added deposit receipt consumption and replay protection.
- Added atomic withdrawal record creation tied to a matching BurnChecked model.
- Added Mainnet-disabled behavior.
- Added tests for initialization, wrong accounts, missing receipts, replay, direct burns without bridge records, epoch rotation preserving markers, attester threshold/duplicate rejection, receipt consumption, and wrong transceiver domains.
- Implementation commit sequence:
  - `7ddacbc72694aaac7da3900dff34cccbde703536`
  - `a78156c60beb3c76eaf81d9af4314d640ce3e220`
  - `58310b908590a77342db599b7845da4be9cebe32`
  - `164e096e58b4b453d857aec367e1a83dbaef1c97`
  - `6216b9aa9bca6b91d17dc7c91f38222c09a5e049`
  - `f860c47d68a682545112ab7f152e681703d6ab6d`
  - `d914d9148c4cbe7ef845955f19feb9c753823ea6`
  - `dd9c64df3289b48ae0d9250d0e1ae2ba3b0b5b1f`
  - `7e8212b1ca80ccbcdafbad1c72422bb0eafaa300`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34285305630`
- CI status: `PASS`

## Phase 06 local implementation

- Added `kingpepe_native_proof` with reviewed KingPepe Native mainnet/regtest parameters, 8-decimal atomic units, SHA256d header parsing, compact targets, PoW, difficulty, chainwork, Merkle proofs, transaction parsing, UTXO observation checks, and temporary-deposit validation.
- Added `kingpepe_native_reserve` with canonical reserve sweep validation, exact fee/allocation accounting, temporary-deposit non-mintability, and single-use allocation consumption.
- Added `kingpepe_native_recovery` with CSV maturity, wrong-network, spent-output, mint/sweep conflict, duplicate recovery, fee, and dust checks.
- Added CI gates for native proof/reserve/recovery formatting, clippy, locked check, and tests.
- Implementation commit sequence:
  - `37876fa26d9dfd447095d5a9dee95b3faa471725`
  - `4547b6df190ea4dc4334135d9383560c3c272572`
  - `6ef112651f40cf13f81dffe3eee44290f67bada3`
  - `836b8e62e2c87fe8b2d3df48f7fc54466206b646`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34287906641`
- CI status: `PASS`

## Phase 07 local implementation

- Added executable shared canonical-message helpers for service-side decoding,
  operation ID validation, digesting, and exact integer field handling.
- Added Ed25519 project attestation service logic for `ATTESTER_A` and
  `ATTESTER_B`.
- Attesters sign the canonical binary bridge message bytes only after Native
  evidence, finality, reserve transition, mint-credit, domain, amount,
  recipient, policy epoch, key epoch, and evidence-digest checks pass.
- Added two-of-two attestation combination checks that reject one signer,
  duplicate signers, unauthorized public keys, and altered canonical bytes.
- Extended the transceiver model with exact Solana Ed25519 verifier program ID
  checks, bounded instruction offsets, canonical message-byte binding, and
  duplicate-attester rejection.
- Added Solana withdrawal observation logic for finalized withdrawal records,
  burn consistency, Mint/Token Program/PDA authority checks, program binary and
  upgrade-authority identity checks, and `HARD_STOP` on unauthorized changes.
- Added CI steps for attester and Solana observer Node tests on Linux and
  Windows.
- Implementation commit sequence:
  - `baf8ee07b4d7baba1e04b1855a0210a46c9ec57a`
  - `d17ba8fe61d20a88d4206f72d68a010a2d146524`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34290281015`
- CI status: `PASS`

## Phase 08 Native-to-Solana local E2E command runner

- Source status: implemented and CI verified.
- Source commit: `b30420dc11b3f6fe0e5e883b122dfc64c04ab871`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34333170011`
- CI status: `PASS`
- Local tests:
  - `npm run test:local-e2e-readiness`: PASS, 20 readiness/orchestration/bootstrap/runner tests.
  - `npm run local:e2e:native-to-solana`: expected `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING` in the current environment.
- What changed:
  - Added `scripts/local-e2e-native-to-solana.mjs`.
  - Added package script `local:e2e:native-to-solana`.
  - The runner composes the reusable bootstrap harness with local REGTEST user-wallet funding, deposit intent creation, deposit transaction observation, and UTXO/finality checks.
  - Runtime state is constrained to the local E2E run root outside the repository.
  - The runner has no per-transfer KingPepe Team approval state and keeps Mainnet disabled.
  - The runner reports `NOT_RUN_FULL_FLOW_NATIVE_RESERVE_SWEEP_PENDING` until reserve-sweep construction, FROST-backed reserve broadcast, Solana mint submission, and reconciliation are exercised against real local daemons.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 Native-to-Solana deposit evidence validation

- Source status: implemented and CI verified.
- Source commit:
  `48a3bae917b6ddc80dcbd0a8d1e45b28fc1eff49`
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34335394052` PASS.
- Local tests:
  - `npm run test:local-e2e-readiness`: PASS, 22 readiness/orchestration/bootstrap/runner tests.
  - `npm test`: PASS, 2 protocol vectors plus 92 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
- What changed:
  - The local Native-to-Solana runner now validates the local Native source
    snapshot from `getblockchaininfo`.
  - It binds the deposit observation to `getblockhash 0`, the expected REGTEST
    chain name, raw transaction `txid`, exact output, UTXO script, and UTXO
    finality.
  - It computes a deterministic non-secret proof fingerprint from the source,
    deposit output, and UTXO observation.
  - It rejects wrong local Native networks and raw transaction txid mismatch
    before reserve-sweep construction.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 Native-to-Solana unsigned reserve-sweep draft

- Source status: implemented and CI verified.
- Source commit:
  `e836719e920f12dff33bab2a7a546435c26d7739`.
- CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34337778598` PASS.
- Local tests:
  - `npm run test:local-e2e-readiness`: PASS, 23 readiness/orchestration/bootstrap/runner tests.
  - `npm test`: PASS, 2 protocol vectors plus 93 Node tests.
  - `npm run local:e2e:native-to-solana`: expected `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING` in the current environment.
- What changed:
  - The local REGTEST command allowlist now includes `createrawtransaction`.
  - The local Native-to-Solana runner creates a disposable local reserve wallet,
    obtains a local REGTEST reserve address, calculates the exact miner fee and
    canonical reserve amount using integer atomic units, and drafts an unsigned
    reserve sweep.
  - The runner reports `FROST_RESERVE_SWEEP_SIGNING_PENDING` after the unsigned
    draft and does not call `signrawtransactionwithwallet`,
    `sendrawtransaction`, or any per-transfer KingPepe Team approval state.
  - The unsigned transaction is represented in reports by a non-secret
    fingerprint, not by operational signing state.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

## Phase 08 local FROST reserve-sweep witness attachment

- Source status: implemented and CI verified for source commit `a04417a4562f07a3ec1d709361c714e116b4ba0f`.
- CI: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34356317376` PASS.
- What changed:
  - The local Native-to-Solana runner now converts validated Taproot sighash evidence into localnet-only, input-specific FROST reserve-sweep signing intents.
  - Each authorized FROST operation now binds `signingInputIndex`, so A and B authorize the exact Native transaction input they sign.
  - The disposable local FROST custody context retains public package data and outside-repository signer state roots so A and B can be reopened with a narrow reserve-sweep signing policy after deposit evidence is known.
  - The runner signs the deposit input and explicit fee-funding input with real software FROST A+B, attaches key-path Taproot witnesses, and stops before Native broadcast.
  - The automatic deposit pipeline now accepts multi-input reserve sweeps and requires at least one explicit fee-funding input when Native miner fee is nonzero.
- Local tests run before source commit:
  - `node --test scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS, 11 tests.
  - `node --test services/bridge-validator/tests/native-reserve-sweep-signing-intent.test.mjs`: PASS, 5 tests.
  - `node --test native/frost/tests/frost_runtime_node.test.mjs`: PASS, 5 tests.
  - `node --test services/bridge-validator/tests/automatic-deposit-pipeline.test.mjs`: PASS, 13 tests.
  - `npm test`: PASS, 2 protocol vectors plus 104 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - WSL Solana Rust workspace tests: PASS, 52 tests.
  - WSL Native FROST Rust tests: PASS, 7 tests.
  - WSL Native proof Rust tests: PASS, 8 tests.
  - WSL Native reserve Rust tests: PASS, 4 tests.
  - WSL Native recovery Rust tests: PASS, 3 tests.
  - `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real daemon-backed Native broadcast/finality, Solana mint submission, and reconciliation remain `BLOCKED / NOT_RUN`.

## Phase 08 local reserve-sweep broadcast and finality validation

- Source status: implemented and CI verified for source commit `81797c2930b74598ed49bc451aef38f1571f01a4`.
- CI: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34358737395` PASS.
- What changed:
  - The local Native-to-Solana runner now broadcasts the already FROST-signed, witness-attached reserve sweep with `sendrawtransaction` when local REGTEST infrastructure is available.
  - The runner mines local finality blocks, observes the finalized reserve-sweep transaction, and validates exact txid, input outpoints, reserve output amount, reserve script, and confirmation depth.
  - The runner now advances to `LOCAL_NATIVE_RESERVE_SWEEP_FINALIZED` and stops at `SOLANA_MINT_PENDING`.
  - The runner still does not claim a full E2E pass until Solana mint submission, finalized mint observation, and reconciliation execute against real local daemons.
- Local tests run before source commit:
  - `node --check scripts/local-e2e-native-to-solana.mjs`: PASS.
  - `node --check scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS.
  - `node --test scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS, 12 tests.
  - `npm test`: PASS, 2 protocol vectors plus 105 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - WSL Solana Rust workspace tests: PASS, 52 tests.
  - WSL Native FROST Rust tests: PASS, 7 tests.
  - WSL Native proof Rust tests: PASS, 8 tests.
  - WSL Native reserve Rust tests: PASS, 4 tests.
  - WSL Native recovery Rust tests: PASS, 3 tests.
  - `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real daemon-backed Solana mint submission, finalized mint observation, and reconciliation remain `BLOCKED / NOT_RUN`.

## Phase 08 localnet Solana deposit-claim bundle plan

- Source status: implemented and CI verified for source SHA
  `b4154371514cb542a847c777a1608907f1b77e46`; CI run
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34362568530`
  PASS.
- What changed:
  - Added an additive bundled localnet deposit-claim transaction planner that places both Ed25519 attestation verifier instructions, the `kingpepe-transceiver` receipt-verification instruction, and the `kingpepe-bridge` claim/mint instruction in one signed Solana transaction message.
  - The localnet bridge adapter now uses the bundled plan for actual `submitDepositClaim` calls, so real submission no longer depends on a pre-existing verified receipt account.
  - The helper used for read-only PDA/observer-account planning still permits legacy one-instruction planning when attestations are intentionally absent.
  - The bundle validates exactly two distinct project attestations over the canonical message before transaction construction and rejects missing, duplicate, or mutated attestations.
- Local tests run so far:
  - `node --test services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`: PASS, 8 tests.
  - `node --test services/bridge-validator/tests/localnet-solana-deposit-claim-bridge.test.mjs services/bridge-validator/tests/solana-deposit-claim-submitter.test.mjs services/bridge-validator/tests/automatic-deposit-pipeline.test.mjs services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`: PASS, 34 tests.
  - `npm test`: PASS, 2 protocol vectors plus 108 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - WSL Solana Rust workspace tests: PASS, 52 tests.
  - WSL Native FROST Rust tests: PASS, 7 tests.
  - WSL Native proof Rust tests: PASS, 8 tests.
  - WSL Native reserve Rust tests: PASS, 4 tests.
  - WSL Native recovery Rust tests: PASS, 3 tests.
  - `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real local-validator execution still needs localnet account creation/initialization, funded disposable fee payer, SPL Mint setup, token account setup, finalized claim observation, and reconciliation before the full Native-to-Solana E2E can be marked PASS.

## Phase 08 Solana local-validator PDA allocation path

- Source status: implemented and CI verified for source SHA
  `edb184c5aff7f555110f305f3f050fb861294e13`; CI run
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34366351989`
  PASS.
- What changed:
  - `kingpepe-transceiver` can now allocate its config and verified-receipt PDA accounts through signed System Program CPI when a payer and System Program account are supplied.
  - `kingpepe-bridge` can now allocate its bridge-state and deposit-claim PDA accounts through signed System Program CPI when a payer and System Program account are supplied.
  - The bundled localnet Solana deposit-claim transaction plan now carries the fee payer and System Program accounts into the transceiver and bridge instructions, so real local-validator execution is not blocked by nonexistent PDA accounts.
  - Existing preallocated-account unit tests remain supported for source-level execution tests.
- Local tests run so far:
  - `node --test services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`: PASS, 8 tests.
  - `npm test`: PASS, 2 protocol vectors plus 108 Node tests.
  - `wsl.exe --cd /mnt/d/KingPepe-Native-Solana_Bridge/solana bash -lc "cargo test --locked --workspace"`: PASS, 53 Rust tests/doc-tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github/scripts/guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - `npm run local:e2e:native-to-solana`: expected `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
  - Local `cargo fmt` and `cargo clippy`: NOT_RUN locally because this WSL environment has `cargo` but not `rustup`, `rustfmt`, or `clippy`. GitHub Actions installs and runs the pinned Rust quality components.
- CI notes:
  - Source commit `0542b04dac5db0807b66f028e6006741c1efea06` failed Linux `cargo fmt --check --all`.
  - Corrective commit `edb184c5aff7f555110f305f3f050fb861294e13` applied the exact Rust formatting changes and passed the full CI workflow.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - Real local-validator execution, funded disposable fee payer, SPL Mint setup, token account setup, finalized claim observation, and reconciliation remain `BLOCKED / NOT_RUN`.

## Phase 08 localnet Solana setup transaction plan

- Source status: implemented, pushed, and CI verified for source commit `37d02cb7646ec5af53751be598d3974408a0662e`.
- CI evidence: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34370095662`, PASS.
- What changed:
  - Added a localnet-only Solana setup transaction planner that creates a disposable KPEPE SPL Mint with zero initial supply, PDA mint authority, and no freeze authority.
  - Added localnet recipient SPL token-account creation/initialization so the deposit-claim mint path has a real target token account during local E2E execution.
  - Added transceiver config and bridge state PDA initialization instructions using the current on-chain ABI account order and optional payer/System Program allocation path.
  - Requires explicit rent lamport values and injected runtime signers for the fee payer, mint account, and recipient token account; no keypair files or operational state are generated in the repository.
- Local tests run so far:
  - `node --check services/bridge-validator/localnet-solana-setup-plan.mjs`: PASS.
  - `node --test services/bridge-validator/tests/localnet-solana-setup-plan.test.mjs`: PASS, 5 tests.
  - `node --test services/bridge-validator/tests/*.test.mjs`: PASS, 52 tests.
  - `npm test`: PASS, 2 protocol vectors plus 113 Node tests.
  - `python .github/scripts/guardrails.py`: PASS.
  - WSL Solana Rust workspace tests: PASS, 53 Rust tests/doc-tests.
  - Native Rust crate tests: PASS, 22 tests across FROST, proof, reserve, and recovery.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
  - The planner has not been submitted to a real Solana local validator yet.

## Phase 08 localnet Solana setup submitter and runner handoff

- Source status: implemented, pushed, and CI verified for source commit
  `da3696023be06776ccad7435af4fb8c08df90145`.
- CI evidence:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34374335134`,
  PASS.
- Corrective CI evidence:
  - Evidence commit `bac0b69abf60832d58c150f20ce86d63bdea7575` failed CI run
    `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34375362002`
    because a randomized attestation-mutation test occasionally reused the
    same final signature byte.
  - Corrective commit `61267f6e549736e6eef761bb829e00478e9fe0e9` made the
    mutation deterministic and passed CI run
    `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34376065307`.
- What changed:
  - Added a localnet-only Solana setup submitter that queries rent exemption,
    requests disposable local-validator airdrop funding, submits the signed
    setup transaction, waits for finalized signatures, and verifies Mint,
    recipient token account, bridge state PDA, and transceiver config PDA
    account ownership/allocation.
  - Extended the loopback-only Solana RPC boundary with setup-specific
    `getAccountInfo`, `getMinimumBalanceForRentExemption`, and `requestAirdrop`
    helpers while retaining method allowlisting.
  - Wired the local Native-to-Solana runner to create disposable Solana setup
    identities before Native FROST signing, so signer policy binds to the exact
    local KPEPE Mint for that run.
  - The runner now advances from finalized Native reserve sweep to finalized
    local Solana setup, then stops honestly at `SOLANA_DEPOSIT_CLAIM_PENDING`.
    It does not claim complete local E2E success.
- Local tests run so far:
  - `node --check services\bridge-validator\localnet-solana-setup-submitter.mjs`: PASS.
  - `node --check services\bridge-validator\solana-deposit-claim-submitter.mjs`: PASS.
  - `node --check scripts\local-e2e-native-to-solana.mjs`: PASS.
  - `node --check scripts\tests\local-e2e-native-to-solana.test.mjs`: PASS.
  - `node --test services\bridge-validator\tests\localnet-solana-setup-submitter.test.mjs`: PASS, 5 tests.
  - `node --test scripts\tests\local-e2e-native-to-solana.test.mjs`: PASS, 13 tests.
  - `node --test services\bridge-validator\tests\*.test.mjs`: PASS, 57 tests.
  - `npm test`: PASS, 2 protocol vectors plus 119 Node tests.
  - WSL Solana Rust workspace tests: PASS, 53 Rust tests/doc-tests.
  - WSL Native Rust crate tests: PASS, 22 tests across FROST, proof, reserve,
    and recovery.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github\scripts\guardrails.py`: PASS.
  - JSON manifest parse checks: PASS.
  - `git diff --check`: PASS.
  - `npm run local:e2e:native-to-solana`: expected
    `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`; no localnet commands started.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
  - Real local-validator account creation/finality, Solana deposit-claim
    submission, finalized mint observation, and reconciliation remain
    `BLOCKED / NOT_RUN`.

## Phase 08 Native-to-Solana deposit-claim runner integration

- Source status: implemented, pushed, and CI verified for source commit
  `5886301bb297c6245eeac58f5bd873c9f1184cc1`.
- CI evidence:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34379702330`,
  PASS.
- What changed:
  - The local Native-to-Solana runner now derives the canonical Solana
    deposit-claim operation ID before FROST signing, so the FROST reserve-sweep
    policy and the Solana claim message bind to the same economic operation.
  - After finalized Native reserve sweep and finalized localnet Solana setup,
    the runner builds a canonical deposit-credit message, obtains two distinct
    project attestations from disposable localnet attester identities, submits
    through the localnet Solana deposit-claim bridge boundary, observes a
    finalized mint result from the claim boundary, and reconciles canonical
    reserve, minted supply, and liabilities.
  - Runtime-only fee-payer and attester signer handles stay inside the local
    setup context and are omitted from public runner reports.
  - Reconciliation uses exact integer accounting: canonical reserve,
    minted supply, authorized unminted credits, unsettled liabilities,
    coverage requirement, surplus, project fee, and Native miner fee.
  - The source tests verify no per-transfer KingPepe Team approval state and no
    signer handles in the public deposit-claim request.
- Local tests run:
  - `node --check scripts\local-e2e-native-to-solana.mjs`: PASS.
  - `node --check scripts\tests\local-e2e-native-to-solana.test.mjs`: PASS.
  - `node --test scripts\tests\local-e2e-native-to-solana.test.mjs services\bridge-validator\tests\localnet-solana-deposit-claim-bridge.test.mjs services\bridge-validator\tests\solana-deposit-claim-submitter.test.mjs`: PASS, 26 tests.
  - `node --test services\bridge-validator\tests\*.test.mjs`: PASS, 57 tests.
  - `npm test`: PASS, 2 protocol vectors plus 119 Node tests.
  - `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
  - `python .github\scripts\guardrails.py`: PASS.
  - `git diff --check`: PASS.
  - WSL Solana Rust workspace tests: PASS, 53 Rust tests/doc-tests.
  - WSL Native Rust crate tests: PASS, 22 tests across FROST, proof, reserve,
    and recovery.
  - Staged and outgoing secret scans: PASS.
  - `npm run local:e2e:native-to-solana`: expected
    `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`; no localnet commands started.
- Current blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`.
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
  - Real daemon-backed KingPepe REGTEST plus Solana local-validator
    Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.
