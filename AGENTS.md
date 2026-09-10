# AGENTS

## Authority and safety boundaries

- Project: KingPepe Native - Solana Bridge; KINGPEPE_TEAM_GOVERNANCE.
- Repository must remain PRIVATE. Original source is proprietary; preserve
  third-party licenses and exact file-by-file PROVENANCE.json coverage.
- Exact software FROST A+B, 2-of-2 on one team-controlled host is approved.
  No second computer, hardware prerequisite or 1-of-2 fallback.
- Valid normal transfers are automatic after user wallet authorization and
  one-time activation. No per-transfer KingPepe Team approval queue.
- Mainnet DISABLED; productionReady=false; productionSigningAuthorized=false;
  productionBroadcastAuthorized=false. No production provisioning, deployment,
  services, signing, broadcasting or activation without the required gates.
- Legacy material is read-only. Do not import legacy Git history.
- Keys, nonce state, databases, logs and machine-specific deployment data stay
  outside the checkout. Do not create secrets inside source and rely on ignores.
- README remains introductory. Repository templates use placeholders.
- Preserve official Solana account.owner and third-party API terms; project
  roles use KingPepe Team terminology.
- Preserve unrelated work; stage explicit files. Scan current/staged files and
  every outgoing commit, verify privacy, push normally and check exact-SHA CI.
  Never weaken security gates or bypass branch protections.

## Current phase

PHASE 08 INCOMPLETE. Phase 09 NOT_STARTED.
Last verified source: cdd95747db9e45b5a31a440f380cc1dcc2f13623, private push and
all four exact-SHA CI jobs PASS:
https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge/actions/runs/34494000161
Its current/staged/outgoing source and all 159 commits scanned clean; zero
workflow artifacts were uploaded. That evidence does not certify newer source.

Absorbing-stop source 2bdff8f1687085d63de8c628ae12a4f2efed163e was pushed
privately. CI 34470295877 completed the real deposit and all 55 checks but failed
because the workflow still required five rather than seven claim-worker checks.
Do NOT label that SHA all-CI-pass. The verified ee011923 correction requires all
seven and both named stopped-worker checks, with six executable CI-gate tests.
Sweep/claim/pipeline retries return the stored stop; late callbacks and journal
writes cannot clear it. Pipeline boundaries recheck journal/ledger status before
further signing/broadcast and retain pending credit on contradictory mint results.
Its 324 Node tests per platform include 45 stop regressions and six CI-gate tests;
exact-SHA CI completes the real deposit and all 55 integration checks. No global
restart/fencing claim follows from these cooperating-worker guards.

The verified policy increment enforces localnet/verified REGTEST genesis,
immutable private authorization lookup, frozen inspection records and strict
bounded fields. Local DKG-only capability cannot sign transactions. Windows/WSL
each pass 357 Node tests (33 new), two vectors; WSL passes 93 Rust tests and audits.
An initial 355-test run exposed two undefined-policy DKG setup calls and the first
fresh E2E failed there. The harness now uses the explicit DKG-only capability;
the guard was not bypassed. See development-status for subsequent real-chain,
scan and publication evidence. These are API boundaries, not a hostile-code sandbox.

The verified request increment: a shared immutable V1 request builder and
validator bind request ID, epoch, attempt, intent/message digest and exact A+B
ordering to the recomputed session before any signing-state/key access. The actual
Native sighash/ciphersuite is unchanged. Initial focused tests: 40 PASS / 6 FAIL;
final focused: 54 PASS. Windows/WSL: 371 Node tests (14 new) and two vectors PASS;
WSL 93 Rust tests and audits PASS. Both SBF builds, the fresh real deposit and all
55 integration checks PASS locally and in exact-SHA CI.

The verified DKG increment: V2 request/context metadata binds localnet,
verified Native REGTEST genesis, Solana deployment, both programs, Mint and key
epoch. Both participants validate before DKG state access; active-key lookup uses
the exact context-derived session. Role/index is immutable. Incompatible or
legacy V1 state is rejected without migration, replacement keys or deleting data.
This is structural/API binding, not authenticated DKG transport, signer-state
authentication or rollback proof. A delayed older DKG cannot replace a later
active epoch. Focused 78 tests PASS (24 new); Windows/WSL each pass 395 Node tests,
two vectors, and WSL 93 Rust tests/audits. Real-chain validation and publication
are recorded in development-status. Do not reuse old test roots
to bypass the new context check. The local 40-epoch retention ceiling fails
before adding another epoch; it never deletes retained records automatically.

