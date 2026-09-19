# One-way Solana programs

`kingpepe-bridge` accepts only initialization (tag 1), deposit claim (tag 2),
and the authenticated Mainnet mode instruction (tag 4). All other tags fail.
Its configuration is 255 bytes; BridgeState is 281 bytes, version 2, including
the cumulative minted counter. A deposit claim and its backing identity have
separate PDA replay protection. Initialization requires zero Mint supply,
the derived Bridge mint-authority PDA, correct decimals and no freeze authority.

`kingpepe-transceiver` remains required. It verifies two distinct authorized
Ed25519 instructions over identical canonical deposit bytes and creates a
receipt. The Bridge independently validates the receipt's owner, PDA, domain,
epochs, destination, amount, Mint and account constraints before its mint CPI.
The Transceiver does not hold Mint authority.

Canonical Borsh V3 is 482 bytes. ABI vectors cover initialization, claims,
receipts, state, replay accounts and Mainnet mode. Native and Solana units use
eight decimals; a non-exact conversion fails. User token burns may reduce SPL
supply, but never reduce the cumulative authorized issuance counter or authorize
release of Native reserve.

Mainnet states are PAUSED, CONTROLLED and ACTIVE. The mode instruction requires
the actual upgrade authority and bound configuration; it grants no separate
arbitrary mint instruction. An upgrade authority can still replace the program
logic through the loader. The production manifest must pin actual ProgramData,
upgrade authority, Mint, PDAs, owners, source and binary hashes.

Local validator execution and finalized Devnet evidence are separate from host
parser tests. See the current status before relying on a deployment result.
