# KingPepe Native - Solana Bridge Task Status

Latest verified increment: `7640dedcbadd9c31c120b3ebc5b7231eaa36cde2`, message
`feat(phase-08): validate Native CSV recovery scripts on regtest`, pushed to
PRIVATE origin/main. All four CI jobs PASS:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34445169540.
It passed 152 Node tests + two vectors, 58 Solana Rust + 26 Native Rust tests,
two SBF builds, the real deposit, 17 security checks and six CSV recovery checks.

Current Phase 08 increment: integrate the committed user-recoverable temporary
script into the real automatic deposit flow; obtain only a Native-user public
key, reconstruct policy in each authorizing role, use real FROST BIP342 sweep
signatures, finalize a separate canonical reserve, and verify actual witness
signatures before both attestations and mint. Locally tested; its commit/private
push/exact-SHA CI are pending. Windows and WSL: 155 Node tests + two vectors PASS.
WSL: 58 Solana Rust + 26 Native Rust tests, fmt/clippy, two SBF builds PASS.
Real REGTEST/local-validator deposit + 22 security checks + six CSV recovery
checks PASS; reserve/supply each 100000000 atomic. No per-transfer approval.
An outdated orchestration call-order assertion was corrected for the new public
key calls and early genesis check; full reruns pass. No gate was weakened.
Current source and 144 existing commits scan clean. Provenance remains 164 files,
none added/deleted/moved; no new dependencies or third-party source imports.
Audits retain the unmaintained bincode warning; no known vulnerabilities found.

Next: publish/verify this increment, then test competing sweep/recovery and reorg
cases, implement offline PSBT support, and close remaining source/account/crash/
liability-persistence gaps before Phase 09. Mainnet remains DISABLED.

The following entries describe earlier checkpoints, not the newer tree.

Raw-evidence increment `ef15e6e648935044edbb4b09874119bc6c823fc7`, message
`fix(phase-08): validate raw Native evidence before signing and attesting`, pushed
to PRIVATE origin/main; four CI jobs PASS:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34442633781.
The tested source passed the real deposit and 17 security checks.
Recovery-script construction, BIP342 sighashes, mixed witness attachment and
unsigned offline preparation passed local validation and the commit/private push/
exact-SHA CI recorded above. Eight new unit tests and six actual
Native-node CSV recovery checks pass. Full rerun: 152 Node tests + two vectors
on Windows and WSL; 58 Solana Rust + 26 Native Rust tests, fmt/clippy and two SBF
builds in WSL; automatic deposit + 17 security checks pass, reserve/supply each
100000000 atomic. An initial CLI null-result parsing failure was corrected using
the bounded JSON-RPC UTXO adapter and a fresh complete run passed. The known
unmaintained bincode warning remains reported; all five Rust audits and npm audit
find zero vulnerabilities. Declared dependency licenses pass. Current source and
143 existing commits scan clean; staged/outgoing scans must precede publication.
Provenance: 160 -> 164 files, four original code/test additions, none deleted/moved.
At that earlier checkpoint no normal-flow recovery, FROST script-path sweep or
race/reorg/PSBT integration was claimed. The newer integration is recorded above.

Historical Phase 08 increment `33b622638617258660019302b6db8d8868e7093f`,
`fix(phase-08): bind attestations to configured native domain`, pushed to PRIVATE
origin/main; four CI jobs PASS:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34440113182.
It executed the real deposit and six security checks.

Completed raw-evidence increment: required bounded Rust raw-header/Merkle validation
before each FROST participant and attester authorization, independently recomputed
Native transaction/sighash policy, finalized sweep/UTXO checks, digest-bound claims,
bounded RPC streams, and negative tests. Latest full local validation: 144 Node
tests + two vectors on Windows and WSL; 58 Solana Rust + 26 Native Rust tests in
WSL; two SBF builds, real automatic deposit and 17 real security checks PASS.
Current source and 142 existing commits passed secret scanning; 160 provenance
entries cover the new tree. Dependencies unchanged; audits retain the reported
unmaintained bincode warning. Its commit/push/exact-SHA CI are recorded above.
No production data or identities were provisioned or published.

Next: publish and verify the recovery-script increment, integrate the recoverable
deposit/sweep path, then add races, account/source and real failure/restart tests.
Same-process local signer objects are not deployed isolated services; shared
validating-node UTXO observations are not independent cryptographic UTXO proofs.
Phase 08 remains incomplete; Phase 09 is NOT_STARTED; Mainnet is DISABLED.

Earlier Phase 08 increment records follow; their counts are historical.

Phase 08 security increment `95d00b19026dd56320cc012f580802bff6300fc0`, message
`fix(phase-08): authorize mint enrollment and prevent backing replay`, pushed to
PRIVATE origin/main and passed all four jobs:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34439119240.
CI executed the deposit and three real-validator replay/retry/supply checks.
The subsequent domain-binding increment and its CI are recorded above.

Phase 08 integration source `bfc704c561fcf47e9625c7aff6c8bb72b1997ba7` pushed;
CI https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34437324660
failed because the SBF job selected the root Native Cargo toolchain for Solana
metadata. Corrective commit `507c94f39b1f91630baf22824ca4094e3f99d5b6`, message
`fix(ci): select Solana host toolchain for SBF metadata`, pushed to PRIVATE
origin/main and passed all four jobs at
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34437591936.
The Linux job executed the real deposit flow. No security gate was disabled.

Current handoff (2026-09-10), Phase 08: real Native-to-Solana local happy path
passes with Agave 4.2.2 and node-accepted FROST A+B. Finalized Native reserve
and actual SPL Mint supply both equal 100000000 atomic units. Two packet-sized
receipt/claim transactions replace the invalid oversized bundle. Mainnet stays
disabled. The current security increment adds Mint-signed initial enrollment
and a permanent Native-outpoint backing marker. Real-validator checks pass for
idempotent completed retry, a newly signed duplicate-backing preflight rejection,
and unchanged Mint supply. Its private push and CI are recorded above.

Preceding source `cb7b44544f8c3935ddc8065eee5d67ee220afee2`, message
`fix(phase-08): isolate pinned SBF builds and validate real native sweep`, was
pushed to PRIVATE origin/main; all four jobs passed at
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34432312954.

At that earlier checkpoint: 134 Node tests + 2 vectors on Windows and WSL; 58 Solana
Rust tests + 22 Native supporting-crate tests in WSL. No failures/skips in these
suites. All five Rust dependency audits report zero vulnerabilities and one
unmaintained dependency warning in the Solana graph; npm reports zero.
See `docs/development-status.md` for scope, remaining Phase 08 recovery/evidence/
account/source/failure-test gaps and the next step. Phase 09 has not started.

The records below are historical; their test totals and blockers are not current.

