# Protected local deposit controller

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

This LOCALNET-only service composes the existing protected operation journal,
Native raw verifier, exact A+B signing jobs, Native delivery outbox, independent
attester services, separate fee payer and Solana delivery outbox. It holds no
private signing material and cannot enable production, approve payouts, clear
an integrity stop, remint a loss or change reserve inputs.

The controller stores bounded orchestration metadata in its own DPAPI context,
lifetime lease, CAS revision and retained service-profile witness. The separate
economic journal remains the sole reserve/credit accounting implementation.
Observation is persisted before verification. The configured Native source and
Rust verifier check the actual inputs before reserving the immutable plan.
Signers still independently recompute/validate their evidence and sighashes.

Signed sweep bytes and attempted broadcast are retained before the relayer
receives them. An authenticated negative delivery lookup is distinguishable
from a failed authentication or transport. An acknowledged sweep is independently
verified for finality before reserve-plus-credit is retained atomically. A crash
between that write and controller catch-up does not allocate backing again.

The exact canonical credit window is retained before verification. It is never
silently extended. Each distinct attester response is retained before proceeding.
The signed receipt and claim use the same retained economic bytes and identities.
A fee-payer request is persisted before requesting a signature; the exact signed
packet is persisted before enqueue. A response lost before packet retention
cannot have been sent by the fee payer, which has no broadcast method. Even so,
an unsigned intent is retained as expired only after a current deployment-bound
finalized height exceeds its last-valid height. Signed packets are never discarded;
replacement requires the relayer's finalized failure/expiry observation and the
same operation, amount, destination and attestations.

Receipt/claim account observations do not settle a mint. The existing protected
claim observer checks the actual successful transaction, its signed bytes,
instruction/CPI effects, exact claim, Mint and genesis. Only its private
capability can move the economic journal's pending credit to finalized supply.
Completion requires a coherent fresh reconciliation and unchanged journal
revision, plus current global admission. A confirmed contradiction is reported
to the durable global authority. Missing or stale evidence waits, never approves.

Read-only catch-up may retain an already-created liability while admission is
suspended. A hard stop blocks new signing, attestation and delivery. There is no
automatic clear/recovery administration in this controller. A bounded expired
credit, exhausted outbox or missing protected state suspends work rather than
creating a different economic entitlement. Authorized recovery/rotation policy
for such capacity/expiry limits is not certified by a short successful flow.

The current implementation is under integration, not full service certification.
Portable tests use synthetic chain facts with real ephemeral cryptography.
Protected component tests use actual CurrentUser DPAPI/mTLS and an explicitly
unavailable Native source. The first run was six pass/one fail: the correct
synchronous wrong-role rejection was tested using an asynchronous assertion.
The corrected complete seven-case rerun passes, with zero failures/skips/
cancellations (146330.939 ms). No storage rule was changed. The combined
controller-codec, fee-payer and Native-delivery portable target passes 68 checks;
these are not real-chain controller execution.
The first actual separate-process Windows/regtest/validator run used a frozen
205-file runtime digest
557cd7f9884bc4be283518936f80e9d11b2b6ff2d68c80132e2a15a8e1af05a8.
It finalized the protected A+B Native sweep, retained its credit and both
protected attestations, and finalized the Solana receipt. It then failed at
CLAIM_PACKET_RETAINED: a pre-enqueue catch-up lookup threw for an absent claim
delivery, preventing the initial enqueue. The disposable chain host was stopped;
the Windows parent reached its bounded timeout and completed cleanup. This is
FAIL, not a completed protected deposit or an infrastructure pass.

The correction distinguishes only an authenticated, exact-delivery NOT_ENQUEUED
lookup from transport/authentication/storage failure. It has no observed slot,
finality assertion, signing permission or enqueue acknowledgement. Normal current
admission, retained signed bytes and the outbox's actual chain checks remain
mandatory. Portable relayer checks pass 62; the targeted protected rerun passes
nine. No deadline or security gate was relaxed.

The corrected frozen candidate (205 runtime files, digest
eec0c7c8f970345c807515404ba08a18cdb30d330f498091db7e79cc1cdca026)
passes Windows/WSL Node 924 plus two vectors each and Windows security 164,
zero failed/skipped/cancelled with exit zero. A fresh actual protected service
flow reaches COMPLETED through both FROST signers, both attesters, fee payer,
relayer, claim/mint/finality and reconciliation; independent Linux Native/Solana
checks and both process exits pass. No per-transfer approval. It also observes
and safely replaces an expired receipt transaction under the existing policy.
This is current-principal, separate-process evidence. Disposable Linux test
chains used memory-backed storage; Windows protected state stayed on disk.
Primary integration, complete service kill matrix, cross-service SID and final
clean-clone validation remain separate required gates.

The newer test harness supports explicitly selected controller
kill groups: deposit preparation, broadcast/credit, attestation/claim and
settlement. A kill is an actual process termination after a persisted boundary;
the same protected book and controller state must reopen without changed prior
signature, credit or mint receipt. A special hook waits for genuine Native
finality and then halts before returning the proof for credit persistence. This
hook cannot manufacture a proof or authorize production.

The optional post-mint mode mines a genuine higher-work empty competing chain,
retains the affected economic incident, restarts every protected service process
and authority from existing state, and checks that chain health recovery never
clears the integrity stop. Candidate settlement mode passes nine assertion
groups at runtime c5b55565dfe2c9a7f8d8be813167f00c32f29a038b891f9afa838a43d694f182.
Other modes and final primary/clean-clone certification remain separately
required; an earlier credit mode reached internal completion but failed its
independent host recheck and is not a passing end-to-end result.

Native canonical selection and UTXO state retain the configured validating-node
trust boundary. Solana remains RPC_OBSERVATION, not independent consensus.
A shared-host privileged compromise or whole-profile/state co-restore is not
prevented absolutely by local witnesses. Cross-SID Windows certification is a
separate environment-dependent gate. Ed25519 is only attestation/Solana signing;
Native signing remains pinned schnorr_FROST exact A+B and unaudited upstream.
Phase 09 remains NOT_STARTED.
