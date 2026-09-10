# Attestation and Solana observation

## Implemented local boundaries

Native signing is separate from two project Ed25519 attesters. Each local
attester's policy checks the same canonical deposit-credit bytes, deployment,
epochs, reserve transition and evidence digest. The local E2E additionally
invokes raw Native evidence validation for each role. The generic attester class
alone accepts evidence through a policy interface; it is not a validating node.
Two signatures prove who signed, not that their chain assertions are true.

Phase 08.5 copies the attester key into a private field, freezes normalized policy
and identity, isolates caller mutation, makes close irreversible and checks the
actual clock when no test clock is supplied. Explicit historical vector clocks
are test inputs, not an expiry bypass or a production clock source.

The real Transceiver requires two distinct authorized Ed25519 verification
instructions over identical canonical bytes. Instructions sysvar identity,
program/index/offset/length/key/message constraints are checked. Finalized receipt
creation precedes a separate atomic claim/mint transaction. The Manager, not
the Transceiver, holds mint authority through a PDA.

The local deposit observer reports RPC_OBSERVATION, even for a locally launched
validator. It reads transaction meta, finalized slot, claim account and SPL Mint;
checks PDA, layout, account program, snapshot freshness, decimals and mint
authority; and exposes freeze authority for downstream hard-stop policy.
Its RPC transport is loopback-only, redirect-disabled, timeout/body-bounded and
requires matching JSON-RPC response IDs. Malformed, oversized, unavailable or
error responses never become evidence; provider details are not surfaced.

The withdrawal observer remains a POLICY MODEL, not a running withdrawal
service. It checks supplied program/authority, transaction, burn and account
fields against expected values. Phase 08.5 corrects its PDA helper to real Solana
derivation, adds Native protocol/network/genesis binding and exact slot/root
validation, and unconditionally blocks non-localnet use. A configured=true flag
cannot select a nonexistent production observer.

## Trust and missing guarantees

RPC_OBSERVATION, LOCAL_VALIDATION (the current code's local-validation label),
and PROJECT_ATTESTATION are distinct. LOCAL_VALIDATION labels supplied to a policy
model are not independent chain proofs. Shared-host services or sources are not
physically independent observers. The model is KingPepe Team controlled,
PROJECT_ATTESTED_2_OF_2, not decentralized or trustless.

ProgramData address/hash and upgrade-authority comparisons currently operate on
supplied identity objects. There is no complete independently sourced, continuous
deployed-bytecode/authority watcher wired to a durable bridge-wide stop.
The deposit observer does not independently collect genesis/ProgramData history.
A static program ID or an arbitrary RPC finalized claim cannot supply those
missing guarantees. Production observation remains BLOCKED.

Local claim/accounting hard stops persist in their scoped journals. This does
not establish a global stop across all services, coordinator replacement,
co-restored snapshots or post-mint deep reorganizations. Complete service
recovery, protected attester key storage, authenticated IPC, freshness/fencing
and production observation still require implementation/review. The local E2E
is evidence of the exercised flow only. External review is NOT_RUN.
