# AGENTS

## Project authority

- Project: KingPepe Native - Solana Bridge
- Operating model: `INDEPENDENT_PROJECT_OPERATED_BRIDGE`
- Governance role: `KINGPEPE_TEAM_GOVERNANCE`
- Backing model: 1:1 Native reserve backing with explicit reserve/liability accounting.
- Signing model: software FROST, exact `2-of-2` with `requiredParticipants = [A, B]`
- Deployment topology: same-host, project-controlled (`SINGLE_HOST_PROJECT_CONTROLLED_FROST`)
- Mainnet activation: `DISABLED` (authoritative for this repository)
- `productionReady = false`
- `mainnetActivation = DISABLED`
- `productionSigningAuthorized = false`
- `productionBroadcastAuthorized = false`

## Core constraints retained in code and operations

- Same-host FROST A and FROST B are approved and documented. Physical dual-host is not required.
- Normal bridge transfers are automated and must not require per-transfer KingPepe Team approval.
- FROST A/B, attestation services, coordinator, observers, and relayers are separate service roles.
- No production secrets are permitted in source, documentation, commit history, or artifacts.
- Secret-bearing runtime state and operational keys are external to this repository and loaded only from private deployment configuration.

## Current phase status

- Current implementation phase: `PHASE 08 - Automatic Native to Solana local end-to-end`
- Objective: connect the automated local Native-to-Solana deposit path using validated Native reserve transitions, project attestations, Solana mint receipt consumption, and reconciliation while keeping live activation disabled outside local testing.
- Required authority: `KINGPEPE_TEAM_GOVERNANCE`

## Authoritative status files

- `AGENTS.md`
- `docs/development-status.md`
- `docs/task-status.md` (historical)
- `BRIDGE-READINESS.json`
- `PROVENANCE.json`
- `.github/workflows/ci.yml`

## Phase 01 safe commands

- `python .github/scripts/guardrails.py`
- `git status`
- `git remote -v`
- `git branch --show-current`
- `Get-Content -Raw PROVENANCE.json` (local provenance verification)

## Phase 02 safe commands

- `python .github/scripts/guardrails.py`
- `cd solana && cargo check --locked --workspace --all-targets`
- `cargo check --locked --manifest-path native/frost/Cargo.toml`
- `cargo test --locked --manifest-path native/frost/Cargo.toml`
- Stage intended files explicitly after review.
- `git status`
- `git diff --name-only`

## Phase 02 phase notes

- Added initial non-empty structure directories and configuration schema templates under:
  - `solana/ts`, `solana/tests`, `solana/fuzz`, `solana/scripts`
  - `native/proof`, `native/reserve`, `native/recovery`
  - `config`, `deployment`, `db-backup`, `shared`, `cli`, `app`, `scripts`, `monitoring`, `tests`
- Pinned toolchain and dependency versions in manifest files.
- Added locked dependency files for the current Solana and native Rust workspaces.
- Removed the phase-02 Ed25519 placeholder dependency from the native runtime to keep CI compatible with the pinned toolchain.
- Kept all sensitive runtime data and live credentials outside repository scope.
- Updated source comparison records: `UPSTREAM-REFERENCES.json`, `docs/architecture/ntt-comparison.md`.
- The Rust crate remains supporting policy/state scaffold. Phase 04 Native signatures are implemented in the Node FROST runtime.

## Phase 03 phase notes

- Keep message authorization binary and canonical; do not use JSON as an economic authorization encoding.
- Use exact integer accounting only.
- Keep production readiness false and Mainnet activation disabled.

## Phase 04 phase notes

- Do not treat Ed25519 attestation or phase-02 deterministic Rust test shares as FROST.
- KingPepe Native signing evidence from read-only recovery material identifies the required path as Taproot/BIP340.
- The Phase 04 runtime uses pinned `@noble/curves` `2.3.0` `schnorr_FROST`.
- Phase 04 implementation commit: `3494ebf70f9a432bd786ea17ca73a1177d8bf66d`
- Phase 04 CI: `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34281044175` PASS
- Required local checks:
  - `npm ci --ignore-scripts`
  - `npm run test:frost`
  - `npm audit --audit-level=low`
