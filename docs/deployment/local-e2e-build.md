# Isolated burn validation

Use the exact tools in `scripts/local-e2e-toolchain.json`, locked dependencies and build outputs outside every checkout. Source Native 31.1.0 is pinned by commit and archive hash. Solana host Rust is 1.89.0; Native proof uses nightly-2023-10-29. Build both SBF programs with platform-tools v1.54 and `--arch v3`; default v0 bytes are not interchangeable production provenance.

Run `npm ci --ignore-scripts`, `npm test`, Node/Rust dependency audits, license/provenance/secret scans, Solana and Native proof locked check/test/fmt/Clippy, and retained SBF builds. `npm run test:windows-security` exercises actual Windows CurrentUser DPAPI, ACL, context, lease and failure behavior.

`npm run local:proof:burn` requires a fresh external `KINGPEPE_NATIVE_BURN_RUN_ROOT`, source-built `kingpeped` on PATH and `KINGPEPE_TEST_NATIVE_VERIFIER`. It proves actual Native acceptance, exact maxburnamount rejection, fee isolation, finality/reorg, UTXO exclusion and restart.

`npm run local:e2e:native-to-solana` requires a fresh external `KINGPEPE_BURN_TEST_ROOT`, `KINGPEPE_BURN_SBF_ROOT`, `KINGPEPE_TEST_NATIVE_VERIFIER`, and pinned Native/Agave executables. It starts its own REGTEST and local validator, enrolls fresh TEST identities, burns real test units, verifies Native proof, consumes V4 attestation on actual SBF, mints exactly once and reconciles. Its ephemeral signing keys are TEST-only in memory; it is not a production signer fallback.

`npm run local:e2e:windows-runtime` additionally requires `KINGPEPE_TEST_WSL_PROFILE` and an external Linux `KINGPEPE_TEST_LEDGER_PARENT`. It runs the concrete Windows DPAPI runtime and process-kill recovery against owned real chains. Neither harness opens retained public Devnet state or Mainnet configuration. Preserve failure evidence. Stop only owned processes; never use a broad kill or delete unknown wallets/ledgers.

CI retains source-history secret scan, Linux real-chain/SBF, Node/Rust/provenance guardrails and real Windows protected-storage jobs. Each new source identity needs matching passing CI. Explorer has separate gateway, wallet/UI and browser checks in its own checkout.
