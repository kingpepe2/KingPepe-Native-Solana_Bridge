# Bridge service

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
