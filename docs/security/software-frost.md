# Software FROST A+B

Native signatures use pinned @noble/curves 2.3.0 schnorr_FROST with
secp256k1/BIP340 and the applicable BIP341/BIP342 transaction sighash.
The upstream FROST component is [explicitly unaudited](https://github.com/paulmillr/noble-curves/blob/2.3.0/README.md#frost-threshold-signatures).
Node acceptance is compatibility evidence, not an external audit.

A and B are separate software participants on one KingPepe Team-controlled
computer, with separate protected shares/state. Both are mandatory; neither a
single participant nor the coordinator can complete Native signing. The
coordinator holds no final private share. Ed25519 identities are separate and
used for project attestations or Solana transactions, not Native FROST.

## Request and nonce safety

Each participant checks its own immutable policy and current Native evidence.
The request binds the complete transaction, sighash, inputs, recipient, amount,
fees/change, network, deployment, epoch, operation and exact A+B participant set.
The coordinator verifies both shares and independently verifies the aggregate
BIP340 signature before returning it. There is no fallback threshold.

A signer persists its public commitment and full request before exposing the
commitment. Secret nonce bytes exist only in that running signer. Before share
generation it removes that volatile capability and persists a consumed marker;
uncertain writes fail closed. Exact completed retries return the saved share,
not another signature with a resurrected nonce. Session tombstones are bounded
but never silently pruned.

Reopening validates every retained session, then marks uncertain reservations
aborted/consumed before admitting signing. Coordinated abort attempts both
participants; an ambiguous response does not authorize a new attempt. The
protected adapter also holds one exclusive process lock. It has no persistent
clone/fencing or registry rollback-anchor subsystem.

## Setup and storage boundary

DKG requests bind the deployment, epoch, participants and complete transcript.
Both participants persist verified incoming contributions before finalizing;
resume cannot silently replace a key or adopt a changed handoff. DKG setup is
not a transaction authorization. The isolated local setup coordinator routes
DKG contributions in memory; production provisioning is not implemented.

The Windows service path uses [protected local storage](windows-protected-storage.md)
and [authenticated TLS](service-ipc.md). The explicit Linux local-chain fixture
uses external disposable JSON test shares; it is not a plaintext fallback for
the protected runtime or approval to use that adapter with production secrets.

The bridge's `signAutomaticallyWithNativeEvidence` entry point selects the
existing authenticated path when both peers are protected remote signers. It
rejects a mixture of remote and in-process participants. Authentication or
transport failure never falls back to local signing; the protected path retains
its journal, nonce and pause checks.

Current executed evidence belongs in [development status](../development-status.md).
Restart tests do not prove sudden-power-loss durability, memory-snapshot safety,
or detection of a complete restored host snapshot. Same-account or privileged
host compromise can affect both participants; one host outage can stop both.
No second physical signing machine is required by the approved topology.
