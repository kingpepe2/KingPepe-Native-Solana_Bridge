# Protected deposit operation journal

This localnet-only Phase 08.5 increment adds a protected Bridge Validator
operation/accounting boundary. It does not implement Phase 09, enable production,
or by itself complete the unattended deposit controller and relayer.

Explicit enrollment binds the service identity, instance, deployment, Native
genesis, Solana genesis, epoch and exact policy. CurrentUser DPAPI, separate
external state/anchor roots, the existing retained service-profile witness and
a lifetime lease are mandatory. Missing, inaccessible or uncertain storage is
never replaced with plaintext, empty state or a new identity.

An immutable plan retains the recoverable deposit commitment, recipient, exact
input outpoints/amounts/scripts, unsigned sweep, accepted checkpoint and every
Native signing intent. It recomputes the transaction and per-input sighashes.
All inputs are reserved across operation IDs; prior bridge backing cannot become
another deposit's miner-fee input. The experimental format permits one canonical
reserve output, separately funded fees and no replacement signaling. Limits are
bounded localnet parser/storage constraints, not approved production limits.
At most fifteen input transactions leave room for the sweep in the Native
verifier's sixteen-transaction evidence packet. The local sweep builder explicitly
requests non-replacement and rejects replacement-signaling input sequences:
the pinned Native RPC otherwise defaults to replaceable transactions. This
disables bridge replacement construction, not the node's general mempool policy
or the ability of compromised signing identities to create another spend.

Signed witness bytes must verify against that exact plan before retention.
Broadcast intent is persisted before releasing those bytes to a relayer. The
relayer still needs its own fresh global authorization, a query of previous
outcomes and exact-byte retry; this journal does not authorize alternate inputs,
RBF, CPFP, a refund or a replacement mint.

Finalized reserve and its exact owed credit occupy one protected CAS transition.
The entry point requires an actual Native-verifier result, not serialized
provider fields or a caller's verification flag. A retained credit remains owed
while attestation or Solana submission is delayed. Retaining an already-created
obligation or signature remains possible during a global stop, but that cannot
authorize another economic action.

Mint settlement requires a live genesis-bound finalized claim observation. The
observer verifies the canonical signed legacy transaction packet, its exact
claim/recipient/amount/program identities, the reported SPL MintToChecked CPI,
and the exact integer recipient balance increase. An unrelated successful
transaction plus a pre-existing claim is insufficient. The receipt retains the
transaction identity and rooted slot; it is not a boolean settlement flag.
This remains RPC_OBSERVATION. Signed transaction verification does not prove the
RPC's execution metadata honest or replace deployment-integrity monitoring.

Reopen checks the complete authenticated image and policy. An uncertain write
can be recovered only at the exact expected next revision with matching bytes.
Detected rollback or authenticated journal corruption is reported through the
durable global-integrity outbox, including when its supervisor is unreachable.
Retained input locks and credits are not automatically pruned. Capacity exhaustion
fails closed. Full privileged host/profile/state co-restore remains a risk.

The accounting view distinguishes unresolved signed sweeps, finalized reserve,
authorized unminted credits and recorded mint settlement. It is not an assertion
that every on-chain outcome has already reached the journal. A consistent
reconciliation service must independently query chain outcomes and catch up
missing credit/mint facts before classifying surplus or permitting new actions.
The journal exposes a mutually authenticated RECONCILIATION-only read API.
One operation per page, exact revision binding and a final revision check prevent
mixing changing journal snapshots. The client validates and freezes the complete
image; a page failure or concurrent update requires a fresh read. This grants no
write/signing capability and does not itself constitute chain reconciliation.

Portable tests use actual ephemeral FROST and packet signatures with explicitly
synthetic chain/execution fixtures. Actual local-validator claim tests are a
separate gate. Windows journal tests use real current-principal DPAPI and mTLS,
not distinct service identities. Neither category certifies complete protected
service recovery. The full controller, broadcast-to-credit rediscovery, protected
claim outbox, live reconciliation and all-boundary real-chain process-kill matrix
remain required. No per-transfer Team approval or verification bypass is added.
