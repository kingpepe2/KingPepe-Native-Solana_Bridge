# Finalized-burn attesters

`ProtectedBurnAttester` uses protected Ed25519 identity and authorization state. Both distinct configured attesters independently reverify the exact finalized Native burn and sign canonical V4 bytes. Operation, amount, destination, networks, programs/Mint, original deposit, burn outpoint and commitment are bound. A deposit-only or browser-supplied claim is not accepted evidence.

The service's two verifier/store objects share the private Bridge host, process and Windows identity in the TEST and prepared Mainnet composition. They are distinct keys and verification calls, not independently isolated security principals or consensus sources. Compromise of that private process can affect both attesters and the burn signer. Explorer has no access to these stores. Protect the separate burn, attester and payer key roles and preserve journal/chain restart recovery; no server-loss recovery is claimed.
