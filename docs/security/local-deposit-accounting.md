# Forward burn accounting

The active equation is documented in [monetary supply](monetary-supply.md). There is no permanent spendable reserve credit. The journal distinguishes issued addresses, observed/finalized deposits, reserved exact burn inputs, signed/broadcast burns, finalized burns, pending claims and finalized/completed mints.

Native deposit and fee inputs are reserved across operations before signing. One deposit transaction/output may authorize one canonical burn. The full deposit value enters the OP_RETURN output. Separate Bridge fee coins cover the miner fee and change. A depleted or conflicted fee wallet holds the deposit; it never reduces minted value.

Burn evidence remains durable across restart. Already finalized burns are obligations even if Solana RPC or attestation is temporarily unavailable. Reconciliation compares those obligations with actual final Native evidence, official Mint supply and cumulative program issuance. Unknown issuance, missing finalized evidence or changed accepted chain basis persists a pause and reason.
