# Working on KingPepe Native → Solana

The KingPepe Team's final product is ONE-WAY: Native deposits become Solana
KPEPE representation. Preserve signing, finality, replay, exact accounting,
restart safety, protected secrets and simple pause. No new roadmap phase or
experimental hardening platform.

## Source and operational boundaries

- One writer per involved checkout. Stop on genuine concurrent source changes.
  No reset, clean, restore, stash or automatic rebase of useful work.
- Permanent reverse-function removal and a purpose-built public-history rewrite
  are explicitly Team-authorized. Finish current forward tests first. Preserve
  a verified private rollback mirror, inspect all intended refs/artifacts, scan
  rewritten history, use force-with-lease where applicable and validate NEW HEAD.
  Old SHA/CI evidence never certifies rewritten source. Do not affect other repos.
- Original code is proprietary All Rights Reserved. Preserve third-party notices
  and historical license grants; rewriting source history does not revoke them.
- FROST is required for forward recoverable-deposit reserve sweeps. Retain Noble
  curves 2.3.0 schnorr_FROST secp256k1/BIP340/BIP342, exact 2-of-2 A+B, separate
  software processes/protected shares/nonce state, no fallback/coordinator share.
  SINGLE_HOST is accepted; common-host compromise/outage can affect both.
  Upstream FROST is UNAUDITED. Ed25519 is for project attestations/Solana identities.
- Retain nonce tombstones, exact transaction binding, process exclusion, durable
  operation IDs and persist-before-broadcast. Missing proof never authorizes mint.
- Secrets, wallet state, ledgers, backups, RPC credentials and private paths stay
  outside every checkout/public artifact. No plaintext production fallback.
- No advanced clone/fence/rollback-anchor system, extra database, HSM or second-host
  requirement. Full-host rollback and distinct Windows principals are not certified.
- Critical contradiction pauses new economic processing. Read-only monitoring may
  continue. No automatic economic repair; explicit reviewed resume is required.
- Wallet Standard is a public recipient connection. No user transaction signing
  or private-wallet material is requested by the one-way Bridge interface.

## Phase 19 boundary

Complete all safe non-funding one-way Mainnet readiness. Preserve the live TEST
interface until actual production identities exist. Local protected production
preparation is authorized, but no Mainnet deployment/economic transaction now.
Keep productionReady=false, mainnetActivation=DISABLED,
productionSigningAuthorized=false, productionBroadcastAuthorized=false.

Approved Native deposit/sweep finality: 12 confirmations. Approved recovery CSV:
1,440 Native blocks. Solana commitment: finalized. Sweep miner fees require
DYNAMIC_NODE_ESTIMATE_WITH_CAP with actual measurements, integer arithmetic,
relay floor, operator funding and measured caps; no invented fee fallback.
Production mint transfer/window policy: UNBOUNDED_BY_TEAM_DECISION. Accounting,
available backing, finality, replay and mismatch pause remain mandatory.

After frozen artifacts and all other readiness, calculate actual Mainnet SOL
requirements. Funding is not approval. After funding and unchanged-artifact
preflight, STOP for KINGPEPE_TEAM_ACTIVATION_APPROVAL. After approved deployment,
Phase 20 is one controlled forward transfer; request
CONTROLLED_ACTIVATION_TRANSFER_AMOUNT before economic action if still unset.
Activate only after COMPLETED, exact supply delta and MATCH with all health checks.
Normal valid forward transfers need no per-transfer Team approval.

Upgrade model is SINGLE_KEY_WITH_REVIEW_CONTROL, upgradeReviewWindow=NONE,
fixedTimelock=false. Follow docs/security/program-upgrades.md. Its centralized
trust remains accepted. externalSecurityAuditCompleted=false; an external audit
is not a Team-required gate, but known unsafe blockers are never waived.

## Validation

Use external build/runtime directories and locked dependencies. Pins are in
scripts/local-e2e-toolchain.json: Node24.21/npm11.19, Solana Rust1.89, Native
nightly-2023-10-29, Agave4.2.2, SBF4.1/platform-tools v1.54. Direct SBF needs no
Anchor CLI. Native test node is source-built KingPepe31.1 REGTEST.

- npm ci --ignore-scripts; npm test; npm audit --audit-level=low
- npm run test:windows-security; npm run test:user-interface
- Python guardrails, source audit, dependency license audit and secret scans
- Solana locked workspace check/test/fmt/Clippy -D warnings and SBF builds
- Native proof/reserve/recovery locked check/test/fmt/Clippy per manifest
- Fresh isolated local forward/security/service/recovery tests
- Fresh REGTEST → DEVNET with canonical-byte equality, no double mint and MATCH
- Current/public API, SDK, CLI, UI, runtime and Solana ABI absence regressions

Review → tests/scans/provenance → explicit staging → focused commit → authorized
publication → new exact-SHA CI. Encoding and callers land together. Preserve
forward tests and original Native consensus encoding. Keep required upstream
bincode dependencies/advisories visible. Do not replace unknown state or keys.

The source-bound current status is docs/development-status.md and
BRIDGE-READINESS.json. Mainnet is not deployed. Tests and private historical
evidence must be described at their actual scope, without certification claims.
