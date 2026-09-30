// The Bridge page: the Bridge, then the network story. No market information is shown
// here and none is requested; market data is on the main page.
import {renderBridge} from './bridge.js?v=reserve-ux-v4';
import {renderNetworkStory} from './network-story.js?v=network-story-v1';
export function renderBridgeMarket(view){
  const page=document.createElement('div');page.className='bridge-market-page';
  const banner=document.createElement('img');banner.className='bridge-market-banner';banner.src='/kingpepe-bridge-banner-4c6e94d9.jpg';banner.alt='KingPepe Native to Solana Bridge';banner.width=1280;banner.height=427;banner.decoding='async';
  const root=document.createElement('div');root.className='bridge-market-layout';
  const bridge=document.createElement('div'),story=document.createElement('div');
  bridge.className='bridge-section';story.className='story-section';
  root.append(bridge,story);page.append(banner,root);view.replaceChildren(page);view.classList.add('market-wide');
  const stopBridge=renderBridge(bridge);let stopStory=()=>{};
  try{stopStory=renderNetworkStory(story);}catch{story.textContent='Network information temporarily unavailable.';}
  return ()=>{stopStory();stopBridge();view.classList.remove('market-wide');};
}
