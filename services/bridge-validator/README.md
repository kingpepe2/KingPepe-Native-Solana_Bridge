# Bridge service

## Explorer public TEST interface

The Explorer serves its own `/bridge` page and a narrow `/api/v1/bridge/*`
gateway. This repository's user listener stays authenticated on loopback;
neither the listener nor administrative, signer, attester or raw journal APIs
are public. The Explorer keeps its separate service-auth credential in Windows
protected storage and uses `solana/ts/sdk/client.mjs` only on the server.
Wallet Standard recipient connections require `solana:devnet`. No wallet signing
API is exposed by the interface; local callers still default to localnet.

For this TEST milestone, `KINGPEPE_DEVNET_PUBLIC_UI_CONFIG` enables a serving
branch in the existing `solana/tests/devnet-bridge-service.mjs` runner. It requires
a matching one-way V3 Devnet deployment with dedicated journal and protected
authority, shares, nonce state and wallet. The normal prepared runtime and private
process configuration, including the restored run's matching temporary root,
must be supplied. The serving branch cannot run with soak, traffic-cycle or
recovery-injection options and does not deploy, airdrop, load the deployment/user
signing seeds, or submit the harness's test-user transfers. It reuses the existing
workers, Borsh encoding, verification, A+B processes and persist-before-broadcast
ordering. SIGINT/SIGTERM initiates the existing scoped shutdown.

The private serving configuration binds `kingpepeNetwork=REGTEST`,
`solanaNetwork=DEVNET`, `productionReady=false`, `mainnetActivation=DISABLED`,
the exact retained policy, a loopback endpoint, a protected `service-auth`
reference and bounded operator-prepared `depositFeeFundingInputs`. It contains
no plaintext credential. These configuration files and references remain outside
every checkout. The public API cannot fund the operator fee pool. Test mining
only confirms pending transactions in the isolated regtest mempool, within the
existing verifier's header limit. Exhausted fee inputs or unavailable evidence
do not authorize another economic action.

The Explorer displays Bridge fee 0 separately from the existing Native miner
fee. Users supply their Native recovery public key and initialized Devnet KPEPE
token account. Users send Native deposits from their own Native wallet. The
public operation ID supports journal tracking. Refreshing never signs,
broadcasts or creates another economic operation. Browser fixture
tests do not certify real public-wallet flows.

This remains the accepted SINGLE_HOST TEST topology: common-host compromise or
outage can affect both FROST participants. Upstream FROST is unaudited, no
independent security audit is claimed, and production readiness remains false.

## Local operational loop

`LocalBridgeService` (exported from `services/relayer/deposit-service.mjs`)
composes the forward `AutomaticNativeToSolanaDeposit` worker
using the SAME `AuthenticatedLocalDepositLedger`. No additional database or
service is introduced. Old journal and deployment formats are rejected.

Open the existing external journal with its original identity and protected
local key. Configure the retained Native verifier, finalized Solana reader,
approved local deployment, A+B coordinator, separate attesters and fee payer.
Construction does not create keys, fund wallets, mine blocks or deploy programs.
The portable file-backed signer adapter is for isolated regtest fixtures only;
it is not a plaintext fallback for protected deployment keys.

- `submitDeposit(request)` first checks the REGTEST source identity and matching
  unspent output, then watches the user's already-broadcast Native transaction.
  This intake check grants no finality or mint authority. Existing independent
  verification still constructs and validates the reserve sweep.
- Global backing/deployment reconciliation precedes new economic processing.
  Ordinary SPL owner burns reduce supply but never authorize reserve release.
- `run({signal, intervalMs, onStatus})` polls forward operations serially;
  `tick({limit})` runs one bounded iteration. `status()` reports journal state,
  not an independently verified chain snapshot.
- `pause(reason)` persists a policy pause. Read-only catch-up retains already
  finalized credits and mints without new signing or sending.
- Abort and await the loop before explicit `resumeAfterReview()`. Resume requires
  fresh reconciliation MATCH and cannot clear an integrity HARD_STOP. Restart
  polling with a new signal; close the journal and signing resources on shutdown.

Public signing attempts/aggregate results and signed Solana packets are retained
in the existing journal before release. An interrupted nonce session is abandoned
only after both signers confirm it; a consumed nonce is never recreated. Expired
Solana packets may be rebuilt for the SAME credit only after live finalized
expiry, account and signature-history checks. A finalized intermediate receipt
can be recovered from its validated account; mint completion still needs actual
finalized transaction evidence. Unavailable evidence waits, never approves.

