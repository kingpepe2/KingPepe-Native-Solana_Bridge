# Forward user interface and API

Public Explorer flow: browser → narrow Explorer gateway → authenticated loopback
Bridge service. The browser never receives the internal token or private RPC URL.
The loopback service keeps authentication, request limits and origin checks.

User operations are bridge status, Native deposit request, deposit notification,
operation lookup, and public-address balance reads. The gateway rejects unknown
routes, extra fields, wrong origins, arbitrary RPC selection and network mismatch.
Admin, attester, signer, raw-journal and filesystem interfaces are not public.

The SDK creates a bound Native deposit request from exact `amountAtomic`,
recipient token account, public Native recovery key and public nonce. The service
checks the initialized token account against the configured Mint and deployment.
This check is repeated by the economic pipeline; frontend display is not authority.

The CLI supports `bridge deposit`, `bridge deposit submit`, `bridge status` and
`bridge operation <id>`. Authentication stays in local process configuration.
Public amounts are decimal strings containing base units; UI conversion accepts
at most eight decimal places, never floating-point economic arithmetic.

Wallet Standard supplies a Solana public recipient address and account-change
events. Compatible wallets do not need any signing feature. Balance reads use
the exact configured Mint and finalized commitment. Native address balance reads
are informational; the user sends the deposit using their own Native wallet.

The Explorer currently remains TEST-bound to REGTEST and `solana:devnet` until
the reviewed one-way deployment is ready. The local developer app is explicitly
REGTEST/localnet. Prepared Mainnet bindings must not switch the public site before
actual deployed identities are verified. Neither interface asks for wallet keys.

Save the public request and operation ID. Refresh/reopen performs status reads;
it must not create a replacement economic request. The forward states are
OBSERVED, VALIDATED, SWEPT, ATTESTED, CLAIMED, MINTED and COMPLETED.
