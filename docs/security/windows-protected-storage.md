# Protected signing and state

The burn service uses Windows CurrentUser DPAPI with strict NTFS ACL, fixed-volume external state roots, authenticated role/purpose/network/deployment/instance/epoch context and process exclusion. The SID must match the executing identity. The C# helper receives secrets over inherited anonymous pipes, not command arguments or logs. Missing/corrupt state, linked paths, widened ACL and wrong context fail closed; opening a store does not create replacement keys.

The burn root, Solana fee payer, and two Ed25519 attesters are distinct keys and protected stores. The burn root derives unique operation keys and a separate operational fee address; compromise therefore covers temporary deposit custody and operational fee coins. FROST is absent. The upgrade authority is another role, never reused for burn signing or fees.

The current TEST composition opens independent attester verifier/store objects in the Bridge process. Explorer talks only to authenticated loopback user endpoints. Production requires a dedicated Bridge Windows service identity, with Explorer denied access to burn stores. Current-user DPAPI tests alone do not certify that separation, portability or full-host rollback safety.

The V2 store authenticates revisions, flushes an encrypted candidate and atomically replaces the state image. Only an adjacent, authenticated interrupted-write candidate can recover. The burn journal, signer authorizations and attester authorizations acquire service-lifetime leases. Plans and input reservations precede signing; signed packets precede broadcast.

Before production: generate/import only through the reviewed protected path, bind to the dedicated identity, restrict ACL, retain encrypted offline recovery material outside Git/web roots, and test restore with TEST keys and the journal under the intended replacement identity. Verify public identities and chain continuity without a second burn/mint. A copied DPAPI blob by itself is not a portable backup.

Single-key compromise before burn may steal or redirect funds; loss may stop processing. Authorized process memory contains plaintext while signing. Cloudflare is only a web perimeter. No HSM, multisig, rollback-anchor framework or claim of complete memory erasure is introduced. Production preparation remains blocked until its own identity and recovery evidence passes.
