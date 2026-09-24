# Working on KingPepe Native -> Solana

The Team's current architecture is ONE_WAY_AUTOMATIC_BURN_AND_MINT. Its source and isolated REGTEST burn proof were required before conversion. The previous reserve/FROST model is superseded. Preserve signing, 12-confirmation deposit and burn finality, replay protection, exact accounting, restart safety, protected secrets and simple pause. Do not create a new hardening framework.

## Boundaries

- One writer per checkout. Preserve unrelated work. No reset/clean/restore/stash or automatic rebase. Legacy runtime, wallets and journals remain read-only until a reviewed TEST cutover.
- The Team has explicitly authorized the initial Mainnet deployment and controlled activation. Verify the retained payer, funding, exact reviewed source/artifacts and target identities before each transaction. Keep productionReady=false and mainnetActivation=DISABLED until the controlled real burn/mint and normal runtime enablement pass. Funding does not bypass pre-burn checks; never burn on a failed prerequisite. Do not request another generic deployment approval for this authorized execution.
- Burn custody is SINGLE_KEY_ACCEPTED_RISK, server-side DPAPI, protected ACL, dedicated service identity target and encrypted offline recovery. No FROST burn/sweep key. Keep Noble curves 2.3.0 for BIP340/BIP341 and Ed25519. Never reuse burn, payer, upgrade or attester keys across roles.
- Unique single-use operation address and immutable Solana destination before address issuance. One deposit event, one burn, one mint; no batching or post-deposit manual approval. Late/multiple deposits are explicit exceptions.
- Exact received deposit = exact verified finalized burn = exact Solana mint. Separate Bridge fee inputs pay Native fees. Bridge fee=0. Use integers only, no rounding or user-value fee deduction.
- Cumulative issuance <= verified finalized burns and <=21M. Pending finalized burns remain obligations. Holder SPL burns do not reopen issuance capacity. UNBOUNDED product policy does not override these controls.
- Persist exact plans, reservations and signed packets before broadcast. Recover ambiguous responses from chain state. Critical contradiction persists a pause; no automatic economic repair.
- Secrets, RPC credentials, wallets, journals, private paths and backups never enter source/public artifacts. No plaintext production fallback. Cloudflare is not key storage.
- Original code is proprietary All Rights Reserved. Preserve third-party notices and historical grants. Authorized reverse-history cleanup must not rewrite unrelated repositories or pretend cached unreferenced GitHub objects have been erased.
- Wallet Standard connects a recipient; no private wallet material or reverse signing flow. TEST uses solana:devnet. Public gateway is authenticated loopback only, strict schemas/origin/rate/size/timeout checks, sanitized errors, no arbitrary RPC/signing/admin API.

## Validation and publication

Pins: scripts/local-e2e-toolchain.json, Node24.21/npm11.19, Solana Rust1.89, Native nightly-2023-10-29, Agave4.2.2, SBF4.1/platform-tools v1.54, source-built KingPepe31.1. External build and fresh isolated runtime directories only.

- npm ci --ignore-scripts; npm test; npm audit --audit-level=low.
- npm run test:windows-security (real CurrentUser DPAPI; not distinct-principal or portable-backup certification).
- Locked Solana and Native proof check/test/fmt/Clippy; retained SBF builds.
- npm run local:proof:burn; npm run local:e2e:native-to-solana; npm run local:e2e:windows-runtime.
- Fresh REGTEST -> DEVNET burn/mint, crash-after-burn recovery, exact supply delta and reconciliation, public TEST UI/gateway/security verification.
- Guardrails, source/provenance/license and current/history secret scans; review diff, explicit staging, coherent milestone commit, authorized push, exact-SHA CI with no required skipped step. Encoding changes and callers land together.

Current truth: docs/development-status.md and BRIDGE-READINESS.json. Never reuse reserve-model CI or recovery evidence as burn-model certification. Production upgrade policy remains SINGLE_KEY_WITH_REVIEW_CONTROL, no timelock/window, specific Team approval per upgrade. No external audit is claimed or required by Team. Continue the authorized initial Mainnet deployment; preserve state and report concrete funding or technical blockers. Runtime readiness must describe actual completed verification, not authorization alone.
