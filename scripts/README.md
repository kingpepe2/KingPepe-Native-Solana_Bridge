# Project scripts

Current safe utilities:

- `local-e2e-readiness.mjs` checks whether the disposable KingPepe REGTEST and
  Solana local-validator prerequisites are available.
- `local-e2e-orchestrator.mjs` builds a local-only execution plan for the
  Native-to-Solana local E2E gate. It keeps Mainnet disabled, keeps runtime
  state outside the repository, and exits blocked until required executables
  are present.
- `local-e2e-bootstrap.mjs` executes only the local infrastructure bootstrap:
  version checks, Anchor build, disposable local validator startup, REGTEST
  startup, health checks, and cleanup. It does not claim that the full economic
  Native-to-Solana E2E flow has passed.
  It also exports a reusable harness that keeps the disposable services active
  while an injected local Native-to-Solana flow runs, then stops those services
  fail-closed.
- `local-e2e-native-to-solana.mjs` is the Phase 08 Native-to-Solana command
  runner. It composes the bootstrap harness with local REGTEST wallet funding,
  deposit intent creation, deposit transaction observation, and UTXO/finality
  checks. Until reserve-sweep construction, FROST-backed reserve broadcast,
  Solana mint submission, and reconciliation are exercised against real local
  daemons, it reports the full flow as not run rather than passed.
