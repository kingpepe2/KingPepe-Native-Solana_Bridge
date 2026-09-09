# KingPepe Native - Solana Bridge Task Status

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
