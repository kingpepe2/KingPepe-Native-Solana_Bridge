# Protected Solana deposit delivery

The relayer transports a fully signed canonical receipt or claim packet. It
does not hold a fee-payer private key, Native share, mint authority, attestation
authority, or economic settlement capability. This adapter is Localnet-only;
it cannot be enabled against Mainnet by replacing an endpoint.

The policy pins the operation deployment, actual validator genesis, deployed
programs/ProgramData/bytecode/authorities/configuration and fee-payer public key.
Validation reconstructs the entire supported legacy transaction, verifies its
Ed25519 transaction signature and both distinct authorized project attestations,
and binds the amount, recipient, operation and canonical message. Arbitrary
instructions, alternative account ordering and re-signed substitutions fail.
Ed25519 is not Native FROST; Native remains the unchanged exact A+B BIP340 path.

The separate protected relayer journal uses the existing DPAPI, lifetime lease,
CAS and retained profile witness. It persists acceptance before IPC response and
an exact signed packet/send attempt before RPC. IPC is certificate/role/domain
bound, with only the bridge validator permitted to enqueue or inspect it.
One loopback endpoint feeds both strict concrete RPC adapters; no injected
callback or caller boolean can attest deployment integrity.

Before sending, the worker reads the retained signature outcome, finalized block
height and one finalized bank containing deployment, receipt and claim accounts.
It repeats observation and global admission after durable preparation.
Acknowledgement is not finality. Restart reuses exact bytes and operation identity.
A finalized expected account is only a transport observation: the independent
execution observer must validate the actual claim transaction/CPI before the
operation journal records settled mint credit.

Blockhash replacement is permitted only after retained finalized evidence of an
expired unseen or failed old transaction, with the same economic authorization,
a new hash/later expiry and no backward bank progress. All previous packets remain
recorded. The transport never re-signs a packet, extends an attestation window,
auto-clears a stop or refunds/remints because a response is lost. A replacement
producer and the complete protected controller remain integration dependencies.
Unresolved or stale evidence waits. Confirmed deployed/account/transaction
contradictions enter durable integrity stop; read-only observation may continue.

Bounds are explicit: 128 retained deliveries, at most eight packet versions per
operation/stage, 32 sends per packet, 900 KB of journal data and backoff up to
30 seconds. Capacity exhaustion waits; replay markers are not silently pruned.
These are local resource bounds, not approved production financial limits.

## Evidence and limitations

The new packet/state suite passes 33 tests and the canonical receipt verifier
passes eleven additional tests. Seven actual CurrentUser DPAPI/mTLS tests cover
lost IPC/send/write responses, observed expiry before replacement, finality
contradiction, stop-before-send, duplicate lifetime and restored stale state.
Their HTTP chain responses are synthetic; they are not validator proof.

A separate fresh regtest plus Solana validator test passes nine Windows checks
and fourteen chain checks through COMPLETED. Both receipt and claim actors are
killed after actual validator acknowledgement, before recording the outcome.
Reopened protected state observes their actual finalized accounts without a
second send. Lost protected-write acknowledgement also recovers safely. An
independent actual claim-execution query discharges the pending credit once and
read-only reconciliation returns to a matching consistent snapshot.

The separate candidate's 194-file runtime digest, including C# sources, is
1a896a1cc8510011d09d3cade9bdf38d8d5a01d8bc644efcb22fe729f253f3a4.
The fixture imports the chain-derived pending credit as explicit test setup;
Linux creates real ephemeral FROST/attestation material beforehand. This is not
a full protected FROST-to-attester controller, cross-service SID certification,
independent consensus verification, production activation or external audit.
The primary integration independently passes nine Windows plus fourteen chain
checks through COMPLETED, full Windows security 147 and Node 879 plus two vectors
on each platform. Its unchanged 194-file runtime digest is
99b9a8bda86fd220c8eb8518c471e72acf1ae1a9ed3bd85821a30dc3f3bfe446.
The complete protected controller and final clean-clone validation remain open.

The pre-existing full-host/profile/state co-restore and privileged compromise
limitations remain. A global off-chain stop cannot revoke a packet already
submitted or an attestation already released. No confiscation, financial repair,
Phase 09 payout or production service installation is implemented here.