- Keep all generated test key material outside the repository.

## Phase 05 phase notes

- Bridge manager must not accept caller-provided proof flags.
- Transceiver owns attestation verification and receipts but must not hold mint authority.
- Mint authority must be a bridge PDA; freeze authority remains none.
- Production activation remains disabled.

## Phase 06 phase notes

- Native proof/reserve/recovery crates validate KingPepe Native headers, PoW,
  difficulty, chainwork, transactions, Merkle proofs, UTXO observations,
  reserve sweeps, and temporary-deposit recovery eligibility.
- Temporary recoverable deposits do not authorize minting.
- CI verified Phase 06 at `836b8e62e2c87fe8b2d3df48f7fc54466206b646`.

## Phase 07 phase notes

- Attestation uses Ed25519 project attestations, not FROST.
- Attestation keys remain separate from Native FROST shares and outside the
  repository.
- Transceiver instruction parsing binds Solana Ed25519 verifier instructions to
  the exact canonical message bytes.
- Solana observer logic must distinguish RPC observation from local validation
  and must `HARD_STOP` on unauthorized program, binary, upgrade-authority, Mint,
  or mint-authority changes.
- CI verified Phase 07 at `d17ba8fe61d20a88d4206f72d68a010a2d146524`.

## Phase 08 phase notes

- Phase 08 has a source-level automatic Native-to-Solana deposit pipeline
  boundary in `services/bridge-validator/automatic-deposit-pipeline.mjs`.
- The pipeline uses existing real FROST A+B signing, project attestation,
  canonical messages, adapter boundaries, replay checks, and exact BigInt
  accounting. It has no per-transfer KingPepe Team approval state.
- The pipeline exposes `processDepositAsync` for promise-returning local RPC
  adapters while preserving the same validation and accounting checks.
- Native reserve-sweep adapter boundaries now validate FROST transcript
  consistency, persist signed local REGTEST sweep transactions before
  broadcast, retry idempotently, and verify RPC-observed sweep evidence without
  claiming production consensus validation.
- The automatic deposit pipeline now includes a file-backed local journal for
  completed deposit replay and deposit-outpoint reservation across restarts.
- Required local executables were not available in the checked environment:
  `kingpeped`, `kingpepe-cli`, `solana`, `solana-test-validator`, and `anchor`.
- Current Solana crates include deterministic non-production localnet Program
  IDs, economic ABI decoding, program-owned account validation, receipt writes,
  and SPL Token CPI construction. A real local-validator E2E flow is still not
  claimed until the required localnet executables are available and exercised.
- Do not mark Native-to-Solana local E2E as passed until a disposable
  KingPepe regtest node and Solana local validator execute the full automated
  deposit flow without per-transfer KingPepe Team approval.
- Current local source-boundary check:
  - `npm run test:bridge-validator`
  - This covers the automatic deposit pipeline, async adapter path, Native
    reserve-sweep adapters, and the Solana deposit claim submitter
    source-boundary tests.
- Current Native RPC adapter check:
  - `npm run test:native-node`
- Current local E2E readiness check:
  - `npm run test:local-e2e-readiness`
  - `npm run local:e2e:plan`
  - `npm run local:e2e:bootstrap`
  - `npm run doctor:local-e2e` reports
    `BLOCKED_LOCAL_INFRASTRUCTURE_MISSING` until the required localnet
    executables exist and Solana economic instruction execution is exercised
    under a local validator.
- Phase 08 local E2E readiness gate commit:
  `6f22309770f3a2f85c96093bcf8af10b47065f31`
- Phase 08 local E2E readiness gate CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34293107931` PASS
- Phase 08 source-boundary implementation commit:
  `09e42e6856312a0c617eb9c14a0312012263722a`
- Phase 08 source-boundary CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34292181114` PASS
- Phase 08 fail-closed Solana entrypoint shell commit:
  `7eafd8a38d346dcb018005a7357a0012a84b0e0c`
