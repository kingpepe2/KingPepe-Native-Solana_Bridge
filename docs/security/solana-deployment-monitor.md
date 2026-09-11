# Local deployment-integrity monitoring

Copyright (c) 2026 KingPepe Team. All Rights Reserved.

The observer queries the actual cluster genesis and one finalized bank snapshot
containing Manager, Transceiver, Mint, configuration PDAs and ProgramData accounts.
It compares these to an explicitly supplied manifest. It never enrolls an
unexpected program, authority, Mint or genesis from an RPC reply.

The manifest binds source SHA, identity version, both program identities,
loader, ProgramData PDA, upgrade authority, deployment slot, compiled executable
length/hash, allocated data length, Mint authority/precision, Native genesis,
Solana deployment, protocol/network, epochs and separate attester identities.
Configuration addresses are recomputed PDAs. Rust configuration codecs are
checked exactly; the Manager's two economic counters are decoded separately.
Traditional SPL Token, PDA mint authority, initialized Mint and no freeze
authority are mandatory. Initial supply is separately checked at enrollment.

For the upgradeable loader, Program and ProgramData discriminants and their
relationship are checked. The hash covers the exact approved executable length
after the 45-byte loader metadata; any allocated tail must be zero. Allocated
length, deployment slot and authority remain separately pinned. A Program ID
does not identify the executable hash. Legacy-loader handling is explicit and
never silently substituted for upgradeable-loader handling.

HTTP access is read-only, localnet-only, bounded, timed and redirect-free. A
single getMultipleAccounts response supplies a consistent bank context; genesis
is checked before and after the read. This remains RPC_OBSERVATION under the
configured source's trust boundary, not independent Solana consensus validation.
Loopback is a test-network restriction, not authentication or proof of honesty.

The Windows service wrapper requires genuine DPAPI progress storage, an exclusive
lifetime handle and a matching authenticated supervisor client. Progress binds
the complete manifest digest, genesis and last finalized slot. Persist-before-
return, retained revisions, clock checks and bounded no-progress age prevent a
normal restart from refreshing stale evidence automatically. Conflicting data
for an already observed finalized bank or an authenticated invalid progress
record reports an integrity incident. Source outage, malformed data or a lagging
RPC suspends observation rather than fabricating a reserve deficit.

Confirmed deployment differences propagate through authenticated supervisor
reporting to durable HARD_STOP_INTEGRITY. Once stopped, a healthy response and
ordinary observer/supervisor restart cannot clear that stop. The observer may
continue read-only collection. Runtime methods do not clear or approve changes.

## Evidence and unfinished integration

The real-validator test uses fresh disposable upgradeable deployments and a real
Native-to-Solana deposit, then deliberately mutates test authorities/bytecode.
It explicitly builds SBPF v3 with pinned cargo-build-sbf/platform tools for the
upgrade probe. The normal SBPF v0 build is separately retained and tested. A
larger replacement first extends ProgramData, then waits for a later finalized
bank before upgrading; preflight, signature checks and finality remain enabled.
Parser fixtures separately exercise malformed inputs. Current-principal Windows
tests exercise actual DPAPI, mTLS reporting and stop persistence; they are not
cross-account certification or a protected Windows whole-bridge chain E2E.
Exact outcomes and source scope belong in development-status, not inferred here.

Continuous source-health admission for all economic services, the independent
progress witness, complete operation recovery and protected chain integration
are unfinished. Do not equate a monitor component with the complete Phase 07/08
gate. Co-restoring all local state and enforcement records remains a residual
host rollback risk. Polling cannot revoke an already released attestation or
on-chain transaction, nor prove that an RPC provider did not hide a change.
Production observation, manifest approval, provisioning and activation remain
disabled/not configured. No production identity is disclosed here.
