// The KingPepe story below the Bridge. Informational only: fixed public GET reads, no wallet,
// no signing, no Bridge-state dependency. Every number shown comes from a public API and is
// checked in network-story-model.js; nothing is invented when a read fails.
import {nativeActivity, networkStats, nativeSupply, bridgePolicy, supplyPicture, formatCount, formatKpepe, formatHashrate, formatDifficulty} from './network-story-model.js?v=story-v3';
import {MARKET} from './market-identities.js';

const SOLANA_EXPLORER = 'https://explorer.solana.com/address/' + MARKET.mint;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// Small line icons, drawn here so the page depends on no external artwork.
const I = {
  mining: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="12" width="32" height="24" rx="3"/><path d="M14 20h20M14 26h14M14 32h8"/><path d="M4 18h4M4 24h4M4 30h4M40 18h4M40 24h4M40 30h4"/></svg>',
  chain: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="16" width="12" height="16" rx="2"/><rect x="18" y="16" width="12" height="16" rx="2"/><rect x="32" y="16" width="12" height="16" rx="2"/><path d="M16 24h2M30 24h2"/></svg>',
  coin: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="10"/><path d="M24 17v14M20 20h6a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h6"/></svg>',
  burn: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6c2 7 10 10 10 20a10 10 0 0 1-20 0c0-5 3-8 5-10 0 4 2 6 4 7 0-6 1-12 1-17z"/></svg>',
  bridge: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 32c8-14 32-14 40 0"/><path d="M4 32h40M12 32v-8M24 32V19M36 32v-8"/></svg>',
  verify: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5l15 6v12c0 9-6 16-15 20C15 39 9 32 9 23V11z"/><path d="M16 24l6 6 11-12"/></svg>',
  solana: '<svg viewBox="0 0 397.7 311.7" aria-hidden="true" class="story-solana-mark"><use href="#kpSolBars"/></svg>',
  market: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 40h36"/><path d="M8 32l10-10 8 6 14-16"/><path d="M32 12h8v8"/></svg>',
  equal: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 19h24M12 29h24"/></svg>',
};

const JOURNEY = [
  {icon:'mining', title:'SHA-256 mining', text:'Miners commit computing power'},
  {icon:'chain', title:'KingPepe blockchain', text:'An independent Proof-of-Work chain'},
  {icon:'coin', title:'Native KPEPE', text:'Block rewards on the native network'},
  {icon:'burn', title:'Permanent burn', text:'The bridged amount leaves the native chain for good'},
  {icon:'bridge', title:'1:1 verified Bridge', text:'Burn finality checked before any mint'},
  {icon:'solana', title:'Solana KPEPE', text:'The official bridged representation', solana:true},
  {icon:'market', title:'Solana markets', text:'Where the bridged asset trades', solana:true},
];

function journey(steps, className) {
  return `<ol class="story-journey ${className}" aria-label="From mining to Solana markets">${steps.map((s,i) => `
    <li class="story-node${s.solana ? ' is-solana' : ''}" data-reveal style="--i:${i}">
      <span class="story-node-icon">${I[s.icon]}</span>
      <strong>${s.title}</strong><small>${s.text}</small>
    </li>`).join('')}</ol>`;
}

const picture = (name, alt, width, height, className = '', sizes = '') =>
  `<img class="${className}" src="/story/${name}.webp?v=story-v3" alt="${alt}" width="${width}" height="${height}" loading="lazy" decoding="async"${sizes}>`;

