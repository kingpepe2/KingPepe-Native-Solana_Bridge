# Native Token Transfers (NTT) Comparison

## Scope and selected commit

- Reference repo: `wormhole-foundation/native-token-transfers`
- Reference commit: `250d810d42b005526e4fb7e3aea75d2d2ab8fdbb`
- Decision: **compare-only in this stage**; no upstream runtime/source import yet.

## Directory comparison

### Matched structure we plan to keep

- `solana/`:
  - `programs/*` – target keeps a dedicated program workspace layout.
  - `modules/*` – message module concept retained for shared message schema.
  - `fuzz/`, `tests/`, `ts/` – required by later phases.
- `README` conventions and build tooling expectations.

### Intentionally excluded for this project

- `xrpl/`, `evm/`, `sui/`, `cli/` (chain-specific alternatives not part of this bridge).
- TON-oriented or chain-specific deployment references from other chains.
- Upstream examples not aligned with KingPepe operational model.

## Trust model and assumptions difference

- NTT is a multi-chain reference with chain-agnostic relay components.
- KingPepe design requires:
  - same-host 2-of-2 software FROST with explicit A/B separation,
  - explicit reservation/liability accounting between Native and Solana,
  - automatic transfer authorization policies.
- Therefore, direct code reuse requires explicit policy and cryptographic binding redesign.

## Use decision by component family

1. **Program layout and module boundaries**
   - Decision: Modified reuse pattern; no direct copy yet.
   - Rationale: required custom trust boundaries and state model.
2. **Replay protection / message encoding**
   - Decision: Reference logic expected, but concrete encoding and domain binding is still project-specific.
3. **ATTESTATION and witness path**
   - Decision: Reference-only; no direct runtime code copied in this phase.
4. **Fuzz and test templates**
   - Decision: Reuse test strategy shape in later phases, pending project-specific vectors.

## Tooling and license tracking

- Upstream commit carries Apache-2.0 license.
- Concrete imports will continue to reference source SHA and keep Apache headers in files we adopt.

