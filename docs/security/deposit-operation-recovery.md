# Bridge operations and restart recovery

The operation journal retains reserve, pending credit and withdrawal liabilities.
Controller, signer, attester and delivery records retain the exact side effects
needed for retry. Coordinators and relayers hold no private FROST share.
One immutable operation ID binds the request, deployment, amounts, recipient,
inputs, fees and transaction. Inputs cannot fund a second operation.

## Deposit ordering

1. Retain the observed deposit and independently verify Native inputs/finality.
2. Reserve the exact sweep and input outpoints before requesting A+B signatures.
3. Persist the signing attempt and verified aggregate before releasing bytes.
4. Retain signed sweep and broadcast intent before sending.
5. Observe Native finality; retain verified reserve and pending credit together.
6. Each attester retains its exact canonical credit and allocation before signing.
7. Retain the Solana request and signed packet before delivery.
8. Observe finalized claim/mint execution, settle pending credit and reconcile.
9. Mark COMPLETED only after consistent accounting.

An uncertain FROST attempt requires bound abort receipts from both participants
before retry. A saved aggregate is returned exactly without new nonces.
A fee-payer signature does not grant mint authority. Verified attestations and
the Manager PDA remain required.

## Withdrawal ordering

The local withdrawal service discovers finalized withdrawal records and verifies
their creation transaction, user authorization, BurnChecked, exact Mint,
canonical message and deployment. It persists the request as an unpaid liability
before selecting reserve inputs.

A and B independently verify the payout context and Native UTXOs. Input locks
precede signing; exact signed bytes and broadcast intent precede payment.
After a lost response or restart, the worker observes the existing transaction
before considering delivery. Native finality and reconciliation precede COMPLETED.
The same journal/inbox resumes without client resubmission. Duplicate operations
cannot add another liability or payout. Direct SPL burns create no payout right.

## Retry and reconciliation

Native retries preserve inputs and signed bytes. A not-found response is
uncertainty, not permission for a replacement transaction. Solana retries check
previous signatures, finalized height and claim state before refreshing an
expired blockhash for the same economic operation. Missing or malformed evidence
cannot establish a successful negative lookup or authorize another mint.

Expired pending credit remains owed. Replay records and queues are bounded and
never silently pruned. No automatic message renewal or journal migration exists.

Reconciliation reads a stable journal revision, a finalized Solana bank and an
unchanged Native tip. It compares registered reserve with actual supply, pending
credits and unpaid bridge burns, accounting for legitimate pending payout spends.
Direct SPL burns cannot create spendable surplus. Donations and unregistered
reserve moves are not automatically backing. Missing/stale evidence or required
journal catch-up means WAIT. A confirmed contradiction pauses new authorization.

The local service reports ACTIVE or PAUSED. Protected services retain RUNNING,
PAUSED_POLICY and HARD_STOP_INTEGRITY labels for active, policy pause and serious
pause. Healthy observations and restart cannot clear a manual/integrity pause.
Read-only monitoring may continue. Resumption requires KingPepe Team review;
there is no automatic economic repair or runtime pause-clear endpoint.

Protected records use shared DPAPI atomic storage and process locks. The local
chain fixture uses explicitly isolated disposable test storage. Complete protected
Windows service integration is incomplete; local round trips do not certify
production operation, sudden power loss or full-host snapshot recovery.
A released transaction cannot be revoked by an off-chain pause and must still
be observed and accounted. All production activation remains disabled.

## Minimal encrypted backup and manual restore

Status: `recoveryProcedure = TESTED` for the isolated Phase-14 localnet/regtest
drill described below, not production DPAPI or full-host recovery. Process-restart
tests alone are not a snapshot/chain-resume drill. Repeat this procedure during
the Phase-17 Devnet soak and require its recorded result before Phase 19.
No production backup job has been installed. Manual
capture is allowed; an existing OS scheduler may be used but is not required.

