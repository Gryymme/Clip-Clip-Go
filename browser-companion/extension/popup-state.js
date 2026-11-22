// Pure presentation state, also exercised by headless fixtures.
export function detectionView(state) {
  if(!state.ok)return {message:state.message||'Open a normal HTTP(S) tab outside Incognito.',action:'Activate this tab',disabled:true};
  const messages={
    'permission-needed':'Website access is needed. Activate this tab and approve its origin.',
    inactive:'Detection is not active in this tab. Activate it before playback.',
    expired:'This tab’s activation expired. Activate it again before playback.',
    'origin-changed':'Detection paused because this tab changed origin. Activate the current site explicitly.',
    navigating:'Navigating within the activated site. Waiting for the new page…',
    partial:'Some permitted frames could not be inspected. Rescan after the player loads.',
    active:state.session?.candidates.length?`${state.session.candidates.length} ${state.session.candidates.length===1?'source':'sources'} detected in this tab.`:'Listening in this tab. Play the video, or rescan a player already loaded.'
  };
  return {message:messages[state.detection]||messages.inactive,action:state.session?'Restart this tab':'Activate this tab',disabled:state.detection==='navigating'};
}
