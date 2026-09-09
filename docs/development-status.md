# KingPepe Native - Solana Bridge Development Status

## Current phase

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

## Current blockers

- Phase 08 is blocked because the local environment does not provide `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, or `anchor`.
- Current Solana crates have deterministic non-production localnet Program IDs, economic ABI decoding, source-level account execution, and SPL Token CPI construction. Real local-validator execution remains untested because required localnet executables are missing.
- Full Native transaction construction, Native node acceptance, local end-to-end flows, Devnet, production configuration, external review, and activation remain later phases.

## Latest local validation

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
- Phase 08 `npm run test:bridge-validator`: PASS, 25 bridge-validator tests (automatic deposit pipeline, file-backed deposit journal, async adapter path, Native reserve-sweep adapters, and Solana deposit claim submitter)
- Phase 08 `npm run test:native-node`: PASS, 7 Native REGTEST RPC adapter tests
- Phase 08 `npm run test:local-e2e-readiness`: PASS, 8 readiness/orchestration tests
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
- Phase 08 deposit pipeline file-backed journal: local tests PASS; CI pending for the next pushed source SHA
- Phase 08 `cd solana && cargo check --locked --workspace --all-targets`: PASS under WSL after validate-only ABI update
- Phase 08 `cd solana && cargo test --locked --workspace --all-targets`: PASS under WSL, 52 Rust tests after account-execution update
- Phase 08 local Native-to-Solana E2E: BLOCKED / NOT_RUN

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

- Continue Phase 08 by adding disposable KingPepe regtest plus Solana
  local-validator tooling and running the full automated Native-to-Solana
  local E2E flow.

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
- Source commit: pending until this source increment is committed and pushed
- CI status: pending

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