Keep the actual capture policy, source/destination inventory, encryption
credentials, service identities and recovery material in local private
configuration. Use an existing encrypted-backup utility manually or with the
OS scheduler, not another bridge database, daemon or replication service. The
destination is private/local/offline as appropriate to the recovery objective;
a local development copy does not establish production backup policy. Preserve
the previous good snapshot on failure and report it for manual review. A backup
stored only on the active host is not protection against losing that host.

### Quiescent capture (manual or OS-scheduled)

1. Stop admission and await the existing service loop, signer and attester work.
   Close every state writer and the journal cleanly. A timed-out shutdown is
   not a consistent cut: do not copy a live SQLite file or mixed signer states.
2. Capture the complete closed journal/state directories and exact deployment
   configuration together, including retained intents, packets, attempts,
   attester authorizations and consumed-nonce records. Preserve any existing
   pause. Do not omit pending liabilities or retain only completed operations.
3. Encrypt directly into a new versioned backup on the configured destination;
   do not create a plaintext staging archive. Preserve the previous good backup.
   Record source SHA, schema/tool versions, environment/genesis/deployment,
   snapshot time, journal checkpoint and file hashes inside the encrypted set.
4. Verify the complete archive's integrity before extracting it to a new,
   restricted test location; compare its inventory/hashes. Do not accept partial
   plaintext from a failed decryption. Keep decryption/recovery credentials
   separately from the archive. For a cold/offline copy, detach or otherwise
   make the verified copy unavailable to the running bridge host.
5. Restart only the unchanged live state, retaining its previous pause status.
   This is a controlled stop/start, not a restore or permission to clear a pause.

