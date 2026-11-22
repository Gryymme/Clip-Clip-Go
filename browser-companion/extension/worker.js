import {TTL, httpUrl, mediaKind, originPattern, prune, addCandidate} from './model.js';
import {watchMedia} from './detect.js';
const HOST = 'com.clipclipgo.companion';
let mutations = Promise.resolve(), nativePort = null, heartbeat = null;
let connection = {ok: false, code: 'unknown', message: 'Connection not checked.'};
const pending = new Map(), contexts = new Map();
let activeTabs=new Set(),hydrated=false;
const hydration=chrome.storage.session.get('sessions').then(({sessions={}})=>{activeTabs=new Set(Object.keys(prune(sessions)).map(Number));hydrated=true;}).catch(()=>{hydrated=true;});
function state(fn) {
  const work = mutations.then(async () => { await hydration;const {sessions = {},notices={}} = await chrome.storage.session.get(['sessions','notices']);
    for(const[id,s]of Object.entries(sessions))if(s.expiresAt<=Date.now())notices[id]={reason:'expired',until:Date.now()+TTL};
    for(const[id,n]of Object.entries(notices))if(n.until<=Date.now())delete notices[id];
    prune(sessions); const result = await fn(sessions,notices);prune(sessions); await chrome.storage.session.set({sessions,notices});activeTabs=new Set(Object.keys(sessions).map(Number)); return result; });
  mutations = work.catch(() => {}); return work;
}
function activated(details,fn){if(details.tabId<0)return;if(!hydrated){void hydration.then(()=>activated(details,fn));return;}if(!activeTabs.has(details.tabId))return;void state((sessions,notices)=>{if(sessions[details.tabId])return fn(sessions,notices);});}
function disconnect(message) {
  nativePort = null; clearInterval(heartbeat); heartbeat = null;
  connection = {ok: false, code: 'disconnected', message};
  for (const item of pending.values()) { clearTimeout(item.timer); item.resolve(connection); } pending.clear();
}
async function native(type, candidate) {
  if (!nativePort) {
    try {
      const port = chrome.runtime.connectNative(HOST);nativePort=port;
      port.onMessage.addListener(reply => {
        if (reply?.v !== 1 || typeof reply.requestId !== 'string' || typeof reply.ok !== 'boolean') return;
        const item = pending.get(reply.requestId); if (!item) return;
        pending.delete(reply.requestId); clearTimeout(item.timer);
        const codes = new Set(['connected', 'accepted', 'busy', 'app_not_running', 'rejected', 'expired', 'disconnected']);
        const safe = {ok: reply.ok, code: codes.has(reply.code) ? reply.code : 'rejected', message: typeof reply.message === 'string' ? reply.message.slice(0, 300) : 'Bridge response rejected.'};
        if(['connected','accepted','busy'].includes(safe.code))connection={ok:true,code:'connected',message:'Connected to ClipClipGO.'};
        else if(['app_not_running','disconnected'].includes(safe.code))connection=safe;
        item.resolve(safe);
      });
      port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError;if(nativePort!==port)return; disconnect(error ? 'Bridge unavailable. Open ClipClipGO and check native-host setup.' : 'Bridge disconnected. Open ClipClipGO and reconnect.'); });
      // Connection is independent of detection; setup can handshake before any tab is activated.
      heartbeat = setInterval(() => { if(nativePort)void native('hello'); }, 10_000);
    } catch { disconnect('Native host unavailable. Complete the ClipClipGO setup.'); return connection; }
  }
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); connection = {ok: false, code: 'disconnected', message: 'No bridge response. Open ClipClipGO and reconnect.'}; resolve(connection); }, 7000);
    pending.set(requestId, {resolve, timer});
    try { nativePort.postMessage({v: 1, type, requestId, ...(candidate ? {candidate} : {})}); } catch { disconnect('Bridge disconnected. Reconnect and try again.'); }
  });
}
async function inject(tabId, s) {
  const frames = await chrome.webNavigation.getAllFrames({tabId}).catch(() => []) ?? [];
  s.missingOrigins=[];s.injectionErrors=0;s.documents={};
  for (const frame of frames) {
    const pattern = originPattern(frame.url);if(!pattern)continue;
    if (!await chrome.permissions.contains({origins: [pattern]})) {const origin=new URL(frame.url).origin;if(s.missingOrigins.length<16&&!s.missingOrigins.includes(origin))s.missingOrigins.push(origin);continue;}
    s.documents ??= {}; s.documents[frame.frameId]=frame.documentId || '';
    await chrome.scripting.executeScript({target: {tabId, frameIds: [frame.frameId]}, func: watchMedia, args: [s.navigationId, s.expiresAt,s.previousUrls??[]]}).catch(() => {s.injectionErrors++;});
  }
  delete s.previousUrls;
}
function dropContexts(tabId){for(const[id,c]of contexts)if(c.tabId===tabId)contexts.delete(id);}
function navigate(d,spa=false){activated(d,async(sessions,notices)=>{
  const s=sessions[d.tabId],url=httpUrl(d.url),previousUrls=spa?s.candidates.map(c=>c.mediaUrl):[];dropContexts(d.tabId);
  if(!url||new URL(url).origin!==new URL(s.pageUrl).origin){delete sessions[d.tabId];notices[d.tabId]={reason:'origin-changed',until:Date.now()+TTL};await chrome.tabs.sendMessage(d.tabId,{type:'stopClipClipGO'}).catch(()=>{});return;}
  Object.assign(s,{pageUrl:url,title:null,navigationId:crypto.randomUUID(),startedAt:Date.now(),candidates:[],requests:{},documents:{},frameEpochs:{},encryptedUrls:[],blob:false,protected:false,navigating:!spa,previousUrls});
  if(spa)await inject(d.tabId,s);
});}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const run = async () => {
    if (sender.id !== chrome.runtime.id) return {ok: false};
    if (['dom','encrypted'].includes(message?.type) && sender.tab) return state(sessions => {
      const s = sessions[sender.tab.id]; if (!s || s.navigationId !== message.navigationId || !httpUrl(sender.url)) return;
      if (!s.documents || s.documents[sender.frameId] !== (sender.documentId || '')) return;
      if(message.type==='encrypted'){s.protected=true;const url=httpUrl(message.mediaUrl);if(url){s.encryptedUrls??=[];if(!s.encryptedUrls.includes(url))s.encryptedUrls.push(url);s.encryptedUrls=s.encryptedUrls.slice(-16);}for(const c of s.candidates)if(c.frameId===sender.frameId&&c.mediaUrl===message.mediaUrl)c.drm=true;return;}
      if (String(message.mediaUrl).startsWith('blob:')) { s.blob = true; return; }
      // DOM metadata is untrusted, never request context or a command.
      addCandidate(s, {...message, drm:s.encryptedUrls?.includes(message.mediaUrl), dom: true, frameId: sender.frameId, frameUrl: sender.url, documentId: sender.documentId});
    });
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) return {ok: false};
    if (message.type === 'disconnect') {nativePort?.disconnect();disconnect('Desktop disconnected. Media detection is unchanged.');return {ok:true};}
    if (message.type === 'check') {
      // Each explicit Connect reloads the registered host; bounded retries allow setup to settle.
      nativePort?.disconnect();disconnect('Connecting to ClipClipGO…');
      let reply;for(let attempt=0;attempt<3;attempt++){reply=await native('hello');if(reply.ok)return reply;nativePort?.disconnect();disconnect(reply.message);if(attempt<2)await new Promise(r=>setTimeout(r,750*(attempt+1)));}return reply;
    }
    if (message.type === 'clear') { await state(async sessions=>{for(const tab of Object.keys(sessions)) await chrome.tabs.sendMessage(Number(tab),{type:'stopClipClipGO'}).catch(()=>{});for(const tab of Object.keys(sessions))delete sessions[tab];});contexts.clear(); nativePort?.disconnect(); disconnect('Data cleared.'); await chrome.storage.session.clear(); await chrome.storage.local.clear(); return {ok: true}; }
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || !httpUrl(tab.url) || tab.incognito) return {ok: false, message: 'Use a normal HTTP(S) tab outside Incognito.'};
    if (message.type === 'start') return state(async (sessions,notices) => {
      if (!await chrome.permissions.contains({origins: [originPattern(tab.url)]})) return {ok: false, message: 'Allow this website first.'};
      if (!sessions[tab.id] && Object.keys(sessions).length >= 8) return {ok: false, message: 'Stop detection in another tab first (8 active tabs maximum).'};
      const s = {navigationId: crypto.randomUUID(), startedAt: Date.now(), expiresAt: Date.now() + TTL, pageUrl: tab.url, title: tab.title ? Array.from(tab.title).slice(0,1024).join('') : null, candidates: [], blob: false};
      sessions[tab.id] = s;delete notices[tab.id];activeTabs.add(tab.id); await inject(tab.id, s); return {ok: true};
    });
    if (message.type === 'stop') return state(async sessions => { await chrome.tabs.sendMessage(tab.id,{type:'stopClipClipGO'}).catch(()=>{});delete sessions[tab.id]; return {ok: true}; });
    if (message.type === 'scan') return state(async sessions => { const s = sessions[tab.id]; if (s) await inject(tab.id, s); return {ok: true}; });
    if (message.type === 'send') {
      const c = await state(sessions => sessions[tab.id]?.candidates.find(c => c.id === message.id));
      if(c?.drm)return {ok:false,code:'rejected',message:'DRM-protected media is unsupported.'};
      return c ? native('candidate', c) : {ok: false, code: 'expired', message: 'Source expired or navigation changed. Detect again.'};
    }
    if (message.type === 'state') return state(async(sessions,notices)=>{
      const s=sessions[tab.id]??null,granted=await chrome.permissions.contains({origins:[originPattern(tab.url)]});
      let mode=!granted?'permission-needed':!s?(notices[tab.id]?.reason??'inactive'):s.navigating?'navigating':s.injectionErrors?'partial':'active';
      return {ok:true,session:s,connection,tab:{id:tab.id,host:new URL(tab.url).host,origin:new URL(tab.url).origin},detection:mode};
    });
    return {ok: false};
  };
  run().then(respond).catch(() => respond({ok: false, message: 'Could not complete this action. Reopen the popup and try again.'})); return true;
});
chrome.webRequest.onBeforeRequest.addListener(details => {
  activated(details,sessions => {
    const s = sessions[details.tabId]; if (!s || details.timeStamp < s.startedAt) return;
    if (contexts.size >= 512) contexts.delete(contexts.keys().next().value);
    const identity={tabId: details.tabId,frameId:details.frameId,documentId:details.documentId??'',frameEpoch: s.frameEpochs?.[details.frameId] || 0, navigationId: s.navigationId, at: details.timeStamp};
    contexts.set(details.requestId,identity);s.requests??={};s.requests[details.requestId]=identity;
    if(Object.keys(s.requests).length>128)delete s.requests[Object.keys(s.requests)[0]];
  });
}, {urls: ['http://*/*', 'https://*/*']});
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  // Discard every header except the selected request's Referer immediately. No cookies/auth stored.
  activated(details,()=>{
  const referer = httpUrl(details.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value);
  if (!referer) return;
  const ctx = contexts.get(details.requestId); if (ctx) ctx.referer = referer;
  });
}, {urls: ['http://*/*', 'https://*/*']}, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(details => {
  activated(details,sessions=>{
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  const contentType = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  if (!mediaKind(details.url, contentType)) return;
    const s = sessions[details.tabId]; if (!s) return;
    const memory=contexts.get(details.requestId);const ctx=memory??s.requests?.[details.requestId];contexts.delete(details.requestId);if(s.requests)delete s.requests[details.requestId];
    if (!ctx || s.navigating || ctx.tabId!==details.tabId ||ctx.frameId!==details.frameId|| ctx.navigationId !== s.navigationId || ctx.frameEpoch !== (s.frameEpochs?.[details.frameId] || 0) || Date.now() - ctx.at > TTL) return;
    if(s.documents?.[details.frameId]&&details.documentId&&s.documents[details.frameId]!==details.documentId)return;
    if (details.timeStamp < s.startedAt) return;
    const referer=memory&&Date.now()-memory.at<=30_000?memory.referer:null;
    addCandidate(s, {mediaUrl: details.url, drm:s.encryptedUrls?.includes(details.url),contentType, frameId: details.frameId, frameUrl: referer ?? details.initiator,
      documentId: details.documentId ?? '', navigationId: s.navigationId, referer, observedAt: details.timeStamp});
  });
}, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);
function completed(d){activated(d,s=>{contexts.delete(d.requestId);if(s[d.tabId].requests)delete s[d.tabId].requests[d.requestId];});}
chrome.webRequest.onCompleted.addListener(completed, {urls: ['http://*/*', 'https://*/*']});
chrome.webRequest.onErrorOccurred.addListener(completed, {urls: ['http://*/*', 'https://*/*']});
function clearTab(tabId) {void state((s,n)=>{delete s[tabId];delete n[tabId];dropContexts(tabId);});}
chrome.tabs.onRemoved.addListener(clearTab);
chrome.webNavigation.onBeforeNavigate.addListener(d => { if (d.frameId === 0) navigate(d); else activated(d,s => { if (s[d.tabId]) { s[d.tabId].candidates = s[d.tabId].candidates.filter(c => c.frameId !== d.frameId); if(s[d.tabId].documents) delete s[d.tabId].documents[d.frameId]; s[d.tabId].frameEpochs ??= {}; s[d.tabId].frameEpochs[d.frameId] = (s[d.tabId].frameEpochs[d.frameId] || 0) + 1; } }); });
chrome.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0)activated(d,(sessions,notices)=>{const s=sessions[d.tabId];if(!httpUrl(d.url)||new URL(d.url).origin!==new URL(s.pageUrl).origin){delete sessions[d.tabId];notices[d.tabId]={reason:'origin-changed',until:Date.now()+TTL};dropContexts(d.tabId);return;}s.navigating=false;s.pageUrl=d.url;s.documents={0:d.documentId??''};});});
chrome.webNavigation.onDOMContentLoaded.addListener(d => activated(d,async sessions=>{const s=sessions[d.tabId];if(s)await inject(d.tabId,s);}));
chrome.webNavigation.onHistoryStateUpdated.addListener(d => { if (d.frameId === 0) navigate(d,true); });
chrome.permissions.onRemoved.addListener(() => { void state(async sessions=>{for(const [tab,s] of Object.entries(sessions)){
  if(!await chrome.permissions.contains({origins:[originPattern(s.pageUrl)]})){
    await chrome.tabs.sendMessage(Number(tab),{type:'stopClipClipGO'}).catch(()=>{});delete sessions[tab];dropContexts(Number(tab));continue;
  }
  // Revoking one frame/CDN permission must not stop other authorized tabs.
  const allowed=[];for(const c of s.candidates){const pattern=originPattern(c.mediaUrl);if(pattern&&await chrome.permissions.contains({origins:[pattern]}))allowed.push(c);}s.candidates=allowed;
  s.requests={};dropContexts(Number(tab));await chrome.tabs.sendMessage(Number(tab),{type:'stopClipClipGO'}).catch(()=>{});
  await inject(Number(tab),s);
}}); });
chrome.alarms.create('expire', {periodInMinutes: 1});
chrome.alarms.onAlarm.addListener(() => { void state(() => {}); const now = Date.now(); for (const [id, c] of contexts) if (now - c.at > 30_000) contexts.delete(id); });
// storage.session is memory-backed and inaccessible to content scripts by default.
void chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
