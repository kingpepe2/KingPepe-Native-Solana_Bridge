// Sequential layout, independent health domains. Market receives only its DOM host.
import {renderBridge} from './bridge.js?v=fullwidth-v1';
import {renderMarketDisplay} from './market-display.js?v=fullwidth-v1';
import {renderNetworkStory} from './network-story.js?v=network-story-v1';
export function renderBridgeMarket(view){
  const page=document.createElement('div');page.className='bridge-market-page';
  const banner=document.createElement('img');banner.className='bridge-market-banner';banner.src='/kingpepe-bridge-banner-4c6e94d9.jpg';banner.alt='KingPepe Native to Solana Bridge';banner.width=1280;banner.height=427;banner.decoding='async';
  const root=document.createElement('div');root.className='bridge-market-layout';
  const bridge=document.createElement('div'),display=document.createElement('div'),story=document.createElement('div');
  bridge.className='bridge-section';display.className='market-section';story.className='story-section';
  root.append(bridge,display,story);page.append(banner,root);view.replaceChildren(page);view.classList.add('market-wide');
  const stopBridge=renderBridge(bridge);let stopMarket=()=>{},stopStory=()=>{};
  try{stopMarket=renderMarketDisplay(display);}catch{display.textContent='Market data temporarily unavailable.';}
  try{stopStory=renderNetworkStory(story);}catch{story.textContent='Network information temporarily unavailable.';}
  return ()=>{stopMarket();stopStory();stopBridge();view.classList.remove('market-wide');};
}
