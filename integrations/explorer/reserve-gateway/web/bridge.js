// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import {getWallets} from './bridge-vendor/wallets.js';
import {renderPendingBridge} from './bridge-pending.js?v=bridge-banner-v1';
import {base58,bech32,bech32m} from './bridge-vendor/base.js';
import {createWalletBindings,formatBalance,shortAddress,rejectedByUser,wrongWalletNetwork} from './bridge-wallet.js?v=mainnet-pending-v1';
import {assertPublicNetwork,operationStorageKey} from './bridge-network.js?v=mainnet-pending-v1';
import {forwardProgress,bridgeAvailability,operationHelp,formatAmount,BUSY_MESSAGE} from './bridge-presentation.js?v=reserve-ux-v1';
import {createAccountingDisplay,ACCOUNTING_DISPLAY_LIMIT_MS,supplyDisplay} from './bridge-supply.js?v=accounting-shared-v3';
import {mobileBrowser,phantomBrowseLink,phantomReturnIntent,registeredPhantom} from './bridge-mobile.js?v=phantom-mobile-v1';

const id=value=>typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);
const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const publicSolana=value=>{try{return typeof value==='string'&&base58.decode(value).length===32&&base58.encode(base58.decode(value))===value;}catch{return false;}};
const publicSignature=value=>{try{return typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value)&&base58.decode(value).length===64;}catch{return false;}};
const publicNative=(value,network)=>{for(const codec of [bech32,bech32m])try{if(codec.decode(value,90).prefix===network?.nativeHrp)return true;}catch{}return false;};
const states=new Set(['DEPOSIT_ADDRESS_ISSUED','DEPOSIT_OBSERVED','DEPOSIT_FINALIZED','BURN_READY','BURN_BROADCAST','BURN_FINALIZED','ATTESTED','CLAIMED','MINTED','COMPLETED']);
export async function bridgeRequest(route,input){
  let response;
  try{response=await fetch('/api/v1/bridge'+route,{method:input===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(route==='/operations'&&input!==undefined?40000:15000),headers:input===undefined?{}:{'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});}
  catch(error){const unavailable=new Error('UNAVAILABLE');
    unavailable.accountingRefreshTransient=route==='/status'&&['TypeError','TimeoutError','AbortError'].includes(error?.name);throw unavailable;}
  if(response.status===404&&route.startsWith('/operations/'))return null;
  if(response.status===409&&route==='/operations'){
    // The Bridge refused a new transfer and said why. Only this one reason is read.
    let code=null;try{code=(await response.json())?.code;}catch{}
    throw new Error(code==='BRIDGE_BUSY'?'BRIDGE_BUSY':'UNAVAILABLE');
  }
  if(!response.ok)throw new Error('UNAVAILABLE');return response.json();
}
function renderChecking(view){
  // Neutral until the Bridge has reported its verified status. Nothing here
  // invites a deposit, and nothing states an activation state that was not read.
  const root=document.createElement('section');root.className='brx';root.dataset.runtime='CHECKING';
  root.innerHTML=`<header class="brx-head"><div><p class="brx-eyebrow">KINGPEPE BRIDGE</p><h1>Native KPEPE <span aria-hidden="true">→</span> Solana KPEPE</h1></div></header>
    <section class="brx-banner" data-tone="muted" role="status"><h2>Checking Bridge status</h2><p>Do not send funds until the Bridge status is shown.</p></section>`;
  view.replaceChildren(root);const oldTitle=document.title;document.title='KingPepe Bridge';
  return ()=>{document.title=oldTitle;};
}
export function renderBridge(view){
  let stopped=false,dispose=renderChecking(view);
  const show=render=>{if(stopped)return;dispose();dispose=render();};
  void bridgeRequest('/status').then(status=>{
    assertPublicNetwork(status);
    show(()=>status.state==='PENDING'&&status.activation==='PENDING'?renderPendingBridge(view,bridgeRequest):renderBurnBridge(view));
  }).catch(()=>show(()=>renderBurnBridge(view)));
  return ()=>{stopped=true;dispose();};
}
function renderBurnBridge(view){
  const root=document.createElement('section');root.className='brx';
  root.innerHTML=`
    <header class="brx-head">
      <div><p class="brx-eyebrow">KINGPEPE BRIDGE</p><h1>Native KPEPE <span aria-hidden="true">→</span> Solana KPEPE</h1>
        <p class="brx-lead">Move KPEPE from KingPepe Native to Solana. Your Native KPEPE is burned and the same amount is minted to your Solana wallet.</p></div>
      <div class="brx-chips"><span id="br-heading-network" class="brx-chip">Checking network…</span><span class="brx-chip">One way</span><span id="br-service" class="brx-chip brx-chip-state" data-tone="muted" role="status">Checking…</span></div>
    </header>
    <section id="br-banner" class="brx-banner" data-tone="muted" aria-labelledby="br-runtime-state"><h2 id="br-runtime-state">Checking Bridge status</h2><p id="br-runtime-message" role="status">Do not send funds until the Bridge is available and your wallet has a newly issued deposit address.</p></section>
    <div id="br-network-warning" class="brx-banner" data-tone="warn" role="note" hidden></div>
    <div class="brx-overview">
      <div class="brx-route" aria-label="Transfer direction">
        <div class="brx-chain"><span class="brx-label">From</span><strong>KingPepe Native</strong><span id="br-native-network" class="brx-sub">Checking…</span></div>
        <span class="brx-arrow" aria-hidden="true">→</span>
        <div class="brx-chain"><span class="brx-label">To</span><strong>Solana</strong><span id="br-solana-network" class="brx-sub">Checking…</span></div>
      </div>
      <dl class="brx-facts" aria-label="Bridge terms">
        <div><dt>Minimum amount</dt><dd id="br-fact-minimum">—</dd></div>
        <div><dt>Bridge fee</dt><dd>0 KPEPE</dd></div>
        <div><dt>Availability</dt><dd id="br-fact-availability" data-tone="muted">Checking…</dd></div>
      </dl>
    </div>
    <div class="brx-grid">
      <div class="brx-steps" aria-label="Native to Solana Bridge steps">
        <section class="brx-card brx-step" aria-labelledby="br-connect-title"><h2 id="br-connect-title"><span class="brx-num" aria-hidden="true">1</span>Connect wallet</h2>
          <p class="brx-text">Connect the Solana wallet that will receive your KPEPE.</p>
          <div class="brx-actions"><button id="br-connect" class="brx-btn brx-primary" type="button" aria-expanded="false" aria-controls="br-wallet-picker" disabled><span id="br-connect-label">Connect Wallet</span></button><button id="br-disconnect" class="brx-linkbtn" type="button" hidden>Disconnect</button></div>
          <div id="br-wallet-picker" class="brx-picker" hidden><p class="brx-label">Choose your wallet</p><div id="br-wallets" class="brx-wallets"></div></div>
          <p id="br-wallet-state" class="brx-help" role="status">Phantom and other compatible Solana wallets are supported.</p>
          <div id="br-solana-balances" class="brx-balances" hidden><div><span class="brx-label">SOL balance</span><strong id="br-sol-balance">—</strong></div><div><span class="brx-label">KPEPE balance</span><strong id="br-kpepe-balance">—</strong></div><button id="br-refresh-balances" class="brx-linkbtn" type="button">Refresh balances</button></div>
          <p id="br-balance-help" class="brx-help" role="status"></p>
          <details class="brx-more"><summary>Check a Native balance (optional)</summary><label for="br-native-address">KingPepe Native address</label><input id="br-native-address" type="text" maxlength="90" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Public address only" aria-describedby="br-native-balance"><div class="brx-inline"><p id="br-native-balance" class="brx-help" role="status">Balance: — KPEPE</p><button id="br-native-refresh" class="brx-linkbtn" type="button">Refresh</button></div><p class="brx-help">Balances are informational. This website cannot spend from your Native wallet.</p></details>
        </section>
        <section class="brx-card brx-step" aria-labelledby="br-request-title"><h2 id="br-request-title"><span class="brx-num" aria-hidden="true">2</span>Get your deposit address</h2>
          <div class="brx-field"><span class="brx-label">Solana destination (receives KPEPE)</span><p id="br-destination-address" class="brx-value">Connect your wallet to set the destination.</p><p id="br-destination-help" class="brx-help"></p></div>
          <p id="br-address-help" class="brx-text" role="status">Connect your wallet to begin.</p>
          <button id="br-request" class="brx-btn brx-primary brx-wide" type="button" disabled>Get Deposit Address</button>
          <p id="br-request-help" class="brx-help">The Bridge processes one transfer at a time. Request an address only when you are ready to send.</p>
        </section>
        <section class="brx-card brx-step" aria-labelledby="br-deposit-title"><h2 id="br-deposit-title"><span class="brx-num" aria-hidden="true">3</span>Send Native KPEPE</h2>
          <p id="br-deposit-empty" class="brx-text">Your unique deposit address appears here after you request it.</p>
          <div id="br-deposit" class="brx-deposit" hidden><span id="br-deposit-label" class="brx-label">Native KPEPE deposit address</span><p id="br-deposit-address" class="brx-address brx-address-deposit" tabindex="0" aria-labelledby="br-deposit-label"></p><button id="br-copy-address" class="brx-btn brx-primary" type="button">Copy Deposit Address</button>
            <p class="brx-help">This is a KingPepe Native address, used only to receive your deposit. Your KPEPE arrives at the Solana destination shown in step 2.</p>
            <p id="br-send-help" class="brx-help">Send once, from your own KingPepe Native wallet.</p>
            <dl class="brx-received"><div><dt>Amount</dt><dd id="br-received">Waiting for deposit</dd></div><div><dt id="br-confirmations-label">Deposit confirmations</dt><dd id="br-confirmations" role="status">0 / 12</dd></div></dl></div>
          <ul class="brx-rules" aria-label="Before you send">
            <li>Send at least <strong id="br-minimum">the minimum amount</strong> in a single transaction.</li>
            <li>Deposits below the minimum are not bridged, and separate deposits are not combined.</li>
            <li>The Bridge fee is <strong>0 KPEPE</strong>. You receive exactly the amount you deposit.</li>
            <li>The transfer is one way. After confirmation, Native KPEPE is burned irreversibly.</li>
          </ul>
        </section>
      </div>
      <section class="brx-card brx-progress" aria-labelledby="br-track-title"><div class="brx-progress-head"><h2 id="br-track-title"><span class="brx-num" aria-hidden="true">4</span>Track progress</h2><span id="br-operation-state" class="brx-chip brx-chip-state" data-tone="muted">Not started</span></div>
        <ol id="br-timeline" class="brx-timeline" aria-label="Transfer progress"></ol>
        <p id="br-operation-help" class="brx-text" role="status">Connect your wallet and request a deposit address to start.</p>
        <button id="br-new" class="brx-btn" type="button" hidden>Start a New Transfer</button>
        <details id="br-transaction-details" class="brx-more"><summary>Transfer details</summary><dl id="br-operation-details" class="brx-details"></dl><button id="br-copy-operation" class="brx-btn brx-small" type="button" hidden>Copy Operation ID</button></details>
        <details id="br-manual-track" class="brx-more"><summary>Track a transfer by operation ID</summary><form id="br-track-form" novalidate><label for="br-operation">Operation ID</label><div class="brx-track"><input id="br-operation" type="text" maxlength="64" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="64 hexadecimal characters" aria-describedby="br-track-help" required><button class="brx-btn" type="submit">Track</button></div><p id="br-track-help" class="brx-help" role="status"></p></form></details>
      </section>
    </div>
    <p id="br-notice" class="brx-notice" role="status" aria-live="polite"></p>
    <div class="brx-summary">
      <section class="brx-card" aria-labelledby="br-supply-title"><div class="brx-row"><h2 id="br-supply-title">Total bridged to Solana</h2><span id="br-supply-network" class="brx-chip">Checking network…</span></div><p id="br-supply-amount" class="brx-amount">Unavailable</p><p class="brx-help">of 21,000,000 KPEPE maximum Native supply</p><div id="br-supply-values" hidden><progress id="br-supply-progress" max="10000" value="0" aria-label="Bridged share of maximum supply"></progress><div class="brx-row"><span id="br-supply-percentage"></span><span class="brx-help">Remaining <strong id="br-supply-remaining"></strong></span></div></div><p id="br-supply-help" class="brx-help" role="status">Checking completed burns and mints…</p></section>
      <section class="brx-card" aria-labelledby="br-official-title"><h2 id="br-official-title">Official KPEPE Solana Mint</h2><p id="br-mint" class="brx-address" tabindex="0">Checking…</p><div class="brx-actions"><button id="br-copy-mint" class="brx-btn" type="button" disabled>Copy Mint Address</button><a id="br-mint-explorer" class="brx-link" target="_blank" rel="noopener noreferrer" hidden>View on Solana Explorer</a></div></section>
    </div>
    <p class="brx-legal">KingPepe Team · <a href="/bridge-vendor/NOTICE.txt" target="_blank" rel="noopener">Source and third-party notices</a></p>`;
  view.replaceChildren(root);window.scrollTo(0,0);
  const $=name=>root.querySelector('#br-'+name),registry=getWallets(),oldTitle=document.title;
  document.title='KingPepe Bridge';
  let network,bindings,mint,storageKey,service='UNAVAILABLE',availability=bridgeAvailability(null),minimumText='1,000',tracking='',operation=null,pendingRequest=null;
  let wallet,account,unlistenWallet,choices=[],walletEpoch=0,nativeEpoch=0,stopped=false,busy=false,polling=false,balanceBusy=false,creating=false,nativeTimer,noticeTimer;
  let retryTimer,busyAnswers=0,lastWalletBalance=0,createAttempts=0,createWindow=0,networkConflict=false,verified=false,polled=false;
  let mobileReturn=phantomReturnIntent(window.location),mobileOpening=false;
  const accounting=createAccountingDisplay();let supplyTimer;
  const notice=text=>{clearTimeout(noticeTimer);$('notice').textContent=text;if(text)noticeTimer=setTimeout(()=>{if(!stopped)$('notice').textContent='';},8000);};
  const readStored=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  const store=(key,value)=>{try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{notice('Browser storage is unavailable. Keep your operation ID.');}};
  const copy=async(text,done,failed)=>{try{await navigator.clipboard.writeText(text);notice(done);}catch{notice(failed);}};
  function controls(){
    root.dataset.runtime=verified?availability.key:polled?'UNAVAILABLE':'CHECKING';
    const shown=verified?availability:polled?bridgeAvailability(null):{key:'CHECKING',tone:'muted',pill:'Checking…',title:'Checking Bridge status',canStart:false,message:'Do not send funds until the Bridge status is shown.'};
    $('service').textContent=shown.pill;$('service').dataset.tone=shown.tone;$('fact-availability').textContent=shown.pill;$('fact-availability').dataset.tone=shown.tone;
    $('banner').dataset.tone=shown.tone;$('runtime-state').textContent=shown.title;$('runtime-message').textContent=shown.message;
    $('copy-mint').disabled=!mint||networkConflict;$('mint-explorer').hidden=!mint||networkConflict;
    $('connect').disabled=busy||!network||networkConflict;$('disconnect').disabled=busy;
    $('refresh-balances').disabled=!account||balanceBusy;$('new').hidden=operation?.state!=='COMPLETED';$('new').disabled=busy||!verified;
    $('copy-address').disabled=!operation?.depositAddress||operation.retired||networkConflict||service!=='ACTIVE';
    // A new transfer starts only on request, and only while the Bridge reports it is available.
    const started=Boolean(tracking||operation),resuming=Boolean(pendingRequest);
    $('request').hidden=started;$('request-help').hidden=started;
    $('request').disabled=creating||resuming||!account||!verified||!shown.canStart||networkConflict;
    $('request').textContent=creating||resuming?'Creating Address…':'Get Deposit Address';
    if(!started&&!creating&&!resuming)$('address-help').textContent=networkConflict?'The Bridge network changed. Do not send funds.':!verified?(polled?'Bridge status is unavailable. Do not send funds.':'Checking Bridge status…'):
      shown.key==='BUSY'?BUSY_MESSAGE:!shown.canStart?shown.message:!account?'Connect your wallet to begin.':'Your wallet is connected. Request your unique deposit address when you are ready to send.';
  }
  function progress(op){const p=forwardProgress(op);$('operation-state').textContent=p.title;$('operation-state').dataset.tone=p.tone;$('timeline').replaceChildren(...p.steps.map(step=>{
    const li=document.createElement('li');li.dataset.state=step.state;if(step.state==='current')li.setAttribute('aria-current','step');const label=document.createElement('strong'),detail=document.createElement('small');label.textContent=step.label;detail.textContent=step.detail;li.append(label,detail);return li;}));}
  function details(values){$('operation-details').replaceChildren();for(const [label,entry] of Object.entries(values)){
    const value=entry?.value??entry;if(value===null||value===undefined)continue;
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;
    if(entry?.href){const a=document.createElement('a');a.href=entry.href;a.textContent=String(value);a.className='brx-link';if(entry.external){a.target='_blank';a.rel='noopener noreferrer';}dd.append(a);}else dd.textContent=String(value);
    $('operation-details').append(dt,dd);}}
  function validateOperation(value,expectedId){
    if(!value||value.operationId!==expectedId||!id(value.operationId)||value.direction!=='NativeToSolana'||!states.has(value.state)||
      value.mint!==mint||!publicSolana(value.destination)||!publicNative(value.depositAddress,network)||value.requiredDepositConfirmations!==12||value.requiredBurnConfirmations!==12)
      throw new Error('OPERATION');
    if(value.amountAtomic!==null)formatBalance(value.amountAtomic);
    // Published by the Bridge for a deposit it holds unburned. Anything else is not shown as held.
    if(value.depositBelowMinimum!==undefined&&typeof value.depositBelowMinimum!=='boolean')throw new Error('OPERATION');
    if(value.depositBelowMinimum===true&&(value.amountAtomic===null||value.burnTxid!==null||value.solanaSignature!==null))throw new Error('OPERATION');
    if(value.executionSlot!==undefined&&!['OWNED','WAITING_FOR_EXECUTION_SLOT','NOT_REQUESTED'].includes(value.executionSlot))throw new Error('OPERATION');
    if(value.executionFunding!==undefined)throw new Error('OPERATION');
    if(operation?.operationId===value.operationId&&(operation.destination!==value.destination||operation.depositAddress!==value.depositAddress))throw new Error('DESTINATION_CHANGED');
    return value;
  }
  function applyOperation(value){
    operation=value;tracking=value.operationId;store(storageKey,tracking);$('operation').value=tracking;
    $('destination-address').textContent=value.destination;$('destination-help').textContent='This destination is fixed for this transfer, even if your connected wallet changes.';
    $('deposit').hidden=false;$('deposit-empty').hidden=true;$('deposit-address').textContent=value.depositAddress;$('address-help').textContent='Your Native KPEPE deposit address is shown in step 3.';
    const held=value.depositBelowMinimum===true,closed=value.retired||held||Boolean(value.exception)||value.amountAtomic!==null;
    $('send-help').textContent=value.retired?'This address is retired. Do not send another deposit.':held?'This deposit is below the minimum. Do not send another deposit to this address.':
      value.amountAtomic!==null?'Your deposit has been received. Do not send again.':'Send once, from your own KingPepe Native wallet.';
    $('deposit').dataset.closed=String(closed);
    $('received').textContent=value.amountAtomic===null?'Waiting for deposit':formatAmount(value.amountAtomic)+' KPEPE';
    $('confirmations-label').textContent=value.burnTxid?'Burn confirmations':'Deposit confirmations';
    $('confirmations').textContent=(value.burnTxid?value.burnConfirmations??'Checking':value.depositConfirmations)+' / 12';
    $('operation-help').textContent=operationHelp(value,minimumText);
    details({'Operation ID':tracking,'Native deposit address':value.depositAddress,
      'Native deposit transaction':id(value.depositTxid)?{value:value.depositTxid,href:'/tx/'+value.depositTxid}:null,
      'Native burn transaction':id(value.burnTxid)?{value:value.burnTxid,href:'/tx/'+value.burnTxid}:null,
      'Burn amount':value.burnAmountAtomic===null?null:formatAmount(value.burnAmountAtomic)+' KPEPE','Solana destination':value.destination,
      'Solana transaction':publicSignature(value.solanaSignature)?{value:value.solanaSignature,href:'https://explorer.solana.com/tx/'+value.solanaSignature+(network.test?'?cluster=devnet':''),external:true}:null,
      'State':value.state});
    $('copy-operation').hidden=false;progress(value);controls();
  }
  function showSupply(){
    clearTimeout(supplyTimer);if(stopped)return;
    const displayState=accounting.current(),value=displayState.supply;
    $('supply-values').hidden=!value;
    if(!value){$('supply-amount').textContent='Unavailable';$('supply-help').textContent='Verified burn and mint accounting is temporarily unavailable.';return;}
    const display=supplyDisplay(value);$('supply-amount').textContent=display.bridged+' KPEPE';$('supply-progress').value=Number(display.basisPoints);
    $('supply-percentage').textContent=display.percentage;$('supply-remaining').textContent=display.remaining+' KPEPE';
    $('supply-help').textContent=displayState.state==='STALE'?'Verifying… Showing the last verified value, which may be up to 120 seconds old.':
      network.test?'TEST bridged KPEPE from completed REGTEST → DEVNET burns and mints.':'Completed Native burns represented on Solana.';
    const deadline=value.observedAt+(displayState.state==='READY'?30000:ACCOUNTING_DISPLAY_LIMIT_MS);
    supplyTimer=setTimeout(showSupply,Math.max(1,deadline-Date.now()+1));
  }
  function clearWallet(text){walletEpoch++;unlistenWallet?.();unlistenWallet=undefined;wallet=account=undefined;$('connect-label').textContent='Connect Wallet';
    $('disconnect').hidden=true;$('solana-balances').hidden=true;$('wallet-state').textContent=text;
    if(!operation&&!pendingRequest)$('destination-address').textContent='Connect your wallet to set the destination.';controls();}
  function walletsChanged(){
    choices=registry.get().filter(w=>w.chains?.some(c=>c.startsWith('solana:'))&&w.features?.['standard:connect']&&w.features?.['standard:events']);
    $('wallets').replaceChildren(...choices.map(w=>{const b=document.createElement('button');b.type='button';b.className='brx-btn brx-wallet';b.textContent=String(w.name).slice(0,64);b.onclick=()=>void connect(w);return b;}));
    if(!choices.length){const p=document.createElement('p');p.className='brx-help';p.textContent='No compatible wallet was detected. Install Phantom or open this page in a compatible Solana wallet.';$('wallets').append(p);}
    if(mobileBrowser(navigator)&&!registeredPhantom(choices)){
      const open=document.createElement('button');open.type='button';open.className='brx-btn brx-wallet';open.textContent='Open in Phantom';open.onclick=openMobilePhantom;$('wallets').append(open);
      const help=document.createElement('p');help.className='brx-help';help.textContent='Continue on this page inside Phantom. If Phantom is not installed, install it from the official Phantom site, then return here.';$('wallets').append(help);
      const install=document.createElement('a');install.href='https://phantom.com/download';install.textContent='Get Phantom';install.className='brx-link';install.target='_blank';install.rel='noopener noreferrer';$('wallets').append(install);
    }
    if(wallet&&!choices.includes(wallet))clearWallet('Wallet unavailable. The destination of your existing transfer is unchanged.');
    resumeMobileConnection();
  }
  function openMobilePhantom(){
    if(busy||stopped||mobileOpening||network?.walletChain!=='solana:mainnet'||networkConflict)return;
    if(tracking||pendingRequest){notice('A transfer is already saved in this browser. Keep using its fixed destination and operation ID. No new transfer was opened.');return;}
    mobileOpening=true;$('wallet-state').textContent='Opening Phantom. Continue on this page inside Phantom and approve the wallet connection.';
    $('wallet-picker').hidden=false;$('connect').setAttribute('aria-expanded','true');walletsChanged();
    // Same-window navigation within the tap handler preserves the user gesture.
    // No address, operation identity or wallet data is accepted from the URL.
    window.location.assign(phantomBrowseLink());
  }
  function resumeMobileConnection(){
    if(!mobileReturn||!network||networkConflict||busy||account||stopped)return;
    const selected=registeredPhantom(choices);if(!selected)return;
    mobileReturn=false;
    try{window.history?.replaceState(null,'','/bridge');}catch{}
    void connect(selected);
  }
  function walletPageReturned(){mobileOpening=false;walletsChanged();showSupply();}
  async function loadBalances(){
    if(stopped||!account||!mint||balanceBusy)return;balanceBusy=true;controls();const epoch=walletEpoch,address=account.address;
    try{const value=bindings.balance(await bridgeRequest('/balances/solana/'+address),address,mint);if(stopped||epoch!==walletEpoch)return;
      $('sol-balance').textContent=formatAmount(value.solLamports,9);$('kpepe-balance').textContent=formatAmount(value.kpepeAtomic);$('balance-help').textContent='';lastWalletBalance=Date.now();}
    catch{if(!stopped&&epoch===walletEpoch){$('sol-balance').textContent=$('kpepe-balance').textContent='Unavailable';$('balance-help').textContent='Balances are unavailable. Try refreshing shortly.';}}
    finally{balanceBusy=false;controls();if(!stopped&&epoch!==walletEpoch&&account)void loadBalances();}
  }
  // requested: the user pressed the button. Otherwise only a request that was
  // already made, and whose answer was lost, is repeated with the same identity.
  async function issueAddress(requested=false){
    if(Date.now()-createWindow>=60000){createAttempts=0;createWindow=Date.now();}
    if(stopped||creating||tracking||!account||!verified||service!=='ACTIVE'||networkConflict||createAttempts>=3)return;
    if(!pendingRequest&&(!requested||!availability.canStart))return;
    if(pendingRequest&&pendingRequest.destination!==account.address){$('address-help').textContent='Your pending address request is bound to the original wallet. Reconnect that wallet to continue.';return;}
    pendingRequest??={clientNonce:nonce(),destination:account.address,walletChain:network.walletChain};
    const input={...pendingRequest},key=storageKey;store(key+'.request',JSON.stringify(input));creating=true;createAttempts++;
    $('destination-address').textContent=input.destination;$('address-help').textContent='Creating your unique deposit address. This can take up to 30 seconds. Please keep this page open.';controls();
    try{const value=await bridgeRequest('/operations',input);validateOperation(value,value?.operationId);
      if(value.destination!==input.destination)throw new Error('DESTINATION_CHANGED');
      // Persist public recovery identity even if navigation happened in flight.
      store(key,value.operationId);store(key+'.request',null);pendingRequest=null;busyAnswers=0;
      if(!stopped)applyOperation(value);
    }catch(error){
      // The answer to a request can be lost while the Bridge creates the address,
      // and the Bridge is then busy because of this very request. The identity of
      // the request is kept: repeated, it returns that one address and can never
      // create a second. Only a Bridge that keeps answering busy had not created it.
      const busyAnswer=error?.message==='BRIDGE_BUSY';busyAnswers=busyAnswer?busyAnswers+1:0;
      if(busyAnswers>=4){store(key+'.request',null);pendingRequest=null;busyAnswers=0;
        if(!stopped){availability=bridgeAvailability({state:'ACTIVE',executionSlot:'BRIDGE_BUSY'});$('address-help').textContent=BUSY_MESSAGE;}
      }else if(!stopped){$('address-help').textContent='Waiting for the Bridge to confirm your deposit address. Do not send funds yet. This page repeats the same request automatically.';
        clearTimeout(retryTimer);retryTimer=setTimeout(()=>void issueAddress(),5000);}
    }
    finally{creating=false;controls();}
  }
  function connected(selected,selectedAccount){
    wallet=selected;account=selectedAccount;$('connect-label').textContent='Connected · '+shortAddress(account.address);$('disconnect').hidden=false;
    $('wallet-state').textContent='Wallet connected.';$('solana-balances').hidden=false;$('wallet-picker').hidden=true;$('connect').setAttribute('aria-expanded','false');
    if(!operation&&!pendingRequest)$('destination-address').textContent=account.address;
    void loadBalances();void issueAddress();controls();
  }
  async function connect(selected){
    if(busy||stopped)return;if(!bindings?.compatible(selected)){clearWallet('Wrong Solana network. '+(network?.solanaNetwork??'The verified network')+' is required.');return;}
    busy=true;clearWallet('Waiting for wallet approval…');controls();const epoch=walletEpoch;
    try{const result=await selected.features['standard:connect'].connect({silent:false});if(stopped||epoch!==walletEpoch||!registry.get().includes(selected))return;
      connected(selected,bindings.account(selected,result.accounts));
      unlistenWallet=selected.features['standard:events'].on('change',change=>{
        if(stopped||wallet!==selected||(!change.accounts&&!change.chains))return;walletEpoch++;
        try{if(!bindings.compatible(selected))throw new Error('WalletNetworkChanged');
          connected(selected,bindings.account(selected,change.accounts??selected.accounts));
        }catch{clearWallet('Wallet disconnected or on the wrong network. The destination of your transfer is unchanged.');}
      });
    }catch(error){clearWallet(rejectedByUser(error)?'Wallet connection cancelled.':wrongWalletNetwork(error)?'Wrong Solana network.':'Wallet unavailable. Try connecting again.');}
    finally{busy=false;controls();}
  }
  async function nativeBalance(){
    clearTimeout(nativeTimer);const address=$('native-address').value.trim().toLowerCase(),epoch=++nativeEpoch;
    if(!publicNative(address,network)){$('native-balance').textContent=address?'Enter a valid '+(network?.kingpepeNetwork??'Native')+' public address.':'Balance: — KPEPE';return;}
    $('native-balance').textContent='Balance: checking…';
    try{const value=await bridgeRequest('/balances/native/'+address);if(stopped||epoch!==nativeEpoch)return;
      if(value.address!==address||value.network!==network.kingpepeNetwork||value.decimals!==8||value.kind!=='CONFIRMED_UTXO')throw new Error('BALANCE');
      $('native-balance').textContent='Balance: '+formatAmount(value.amountAtomic)+' KPEPE';}
    catch{if(!stopped&&epoch===nativeEpoch)$('native-balance').textContent='Balance unavailable. Try refreshing shortly.';}
  }
  async function poll(){
    if(polling||stopped)return;polling=true;const accountingRequest=accounting.begin();let accountingAccepted=false;
    try{const status=await bridgeRequest('/status');if(stopped)return;const network_=assertPublicNetwork(status);
      if(status.architecture!=='ONE_WAY_AUTOMATIC_BURN_AND_MINT'||status.nativeDepositConfirmations!==12||status.nativeBurnConfirmations!==12||!publicSolana(status.mint)||status.depositAmountModel!=='EXACT_RECEIVED'||!status.minimumDepositAtomic||BigInt(status.minimumDepositAtomic)<=0n)throw new Error('NETWORK');
      if(status.executionSlot!==undefined&&(!['AVAILABLE','BRIDGE_BUSY'].includes(status.executionSlot)||status.maxConcurrentExecutingOperations!==1))throw new Error('NETWORK');
      minimumText=formatAmount(status.minimumDepositAtomic);$('minimum').textContent=minimumText+' KPEPE';$('fact-minimum').textContent=minimumText+' KPEPE';
      if(network&&(network!==network_||mint!==status.mint))networkConflict=true;
      if(networkConflict)throw new Error('NETWORK_CHANGED');
      if(!network){network=network_;mint=status.mint;bindings=createWalletBindings(network.walletChain);storageKey=operationStorageKey(network,mint);
        const saved=readStored(storageKey);if(id(saved)){tracking=saved;$('operation').value=saved;$('operation-help').textContent='Resuming your saved transfer…';}
        try{const pending=JSON.parse(readStored(storageKey+'.request'));if(pending&&id(pending.clientNonce)&&pending.clientNonce!=='0'.repeat(64)&&publicSolana(pending.destination)&&pending.walletChain===network.walletChain)pendingRequest={clientNonce:pending.clientNonce,destination:pending.destination,walletChain:pending.walletChain};}catch{}
        $('native-network').textContent=network.test?'REGTEST · Test':'Mainnet';$('solana-network').textContent=network.test?'Devnet · Test':'Mainnet';$('mint').textContent=mint;
        $('heading-network').textContent=network.test?'Test mode':'Mainnet';$('official-title').textContent=network.test?'Test KPEPE Solana Mint':'Official KPEPE Solana Mint';
        $('mint-explorer').href='https://explorer.solana.com/address/'+mint+(network.test?'?cluster=devnet':'');
        $('network-warning').hidden=!network.test;$('network-warning').textContent=network.test?'TEST MODE — REGTEST → DEVNET. Do not send real KingPepe Mainnet funds.':'';
        $('supply-network').textContent=network.test?'Test data':'Mainnet';
      }
      accounting.receive(accountingRequest,status,{kingpepeNetwork:network.kingpepeNetwork,solanaNetwork:network.solanaNetwork,walletChain:network.walletChain,mint});
      accountingAccepted=true;showSupply();
      service=status.state;availability=bridgeAvailability(status);verified=true;
      if(tracking){const value=await bridgeRequest('/operations/'+tracking);if(stopped)return;if(value)applyOperation(validateOperation(value,tracking));else $('operation-help').textContent='Your saved operation was not found. Keep its ID and do not send another deposit.';}
      else if(account)await issueAddress();
      if(account&&Date.now()-lastWalletBalance>=30000)void loadBalances();
    }catch(error){if(!stopped){service='UNAVAILABLE';verified=false;
      if(!accountingAccepted)accounting.failure(accountingRequest,error?.accountingRefreshTransient===true&&!networkConflict);showSupply();
      if(networkConflict){$('deposit').hidden=true;$('deposit-empty').hidden=false;$('network-warning').hidden=false;$('network-warning').textContent='The Bridge network or Mint changed. Do not send funds. Reload this page to verify the active deployment.';}
      if(tracking)$('operation-help').textContent='Tracking is temporarily unavailable. Keep your operation ID and do not send again.';}}
    finally{polling=false;polled=true;controls();resumeMobileConnection();}
  }
  $('connect').onclick=()=>{
    if(busy||stopped)return;
    if(mobileBrowser(navigator)&&!choices.length&&network?.walletChain==='solana:mainnet'){openMobilePhantom();return;}
    $('wallet-picker').hidden=!$('wallet-picker').hidden;$('connect').setAttribute('aria-expanded',String(!$('wallet-picker').hidden));walletsChanged();
  };
  $('disconnect').onclick=async()=>{const selected=wallet;clearWallet('Disconnected. The destination of your existing transfer is unchanged.');try{await selected?.features?.['standard:disconnect']?.disconnect();}catch{}};
  $('request').onclick=()=>void issueAddress(true);
  $('refresh-balances').onclick=()=>void loadBalances();$('native-refresh').onclick=()=>void nativeBalance();
  $('native-address').oninput=()=>{nativeEpoch++;clearTimeout(nativeTimer);nativeTimer=setTimeout(()=>void nativeBalance(),650);};
  $('copy-address').onclick=()=>{if(!operation?.depositAddress||operation.retired||networkConflict||service!=='ACTIVE')return;void copy(operation.depositAddress,'Deposit address copied.','Copy is unavailable. Select the deposit address to copy it.');};
  $('copy-mint').onclick=()=>{if(!mint||networkConflict)return;void copy(mint,'Mint address copied.','Copy is unavailable. Select the Mint address to copy it.');};
  $('copy-operation').onclick=()=>{if(!tracking)return;void copy(tracking,'Operation ID copied.','Copy is unavailable. Select the operation ID to copy it.');};
  $('track-form').onsubmit=event=>{event.preventDefault();const requested=$('operation').value.trim().toLowerCase();
    if(!id(requested)){$('track-help').textContent='Enter a valid operation ID: 64 hexadecimal characters.';$('operation').setAttribute('aria-invalid','true');return;}
    if(!network){$('track-help').textContent='Bridge status is unavailable. Try again shortly.';return;}
    $('operation').removeAttribute('aria-invalid');$('track-help').textContent='Looking up the transfer…';
    void (async()=>{try{const value=await bridgeRequest('/operations/'+requested);if(stopped)return;if(value===null){$('track-help').textContent='No transfer was found for this operation ID.';return;}
      applyOperation(validateOperation(value,requested));$('track-help').textContent='Transfer loaded.';}catch{if(!stopped)$('track-help').textContent='The transfer could not be loaded. Check the operation ID and try again.';}})();};
  $('new').onclick=()=>{if(operation?.state!=='COMPLETED')return;store(storageKey,null);store(storageKey+'.request',null);operation=null;tracking='';pendingRequest=null;createAttempts=0;
    $('deposit').hidden=true;$('deposit-empty').hidden=false;$('operation').value='';$('copy-operation').hidden=true;$('destination-help').textContent='';
    $('destination-address').textContent=account?account.address:'Connect your wallet to set the destination.';$('operation-help').textContent=operationHelp(null,minimumText);details({});progress(null);controls();};
  const unregister=[registry.on('register',walletsChanged),registry.on('unregister',walletsChanged)];walletsChanged();progress(null);controls();void poll();
  const interval=setInterval(()=>void poll(),10000);
  window.addEventListener('focus',walletPageReturned);window.addEventListener('pageshow',walletPageReturned);document.addEventListener?.('visibilitychange',walletPageReturned);
  return ()=>{stopped=true;walletEpoch++;nativeEpoch++;clearInterval(interval);clearTimeout(nativeTimer);clearTimeout(supplyTimer);clearTimeout(noticeTimer);clearTimeout(retryTimer);
    window.removeEventListener('focus',walletPageReturned);window.removeEventListener('pageshow',walletPageReturned);document.removeEventListener?.('visibilitychange',walletPageReturned);unlistenWallet?.();unregister.forEach(off=>off());
    document.title=oldTitle;};
}
