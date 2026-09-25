# Burn → Mint protocol

KingPepe supports Native → Solana only. A completed operation preserves its original Solana destination and requires identical confirmed-deposit, finalized-burn and minted amounts in exact eight-decimal units.

The protocol binds evidence to its operation, networks, amount and destination. Canonical serialization and strict validation reject malformed or cross-context evidence. Shared implementation vectors check agreement between the Native-facing and Solana-facing encodings. A replay cannot authorize additional issuance.

Native deposit confirmation and burn finality are separate stages. No Solana mint is authorized merely by receiving a deposit or broadcasting a burn. Detailed review evidence is maintained internally.
