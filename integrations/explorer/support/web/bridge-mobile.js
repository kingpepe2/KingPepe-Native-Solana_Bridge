// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Navigation intent only. Wallet identity always comes from Wallet Standard.
const BRIDGE='https://kingpepe.net/bridge';
const MARKER='#phantom-connect';
export function mobileBrowser(navigator){
  return /Android|iPhone|iPad|iPod/iu.test(navigator?.userAgent??'')||
    navigator?.platform==='MacIntel'&&navigator?.maxTouchPoints>1;
}
export function phantomBrowseLink(){
  return 'https://phantom.app/ul/browse/'+encodeURIComponent(BRIDGE+MARKER)+'?ref='+encodeURIComponent('https://kingpepe.net');
}
export function phantomReturnIntent(location){
  // Neither query parameters nor fragments ever contain a destination or nonce.
  return location?.origin==='https://kingpepe.net'&&location?.pathname==='/bridge'&&location?.hash===MARKER;
}
export function registeredPhantom(wallets){
  return wallets.find(wallet=>wallet.name==='Phantom'&&wallet.chains?.includes('solana:mainnet')&&
    wallet.features?.['standard:connect']&&wallet.features?.['standard:events']);
}
