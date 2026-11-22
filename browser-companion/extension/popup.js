import {httpUrl, originPattern} from './model.js';
import {renderCandidates} from './popup-view.js';
import {detectionView} from './popup-state.js';
const $ = id => document.getElementById(id);
let selected = null, sending = false, tabUrl = null,refreshing=false,listSignature='',frameSignature='';
const call = message => chrome.runtime.sendMessage(message);
function result(text) { $('result').textContent = text || ''; }
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {
    const s = await call({type: 'state'}),view=detectionView(s);$('hint').textContent=view.message;
    $('start').textContent=view.action;$('start').disabled=view.disabled;
    $('tab-host').textContent=s.tab?.host||'Unsupported tab';tabUrl=s.tab?`${s.tab.origin}/`:null;
    if(s.connection)$('connection').textContent = s.connection.message;
    $('disconnect').hidden=!s.connection?.ok;
    const candidates = s.session?.candidates || [];
    if (!candidates.some(c => c.id === selected&&!c.drm)) selected = candidates.find(c=>!c.drm)?.id ?? null;
    const signature=JSON.stringify([candidates,selected]);if(signature!==listSignature){renderCandidates($('list'), candidates, selected, id => { selected = id; $('send').disabled = sending || !selected; });listSignature=signature;}
    $('send').disabled = sending || !selected;
    $('stop').hidden = !s.session;$('scan').hidden=!s.session;$('scan').disabled=s.detection==='navigating';
    const missing=s.session?.missingOrigins||[];$('missing').hidden=!missing.length;$('missing').textContent=missing.length?'Embedded frames need additional access. Allow only the origins you trust:':'';
    if(JSON.stringify(missing)!==frameSignature){frameSignature=JSON.stringify(missing);$('frame-grants').replaceChildren();for(const origin of missing){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`Allow ${new URL(origin).host}`;button.onclick=async()=>{if(await chrome.permissions.request({origins:[originPattern(origin)]})){await call({type:'scan'});await refresh();}};$('frame-grants').append(button);}}
    $('blob').hidden = !s.session?.blob;
    $('protected').hidden=!s.session?.protected;
  } catch { result('Could not read detection state. Reopen this popup or activate this tab again.'); }
  finally{refreshing=false;}
}
$('start').onclick = async () => { try { const pattern = originPattern(tabUrl); if (!pattern) throw Error(); if (!await chrome.permissions.request({origins: [pattern]})) { result('Website access was not granted.'); return; } const r = await call({type: 'start'}); result(r.message); await refresh(); } catch { result('Detection could not start on this page.'); } };
$('stop').onclick = async () => { await call({type: 'stop'}); await refresh(); };
$('connect').onclick = async () => { $('connect').disabled = true;$('connect').textContent='Connecting…';try { const r = await call({type: 'check'}); result(r.message); await refresh(); }catch{result('Connection failed. Finish setup in ClipClipGO, then retry Connect. Detection remains active.');} finally { $('connect').disabled = false;$('connect').textContent='Connect'; } };
$('disconnect').onclick=async()=>{await call({type:'disconnect'});await refresh();};
$('scan').onclick=async()=>{await call({type:'scan'});result('Rescanned permitted frames. Restart playback if the network request already happened.');await refresh();};
$('allow').onclick = async () => { const value = httpUrl($('origin').value.trim()); if (!value || new URL(value).pathname !== '/' || new URL(value).search || new URL(value).hash) { result('Enter an HTTP(S) origin, such as https://cdn.example.com.'); return; } if (await chrome.permissions.request({origins: [originPattern(value)]})) { await call({type: 'scan'}); result('Origin allowed. Restart playback if the request already happened.'); } else result('Origin access was not granted.'); };
$('candidates').onsubmit = async e => { e.preventDefault(); if (!selected || sending) return; sending = true; $('send').disabled = true; try { const r = await call({type: 'send', id: selected}); result(r.ok ? 'Sent. Review the source and confirm the download in ClipClipGO.' : r.message); } catch { result('Bridge disconnected. Check connection and try again.'); } finally { sending = false; await refresh(); } };
$('clear').onclick = async () => { await call({type: 'clear'}); selected = null; result('Extension-owned data cleared. Website access is unchanged.'); await refresh(); };
$('revoke').onclick = async () => { const {origins = []} = await chrome.permissions.getAll(); if (origins.length) await chrome.permissions.remove({origins}); await call({type: 'clear'}); result('Website access revoked and temporary data cleared.'); await refresh(); };
const [tab] = await chrome.tabs.query({active: true, currentWindow: true}); tabUrl = tab?.url;
await refresh(); const timer = setInterval(refresh, 2000); window.addEventListener('pagehide', () => clearInterval(timer));
