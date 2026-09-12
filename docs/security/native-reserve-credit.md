# Native reserve credit rediscovery

The recovery service starts from a protected retained plan, signed
sweep and persisted broadcast intent. It queries the actual configured Native
verifier again. Only a genuine raw-verification result can create a reserve
credit; a copied object, provider flag or callback assertion cannot substitute.

Finality and exact reserve output validation precede one protected CAS storing
both reserve and the corresponding pending user liability. Death before that
CAS leaves the signed/broadcast operation encumbered and rediscoverable. Death
after it retains one immutable credit. This observation/obligation retention
can proceed under suspended authorization, but never grants signing or minting
permission while the global authority is stopped.

The protected path uses the existing version-one binary message encoding and
operation/amount/domain validators. Its explicit evidence-digest domain
KINGPEPE_RAW_RESERVE_CREDIT_EVIDENCE_V1 binds policy, deterministic reserve
allocation and actual accepted raw-proof digest. The nonce binds that
allocation and the original deposit nonce. The acceptance checkpoint, validity
window and message are fixed after persistence. A retry revalidates the retained
checkpoint against the current chain; it cannot silently refresh an expired
message, change the recipient or create another allocation.

Each protected attester can use the concrete raw-evidence adapter to query
and independently reconstruct exactly those message bytes. Its own protected
authorization journal still prevents a second outpoint/allocation authorization
and checks current global admission before key access, signing and release.
Attestation remains a project statement, not independent consensus. Both
services may share the approved host and Native source trust boundary.

The earlier local E2E driver has its own historical evidence envelope; it is
not silently converted into this new protected-flow credit. The on-chain
Native-outpoint replay marker and each attester's retained authorization still
reject reuse under a different envelope. The protected Solana transaction outbox
is separately implemented and component-tested; complete protected-controller
integration remains incomplete work.
Expired pending credits remain liabilities and require a separately reviewed
renewal mechanism, not automatic reminting or erasure. Production remains
disabled. This is not an external audit.

The primary integration passes ten fresh raw-chain reconstruction checks after
fourteen actual deposit/claim checks. Two independent verifier calls derive the
same credit; wrong amount/recipient/evidence/nonce/epoch and copied proof objects
are rejected. The 194-file tested primary runtime digest is
99b9a8bda86fd220c8eb8518c471e72acf1ae1a9ed3bd85821a30dc3f3bfe446.
These are raw-evidence facts, not the complete protected-controller crash matrix.
