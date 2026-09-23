# Future one-way burn-and-mint production preparation

This task does not authorize Mainnet deployment, burns, production Mint creation, funding or activation. Keep productionReady=false, mainnetActivation=DISABLED, productionSigningAuthorized=false and productionBroadcastAuthorized=false. Complete the new REGTEST -> DEVNET and public TEST gates first, then return evidence and wait for the Team's next instruction.

## New production bindings

Do not reuse the reserve journal, reserve signing authority, TEST keys or historical attestation. Native Mainnet requires source-derived actual genesis/consensus admission, unique per-operation addresses, exact two-class-input burn construction, independently verified twelve-confirmation deposit and burn finality, single-use address observation, operational fee coins, burn evidence and restart recovery. The current runtime explicitly rejects Mainnet; implementing that admission remains a future reviewed change rather than a flag relabel.

Verify Solana Mainnet genesis through the protected locally configured RPC, exact program/ProgramData bytes and authority, configuration PDAs, standard SPL Mint, finality and journal binding. No private URL is browser-visible. Mainnet uses a clean dedicated burn journal and production-only identities. The prepared public payer is 47EPgcpqc11Bo3ghi22LrTA2AERFLnuXccnZhTqoEkFb; reverify it from protected material before any future transaction. Never infer funding or deployment approval from its balance.

## Burn custody and backup procedure

Select the dedicated Windows Bridge service identity and protect its profile/DPAPI capability. Explorer must not have that identity or permission to read burn stores. Generate/import the Native burn root only inside the reviewed server-side protected path; derive and record public identities, bind role/network/deployment/epoch, apply explicit private NTFS ACL and reject source/web/linked roots. Keep Native burn, Solana payer, upgrade authority and both attesters distinct.

The burn root controls per-operation derived deposit keys and its separate operational fee address. Record this exact accepted single-key scope. Compromise before burn permits theft/misdirection; loss blocks processing. Cloudflare cannot prevent same-host/private-key compromise.

Before real deposits, perform an encrypted offline recovery export and retain encrypted journal/config snapshots using the existing manual or OS-scheduled recovery policy. Keep encryption recovery material separate, outside Git and public deployment. A DPAPI blob alone is not portable recovery. Restore TEST keys and state under the intended replacement service identity; reverify public identities, chain history, finalized burns and pending mint obligations, and prove no duplicate economic action. Only then provision production recovery. Do not perform destructive production-key drills or claim full-host rollback certification.

## Fee and minimum policy

`native/burn/burn-source-policy.mjs` records KingPepe 31.1.0 source bounds. Its relay minimum is 100 atomic/kvB, wallet minimum 1000 atomic/kvB, dust relay policy 3000 atomic/kvB and raw RPC safety rate 10000000 atomic/kvB. Fallbackfee defaults to disabled. If smart-fee history is insufficient, the explicitly source-derived policy uses the greater of current relay/mempool floors and Native wallet minimum; unsupported or malformed RPC results still hold processing. This does not pretend the wallet configured a fallback fee.

Measured canonical burns range from 235 vB (two inputs) to 580 vB (eight inputs). The maximum absolute fee is the lesser of the source wallet absolute ceiling and 580 vB at the source raw-transaction rate ceiling: 5800000 atomic units. This is a safety maximum, not a normal fee. At the Native wallet minimum, the measured two-input burn costs 235 atomic units. Live Mainnet policy and representative sizes must be remeasured before activation. maxburnamount is always the exact authorized deposit amount; the Bridge independently rejects extra unspendable outputs.

Native fee funding is separate from SOL deployment funding. For N operations and a chosen measured workload, required operational Native balance is the integer sum of quoted burn fees plus enough approved change/UTXOs for concurrency. Without a Team-approved workload/refill target, no total KPEPE funding amount is invented. Depletion, conflicting fee inputs or excessive fees hold deposits without partial burn or user fee deduction.

Native source standardness gives a 330-atomic P2TR dust threshold at the source dust relay setting. This is a relay floor, not an adequate fee-abuse product policy: the measured 235-atomic operator fee must also be considered. No arbitrary production minimum is imposed. Report the final minimum/refill policy for Team resolution before accepting Mainnet deposits.

## Solana Mint, metadata and funding

Use standard SPL Token Program: no concrete requirement needs Token-2022. Required production Mint: name KingPepe, symbol KPEPE, eight decimals, initial supply zero, exact Bridge PDA mint authority, no freeze authority. Never use an external token generator or create a second unofficial Mint. Actual addresses remain PENDING_DEPLOYMENT until on-chain verification.

Prepare metadata with the verified KingPepe logo at stable Team-controlled HTTPS hosting (or reviewed content-addressed hosting), website https://kingpepe.net/ and a description of finalized Native burn representation. Verify content/hash, MIME type, CORS and persistence before metadata publication. The exact image URI remains pending Team-approved asset/hosting verification. Do not represent metadata planning as a deployed official token.

After source/artifacts are final, query actual Mainnet rent for Program/ProgramData, Mint/config accounts and deployment transaction costs, plus measured operational headroom. Keep the current fee payer balance and shortfall separate. Prior reserve-model SOL estimates are obsolete. Do not request funding until other resolvable technical gates pass. Funding is not KINGPEPE_TEAM_ACTIVATION_APPROVAL, and this task never requests that approval.

Production counter uses only the dedicated production finalized-burn/completed-mint accounting and verified official Mint. It must never import REGTEST/DEVNET numbers. A later approved deployment starts economic processing paused and follows the preserved controlled-activation amount/verification boundary before normal operation.