- Phase 08 fail-closed Solana entrypoint shell CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34295554332` PASS
- Phase 08 validate-only Solana ABI status:
  instruction decoding and malformed/trailing-data rejection are implemented
  locally. This increment is superseded by the account-execution source
  increment below.
- Phase 08 validate-only Solana ABI commit:
  `201c5bdc2a2fb65601331b58115e0a7543179e12`
- Phase 08 validate-only Solana ABI CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34298518315` PASS.
- Phase 08 mint-authority PDA correction:
  the bridge manager now derives the mint authority with Solana
  `Pubkey::find_program_address` seeds and exposes the bump for future account
  initialization.
- Phase 08 mint-authority PDA correction commit:
  `94da519e7a50ea6692c445cfd307beb0fa491347`
- Phase 08 mint-authority PDA correction CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34299827083` PASS.
- Phase 08 Solana account-codec status:
  fixed binary account codecs exist for bridge state, deposit claims,
  withdrawal records, transceiver config, and verified receipts. Account
  execution and SPL CPI were still disabled at that increment. Implementation commit
  `16dec337ba321b4f37f6dd1dfb13cf5a221db3eb` failed Linux rustfmt in CI;
  corrective commit `804e03d4909ad002c0cf97798bd30cda56a7d4be` passed CI run
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34301859073`.
- Phase 08 Solana account-execution status:
  bridge manager and transceiver source now expose economic account execution
  entrypoints, program-owned PDA checks, fixed account writes, instructions
  sysvar Ed25519 loading, and SPL Token `mint_to_checked` / `burn_checked`
  CPI construction.
- Phase 08 Solana account-execution implementation commit:
  `c3b2686cf701bc7ed795aefe9c4ba1dfd75bf11e`
- Phase 08 Solana account-execution corrective/tested source SHA:
  `8309b3fc95bea4b84224852cb13e2f9b75099dfa`
- Phase 08 Solana account-execution CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34304533970` PASS.
- Phase 08 local E2E orchestration plan:
  `scripts/local-e2e-orchestrator.mjs` builds a local-only execution plan for
  Anchor build, Solana local validator, and KingPepe REGTEST startup. Runtime
  datadir/ledger paths are required outside the repository, Mainnet remains
  disabled, and the plan exits blocked until required executables exist.
- Phase 08 local E2E orchestration commit:
  `7ffd331358146bb990f9830d4f39c0849cc0bdeb`
- Phase 08 local E2E orchestration CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34305873353` PASS.
- Phase 08 local E2E bootstrap runner:
  `scripts/local-e2e-bootstrap.mjs` executes local infrastructure bootstrap
  only: version checks, Anchor build, disposable Solana local-validator
  startup, disposable KingPepe REGTEST startup, health checks, and cleanup.
  It does not claim the full economic Native-to-Solana E2E flow passed.
- Phase 08 local E2E bootstrap runner commit:
  `d392403733bbfb92fcfd2d50a1d3879d63f0e3bb`
- Phase 08 local E2E bootstrap runner CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34307355800` PASS.
- Phase 08 Native REGTEST RPC adapter:
  `native/node/native-rpc-client.mjs` provides loopback-first KingPepe JSON-RPC
  observation/broadcast boundaries for local REGTEST only. It returns
  `RPC_OBSERVATION` evidence and does not claim independent consensus
  validation.
- Phase 08 Native REGTEST RPC adapter commit:
  `845dfc4a86a1ef87f15e3d5ec2ca4ad91fd8fe8d`
- Phase 08 Native REGTEST RPC adapter CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34308850060` PASS.
- Phase 08 Solana deposit claim submitter:
  `services/bridge-validator/solana-deposit-claim-submitter.mjs` provides a
  localnet-only Solana RPC submission boundary for prebuilt deposit-claim
  transaction bytes after two project attestations. It persists the prepared
  operation before broadcast, checks submitted signature status before retry,
  requires finalized claim observation before reporting completion, and does
  not create a production activation path.
- Phase 08 Solana deposit claim submitter commit:
  `905a45b4c79d879e6ae27a05b3c7a39fed0a30f6`
