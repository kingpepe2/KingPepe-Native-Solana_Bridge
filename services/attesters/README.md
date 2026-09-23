# Finalized-burn attesters

`ProtectedBurnAttester` uses protected Ed25519 identity and authorization state. Both distinct configured attesters independently reverify the exact finalized Native burn and sign canonical V4 bytes. Operation, amount, destination, networks, programs/Mint, original deposit, burn outpoint and commitment are bound. A deposit-only or browser-supplied claim is not accepted evidence.

The service's two verifier/store objects share the TEST host and process; they are not physically independent consensus sources. Protect keys and test recovery separately from Native burn and Solana payer roles.
