# Source audit before Mainnet program deployment

The audit started from `a919a38821c4415b94eefa68a84ba3649281bac2` and
found defects requiring a new production candidate. Implementation fix
`e3c7f298435b722b3577cedf84f6a7d749ed8fac` has been rebuilt from a fresh
archive and exercised against isolated KingPepe REGTEST and a Solana validator.
The publication containing this record requires its own exact-SHA CI. This is
a project source review, not an independent external security audit.

No Mainnet transaction was sent during this audit. The official Mint remains
`4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`, standard SPL Token,
8 decimals, zero supply and no freeze authority. Public Mainnet presentation
remains ACTIVATION PENDING with deposit acceptance disabled.

## Findings and corrections

Unsolicited SOL at a future deterministic account could prevent initialization
or completion of a finalized Native burn. The observer treated an empty System
account as an initialized claim, and the Transceiver tried to create an already
funded account. The corrected observer recognizes only exactly empty,
nonexecutable System accounts at the operation's derived addresses. The
Transceiver funds only missing rent, allocates and assigns with its PDA seeds.
Foreign, populated, executable and malformed accounts still fail closed.

The actual-chain regression also exposed a completion-verifier bound of eight
inner instructions. Allocating three pre-funded replay PDAs requires ten inner
instructions including minting. The verifier now permits that exact bounded
case and rejects nested or foreign-program CPIs, multiple mint instructions and
incorrect supply/recipient deltas. The original failure was retained; a fresh
corrected operation completed with exactly one burn and one mint.

New regression coverage includes pre-funded config, receipt, replay and recipient
accounts. Deployment/resume checks passed 8 controls, the chain regression passed
15, and the Windows protected automatic runtime passed 17, including actual
process termination after finalized burn, lost Native/Solana responses and
restart. CI requires the new configuration and chain regressions.

Current documentation was corrected to distinguish the Mainnet pending product
from historical TEST evidence and to describe the real trust boundary: distinct
attester keys/verifiers share the private Bridge process and identity. Full ELF
hash checks occur at deployment; runtime checks bind deployment slots,
authorities and account layout. Historical evidence and licensing facts remain.

Private PowerShell launch/completion wrappers were corrected to return a nonzero
exit status when their checks fail. Isolated failure injection runs before any
production store access; it does not install a release or submit transactions.

## Rebuilt production artifacts

Pinned locked SBF v3 builds from independent fresh build directories reproduce:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Bridge | 161680 | `51cca88da2c74e91c76f8c111dfbd5c4335d0bcf2ba0cb49430ba48d1553dd0d` |
| Transceiver | 181472 | `ba84137b56ad8c8aee7a72b760e5a2718cf41b7adae4df350073f20de78d59b6` |

The previous Transceiver hash is superseded for future deployment. Existing
Mainnet Mint/metadata must be reused. Requote remaining rent, fees and headroom
using these artifacts and actual chain state; never charge again for completed
accounts. Deployments must stop on unexpected occupied loader accounts rather
than replacing program identities or the Mint. Verify actual deployed bytes,
authority and configuration before enabling any Native burn.

## Scope and operational limits

The full tracked tree, current public GitHub content, related Explorer gateway
and UI, and selected private production entrypoints were reviewed. Automated
tests, source/history secret scans and public HTTP checks supplement code review;
they do not prove absence of every possible defect. Desktop/mobile rendering and
real Phantom acceptance remain PENDING_MANUAL without a connected browser.

The economic trace retains twelve deposit confirmations and twelve burn
confirmations, zero Bridge fee, separate operational fee inputs, canonical
integer amounts, V4 burn evidence, two attestations, permanent replay records,
exact recipient binding, the cumulative 21M limit and finalized-burn accounting.
There is no active reverse bridge, reserve economy or Native FROST signer.

DPAPI protection, strict ACLs and the limited private process remain required.
An installed release must match the final audited source before controlled
activation; an earlier private preflight is not certification of changed code.
SCM hosting is not required. Offline recovery is NOT_REQUIRED_BY_TEAM_DECISION;
loss of the sole usable signing material remains ACCEPTED_BY_KINGPEPE_TEAM.

The protected stores have finite capacity (512 journal/signer operations and
256 records per attester, plus byte bounds). Capacity is reserved before burn;
exhaustion holds new work. No archival/rotation capability is claimed. The final
public minimum/refill policy still requires Team resolution before normal
activation; the source-derived dust floor is not an invented economic minimum.

Program/config deployment, operational funding, final protected-release binding
and controlled Mainnet burn/mint remain activation prerequisites. A passing
source audit does not set productionReady or mainnetActivation.
