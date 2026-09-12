# Local bridge integration tests

`local-deposit-security.mjs` runs the real isolated KingPepe REGTEST and Solana
local-validator deposit flow, raw-evidence/policy and on-chain replay/domain
checks. Its helpers exercise Native CSV recovery, wallet PSBT signing, competing
FROST sweep/recovery spends with pre-mint forks, and signed-claim worker crashes
with actual Solana blockhash expiry. Unit fixtures are separate from these tests.

Run with the pinned tools and a fresh external test root as specified in
`docs/deployment/local-e2e-build.md`. No runtime state, keys or logs belong here.
CI requires the real checks to pass and uploads no runtime directory.

`local-withdrawal-e2e.mjs` covers the retained bidirectional bridge. The combined
`local-bridge-service.mjs` exercises automatic observation/settlement through the
service loop, real process exits, response loss, blockhash expiry and pause/resume.
Neither harness certifies production services, power-loss recovery, full-host
rollback resistance or activation readiness.
Exact current test counts and source-bound evidence are in the status files.
