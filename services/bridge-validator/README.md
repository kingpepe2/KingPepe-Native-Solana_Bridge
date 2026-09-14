# Bridge service

## Explorer public TEST interface

The Explorer serves its own `/bridge` page and a narrow `/api/v1/bridge/*`
gateway. This repository's user listener stays authenticated on loopback;
neither the listener nor administrative, signer, attester or raw journal APIs
are public. The Explorer keeps its separate service-auth credential in Windows
protected storage and uses `solana/ts/sdk/client.mjs` only on the server.
Wallet Standard user transactions select `solana:devnet`. The UI's quote checker
requires that explicit chain; existing local callers still default to localnet.

For this TEST milestone, `KINGPEPE_DEVNET_PUBLIC_UI_CONFIG` enables a serving
branch in the existing `solana/tests/devnet-bridge-service.mjs` runner. It requires
the final retained Devnet/regtest run and its original protected authority,
shares, nonce state, wallet and journal. The normal prepared runtime and private
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
token account; their wallets sign their transactions. The public operation ID
supports journal tracking. Before Native submission, the saved public request
retains its original nonce and recovery context for exact request restoration.
Refreshing never signs, broadcasts or creates another request. Browser fixture
tests do not certify real public-wallet flows.

This remains the accepted SINGLE_HOST TEST topology: common-host compromise or
outage can affect both FROST participants. Upstream FROST is unaudited, no
independent security audit is claimed, and production readiness remains false.

## Local operational loop

`LocalBridgeService` (exported from `services/relayer/withdrawal-service.mjs`)
composes `AutomaticNativeToSolanaDeposit` and `AutomaticSolanaToNativeWithdrawal`
using the SAME `AuthenticatedLocalDepositLedger`. No additional database or
service is introduced. The Phase-09 class name remains a compatibility alias.

Open the existing external journal with its original identity and protected
local key. Configure the retained Native verifier, finalized Solana reader,
approved local deployment, A+B coordinator, separate attesters and fee payer.
Construction does not create keys, fund wallets, mine blocks or deploy programs.
The portable file-backed signer adapter is for isolated regtest fixtures only;
it is not a plaintext fallback for protected deployment keys.

- `submitDeposit(request)` watches the user's already-broadcast Native transaction
  and public deposit intent. Existing verification constructs the reserve sweep.
- Finalized withdrawal records are discovered automatically. `submit(signature)`
  can also register a user-created withdrawal; direct burns give no payout rights.
- `run({signal, intervalMs, onStatus})` polls both existing workers serially;
  `tick({limit})` runs one bounded iteration. `status()` reports journal state,
  not an independently verified chain snapshot.
- `pause(reason)` persists a policy pause. Read-only catch-up retains already
  finalized burns, credits, mints and payouts without new signing or sending.
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

## Existing protected composition

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

Canonical transaction planners do not read secret files. Claim submission is
localnet-only, retains signed identity before broadcast, queries prior outcome
before retry and requires actual finalized claim observation. Mainnet is
disabled; no per-transfer KingPepe Team approval is introduced.

Current executed evidence and remaining core work: docs/development-status.md.
