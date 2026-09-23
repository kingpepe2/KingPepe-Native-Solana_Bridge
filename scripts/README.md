# Project scripts

Current commands are defined in package.json. Runtime state and build outputs must be outside every checkout.

- `local:proof:burn` runs the actual isolated KingPepe REGTEST source/policy, nonzero burn, UTXO, finality/reorg and restart/reindex proof.
- `local:e2e:native-to-solana` runs real isolated REGTEST and Solana local-validator burn evidence, attestation, claim/mint, replay and conservation tests with the pinned programs.
- `local:e2e:windows-runtime` runs the protected Windows runtime against isolated chains, including lost broadcast responses, process crash/recovery, automatic service processing and the finalized-RPC-read race.
- `burn:service` starts the reviewed authenticated loopback TEST service using a private configuration reference. A restart never clears an existing critical/operator pause.
- `test` runs retained canonical protocol, burn, Native RPC, Solana observation, validator and publication-policy tests. `test:windows-security` covers actual CurrentUser DPAPI/ACL protection without claiming distinct service-principal or portable recovery certification.
- `source-audit.mjs` checks provenance coverage and publication boundaries. Separate redacted current/staged/outgoing/history secret scans and dependency-license review remain required.

Use the pinned tools and commands in docs/deployment/local-e2e-build.md. Source built Native REGTEST only; no Mainnet economic action is authorized by these commands. Retired reserve/FROST runners are not current entrypoints. Missing evidence is a block, never a test pass.
