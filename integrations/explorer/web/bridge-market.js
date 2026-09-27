// Compose two independent health domains. Market receives only its own DOM host.
import {renderBridge} from './bridge.js?v=network-story-v1';
import {renderMarketDisplay} from './market-display.js?v=raydium-only-v1';
import {renderNetworkStory} from './network-story.js?v=network-story-v1';
export function renderBridgeMarket(view){
  const page=document.createElement('div');page.className='bridge-market-page';
  const banner=document.createElement('img');banner.className='bridge-market-banner';banner.src='/kingpepe-bridge-banner-4c6e94d9.jpg';banner.alt='KingPepe Native to Solana Bridge';banner.width=1280;banner.height=427;banner.decoding='async';
  const root=document.createElement('div');root.className='bridge-market-layout';
  const market=document.createElement('div'),bridge=document.createElement('aside');market.className='market-column';bridge.className='bridge-column';bridge.setAttribute('aria-label','KingPepe Bridge');bridge.tabIndex=0;
  root.append(market,bridge);page.append(banner,root);view.replaceChildren(page);view.classList.add('market-wide');
  const display=document.createElement('div'),story=document.createElement('div');market.append(display,story);
  const stopBridge=renderBridge(bridge);let stopMarket=()=>{},stopStory=()=>{};
  try{stopMarket=renderMarketDisplay(display);}catch{display.textContent='Market data temporarily unavailable.';}
  try{stopStory=renderNetworkStory(story);}catch{story.textContent='Network information temporarily unavailable.';}
  return ()=>{stopMarket();stopStory();stopBridge();view.classList.remove('market-wide');};
}
