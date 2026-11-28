import {setupDisclosures} from './disclosures.js';
import {grantedOrigin} from './site-access.js';
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
const trace=(action,result,origins)=>{void call({type:'permissionTrace',entry:{action,result,origins}}).catch(()=>{});};
function result(text) { $('result').textContent = text || '';$('result').hidden=!text;if($('settings-dialog').open)$('settings-result').textContent=text||''; }
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {
    const s = await call({type: 'state'});$('diagnostics').title=(s.diagnostics||[]).join(' · ');activeTabId=s.tab?.id??null;const view=detectionView(s);$('hint').textContent=view.message;
    $('discovery-action').textContent=s.detection==='permission-needed'?'Allow':'Rescan';$('discovery-action').disabled=permissionPending||!s.ok||view.disabled;
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
    const missing=s.session?.missingOrigins||[];
    if(JSON.stringify(missing)!==frameSignature){frameSignature=JSON.stringify(missing);$('frame-grants').replaceChildren();for(const origin of missing){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`Allow ${new URL(origin).host}`;button.onclick=async()=>{const requested=chrome.permissions.request({origins:[originPattern(origin)]});trace('request','started',[originPattern(origin)]);const granted=await requested;trace('request',String(granted),[originPattern(origin)]);if(granted){await call({type:'scan'});listSignature='';await refresh();}};$('frame-grants').append(button);}}
    $('blob').hidden = !s.session?.blob;
    $('protected').hidden=!s.session?.protected;
    $('stream').hidden=!s.session?.stream;
  } catch { result('Could not read detection state. Reopen this popup or review website access in Settings.'); }
  finally{refreshing=false;}
}
let permissionPending=false;
const allowSite = async () => {
 if(permissionPending)return;result('');const pattern=originPattern(tabUrl);if(!pattern){result('Use a normal HTTP(S) tab.');return;}
 permissionPending=true;$('discovery-action').disabled=true;
 // Must remain before any await: Chrome requires this explicit click's user gesture.
 let requested,requestResolved=false;try{requested=chrome.permissions.request({origins:[pattern]});trace('request','started',[pattern]);}catch{requested=Promise.reject();}
 try{const granted=await requested;requestResolved=true;trace('request',String(granted),[pattern]);const {origins=[]}=await chrome.permissions.getAll();const covered=grantedOrigin(tabUrl,origins)&&await chrome.permissions.contains({origins:[pattern]});
  trace('request',covered?'covered':'not_covered',[pattern]);
  if(!covered){result(granted?'Website access is not available. Check Chrome site-access settings.':'Website access was not granted. You can try Allow again.');return;}
  const r=await call({type:'scan'});trace('request',r.ok?'resumed':'resume_failed',[pattern]);if(!r.ok){result(r.message);return;}
  $('rescan-note').textContent='Rescanned permitted frames. Restart playback if the network request already happened.';$('rescan-note').hidden=false;
 }catch{trace('request',requestResolved?'followup_failed':'threw',[pattern]);result(requestResolved?'Permission request completed, but checking access or restarting detection failed. Copy a diagnostic report.':'Website permission request failed. Check Chrome site-access settings and try Allow again.');}
 finally{permissionPending=false;await refresh();}
};
$('connect').onclick = async () => { if(connecting)return;result('');if($('connect').dataset.connected==='true'){connecting=true;$('connect').disabled=true;$('disconnect').disabled=true;try{await call({type:'disconnect'});}catch{result('Could not disconnect. Reopen the popup and check connection.');}finally{connecting=false;await refresh();}return;}connecting=true;$('connect').disabled = true;$('connect').textContent='Connecting';try { const r = await call({type: 'check'}); result(r.message); }catch{result('Connection failed. Finish setup in ClipClipGO, then retry Connect. Detection remains active.');} finally { connecting=false;await refresh(); } };
$('disconnect').onclick=()=> $('connect').onclick();
$('discovery-action').onclick=allowSite;
$('allow').onclick = async () => {result(''); const value = httpUrl($('origin').value.trim()); if (!value || new URL(value).pathname !== '/' || new URL(value).search || new URL(value).hash) { result('Enter an HTTP(S) origin, such as https://cdn.example.com.'); return; } const requested=chrome.permissions.request({origins:[originPattern(value)]});trace('request','started',[originPattern(value)]);const granted=await requested;trace('request',String(granted),[originPattern(value)]);if (granted) { await call({type: 'scan'}); listSignature='';result('Origin allowed. Restart playback if the request already happened.');await refresh(); } else result('Origin access was not granted.'); };
$('copy-diagnostics').onclick=async()=>{const output=$('diagnostic-report');try{const r=await call({type:'diagnosticReport'});if(!r?.ok||!r.report)throw Error();const text=JSON.stringify(r.report,null,2);output.value=text;output.hidden=false;try{await navigator.clipboard.writeText(text);$('diagnostic-status').textContent='Report copied. It contains site permission origins; review before sharing.';}catch{$('diagnostic-status').textContent='Select and copy the report below.';output.focus();output.select();}}catch{$('diagnostic-status').textContent='Could not read the worker report. Check the loaded version and reopen the popup.';}};
$('candidates').onsubmit = async e => { e.preventDefault(); if (!selected || sending) return;result(''); sending = true; $('send').disabled = true; try { const r = await call({type: 'send', id: selected}); result(r.ok ? 'Sent. Review the source and confirm the download in ClipClipGO.' : r.message); } catch { result('Bridge disconnected. Check connection and try again.'); } finally { sending = false; await refresh(); } };
$('clear').onclick = async () => { assets.dispose(); await call({type: 'clear'}); selected = null; result('Extension-owned data cleared. Website access and theme are unchanged. Detection continues on permitted sites.'); await refresh(); };
$('revoke').onclick = async () => {
  result('');$('revoke').disabled=true;assets.dispose();
  try{const {origins=[]}=await chrome.permissions.getAll();const removed=!origins.length||await chrome.permissions.remove({origins});await call({type:'sync'});result(removed?'Website access updated. Review remaining grants in Settings.':'Chrome did not remove this access. Review it in Chrome extension settings.');await settings.update();await refresh();}
  catch{result('Could not revoke access. Open Chrome extension settings to review it.');}
  finally{$('revoke').disabled=false;}
};
await globalThis.clipclipgoThemeReady;
const settings=setupSettings({onOpen:()=>{assets.dispose();listSignature='';},onClose:()=>{void refresh();},onChange:async()=>{assets.dispose();listSignature='';await call({type:'sync'});await refresh();}});
const [tab] = await chrome.tabs.query({active: true, currentWindow: true}); tabUrl = tab?.url;
const navigation=d=>{if(d.tabId===activeTabId){result('');$('rescan-note').textContent='';$('rescan-note').hidden=true;$('diagnostic-status').textContent='';$('diagnostic-report').value='';$('diagnostic-report').hidden=true;assets.dispose();listSignature='';}};
chrome.webNavigation.onBeforeNavigate.addListener(navigation);chrome.webNavigation.onHistoryStateUpdated.addListener(navigation);
const disposeDisclosures=setupDisclosures();
await refresh(); const timer = setInterval(refresh, 2000); window.addEventListener('pagehide', () => {clearInterval(timer);disposeDisclosures();assets.dispose();settings.dispose();chrome.webNavigation.onBeforeNavigate.removeListener(navigation);chrome.webNavigation.onHistoryStateUpdated.removeListener(navigation);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){assets.dispose();listSignature='';}else void refresh();});
