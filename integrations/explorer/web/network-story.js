// Informational only. Fixed public GET; no wallet, signing or Bridge-state dependency.
import {nativeActivity} from './network-story-model.js?v=network-story-v1';
import {MARKET} from './market-identities.js';

export function renderNetworkStory(host) {
  const root = document.createElement('section');
  root.className = 'network-story'; root.dataset.mode = 'DISPLAY_ONLY';
  root.setAttribute('aria-label', 'KingPepe network and story');
  root.innerHTML = `
    <header class="network-hero">
      <p class="network-eyebrow">THE NETWORK BEHIND THE FROG</p>
      <h2>KINGPEPE</h2>
      <p class="network-manifesto">Born on its own chain.<br>Secured by miners.<br><span>Bridged to Solana.</span></p>
      <p class="network-lead">A native SHA-256 Proof-of-Work cryptocurrency with an independent blockchain.</p>
      <div class="network-hero-footer"><span>NATIVE ORIGIN <span aria-hidden="true">→</span> SOLANA REPRESENTATION</span><img src="/kingpepe-logo.jpg" width="62" height="62" alt="KingPepe frog"></div>
    </header>

    <section class="network-section" aria-labelledby="native-network-title">
      <p class="network-eyebrow">01 / THE NATIVE NETWORK</p>
      <h2 id="native-network-title">KingPepe — Native SHA-256 Network</h2>
      <p class="network-subtitle">Mine on KingPepe. Bridge to Solana. Trade on-chain.</p>
      <p>KingPepe (KPEPE) is a native cryptocurrency running on its own independent Proof-of-Work blockchain. Like Bitcoin, it uses SHA-256 Proof of Work.</p>
      <p>Compatible SHA-256 mining hardware can participate according to the network’s current mining rules and a compatible mining setup. Miners contribute computing power to support the network and receive native KPEPE through its block-reward mechanism.</p>
      <div class="network-mining-card">
        <div><h3>SHA-256 Proof of Work</h3><ul><li>Independent KingPepe blockchain</li><li>Native KPEPE block rewards</li><li>Mining supports network security</li><li>Rewards follow the network’s rules</li></ul></div>
        <div class="network-observation"><span class="network-eyebrow">NATIVE NETWORK OBSERVATION</span><strong data-network="status" role="status">Checking block activity</strong><dl><div><dt>Block height</dt><dd data-network="height">—</dd></div><div><dt>Latest block time</dt><dd data-network="time">—</dd></div></dl><p data-network="activity">Current activity is checked independently of market data and Bridge availability.</p></div>
      </div>
      <p class="network-note">Mining rewards are not a profitability promise. Block production and reward amounts follow consensus rules.</p>
      <div class="network-assets"><article><span>NATIVE KPEPE</span><p>The coin on the independent KingPepe blockchain. This is the origin network.</p></article><article><span>SOLANA KPEPE</span><p>The corresponding bridged SPL asset on Solana. It is the Solana representation of native KPEPE.</p><a href="https://explorer.solana.com/address/${MARKET.mint}" target="_blank" rel="noopener noreferrer" aria-label="View the official KPEPE Solana Mint">${MARKET.mint}</a></article></div>
    </section>

    <section class="network-section network-idea" aria-labelledby="kingpepe-idea-title">
      <p class="network-eyebrow">02 / THE IDEA</p><h2 id="kingpepe-idea-title">The KingPepe Idea</h2>
      <p class="network-question">What if a Pepe coin had its own blockchain, its own miners and its own native coin?</p>
      <p>KingPepe takes Pepe beyond the usual token model: a native, mineable cryptocurrency running on its own independent SHA-256 Proof-of-Work blockchain.</p>
      <p>Mining produces native block rewards and helps keep the network operating. The KingPepe Bridge connects that native blockchain to Solana. After the required confirmations, the verified native amount is permanently burned according to the Bridge protocol. Only after that burn is verified and finalized can the matching amount be minted on Solana.</p>
      <p class="network-pullquote">Native mining on one side.<br>Solana markets on the other.<br><strong>The Bridge connects them.</strong></p>
    </section>

    <section class="network-section" aria-labelledby="native-solana-title">
      <p class="network-eyebrow">03 / TWO NETWORKS, ONE CONNECTION</p><h2 id="native-solana-title">Native → Solana Bridge</h2>
      <p>The Bridge connects the native KingPepe blockchain to Solana. For a completed Native → Solana operation, the verified native KPEPE is permanently burned and the corresponding amount is minted to the user’s bound Solana destination.</p>
      <ol class="network-bridge-flow" aria-label="Native to Solana Bridge sequence">
        <li><span>01</span><strong>Native KPEPE</strong><small>Exact amount received</small></li>
        <li><span>02</span><strong>12 confirmations</strong><small>Native deposit confirmed</small></li>
        <li><span>03</span><strong>Permanent native burn</strong><small>Then 12 burn confirmations</small></li>
        <li><span>04</span><strong>Verified attestation</strong><small>Finalized burn evidence</small></li>
        <li><span>05</span><strong>1 : 1</strong><small>Exact amount preserved</small></li>
        <li><span>06</span><strong>Solana KPEPE mint</strong><small>Original bound destination</small></li>
      </ol>
      <div class="network-conservation"><span>FOR A COMPLETED, VERIFIED OPERATION</span><p><strong>1 native KPEPE burned</strong><b aria-label="equals">=</b><strong>1 Solana KPEPE minted</strong></p><p>The KPEPE Bridge fee is 0 KPEPE. The confirmed deposit, finalized burn and corresponding mint must match. Any Solana execution funding is separate and follows the active policy shown in the Bridge panel.</p></div>
      <p>The diagram explains the protocol. Current availability, funding and progress are shown by the actual Bridge alongside it.</p>
      <h3 class="network-flow-title">From mining to markets</h3>
      <ol class="network-flow" aria-label="KingPepe network flow">${['SHA-256 miners','KingPepe blockchain','Native KPEPE','KingPepe Bridge','Permanent burn','1 : 1','Solana KPEPE','Solana markets'].map((label,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span><strong>${label}</strong></li>`).join('')}</ol>
      <p class="network-note" data-network="continuing">Mining operates on the native network; Solana markets use the bridged representation.</p>
    </section>

    <section class="network-section network-frog" aria-labelledby="why-frog-title">
      <div><p class="network-eyebrow">04 / THE CHARACTER</p><h2 id="why-frog-title">Why the Frog?</h2><p class="network-question">Because crypto does not have to be serious all the time.</p></div>
      <p>KingPepe chose the frog as a symbol of fun, internet culture and community. Underneath the character is an independent blockchain, Proof-of-Work mining, native KPEPE and a network designed to keep producing blocks.</p>
      <p class="network-pullquote">The frog is the face.<br><strong>The blockchain is the foundation.</strong></p>
    </section>

    <section class="network-section network-future" aria-labelledby="kingpepe-future-title">
      <p class="network-eyebrow">05 / THE UNWRITTEN PART</p><h2 id="kingpepe-future-title">Where Does KingPepe Go From Here?</h2>
      <p class="network-question">No one knows.</p>
      <p>Maybe KingPepe reaches the sky. Maybe the road is harder than anyone expected. Maybe, whatever happens, we come away having learned something worth remembering.</p>
      <p>There are no promises here.</p>
      <p>There is a network. There are miners. There is code. There is a community. And there is a frog.</p>
      <p class="network-future-ending">Where it goes from here is a story that has not been written yet.</p>
    </section>
    <footer class="network-sources">Explore the evidence: <a href="/blocks">Native blocks</a><span aria-hidden="true"> · </span><a href="https://github.com/kingpepe2/king-pepe-source-code" target="_blank" rel="noopener noreferrer">KingPepe source</a><span aria-hidden="true"> · </span><a href="https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge" target="_blank" rel="noopener noreferrer">Bridge source</a></footer>`;
  host.replaceChildren(root);
  let snapshot = null, stopped = false, controller, timer;
  const text = (key,value) => {root.querySelector(`[data-network="${key}"]`).textContent = value;};
  function paint() {
    const state = nativeActivity(snapshot); root.querySelector('.network-observation').dataset.state = state.state;
    text('status',state.label); text('activity',state.message); text('height',state.height === null ? '—' : state.height.toLocaleString('en-US'));
    text('time',state.blockTime === null ? '—' : new Date(state.blockTime).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}));
    text('continuing',state.state === 'RECENT_BLOCKS' ? 'Mining continues on the native KingPepe network.' : 'Mining operates on the native network; see the current block observation above.');
  }
  async function refresh() {
    controller = new AbortController(); const timeout = setTimeout(()=>controller.abort(),10_000);
    try {
      const response = await fetch('/api/v1/status',{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      if (!response.ok) throw Error('UNAVAILABLE'); const next = await response.json();
      if (!stopped) snapshot = next;
    } catch {} finally {clearTimeout(timeout); if (!stopped) {paint(); timer = setTimeout(refresh,60_000);}}
  }
  void refresh(); const healthTimer = setInterval(paint,10_000);
  return ()=>{stopped=true;clearTimeout(timer);clearInterval(healthTimer);controller?.abort();};
}
