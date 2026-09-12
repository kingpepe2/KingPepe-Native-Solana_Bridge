# Chain identity and pause checks

The observer compares an authorized manifest with actual cluster genesis,
Manager/Transceiver program identities, loader/ProgramData relation, upgrade
authority, Mint, PDA mint authority, no freeze authority, standard Token Program
and exact configuration PDAs/epochs. It never enrolls a new identity from an RPC
reply. Initial zero supply is checked separately at setup.

One finalized account snapshot supplies a consistent bank context. The existing
loader parser also compares the approved executable length/hash and zero
allocated tail; these are ordinary manifest checks, not a separate binary
attestation service. Build hashes identify binaries, not Program IDs. Normal
SBPF v0 and local upgrade-test SBPF v3 builds are distinct evidence.

The localnet RPC is bounded, timed and redirect-free. Genesis is checked before
and after observation. Solana remains RPC_OBSERVATION; a provider's finalized
label or signed transaction does not independently prove execution metadata.
Program/Mint/authority changes cause a retained integrity pause, not only a log.
Missing or stale RPC results suspend authorization without inventing a deficit.

Native validation uses the pinned KingPepe source and independent raw parser
for headers, PoW, difficulty, chainwork, Merkle inclusion and transaction facts.
Canonical choice/current UTXO state still rely on the configured validating node.
Merkle inclusion alone is not unspentness. Temporary deposits are not reserve.

Before finality, reorganization means wait and re-evaluate. A higher-work branch
invalidating an accepted deposit/sweep records exact impacted operations and
backing, then pauses new economic authorization. The original evidence is kept.
A healthy chain or ordinary restart cannot clear the incident. No automatic
confiscation, balance correction, token burn or replacement mint exists.

Progress records bind network, manifest, height/work or finalized slot.
Backward/conflicting observations fail or wait according to whether evidence
proves contradiction. They do not guarantee detection when all host state is
restored together. Protected adapters use the same DPAPI/process-lock mechanism,
not independent registry witnesses or a new incident platform.

Actual local-validator identity mutations and regtest competing branches are
tested separately from parser fixtures. See deployment/local-e2e-build.md and
development-status.md for commands and exact outcomes. Production observation,
manifest approval, provisioning, independent review and activation remain
unconfigured. No production identities are included here.