export function renderNetworkStory(host) {
  const root = document.createElement('section');
  root.className = 'network-story'; root.dataset.mode = 'DISPLAY_ONLY';
  root.setAttribute('aria-label', 'KingPepe network and story');
  root.innerHTML = `
    <header class="story-hero" data-reveal>
      <div class="story-hero-text">
        <p class="network-eyebrow">THE NETWORK BEHIND THE FROG</p>
        <h2 class="story-manifesto"><span>Born on its own chain.</span><span>Secured by miners.</span><span class="is-solana">Bridged to Solana.</span></h2>
        <p class="story-lead">KingPepe began as a native SHA-256 Proof-of-Work cryptocurrency — not as a token on another chain.</p>
        <p class="story-lead">Real miners secure the KingPepe blockchain and produce Native KPEPE through block rewards. The KingPepe Bridge connects that original blockchain to Solana through a verified burn-and-mint process.</p>
      </div>
      <div class="story-hero-art" aria-hidden="true">${picture('frog-portrait', '', 480, 432, 'story-hero-frog')}<span class="story-hero-glow"></span></div>
      ${journey(JOURNEY, 'is-strip')}
    </header>

    <section class="story-part" aria-labelledby="story-origin-title" data-reveal>
      <p class="network-eyebrow">01 / NATIVE ORIGIN</p>
      <h2 id="story-origin-title" class="story-title">Native by design</h2>
      <div class="story-columns">
        <div>
          <p class="story-big">KingPepe is an independent SHA-256 Proof-of-Work blockchain.</p>
          <p>KPEPE originates through mining on the Native KingPepe network. Miners contribute SHA-256 computing power, secure the chain and receive block rewards according to the network’s consensus rules.</p>
          <p class="story-statement">KingPepe was built as a native cryptocurrency first.<br><strong>Solana came later.</strong></p>
          <p class="network-note">Mining rewards are not a profitability promise. Block production and reward amounts follow consensus rules.</p>
        </div>
        <div class="story-stats" data-network-panel>
          <p class="story-stats-head"><span class="story-pulse" aria-hidden="true"></span><strong data-network="status" role="status">Checking block activity</strong></p>
          <dl>
            <div><dt>Block height</dt><dd data-count="height">—</dd></div>
            <div><dt>Difficulty</dt><dd data-live="difficulty">—</dd></div>
            <div><dt>Network hashrate</dt><dd data-live="hashrate">—</dd></div>
            <div><dt>Latest block</dt><dd data-live="time">—</dd><dd class="story-hash" data-live="hash"></dd></div>
            <div><dt>Maximum supply</dt><dd>21,000,000 <span>KPEPE</span></dd></div>
          </dl>
          <p class="network-note" data-network="activity">Current activity is checked independently of market data and Bridge availability.</p>
        </div>
      </div>
    </section>

    <section class="story-part story-idea" aria-labelledby="story-idea-title" data-reveal>
      <p class="network-eyebrow">02 / THE IDEA</p>
      <h2 id="story-idea-title" class="story-title">From mining to markets</h2>
      <p class="story-big">What happens when a mineable native cryptocurrency wants access to the speed and ecosystem of Solana without abandoning its original blockchain?</p>
      <p class="story-answer">KingPepe’s answer is the Bridge.</p>
      <div class="story-columns">
        <p>Native KPEPE remains rooted in the SHA-256 KingPepe blockchain. When KPEPE moves to Solana, the corresponding Native amount is permanently burned before anything else happens. Only after that burn is verified and finalized can the matching amount be minted on Solana.</p>
        <p class="story-triplet"><span>One asset.</span><span>Two networks.</span><span class="is-solana">One verified connection.</span></p>
      </div>
      <p class="story-statement">No duplicate economic supply.</p>
    </section>

    <section class="story-part story-burn" aria-labelledby="story-burn-title" data-reveal>
      <p class="network-eyebrow">03 / BURN → MINT</p>
      <h2 id="story-burn-title" class="story-conservation">
        <span class="story-burn-side"><b>1</b> Native KPEPE<br>burned</span>
        <span class="story-equals" aria-label="equals">${I.equal}</span>
        <span class="story-mint-side is-solana"><b>1</b> Solana KPEPE<br>minted</span>
      </h2>
      <p class="story-caption">For a completed, verified Bridge operation.</p>
      <ol class="story-process" aria-label="Bridge process">
        <li data-reveal style="--i:0"><span>01</span><strong>Native deposit received</strong><small>To the unique address bound to one Solana destination</small></li>
        <li data-reveal style="--i:1"><span>02</span><strong>Required confirmations</strong><small data-live="deposit-confirmations">Native deposit confirmations</small></li>
        <li data-reveal style="--i:2" class="is-burn"><span>03</span><strong>Permanent Native burn</strong><small>The exact confirmed amount leaves the native chain</small></li>
        <li data-reveal style="--i:3"><span>04</span><strong>Burn verified</strong><small data-live="burn-confirmations">Burn finality and attestation</small></li>
        <li data-reveal style="--i:4"><span>05</span><strong>1:1 amount preserved</strong><small>Deposit, burn and mint must match</small></li>
        <li data-reveal style="--i:5" class="is-solana"><span>06</span><strong>Solana KPEPE minted</strong><small>To the originally bound destination</small></li>
      </ol>
      <div class="story-policy" data-bridge-panel>
        <div data-reveal style="--i:0"><span>BRIDGE FEE</span><strong data-live="fee">—</strong></div>
        <div data-reveal style="--i:1"><span>MINIMUM</span><strong data-live="minimum">—</strong></div>
        <div data-reveal style="--i:2"><span>EXECUTION</span><strong data-live="flight">—</strong></div>
      </div>
      <p class="network-note" data-live="policy-note">Policy values are read from the live Bridge status. Current availability is shown by the Bridge above.</p>
    </section>

    <section class="story-part story-supply" aria-labelledby="story-supply-title" data-reveal>
      <p class="network-eyebrow">04 / SUPPLY</p>
      <h2 id="story-supply-title" class="story-title">One economic supply</h2>
      <div class="story-columns">
        <div>
          <p class="story-big">Solana KPEPE is not a second supply. It represents KPEPE that crossed the Bridge after an equal Native burn.</p>
          <p>Every bridged coin left the native chain permanently before it was minted on Solana. Counting Native KPEPE and Solana KPEPE together therefore counts each coin once — and the total can never exceed the maximum.</p>
        </div>
        <div class="story-supply-card">
          <p class="story-supply-max"><span>MAX SUPPLY</span><strong>21,000,000 KPEPE</strong></p>
          <div class="story-supply-bar" role="img" aria-label="Share of the maximum supply: native unspent and Solana bridged">
            <span class="is-native" data-bar="native"></span><span class="is-solana" data-bar="bridged"></span>
          </div>
          <dl class="story-supply-figures">
            <div><dt><i class="is-native"></i>Native KPEPE unspent</dt><dd data-count="native-supply">—</dd></div>
            <div><dt><i class="is-burn"></i>Native permanently burned for the Bridge</dt><dd data-live="burned">—</dd></div>
            <div><dt><i class="is-solana"></i>Solana KPEPE bridged</dt><dd data-count="bridged-supply">—</dd></div>
          </dl>
          <p class="network-note" data-live="supply-note">Native unspent from the node’s coin set; bridged supply from the Bridge’s verified accounting. Burned and bridged are one amount, shown once.</p>
        </div>
      </div>
    </section>

    <section class="story-part story-sequence" aria-labelledby="story-sequence-title" data-reveal>
      <p class="network-eyebrow">05 / FROM MINERS TO SOLANA</p>
      <h2 id="story-sequence-title" class="story-title">The whole project in one line</h2>
      ${journey([
        {icon:'mining', title:'ASIC miners', text:'SHA-256 hardware at work'},
        {icon:'chain', title:'KingPepe blockchain', text:'Blocks every minute, by consensus'},
        {icon:'coin', title:'KPEPE', text:'The native coin'},
        {icon:'burn', title:'Burn', text:'Permanent, exact'},
        {icon:'bridge', title:'Bridge', text:'Verified 1:1'},
        {icon:'solana', title:'Solana', text:'Official bridged Mint', solana:true},
        {icon:'market', title:'DEX markets', text:'Trading on Solana', solana:true},
      ], 'is-wide')}
      <p class="network-note" data-network="continuing">Mining operates on the native network; Solana markets use the bridged representation.</p>
    </section>

    <section class="story-part story-frog" aria-labelledby="story-frog-title" data-reveal>
      <div class="story-frog-art">${picture('frog-card', 'KingPepe: the crowned frog and the $kingpepe wordmark', 640, 640)}</div>
      <div>
        <p class="network-eyebrow">06 / THE CHARACTER</p>
        <h2 id="story-frog-title" class="story-title">Why the frog?</h2>
        <p class="story-big">Because a blockchain can be serious without taking itself too seriously.</p>
        <p class="story-triplet is-stacked"><span>The frog is the character.</span><span>The blockchain is the foundation.</span></p>
        <p>Behind KingPepe is an independent Proof-of-Work network, SHA-256 miners, native KPEPE and a verified connection to Solana.</p>
      </div>
    </section>

    <section class="story-part story-final" aria-labelledby="story-final-title" data-reveal>
      <div class="story-final-art" aria-hidden="true">${picture('king-portrait', '', 720, 512)}</div>
      <div class="story-final-text">
        <p class="network-eyebrow">07 / BUILT. MINED. BRIDGED.</p>
        <h2 id="story-final-title" class="story-title">Built. Mined. Bridged.</h2>
        <p>KingPepe began with its own blockchain. Miners keep producing blocks. The Bridge connects Native KPEPE to Solana.</p>
        <p>What grows around that foundation is up to the people who use, mine and build around the network.</p>
        <p class="story-closing"><span>The frog is the face.</span><span>The blockchain is the foundation.</span><span class="is-solana">The Bridge connects the two worlds.</span></p>
        <nav class="story-cta" aria-label="Explore KingPepe">
          <a href="/blocks" data-link>Explore blocks</a>
          <a href="/mining" data-link>Start mining</a>
          <a href="#bridge" class="is-primary">Open Bridge</a>
          <a href="${SOLANA_EXPLORER}" target="_blank" rel="noopener noreferrer" class="is-solana">View Solana KPEPE</a>
        </nav>
        <p class="story-mint">Official Solana Mint <a href="${SOLANA_EXPLORER}" target="_blank" rel="noopener noreferrer">${MARKET.mint}</a></p>
      </div>
    </section>
    <footer class="network-sources">Explore the evidence: <a href="/blocks" data-link>Native blocks</a><span aria-hidden="true"> · </span><a href="https://github.com/kingpepe2/king-pepe-source-code" target="_blank" rel="noopener noreferrer">KingPepe source</a><span aria-hidden="true"> · </span><a href="https://github.com/kingpepe2/KingPepe-Native-Solana_Bridge" target="_blank" rel="noopener noreferrer">Bridge source</a></footer>`;
  host.replaceChildren(root);

  // ---- motion: reveal on scroll and count-up, both skipped under prefers-reduced-motion.
  const motion = !reducedMotion(), frames = new Set(); let observer = null;
  if (motion && 'IntersectionObserver' in globalThis) {
    root.classList.add('has-motion');
    observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); observer.unobserve(e.target); } }, {rootMargin:'0px 0px -8% 0px', threshold:0.12});
    for (const el of root.querySelectorAll('[data-reveal]')) observer.observe(el);
  }
  const shown = new Map(); // element -> last value, so a refresh only animates a change
  function setNumber(el, value, format) {
    const previous = shown.get(el) ?? null; shown.set(el, value);
    if (value === null) { el.textContent = '—'; return; }
    if (previous !== null && previous === value) return;
    const target = Number(value);
    if (!motion || !el.isConnected) { el.textContent = format(value); return; }
    // A value not shown before counts up from zero; a later change counts from the old value.
    const from = previous === null ? 0 : Number(previous), start = performance.now(), duration = 900;
    const step = now => { const t = Math.min(1, (now - start) / duration), eased = 1 - (1 - t) ** 3;
      el.textContent = t < 1 ? format(typeof value === 'bigint' ? BigInt(Math.round(from + (target - from) * eased)) : from + (target - from) * eased) : format(value);
      if (t < 1) frames.add(requestAnimationFrame(step)); };
    frames.add(requestAnimationFrame(step));
  }

  // ---- live data
  const live = {status:null, network:null, supply:null, bridge:null};
  let stopped = false; const controllers = new Set(), timers = new Set();
  const text = (selector, value) => { const el = root.querySelector(selector); if (el) el.textContent = value; };
  const q = key => root.querySelector(`[data-count="${key}"]`);
  function paint() {
    const now = Date.now(), activity = nativeActivity(live.status, now), stats = networkStats(live.network);
    const panel = root.querySelector('[data-network-panel]'); panel.dataset.state = activity.state;
    text('[data-network="status"]', activity.label); text('[data-network="activity"]', activity.message);
    setNumber(q('height'), activity.height ?? stats.height, v => formatCount(Number(v)));
    text('[data-live="difficulty"]', formatDifficulty(stats.difficulty)); text('[data-live="hashrate"]', formatHashrate(stats.hashrate));
    text('[data-live="time"]', activity.blockTime === null ? '—' : new Date(activity.blockTime).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}));
    text('[data-live="hash"]', stats.bestHash && activity.height !== null ? stats.bestHash.slice(0, 16) + '…' + stats.bestHash.slice(-8) : '');
    text('[data-network="continuing"]', activity.state === 'RECENT_BLOCKS' ? 'Mining continues on the native KingPepe network.' : 'Mining operates on the native network; see the current block observation above.');

    const policy = bridgePolicy(live.bridge, MARKET.mint, now);
    text('[data-live="fee"]', policy.feeAtomic === null ? '—' : formatKpepe(policy.feeAtomic, 8) + ' KPEPE');
    text('[data-live="minimum"]', policy.minimumAtomic === null ? '—' : formatKpepe(policy.minimumAtomic, 8) + ' KPEPE');
    text('[data-live="flight"]', policy.singleFlight === true ? 'One transfer at a time' : policy.singleFlight === false ? 'Several transfers at a time' : '—');
    text('[data-live="deposit-confirmations"]', policy.depositConfirmations === null ? 'Native deposit confirmations' : `${policy.depositConfirmations} Native deposit confirmations`);
    text('[data-live="burn-confirmations"]', policy.burnConfirmations === null ? 'Burn finality and attestation' : `${policy.burnConfirmations} burn confirmations, finality and attestation`);
    root.querySelector('[data-bridge-panel]').dataset.state = policy.minimumAtomic === null ? 'UNAVAILABLE' : policy.busy ? 'BUSY' : 'READY';
    text('[data-live="policy-note"]', policy.minimumAtomic === null ? 'Policy values are read from the live Bridge status, which is not available right now. Current availability is shown by the Bridge above.'
      : policy.busy ? 'Read from the live Bridge status. Another transfer is being processed right now; the Bridge above says when it is available again.' : 'Read from the live Bridge status. Current availability is shown by the Bridge above.');

    const supply = supplyPicture(nativeSupply(live.supply), policy);
    setNumber(q('native-supply'), supply.nativeAtomic, v => formatKpepe(v) + ' KPEPE');
    setNumber(q('bridged-supply'), supply.bridgedAtomic, v => formatKpepe(v) + ' KPEPE');
    text('[data-live="burned"]', supply.burnedForBridgeAtomic === null ? '—' : formatKpepe(supply.burnedForBridgeAtomic) + ' KPEPE');
    root.querySelector('[data-bar="native"]').style.width = (supply.nativeShare ?? 0) + '%';
    root.querySelector('[data-bar="bridged"]').style.width = (supply.bridgedShare ?? 0) + '%';
    text('[data-live="supply-note"]', supply.totalAtomic === null
      ? 'Native unspent from the node’s coin set; bridged supply from the Bridge’s verified accounting, shown only while fresh. Burned and bridged are one amount, shown once.'
      : `Together ${formatKpepe(supply.totalAtomic)} KPEPE, ${(Number(supply.totalAtomic * 10_000n / supply.maxAtomic) / 100).toFixed(2)}% of the maximum. Burned and bridged are one amount, shown once.`);
  }
  async function read(route, key) {
    const controller = new AbortController(); controllers.add(controller); const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(route, {method:'GET', credentials:'omit', redirect:'error', cache:'no-store', signal:controller.signal});
      if (!response.ok) throw Error('UNAVAILABLE'); const next = await response.json();
      if (!stopped) live[key] = next;
    } catch { if (!stopped) live[key] = null; } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function schedule(task, ms) { const timer = setTimeout(() => { timers.delete(timer); if (!stopped) task(); }, ms); timers.add(timer); }
  async function refreshNetwork() { await Promise.all([read('/api/v1/status', 'status'), read('/api/v1/network', 'network')]); if (!stopped) { paint(); schedule(refreshNetwork, live.status && live.network ? 60_000 : 20_000); } }
  // A failed read is tried again soon; a good one is refreshed every two minutes.
  async function refreshSupply() { await Promise.all([read('/api/v1/supply', 'supply'), read('/api/v1/bridge/status', 'bridge')]); if (!stopped) { paint(); schedule(refreshSupply, live.supply && live.bridge ? 120_000 : 20_000); } }
  paint(); void refreshNetwork(); schedule(refreshSupply, 2_500);
  const healthTimer = setInterval(() => { if (!stopped) paint(); }, 15_000);
  return () => { stopped = true; clearInterval(healthTimer); for (const t of timers) clearTimeout(t); for (const c of controllers) c.abort(); for (const f of frames) cancelAnimationFrame(f); observer?.disconnect(); };
}
