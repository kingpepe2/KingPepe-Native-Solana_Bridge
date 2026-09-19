# One-way Devnet validation

A fresh KingPepe REGTEST to Solana DEVNET operation completed on 2026-09-19.
The new programs use forward canonical Borsh V3. Their public identities,
deployment signatures and bytecode hashes are in [devnet.json](devnet.json).
This is TEST evidence; Mainnet is not deployed or activated.

| Check | Observed result |
| --- | --- |
| Native deposit and reserve-sweep finality | 12 confirmations required |
| Recoverable deposit delay | 1,440 Native blocks |
| Authorized amount | 100,000,000 base units (1 TEST KPEPE) |
| Solana supply before / after | 0 / 100,000,000 base units |
| Canonical message | Rust bytes = TypeScript bytes = actual signed on-chain bytes |
| Canonical digest | Exact equality |
| Finality on Solana | finalized |
| Operation state | COMPLETED |
| Reconciliation | MATCH |
| Restart / repeat status | Same completed operation, no new signing or mint |
| Pause / reviewed resume / simulated RPC outage | Consistent accounting; safe real reconnect |

Operation ID: `72eb772dc8d5e84bc5b4e396ade85407590bf353b585bf7df5031afb890b58cb`.

Native deposit: `29ad48876b8d1c69bc75d8321841d09f77a1b28340340cdc664024e54408ede8`.

Native sweep: `5b7c399bec7d537a664dedb717468f2e85340a60f53f088bcd0b9a4f3d72bbdf`.

Solana claim: `pctiqvD186Y3cCn3dg1ZfUuWZZoq1djAMcGK6Q4B4HCgg5KYzod5gXCoKQZGvutL6VbmsivNzdTNUSfT3HyrXKG`.

Solana attestation receipt: `36rhenSnASaLJXhVdQ7cA486bKFyfMDkzoXbFE5wWsmx7fzC6SzvuAHQMtFRxA1HWhUpEp5bY9kmbBS8pvDh5xT3`.

Message digest: `a8fe487f7882b1f99642ddda1d22599f9f776135bae878bf11d84944a26de89a`.

The initial harness attempt rejected Cargo's hard-linked verifier before any
Bridge operation. An independent file with identical verified bytes satisfied
the retained path boundary, and the same protected TEST run resumed. No source
guard was weakened. The later 60-second restart check is a bounded smoke test,
not a new Phase 17 soak or production recovery certification.

Before the authorized history rewrite, the Team's prior deployment reports,
final security matrix, source/CI references, Borsh vectors, recovery evidence and
operation evidence were preserved in a verified private local safety mirror.
This preserves review and rollback provenance without retaining the retired
product implementation in the rewritten public source.

The clean conversion source passed all four required CI jobs and every step
before TEST deployment. Rewritten-source build validation and exact-SHA CI are
still pending. Historical CI is not a certificate for a rewritten commit.
The private evidence retains source bindings and failed setup diagnostics.

The common-host FROST risk, account-bound protected state, configured RPC trust,
two project attesters and centralized upgrade authority remain explicit.
`externalSecurityAuditCompleted=false`; no external audit is claimed.
