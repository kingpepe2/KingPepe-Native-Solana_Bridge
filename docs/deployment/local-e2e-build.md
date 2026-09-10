# Isolated local build and validation

This procedure is for disposable KingPepe REGTEST and Solana local-validator
testing. Mainnet activation and production signing remain disabled.

The exact development tool versions and fetched archive checksums are in
`scripts/local-e2e-toolchain.json`. The native source commit and tree were
confirmed against the source repository, independently of the recovery notes.
Its source and required third-party notices stay together outside this checkout.
No legacy files or history are required to build the test node.

Use Linux or WSL with Node 22.23.2, Rust 1.89.0 for Solana host tests and
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

Run `node .github/scripts/dependency-license-audit.mjs` after locked installation.
CI also verifies the pinned cargo-audit binary and audits all five Cargo.lock
files. The retained bincode unmaintained warning remains visible. No advisory
ignore or production activation exception is added.

Tool references: [Agave 4.2.2 release](https://github.com/anza-xyz/agave/releases/tag/v4.2.2),
[SBF builder](https://github.com/anza-xyz/cargo-build-sbf),
[Native source pin](https://github.com/kingpepe2/king-pepe-source-code/tree/3f2621820ffefae59cbe48b350f5f8f6ec8a6da5).
