import {createCandidateAssets} from './preview.js';
document.getElementById('extension-version').textContent='Version '+chrome.runtime.getManifest().version;
import {httpUrl, originPattern} from './model.js';
import {renderCandidates} from './popup-view.js';
import {setupSettings} from './popup-settings.js';
import {detectionView,connectionView,discoveryLabel} from './popup-state.js';
let assets=createCandidateAssets();
const $ = id => document.getElementById(id);
let activeTabId=null;
let selected = null, sending = false, connecting=false, tabUrl = null,refreshing=false,listSignature='',frameSignature='';
const call = message => chrome.runtime.sendMessage(message);
function result(text) { $('result').textContent = text || '';if($('settings-dialog').open)$('settings-result').textContent=text||''; }
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {
    const s = await call({type: 'state'});activeTabId=s.tab?.id??null;const view=detectionView(s);$('hint').textContent=view.message;
    $('discovery-action').textContent=s.detection==='permission-needed'?'Allow':'Rescan';$('discovery-action').disabled=!s.ok||view.disabled;
    $('tab-host').textContent=s.tab?.host||'Unsupported tab';tabUrl=s.tab?`${s.tab.origin}/`:null;
    const controls=connectionView(s.connection,connecting),verified=controls.connectHidden;
    $('connect').hidden=false;$('connect').disabled=connecting;$('connect').textContent=connecting?'Connecting':verified?'Connected':'Connect';$('connect').dataset.connected=String(verified);
    $('connect').title=verified?'Disconnect from ClipClipGO':connecting?'Connecting to ClipClipGO':'Connect to ClipClipGO';$('connect').setAttribute('aria-label',$('connect').title);
    $('disconnect').hidden=controls.disconnectHidden;$('disconnect').disabled=controls.disabled;
    $('settings-connection-status').textContent=connecting?'Connecting':verified?'Connected to ClipClipGO':'Not connected';
    const candidates = s.session?.candidates || [];$('candidates').hidden=!candidates.length;$('discovery-status').textContent=discoveryLabel(candidates);
    if (!candidates.some(c => c.id === selected&&!c.drm)) selected = candidates.find(c=>!c.drm)?.id ?? null;
    const signature=JSON.stringify([candidates,selected]);if(signature!==listSignature&&!$('settings-dialog').open){assets.dispose();assets=createCandidateAssets();renderCandidates($('list'), candidates, selected, id => { selected = id; $('send').disabled = sending || !selected; },document,(host,c)=>assets.attach(host,c));listSignature=signature;}
    $('send').disabled = sending || !selected;
    const missing=s.session?.missingOrigins||[];$('missing').hidden=!missing.length;$('missing').textContent=missing.length?'Additional website access is available.':'';
    if(JSON.stringify(missing)!==frameSignature){frameSignature=JSON.stringify(missing);$('frame-grants').replaceChildren();for(const origin of missing){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`Allow ${new URL(origin).host}`;button.onclick=async()=>{if(await chrome.permissions.request({origins:[originPattern(origin)]})){await call({type:'scan'});listSignature='';await refresh();}};$('frame-grants').append(button);}}
    $('blob').hidden = !s.session?.blob;
    $('protected').hidden=!s.session?.protected;
    $('stream').hidden=!s.session?.stream;
  } catch { result('Could not read detection state. Reopen this popup or review website access in Settings.'); }
  finally{refreshing=false;}
}
const allowSite = async () => { try { const pattern = originPattern(tabUrl); if (!pattern) throw Error(); if (!await chrome.permissions.request({origins: [pattern]})) { result('Website access was not granted.'); return; } const r = await call({type: 'start'}); result(r.message); await refresh(); } catch { result('Detection could not start on this page.'); } };
$('connect').onclick = async () => { if(connecting)return;if($('connect').dataset.connected==='true'){connecting=true;$('connect').disabled=true;$('disconnect').disabled=true;try{await call({type:'disconnect'});}catch{result('Could not disconnect. Reopen the popup and check connection.');}finally{connecting=false;await refresh();}return;}connecting=true;$('connect').disabled = true;$('connect').textContent='Connecting';try { const r = await call({type: 'check'}); result(r.message); }catch{result('Connection failed. Finish setup in ClipClipGO, then retry Connect. Detection remains active.');} finally { connecting=false;await refresh(); } };
$('disconnect').onclick=()=> $('connect').onclick();
$('discovery-action').onclick=async()=>{if($('discovery-action').textContent==='Allow'){await allowSite();return;}await call({type:'scan'});$('rescan-note').textContent='Rescanned permitted frames. Restart playback if the network request already happened.';$('rescan-note').hidden=false;await refresh();};
$('allow').onclick = async () => { const value = httpUrl($('origin').value.trim()); if (!value || new URL(value).pathname !== '/' || new URL(value).search || new URL(value).hash) { result('Enter an HTTP(S) origin, such as https://cdn.example.com.'); return; } if (await chrome.permissions.request({origins: [originPattern(value)]})) { await call({type: 'scan'}); listSignature='';result('Origin allowed. Restart playback if the request already happened.');await refresh(); } else result('Origin access was not granted.'); };
$('candidates').onsubmit = async e => { e.preventDefault(); if (!selected || sending) return; sending = true; $('send').disabled = true; try { const r = await call({type: 'send', id: selected}); result(r.ok ? 'Sent. Review the source and confirm the download in ClipClipGO.' : r.message); } catch { result('Bridge disconnected. Check connection and try again.'); } finally { sending = false; await refresh(); } };
$('clear').onclick = async () => { assets.dispose(); await call({type: 'clear'}); selected = null; result('Extension-owned data cleared. Website access and theme are unchanged. Detection continues on permitted sites.'); await refresh(); };
$('revoke').onclick = async () => {
  $('revoke').disabled=true;assets.dispose();
  try{const {origins=[]}=await chrome.permissions.getAll();const removed=!origins.length||await chrome.permissions.remove({origins});await call({type:'sync'});result(removed?'Website access updated. Review remaining grants in Settings.':'Chrome did not remove this access. Review it in Chrome extension settings.');await settings.update();await refresh();}
  catch{result('Could not revoke access. Open Chrome extension settings to review it.');}
  finally{$('revoke').disabled=false;}
};
await globalThis.clipclipgoThemeReady;
const settings=setupSettings({onOpen:()=>{assets.dispose();listSignature='';},onClose:()=>{void refresh();},onChange:async()=>{assets.dispose();listSignature='';await call({type:'sync'});await refresh();}});
const [tab] = await chrome.tabs.query({active: true, currentWindow: true}); tabUrl = tab?.url;
const navigation=d=>{if(d.tabId===activeTabId){assets.dispose();listSignature='';}};
chrome.webNavigation.onBeforeNavigate.addListener(navigation);chrome.webNavigation.onHistoryStateUpdated.addListener(navigation);
await refresh(); const timer = setInterval(refresh, 2000); window.addEventListener('pagehide', () => {clearInterval(timer);assets.dispose();settings.dispose();chrome.webNavigation.onBeforeNavigate.removeListener(navigation);chrome.webNavigation.onHistoryStateUpdated.removeListener(navigation);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){assets.dispose();listSignature='';}else void refresh();});