For an isolated Linux test, existing GNU tar and GnuPG can stream the closed
state/config directly into an encrypted archive without a plaintext staging
archive. Give the passphrase through protected input, never a command-line
argument, shell history or log; retain GnuPG's integrity checks. Decrypt once
to a discard sink and require success before a second verified extraction into
an empty directory, with every pipeline failure checked. The archive must remain
unchanged between verification and extraction. For the small isolated drill,
complete decryption into bounded memory is also suitable: require successful
integrity verification before extracting those same bytes, then clear the buffer.
Neither method creates a plaintext archive on disk. See the upstream
[GnuPG commands](https://www.gnupg.org/documentation/manuals/gnupg/Operational-GPG-Commands.html)
and [passphrase/input options](https://www.gnupg.org/documentation/manuals/gnupg/GPG-Esoteric-Options.html).
This is an available test mechanism, not a new backup framework or certification
of Windows DPAPI recovery.

CurrentUser DPAPI blobs alone are not a portable key backup. Recovering them on
a replacement machine requires the corresponding approved OS/account recovery
material and an actually tested restore. Missing decryption capability must
fail closed; never substitute plaintext or silently create a replacement key.
Keep participants' secret recovery material separate from the coordinator.

### Manual restore after loss or corruption

1. Isolate the failed host and all its writers. Retain evidence and surviving
   state; do not overwrite or delete it. No restored signer may run alongside
   an old signer. Recover into new protected roots outside every checkout.
2. Authenticate/decrypt the last good, coherent snapshot and verify its entire
   inventory, versions, environment, genesis, deployment and journal integrity.
   Open the journal with its original identity/key, never the create-new path.
   Failure or partial data means remain stopped, not initialize an empty ledger.
3. Force policy PAUSED before constructing an active service loop. Keep signing,
   new submissions and automatic startup disabled. Start only read-only chain
   observation and the retained workers' catch-up paths.
4. Establish the gap between the snapshot and the last known live activity.
   Recover any newer public operation/signing/delivery records from surviving
   storage. Check Native signed transaction IDs/inputs/finality and finalized
   Solana claim/withdrawal records and transaction history. Replay only retained
   economic identities; never turn a lost reply into a new payout/credit ID.
5. Read-only catch-up can settle retained signed sweeps, pending credits, mints
   and payouts against real chain evidence. Reconcile reserve, supply and all
   pending liabilities. MATCH is necessary but does not prove that a stale
   snapshot contains every operation. Unknown history, unaccounted activity,
   expired credit or any contradiction requires continued pause and review.
6. Do NOT reopen older FROST nonce state for signing merely because balances
   reconcile. If any commitments/shares may have been released after the
   snapshot, recover the newer consumed state and bound sessions first.
   Without that evidence, remain signing-disabled. A reviewed key/epoch recovery
   would be a separate explicitly authorized action; it is not implemented by
   ordinary resume. Likewise, do not reconstruct missing attester authorization
   state by signing fresh copies of an uncertain allocation.
7. Only after the gap is accounted, key/state recovery is verified, chain facts
   are current and reconciliation matches, the KingPepe Team may explicitly
   review and resume through the existing service API. Never remove an integrity
   stop, edit balances, reassign inputs or reset replay records to force progress.

A snapshot preserves only its capture point; it does not guarantee zero
data loss, full-host rollback detection, or automatic recovery from every old
snapshot. If complete operation/signing evidence cannot be recovered, safely
resuming economic actions is BLOCKED. Preserve this limitation in readiness.

### Required isolated drill and evidence

Use only disposable localnet/regtest state and the chosen encrypted-backup tool.
Capture a quiescent snapshot with signed operations awaiting chain settlement;
stop the bridge services/runtime, restore to fresh roots, and follow the procedure
above. Let real chains settle the retained transactions. Require both directions
COMPLETED with no new sweep, mint or payout, exact liabilities and reconciliation.
Also reject a corrupt archive and a snapshot with a deliberately missing operation
or ambiguous consumed-nonce gap; those cases must stay PAUSED/signing-disabled.
Do not power off/reset the physical development host, recreate WSL, or conduct
a full-host disaster test without a separate KingPepe Team instruction.

Record source SHA, snapshot scope/time, restore duration, manual steps, actual
chain results and gaps in the existing readiness/status files. Do not publish
archive contents, keys, private paths or machine identities. The later Devnet
report must record its own controlled runtime snapshot/restore drill, not reuse
local restart or archive-only evidence.

### Exercised local procedure

`npm run local:e2e:recovery` reuses the normal 25-check bidirectional service
harness with three closed-writer checkpoints: a broadcast sweep awaiting Native
finality, a finalized mint awaiting journal accounting, and a broadcast payout
awaiting Native finality. GNU tar/GnuPG capture the existing journal, separate
test signer states and private test configuration. The encrypted inventory
records source/message/runtime versions, network identities, checkpoint and file
hashes. Restores use new directories and the original journal identity/key;
original files remain unchanged. No old signer process remains running.

The restored journal is paused before a child service starts. Real-chain catch-up
must make no signing or broadcast request; after explicit review of the known
quiescent gap, the existing workers complete the pending flow and reconcile.
All three restore checkpoints and both directions passed locally. Wrong
passphrases and corrupted ciphertext fail before extraction. Manual inventory
checks also reject a missing expected operation or a declared unaccounted activity
gap while paused. These checks do NOT discover an unknown full-host rollback or
prove that an arbitrary older snapshot contains every operation.

Use a new private external test destination. On WSL, set
`KINGPEPE_TEST_RECOVERY_ROOT` to an operator-provisioned private Windows directory;
DrvFS chmod is not Windows ACL enforcement. `KINGPEPE_SOCKET_ROOT` may select
native Linux storage for tiny GnuPG control sockets. Retained archives, restored
state and logs stay on the development-data volume; no key or operational path is
published. The random TEST archive passphrase is held only for the drill, not
provisioned as a production recovery credential. Production backup configuration,
off-host/cold custody and DPAPI account/machine recovery remain separate untested
deployment responsibilities. The Devnet drill must still run during Phase 17.