Canonical credits have a finite authorization window. Expiry of the CREDIT
(not merely its transaction blockhash) pauses for review with the exact pending
liability retained. The service does not extend signatures, change the canonical
operation identity, or automatically repair balances. Long-outage credit renewal
is not implemented. Source capacity limits and configured RPC/history trust also
remain explicit localnet limitations, not production readiness.

`npm run local:e2e:service` exercises the loop with actual regtest and local
validator execution, abrupt process exits, response loss, blockhash expiry,
pause/resume and reconciliation. Funding/mining belongs only to that test harness.

## TEST economic limits

Devnet workers require an explicit `TEST_ONLY` limit policy retained in the
existing authenticated journal. Configure `maxMintPerTransfer`,
`maxMintPerWindow` as exact positive base-unit strings, plus integer
`windowSeconds` (1 through 86400).
These are service authorization limits, not a new on-chain quota program.
Production policy is `UNBOUNDED_BY_TEAM_DECISION`, both mint limits `UNBOUNDED`,
and `windowDuration=NOT_APPLICABLE`. It does not bypass backing, finality, replay,
exact accounting or the reconciliation circuit breaker.

The public TEST runner reads `economicLimits` from its private gateway profile;
other explicit Devnet harness runs read `KINGPEPE_DEVNET_TEST_LIMITS`, an external
file reference. An existing journal can install limits only while quiescent.
Restart must reproduce the retained policy; it cannot raise limits or reset usage.
Old isolated localnet fixtures may omit this policy, but Devnet workers cannot.

Mint allowances persist before attestations. Duplicate attempts reuse their
exact allowance. Usage in
each fixed wall-clock window includes settlements observed in that window plus
every still-pending allowance, including allowances from earlier windows. This
conservative carry prevents delayed packets from escaping the next window's
ceiling. Settlement requires the existing verified mint record.
Clock regression fails closed. The host clock remains part of the accepted host
trust boundary; this is not an independent clock or full-host rollback defense.

A window breach atomically records its reason and the existing policy PAUSE.
No offending allowance is issued. Same-window review requires available room;
a later window permits explicit review so earlier reserved work can finish.
Pending allowances still count, and another excess pauses again. No automatic
resume, balance repair, signer fallback or limit increase is introduced.
Reconciliation contradictions retain the existing integrity stop semantics.

Unit regressions cover mint ceilings, exact boundaries, carry,
replay, clock regression, immutable policy and authenticated journal restart.
The local service harness also sends a bounded mixture of irrelevant,
malformed and duplicate intake requests, records resource observations, then
requires its legitimate forward operation to complete and reconcile.

## Existing protected composition

The authenticated loopback user API also exposes fixed GET routes
`/balances/solana/:publicAddress` and `/balances/native/:publicAddress`.
They are informational REGTEST/DEVNET reads, independent of transfer approval.
The retained Devnet runner binds the reader to its existing Native RPC, reviewed
Solana deployment manifest and exact KPEPE Mint. It creates no signing state.

Solana discovery filters the exact Mint, permits at most 16 unique token accounts,
then verifies raw token accounts, authority, initialization and deployment in one
finalized bank. Native scans accept only supported REGTEST witness addresses,
verify network/genesis and an unchanged tip around the scan, and preserve the
original JSON decimal token for integer conversion. Confirmed UTXO balances may
include immature or locked outputs and are not promises of spendable funds.
SOL numeric values outside the RPC parser's exact safe-integer range are rejected.

Lookups are serialized with a one-second minimum interval, a 20-second cache and
at most 128 cache entries. Upstream transports retain bounded responses/timeouts.
No caller selects a network, Mint, RPC URL or method. No balance failure signs,
broadcasts, changes accounting or creates a bridge operation.

The protected deposit controller coordinates exact Native validation, A+B
signing, reserve credit, two attestations, Solana delivery and reconciliation.
The durable operation journal retains economic obligations; relayer packets
and signing attempts retain their respective side effects under the same
operation identity. See [operation recovery](../../docs/security/deposit-operation-recovery.md).

The lightweight automatic pipeline and external file adapters are used by the
isolated Linux chain harness and portable integration tests. They do not
silently replace the Windows protected runtime. ExactDepositLedger is the
in-memory arithmetic policy reused by the authenticated test ledger, not a
chain verifier or signing authority.

Canonical transaction planners do not read secret files. Tested claim submission
is localnet/Devnet, retains signed identity before broadcast, queries prior outcome
before retry and requires actual finalized claim observation. Mainnet is
disabled; no per-transfer KingPepe Team approval is introduced.

Current executed evidence and remaining core work: docs/development-status.md.