The verified full-intent enrollment: policy stores the complete normalized
28-field immutable intent and compares its digest, retaining separate domain,
caps and stop checks. Missing/extra fields and partial enrollment are rejected;
the sweep builder preserves the complete intent. Initial focused 83 PASS / 7 FAIL,
then final focused 146 PASS. Windows/WSL each 406 Node tests (11 new), two vectors
PASS; WSL 93 Rust tests and audits PASS. Real-chain/scans/publication are tracked
in development-status. Enrollment is not evidence truth. Nonce state/protected
storage/IPC remain incomplete.

The verified nonce-abort increment: synchronous coordinator failures
attempt bound cleanup on both participants, including lost responses after a
save. Full validated signing requests are required for abort; local session and
tombstone consistency are checked without deserializing an active signing key.
Reserved nonces are removed and tombstoned; already-signed shares are preserved.
Missing/contradictory state and malformed receipts fail closed. Unconfirmed
cleanup permanently refuses signing in that coordinator instance; this is NOT
a durable service-wide hard stop or restart guarantee. No reset/fallback added.
Initial focused 87 PASS / 10 FAIL, then 97 PASS; expanded focused 168 PASS.
A final isolated tamper regression failed and was fixed: an ABORTED label cannot
hide a persisted share. A second isolated failure exposed numeric nonce-counter
coercion; the existing exact u64-string validator now rejects it. Windows/WSL
each 429 Node tests (23 new), two vectors;
WSL 93 Rust tests/audits, both SBF builds and 55 fresh real-chain checks PASS.
Scans/publication are recorded in development-status. That source still persisted
reserved nonces; the current V2 change below removes this behavior. Authenticated/
fenced state, protected storage and authenticated IPC remain required work.

The verified state-lifecycle increment: only explicit createLocal with a
genuine local policy creates an empty signer envelope, using exclusive creation.
Ordinary load/save cannot initialize missing state or overwrite incompatible or
corrupt state. I/O and JSON parse errors exclude private paths/content. Actual
local setup sites use creation; transaction signers reopen the enrolled state.
Initial focused 111 PASS / 11 FAIL; then 214 focused PASS. Windows/WSL each
442 Node tests (13 new) and two vectors PASS; WSL 93 Rust tests/audits PASS.
Real-chain validation and publication are recorded in development-status.
Exclusive creation is not an ongoing signer lease, state authentication, atomic
concurrent-update fencing or nonce restart safety. That V1 source still persisted
reserved nonces. No production configuration, keys or services were created.

Current unpublished volatile nonce/restart increment: V2 stores full validated
requests and public nonce commitments/tombstones only; secret nonce Uint8Arrays
stay in the signer-private Map. Persist-before-exposure, remove-before-consumption
and computation, and finally-buffer clearing apply on failures as well as success.
Abort discards the volatile nonce even if a subsequent state read fails. close()
discards nonce capabilities and cannot be reversed by the test availability flag.
Reopen validates the full snapshot, then burns every uncertain RESERVED session
before readiness. Completed shares retain exact idempotency. V1 state is rejected
without migration, keys or deletion. Initial 125 PASS / 8 FAIL, then 129 PASS /
4 FAIL exposed a detached-copy recovery update; fixed to explicitly replace the
stored session. Then 133 PASS; expanded 138 PASS / 1 FAIL exposed extra tombstone
metadata; strict fields/state residue checks fixed it. A late isolated regression
(0 PASS / 1 FAIL) exposed accepting a reservation with no active epoch; the
explicit missing-epoch check now rejects it. Windows/WSL each 458 Node tests
(16 new), two vectors, WSL 93 Rust/audits PASS. A real SIGKILL child crash is
tested; no key/nonce bytes are sent in test IPC or output. Fresh real-chain and
publication evidence are tracked in development-status. Long-term DKG shares
still persist in external JSON. This does not prove full snapshot/clone rollback,
power-loss durability, protected storage, service leases or global restart safety.
Next: those state/service/security dependencies before Phase 09.
Node 24.21.0 / npm 11.19.0 / bundled SQLite 3.53.4 are required. The SQLite
API remains release-candidate stability 1.2, not production approval.
See docs/development-status.md for current measured tests and publication state.

