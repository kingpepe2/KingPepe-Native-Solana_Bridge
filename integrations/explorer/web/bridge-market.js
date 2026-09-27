// Compose two independent health domains. Market receives only its own DOM host.
import {renderBridge} from './bridge.js?v=network-story-v1';
import {renderMarketDisplay} from './market-display.js?v=market-display-v1';
import {renderNetworkStory} from './network-story.js?v=network-story-v1';
export function renderBridgeMarket(view){
  const root=document.createElement('div');root.className='bridge-market-layout';
  const market=document.createElement('div'),bridge=document.createElement('aside');market.className='market-column';bridge.className='bridge-column';bridge.setAttribute('aria-label','KingPepe Bridge');bridge.tabIndex=0;
  root.append(market,bridge);view.replaceChildren(root);view.classList.add('market-wide');
  const display=document.createElement('div'),story=document.createElement('div');market.append(display,story);
  const stopBridge=renderBridge(bridge);let stopMarket=()=>{},stopStory=()=>{};
  try{stopMarket=renderMarketDisplay(display);}catch{display.textContent='Market data temporarily unavailable.';}
  try{stopStory=renderNetworkStory(story);}catch{story.textContent='Network information temporarily unavailable.';}
  return ()=>{stopMarket();stopStory();stopBridge();view.classList.remove('market-wide');};
}
