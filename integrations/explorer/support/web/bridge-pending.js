// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import { OFFICIAL_KPEPE_MINT } from './bridge-mainnet.js';
import { assertPublicNetwork } from './bridge-network.js?v=mainnet-pending-v1';
import { validateSupply, supplyDisplay } from './bridge-supply.js?v=mainnet-pending-v1';

export function renderPendingBridge(view, request) {
  const root = document.createElement('section'); root.className = 'bridge-page bridge-pending';
  root.innerHTML = `
    <img class="bridge-banner" src="/kingpepe-bridge-banner-4c6e94d9.jpg" width="1280" height="427" alt="KingPepe Native to Solana Bridge" decoding="async">
    <header class="bridge-heading"><h1>KingPepe Bridge</h1><div class="bridge-badges"><span class="pill">MAINNET</span><span class="pill">ONE WAY</span></div><p>KingPepe Native → Solana</p><p>Burn Native → Mint Solana 1:1</p></header>
    <section class="card bridge-box bridge-official" aria-labelledby="br-official-title"><h2 id="br-official-title">Official KPEPE Solana Mint</h2><p id="br-official-mint" class="bridge-address">${OFFICIAL_KPEPE_MINT}</p><div class="bridge-copy-actions"><button id="br-copy-mint" class="btn" type="button">Copy Mint Address</button><a class="bridge-link" href="https://explorer.solana.com/address/${OFFICIAL_KPEPE_MINT}" target="_blank" rel="noopener noreferrer">View Mint on Solana Explorer</a></div><p id="br-copy-status" class="bridge-help" role="status"></p></section>
    <section class="bridge-warning bridge-activation" aria-labelledby="br-activation-title"><h2 id="br-activation-title">MAINNET BRIDGE — ACTIVATION PENDING</h2><p>The official KPEPE Solana Mint has been created. The KingPepe Native → Solana Bridge is completing final Mainnet deployment and activation.</p><p><strong>DO NOT SEND KPEPE YET.</strong> Do not send KPEPE to any Bridge deposit address until this notice changes to “BRIDGE ACTIVE”.</p><p>No deposits are being accepted yet.</p></section>
    <section class="card bridge-box" aria-label="Solana wallet"><button id="br-connect" class="btn primary bridge-connect" type="button" disabled aria-describedby="br-wallet-state">Connect Solana Wallet</button><p id="br-wallet-state" class="bridge-help">Bridge activation pending. Wallet connection and deposit-address issuance will become available after activation.</p></section>
    <section class="card bridge-supply" aria-labelledby="br-supply-title"><div class="bridge-supply-row"><h2 id="br-supply-title">Total Bridged to Solana</h2><span class="pill">MAINNET</span></div><p id="br-supply-amount" class="bridge-supply-amount">Checking…</p><p class="bridge-help">Maximum KingPepe Supply: 21,000,000 KPEPE</p><div id="br-supply-values" hidden><progress id="br-supply-progress" max="10000" value="0" aria-label="Bridged share of maximum supply"></progress><div class="bridge-supply-row"><span id="br-supply-percentage"></span><span class="bridge-supply-remaining">Remaining <strong id="br-supply-remaining"></strong></span></div></div><p id="br-supply-help" class="bridge-help" role="status">Verifying the Mainnet baseline…</p></section>
    <section class="card bridge-box" aria-labelledby="br-flow-title"><h2 id="br-flow-title">Production Bridge flow — after activation</h2><ol class="bridge-planned-flow"><li>Connect Solana Wallet.</li><li>Receive a unique KingPepe Native deposit address.</li><li>Send Native KPEPE.</li><li>Wait for 12 Native deposit confirmations.</li><li>Native KPEPE is automatically and irreversibly burned.</li><li>The burn is verified after 12 Native burn confirmations.</li><li>Exact 1:1 KPEPE is minted on Solana.</li><li>KPEPE arrives in the originally bound Solana wallet.</li></ol><p><strong>1 KPEPE Native burned = 1 KPEPE minted on Solana.</strong></p><p>Bridge fee: <strong>0</strong>. The Bridge pays the Native burn miner fee separately. Your deposit amount is not reduced.</p><details class="bridge-advanced"><summary>About KingPepe KPEPE</summary><p>KingPepe (KPEPE) is the Solana representation of KingPepe Native, created through the official one-way KingPepe Native → Solana Bridge. Eligible KingPepe Native is irreversibly burned and, after verified Native finality, the corresponding amount of KPEPE is minted 1:1 on Solana. The bridge is one-way only and the maximum KingPepe supply is 21,000,000 KPEPE.</p><p>Standard SPL Token · 8 decimals · No freeze authority</p></details></section>
    <nav class="bridge-official-links" aria-label="Official KingPepe links"><a href="https://kingpepe.carrd.co/" target="_blank" rel="noopener noreferrer">KingPepe Website</a><a href="https://kingpepe.net/bridge">KingPepe Bridge</a><a href="https://x.com/kingpepe111" target="_blank" rel="noopener noreferrer">KingPepe on X</a><a href="https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge" target="_blank" rel="noopener noreferrer">Bridge GitHub</a></nav>`;
  view.replaceChildren(root); window.scrollTo(0, 0);
  const $ = name => root.querySelector('#br-' + name), oldTitle = document.title;
  const badge = document.querySelector('.net-badge'), oldBadge = badge?.textContent;
  const banner = document.getElementById('ecoBanner'), oldBanner = banner ? [...banner.childNodes] : [];
  document.title = 'KingPepe Bridge — Mainnet Activation Pending';
  if (badge) badge.textContent = 'MAINNET';
  if (banner) banner.textContent = 'KingPepe Native → Solana · Activation pending';
  let stopped = false, polling = false;
  $('copy-mint').onclick = async () => {
    try { await navigator.clipboard.writeText(OFFICIAL_KPEPE_MINT); $('copy-status').textContent = 'Mint address copied.'; }
    catch { $('copy-status').textContent = 'Select the Mint address above to copy it.'; }
  };
  async function poll() {
    if (stopped || polling) return; polling = true;
    try {
      const status = await request('/status'); if (stopped) return;
      assertPublicNetwork(status);
      if (status.state !== 'PENDING' || status.mint !== OFFICIAL_KPEPE_MINT || status.activation !== 'PENDING' || status.depositsAccepted !== false)
        throw Error('STATUS_CHANGED');
      const supply = validateSupply(status.supply, status);
      if (supply.state !== 'READY') throw Error('BASELINE_UNAVAILABLE');
      const display = supplyDisplay(supply);
      $('supply-amount').textContent = display.bridged + ' KPEPE'; $('supply-values').hidden = false;
      $('supply-progress').value = Number(display.basisPoints); $('supply-percentage').textContent = display.percentage;
      $('supply-remaining').textContent = display.remaining + ' KPEPE';
      $('supply-help').textContent = 'Verified Mainnet zero-supply baseline. Public deposits are disabled.';
    } catch {
      if (!stopped) { $('supply-amount').textContent = 'Unavailable'; $('supply-values').hidden = true;
        $('supply-help').textContent = 'Mainnet baseline verification is unavailable or the deployment changed. Reload to check. Do not send funds.'; }
    } finally { polling = false; }
  }
  void poll(); const interval = setInterval(() => void poll(), 10000);
  return () => { stopped = true; clearInterval(interval); document.title = oldTitle;
    if (badge) badge.textContent = oldBadge; if (banner) banner.replaceChildren(...oldBanner); };
}
