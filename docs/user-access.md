# User access (local development)

Phase 12 exposes the existing bridge service, not another transfer engine.
Native and Solana wallets remain responsible for signing their own transactions.
All amounts are decimal **atomic-unit strings**; KingPepe has eight decimals.
The current endpoints are LOCALNET/REGTEST only. Production remains disabled.

## SDK and service integration

`solana/ts/sdk/bridge.mjs` builds deterministic public deposit requests and
unsigned Borsh withdrawal transactions. `solana/ts/sdk/client.mjs` provides
deposit/withdrawal preparation, submission notification, bridge status and
operation/deposit/withdrawal status methods.

The runtime may attach `BridgeUserApi` and `listenBridgeUserApi` to its existing
`LocalBridgeService` process. Supply that service's existing ledger and a
`depositFeeInputs` function returning verified-policy TEST fee-funding outpoints.
Do not select backing UTXOs for fees. There is no new journal or backup daemon.
The configured Native observer still validates every funded request before FROST.
Before returning a deposit address, the API checks that the recipient is an
initialized KPEPE SPL token account on the configured finalized Solana deployment.
Withdrawal preparation also checks that account's user authority and balance.
These intake checks do not replace final on-chain validation or create payout rights.

The loopback listener requires a 32-byte user-access credential supplied by local
protected configuration, or independently generated isolated test state. Never
put its value in Git, a URL or logs. The CLI reads it from the dedicated command's
`KINGPEPE_USER_ACCESS_TOKEN` environment, with `KINGPEPE_BRIDGE_URL` selecting the
loopback endpoint. There is no plaintext config fallback or remote listener.
This limited user credential cannot call signing, minting, pause or resume APIs.
Signing services retain their separate existing authenticated channels.

## CLI

Run `node cli/bridge.mjs --help`, or `npm run bridge -- --help`.

- `bridge deposit`: public request JSON on stdin: `amountAtomic`, `recipient`
  (the recipient SPL token-account address), `userRecoveryPublicKeyHex` (public
  x-only key from the user's Native wallet), and fresh nonzero `nonceHex`.
  Save the returned public request/recovery construction. Send the exact amount
  to its Native address using the user's wallet.
- `bridge deposit submit`: notify the service with `request` (the original four
  fields), `depositTxidHex` and `depositVout` (index or null for unique matching).
  This is durable intake, not proof of finality or mint authorization.
- `bridge withdraw`: public JSON: `amountAtomic`, `feeAtomic`, `destination`
  (Native regtest witness address), `userAuthority`, `sourceTokenAccount`, fresh
  `withdrawalIdHex` and `nonceHex`. The service checks its deployment and obtains
  a blockhash and finalized network Clock for the one-hour message window; it
  does not assume the host clock matches a finalized bank. The result contains
  an **unsigned** wallet transaction; the user
  pays Solana fees and signs. BurnChecked occurs atomically inside the bridge
  instruction that creates the withdrawal record. A direct SPL burn is not a
  withdrawal request.
- `bridge withdraw submit`: `{ "signature": "<user-wallet-transaction-id>" }`.
  The existing finalized reader validates the transaction before queue admission.
  The observer also discovers finalized requests without this notification.
- `bridge status` and `bridge operation <id>`: public journal status, exact
  amounts and known transaction IDs. Journal status is explicitly not a fresh
  independent chain reconciliation.

The CLI never imports a wallet credential and never signs or broadcasts a user
transaction. An unavailable response is not failure proof: query the operation
and actual wallet transaction before retrying. Reuse the original operation and
withdrawal IDs; never generate a new withdrawal merely to retry delivery.
Expired blockhashes require checking the previous transaction before obtaining
a replacement for the same withdrawal ID. No silent auto-retry is implemented.

Unknown operations return not-found, not COMPLETED. Paused bridges refuse new
requests while status remains readable. Only the separate existing administrative
path can resume after KingPepe Team review; ordinary transfers need no Team approval.

The address adapter uses [BIP-173](https://bips.dev/173/) and
[BIP-350](https://bips.dev/350/) through the pinned
[@scure/base API](https://github.com/paulmillr/scure-base). It rejects wrong-network
addresses, mixed case, checksum errors and unsupported script forms. The Native
  prefix comes from the pinned KingPepe source, not Bitcoin defaults.
