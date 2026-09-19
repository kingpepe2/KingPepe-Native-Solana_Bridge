# Forward operation recovery

The normal journal is the recovery source of truth. Public operation IDs,
deposit outpoints, immutable plans, consumed nonce tombstones, signed sweep
packets, attestation receipts and exact Solana packets are persisted before
external effects. The coordinator contains no FROST private share.

A restart checks actual Native and finalized Solana state before progressing.
An ambiguous Native response is resolved by the retained transaction ID; it
does not authorize a new sweep. An ambiguous Solana response is resolved by
signature and receipt/claim state. A replacement expired packet requires live
absence and expiry checks and preserves the exact operation and message.

Pause prevents new signing/submission. Read-only catch-up may record an already
landed mint. Integrity stops are absorbing. Unknown post-snapshot activity or
missing expected operations keeps a restored service paused; it is never repaired
by minting. Same-host snapshot rollback freshness is not certified.

Use manual or existing OS-scheduled encrypted snapshots. Stop the writer, retain
the journal and its authenticated checkpoint, private deployment configuration,
protected role stores, nonce state, exact packets and public artifact identities.
Include required keys only inside the established protected encrypted backup.
Do not put backups, DPAPI blobs, passphrases or private paths into Git or reports.

Restore into an isolated private location with services PAUSED. Verify inventory,
hashes, permissions, authenticated journal identity, deployment binding and known
quiescent interval. Reject wrong passphrase/corruption before extraction. Check
actual chains and replay the same retained operation identities. Require MATCH
before explicit resume; never use an older snapshot over a running writer.

The forward local recovery suite covers a broadcast sweep awaiting finality and
a finalized mint awaiting journal accounting. It checks no additional signing,
broadcast or mint, and retains the 16 forward service regressions. Fresh evidence
must name the tested source. Historical drills do not certify a rewritten SHA,
production DPAPI portability, distinct service principals or arbitrary host loss.

The user CSV path is separate: an unswept Native deposit can be recovered using
the user's own wallet after its script-relative delay. A successfully spent
deposit cannot also be recovered. Production delay is Team-approved at 1,440
Native blocks; deposit and sweep finality are 12 confirmations. Native consensus
source governs script semantics and block timing.
