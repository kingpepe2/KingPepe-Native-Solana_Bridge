# Chain identity and pause checks

The Solana observer compares a reviewed manifest against one finalized account
snapshot. It checks cluster genesis, Manager and Transceiver Program IDs,
loader/ProgramData bindings, accepted deployment slots, expected upgrade
authorities, Mint, PDA mint authority, no freeze authority, standard Token
Program and exact configuration PDAs/epochs. Setup separately checks zero supply.
The observer never adopts a new identity from an RPC reply.

Executable account layouts remain bounded. Binary hashes are build/release
evidence, not runtime allowlists. An upgrade changes the accepted deployment slot
and pauses authorization even if the upgrade authority remains the same.
The V2 manifest omits executable hashes and lengths. Old manifests/progress fail
closed; there is no automatic migration, replacement state or approval.

The localnet RPC is timed, bounded and redirect-free. Genesis is read before and
after the finalized snapshot. Missing or stale evidence suspends authorization.
Confirmed Program, Mint, authority, configuration or accepted-chain mismatches
record an incident and pause the bridge. Solana evidence remains RPC_OBSERVATION.

Native evidence checks use the pinned source and independent raw parser for
headers, PoW, difficulty, chainwork, Merkle inclusion and transaction facts.
Current canonical choice and UTXO state still depend on the validating node.
Temporary deposits are not reserve.

Before finality, a reorganization means wait and re-evaluate. A higher-work
branch contradicting an accepted deposit, sweep or payout pauses the bridge and
retains the affected operations and evidence for KingPepe Team review. Monitoring
and reconciliation may continue read-only. There is no automatic confiscation,
balance repair, replacement mint or second payout.

Progress is retained through the shared protected storage and process lock.
Restart or healthy observations cannot clear a retained integrity pause.
Full-host snapshot rollback resistance is not claimed. See
[build instructions](../deployment/local-e2e-build.md) and
[development status](../development-status.md) for validation scope.
