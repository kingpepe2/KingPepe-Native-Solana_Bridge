# Project scripts

Current safe utilities:

- `local-e2e-readiness.mjs` checks whether the disposable KingPepe REGTEST and
  Solana local-validator prerequisites are available.
- `local-e2e-orchestrator.mjs` builds a local-only execution plan for the
  Native-to-Solana local E2E gate. It keeps Mainnet disabled, keeps runtime
  state outside the repository, rejects wallet raw-signing RPC shortcuts, and
  exits blocked until required executables are present. Native raw transaction
  broadcast remains available only for transactions already signed by the
  approved FROST path.
- `local-e2e-bootstrap.mjs` executes only the local infrastructure bootstrap:
  version checks, direct SBF builds, disposable local validator startup, REGTEST
  startup, health checks, and cleanup. It does not claim that the full economic
  Native-to-Solana E2E flow has passed.
  It also exports a reusable harness that keeps the disposable services active
  while an injected local Native-to-Solana flow runs, then stops those services
  fail-closed.
- `local-e2e-native-to-solana.mjs` is the Phase 08 Native-to-Solana command
  runner. It composes the bootstrap harness with local REGTEST wallet funding,
  a disposable FROST aggregate Taproot deposit/fee/reserve intent, local Native
  source/genesis validation, raw deposit transaction identity checks,
  UTXO/finality checks, and non-secret proof fingerprinting. It uses the
  recovered KingPepe REGTEST facts of 8 decimals, coinbase maturity 20, and
  Bech32m HRP `rkpepe`. It drafts an unsigned local REGTEST reserve sweep with
  exact integer miner-fee accounting and computes BIP-341 key-path
  `SIGHASH_DEFAULT` evidence for each FROST-controlled input. It then prepares
  localnet-only per-input signing intents, signs each input with the disposable
  software FROST A+B runtime, and attaches key-path Taproot witnesses without
  using wallet raw-signing RPC shortcuts. When the local daemons are available,
  it broadcasts the signed reserve sweep with `sendrawtransaction`, mines local
  finality, independently validates the finalized reserve transaction, obtains
  both project attestations, submits the Solana claim, observes finalized minting
  and reconciles the reserve and pending credit through COMPLETED.
  Missing tools or failed transitions are reported explicitly, not as a pass.
