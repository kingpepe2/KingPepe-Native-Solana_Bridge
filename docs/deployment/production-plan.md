# Production deployment plan

This is a non-secret plan, not an executable deployment configuration or
authorization. Mainnet is **not deployed**. `productionReady = false`,
`mainnetActivation = DISABLED`; production signing/broadcast remain unauthorized.
No production services, reserve movement, funding or Mint creation are requested
by local configuration preparation.

## Prepared roles and required references

| Role | Public identity or requirement |
| --- | --- |
| Dedicated upgrade authority | `4C6VWWdS7CPx7Rdv6iJpB3bfpabr8Tq1dnFDCgMc8qzY` |
| Dedicated, unfunded production fee payer | `47EPgcpqc11Bo3ghi22LrTA2AERFLnuXccnZhTqoEkFb` |
| Manager | `kingpepe-bridge`; production Program ID not selected |
| Transceiver | `kingpepe-transceiver`; production Program ID not selected |
| KPEPE Mint | Standard SPL Token Program; 8 decimals, initial supply `0` |
| Mint authority | Expected Bridge PDA derived from the approved production identities |
| Freeze authority | None |

The two prepared keys are distinct, DPAPI-protected local identities. Neither
may be reused as relayer, attester or FROST material; production identities must
not reuse Devnet/test keys. No automatic fee-payer funding is authorized. Public
role/address comparison does not certify roles that have not been provisioned.

Local configuration refers to `SOLANA_MAINNET_RPC_URL` and
`KINGPEPE_NATIVE_MAINNET_RPC_URL` by variable name only. It also uses
`SOLANA_MAINNET_FEE_PAYER`, `KINGPEPE_NATIVE_RESERVE_CONFIG`,
`KINGPEPE_NATIVE_RUNTIME_ROOT`, `KINGPEPE_PRODUCTION_RUNTIME_ROOT`,
`KINGPEPE_PRODUCTION_LOG_ROOT` and `KINGPEPE_PRODUCTION_BACKUP_ROOT`.
The existing Native adapter's optional private cookie reference is
`KINGPEPE_NATIVE_MAINNET_COOKIE_FILE`; credentials must not be embedded in URLs.
These are local references, not public values or a plaintext Solana CLI keypair.
Keep all endpoints, key paths, protected material, journals and backups outside
Git and public evidence.

## Readiness before activation approval

1. Configure both private RPC variables and verify the actual Solana Mainnet and
   KingPepe Native Mainnet genesis/network identities through read-only calls.
   A variable name or endpoint hostname is not network evidence.
2. Bind the approved production reserve and separate A/B protected shares/nonce
   state, attesters, role references and existing journal. Keep `SINGLE_HOST`,
   exact 2-of-2 and no fallback/coordinator share. Do not copy test secrets/state.
3. Validate actual Mainnet runtime compatibility. At preparation baseline
   `3a19e20f127e40225238c879602ee8dd5ed76ce4`, Native signing admission requires
   localnet/regtest and Solana admission is test-network-only. Local directories
   and JSON references are not a working Mainnet configuration. This document
   does not remove those checks or authorize relabeling test configuration.
4. Keep runtime `PAUSED`, autostart off, deposits/withdrawals/mint/payout disabled.
   Reuse `LocalBridgeService` and `AuthenticatedLocalDepositLedger`; do not add
   another database or start public services during preparation.
5. Verify the private backup root and the existing
   [encrypted recovery runbook](../security/deposit-operation-recovery.md).
   Current `recoveryProcedure = TESTED` covers isolated same-account localnet and
   Devnet recovery, not replacement-host recovery or arbitrary stale snapshots.
   A local backup on the common host does not provide host-loss protection. No
   production snapshot or destructive restore is performed by this preparation.
6. Select the exact reviewed deployment source, approved production identities
   and build options. Build both programs with pinned tools; record and compare
   reproducible byte lengths/hashes. Use the existing
   [build instructions](local-e2e-build.md), but never run a test enrollment
   harness against Mainnet. Default local-test and release architectures have
   different artifacts; Devnet evidence alone is not production certification.
7. Require retained both-direction, Borsh, reserve, replay/double-action,
   restart/recovery, reconciliation and Phase-17 evidence; run required affected
   tests, secret scans, guardrails/provenance and the exact source's required CI
   jobs. This documentation milestone also requires its own matching CI run.
8. Resolve known unsafe blockers, verify dedicated authority/configuration, then
   stop for explicit `KINGPEPE_TEAM_ACTIVATION_APPROVAL`. It has not been given.

Current blockers are missing private RPC values, unconfigured production
reserve/protected-role/journal bindings and test-only runtime admission. The
public plan is prepared; Phase 19 readiness is not PASS.

## Deployment order after explicit approval only

1. Recheck the approved source, artifact hashes, cluster and public identities.
   Use dedicated production program/Mint identities, never existing Devnet IDs.
2. Deploy the reviewed Manager and Transceiver artifacts with the dedicated
   upgrade authority selected explicitly and the separate fee payer. Do not
   rely on CLI wallet defaults to choose authority. Solana distinguishes the
   executable Program from its ProgramData and upgrade authority; see the
   [official deployment documentation](https://solana.com/docs/programs/deploying).
3. Derive the Bridge/Transceiver config PDAs and Mint authority with the retained
   ABI/PDA helpers and approved production IDs. Create and initialize the
   zero-supply KPEPE Mint and bound configurations using the reviewed setup
   transaction order and required signatures. Keep the bridge paused. Never
   reuse test attesters or introduce an alternate minter/freeze authority.
4. Query finalized chain state: verify genesis, Program/ProgramData, exact
   deployed bytecode hashes/lengths, upgrade authority, Mint/token program,
   decimals, supply `0`, Bridge PDA mint authority, freeze authority None,
   config PDAs, cross-program/Mint/attester bindings and pause/limit settings.
5. Retain only public program/Mint/PDA addresses, transaction IDs, source SHA,
   Borsh V2 schema and artifact hashes in deployment evidence. Record private
   runtime/custody details only locally. Start approved services PAUSED only
   after verification; normal transfers remain disabled until Phase 20 passes.

Future production upgrades follow
[`SINGLE_KEY_WITH_REVIEW_CONTROL`](../security/program-upgrades.md): reviewed
source/diff/build/hash, tests, exact-SHA CI, secret scan, target/authority checks
and specific KingPepe Team approval. `upgradeReviewWindow = NONE`,
`fixedTimelock = false`; no enforced time delay or automatic scheduler. The
authority remains a centralized trust point. Normal valid transfers acquire no
new delay or per-transfer Team approval.

External review is `NOT_REQUIRED_BY_TEAM` and
`externalSecurityAuditCompleted = false`. Accepted common-host risk, unaudited
Noble FROST and scoped recovery limits remain explicit; see the
[Devnet report](devnet-report.md) and [readiness](../../BRIDGE-READINESS.json).
