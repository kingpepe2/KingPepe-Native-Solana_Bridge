# Solana identity and execution observation

`BurnSolanaAdapter` verifies actual configured cluster genesis before and after bounded RPC calls, finalized coherent account snapshots, program/ProgramData owner and layout, enrolled deployment slot, upgrade authority, Bridge/Transceiver configuration, exact standard SPL Mint, decimals, zero-start enrollment and authority identities. Complete bytecode hashes are verified against frozen artifacts at deployment; runtime slot/authority monitoring detects a later upgrade. The browser cannot supply RPC or substitute Mint/Program.

Before Native burn, it also checks health, immutable destination ATA, unused claim/deposit/burn replay accounts, unchanged cumulative issuance and actual payer balance against current rent/transaction requirements. It creates the exact bound ATA automatically without requesting a user signature.

Finalized execution verification reconstructs the signed canonical claim packet, requires the exact MintToChecked CPI and integer recipient balance delta, and compares finalized claim/replay state. Missing data waits; an identity, bytecode or accounting contradiction persists a pause. A lost reply is recovered from existing chain state, not an uncontrolled duplicate mint.

RPC observations are a configured-source trust boundary, not independent Solana consensus proof. Mainnet transport uses explicit Mainnet admission, protected RPC configuration and reviewed deployment identities. Development constructors retain their own network restrictions. Public Mainnet activation remains pending.