- 2026-09-07: Phase 01 completed and published:
  - Privacy status verified; repository `kingpepe2/KingPepe-Native-Solana_Bridge` is PRIVATE.
  - Commit: `00c4681` and push to `origin/main`.
  - CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34126275605`
  - CI status: `success` (no build/publish blockers reported)
- 2026-09-07: Phase 02 implementation pushed:
  - Added structural scaffolding directories and non-empty policy-safe placeholders for all planned phase-02 areas.
  - Pinned workspace and package dependency versions.
  - Updated `UPSTREAM-REFERENCES.json` and `docs/architecture/ntt-comparison.md`.
  - Updated `PROVENANCE.json` to cover all tracked files (79 entries after corrective lockfile addition).
- 2026-09-09: Phase 02 corrective CI fix prepared:
  - Prior phase-02 CI run for `7e33100` failed in native runtime dependency compilation.
  - Removed the phase-02 Ed25519 placeholder dependency that pulled in the incompatible `curve25519-dalek` graph.
  - Added `solana/Cargo.lock` and enforced locked Rust checks in CI.
  - Updated provenance for the new lockfile.
  - Native runtime remains a phase-02 scaffold only; real Native-compatible FROST is not claimed and remains Phase 04 work.

## Phase 02 implementation summary

- PHASE: `02`
- commit: `7e3310027b3dbe4278d2e98b51adf57bffff7ddc`
- corrective commit: `218cff1dacea2a2f6ba0564fc49593c85b3f4f9f`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34276946620`
- CI status: PASS
- tests:
  - `python .github/scripts/guardrails.py` (pass)
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cargo check --locked --manifest-path native/frost/Cargo.toml` (pass under WSL)
  - `cargo test --locked --manifest-path native/frost/Cargo.toml` (pass under WSL, 7 tests)
- blockers:
  - No Phase 02 blockers remain.
  - Real Native-compatible FROST remains Phase 04 work and is not claimed by Phase 02.
- next:
  - Start Phase 03 with canonical messages and exact accounting primitives.

## Phase 03 implementation summary

- PHASE: `03`
- commit: `1b95cf0`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34278735928`
- CI status: PASS
- tests:
  - `python .github/scripts/guardrails.py` (pass)
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace` (pass under WSL, 23 tests)
  - `node solana/ts/scripts/verify-vectors.mjs` (pass, 2 vectors)
  - `cargo check --locked --manifest-path native/frost/Cargo.toml` (pass under WSL)
  - `cargo test --locked --manifest-path native/frost/Cargo.toml` (pass under WSL, 7 tests)
- changed:
  - Implemented canonical binary message encoding, operation ID derivation, fixed deployment identity layout, and strict decode validation.
  - Implemented automatic lifecycle states without per-transfer approval.
  - Implemented exact reserve/liability accounting primitives.
  - Added Rust and Node golden-vector verification.
- blockers:
  - No Phase 03 implementation blockers remain.
  - Real Native-compatible FROST remains Phase 04 work.
- next:
  - Start Phase 04 by determining KingPepe Native signature requirements from available source/reference material.

## Phase 04 local implementation summary

- PHASE: `04`
- commit: `3494ebf70f9a432bd786ea17ca73a1177d8bf66d`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34281044175`
- CI status: PASS
- tests:
  - `npm ci --ignore-scripts` (pass)
  - `npm test` (pass, 2 protocol vectors and 5 FROST Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace` (pass under WSL, 24 Rust tests)
  - `cargo check --locked --manifest-path native/frost/Cargo.toml` (pass under WSL)
  - `cargo test --locked --manifest-path native/frost/Cargo.toml` (pass under WSL, 7 Rust tests)
- changed:
  - Added secp256k1 Taproot/BIP340-compatible software FROST using pinned `@noble/curves` `2.3.0`.
  - Added exact A+B two-party DKG and aggregate-signature verification.
  - Added per-signer policy checks bound to validated operation snapshots.
  - Added file-backed signer state that rejects source-tree runtime state roots.
  - Added nonce reservation and tombstone checks.
  - Updated CI to run locked Node install, audit, and FROST tests.
- blockers:
  - No Phase 04 implementation or CI blockers remain.
  - Full Native node transaction acceptance remains a later local end-to-end phase.
- next:
  - Start Phase 05 Solana Bridge Manager and Transceiver implementation.

## Phase 05 local implementation summary

- PHASE: `05`
- commit: `7e8212b1ca80ccbcdafbad1c72422bb0eafaa300`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34285305630`
- CI status: `PASS`
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace` (pass under WSL, 35 Rust tests)
  - `npm test` (pass, 2 protocol vectors and 5 FROST Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `cargo test --locked --manifest-path native/frost/Cargo.toml` (pass under WSL, 7 Rust tests)
  - local `cargo fmt` / `cargo clippy` (NOT_RUN; local WSL Cargo 1.75 lacks the subcommands)
- changed:
  - Implemented bridge manager initialization, mint binding, PDA authority checks, freeze-authority rejection, account validation, receipt consumption, replay protection, and withdrawal recording.
  - Implemented transceiver domain checks, two-attester threshold checks, verified-message receipts, and receipt consumption protection.
  - Kept Mainnet activation disabled and documented that SBF/Anchor deployment binding remains later work.
  - Added Linux CI Rust formatting and clippy gates for the Solana and native Rust workspaces.
- blockers:
  - No Phase 05 implementation or CI blockers remain.
  - Ed25519 instruction parsing, Native validation, local validator flows, and deployment manifests remain later phases.
- next:
  - Start Phase 06 Native proof/reserve/recovery implementation.

## Phase 06 local implementation summary

- PHASE: `06`
- commit: `836b8e62e2c87fe8b2d3df48f7fc54466206b646`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34287906641`
- CI status: `PASS`
- tests:
  - `cargo test --locked --manifest-path native/proof/Cargo.toml` (pass under WSL, 8 Rust tests)
  - `cargo test --locked --manifest-path native/reserve/Cargo.toml` (pass under WSL, 3 Rust tests)
  - `cargo test --locked --manifest-path native/recovery/Cargo.toml` (pass under WSL, 3 Rust tests)
- changed:
  - Implemented Native header, PoW, difficulty, chainwork, transaction, Merkle, UTXO, and deposit validation primitives.
  - Implemented reserve sweep transition checks and once-only mint-credit accounting.
  - Implemented temporary-deposit recovery eligibility checks.
  - Added CI coverage for the new Phase 06 crates.
- blockers:
  - No Phase 06 implementation or CI blockers remain.
  - Live KingPepe regtest node integration, full transaction broadcasting, Solana observation, local E2E, Devnet, production configuration, and external review remain later phases.
- next:
  - Start Phase 07 attestation and Solana observation.

## Phase 07 local implementation summary

- PHASE: `07`
- commit: `d17ba8fe61d20a88d4206f72d68a010a2d146524`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34290281015`
- CI status: `PASS`
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace` (pass under WSL, 38 Rust tests)
  - `npm test` (pass, 2 protocol vectors, 5 FROST Node tests, 5 attester tests, 7 Solana observer tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - local `cargo fmt` / `cargo clippy` (NOT_RUN; local WSL has Cargo but not `rustup`, `rustfmt`, or `clippy`)
- changed:
  - Implemented Ed25519 project attestation service logic with A+B threshold checks.
  - Implemented transceiver Ed25519 verifier instruction parsing and canonical message binding.
  - Implemented Solana finalized withdrawal observation and program/authority hard-stop checks.
  - Added Linux and Windows CI steps for Phase 07 service tests.
- blockers:
  - No Phase 07 implementation or CI blockers remain.
  - Local end-to-end bridge automation, Devnet, production configuration, external review, and activation remain later phases.
- next:
  - Start Phase 08 automatic Native to Solana local end-to-end.

## Phase 08 source-boundary and blocker summary

- PHASE: `08`
- commit: `09e42e6856312a0c617eb9c14a0312012263722a`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34292181114`
- CI status: `PASS`
- local E2E readiness gate commit: `6f22309770f3a2f85c96093bcf8af10b47065f31`
- local E2E readiness gate CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34293107931`
- local E2E readiness gate CI status: `PASS`
- tests:
  - `Get-Command kingpeped kingpepe-cli solana solana-test-validator anchor` (NOT_FOUND on Windows)
  - `command -v kingpeped kingpepe-cli solana-test-validator solana anchor` (NOT_FOUND under WSL)
  - `npm run test:bridge-validator` (pass, 6 automatic deposit pipeline tests)
  - `npm run test:local-e2e-readiness` (pass, 3 readiness-gate tests)
  - `npm run doctor:local-e2e` (reports `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`)
  - Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Implemented the service-side automatic Native-to-Solana deposit pipeline.
  - The pipeline validates Native trust/finality/UTXO evidence, signs reserve
    sweeps with exact FROST A+B through the existing runtime, requires finalized
    canonical reserve evidence before attestation, requires two distinct project
    attestations, submits a single Solana mint claim through an adapter, updates
    exact BigInt accounting, and rejects replay/invalid evidence/quorum loss.
  - Implemented a local E2E readiness gate so boundary models or missing localnet
    executables cannot be reported as a real local E2E pass.
  - Updated CI to include the new bridge-validator and local E2E readiness tests
    on Linux and Windows.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - The environment does not currently provide the KingPepe regtest daemon/CLI or Solana local validator/Anchor tooling needed for the required real local E2E gate.
  - Current Solana crates have deterministic non-production localnet Program IDs and validate-only economic ABI decoding, but Solana economic execution remains disabled.
- next:
  - Provide pinned disposable local KingPepe regtest and Solana local-validator tooling, implement the Solana economic instruction ABI, then continue Phase 08 without claiming an E2E pass until the full automated deposit flow actually runs.

## Phase 08 fail-closed Solana entrypoint shell summary

- PHASE: `08`
- source commit: `09d314aa1755bc5e07549ad5d919df93cebaf497`
- corrective commit: `7eafd8a38d346dcb018005a7357a0012a84b0e0c`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34295554332`
- CI status: `PASS`
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace --all-targets` (pass under WSL, 42 Rust tests)
  - `npm run test:local-e2e-readiness` (pass, 3 readiness-gate tests)
  - `npm run test:bridge-validator` (pass, 6 automatic deposit pipeline tests)
  - GitHub Linux Rust formatting and clippy gates (pass)
  - GitHub Linux and Windows Solana/native/service test gates (pass)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added deterministic non-production localnet Program IDs.
  - Added Solana `solana_program` entrypoint shells for bridge and transceiver.
  - Kept economic instruction processing disabled and fail-closed.
  - Updated the readiness gate to report `SOLANA_PROGRAM_ABI_NOT_READY` instead of treating localnet IDs as placeholders.
  - Expanded the Solana lockfile with the pinned Solana dependency graph.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - `SOLANA_PROGRAM_ABI_NOT_READY`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 with Solana account execution/SPL CPI and disposable localnet infrastructure. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 validate-only Solana ABI summary

- PHASE: `08`
- source commit: `201c5bdc2a2fb65601331b58115e0a7543179e12`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34298518315`
- CI status: PASS
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace --all-targets` (pass under WSL, 44 Rust tests)
  - `npm run test:local-e2e-readiness` (pass, 3 readiness-gate tests)
  - `npm test` (pass, 2 vectors plus 26 Node tests)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - CI Linux `cargo fmt`, `cargo clippy -- -D warnings`, workspace tests, Node tests, and native crate tests (PASS)
  - CI Windows workspace, Node, native FROST/proof/reserve/recovery tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added bridge and transceiver binary instruction decoders.
  - Rejected malformed length, trailing data, noncanonical messages, and duplicate Ed25519 instruction indexes.
  - Kept on-chain economic execution disabled and fail-closed.
  - Updated readiness detection from `ENTRYPOINT_SHELL_ONLY` to `ABI_VALIDATE_ONLY`.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - `SOLANA_PROGRAM_EXECUTION_NOT_READY`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 by implementing account execution and SPL Token CPI, then provide disposable localnet infrastructure. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 mint-authority real Solana PDA correction

- PHASE: `08`
- source commit: `94da519e7a50ea6692c445cfd307beb0fa491347`
- push result: pushed to private `origin/main`
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34299827083`
- CI status: PASS
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace --all-targets` (pass under WSL, 45 Rust tests)
  - `npm test` (pass, 2 vectors plus 26 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - local `cargo clippy`: NOT_RUN locally; this WSL Cargo installation has no `clippy` command
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Replaced the bridge manager's prior SHA-256 mint-authority model with real Solana PDA derivation using `Pubkey::find_program_address`.
  - Exposed the PDA bump for future account initialization and SPL Token CPI signer checks.
  - Removed the bridge manager's direct `sha2` dependency and updated `solana/Cargo.lock`.
  - Added a regression test that reconstructs the PDA using `Pubkey::create_program_address`.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - `SOLANA_PROGRAM_EXECUTION_NOT_READY`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 account execution and SPL Token CPI. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 automatic pipeline Native plus Solana adapter integration

- PHASE: `08`
- source commit: `2f0d2dd63d1ec096044c8f07032e8b12a3cbd998`
- commit message:
  `test(phase-08): connect deposit pipeline to native and solana adapters`
- push result: pushed to private GitHub repository
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34326646202`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 38 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 82 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - staged and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a source-level integration test connecting the automatic
    Native-to-Solana deposit pipeline to real Native reserve-sweep relayer and
    verifier adapter classes.
  - Kept real software FROST A+B signing, two project attestations, localnet
    Solana claim bridge, durable submitter, and finalized claim observer in the
    same automatic test path.
  - Used fake loopback RPC fixtures for Native REGTEST and Solana localnet
    because the required local daemons/toolchain are unavailable.
  - Verified exact reserve/mint accounting, one Native broadcast, one Solana
    submission, finalized observer account checks, and no per-transfer KingPepe
    Team approval state.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment can be
    implemented without falsely reporting a daemon-backed local E2E pass. Do
    not proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 Solana deposit-claim observer

- PHASE: `08`
- source commit: `df49793f0595bb501e83405b79d21215283a1d0a`
- commit message: `feat(phase-08): add solana deposit claim observer`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34316743630`
- CI status: `PASS`
- tests:
  - `npm run test:solana-observer` (pass, 14 tests)
  - `npm test` (pass, 2 protocol vectors plus 69 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `git diff --cached --check` before source commit (pass)
  - targeted changed-file and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (BLOCKED / NOT_RUN; missing localnet executables)
  - `npm run local:e2e:bootstrap` (BLOCKED / NOT_RUN before command execution; missing localnet executables)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a localnet-only Solana deposit-claim observer with loopback-only JSON-RPC access.
  - Decoded finalized bridge deposit-claim account data using the fixed manager account layout.
  - Decoded SPL Mint freeze-authority state for downstream fail-closed policy checks.
  - Rejected substituted deposit-claim account records by matching observed operation ID and message digest to the requested operation.
  - Kept production observation disabled and introduced no production keys, RPCs, Program IDs, Mint identities, or operational state.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment is possible without falsely reporting daemon-backed local E2E success. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 Solana deposit-claim transaction plan

- PHASE: `08`
- source commit: `42a5cdb3bcc60e0be7fb5d2395503f148b6d632f`
- commit message: `feat(phase-08): add solana deposit claim transaction plan`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34318547667`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 30 tests)
  - `npm test` (pass, 2 protocol vectors plus 74 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `git diff --cached --check` before source commit (pass)
  - targeted changed-file and outgoing-range secret-pattern scans (pass)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a localnet Solana deposit-claim transaction-plan builder.
  - Derived bridge state, deposit claim, mint-authority, and transceiver receipt PDAs using Solana-compatible seeds and off-curve checks.
  - Built exact `AcceptDepositClaim` instruction data and a legacy Solana transaction message.
  - Supported signed localnet transaction bytes only through an injected fee-payer signer; no key files or production identities are stored.
  - Rejected wrong message kind, wrong Program ID/Mint domain, wrong recipient, signer mismatch, invalid signature, malformed base58, and malformed shortvec lengths.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment is possible without falsely reporting daemon-backed local E2E success. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 localnet Solana deposit-claim bridge adapter

- PHASE: `08`
- source commit: `0a4c39a146d150b5291935fb2ce800100accc898`
- commit message: `feat(phase-08): add localnet solana claim bridge`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34320747968`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 35 tests)
  - `npm test` (pass, 2 protocol vectors plus 79 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - current-content and added-line secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a localnet Solana deposit-claim bridge adapter that connects signed transaction planning to durable Solana submission.
  - Added localnet latest-blockhash handling through `SolanaLocalRpcClient.getLatestBlockhash()`.
  - Prepared signed transaction bytes only through an injected fee-payer signer; no key files or production identities are loaded.
  - Verified automatic submit/observe completion, prepared-request submission, retry without a second broadcast, missing blockhash dependency, unsafe domain rejection, and signer mismatch rejection.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment is possible without falsely reporting daemon-backed local E2E success. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 Solana account execution and SPL Token CPI source implementation

- PHASE: `08`
- source commit: `c3b2686cf701bc7ed795aefe9c4ba1dfd75bf11e`
- corrective format commit / tested source SHA: `8309b3fc95bea4b84224852cb13e2f9b75099dfa`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34304533970`
- CI status: `PASS`
- superseded CI failure:
  `c3b2686cf701bc7ed795aefe9c4ba1dfd75bf11e` failed Linux rustfmt and was
  corrected by `8309b3fc95bea4b84224852cb13e2f9b75099dfa`.
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace --all-targets` (pass under WSL, 52 Rust tests)
  - `npm test` (pass, 2 vectors plus 26 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2; Solana programs report READY; required local executables are missing)
  - local `cargo fmt` / `cargo clippy`: NOT_RUN locally; this WSL Cargo installation has no `fmt` or `clippy` command
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Enabled source-level bridge manager account execution with program-owned PDA account validation.
  - Added SPL Token `mint_to_checked` CPI construction for verified deposit claims.
  - Added SPL Token `burn_checked` CPI construction before durable withdrawal record writes.
  - Enabled source-level transceiver account execution with config/receipt PDA validation and instructions-sysvar Ed25519 loading.
  - Added account execution tests while keeping actual CPI invocation reserved for local-validator testing.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 local validator/regtest wiring. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 local E2E orchestration plan

- PHASE: `08`
- source commit: `7ffd331358146bb990f9830d4f39c0849cc0bdeb`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34305873353`
- CI status: `PASS`
- tests:
  - `npm run test:local-e2e-readiness` (pass, 8 readiness/orchestration tests)
  - `npm test` (pass, 2 vectors plus 31 Node tests)
  - `npm run local:e2e:plan` (expected BLOCKED, exit 2)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a local-only orchestration planner for Anchor build, Solana local
    validator startup, and KingPepe REGTEST startup.
  - Enforced runtime datadir and ledger paths outside the repository.
  - Enforced loopback-only REGTEST RPC, no public Native P2P listener, and
    allowlisted local CLI commands.
  - Redacted local paths from CLI plan output.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 by integrating the actual disposable local E2E runner once the required executables are available. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 local E2E bootstrap runner

- PHASE: `08`
- source commit: `d392403733bbfb92fcfd2d50a1d3879d63f0e3bb`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34307355800`
- CI status: `PASS`
- tests:
  - `npm run test:local-e2e-readiness` (pass, 13 readiness/orchestration/bootstrap tests)
  - `npm test` (pass, 2 protocol vectors plus 36 Node tests)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a local-only bootstrap runner for executable version checks,
    `anchor build`, disposable Solana local-validator startup, disposable
    KingPepe REGTEST startup, health checks, and cleanup.
  - Added tests that prove blocked readiness executes no commands, fake
    complete infrastructure runs bootstrap steps, mismatched KingPepe REGTEST
    versions block before service startup, missing build artifacts block before
    validator startup, and health-check failure stops started services.
  - Kept the runner honest: it does not claim that the full economic
    Native-to-Solana local E2E flow passed.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only after the required disposable local KingPepe and
    Solana/Anchor executables are available. Do not proceed to Phase 09 until
    the Native-to-Solana local E2E gate actually passes.

## Phase 08 Native REGTEST RPC adapter

- PHASE: `08`
- source commit: `845dfc4a86a1ef87f15e3d5ec2ca4ad91fd8fe8d`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34308850060`
- CI status: `PASS`
- tests:
  - `npm run test:native-node` (pass, 7 Native REGTEST RPC adapter tests)
  - `npm test` (pass, 2 protocol vectors plus 43 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a loopback-first KingPepe JSON-RPC adapter for local REGTEST source
    observation, source snapshots, UTXO checks, controlled local raw
    transaction broadcast, and local daemon stop.
  - Added endpoint/auth boundaries: credentials embedded in endpoint URLs are
    rejected, and optional auth-cookie material must live outside the source
    checkout.
  - Added exact atomic amount parsing from raw JSON decimal text.
  - Added tests with a disposable loopback HTTP RPC server and runtime-generated
    auth-cookie fixture material outside the repository.
  - Added Linux and Windows CI gates for the Native node adapter tests.
  - Kept all adapter evidence classified as `RPC_OBSERVATION`, not independent
    consensus validation.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 by wiring the Native RPC adapter into the disposable
    local E2E runner after required local executables are available. Do not
    proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 Solana deposit claim submitter

- PHASE: `08`
- source commit: `905a45b4c79d879e6ae27a05b3c7a39fed0a30f6`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34310531798`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 13 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 50 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a localnet-only Solana deposit claim submitter for the automated
    Native-to-Solana path.
  - The submitter validates the canonical deposit message, operation ID,
    digest, amount, recipient, domain, policy epoch, key epoch, and two project
    attestations before Solana RPC submission.
  - Added persist-before-broadcast journal support with an in-memory adapter
    and a file-backed adapter that rejects source-tree runtime state roots.
  - Added retry behavior that checks a submitted signature before any rebuild
    and returns a dependency wait if the prior transaction outcome is unknown
    after blockhash expiry.
  - Added finalized claim observation checks before returning mint completion.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment can be
    implemented without falsely reporting a daemon-backed local E2E pass. Do
    not proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 async deposit pipeline entrypoint

- PHASE: `08`
- source commit: `024c0019745bc4671299af135740aa9d29963116`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34312011059`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 14 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 51 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added `processDepositAsync` for promise-returning local Native relayer,
    reserve verifier, and Solana bridge adapters.
  - Added test coverage proving the async path completes with automatic FROST
    A+B, two project attestations, one Native broadcast, one Solana submission,
    and no per-transfer KingPepe Team approval state.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Push this source increment and verify CI, then continue Phase 08 only if a
    further source increment is possible without claiming the daemon-backed E2E
    pass.

## Phase 08 Native reserve-sweep adapters

- PHASE: `08`
- source commit: `9af93d22b9af9c1278354a33e35db469311332d9`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34313600140`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 22 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 59 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added local Native reserve-sweep relayer and verifier adapters.
  - The relayer validates FROST A+B transcript consistency, persists signed
    sweep transactions before local REGTEST broadcast, rejects returned txid
    mismatch with `HARD_STOP`, and retries idempotently without rebroadcast.
  - The verifier checks local source readiness, finalized confirmations,
    deposit-input consumption, reserve script, and exact text atomic reserve
    output evidence before producing reserve transition evidence.
  - The verifier output is still `RPC_OBSERVATION`, not production consensus
    validation.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment can be
    implemented without falsely reporting a daemon-backed local E2E pass. Do
    not proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 deposit pipeline file-backed journal

- PHASE: `08`
- source commit: `73df9906998f9783c309a0671739d19cfc6b589f`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34315069345`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 25 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 62 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - `npm run local:e2e:bootstrap` (expected BLOCKED, exit 2)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a file-backed deposit journal for the automatic Native-to-Solana
    pipeline.
  - Persisted completed deposit terminal results and deposit-outpoint
    reservations outside the source repository.
  - Added restart replay coverage proving completed deposits are not
    rebroadcast or resubmitted.
  - Added persisted outpoint-conflict coverage and source-tree root rejection.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment can be
    implemented without falsely reporting a daemon-backed local E2E pass. Do
    not proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 Solana deposit-claim observer account pass-through

- PHASE: `08`
- source commit: `dab03e8696267fa98488f312e1f2158df51dc815`
- commit message:
  `feat(phase-08): pass solana claim accounts to observer`
- push result: pushed to private GitHub repository
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34322782563`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 36 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 80 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - staged and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Persisted per-operation deposit-claim PDA and Mint account bindings in the
    Solana deposit-claim submitter prepared journal entries.
  - Passed those account bindings into the real finalized deposit-claim
    observer.
  - Updated the localnet Solana deposit-claim bridge to forward the derived
    claim PDA and configured Mint from the transaction plan.
  - Added a regression test using the real deposit-claim observer with a fake
    loopback RPC fixture proving the derived per-operation accounts are
    observed.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment can be
    implemented without falsely reporting a daemon-backed local E2E pass. Do
    not proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 automatic pipeline to localnet Solana bridge/observer integration

- PHASE: `08`
- source commit: `3b5c0e873a37bafb24ac69dd1cadc1761d921d4f`
- commit message:
  `test(phase-08): connect deposit pipeline to solana claim bridge`
- push result: pushed to private GitHub repository
- CI URL:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34324525303`
- CI status: `PASS`
- tests:
  - `npm run test:bridge-validator` (pass, 37 bridge-validator tests)
  - `npm test` (pass, 2 protocol vectors plus 81 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - JSON manifest parse checks (pass)
  - staged and outgoing-range secret-pattern scans (pass)
  - `npm run doctor:local-e2e` (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`)
  - CI Linux format, clippy, workspace, Node, and native crate tests (PASS)
  - CI Windows workspace, Node, and native crate tests (PASS)
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added a source-level integration test connecting the automatic
    Native-to-Solana deposit pipeline to the real localnet Solana deposit-claim
    bridge.
  - Exercised the durable submitter and real finalized claim observer through
    fake loopback Solana RPC fixtures.
  - Verified one Solana submission, finalized claim observation, exact minted
    amount, and ledger mint accounting without any per-transfer KingPepe Team
    approval state.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`,
    `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 only if another meaningful source increment can be
    implemented without falsely reporting a daemon-backed local E2E pass. Do
    not proceed to Phase 09 until the Native-to-Solana local E2E gate actually
    passes.

## Phase 08 Solana account-state codec implementation

- PHASE: `08`
- implementation commit: `16dec337ba321b4f37f6dd1dfb13cf5a221db3eb`
- corrective format commit / tested source SHA: `804e03d4909ad002c0cf97798bd30cda56a7d4be`
- push result: pushed to private GitHub repository
- CI URL: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34301859073`
- CI status: `PASS`
- superseded CI failure:
  `16dec337ba321b4f37f6dd1dfb13cf5a221db3eb` failed Linux rustfmt and was
  corrected by `804e03d4909ad002c0cf97798bd30cda56a7d4be`.
- tests:
  - `cd solana && cargo check --locked --workspace --all-targets` (pass under WSL)
  - `cd solana && cargo test --locked --workspace --all-targets` (pass under WSL, 47 Rust tests)
  - `npm test` (pass, 2 vectors plus 26 Node tests)
  - `npm audit --audit-level=low` (pass, 0 vulnerabilities)
  - `python .github/scripts/guardrails.py` (pass)
  - `npm run doctor:local-e2e` (expected BLOCKED, exit 2)
  - local `cargo clippy`: NOT_RUN locally; this WSL Cargo installation has no `clippy` command
  - real Native-to-Solana local E2E (BLOCKED / NOT_RUN)
- changed:
  - Added fixed binary account codecs for bridge state, deposit claims, withdrawal records, transceiver config, and verified receipts.
  - Added magic/version/exact-length validation for those account layouts.
  - Rejected overlong recipient/destination data and alternate padded account encodings.
  - Kept economic execution and SPL Token CPI disabled and fail-closed.
- blocker:
  - `LOCAL_E2E_INFRASTRUCTURE_MISSING`
  - `SOLANA_PROGRAM_EXECUTION_NOT_READY`
  - Missing executables: `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- next:
  - Continue Phase 08 account execution and SPL Token CPI. Do not proceed to Phase 09 until the Native-to-Solana local E2E gate actually passes.

## Phase 08 report - adapter-journal restart retry coverage

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`6fa2a41bc29d46c1a24308a6a46ca1b5df99e9a1`

COMMIT MESSAGE:
`test(phase-08): cover deposit restart after native sweep`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34328709477`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:bridge-validator`: PASS, 39 bridge-validator tests.
- `npm test`: PASS, 2 protocol vectors plus 83 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run doctor:local-e2e`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Added an integration regression for restart after Native sweep broadcast but
  before reserve finality.
- The regression uses file-backed deposit, Native reserve-sweep, and Solana
  claim journals outside the source tree.
- Restart resumes from persisted journals, does not rebroadcast the Native
  sweep, submits one Solana claim after reserve finality, and does not
  introduce per-transfer KingPepe Team approval.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`,
  `solana-test-validator`, and `anchor` executables prevent real
  daemon-backed Native-to-Solana local E2E.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed
Native-to-Solana local E2E flow passes.

## Phase 08 report - reusable local E2E infrastructure harness

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`f4372d9276946ebe7a8dad1d2903f60821dcaae8`

COMMIT MESSAGE:
`feat(phase-08): expose local e2e infrastructure harness`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34330731668`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:local-e2e-readiness`: PASS, 15 readiness/orchestration/bootstrap/harness tests.
- `npm test`: PASS, 2 protocol vectors plus 85 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run local:e2e:plan`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- `npm run local:e2e:bootstrap`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- `npm run doctor:local-e2e`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Refactored the local-only E2E bootstrap runner into a reusable harness for
  the future real Native-to-Solana local daemon flow.
- The harness starts the disposable Solana local-validator and KingPepe REGTEST
  services, runs health checks, keeps services active while an injected flow
  callback runs, and stops services afterward.
- Callback failure is classified as `LOCAL_E2E_FLOW_FAILED` and does not report
  a local E2E pass.
- Existing bootstrap behavior remains a bootstrap-only command and still does
  not claim full economic E2E execution.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`,
  `solana-test-validator`, and `anchor` executables prevent real
  daemon-backed Native-to-Solana local E2E.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed
Native-to-Solana local E2E flow passes.

## Phase 08 report - Native-to-Solana local E2E command runner

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`b30420dc11b3f6fe0e5e883b122dfc64c04ab871`

COMMIT MESSAGE:
`feat(phase-08): add native to solana local e2e runner`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34333170011`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:local-e2e-readiness`: PASS, 20 readiness/orchestration/bootstrap/runner tests.
- `npm test`: PASS, 2 protocol vectors plus 90 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run doctor:local-e2e`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- `npm run local:e2e:plan`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- `npm run local:e2e:bootstrap`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Added `scripts/local-e2e-native-to-solana.mjs`, a local-only runner that
  composes the reusable bootstrap harness with disposable REGTEST deposit
  funding, deposit intent creation, transaction observation, output matching,
  UTXO/finality checks, and fail-closed reporting.
- Added Node tests covering missing-infrastructure blocking, no per-transfer
  KingPepe Team approval state, sanitized state-root reporting, local-only
  Mainnet-disabled metadata, and deterministic deposit observation with fake
  local tools.
- Added the `local:e2e:native-to-solana` package script.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`,
  `solana-test-validator`, and `anchor` executables prevent real
  daemon-backed Native-to-Solana local E2E.
- Reserve-sweep construction, FROST-backed reserve broadcast, Solana mint
  submission, finalized mint observation, and reconciliation remain unexecuted
  against real local daemons.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed
Native-to-Solana local E2E flow passes.

## Phase 08 report - Native-to-Solana deposit evidence validation

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`48a3bae917b6ddc80dcbd0a8d1e45b28fc1eff49`

COMMIT MESSAGE:
`feat(phase-08): validate native deposit source evidence`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34335394052`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:local-e2e-readiness`: PASS, 22 readiness/orchestration/bootstrap/runner tests.
- `npm test`: PASS, 2 protocol vectors plus 92 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- The local Native-to-Solana runner now validates `getblockchaininfo`,
  `getblockhash 0`, expected REGTEST chain identity, raw deposit transaction
  identity, exact deposit output, UTXO script, and UTXO finality before reserve
  sweep construction.
- Added deterministic non-secret deposit proof fingerprinting from local source
  and deposit evidence.
- Added fail-closed tests for wrong local Native source and raw transaction
  txid mismatch.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`,
  `solana-test-validator`, and `anchor` executables prevent real
  daemon-backed Native-to-Solana local E2E.
- Reserve-sweep construction, FROST-backed reserve broadcast, Solana mint
  submission, finalized mint observation, and reconciliation remain unexecuted
  against real local daemons.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed
Native-to-Solana local E2E flow passes.

## Phase 08 report - Native-to-Solana unsigned reserve-sweep draft

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`e836719e920f12dff33bab2a7a546435c26d7739`

COMMIT MESSAGE:
`feat(phase-08): draft unsigned native reserve sweep`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34337778598`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:local-e2e-readiness`: PASS, 23 readiness/orchestration/bootstrap/runner tests.
- `npm test`: PASS, 2 protocol vectors plus 93 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Added `createrawtransaction` to the local REGTEST allowlist for unsigned reserve-sweep drafting.
- The local runner now creates a disposable local reserve wallet/address after deposit evidence validation, calculates exact miner fee and reserve amount using integer atomic units, and drafts an unsigned reserve sweep.
- The runner stops at `FROST_RESERVE_SWEEP_SIGNING_PENDING`, records only a non-secret unsigned transaction fingerprint, and does not call wallet signing, FROST signing, or Native broadcast.
- Added tests for exact fee accounting, fee-overrun rejection, absence of `signrawtransactionwithwallet`/`sendrawtransaction`, and no per-transfer KingPepe Team approval state.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- FROST-backed reserve sweep signing/broadcast, finalized sweep verification against real daemon data, Solana mint submission, finalized mint observation, and reconciliation remain unexecuted against real local daemons.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Solana local-validator PDA allocation path

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`0542b04dac5db0807b66f028e6006741c1efea06`

COMMIT MESSAGE:
`feat(phase-08): add solana pda allocation path`

CORRECTIVE SHA:
`edb184c5aff7f555110f305f3f050fb861294e13`

CORRECTIVE MESSAGE:
`fix(phase-08): apply solana rust formatting`

PUSH RESULT:
Pushed to private GitHub repository `kingpepe2/KingPepe-Native-Solana_Bridge` on branch `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34366351989`

CI STATUS:
PASS for corrective source SHA `edb184c5aff7f555110f305f3f050fb861294e13`.
Prior source SHA `0542b04dac5db0807b66f028e6006741c1efea06` failed Linux Solana Rust formatting and was superseded by the corrective commit.

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `node --check services/bridge-validator/solana-deposit-claim-transaction-plan.mjs`: PASS.
- `node --test services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`: PASS, 8 tests.
- `npm test`: PASS, 2 protocol vectors plus 108 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- `git diff --cached --check`: PASS.
- Staged/outgoing secret scans: PASS.
- WSL Solana Rust workspace tests: PASS, 53 Rust tests/doc-tests.
- Local `cargo fmt` / `cargo clippy`: NOT_RUN locally because this environment has `cargo` but not `rustup`, `rustfmt`, or `clippy`.
- GitHub Actions Linux rustfmt/clippy/check/test gates: PASS on corrective SHA.
- GitHub Actions Windows check/test gates: PASS on corrective SHA.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Added signed System Program CPI allocation paths for `kingpepe-transceiver` config and verified-receipt PDA accounts.
- Added signed System Program CPI allocation paths for `kingpepe-bridge` bridge-state and deposit-claim PDA accounts.
- Updated the bundled localnet Solana deposit-claim transaction plan to pass fee-payer and System Program accounts into the transceiver and bridge instructions.
- Preserved existing preallocated-account execution tests and localnet-only activation boundaries.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real local-validator execution still needs disposable fee-payer funding, SPL Mint setup, token account setup, finalized claim observation, and reconciliation before full Native-to-Solana E2E can be marked PASS.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Local FROST Taproot deposit, fee, and reserve intent

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`5e98101e1b47380ade3d5fa00c445b24f37efd70`

COMMIT MESSAGE:
`feat(phase-08): use local frost taproot deposit intents`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34349340644`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `node --check scripts/local-e2e-native-to-solana.mjs`: PASS.
- `node --check scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS.
- `node --test scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS, 10 tests.
- `npm test`: PASS, 2 protocol vectors plus 99 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- `git diff --check`: PASS.
- WSL `solana` Rust workspace tests: PASS, 52 tests.
- WSL Native FROST Rust tests: PASS, 7 tests.
- WSL Native proof Rust tests: PASS, 8 tests.
- WSL Native reserve Rust tests: PASS, 4 tests.
- WSL Native recovery Rust tests: PASS, 3 tests.
- Modified, staged, and outgoing-range secret-pattern scans: PASS.
- CI Linux formatting, clippy, Rust/Node tests, guardrails, and audit: PASS.
- CI Windows portable checks: PASS.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- The local Native-to-Solana runner now derives disposable software FROST A+B aggregate Taproot custody under the local E2E run root outside the repository.
- Local REGTEST deposit, reserve-sweep fee-funding, and canonical reserve outputs now bind to the same FROST-controlled P2TR script instead of wallet-owned local deposit/reserve addresses.
- The runner uses recovered KingPepe REGTEST facts for this local path: 8 atomic decimals, coinbase maturity `20`, Taproot active, and Bech32m HRP `rkpepe`.
- Deposit observation now requires both the expected address and exact P2TR script before producing the proof fingerprint.
- Added a BIP-350 Taproot address vector check for the Bech32m helper.
- Updated provenance, upstream references, Native validation documentation, readiness, and script documentation without adding operational secrets or real private paths.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real daemon-backed Taproot sighash computation, FROST witness attachment, Native broadcast/finality, Solana mint submission, and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Local E2E Native wallet raw-signing boundary

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`8d091c2867eda2e1e8e6818216e23d8220f78279`

COMMIT MESSAGE:
`fix(phase-08): block native wallet raw signing`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34339945822`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:local-e2e-readiness`: PASS, 23 readiness/orchestration/bootstrap/runner tests.
- `npm run test:bridge-validator`: PASS, 39 bridge-validator tests.
- `npm test`: PASS, 2 protocol vectors plus 93 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Removed `signrawtransactionwithwallet` from the local REGTEST CLI allowlist.
- Preserved `sendrawtransaction` for already FROST-signed Native transactions.
- Added a regression proving wallet raw-signing is rejected while the signed-broadcast boundary remains available.
- Updated source-status documentation and provenance for the FROST-only signing boundary.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real reserve-sweep signing/broadcast still requires Native-compatible FROST signing material derived from actual local Native transaction/sighash data; this cannot be proven without the missing local daemons/toolchain.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Native reserve-sweep signing-intent boundary

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`3c473d75891707950a4bfefd889e95b6649a43b7`

COMMIT MESSAGE:
`feat(phase-08): prepare reserve sweep signing intent`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34342995604`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `npm run test:bridge-validator`: PASS, 43 bridge-validator tests.
- `npm run test:local-e2e-readiness`: PASS, 23 local readiness/orchestration/bootstrap/runner tests.
- `npm test`: PASS, 2 protocol vectors plus 97 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Added a localnet-only bridge-validator boundary that prepares a Native-compatible FROST reserve-sweep signing intent only after validated Native Taproot sighash evidence is supplied.
- Bound operation ID, deposit outpoint, unsigned transaction fingerprint, proof fingerprint, canonical reserve allocation, Native fee, reserve script, transaction commitment, Taproot sighash, key epoch, and Solana deployment domain into the signing intent and signer-policy authorization.
- Corrected the local unsigned reserve-sweep draft path to preserve the credited deposit amount as canonical reserve output and require explicit local fee-funding inputs for nonzero Native miner fees.
- Exported the boundary and FROST signing-intent validator.
- Added fail-closed tests for missing, RPC-only, or altered sighash evidence and non-localnet/non-regtest use.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- The new boundary does not compute a real Native sighash; real reserve-sweep signing/broadcast still requires actual local Native transaction/sighash verification from the missing local daemon/toolchain.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Native reserve fee-funding model alignment

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`894cdb6b9361b5b0bba46d66741d2cf6ecd2bc4e`

COMMIT MESSAGE:
`style(phase-08): format native reserve fee funding`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34345811287`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/frost cargo test --locked --all-targets`: PASS, 7 tests.
- `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/proof cargo test --locked --all-targets`: PASS, 8 tests.
- `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/reserve cargo test --locked --all-targets`: PASS, 4 tests.
- `wsl --cd /mnt/d/KingPepe-Native-Solana_Bridge/native/recovery cargo test --locked --all-targets`: PASS, 3 tests.
- `npm test`: PASS, 2 protocol vectors plus 97 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- `git diff --check`: PASS.
- Staged and outgoing-range secret-pattern scans: PASS.
- CI Linux formatting, clippy, Rust/Node tests, guardrails, and audit: PASS.
- CI Windows portable checks: PASS.
- Local `rustfmt` / `cargo fmt`: NOT_RUN locally; WSL has Cargo but no installed rustfmt component.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Aligned the Rust Native reserve primitive with the Phase 08 full credited-reserve model.
- Reserve sweeps now require the credited temporary-deposit amount to become the canonical reserve allocation.
- Nonzero Native miner fees require exact separate fee-funding inputs and reject missing, duplicate, temporary-outpoint-aliasing, not-spent, or wrong-amount fee evidence.
- Reserve records retain non-secret fee-funding outpoints for accounting and reconciliation provenance.
- Updated Native reserve validation documentation, readiness, and provenance records.
- Superseded source commit `74bd3742e8b5846f477ac90054a6f9fd83fc17b8` failed Linux formatting; corrective commit `894cdb6b9361b5b0bba46d66741d2cf6ecd2bc4e` passed CI.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real daemon-backed reserve sweep signing/broadcast, Solana mint submission, and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Local Taproot sighash evidence

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`36c3dbbaad092fab750abc66e2bfdb8838f05941`

COMMIT MESSAGE:
`feat(phase-08): compute local taproot sighash evidence`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` on `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34352340935`

CI STATUS:
`PASS`

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `node --check native/node/native-taproot-transaction.mjs`: PASS.
- `node --check native/node/tests/native-taproot-transaction.test.mjs`: PASS.
- `node --check scripts/local-e2e-native-to-solana.mjs`: PASS.
- `node --check scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS.
- `node --test native/node/tests/native-taproot-transaction.test.mjs`: PASS, 3 tests.
- `node --test scripts/tests/local-e2e-native-to-solana.test.mjs`: PASS, 10 tests.
- `npm test`: PASS, 2 protocol vectors plus 102 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- `git diff --check`: PASS.
- WSL `solana` Rust workspace tests: PASS, 52 tests.
- WSL Native FROST Rust tests: PASS, 7 tests.
- WSL Native proof Rust tests: PASS, 8 tests.
- WSL Native reserve Rust tests: PASS, 4 tests.
- WSL Native recovery Rust tests: PASS, 3 tests.
- Modified, staged, and outgoing-range secret-pattern scans: PASS.
- CI Linux formatting, clippy, Rust/Node tests, guardrails, and audit: PASS.
- CI Windows portable checks: PASS.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Added `native/node/native-taproot-transaction.mjs` for bounded local Native transaction parsing/serialization, BIP-341 key-path `SIGHASH_DEFAULT` evidence, and Taproot witness attachment after signatures are supplied.
- Added a public BIP-341 wallet vector test for sighash correctness and KingPepe-specific local reserve-sweep evidence tests.
- The local Native-to-Solana runner now verifies unsigned reserve-sweep input outpoints and computes per-input Taproot sighash evidence for the deposit and fee-funding P2TR inputs.
- The runner now stops at `LOCAL_NATIVE_TAPROOT_SIGHASHES_VALIDATED` with `FROST_RESERVE_SWEEP_SIGNATURES_PENDING`; it still does not wallet-sign, broadcast, mint, or reconcile.
- Updated provenance, third-party notices, upstream references, readiness, and source-status documentation without adding operational secrets or real private paths.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real daemon-backed FROST signature aggregation, witness attachment, Native broadcast/finality, Solana mint submission, and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Local FROST reserve-sweep witness attachment

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`a04417a4562f07a3ec1d709361c714e116b4ba0f`

COMMIT MESSAGE:
`feat(phase-08): sign local reserve sweep witnesses`

PUSH RESULT:
Pushed to private GitHub repository `kingpepe2/KingPepe-Native-Solana_Bridge` on branch `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34356317376`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:
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
- Full local gate set: PASS locally before commit.
- Staged/outgoing secret scans: PASS. The only staged content-scan hits were reviewed false positives on in-memory ephemeral test key fields, not committed secret values.
- Push: PASS to private repository.
- CI: PASS for exact source SHA `a04417a4562f07a3ec1d709361c714e116b4ba0f`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Converted validated Taproot sighash evidence into localnet-only, input-specific FROST reserve-sweep signing intents.
- Bound `signingInputIndex` into each FROST authorized operation so A and B validate the exact Native transaction input before producing a share.
- Reopened disposable local FROST A/B signer state from outside-repository roots using a narrow policy generated after deposit evidence is known.
- Signed the deposit input and fee-funding input with real software FROST A+B, verified signatures independently, and attached key-path Taproot witnesses.
- Advanced the local Native-to-Solana runner from `LOCAL_NATIVE_TAPROOT_SIGHASHES_VALIDATED` to `LOCAL_NATIVE_RESERVE_SWEEP_SIGNED`.
- Kept `sendrawtransaction`, Solana mint submission, and reconciliation unexecuted until local daemon infrastructure is available.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Native broadcast/finality, Solana mint submission, finalized mint observation, and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Local reserve-sweep broadcast and finality validation

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`81797c2930b74598ed49bc451aef38f1571f01a4`

COMMIT MESSAGE:
`feat(phase-08): finalize local reserve sweep broadcast`

PUSH RESULT:
Pushed to private GitHub repository `kingpepe2/KingPepe-Native-Solana_Bridge` on branch `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34358737395`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:
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
- Full local gate set: PASS locally before commit.
- Staged/outgoing secret scans: PASS.
- Push: PASS to private repository.
- CI: PASS for exact source SHA `81797c2930b74598ed49bc451aef38f1571f01a4`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.

WHAT CHANGED:
- Broadcasts the already FROST-signed, witness-attached Native reserve sweep with `sendrawtransaction` when local REGTEST infrastructure is available.
- Mines local finality blocks and validates the finalized reserve-sweep transaction's txid, input outpoints, reserve output amount, reserve script, and confirmation depth.
- Advances the local Native-to-Solana runner from `LOCAL_NATIVE_RESERVE_SWEEP_SIGNED` to `LOCAL_NATIVE_RESERVE_SWEEP_FINALIZED`.
- Stops at `SOLANA_MINT_PENDING` without claiming Solana mint submission, finalized mint observation, reconciliation, or full E2E success.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real daemon-backed Solana mint submission, finalized mint observation, and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Localnet Solana deposit-claim bundle plan

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`b4154371514cb542a847c777a1608907f1b77e46`

COMMIT MESSAGE:
`feat(phase-08): bundle solana deposit claim transaction`

PUSH RESULT:
Pushed to private GitHub repository `kingpepe2/KingPepe-Native-Solana_Bridge` on branch `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34362568530`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `node --check services/bridge-validator/solana-deposit-claim-transaction-plan.mjs`: PASS.
- `node --check services/bridge-validator/localnet-solana-deposit-claim-bridge.mjs`: PASS.
- `node --test services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`: PASS, 8 tests.
- `node --test services/bridge-validator/tests/localnet-solana-deposit-claim-bridge.test.mjs services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs services/bridge-validator/tests/solana-deposit-claim-submitter.test.mjs services/bridge-validator/tests/automatic-deposit-pipeline.test.mjs`: PASS, 34 tests.
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
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.
- Staged/outgoing secret scans: PASS.
- Push: PASS to private repository.
- CI: PASS for exact source SHA `b4154371514cb542a847c777a1608907f1b77e46`.

WHAT CHANGED:
- Added a bundled localnet Solana claim transaction planner with two Ed25519 verifier instructions, transceiver receipt verification, and bridge claim/mint in one fee-payer-signed transaction.
- Updated the localnet bridge adapter so actual `submitDepositClaim` no longer depends on a pre-existing verified receipt account.
- Kept the read-only localnet planning helper able to derive PDA and observer accounts without attestations through the legacy one-instruction plan.
- Required exactly two distinct project attestations over the canonical deposit message before bundled transaction construction.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- Real local-validator execution still needs localnet account creation/initialization, funded disposable fee payer, SPL Mint setup, token account setup, finalized claim observation, and reconciliation before full Native-to-Solana E2E can be marked PASS.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Localnet Solana setup transaction plan

PHASE:
`PHASE 08 - Automatic Native to Solana local end-to-end`

COMMIT SHA:
`37d02cb7646ec5af53751be598d3974408a0662e`

COMMIT MESSAGE:
`feat(phase-08): add localnet solana setup plan`

PUSH RESULT:
Pushed to private GitHub repository `kingpepe2/KingPepe-Native-Solana_Bridge` on branch `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34370095662`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:
- `node --check services/bridge-validator/localnet-solana-setup-plan.mjs`: PASS.
- `node --check services/bridge-validator/tests/localnet-solana-setup-plan.test.mjs`: PASS.
- `node --test services/bridge-validator/tests/localnet-solana-setup-plan.test.mjs`: PASS, 5 tests.
- `node --test services/bridge-validator/tests/*.test.mjs`: PASS, 52 tests.
- `npm test`: PASS, 2 protocol vectors plus 113 Node tests.
- `npm audit --audit-level=low`: PASS, 0 vulnerabilities.
- `python .github/scripts/guardrails.py`: PASS.
- JSON manifest parse checks: PASS.
- WSL Solana Rust workspace tests: PASS, 53 Rust tests/doc-tests.
- WSL Native FROST Rust tests: PASS, 7 tests.
- WSL Native proof Rust tests: PASS, 8 tests.
- WSL Native reserve Rust tests: PASS, 4 tests.
- WSL Native recovery Rust tests: PASS, 3 tests.
- `npm run local:e2e:native-to-solana`: `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`.
- Real daemon-backed Native-to-Solana local E2E: `BLOCKED / NOT_RUN`.
- Staged/outgoing secret scans: PASS.
- Push: PASS to private repository.
- CI: PASS for exact source SHA `37d02cb7646ec5af53751be598d3974408a0662e`.

WHAT CHANGED:
- Added a localnet-only Solana setup transaction planner that creates a disposable zero-supply KPEPE SPL Mint, recipient SPL token account, transceiver config PDA, and bridge state PDA.
- Encoded SPL Token `InitializeMint2` with PDA mint authority and no freeze authority.
- Required explicit rent lamports and injected runtime signers for the local fee payer, mint, and recipient token account.
- Kept setup scoped to localnet with Mainnet activation disabled and no generated keypair files or operational state in the repository.

OPEN BLOCKERS:
- Missing local `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor` executables prevent real daemon-backed Native-to-Solana local E2E.
- The localnet setup transaction has not been submitted to a real Solana local validator.
- Finalized Solana mint observation and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed Native-to-Solana local E2E flow passes.

## Phase 08 report - Localnet Solana setup submitter and runner handoff

PHASE:
Phase 08 - Automatic Native to Solana local end-to-end.

COMMIT SHA:
`da3696023be06776ccad7435af4fb8c08df90145`

COMMIT MESSAGE:
`feat(phase-08): submit localnet solana setup`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34374335134`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:

- PASS: `node --check services\bridge-validator\localnet-solana-setup-submitter.mjs`.
- PASS: `node --check services\bridge-validator\solana-deposit-claim-submitter.mjs`.
- PASS: `node --check scripts\local-e2e-native-to-solana.mjs`.
- PASS: `node --check scripts\tests\local-e2e-native-to-solana.test.mjs`.
- PASS: `node --test services\bridge-validator\tests\localnet-solana-setup-submitter.test.mjs` (5 tests).
- PASS: `node --test scripts\tests\local-e2e-native-to-solana.test.mjs` (13 tests).
- PASS: `node --test services\bridge-validator\tests\*.test.mjs` (57 tests).
- PASS: `npm test` (2 protocol vectors plus 119 Node tests).
- PASS: WSL Solana Rust workspace tests (53 Rust tests/doc-tests).
- PASS: WSL Native Rust crate tests (22 tests across FROST, proof, reserve, and recovery).
- PASS: `npm audit --audit-level=low` (0 vulnerabilities).
- PASS: repository guardrails and targeted staged/outgoing secret scans.
- PASS: JSON manifest parse checks and `git diff --check`.
- NOT_RUN/BLOCKED: real daemon-backed `npm run local:e2e:native-to-solana`
  remains `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`; required localnet
  executables are missing and no localnet commands were started.

WHAT CHANGED:

- Added a localnet-only Solana setup submitter that queries rent exemption,
  requests disposable local-validator airdrop funding, submits the signed setup
  transaction, waits for finalized signatures, and verifies Mint/token/PDA
  accounts.
- Extended the loopback-only Solana RPC helper with setup-required methods
  while retaining method allowlisting.
- Wired the Native-to-Solana local runner so disposable local Solana setup
  identities are created before Native FROST signing and the FROST policy binds
  to the exact local KPEPE Mint for that run.
- Sanitized setup results so runtime signer handles are not included in public
  reports.
- The runner now advances to finalized local Solana setup and then stops
  honestly at `SOLANA_DEPOSIT_CLAIM_PENDING`.

OPEN BLOCKERS:

- `LOCAL_E2E_INFRASTRUCTURE_MISSING`: `kingpeped`, `kingpepe-cli`,
  `solana`, `solana-test-validator`, and `anchor` are not available in this
  local environment.
- Real local-validator account creation/finality, deposit-claim submission,
  finalized mint observation, and reconciliation remain `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed
Native-to-Solana local E2E flow passes or a non-bypassable blocker is reported.

## Phase 08 report - Native-to-Solana deposit-claim runner integration

PHASE:
Phase 08 - Automatic Native to Solana local end-to-end.

COMMIT SHA:
`5886301bb297c6245eeac58f5bd873c9f1184cc1`

COMMIT MESSAGE:
`feat(phase-08): submit and reconcile local solana deposit claim`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34379702330`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:

- PASS: `node --check scripts\local-e2e-native-to-solana.mjs`.
- PASS: `node --check scripts\tests\local-e2e-native-to-solana.test.mjs`.
- PASS: `node --test scripts\tests\local-e2e-native-to-solana.test.mjs services\bridge-validator\tests\localnet-solana-deposit-claim-bridge.test.mjs services\bridge-validator\tests\solana-deposit-claim-submitter.test.mjs` (26 tests).
- PASS: `node --test services\bridge-validator\tests\*.test.mjs` (57 tests).
- PASS: `npm test` (2 protocol vectors plus 119 Node tests).
- PASS: WSL Solana Rust workspace tests (53 Rust tests/doc-tests).
- PASS: WSL Native Rust crate tests (22 tests across FROST, proof, reserve, and recovery).
- PASS: `npm audit --audit-level=low` (0 vulnerabilities).
- PASS: `python .github\scripts\guardrails.py`.
- PASS: `git diff --check`, staged secret scan, and outgoing-range secret scan.
- PASS: GitHub Actions Linux and Windows jobs for exact source SHA
  `5886301bb297c6245eeac58f5bd873c9f1184cc1`.
- NOT_RUN/BLOCKED: real daemon-backed `npm run local:e2e:native-to-solana`
  remains `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`; missing localnet
  executables prevented starting KingPepe REGTEST or Solana local validator.

WHAT CHANGED:

- The local Native-to-Solana runner now derives the Solana deposit-claim
  operation ID before FROST reserve-sweep signing and reuses that operation ID
  for the canonical Solana deposit-credit message.
- The runner prepares the deposit claim after finalized Native reserve sweep
  and finalized localnet Solana setup, obtains two distinct local project
  attestations over the same canonical bytes, submits through the localnet
  Solana claim bridge boundary, and reconciles reserve/supply/liability
  accounting after a finalized claim result.
- Runtime-only attester signer handles remain private to the local setup
  context and are omitted from public reports.
- Source-level fake-backed tests now exercise the runner through completed
  local claim and reconciliation states without introducing a per-transfer
  KingPepe Team approval state.

OPEN BLOCKERS:

- `LOCAL_E2E_INFRASTRUCTURE_MISSING`: `kingpeped`, `kingpepe-cli`,
  `solana`, `solana-test-validator`, and `anchor` are not available in this
  local environment.
- Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08 only after providing the missing disposable localnet
executables and running the real KingPepe REGTEST plus Solana local-validator
Native-to-Solana flow. Do not start Phase 09 until that real local E2E flow
passes or a non-bypassable blocker is reported.

## Phase 08 corrective report - Deterministic attestation mutation test

PHASE:
Phase 08 - Automatic Native to Solana local end-to-end.

COMMIT SHA:
`61267f6e549736e6eef761bb829e00478e9fe0e9`

COMMIT MESSAGE:
`fix(phase-08): make attestation mutation test deterministic`

PUSH RESULT:
Pushed to private `kingpepe2/KingPepe-Native-Solana_Bridge` `main`.

CI RUN URL:
`https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34376065307`

CI STATUS:
PASS.

TESTS PASS/FAIL/SKIP/NOT_RUN:

- FAIL before correction: evidence commit
  `bac0b69abf60832d58c150f20ce86d63bdea7575` failed CI run
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34375362002`
  in `services/bridge-validator/tests/solana-deposit-claim-transaction-plan.test.mjs`
  because a randomized attestation signature mutation could leave the final
  byte unchanged.
- PASS after correction:
  `node --test services\bridge-validator\tests\solana-deposit-claim-transaction-plan.test.mjs`
  (8 tests).
- PASS after correction:
  `node --test services\bridge-validator\tests\*.test.mjs` (57 tests).
- PASS after correction: `npm test` (2 protocol vectors plus 119 Node tests).
- PASS after correction: GitHub Actions run
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34376065307`.

WHAT CHANGED:

- Replaced the randomized invalid-signature mutation with a deterministic
  final-byte toggle in the bundled deposit-claim transaction-plan test.
- No bridge runtime, Solana program, Native validation, FROST, accounting, or
  operational policy behavior changed.

OPEN BLOCKERS:

- `LOCAL_E2E_INFRASTRUCTURE_MISSING`: `kingpeped`, `kingpepe-cli`,
  `solana`, `solana-test-validator`, and `anchor` are not available in this
  local environment.
- Real daemon-backed Native-to-Solana local E2E remains `BLOCKED / NOT_RUN`.

NEXT PHASE:
Continue Phase 08. Do not start Phase 09 until the real daemon-backed
Native-to-Solana local E2E flow passes or a non-bypassable blocker is reported.
