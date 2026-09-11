# Isolated local build and validation

This procedure is for disposable KingPepe REGTEST and Solana local-validator
testing. Mainnet activation and production signing remain disabled.

The repository's .gitattributes specifies LF for text on Windows and Linux/WSL.
An older Windows clone without that policy can show CRLF-only changes in WSL
Git despite identical normalized source. Verify the diff and preserve work; do
not reset a checkout to resolve line endings. New clones use the committed LF
policy. This changes no global Git defaults or binary files.

The exact development tool versions and fetched archive checksums are in
`scripts/local-e2e-toolchain.json`. The native source commit and tree were
confirmed against the source repository, independently of the recovery notes.
Its source and required third-party notices stay together outside this checkout.
No legacy files or history are required to build the test node.

Use Linux or WSL with Node 24.21.0 / npm 11.19.0, Rust 1.89.0 for Solana host tests and
nightly-2023-10-29 for the Native supporting crates. Build the
referenced KingPepe source in an external build directory using CMake/Ninja,
with wallet support enabled, GUI/tests/IPC/external signing disabled, and the
`kingpeped` and `kingpepe-cli` targets selected. This produces test executables;
it does not change or launch an existing Native node.

Use Agave CLI/validator 4.2.2 and its bundled `cargo-build-sbf` 4.1.0 with
platform-tools v1.54. The release archive's checksum must match the pin.
These local test tools are not production approval. These programs
use `solana-program` directly, so their build invokes `cargo-build-sbf` directly.
Anchor is not an executable dependency; `Anchor.toml` supplies the local Program
ID mapping. No Anchor IDL generation is claimed by this build.

Provision the normal external Solana compiler cache and pinned compiler tools
before running the test and disable rustup self-update. Never run installers
that select an unpinned latest version.

Place the verified executables on the test process's PATH, then run:

```text
npm ci --ignore-scripts
npm run doctor:local-e2e
npm run local:e2e:plan
npm run local:e2e:native-to-solana
```

Set `KINGPEPE_LOCAL_E2E_ROOT` through local configuration to a new, dedicated
directory outside all source checkouts. It must not already exist. Its parent
must exist and have suitable permissions. The runner creates this directory
exclusively, refuses source-directory aliases and ancestors, and never resets an
existing ledger. Linux directory creation requests mode 0700; dedicated Windows
service ACL validation remains separate work.

Build output and, by default, Cargo targets are under that external root.
`KINGPEPE_LOCAL_BUILD_ROOT` may select a separate external Cargo cache to avoid
recompiling dependencies on each run; every run still invokes both locked builds.
This cache never holds the SBF tool's generated keypairs. The SBF tool
generates disposable keypair files beside its `.so` outputs even when no
deployment is requested. Do not copy that directory into Git or CI artifacts.
Build the transceiver and bridge separately to avoid `no-entrypoint` feature
unification. The validator loads only the resulting `.so` files with the
configured local Program IDs.

The readiness command checks prerequisites, not economic correctness. Only an
actual complete run with both local daemons can establish the local E2E result.
Mock adapter tests, native Rust tests, and SBF compilation remain distinct checks.

The disposable Native daemon disables peer connections and DNS seeding, enables
its own transaction index, and uses a local-only funding-wallet fallback fee of
0.00001000 Native per kB. The runner mines coinbase maturity plus one block before
funding the deposit. These settings never authorize production fees or funds.

The deposit flow uses a finalized attestation receipt transaction followed by
an atomic claim/mint transaction. Shared canonical bytes avoid an oversized
packet; both are bounded to 1232 bytes. The explicit 600000-unit compute budget
is LOCALNET-only. Receipt and claim journals stay external. The observer reports
RPC_OBSERVATION from the isolated validator, not independent chain validation.

`node solana/tests/local-deposit-security.mjs` additionally runs real recovery
and failure tests. The claim-retry helper deliberately exits disposable workers
before send and after validator acceptance, waits for actual last-valid block
height expiry, and reopens the signed-claim journal without providing keys.
Allow several additional minutes for the real validator to advance. It does not
fake an expired height or claim complete service/power-loss recovery. Worker
inputs and all journal data remain local; CI reports only sanitized results.

The harness persists a canonical pending credit after reserve verification,
before Solana setup/attestation. A separately created disposable authentication
key and the database both remain under the external test root, in separate
directories. Reopening requires the existing key and database; missing material
is never replaced automatically. It reopens pending and settled accounting at
the workflow boundaries. This is a single-deposit test, not complete service
restart or production backup tooling. See
[local accounting boundaries](../security/local-deposit-accounting.md).
The SQLite API is release-candidate stability 1.2; its inclusion in the pinned
Node runtime is not production approval. `.npmrc` requires exact engine pins.

Run `node .github/scripts/dependency-license-audit.mjs` after locked installation.
CI also verifies the pinned cargo-audit binary and audits all five Cargo.lock
files. The retained bincode unmaintained warning remains visible. No advisory
ignore or production activation exception is added.

Phase 08.5 adds `node solana/tests/local-withdrawal-record.mjs` with a separate
fresh external root. It first completes a real Native-to-Solana deposit, then
executes 26 finalized burn/record prerequisite checks, including fresh and
pre-funded PDAs, wrong domains/accounts, duplicate requests, insufficient rent,
later-instruction rollback and direct burns without entitlement. Negative
transactions use skipPreflight so validator execution, not simulation, supplies
the failure evidence. The disposable 600000-unit budget is explicit: the default
200000-unit budget was measured to fail. No production compute/fee policy is set.
These probes leave unpaid test withdrawals and never construct Native payouts.

Run `node solana/tests/local-deployment-integrity.mjs` in another fresh external
root for the 18 real deployment/authority/bytecode checks. Set
`KINGPEPE_TEST_SOURCE_SHA` to the exact reviewed source commit being tested;
the manifest rejects an absent or malformed SHA. CI supplies `GITHUB_SHA`.
An uncommitted worktree may be tested, but the report must identify it as worktree
evidence, not certification of its parent commit. This probe builds explicit
SBPF v3 upgrade-test binaries; normal program builds remain SBPF v0. The hashes
are different and must not be interchanged in manifests. The real upgrade test
uses the required ProgramData extension and waits for a later finalized bank.

Run `node solana/tests/local-native-reorg.mjs` in another fresh external root
for the eight real post-mint regtest fork/incident tests. Fork controls apply
only to the disposable regtest daemon; the runtime RPC adapter does not permit
them. The completed mint and retained incident are not automatic economic repair.

For clean-clone verification, use a new clone and new CARGO_TARGET_DIR and
KINGPEPE_LOCAL_BUILD_ROOT outside it. Locked downloads/compiler installations may
be reused after verification; compiled project artifacts may not. Run Node,
vectors, all Rust workspaces/quality checks, both local daemon suites, source
guardrails, complete history scans and license/dependency audits. A fresh clone
that only passes host tests is not a fresh real-chain validation.

Tool references: [Agave 4.2.2 release](https://github.com/anza-xyz/agave/releases/tag/v4.2.2),
[SBF builder](https://github.com/anza-xyz/cargo-build-sbf),
[Native source pin](https://github.com/kingpepe2/king-pepe-source-code/tree/3f2621820ffefae59cbe48b350f5f8f6ec8a6da5).
