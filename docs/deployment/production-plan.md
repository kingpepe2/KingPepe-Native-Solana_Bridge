# One-way burn-and-mint production execution

The Team explicitly authorized the initial Mainnet deployment and controlled activation, and directed use of the funded retained payer for safe independent steps. This supersedes the earlier TEST-only stopping point; no second generic activation approval is required. Authorization does not bypass failed economic or security prerequisites. Keep productionReady=false, mainnetActivation=DISABLED and the Native economic runtime signing/broadcast flags disabled until the controlled real burn/mint and normal runtime enablement pass. The public Bridge remains TEST during partial deployment.

## New production bindings

Do not reuse the reserve journal, reserve signing authority, TEST keys or historical attestation. Native Mainnet requires source-derived actual genesis/consensus admission, unique per-operation addresses, exact two-class-input burn construction, independently verified twelve-confirmation deposit and burn finality, single-use address observation, operational fee coins, burn evidence and restart recovery. The separate [Mainnet runtime and activation lifecycle](mainnet-runtime.md) use protected production credentials and a dedicated burn journal. TEST resume cannot enable Mainnet. The final private automatic signer, storage protection, access isolation and restart behavior require deployment-specific verification. Windows Service/SCM hosting and offline recovery provisioning are not prerequisites.

Verify Solana Mainnet genesis through the protected locally configured RPC, exact program/ProgramData bytes and authority, configuration PDAs, standard SPL Mint, finality and journal binding. No private URL is browser-visible. Mainnet uses a clean dedicated burn journal and production-only identities. The retained public payer is 47EPgcpqc11Bo3ghi22LrTA2AERFLnuXccnZhTqoEkFb; reverify it from protected material and verify actual balance before transactions. Preserve successful transactions and recover ambiguous responses from chain state.

## Burn custody and accepted recovery risk

Use an isolated private Bridge process identity and protect its profile/DPAPI capability. Explorer must not have that identity or permission to read burn stores. No SCM registration or reboot for the old proof service is required. Generate/import the Native burn root only inside the reviewed server-side protected path; derive and record public identities, bind role/network/deployment/epoch, apply explicit private NTFS ACL and reject source/web/linked roots. Keep Native burn, Solana payer, upgrade authority and both attesters distinct.

The burn root controls per-operation derived deposit keys and its separate operational fee address. Record this exact accepted single-key scope. Compromise before burn permits theft/misdirection; loss blocks processing. Cloudflare cannot prevent same-host/private-key compromise.

`OFFLINE_RECOVERY_BACKUP = NOT_REQUIRED_BY_TEAM_DECISION`; `RECOVERY_RISK = ACCEPTED_BY_KINGPEPE_TEAM`. No offline copy or replacement-host recovery is claimed. Loss of the only usable burn signing material may leave confirmed but unburned deposits unavailable for automatic processing/recovery. Cloudflare does not mitigate that risk. Do not request an offline recipient certificate, fingerprint or destination as an activation control, or create a local substitute to mark it passed.

Before real deposits, verify the actual protected private signer, automatic admission/signing, process restart, journal reload, RPC reconnect and ambiguous-response recovery with no second burn/mint. Retain the optional snapshot tooling and historical TEST evidence without claiming server-loss recovery. Do not perform destructive production-key drills or claim full-host rollback certification.

## Fee and minimum policy

`native/burn/burn-source-policy.mjs` records KingPepe 31.1.0 source bounds. Its relay minimum is 100 atomic/kvB, wallet minimum 1000 atomic/kvB, dust relay policy 3000 atomic/kvB and raw RPC safety rate 10000000 atomic/kvB. Fallbackfee defaults to disabled. If smart-fee history is insufficient, the explicitly source-derived policy uses the greater of current relay/mempool floors and Native wallet minimum; unsupported or malformed RPC results still hold processing. This does not pretend the wallet configured a fallback fee.

Measured canonical burns range from 235 vB (two inputs) to 580 vB (eight inputs). The maximum absolute fee is the lesser of the source wallet absolute ceiling and 580 vB at the source raw-transaction rate ceiling: 5800000 atomic units. This is a safety maximum, not a normal fee. At the Native wallet minimum, the measured two-input burn costs 235 atomic units. Live Mainnet policy and representative sizes must be remeasured before activation. maxburnamount is always the exact authorized deposit amount; the Bridge independently rejects extra unspendable outputs.

Native fee funding is separate from SOL deployment funding. For N operations and a chosen measured workload, required operational Native balance is the integer sum of quoted burn fees plus enough approved change/UTXOs for concurrency. Without a Team-approved workload/refill target, no total KPEPE funding amount is invented. Depletion, conflicting fee inputs or excessive fees hold deposits without partial burn or user fee deduction.

Native source standardness gives a 330-atomic P2TR dust threshold at the source dust relay setting. This is a relay floor, not an adequate fee-abuse product policy: the measured 235-atomic operator fee must also be considered. No arbitrary production minimum is imposed. Report the final minimum/refill policy for Team resolution before accepting Mainnet deposits.

## Solana Mint, metadata and funding

Use standard SPL Token Program: no concrete requirement needs Token-2022. The official production Mint has been created and verified with name KingPepe, symbol KPEPE, eight decimals, initial supply zero, exact Bridge PDA mint authority and no freeze authority. [Mainnet evidence](mainnet.json) records the finalized transaction and actual identities. Programs and configs remain pending. Never recreate this Mint, use an external token generator, or publish a planned program as deployed.

Metadata is published at https://kingpepe.net/metadata/kpepe-mainnet.json and bound on-chain to the official Mint. It uses the exact Team-approved image https://i.postimg.cc/G28mCc8N/King-Pepe-Icon-500x500.png and official website https://kingpepe.net/. The approved image was verified as a 500-by-500 PNG. The JSON is Team-hosted; image availability depends on the approved external image host. Metadata management uses the protected Mint enrollment authority and is distinct from token minting authority.

After source/artifacts are final, query actual Mainnet rent for Program/ProgramData, Mint/config accounts and deployment transaction costs, plus measured operational headroom. Keep the current fee payer balance and shortfall separate. Prior reserve-model SOL estimates are obsolete. The corrected budget is 1.795339560 SOL; the first finalized Mint/metadata step used 0.014810600 SOL. Requote pending steps, preserve the same payer and continue safe independent work. Funding and the explicit existing deployment authorization never waive burn-safety checks.

Production counter uses only the dedicated production finalized-burn/completed-mint accounting and verified official Mint. It must never import REGTEST/DEVNET numbers. After program deployment and all critical prerequisites pass, start economic processing in the controlled paused state. Record the smallest technically valid, meaningful controlled amount before execution, as authorized by the Team, and require exact 1:1 completion and reconciliation before normal operation.
