# Protected Native sweep delivery

The Phase 08.5 component retains an exact signed REGTEST reserve sweep before
acknowledging enqueue and before each bounded broadcast attempt. Only the
Bridge Validator's pinned, authenticated role can enqueue it. The relayer has
no FROST share, signing operation, alternate-input builder or mint authority.

The protected outbox binds the complete immutable deposit plan, input
reservations, policy/deployment, validated BIP340 witnesses and signed bytes.
It shares the operation journal's economic codec rather than a second fee or
signature-policy implementation. Retry cannot change any byte. A lost response
requires observing the exact transaction, or independently revalidating its
still-unspent inputs before submitting those same bytes again. RBF, CPFP and
alternative payouts are absent. An exact configured-node not-found response
is uncertainty, not proof that no transaction was broadcast.

The worker rechecks actual REGTEST genesis and chain state on the broadcast
connection as well as using the independent raw-evidence verifier. RPC
redirects are rejected. The configured validating node remains a trust
boundary for canonical choice and UTXO state.

The CurrentUser DPAPI package, lifetime lease, retained profile witness and
CAS revision have no plaintext fallback or automatic re-enrollment. Corrupt
authenticated state, a detected rollback or conflicting observed transaction
queues a durable integrity incident. Clock rollback cannot lower a retained
progress time. A privileged full-host/profile co-restore remains outside the
guarantee. All package paths and credentials are private external configuration.

Status reports transport observation only; it does not create a finalized
reserve or pending mint credit. The Bridge Validator must independently
rediscover finality and atomically retain reserve plus credit. That complete
protected controller remains incomplete. The finite queue (64 operations,
32 sends each) has no automatic pruning or reset. Exhaustion waits for a
separately reviewed operational decision.

This candidate is under validation. Portable codec tests are not proof of
Windows protection, actual node broadcast or complete crash-safe local E2E.
A separate actual-chain Windows probe now passes eight checks: protected
enqueue before a deliberately lost response, recipient substitution rejection,
process kill immediately after actual Native acceptance, exact-byte observation
after reopen with no second send, recovery after a lost protected-write
acknowledgement, unresolved-liability retention and continuation to actual
Solana mint/finality/reconciliation. The Linux chain host passes fourteen
checks and reaches COMPLETED. These are CurrentUser DPAPI/mTLS tests; the Linux
fixture creates real ephemeral A+B signatures before the outbox starts. It is
not the complete protected FROST-to-mint controller or distinct-account proof.

Five earlier attempts failed before broadcast and remain failed evidence.
The operation-journal admission mutex was corrected with four actual regressions;
reconciliation observation was moved to a separate test process. Source-built
protection removes repeated compilation, not validation. The fixture now retries
the same request after a genuine transient policy pause and checks that the
lost-response fault was actually injected after durable enqueue. No deadline,
freshness window or hard-stop policy was weakened.
The successful 186-file runtime digest, including C# sources, is
37c0361a40d411c40194d37969dc6921eec1b08f7c9559435b67940961890e08.
Those results belong to the earlier separate candidate. The primary integrated
runtime now independently passes the same eight Windows and fourteen chain
checks through COMPLETED, with runtime digest
99b9a8bda86fd220c8eb8518c471e72acf1ae1a9ed3bd85821a30dc3f3bfe446
(194 files). The full primary Windows suite passes 147, zero failed/skipped.
This remains component evidence, not final clean-clone certification.
No production deployment or Phase 09 payout workflow is included.

The transport review also hardened the inherited local Solana submission
adapter: no redirects, unique matching response IDs, a 64-KiB request bound,
a 2-MiB streamed-response bound, strict UTF-8 decoding and a ten-second socket
deadline. Malformed RPC error codes are rejected instead of reflecting arbitrary
provider fields into exception messages; its actual HTTP regression failed
before correction, and all 61 targeted submission/setup checks now pass.
Actual isolated HTTP tests reproduced the earlier failures and now
exercise rejection and real stalled connections. These are transport tests,
not provider-honesty or consensus proofs. A fresh fourteen-check deposit flow
and eight-check actual post-mint Native reorg suite pass with the correction.
