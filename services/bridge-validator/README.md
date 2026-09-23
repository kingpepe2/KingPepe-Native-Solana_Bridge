# Burn service

`burn-service.mjs` runs only TEST localnet/devnet with private external configuration. The automatic serialized cycle observes, verifies, reserves, signs/broadcasts the exact Native burn, waits for finality, attests, claims, mints and reconciles. The protected journal and existing process lease survive restart. Public user endpoints are isolated authenticated loopback; resume is a private reviewed TEST command.

No caller-supplied proof flags, signer replacement, arbitrary raw signing, Mainnet admission or reverse path exists. Read the root README and current readiness before running it. Never point this service at a retained reserve-model journal.

For Devnet, the private `solanaEndpoint` setting can contain the literal `ENV:SOLANA_DEVNET_RPC_URL`. The protected launcher supplies that process variable from its protected RPC store. The credential is never needed in the service configuration or command arguments. Missing or malformed values fail closed; actual Devnet genesis is still checked for every RPC operation. The reference cannot admit Mainnet or a local-validator endpoint.