- Phase 08 Solana deposit claim submitter CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34310531798` PASS.
- Phase 08 async deposit pipeline entrypoint commit:
  `024c0019745bc4671299af135740aa9d29963116`
- Phase 08 async deposit pipeline entrypoint CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34312011059` PASS.
- Phase 08 Native reserve-sweep adapters:
  local REGTEST reserve-sweep relayer and verifier adapters persist signed
  sweep transactions before broadcast, validate FROST A+B transcript
  consistency, retry idempotently, and verify finalized RPC-observed reserve
  transition evidence without claiming production consensus validation.
- Phase 08 Native reserve-sweep adapter commit:
  `9af93d22b9af9c1278354a33e35db469311332d9`
- Phase 08 Native reserve-sweep adapter CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34313600140` PASS.
- Phase 08 deposit pipeline file-backed journal:
  source commit `73df9906998f9783c309a0671739d19cfc6b589f`, CI
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34315069345`
  PASS.
- Phase 08 Solana deposit-claim observer:
  `services/solana-observer/solana-deposit-claim-observer.mjs` provides
  localnet-only finalized deposit-claim observation through loopback Solana
  JSON-RPC or an injected test client. It decodes the bridge deposit-claim
  account, verifies the observed operation ID and message digest against the
  requested operation, extracts SPL Mint freeze-authority state, and remains
  blocked outside localnet.
- Phase 08 Solana deposit-claim observer commit:
  `df49793f0595bb501e83405b79d21215283a1d0a`
- Phase 08 Solana deposit-claim observer CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34316743630` PASS.
- Phase 08 Solana deposit-claim transaction plan:
  `services/bridge-validator/solana-deposit-claim-transaction-plan.mjs`
  derives localnet bridge state, deposit claim, mint-authority, and
  transceiver receipt PDAs, builds exact `AcceptDepositClaim` instruction
  data, serializes a Solana legacy transaction message, and signs only through
  an injected local fee-payer signer. It does not load or store key files.
- Phase 08 Solana deposit-claim transaction plan commit:
  `42a5cdb3bcc60e0be7fb5d2395503f148b6d632f`
- Phase 08 Solana deposit-claim transaction plan CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34318547667` PASS.
- Phase 08 localnet Solana deposit-claim bridge adapter:
  `services/bridge-validator/localnet-solana-deposit-claim-bridge.mjs`
  connects the transaction-plan builder to the durable Solana submitter. It
  fetches or accepts a localnet blockhash, signs only through an injected
  fee-payer signer, submits through the existing localnet RPC boundary, and
  does not load or store key files.
- Phase 08 localnet Solana deposit-claim bridge adapter commit:
  `0a4c39a146d150b5291935fb2ce800100accc898`
- Phase 08 localnet Solana deposit-claim bridge adapter CI:
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34320747968` PASS.
- Phase 08 Solana deposit-claim observer account pass-through:
  source commit `dab03e8696267fa98488f312e1f2158df51dc815`, CI
  `https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34322782563`
  PASS. The localnet bridge passes the derived deposit-claim PDA and
  configured Mint account into the real finalized claim observer instead of
  relying on static observer defaults. Local tests passed: `npm run
  test:bridge-validator` (36 tests), `npm test` (2 protocol vectors plus 80
  Node tests), `npm audit --audit-level=low`, guardrails, JSON parse checks,
  and `npm run doctor:local-e2e`
  (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`).
- Phase 08 automatic pipeline to localnet Solana bridge/observer integration:
  source changes are pending commit/CI. The automatic Native-to-Solana
  pipeline now has a source-level integration test that submits through the
  real localnet Solana deposit-claim bridge, durable submitter, and real
  finalized claim observer using fake loopback RPC fixtures. Local tests passed
  before commit: `npm run test:bridge-validator` (37 tests), `npm test` (2
  protocol vectors plus 81 Node tests), `npm audit --audit-level=low`,
  guardrails, JSON parse checks, and `npm run doctor:local-e2e`
  (`BLOCKED_LOCAL_INFRASTRUCTURE_MISSING`).
- Real local E2E is still blocked by missing `kingpeped`, `kingpepe-cli`,
  `solana`, `solana-test-validator`, and `anchor`.