The local SQLite journal has context-bound HMAC replay, atomic event/head commits,
exclusive local leases, resource/path bounds and sticky stops. Explicit reopen
never creates missing keys or databases. A retained checkpoint detects an older
database, but co-restoring database and anchor cannot prove freshness. This is
not protected production storage, nonce rollback protection, complete bridge-wide
reconciliation or service restart. Existing claim/sweep/FROST stores have their
own remaining authentication/fencing gaps. Do not equate a local credit journal
with full automated crash recovery. See docs/security/local-deposit-accounting.md.

Real local deposit evidence includes Native-node-accepted FROST A+B BIP340/BIP342
sweeps from user-recoverable scripts into a distinct reserve, two Ed25519
attestations, actual SBF receipt/claim execution and observed SPL supply.
The Node signer uses pinned @noble/curves schnorr_FROST; native/frost Rust is
supporting policy/state-model code, NOT the cryptographic signer.
Canonical choice/UTXO and Solana observation trust the configured local validating
nodes. RPC_OBSERVATION is not independent proof or a production observer.
Production observation, service ACLs/protected storage/IPC, full restart,
global hard stops, post-mint deep-reorg response and external review remain open.
Read-only review reproduced matching Mainnet policy approval and exposed Map
mutation on the preceding source. Current regression-tested changes close these
configuration/API paths. The current request changes close envelope/intent ID
and session mismatches. The current DKG changes bind deployment metadata and
active-key selection. Current complete-intent enrollment closes purpose, evidence
digest and unsigned-transaction identity substitution. Synchronous coordinator
cleanup and isolated V2 nonce restart handling are implemented locally; complete
durable service restart and authenticated inner DKG transcripts/transport remain
open. The pinned
upstream FROST code is explicitly unaudited; never claim broader library audit
coverage applies to it. The approved same-host topology is not the cause of
these blockers. See docs/security/software-frost.md.

## Build and validation

Use scripts/local-e2e-toolchain.json and docs/deployment/local-e2e-build.md.
Node/npm engines are exact; use verified portable tools without global upgrades.
Solana host Rust 1.89.0; Native crates nightly-2023-10-29.
Linux/WSL SBF: Agave 4.2.2, cargo-build-sbf 4.1.0, platform-tools v1.54.
Programs use solana-program directly, not Anchor-generated IDLs.

- npm ci --ignore-scripts
- npm test
- npm audit --audit-level=low
- python .github/scripts/guardrails.py
- node .github/scripts/dependency-license-audit.mjs (requires Cargo metadata)
- In solana/: cargo fmt --check --all; cargo clippy --locked --workspace
  --all-targets -- -D warnings; cargo test --locked --workspace
- For native/{frost,proof,reserve,recovery}: cargo fmt --check, cargo clippy
  --locked --all-targets -- -D warnings, cargo test --locked with --manifest-path.
- Audit all five Cargo.lock files with the pinned cargo-audit; no ignored
  advisories. Retain the reported bincode 1.3.3 unmaintained warning.
- npm run doctor:local-e2e; npm run local:e2e:native-to-solana
- node solana/tests/local-deposit-security.mjs: fresh external
  KINGPEPE_LOCAL_E2E_ROOT plus the pinned isolated REGTEST/local-validator tools.
  Includes real raw-evidence, CSV, wallet PSBT, pre-mint race, claim-worker retry
  and authenticated accounting-boundary tests. Never use production material.

Windows portable Node tests differ from Linux/WSL SBF or service ACL tests.
Native Windows Cargo is not on this workstation's PATH; use WSL for the combined
dependency-license audit. Windows service ACL/protected-secret integration and
native Windows SBF are NOT_RUN. CI reports Windows Rust results separately.
No runtime/build workspace is uploaded as an artifact.

## Continuity

Authoritative: docs/development-status.md, docs/task-status.md,
BRIDGE-READINESS.json, PROVENANCE.json, UPSTREAM-REFERENCES.json and CI workflow.
Keep prior exact-SHA evidence in status documents, not relabeled as new results.
Implement/test/scan/commit/private-push/verify CI for each coherent increment.
Resolve Phase 08 dependencies before starting Phase 09. Green CI does not
authorize Mainnet, production key creation or an upgrade.
