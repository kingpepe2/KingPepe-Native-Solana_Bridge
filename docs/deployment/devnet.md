# Test-only Devnet deployment

Phase 15 uses canonical Borsh V2 and fresh TEST credentials. Production remains
disabled. No production upgrade-authority model is selected by this test.
The independent-review and KingPepe Team activation gates still apply.

## Finalized test deployment

The public [deployment record](devnet.json) pins source
`5ad33201402813503d31b6d97c2e3e6fdb7908c1`, its four-job passing CI
`34745104679`, both Program IDs, the Mint, PDAs, test authority and finalized
deployment/enrollment transactions. At finalized slot 497778617 the supply was
zero, decimals eight, Mint authority the Bridge PDA and freeze authority None.
Both config accounts exactly matched the expected Borsh layouts. Phase 16 test
transfers may subsequently change supply; the record preserves enrollment facts.

Both binaries were independently rebuilt into fresh external output directories
and matched the deployed bytes. The deployment uses the pinned builder's
supported `--arch v3` option, with platform-tools v1.54, rustc 1.89.0, and no
experimental `--abi-v2`. Default v0 local-test hashes identify different artifacts.
CI retains local-chain validation and also reproduces the pinned v3 hashes.

Before the first test transfer, run the read-only enrollment verifier:

```sh
node solana/tests/verify-devnet-deployment.mjs docs/deployment/devnet.json "$KINGPEPE_DEVNET_SBF_DIR"
```

`SOLANA_DEVNET_RPC_URL` must already exist in the local process environment.
Its value is private; do not put it in source, templates, command output, CI,
or public artifacts. The verifier checks actual Devnet genesis before other
reads, queries finalized accounts and transactions, and sends no transactions.
`KINGPEPE_DEVNET_SBF_DIR` points to externally built v3 binaries. No deployment
credential is needed for verification. The zero-supply verifier is intentionally
an enrollment check, not a post-transfer supply assertion.

## Enrollment

The existing setup planner exports `buildDevnetSolanaSetupTransactionPlan` and
`prepareSignedDevnetSolanaSetupTransaction`. Supply explicit fresh Program IDs
and the genesis obtained from the real RPC, not a locally asserted cluster label.
The old localnet entry points remain local-only. No second codec is introduced.

Required test network bindings:

- Solana Devnet genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Native regtest network identifier: `8000111`; genesis is imported from the
  existing Native verifier's `REGTEST_GENESIS`; Native decimals are eight.
- Initial KPEPE supply zero; standard SPL Token Program; Bridge PDA mint
  authority; freeze authority None; project fee zero.
- Two distinct test attester public keys, separate from FROST shares.

Mint creation, token-account initialization and both configuration PDAs use one
atomic transaction, signed by the fee payer, the exact Mint identity and the
new token-account identity. The Mint enrollment signature is not mint authority.
Devnet initializes as `DevnetTesting` (state byte 3); Localnet remains byte 2.
State/environment mismatches, pause and Mainnet activation still reject actions.
The Borsh layouts, accounting and replay markers are unchanged.

## Deployment procedure

Use the pinned compiler and Agave CLI, external build outputs, a clean reviewed
source SHA and its exact-SHA CI. Keep every test signing key outside all checkouts
in protected local storage. The existing Windows DPAPI helper supports the
Devnet-only `devnet-deployment-keys` purpose for deployment material; attesters
retain separate protected stores. Never write decrypted material alongside it.
CLI key inputs may be supplied through private, short-lived OS pipes. Do not
log those inputs or use a default wallet/configuration that could be production.

Use explicit Devnet RPC, program, buffer and test upgrade-authority arguments
with the normal `solana program deploy` command. Do not bypass feature checks or
preflight. Retain the same program/buffer identities when recovering a failed
deployment. Solana documents the supported [deployment commands](https://solana.com/docs/programs/deploying).
Devnet SOL is test-only and its public RPC/faucet has
[service limits](https://solana.com/docs/references/clusters); no production funds
are needed or authorized.

Before enrollment and after finalization verify from chain:

- Exact genesis, executable Program IDs, upgradeable loader, derived ProgramData
  relationships, expected test upgrade authority and deployed binary hashes.
- Mint/SPL identity, zero supply, eight decimals, exact PDA authority and no
  freeze authority; both configuration PDAs and their exact canonical Borsh data.
- Finalized deployment/enrollment transactions and their actual slots.

Keep one public deployment record: source SHA, pinned tool versions, binary
hashes, Borsh version, Program IDs, Mint, PDA(s), test authority and transaction
IDs. Exclude credentials, private configuration, local paths and runtime state.

Do not point the local operational service at Devnet by changing an endpoint.
Phase 16 separately integrates and validates the retained workers against the
real Devnet deployment. Phase 15 is not a Devnet transfer or production certificate.
