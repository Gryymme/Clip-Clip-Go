// Pure presentation state, also exercised by headless fixtures.
export function connectionView(connection,connecting=false){const connected=connection?.ok===true&&connection?.code==='connected';return {connectHidden:connected&&!connecting,disconnectHidden:!connected||connecting,disabled:connecting,label:connecting?'Connecting…':'Connect'};}
export function detectionView(state) {
  if(!state.ok)return {message:state.message||'Open a normal HTTP(S) tab outside Incognito.',action:'Allow',disabled:true};
  const messages={
    'permission-needed':'Allow this site to discover media automatically.',
    inactive:'Checking website access...',
    navigating:'Waiting for the new page...',
    partial:'Some permitted frames could not be inspected. Try Rescan after the player loads.',
    active:'Missing a video? Click Rescan.'
  };
  return {message:messages[state.detection]||messages.inactive,action:'Allow',disabled:state.detection==='navigating'};
}
export function discoveryLabel(candidates=[],now=Date.now()){
  return candidates.some(c=>c.expiresAt>now&&(['direct','hls','dash'].includes(c.mediaType)&&httpUrl(c.mediaUrl)||c.mediaType==='page'&&extractorPage(c.extractorPageUrl)))?'Media Detected':'No Media Detected';
}
import {httpUrl,extractorPage} from './model.js';
