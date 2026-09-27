// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import {getWallets} from './bridge-vendor/wallets.js';
import {renderPendingBridge} from './bridge-pending.js?v=bridge-banner-v1';
import {base58,bech32,bech32m} from './bridge-vendor/base.js';
import {createWalletBindings,formatBalance,shortAddress,rejectedByUser,wrongWalletNetwork} from './bridge-wallet.js?v=mainnet-pending-v1';
import {assertPublicNetwork,operationStorageKey} from './bridge-network.js?v=mainnet-pending-v1';
import {forwardProgress} from './bridge-presentation.js?v=mainnet-pending-v1';
import {createAccountingDisplay,ACCOUNTING_DISPLAY_LIMIT_MS,supplyDisplay} from './bridge-supply.js?v=accounting-shared-v2';
import {mobileBrowser,phantomBrowseLink,phantomReturnIntent,registeredPhantom} from './bridge-mobile.js?v=phantom-mobile-v1';
import {signExecutionPayment,validateExecutionQuote} from './bridge-execution.js?v=user-funded-v2';

const id=value=>typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);
const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const publicSolana=value=>{try{return typeof value==='string'&&base58.decode(value).length===32&&base58.encode(base58.decode(value))===value;}catch{return false;}};
const publicNative=(value,network)=>{for(const codec of [bech32,bech32m])try{if(codec.decode(value,90).prefix===network?.nativeHrp)return true;}catch{}return false;};
const states=new Set(['AWAITING_EXECUTION_FUNDING','DEPOSIT_ADDRESS_ISSUED','DEPOSIT_OBSERVED','DEPOSIT_FINALIZED','BURN_READY','BURN_BROADCAST','BURN_FINALIZED','ATTESTED','CLAIMED','MINTED','COMPLETED']);
export async function bridgeRequest(route,input){
  let response;
  try{response=await fetch('/api/v1/bridge'+route,{method:input===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(15000),headers:input===undefined?{}:{'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)})});}
  catch(error){const unavailable=new Error('UNAVAILABLE');
    unavailable.accountingRefreshTransient=route==='/status'&&['TypeError','TimeoutError','AbortError'].includes(error?.name);throw unavailable;}
  if(response.status===404&&route.startsWith('/operations/'))return null;
  if(!response.ok)throw new Error('UNAVAILABLE');return response.json();
}
export function renderBridge(view){
  // Start with a disabled Mainnet presentation, including when status is down.
  // A verified active/paused runtime is required before loading operation UI.
  let stopped=false,dispose=renderPendingBridge(view,bridgeRequest);
  void bridgeRequest('/status').then(status=>{
    assertPublicNetwork(status);
    if(!stopped&&status.state!=='PENDING'){dispose();dispose=renderBurnBridge(view);}
  }).catch(()=>{});
  return ()=>{stopped=true;dispose();};
}
function renderBurnBridge(view){
  const root=document.createElement('section');root.className='bridge-page';
  root.innerHTML=`
    <img class="bridge-banner" src="/kingpepe-bridge-banner-4c6e94d9.jpg" width="1280" height="427" alt="KingPepe Native to Solana Bridge" decoding="async">
    <header class="bridge-heading"><h1>KingPepe Bridge</h1><p>Bridge your KPEPE from KingPepe Native to Solana.</p><p class="small muted">One-way deposits only.</p></header>
    <section class="card bridge-supply" aria-labelledby="br-supply-title"><div class="bridge-supply-row"><h2 id="br-supply-title">Total Bridged to Solana</h2><span id="br-supply-network" class="pill">Checking network…</span></div><p id="br-supply-amount" class="bridge-supply-amount">Unavailable</p><p class="bridge-help">of 21,000,000 KPEPE maximum Native supply</p><div id="br-supply-values" hidden><progress id="br-supply-progress" max="10000" value="0" aria-label="Bridged share of maximum supply"></progress><div class="bridge-supply-row"><span id="br-supply-percentage"></span><span class="bridge-supply-remaining">Remaining <strong id="br-supply-remaining"></strong></span></div></div><p id="br-supply-help" class="bridge-help" role="status">Checking completed burns and mints…</p></section>
    <div id="br-network-warning" class="bridge-warning" role="note">Checking the Bridge network. Do not send funds yet.</div>
    <section class="card bridge-box" aria-label="Native to Solana transfer">
      <div class="bridge-direction"><div><span class="label">FROM</span><strong>KingPepe Native</strong><span id="br-native-network" class="pill">Checking…</span></div><span class="bridge-arrow" aria-hidden="true">→</span><div><span class="label">TO</span><strong>Solana KPEPE</strong><span id="br-solana-network" class="pill">Checking…</span></div></div>
      <section class="bridge-wallet" aria-label="Solana destination wallet"><p class="label">1 · Connect your Solana wallet</p><div class="bridge-wallet-actions"><button id="br-connect" class="btn primary bridge-connect" type="button" aria-expanded="false" aria-controls="br-wallet-picker" disabled><span id="br-connect-label">Connect Solana Wallet</span></button><button id="br-disconnect" class="bridge-link" type="button" hidden>Disconnect</button></div><div id="br-wallet-picker" class="bridge-wallet-picker" hidden><p class="small muted">Choose your wallet</p><div id="br-wallets"></div></div><p id="br-wallet-state" class="bridge-help" role="status">Phantom and compatible Solana wallets.</p><div id="br-solana-balances" class="bridge-balances" hidden><span>SOL Balance <strong id="br-sol-balance">—</strong></span><span>KPEPE Balance <strong id="br-kpepe-balance">—</strong></span><button id="br-refresh-balances" class="bridge-link" type="button">Refresh balances</button></div><p id="br-balance-help" class="bridge-help" role="status"></p></section>
      <div class="bridge-destination"><span class="label">Solana destination</span><p id="br-destination-address">Connect your wallet to receive KPEPE.</p><p id="br-destination-help" class="bridge-help"></p></div>
      <section id="br-deposit" class="bridge-send" hidden><p class="label">SEND KPEPE NATIVE TO:</p><p id="br-deposit-address" class="bridge-address"></p><button id="br-copy-address" class="btn" type="button">Copy Address</button><p id="br-minimum" class="bridge-help"></p><p id="br-send-help">Send once from your own KingPepe Native wallet.</p><p class="bridge-help">Your deposit authorizes the transfer. After confirmation, Native KPEPE is burned irreversibly and the exact amount is minted to your bound Solana wallet.</p><p id="br-received" class="bridge-send-amount">Amount: Waiting for deposit</p><p id="br-confirmations" class="bridge-help" role="status">Confirmations: 0 / 12</p></section>
      <section id="br-execution" class="bridge-summary" hidden aria-label="Solana execution funding"><h3>Solana execution funding</h3><p><strong id="br-execution-cost"></strong></p><p>Paid by: <span id="br-execution-payer"></span></p><p id="br-execution-breakdown" class="bridge-help"></p><p id="br-execution-status" role="status">Awaiting fee approval</p><button id="br-pay" class="btn primary" type="button">Pay &amp; Continue</button><p class="bridge-help">Your SOL funds only this operation, including its disclosed retry and account-recreation allowance. Before burn, a fresh check may require an additional payment from this same wallet. After burn begins, the funds remain reserved for mint completion. Unused allowance is returned after completion, less the refund network cost. If no Native deposit arrives within 24 hours, unused funding is refundable after verification. Account rent already spent is not refunded by this flow.</p><p id="br-execution-refund" class="bridge-help"></p></section>
      <p id="br-address-help" class="bridge-help" role="status">Connect your wallet to begin. New transfers require verified Solana execution funding before a Native deposit address is issued.</p>
      <div class="bridge-summary"><span>KPEPE Bridge fee: <strong>0 KPEPE</strong></span><span id="br-service" class="pill" role="status">Checking service…</span></div><p class="bridge-help">The Bridge pays the Native burn miner fee separately. Your deposit amount is not reduced.</p>
      <label for="br-native-address">Your KingPepe Native Address <span class="muted small">· optional</span></label><input id="br-native-address" type="text" maxlength="90" spellcheck="false" placeholder="Public address only" aria-describedby="br-native-balance"><div class="bridge-inline"><p id="br-native-balance" class="bridge-help" role="status">Balance: — KPEPE</p><button id="br-native-refresh" class="bridge-link" type="button">Refresh</button></div>
      <p id="br-notice" class="bridge-notice" role="status" aria-live="polite"></p>
    </section>
    <section class="card bridge-status" aria-labelledby="br-track-title"><div class="bridge-inline"><h2 id="br-track-title">Operation Status</h2><span id="br-operation-state" class="pill">Waiting for deposit</span></div><p id="br-operation-help" class="bridge-help" role="status">Connect your wallet to start.</p><ol id="br-timeline" class="bridge-timeline" aria-label="Transfer progress"></ol><button id="br-new" class="btn" type="button" hidden>Start a new transfer</button>
      <details id="br-transaction-details" class="bridge-advanced"><summary>Transaction details</summary><dl id="br-operation-details" class="bridge-details"></dl><p class="small muted bridge-mint">Official KPEPE Mint <span id="br-mint">Checking…</span></p><p class="bridge-help">Native balances are informational. The website cannot spend from your Native wallet.</p></details>
      <details id="br-manual-track" class="bridge-advanced"><summary>Track another operation</summary><form id="br-track-form"><label for="br-operation">Operation ID</label><div class="bridge-track"><input id="br-operation" type="text" maxlength="64" spellcheck="false" required><button class="btn" type="submit">Track</button></div></form></details>
    </section><p class="bridge-legal small muted">KingPepe Team · <a href="/bridge-vendor/NOTICE.txt" target="_blank" rel="noopener">Source and third-party notices</a></p>`;
  view.replaceChildren(root);window.scrollTo(0,0);
  const $=name=>root.querySelector('#br-'+name),registry=getWallets(),oldTitle=document.title;
  const badge=document.querySelector('.net-badge'),oldBadge=badge?.textContent,banner=document.getElementById('ecoBanner'),oldBanner=banner?[...banner.childNodes]:[];
  document.title='KingPepe Bridge';if(badge)badge.textContent='Bridge';if(banner)banner.textContent='One-way KingPepe Bridge';
  let network,bindings,mint,storageKey,service='UNAVAILABLE',tracking='',operation=null,pendingRequest=null;
  let wallet,account,unlistenWallet,choices=[],walletEpoch=0,nativeEpoch=0,stopped=false,busy=false,polling=false,balanceBusy=false,creating=false,nativeTimer;
  let lastWalletBalance=0,createAttempts=0,createWindow=0,networkConflict=false,paying=false;
  let mobileReturn=phantomReturnIntent(window.location),mobileOpening=false;
  const accounting=createAccountingDisplay();let supplyTimer;
  const notice=text=>{$('notice').textContent=text;};
  const readStored=key=>{try{return localStorage.getItem(key);}catch{return null;}};
  const store=(key,value)=>{try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{notice('Browser storage is unavailable. Keep your public operation ID.');}};
  function controls(){
    $('connect').disabled=busy||!network||networkConflict;$('disconnect').disabled=busy;
    $('refresh-balances').disabled=!account||balanceBusy;$('new').hidden=operation?.state!=='COMPLETED';$('new').disabled=busy||service!=='ACTIVE';
    $('copy-address').disabled=!operation?.depositAddress||operation.retired||networkConflict||service!=='ACTIVE';
    $('pay').disabled=paying||busy||operation?.executionFunding?.policy!=='USER_FUNDED'||account?.address!==operation?.destination||networkConflict||service!=='ACTIVE';
  }
  function progress(op){const p=forwardProgress(op);$('operation-state').textContent=p.title;$('timeline').replaceChildren(...p.steps.map(step=>{
    const li=document.createElement('li');li.dataset.state=step.state;const label=document.createElement('strong'),detail=document.createElement('small');label.textContent=step.label;detail.textContent=step.detail;li.append(label,detail);return li;}));}
  function details(values){$('operation-details').replaceChildren();for(const [label,value] of Object.entries(values))if(value!==null&&value!==undefined){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);$('operation-details').append(dt,dd);}}
  function validateOperation(value,expectedId){
    if(!value||value.operationId!==expectedId||!id(value.operationId)||value.direction!=='NativeToSolana'||!states.has(value.state)||
      value.mint!==mint||!publicSolana(value.destination)||!(publicNative(value.depositAddress,network)||value.depositAddress===null&&value.state==='AWAITING_EXECUTION_FUNDING'&&value.executionFunding?.policy==='USER_FUNDED')||value.requiredDepositConfirmations!==12||value.requiredBurnConfirmations!==12)
      throw new Error('OPERATION');
    if(value.amountAtomic!==null)formatBalance(value.amountAtomic);
    if(operation?.operationId===value.operationId&&(operation.destination!==value.destination||operation.depositAddress!==null&&operation.depositAddress!==value.depositAddress))throw new Error('DESTINATION_CHANGED');
    return value;
  }
  function applyOperation(value){
    operation=value;tracking=value.operationId;store(storageKey,tracking);$('operation').value=tracking;
    $('destination-address').textContent=value.destination;$('destination-help').textContent='This destination is fixed for this transfer, even if your connected wallet changes.';
    $('deposit').hidden=value.depositAddress===null;$('deposit-address').textContent=value.depositAddress??'';$('address-help').textContent=value.depositAddress===null?'Approve the displayed SOL execution payment to continue. Do not send Native KPEPE yet.':'';
    $('copy-address').disabled=value.retired;$('send-help').textContent=value.retired?'This address is retired. Do not send another deposit.':'Send once from your own KingPepe Native wallet.';
    $('received').textContent=value.amountAtomic===null?'Amount: Waiting for deposit':'Amount received: '+formatBalance(value.amountAtomic)+' KPEPE';
    $('confirmations').textContent=value.burnTxid?'Burn confirmations: '+(value.burnConfirmations??'Checking')+' / 12':'Deposit confirmations: '+value.depositConfirmations+' / 12';
    $('operation-help').textContent=value.exception?'A deposit needs operator review. Do not send again; the existing destination remains fixed.':value.state==='COMPLETED'?'Your exact KPEPE amount has arrived on Solana.':'Processing is automatic. You can close this page and resume with your public operation ID.';
    details({'Operation ID':tracking,'Native deposit address':value.depositAddress,'Native deposit TXID':value.depositTxid,'Native burn TXID':value.burnTxid,
      'Burn amount':value.burnAmountAtomic===null?null:formatBalance(value.burnAmountAtomic)+' KPEPE','Solana destination':value.destination,'Solana signature':value.solanaSignature,'Exact state':value.state});
    const funding=value.executionFunding;$('execution').hidden=funding?.policy!=='USER_FUNDED';
    if(funding?.policy==='USER_FUNDED'){
      const q=funding.quote,b=q?.budget;$('execution-payer').textContent=value.destination;
      const short=funding.status==='ADDITIONAL_SOL_REQUIRED';
      $('execution-cost').textContent=short?'Additional SOL required: '+formatBalance(funding.additionalSolRequiredLamports,9)+' SOL':q?formatBalance(q.amountLamports,9)+' SOL':funding.paymentSignatures.length?formatBalance(funding.fundedLamports,9)+' SOL funded':'Execution quote unavailable. Refresh to view the current cost.';
      $('execution-breakdown').textContent=b?'Account rent: '+formatBalance(b.accountRentLamports,9)+' SOL; execution fees: '+formatBalance(b.networkFeeLamports,9)+' SOL; retry allowance: '+formatBalance(b.retryAllowanceLamports,9)+' SOL; refund allowance: '+formatBalance(b.refundAllowanceLamports,9)+' SOL. Phantom payment network fee: approximately '+formatBalance(b.paymentFeeLamports,9)+' SOL, separately.':'';
      $('execution-status').textContent=short?'Additional SOL required':funding.status==='POST_BURN_EXECUTION_FUNDING_INCIDENT'?'Execution incident under review. Completion funds remain reserved.':funding.status==='PAID_VERIFIED'?'Execution funding: PAID / VERIFIED':funding.status==='REFUNDED'?'Execution funding refunded':funding.burnCommitted?'Execution funding reserved for completion':funding.paymentSignatures.length?'Execution funding received; verifying this operation':'Awaiting fee approval';
      $('pay').hidden=funding.burnCommitted||!q&&funding.paymentSignatures.length>0&&!short||funding.depositAddressIssued&&!short;
      $('pay').textContent=short?'Pay Remaining SOL & Continue':q?'Pay & Continue':'Refresh execution cost';
      $('execution-refund').textContent='Actual SOL cost: '+formatBalance(funding.actualCostLamports,9)+'; refunded: '+formatBalance(funding.refundedLamports,9)+'; remaining allowance: '+formatBalance(funding.remainderLamports,9)+'.';
    }
    progress(value);if(value.depositAddress===null)$('operation-state').textContent='Awaiting execution funding';
    if(funding?.status==='ADDITIONAL_SOL_REQUIRED')$('operation-state').textContent='Additional SOL required';
    else if(funding?.preBurnFundingVerified&&!funding.burnCommitted&&value.depositConfirmations>=12)$('operation-state').textContent='Ready to burn — FULLY FUNDED / VERIFIED';
    else if(funding?.status==='LEGACY_FUNDING_REVIEW_REQUIRED')$('operation-state').textContent='Existing operation funding policy under review';controls();
  }
  async function payExecution(){
    if(paying||!operation||account?.address!==operation.destination||service!=='ACTIVE'||networkConflict)return;
    paying=true;controls();const selected=wallet,selectedAccount=account,epoch=walletEpoch,opId=operation.operationId,previous=operation.executionFunding?.quote;
    try{
      const fresh=validateOperation(await bridgeRequest(`/operations/${opId}/execution-quote`,{}),opId);
      if(stopped||epoch!==walletEpoch||wallet!==selected||account!==selectedAccount)throw Error('WALLET_CHANGED');
      applyOperation(fresh);
      if(!fresh.executionFunding?.quote||fresh.executionFunding.burnCommitted||fresh.executionFunding.depositAddressIssued&&fresh.executionFunding.status==='PAID_VERIFIED'){notice('Execution funding already verified.');return;}
      await validateExecutionQuote(fresh.executionFunding.quote,{base58,operationId:opId,destination:selectedAccount.address});
      if(!previous||fresh.executionFunding.quote.amountLamports!==previous.amountLamports){notice('Review the current SOL cost, then choose Pay & Continue.');return;}
      notice('Review the operation-specific SOL payment in Phantom.');
      const signature=await signExecutionPayment({wallet:selected,account:selectedAccount,operation:fresh,base58});
      store(storageKey+'.payment',JSON.stringify({operationId:opId,signature}));
      notice(fresh.depositAddress?'Additional payment submitted. Waiting for finalized verification; do not repeat your Native deposit.':'Payment submitted. Waiting for finalized verification; do not send Native KPEPE yet.');
      const verified=await bridgeRequest(`/operations/${opId}/execution-payment`,{signature});
      if(!stopped&&tracking===opId)applyOperation(validateOperation(verified,opId));
    }catch(error){notice(rejectedByUser(error)?'Payment cancelled. This operation remains unchanged; burn requires verified funding.':'Payment was not verified yet. Keep this operation; its finalized payment will be recovered automatically. Reconnect the same wallet to retry the same payment safely.');}
    finally{paying=false;controls();}
  }
  function showSupply(){
    clearTimeout(supplyTimer);if(stopped)return;
    const displayState=accounting.current(),value=displayState.supply;
    $('supply-values').hidden=!value;
    if(!value){$('supply-amount').textContent='Unavailable';$('supply-help').textContent='Verified burn/mint accounting is temporarily unavailable.';return;}
    const display=supplyDisplay(value);$('supply-amount').textContent=display.bridged+' KPEPE';$('supply-progress').value=Number(display.basisPoints);
    $('supply-percentage').textContent=display.percentage;$('supply-remaining').textContent=display.remaining+' KPEPE';
    $('supply-help').textContent=displayState.state==='STALE'?'Verifying… Showing the last verified value, temporarily stale (up to 120 seconds old).':
      network.test?'TEST bridged KPEPE from completed REGTEST → DEVNET burns and mints.':'Completed Native burns represented on Solana.';
    const deadline=value.observedAt+(displayState.state==='READY'?30000:ACCOUNTING_DISPLAY_LIMIT_MS);
    supplyTimer=setTimeout(showSupply,Math.max(1,deadline-Date.now()+1));
  }
  function clearWallet(text){walletEpoch++;unlistenWallet?.();unlistenWallet=undefined;wallet=account=undefined;$('connect-label').textContent='Connect Solana Wallet';
    $('disconnect').hidden=true;$('solana-balances').hidden=true;$('wallet-state').textContent=text;
    if(!operation&&!pendingRequest)$('destination-address').textContent='Connect your wallet to receive KPEPE.';controls();}
  function walletsChanged(){
    choices=registry.get().filter(w=>w.chains?.some(c=>c.startsWith('solana:'))&&w.features?.['standard:connect']&&w.features?.['standard:events']);
    $('wallets').replaceChildren(...choices.map(w=>{const b=document.createElement('button');b.type='button';b.className='btn bridge-wallet-choice';b.textContent=String(w.name).slice(0,64);b.onclick=()=>void connect(w);return b;}));
    if(!choices.length){const p=document.createElement('p');p.textContent='No compatible wallet detected. Open this page in a Wallet Standard-compatible Solana wallet.';$('wallets').append(p);}
    if(mobileBrowser(navigator)&&!registeredPhantom(choices)){
      const open=document.createElement('button');open.type='button';open.className='btn bridge-wallet-choice';open.textContent='Open Phantom';open.onclick=openMobilePhantom;$('wallets').append(open);
      const help=document.createElement('p');help.textContent='Continue on this Bridge inside Phantom. If Phantom is not installed, install it from the official Phantom site, then return here.';$('wallets').append(help);
      const install=document.createElement('a');install.href='https://phantom.com/download';install.textContent='Get Phantom';install.rel='noopener noreferrer';$('wallets').append(install);
    }
    if(wallet&&!choices.includes(wallet))clearWallet('Wallet unavailable. The existing transfer destination is unchanged.');
    resumeMobileConnection();
  }
  function openMobilePhantom(){
    if(busy||stopped||mobileOpening||network?.walletChain!=='solana:mainnet'||networkConflict)return;
    if(tracking||pendingRequest){notice('An existing transfer is saved in this browser. Keep using its fixed destination and operation ID; no new transfer was opened.');return;}
    mobileOpening=true;$('wallet-state').textContent='Opening Phantom. Continue on the Bridge inside Phantom and approve the wallet connection.';
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
      $('sol-balance').textContent=formatBalance(value.solLamports,9);$('kpepe-balance').textContent=formatBalance(value.kpepeAtomic);$('balance-help').textContent='';lastWalletBalance=Date.now();}
    catch{if(!stopped&&epoch===walletEpoch){$('sol-balance').textContent=$('kpepe-balance').textContent='Unavailable';$('balance-help').textContent='Balances unavailable. Try refreshing shortly.';}}
    finally{balanceBusy=false;controls();if(!stopped&&epoch!==walletEpoch&&account)void loadBalances();}
  }
  async function issueAddress(){
    if(Date.now()-createWindow>=60000){createAttempts=0;createWindow=Date.now();}
    if(stopped||creating||tracking||!account||service!=='ACTIVE'||networkConflict||createAttempts>=3)return;
    if(pendingRequest&&pendingRequest.destination!==account.address){notice('The pending address request remains bound to the original wallet. Reconnect that wallet to resume.');return;}
    pendingRequest??={clientNonce:nonce(),destination:account.address,walletChain:network.walletChain};
    const input={...pendingRequest},key=storageKey;store(key+'.request',JSON.stringify(input));creating=true;createAttempts++;
    $('destination-address').textContent=input.destination;$('address-help').textContent='Preparing your transfer and execution cost…';
    try{const value=await bridgeRequest('/operations',input);validateOperation(value,value?.operationId);
      if(value.destination!==input.destination)throw new Error('DESTINATION_CHANGED');
      // Persist public recovery identity even if navigation happened in flight.
      store(key,value.operationId);store(key+'.request',null);pendingRequest=null;
      if(!stopped)applyOperation(value);
    }catch{if(!stopped)$('address-help').textContent='Deposit address could not be verified. Do not send funds. Keep this page open; the same bound request will retry automatically.';}
    finally{creating=false;controls();}
  }
  function connected(selected,selectedAccount){
    wallet=selected;account=selectedAccount;$('connect-label').textContent='Connected · '+shortAddress(account.address);$('disconnect').hidden=false;
    $('wallet-state').textContent='Connected';$('solana-balances').hidden=false;$('wallet-picker').hidden=true;$('connect').setAttribute('aria-expanded','false');
    if(!operation&&!pendingRequest)$('destination-address').textContent=account.address;
    void loadBalances();void issueAddress();controls();
  }
  async function connect(selected){
    if(busy||stopped)return;if(!bindings?.compatible(selected)){clearWallet('Wrong Solana network — '+(network?.solanaNetwork??'verified network')+' required.');return;}
    busy=true;clearWallet('Waiting for wallet connection…');controls();const epoch=walletEpoch;
    try{const result=await selected.features['standard:connect'].connect({silent:false});if(stopped||epoch!==walletEpoch||!registry.get().includes(selected))return;
      connected(selected,bindings.account(selected,result.accounts));
      unlistenWallet=selected.features['standard:events'].on('change',change=>{
        if(stopped||wallet!==selected||(!change.accounts&&!change.chains))return;walletEpoch++;
        try{if(!bindings.compatible(selected))throw new Error('WalletNetworkChanged');
          connected(selected,bindings.account(selected,change.accounts??selected.accounts));
        }catch{clearWallet('Wallet disconnected or on the wrong network. Your transfer destination is unchanged.');}
      });
    }catch(error){clearWallet(rejectedByUser(error)?'Wallet connection cancelled.':wrongWalletNetwork(error)?'Wrong Solana network.':'Wallet unavailable. Try reconnecting.');}
    finally{busy=false;controls();}
  }
  async function nativeBalance(){
    clearTimeout(nativeTimer);const address=$('native-address').value.trim().toLowerCase(),epoch=++nativeEpoch;
    if(!publicNative(address,network)){$('native-balance').textContent=address?'Enter a valid '+(network?.kingpepeNetwork??'Native')+' public address.':'Balance: — KPEPE';return;}
    $('native-balance').textContent='Balance: checking…';
    try{const value=await bridgeRequest('/balances/native/'+address);if(stopped||epoch!==nativeEpoch)return;
      if(value.address!==address||value.network!==network.kingpepeNetwork||value.decimals!==8||value.kind!=='CONFIRMED_UTXO')throw new Error('BALANCE');
      $('native-balance').textContent='Balance: '+formatBalance(value.amountAtomic)+' KPEPE';}
    catch{if(!stopped&&epoch===nativeEpoch)$('native-balance').textContent='Balance unavailable. Try refreshing shortly.';}
  }
  async function poll(){
    if(polling||stopped)return;polling=true;const accountingRequest=accounting.begin();let accountingAccepted=false;
    try{const status=await bridgeRequest('/status');if(stopped)return;const verified=assertPublicNetwork(status);
      if(status.architecture!=='ONE_WAY_AUTOMATIC_BURN_AND_MINT'||status.nativeDepositConfirmations!==12||status.nativeBurnConfirmations!==12||!publicSolana(status.mint)||status.depositAmountModel!=='EXACT_RECEIVED'||!status.minimumDepositAtomic||BigInt(status.minimumDepositAtomic)<=0n)throw new Error('NETWORK');
      $('minimum').textContent='Minimum: '+formatBalance(status.minimumDepositAtomic)+' KPEPE';
      if(network&&(network!==verified||mint!==status.mint))networkConflict=true;
      if(networkConflict)throw new Error('NETWORK_CHANGED');
      if(!network){network=verified;mint=status.mint;bindings=createWalletBindings(network.walletChain);storageKey=operationStorageKey(network,mint);
        const saved=readStored(storageKey);if(id(saved)){tracking=saved;$('operation').value=saved;$('operation-help').textContent='Resuming saved transfer…';}
        try{const pending=JSON.parse(readStored(storageKey+'.request'));if(pending&&id(pending.clientNonce)&&pending.clientNonce!=='0'.repeat(64)&&publicSolana(pending.destination)&&pending.walletChain===network.walletChain)pendingRequest={clientNonce:pending.clientNonce,destination:pending.destination,walletChain:pending.walletChain};}catch{}
        $('native-network').textContent=network.kingpepeNetwork;$('solana-network').textContent=network.solanaNetwork;$('mint').textContent=mint;
        $('network-warning').textContent=network.test?'TEST MODE — REGTEST → DEVNET. Do not send real KingPepe Mainnet funds.':'MAINNET · KingPepe Native → Solana KPEPE';
        $('supply-network').textContent=network.test?'TEST DATA':'MAINNET';
      }
      accounting.receive(accountingRequest,status,{kingpepeNetwork:network.kingpepeNetwork,solanaNetwork:network.solanaNetwork,walletChain:network.walletChain,mint});
      accountingAccepted=true;showSupply();service=status.state;$('service').textContent=service==='ACTIVE'?'Available':'Paused';
      if(tracking){const value=await bridgeRequest('/operations/'+tracking);if(stopped)return;if(value)applyOperation(validateOperation(value,tracking));else $('operation-help').textContent='Saved operation not found in this deployment. Keep its ID; do not send another deposit.';}
      else if(account)await issueAddress();
      if(account&&Date.now()-lastWalletBalance>=30000)void loadBalances();
    }catch(error){if(!stopped){service='UNAVAILABLE';$('service').textContent='Unavailable';
      if(!accountingAccepted)accounting.failure(accountingRequest,error?.accountingRefreshTransient===true&&!networkConflict);showSupply();
      if(networkConflict){$('deposit').hidden=true;$('network-warning').textContent='The Bridge network or Mint changed. Do not send funds. Reload to verify the active deployment.';}
      if(tracking)$('operation-help').textContent='Tracking temporarily unavailable. Keep your operation ID and do not send again.';}}
    finally{polling=false;controls();resumeMobileConnection();}
  }
  $('connect').onclick=()=>{
    if(busy||stopped)return;
    if(mobileBrowser(navigator)&&!choices.length&&network?.walletChain==='solana:mainnet'){openMobilePhantom();return;}
    $('wallet-picker').hidden=!$('wallet-picker').hidden;$('connect').setAttribute('aria-expanded',String(!$('wallet-picker').hidden));walletsChanged();
  };
  $('disconnect').onclick=async()=>{const selected=wallet;clearWallet('Disconnected. Your existing transfer destination is unchanged.');try{await selected?.features?.['standard:disconnect']?.disconnect();}catch{}};
  $('refresh-balances').onclick=()=>void loadBalances();$('native-refresh').onclick=()=>void nativeBalance();
  $('pay').onclick=()=>void payExecution();
  $('native-address').oninput=()=>{nativeEpoch++;clearTimeout(nativeTimer);nativeTimer=setTimeout(()=>void nativeBalance(),650);};
  $('copy-address').onclick=async()=>{if(!operation?.depositAddress||operation.retired||networkConflict||service!=='ACTIVE')return;try{await navigator.clipboard.writeText(operation.depositAddress);notice('Deposit address copied.');}catch{notice('Copy unavailable. Select the deposit address to copy it.');}};
  $('track-form').onsubmit=event=>{event.preventDefault();const requested=$('operation').value.trim();if(!id(requested)){notice('Enter a valid public operation ID.');return;}
    void (async()=>{try{const value=await bridgeRequest('/operations/'+requested);if(stopped)return;applyOperation(validateOperation(value,requested));notice('Transfer resumed.');}catch{notice('Operation unavailable. Check the public operation ID.');}})();};
  $('new').onclick=()=>{if(operation?.state!=='COMPLETED')return;store(storageKey,null);store(storageKey+'.request',null);operation=null;tracking='';pendingRequest=null;createAttempts=0;
    $('deposit').hidden=true;$('operation').value='';$('operation-help').textContent='Preparing a new transfer.';details({});progress(null);void issueAddress();controls();};
  const unregister=[registry.on('register',walletsChanged),registry.on('unregister',walletsChanged)];walletsChanged();progress(null);void poll();
  const interval=setInterval(()=>void poll(),10000);
  window.addEventListener('focus',walletPageReturned);window.addEventListener('pageshow',walletPageReturned);document.addEventListener?.('visibilitychange',walletPageReturned);
  return ()=>{stopped=true;walletEpoch++;nativeEpoch++;clearInterval(interval);clearTimeout(nativeTimer);clearTimeout(supplyTimer);
    window.removeEventListener('focus',walletPageReturned);window.removeEventListener('pageshow',walletPageReturned);document.removeEventListener?.('visibilitychange',walletPageReturned);unlistenWallet?.();unregister.forEach(off=>off());
    document.title=oldTitle;if(badge)badge.textContent=oldBadge;if(banner)banner.replaceChildren(...oldBanner);};
}
