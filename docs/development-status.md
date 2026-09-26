# Current Bridge status

**KINGPEPE MAINNET BRIDGE — ACTIVE.** Public deposits are available through the official [Bridge](https://kingpepe.net/bridge) when its live availability checks pass.

The official KPEPE Solana Mainnet Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`. Token metadata is published. Bridge deployment, controlled activation, exact burn/mint reconciliation and public activation have completed. The live counter uses verified completed Mainnet accounting; development transfers are excluded.

The production architecture is **ONE WAY: KingPepe Native → irreversible Native burn → verified burn finality → exact 1:1 Solana mint**. Bridge fee is **0**. Native deposits require **12 confirmations** before automatic processing.

The [public Mainnet status guide](deployment/public-mainnet.md) explains the live API and display freshness policy. Current release checks are available in [GitHub Actions](https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions). The dated [source review progress report](deployment/source-audit-2026-09-25.md) is a historical record of that review stage. Historical reports retain their original source, network and status; they do not describe current production availability.

Custody, upgrade, and recovery controls are documented internally. Relevant security-assurance information will be published alongside the results of an independent security audit.

The current public status is available at [the status API](https://kingpepe.net/api/v1/bridge/status). Verification holds can temporarily restrict new operations; only the current live response determines availability. A documentation status update never bypasses these checks.
