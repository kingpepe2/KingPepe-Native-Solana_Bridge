# Production program upgrade control

This is the final KingPepe Team production policy:

- `upgradeAuthorityModel = SINGLE_KEY_WITH_REVIEW_CONTROL`
- `upgradeReviewWindow = NONE`
- `fixedTimelock = false`

One dedicated key controls production program upgrades. There is no fixed
waiting period, enforced time delay, custom timelock program, automatic upgrade
scheduler, multisig requirement or DAO. This document is a manual operational
control, not an on-chain restriction. The authority remains a centralized trust
point: its holder can technically change program behavior without this process.
That limitation is an explicit KingPepe Team decision, not a decentralization claim.
Solana's [program deployment documentation](https://solana.com/docs/programs/deploying)
describes the upgrade authority and Program/ProgramData relationship.

This policy applies only to future production program upgrades. It does not
introduce any waiting period or Team approval into normal deposits, automatic Native burn signing or minting. Existing verification/finality requirements
remain unchanged. This policy does not itself provision a key or authorize a
deployment. The existing Devnet authority is a test identity,
not an implicit production key selection.

## Dedicated key boundary

Keep the private key in protected local/private storage, outside Git, build
artifacts, reports, command output and logs. Never publish its contents
or operational storage path. Only its public authority address may be recorded.
Do not reuse it for the fee payer, relayer, Native burn signer or attesters. A
separate fee payer is required; there is no fee-payer reuse exception. Generate
or migrate private material only under explicit local provisioning authorization,
never as a side effect of a template or documentation update. Recovery and
custody material remain private.

The Phase-19 local preparation record is in `BRIDGE-READINESS.json`. Its public
authority address may be published; its protected key, local configuration and
storage paths must not be. Successful local key/permission checks do not certify
the remaining production RPC, burn signer, runtime or deployment configuration.
CurrentUser DPAPI custody is account-bound, not proof of replacement-host recovery.

## Required procedure for each upgrade

1. Identify the exact reviewed source SHA and the current/target cluster and
   program IDs. Review the proposed code diff, including dependencies, ABI,
   authority/configuration and accounting implications.
2. Build the exact Solana programs with the approved pinned tools and build
   options. Verify reproducibility and the expected bytecode hashes where
   applicable. Record the exact artifact lengths/hashes; do not substitute a
   different local architecture build for the reviewed deployment artifact.
3. Run required tests, require all required exact-SHA CI jobs to PASS, and run
   secret scanning. Retain non-secret results tied to that source and artifact.
4. Record a non-secret upgrade intent: reviewed source SHA, diff/review reference,
   current and proposed program/bytecode identities, tests/CI/scan references,
   affected programs, compatibility assessment and post-upgrade checks.
5. Verify the live target program and its upgrade authority against the intended
   cluster and approved public identities. An identity mismatch stops execution.
6. Obtain and record **KingPepe Team approval for that specific production
   upgrade**, after the preceding review and validation. Approval identifies the
   exact SHA, targets and hashes; changing any of them requires renewed review
   and approval. There is no fixed waiting period after these requirements pass.
7. Execute manually using the dedicated authority and reviewed artifact only.
   Pause the bridge before changes that could make economic safety uncertain.
   Account for already-submitted transactions that may still finalize; pause
   does not undo a submitted transaction. Keep read-only observation available
   where safe. There is no automatic upgrade execution or automatic repair.
8. Verify finalized deployed bytecode/hash, Program/ProgramData identities,
   upgrade authority, expected configuration PDAs, Mint binding, Bridge PDA mint
   authority and absence of freeze authority. Verify compatibility, journal
   continuity and reconciliation before any reviewed resume. Preserve the
   existing Mint, supply and operation records; never recreate them to upgrade.
   Record the public deployment transaction IDs and verification result.

If validation or post-upgrade verification fails, keep or put the bridge PAUSED,
retain evidence and seek Team review. Any corrective upgrade follows the same
specific-approval procedure; a previous artifact is not automatically safe.

## Critical security incident

Document the condition and affected operation/program; pause first where possible
when economic safety is uncertain. Expedite review, builds, tests, exact-SHA CI,
secret scan and specific Team approval, but do not bypass them. Record the exact
SHA and bytecode hash and perform all post-upgrade checks. There is no fixed
delay to waive and no automatic emergency scheduler. This supersedes the earlier
operational-timelock proposal.

## Readiness gate

The [planning checklist](../../config/examples/production-readiness.example.json)
is not executable runtime configuration. The KingPepe Team has removed independent
external review as a mandatory roadmap gate: `externalSecurityReview =
NOT_REQUIRED_BY_TEAM`, `externalSecurityAuditCompleted = false`. This is not a
claim that an audit occurred or that unaudited risks were resolved. Known unsafe
production blockers still prevent activation. Phase 19 requires all retained
readiness gates and verified production upgrade-authority configuration. The Team
has supplied the initial `KINGPEPE_TEAM_ACTIVATION_APPROVAL`; the public Bridge
remains activation pending until deployment and controlled verification complete.
The latest source-audit instruction prohibits deployment transactions during the
audit. Initial activation approval does not pre-approve later program upgrades.
Offline recovery provisioning and Windows Service/SCM hosting are not activation
requirements under the final Team policy; actual signer security still is.
