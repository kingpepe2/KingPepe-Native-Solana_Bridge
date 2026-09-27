# Solana KPEPE representation

Solana KPEPE is the bridged representation of Native KPEPE, which originates on the independent KingPepe network. The Bridge uses standard SPL Token with eight decimals. The official Mainnet Mint is `4QkWKqTMyPEyEb8RMKv3XrcHJ5jbS7k4uQhXVoirphZW`. No Token-2022 extension is required. Mainnet program deployment and earlier controlled activation have completed; current runtime availability is reported by the live status API.

The Solana implementation validates finalized-burn evidence and the originally bound recipient before exact minting. Replay protection and checked accounting enforce one mint per eligible burn and the 21,000,000 KPEPE cumulative maximum. No reverse redemption instruction is provided.

Source and reproducible artifacts must correspond to the deployed programs before activation. Pending build identities are not advertised as deployed programs.

User-funded Solana execution is an off-chain runtime/API/UI policy. It does not change the Bridge Program, Transceiver, official Mint, decimals or KPEPE conservation rules. The KPEPE Bridge fee remains 0 KPEPE; new-policy users fund their own Solana execution costs separately.
