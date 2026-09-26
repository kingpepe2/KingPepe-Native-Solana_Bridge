# Working on KingPepe Native → Solana

Preserve the one-way Burn → Mint protocol, exact accounting, finality, replay protection and restart safety. Keep user-facing behavior simple. Preserve unrelated work; do not reset, clean, restore or stash a checkout. Historical records are not current deployment evidence.

The public Mainnet Bridge is active following completed deployment and controlled activation. Current availability must still be verified through the official status API. Source review or documentation changes do not authorize economic actions. Follow the current Team instruction for the task and retain all economic safety checks. Never infer activation from a presentation change.

## Permanent publication policy

Follow docs/public-documentation-policy.md for every public material change. Public documentation explains product behavior and economic guarantees. Keep detailed operational and security records privately, outside publication. Do not publish privileged implementation details or private configuration. Do not claim an independent audit has occurred.

Preserve original internal documentation before sanitizing it. Classify public documents and historical summaries accurately. Historical evidence must retain its actual network and source; do not relabel it as Mainnet. Necessary implementation and regression code must remain intact: never weaken controls or rename code solely to obscure them.

## Validation and publication

Use pinned tools in scripts/local-e2e-toolchain.json and locked dependencies. Keep build outputs and isolated test state outside checkouts. Preserve existing state and stop only processes owned by the test run.

Run applicable Node and Rust tests, required platform tests, formatting, Clippy, dependency/license checks, guardrails, source/provenance checks, documentation checks and secret scans. Review changes, stage explicitly, commit a coherent tested milestone, push only authorized refs and verify CI for that exact SHA. Never describe an unrun check as passed.

Original code remains proprietary All Rights Reserved. Preserve required third-party notices and historical licensing facts. Source-bound evidence certifies only its named source and scope.
