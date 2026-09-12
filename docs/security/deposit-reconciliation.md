# Deposit reconciliation and retained progress

This Phase 08 component reads an authenticated operation journal, validates
Native reserve evidence with the existing bounded Rust verifier and node
adapter, and compares Mint supply, bridge counters and claims from one finalized
Solana bank. It has no signing, broadcasting, balance-editing or governance API.
It is localnet-only and does not implement Phase 09.

The exact integer model is:

- journal reserve = authorized unminted credits + recorded issued value;
- observed registered reserve = journal reserve;
- Manager current issued counter + burned unpaid obligations = issued value;
- observed SPL supply cannot exceed the Manager counter;
- required backing = SPL supply + burned unpaid obligations + pending credits.

Direct SPL burns can leave a difference between supply and the Manager counter.
That difference is retained without granting payout rights or authority to
withdraw reserve. Unregistered donations are not adopted as bridge backing.
The component does not authorize fees from another operation's reserve.

Every credited operation's claim is included with the Mint, counters,
configuration and executable accounts in one RPC bank. A previously minted
claim cannot be accepted from a slot older than its retained rooted observation.
An actual minted claim missing only from local settlement history is catch-up
work, not a new credit, automatic surplus or immediate financial contradiction.
Native observations bracket the Solana read and require an unchanged Native
tip. The authenticated journal is rechecked after chain observation; concurrent
journal changes cause a new observation, not mixed-snapshot arithmetic.

The actual Native source is checked for raw headers, PoW, chainwork, Merkle
inclusion and current UTXO observations. Temporary or unresolved signed sweeps
remain encumbered. They are not silently included as finalized reserve. A spent
input awaiting outcome/finality/credit discovery suspends authorization.
The complete durable discovery controller is still a separate dependency.

For a previously verified reserve sweep, an absent mempool-inclusive UTXO is
checked again with mempool effects excluded. If the independently verified
creating transaction remains canonical and the validating node reports its
output absent at the same tip, reconciliation records an exact reserve-loss
incident. A mempool-only spend suspends authorization instead. This is an
explicit node-UTXO trust boundary, not a cryptographic non-membership proof.
Unregistered internal reserve transfers cannot silently replace the consumed
allocation. The adversarial local test deliberately authorizes such a move in
both disposable signers' test policy; no withdrawal or Phase 09 payout exists.

The protected wrapper requires CurrentUser DPAPI, a separate retained witness,
CAS and a lifetime lease. It binds progress to both geneses, the policy and
deployment manifest. It retains journal revision, Native work/tip, finalized
Solana slot and observation digests. Reopening does not restore cached healthy
permission. Lower authenticated journal revisions are integrity incidents;
unavailable or stale RPC observations are waits. Repeated unchanged tips do not
refresh their original advance time. A same-slot conflicting deployment
snapshot is an incident.

Confirmed contradictions are persisted locally before reporting through the
authenticated durable integrity outbox. The supervisor stop persists across
restart; there is no automatic reset, compensation, remint or confiscation.
A higher-work Native reorganization invalidating accepted backing identifies
the impacted operation IDs and exact reserve value, while preserving the old
evidence. A lower-work unresolved branch causes suspension. The component cannot
repair post-mint economic loss or revoke already released transactions.

Deployment identity checks compare actual program/ProgramData, bytecode hashes,
authority and configuration against the pinned manifest. In the pinned Agave
4.2.2 test validator, --bpf-program uses the upgradeable loader and stores the
all-zero public key as a present upgrade authority, rather than a None value.
The disposable test manifest represents those exact bytes, not a production
identity. See the [pinned validator command](https://github.com/anza-xyz/agave/blob/v4.2.2/validator/src/bin/solana-test-validator.rs)
and [genesis account construction](https://github.com/anza-xyz/agave/blob/v4.2.2/test-validator/src/lib.rs).
No upstream code is copied into this implementation.

Pure accounting/progress tests use explicitly synthetic fixtures. Separate
local-chain tests exercise real reserve, claims, deployment bytes and Native
forks. The separate Windows probe uses actual DPAPI/mTLS and live chains but
imports chain-derived completed records as test initialization: it is not proof
of the entire protected deposit workflow. Initial Windows attempts failed the
combined health-admission assertion: each actual observation passed, but the
first result aged out during sequential one-shot polling. A subsequent periodic
probe with all observers in one Windows Node process also remained paused.
The next probe separates the actual Native observer, Solana observer and
supervisor/TLS listeners into processes; reconciliation remains a separate
caller. It uses actual regtest block advancement, with no synthetic healthy
reports or enlarged freshness limits. That separate-process rerun passed eight
actual Windows protected/live-chain checks after a fresh fourteen-check deposit
prerequisite. It verified joint fresh source admission, unchanged protected
journal revision after reopen, retained network progress, a real higher-work
post-mint reorg, exact affected backing, mTLS stop propagation to economic roles,
durable stop across reopen and continued read-only supply observation. Its
167-file runtime digest is
85ad1ff9a96e96c5c6e58ac97034b70c11632f5f7a2102ce1fd2074a1bd1341c.
These are unpublished candidate results, not exact-SHA or final clean-clone
certification; the three prior failed attempts remain recorded. The inherited control
pipes carry only external test configuration references; source-health reports
cross the actual role-pinned TLS channels. These are not production installers.
Status files record what actually ran.
The later integrated primary delivery runtime independently passes ten Linux
and eight CurrentUser Windows/live-chain reconciliation checks, each after
fourteen actual claim checks and COMPLETED. Its unchanged 194-file digest is
99b9a8bda86fd220c8eb8518c471e72acf1ae1a9ed3bd85821a30dc3f3bfe446.
It includes the source-built protection helper and durable outbox components;
the completed-record test initialization remains explicit, not a claim of full
protected-controller or host-reboot certification.
Cross-service SID/ACL certification and full protected controller/crash recovery
remain separate gates. None of these tests is an independent external audit.

Trust remains explicit: configured Native validating-node RPC supplies canonical
choice and UTXO state; Solana is RPC_OBSERVATION, not independent consensus.
The service-profile witness does not detect a privileged whole-host/profile/state
co-restore or every hidden remote clone. Capacity limits (64 retained operations)
are bounded localnet constraints, not an approved production throughput policy.
