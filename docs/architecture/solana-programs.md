# Solana KPEPE representation

The Bridge uses standard SPL Token with eight decimals. No Token-2022 extension is required. The existing official Mainnet KPEPE Mint is preserved; Mainnet Bridge program deployment and controlled activation remain pending.

The Solana implementation validates finalized-burn evidence and the originally bound recipient before exact minting. Replay protection and checked accounting enforce one mint per eligible burn and the 21,000,000 KPEPE cumulative maximum. No reverse redemption instruction is provided.

Source and reproducible artifacts must correspond to the deployed programs before activation. Pending build identities are not advertised as deployed programs.
