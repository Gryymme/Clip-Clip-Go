import {report,journal,errorCode,count,reject} from './diagnostics.js';
import {grantedOrigin} from './site-access.js';
import {wireCandidate} from './preview.js';
import {TTL, httpUrl, mediaKind, originPattern, prune, addCandidate, addPageCandidate, extractorPage, updateCandidateThumbnail} from './model.js';
import {watchMedia} from './detect.js';
const HOST = 'com.clipclipgo.companion';
let mutations = Promise.resolve(), nativePort = null, heartbeat = null;
let verifiedAt=0;
let connection = {ok: false, code: 'unknown', message: 'Connection not checked.'};
const pending = new Map(), contexts = new Map();

async function permitted(url){const pattern=originPattern(url);if(!pattern)return false;const {origins=[]}=await chrome.permissions.getAll();return grantedOrigin(url,origins)&&await chrome.permissions.contains({origins:[pattern]});}
function state(fn) {
  const work = mutations.then(async () => { const {sessions = {},notices={}} = await chrome.storage.session.get(['sessions','notices']);
    for(const[id,n]of Object.entries(notices))if(n.until<=Date.now())delete notices[id];
    for(const s of Object.values(sessions))if(s.candidates?.some(c=>c.expiresAt<=Date.now()))s.expiredCandidate=true;
    prune(sessions); const result = await fn(sessions,notices);prune(sessions); await chrome.storage.session.set({sessions,notices}); return result; });
  mutations = work.catch(() => {}); return work;
}
function authorized(details,fn){if(details.tabId<0||details.initiator?.startsWith('chrome-extension://'))return;void state(async(sessions,notices)=>{
 const s=sessions[details.tabId];if(!s||!await permitted(s.pageUrl))return;
 if(details.requestId!==undefined){if(httpUrl(details.initiator)&&!await permitted(details.initiator)){await noteAssetOrigin(s,details.initiator);return;}if(details.url&&!await permitted(details.url)){await noteAssetOrigin(s,details.url);return;}}
 return fn(sessions,notices);
});}
function newSession(url,title=null){return {navigationId:crypto.randomUUID(),startedAt:Date.now(),pageUrl:url,title:typeof title==='string'?Array.from(title).slice(0,1024).join(''):null,candidates:[],requests:{},documents:{},frameEpochs:{},frameTokens:{},blob:false};}
async function stopTab(tabId){await chrome.tabs.sendMessage(Number(tabId),{type:'stopClipClipGO'}).catch(()=>{});dropContexts(Number(tabId));}
// Chrome grants are authoritative. A CDN grant alone never enables a page.
async function reconcile(sessions,{repair=false,invalidate=false}={}){
  const tabs=await chrome.tabs.query({});const open=new Set();
  for(const tab of tabs){if(!Number.isInteger(tab.id))continue;open.add(String(tab.id));const url=httpUrl(tab.url);
    if(tab.incognito||!url||!await permitted(url)){if(sessions[tab.id]){await stopTab(tab.id);delete sessions[tab.id];}continue;}
    let s=sessions[tab.id];if(!s||s.pageUrl!==url){await stopTab(tab.id);s=sessions[tab.id]=newSession(url,tab.title);await inject(tab.id,s);}
    else if(repair||!s.observers||!Object.keys(s.observers).length||Object.values(s.observers).some(at=>Date.now()-at>45_000)){await stopTab(tab.id);const allowed=[];for(const c of s.candidates)if(await permitted(c.frameUrl)&&(c.domObserved===true||await permitted(c.extractorPageUrl||c.mediaUrl))) {if(c.posterUrl&&!await permitted(c.posterUrl))delete c.posterUrl;allowed.push(c);}s.candidates=allowed;if(invalidate)s.requests={};for(const key of ['encryptedUrls','encryptedPages'])if(s[key]){const values=[];for(const url of s[key])if(await permitted(url))values.push(url);s[key]=values;}await inject(tab.id,s);}
  }
  for(const id of Object.keys(sessions))if(!open.has(id)){await stopTab(id);delete sessions[id];}
}
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
        if(['connected','accepted','busy'].includes(safe.code)){verifiedAt=Date.now();connection={ok:true,code:'connected',message:'Connected to ClipClipGO.'};}
        else if(['app_not_running','disconnected'].includes(safe.code))connection=safe;
        item.resolve(safe);
      });
      port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError;if(nativePort!==port)return; disconnect(error ? 'Bridge unavailable. Open ClipClipGO and check native-host setup.' : 'Bridge disconnected. Open ClipClipGO and reconnect.'); });
      // Connection is independent of detection; setup can handshake before any website is permitted.
      heartbeat = setInterval(() => { if(nativePort)void native('hello'); }, 10_000);
    } catch { disconnect('Native host unavailable. Complete the ClipClipGO setup.'); return connection; }
  }
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); connection = {ok: false, code: 'disconnected', message: 'No bridge response. Open ClipClipGO and reconnect.'}; resolve(connection); }, 7000);
    pending.set(requestId, {resolve, timer});
    try { nativePort.postMessage({v: 1, type, requestId, ...(candidate ? {candidate:wireCandidate(candidate)} : {})}); } catch { disconnect('Bridge disconnected. Reconnect and try again.'); }
  });
}
async function inject(tabId, s) {
  if(!await permitted(s.pageUrl)){await stopTab(tabId);s.documents={};return;}
  s.observers={};s.frameDiagnostics=[];s.scans={};s.scanHeartbeats={};
  const allFrames = await chrome.webNavigation.getAllFrames({tabId}).catch(() => {s.frameDiagnostics.push({error:'frame_enumeration_failed'});return []}) ?? [];s.enumeratedFrames=allFrames.length;const frames=allFrames.slice(0,32);
  s.missingOrigins=[];s.injectionErrors=0;s.documents={};
  for (const frame of frames) {
    const pattern = originPattern(frame.url);if(!pattern)continue;const info={frameId:frame.frameId,documentId:frame.documentId||'',origin:pattern,access:false,attempted:false,completed:false};s.frameDiagnostics.push(info);
    if (!await permitted(frame.url)) {const origin=new URL(frame.url).origin;if(s.missingOrigins.length<16&&!s.missingOrigins.includes(origin))s.missingOrigins.push(origin);continue;}
    info.access=true;info.attempted=true;
    s.documents ??= {}; s.documents[frame.frameId]=frame.documentId || '';
    await chrome.scripting.executeScript({target: {tabId, frameIds: [frame.frameId]}, func: watchMedia, args: [s.frameTokens?.[frame.frameId]??s.navigationId, null,s.previousUrls??[],s.recoverSince??0]}).then(()=>{info.completed=true;s.observers[frame.frameId]=Date.now();}).catch(error => {s.injectionErrors++;info.error=errorCode(error);});
  }
  delete s.previousUrls;
}
async function noteAssetOrigin(s,value){const valid=httpUrl(value);if(!valid)return;const pattern=originPattern(valid);if(!await permitted(valid)){s.missingOrigins??=[];const origin=new URL(valid).origin;if(s.missingOrigins.length<16&&!s.missingOrigins.includes(origin))s.missingOrigins.push(origin);}}
function dropContexts(tabId){for(const[id,c]of contexts)if(c.tabId===tabId)contexts.delete(id);}
function navigate(d,spa=false){void state(async sessions=>{
  const old=sessions[d.tabId],url=httpUrl(d.url),previousUrls=spa?(old?.candidates??[]).map(c=>c.mediaUrl):[];await stopTab(d.tabId);
  const tab=await chrome.tabs.get(d.tabId).catch(()=>null);
  if(!tab||tab.incognito||!url||!await permitted(url)){delete sessions[d.tabId];return;}
  const s=sessions[d.tabId]={...newSession(url),recoverSince:spa?Date.now():0,navigating:!spa,previousUrls};
  if(spa)await inject(d.tabId,s);
});}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const run = async () => {
    if (sender.id !== chrome.runtime.id) return {ok: false};
    if (['dom','encrypted','page','playback','observationAccess','thumbnail'].includes(message?.type) && sender.tab) return state(async sessions => {
      const s = sessions[sender.tab.id]; if (!s || (s.frameTokens?.[sender.frameId]??s.navigationId) !== message.navigationId || !httpUrl(sender.url)) {if(s){s.rejectedCandidate=true;reject(s,'stale_sender');}return;}
      if (!s.documents || s.documents[sender.frameId] !== (sender.documentId || '')) {s.rejectedCandidate=true;reject(s,'document_mismatch');return;}
      if(!await permitted(s.pageUrl)||!await permitted(sender.url)){reject(s,'page_or_frame_access');return {ok:false};}
      if(message.type==='observationAccess'){s.observerPings=count((s.observerPings||0)+1);s.scanHeartbeats??={};s.scanHeartbeats[sender.frameId]=Date.now();s.scans??={};s.scans[sender.frameId]={reports:count(message.scan?.reports),mediaElements:count(message.scan?.mediaElements),resources:count(message.scan?.resources)};s.observers??={};s.observers[sender.frameId]=Date.now();return {ok:true};}
      if(message.type==='thumbnail'){await noteAssetOrigin(s,message.posterUrl);const posterUrl=await permitted(message.posterUrl)?message.posterUrl:null;return {ok:updateCandidateThumbnail(s,{mediaUrl:message.mediaUrl,posterUrl,snapshotUrl:message.snapshotUrl,navigationId:s.navigationId,frameId:sender.frameId})};}
      if(message.type==='playback'){if(message.kind==='stream')s.stream=true;return;}
      if(message.type==='page'){s.pageMessages=count((s.pageMessages||0)+1);const duplicate=s.candidates.some(c=>c.extractorPageUrl===message.extractorPageUrl&&c.frameId===sender.frameId);await noteAssetOrigin(s,message.posterUrl);const posterUrl=await permitted(message.posterUrl)?message.posterUrl:null;const created=addPageCandidate(s,{...message,posterUrl,navigationId:s.navigationId,frameId:sender.frameId,frameUrl:sender.url,documentId:sender.documentId});if(created)s.createdCandidates=count((s.createdCandidates||0)+1);else if(duplicate)s.duplicateCandidates=count((s.duplicateCandidates||0)+1);else {s.rejectedCandidates=count((s.rejectedCandidates||0)+1);reject(s,'unsupported_page');}return;}
      if(message.type==='encrypted'){s.protected=true;const selected=extractorPage(message.extractorPageUrl);if(selected&&new URL(selected).origin===new URL(sender.url).origin){s.encryptedPages??=[];if(!s.encryptedPages.includes(selected))s.encryptedPages.push(selected);s.encryptedPages=s.encryptedPages.slice(-16);}const url=httpUrl(message.mediaUrl);if(url&&await permitted(url)){s.encryptedUrls??=[];if(!s.encryptedUrls.includes(url))s.encryptedUrls.push(url);s.encryptedUrls=s.encryptedUrls.slice(-16);}for(const c of s.candidates)if(c.frameId===sender.frameId&&(c.mediaUrl===message.mediaUrl||c.mediaType==='page'&&c.extractorPageUrl===selected))c.drm=true;return;}
      s.domMessages=count((s.domMessages||0)+1);
      if (String(message.mediaUrl).startsWith('blob:')) {s.blobMessages=count((s.blobMessages||0)+1); s.blob = true; return; }
      // Reading a URL already exposed by an authorized document is not a CDN fetch or webRequest observation.
      // Page/frame checks above still apply; network/thumbnail requests retain their own host checks.
      await noteAssetOrigin(s,message.mediaUrl);
      await noteAssetOrigin(s,message.posterUrl);
      const posterUrl=await permitted(message.posterUrl)?message.posterUrl:null;
      // DOM metadata is untrusted, never request context or a command.
      const duplicate=s.candidates.some(c=>c.mediaUrl===message.mediaUrl&&c.frameId===sender.frameId);const created=addCandidate(s, {...message,posterUrl,navigationId:s.navigationId, drm:s.encryptedUrls?.includes(message.mediaUrl), dom: true, frameId: sender.frameId, frameUrl: sender.url, documentId: sender.documentId});if(created)s.createdCandidates=count((s.createdCandidates||0)+1);else if(duplicate)s.duplicateCandidates=count((s.duplicateCandidates||0)+1);else {s.rejectedCandidates=count((s.rejectedCandidates||0)+1);reject(s,'not_media_or_segment');}
    });
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) return {ok: false};
    if(message.type==='permissionTrace'){await state(async()=>{const {permissionTrace=[]}=await chrome.storage.session.get('permissionTrace');await chrome.storage.session.set({permissionTrace:journal(permissionTrace,message.entry)});});return {ok:true};}
    if(message.type==='diagnosticReport')return state(async sessions=>{
      let tab,origins=[],contains=false,permissionRead='ok',containsRead='ok',tabRead='ok';
      try{[tab]=await chrome.tabs.query({active:true,currentWindow:true});}catch{tabRead='failed';}
      try{({origins=[]}=await chrome.permissions.getAll());}catch{permissionRead='failed';}
      try{contains=!!(tab&&originPattern(tab.url)&&await chrome.permissions.contains({origins:[originPattern(tab.url)]}));}catch{containsRead='failed';}
      const {permissionTrace=[]}=await chrome.storage.session.get('permissionTrace'),s=sessions[tab?.id];
      return {ok:true,report:report({version:chrome.runtime.getManifest().version,tab,session:s,grants:origins,contains,permissionRead,containsRead,tabRead,manifest:chrome.runtime.getManifest(),operations:permissionTrace,frames:s?.frameDiagnostics||[]})};
    });
    if (message.type === 'disconnect') {nativePort?.disconnect();disconnect('Desktop disconnected. Media detection is unchanged.');return {ok:true};}
    if (message.type === 'check') {
      // Each explicit Connect reloads the registered host; bounded retries allow setup to settle.
      nativePort?.disconnect();disconnect('Connecting to ClipClipGO…');
      let reply;for(let attempt=0;attempt<3;attempt++){reply=await native('hello');if(reply.ok)return reply;nativePort?.disconnect();disconnect(reply.message);if(attempt<2)await new Promise(r=>setTimeout(r,750*(attempt+1)));}return reply;
    }
    if (message.type === 'clear') {
      await state(async(sessions,notices)=>{for(const id of Object.keys(sessions)){await stopTab(id);delete sessions[id];}for(const id of Object.keys(notices))delete notices[id];await reconcile(sessions);});
      contexts.clear();await chrome.storage.session.set({permissionTrace:[]});nativePort?.disconnect();disconnect('Temporary data cleared.');return {ok:true};
    }
    if(message.type==='sync'){await state(s=>reconcile(s,{repair:true}));return {ok:true};}
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || !httpUrl(tab.url) || tab.incognito) return {ok: false, message: 'Use a normal HTTP(S) tab outside Incognito.'};
    if (message.type === 'start') return state(async (sessions,notices) => {
      if (!await permitted(tab.url)) return {ok: false, message: 'Allow this website first.'};
      const s = sessions[tab.id]??newSession(tab.url,tab.title);
      sessions[tab.id] = s;delete notices[tab.id];await inject(tab.id, s); return {ok: true};
    });
    if (message.type === 'scan') return state(async sessions => { if(!await permitted(tab.url))return {ok:false,message:'Allow this website first.'};const s=sessions[tab.id]??(sessions[tab.id]=newSession(tab.url,tab.title));await inject(tab.id,s);return {ok:true}; });
    if (message.type === 'send') {
      const c = await state(async sessions => await permitted(tab.url)?sessions[tab.id]?.candidates.find(c => c.id === message.id):null);
      if(c?.drm)return {ok:false,code:'rejected',message:'DRM-protected media is unsupported.'};
      if(c?.mediaType==='page'){const reply=await native('candidate',c);return ['rejected','disconnected'].includes(reply.code)?{...reply,message:'Page handoff rejected. Update ClipClipGO and repair its bridge; direct media remains supported.'}:reply;}
      return c ? native('candidate', c) : {ok: false, code: 'expired', message: 'Source expired or navigation changed. Detect again.'};
    }
    if (message.type === 'state') return state(async(sessions,notices)=>{
      const grantedNow=await permitted(tab.url);
      if(!grantedNow&&sessions[tab.id]){await stopTab(tab.id);delete sessions[tab.id];}
      if(grantedNow&&!sessions[tab.id]){sessions[tab.id]=newSession(tab.url,tab.title);await inject(tab.id,sessions[tab.id]);}
      const s=sessions[tab.id]??null,granted=grantedNow;
      let mode=!granted?'permission-needed':!s?(notices[tab.id]?.reason??'inactive'):s.navigating?'navigating':s.injectionErrors?'partial':'active';
      const diagnostics=[!granted?'missing_page_access':null,s?.missingOrigins?.length?'missing_frame_or_cdn_access':null,s&&(!Object.keys(s.observers||{}).length||s.injectionErrors)?'observer_not_running':null,s?.observedRequests&&!s.candidates.length?'requests_without_candidate':null,s?.rejectedMedia?'candidate_not_media':null,s?.expiredCandidate?'candidate_expired':null,s?.rejectedCandidate?'candidate_rejected':null].filter(Boolean);
      if(s){s.popupReads=count((s.popupReads||0)+1);s.popupCandidates=s.candidates.length;}
      return {ok:true,session:s,diagnostics,connection:nativePort&&Date.now()-verifiedAt<=25000?connection:{ok:false,code:'disconnected',message:'Not Connected'},tab:{id:tab.id,host:new URL(tab.url).host,origin:new URL(tab.url).origin},detection:mode};
    });
    return {ok: false};
  };
  run().then(respond).catch(() => respond({ok: false, message: 'Could not complete this action. Reopen the popup and try again.'})); return true;
});
chrome.webRequest.onBeforeRequest.addListener(details => {
  authorized(details,sessions => {
    const s = sessions[details.tabId]; if (!s || details.timeStamp < s.startedAt) return;s.observedRequests=Math.min(999,(s.observedRequests||0)+1);
    if (contexts.size >= 512) contexts.delete(contexts.keys().next().value);
    const identity={tabId: details.tabId,frameId:details.frameId,documentId:details.documentId??'',frameEpoch: s.frameEpochs?.[details.frameId] || 0, navigationId: s.navigationId, at: details.timeStamp};
    contexts.set(details.requestId,identity);s.requests??={};s.requests[details.requestId]=identity;
    if(Object.keys(s.requests).length>128)delete s.requests[Object.keys(s.requests)[0]];
  });
}, {urls: ['http://*/*', 'https://*/*']});
chrome.webRequest.onBeforeSendHeaders.addListener(details => {
  // Discard every header except the selected request's Referer immediately. No cookies/auth stored.
  authorized(details,()=>{
  const referer = httpUrl(details.requestHeaders?.find(h => h.name.toLowerCase() === 'referer')?.value);
  if (!referer) return;
  const ctx = contexts.get(details.requestId); if (ctx) ctx.referer = referer;
  });
}, {urls: ['http://*/*', 'https://*/*']}, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(details => {
  authorized(details,sessions=>{
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  const contentType = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '';
  if (!mediaKind(details.url, contentType)) {const s=sessions[details.tabId];s.networkFiltered=count((s.networkFiltered||0)+1);s.rejectedMedia=Math.min(999,(s.rejectedMedia||0)+1);return;}
    const s = sessions[details.tabId]; if (!s) return;
    const memory=contexts.get(details.requestId);const ctx=memory??s.requests?.[details.requestId];contexts.delete(details.requestId);if(s.requests)delete s.requests[details.requestId];
    if (!ctx || s.navigating || ctx.tabId!==details.tabId ||ctx.frameId!==details.frameId|| ctx.navigationId !== s.navigationId || ctx.frameEpoch !== (s.frameEpochs?.[details.frameId] || 0) || Date.now() - ctx.at > TTL) {s.staleNetwork=count((s.staleNetwork||0)+1);reject(s,'network_identity');return;}
    if(s.documents?.[details.frameId]&&details.documentId&&s.documents[details.frameId]!==details.documentId)return;
    if (details.timeStamp < s.startedAt) return;
    const referer=memory&&Date.now()-memory.at<=30_000?memory.referer:null;
    s.networkMedia=count((s.networkMedia||0)+1);const duplicate=s.candidates.some(c=>c.mediaUrl===details.url&&c.frameId===details.frameId);const created=addCandidate(s, {mediaUrl: details.url, drm:s.encryptedUrls?.includes(details.url),contentType, frameId: details.frameId, frameUrl: referer ?? details.initiator,
      documentId: details.documentId ?? '', navigationId: s.navigationId, referer, observedAt: details.timeStamp});if(created)s.createdCandidates=count((s.createdCandidates||0)+1);else if(duplicate)s.duplicateCandidates=count((s.duplicateCandidates||0)+1);else s.rejectedCandidates=count((s.rejectedCandidates||0)+1);
  });
}, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);
function completed(d){authorized(d,s=>{contexts.delete(d.requestId);if(s[d.tabId].requests)delete s[d.tabId].requests[d.requestId];});}
chrome.webRequest.onCompleted.addListener(completed, {urls: ['http://*/*', 'https://*/*']});
chrome.webRequest.onErrorOccurred.addListener(completed, {urls: ['http://*/*', 'https://*/*']});
function clearTab(tabId) {void state((s,n)=>{delete s[tabId];delete n[tabId];dropContexts(tabId);});}
chrome.tabs.onRemoved.addListener(clearTab);
chrome.webNavigation.onBeforeNavigate.addListener(d => { if (d.frameId === 0) navigate(d); else authorized(d,s => { if (s[d.tabId]) { s[d.tabId].candidates = s[d.tabId].candidates.filter(c => c.frameId !== d.frameId); if(s[d.tabId].documents) delete s[d.tabId].documents[d.frameId]; s[d.tabId].frameEpochs ??= {}; s[d.tabId].frameEpochs[d.frameId] = (s[d.tabId].frameEpochs[d.frameId] || 0) + 1; } }); });
chrome.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0)void state(async sessions=>{
 const url=httpUrl(d.url),tab=await chrome.tabs.get(d.tabId).catch(()=>null);
 if(!tab||tab.incognito||!url||!await permitted(url)){await stopTab(d.tabId);delete sessions[d.tabId];return;}
 let s=sessions[d.tabId];if(!s||s.pageUrl!==url){await stopTab(d.tabId);s=sessions[d.tabId]=newSession(url);}
 s.navigating=false;s.pageUrl=url;s.documents={0:d.documentId??''};
});});
chrome.webNavigation.onDOMContentLoaded.addListener(d => authorized(d,async sessions=>{const s=sessions[d.tabId];if(s)await inject(d.tabId,s);}));
chrome.webNavigation.onHistoryStateUpdated.addListener(d => { if (d.frameId === 0) navigate(d,true); else authorized(d,async sessions=>{
 const s=sessions[d.tabId];if(s.documents?.[d.frameId]===undefined)return;s.frameTokens??={};s.frameTokens[d.frameId]=crypto.randomUUID();s.previousUrls=s.candidates.filter(c=>c.frameId===d.frameId).map(c=>c.mediaUrl);s.candidates=s.candidates.filter(c=>c.frameId!==d.frameId);s.frameEpochs??={};s.frameEpochs[d.frameId]=(s.frameEpochs[d.frameId]||0)+1;s.recoverSince=Date.now();await inject(d.tabId,s);
}); });
// Permission events also cover browser-controls changes; never request access here.
const permissionsChanged=event=>{void state(async s=>{const {permissionTrace=[]}=await chrome.storage.session.get('permissionTrace');await chrome.storage.session.set({permissionTrace:journal(permissionTrace,{action:'added',result:'event',origins:event?.origins})});await reconcile(s,{repair:true});});};
chrome.permissions.onAdded.addListener(permissionsChanged);
chrome.permissions.onRemoved.addListener(event=>{void state(async s=>{const {permissionTrace=[]}=await chrome.storage.session.get('permissionTrace');await chrome.storage.session.set({permissionTrace:journal(permissionTrace,{action:'removed',result:'event',origins:event?.origins})});await reconcile(s,{repair:true,invalidate:true});});});
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')void state(s=>reconcile(s));});
chrome.runtime.onStartup.addListener(()=>{void state(s=>reconcile(s,{repair:true}));});
chrome.runtime.onInstalled.addListener(()=>{void state(s=>reconcile(s,{repair:true}));});
chrome.alarms.create('expire', {periodInMinutes: 1});
chrome.alarms.onAlarm.addListener(() => { void state(s=>reconcile(s)); const now = Date.now(); for (const [id, c] of contexts) if (now - c.at > 30_000) contexts.delete(id); });
// Revalidate restored sessions against actual grants/open tabs on every worker start.
void state(s=>reconcile(s,{repair:true}));
// storage.session is memory-backed and inaccessible to content scripts by default.
void chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
