import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {httpUrl,mediaKind,prune,addCandidate,extractorPage,addPageCandidate,TTL,MAX_CANDIDATES} from '../browser-companion/extension/model.js';
import {watchMedia} from '../browser-companion/extension/detect.js';
import {grantedOrigin} from '../browser-companion/extension/site-access.js';
import {wireCandidate} from '../browser-companion/extension/preview.js';
const page='https://page.example.test/watch?meaning=keep',media='https://cdn.example.test/content?signature=one%2Btwo';
const session=(now=Date.now())=>({pageUrl:page,title:null,startedAt:now-100,expiresAt:now+TTL,navigationId:'navigation',candidates:[]});
const data=(s,url=media)=>({mediaUrl:url,contentType:'video/mp4',frameId:0,frameUrl:page,documentId:'doc',navigationId:s.navigationId,observedAt:Date.now()});
test('bounded site page adapters preserve selection and reject feeds, spoofed hosts and segments',()=>{
 for(const url of ['https://www.youtube.com/watch?v=irVNGjRFZGk&t=1s','https://www.youtube.com/shorts/irVNGjRFZGk','https://www.youtube-nocookie.com/embed/irVNGjRFZGk','https://www.instagram.com/reel/Fixture_1/?img_index=2','https://www.instagram.com/p/Fixture_2/'])assert.equal(extractorPage(url),url);
 for(const url of ['https://www.youtube.com/','https://www.instagram.com/','https://www.youtube.com.evil.test/watch?v=irVNGjRFZGk','javascript:alert(1)'])assert.equal(extractorPage(url),null);
 const s=session(),url='https://www.youtube.com/watch?v=irVNGjRFZGk';assert.equal(addPageCandidate(s,{...data(s),extractorPageUrl:url}),false);
 assert.ok(addPageCandidate(s,{...data(s),frameUrl:url,extractorPageUrl:url}));assert.equal(s.candidates[0].mediaUrl,'');assert.equal(s.candidates[0].extractorPageUrl,url);assert.equal(addPageCandidate(s,{...data(s),frameUrl:url,extractorPageUrl:url}),false);
 for(const url of ['https://r.googlevideo.com/videoplayback?id=x&range=0-999','https://cdn.test/chunk-1.mp4','https://cdn.test/a.m4s','https://cdn.test/media?bytestart=0'])assert.equal(addCandidate(s,{...data(s,url),dom:true}),false);
 assert.equal(mediaKind('https://cdn.test/pretend.mp4','application/json'),null);
});
test('direct, extensionless, HLS/DASH and segments are classified without query rewriting',()=>{
 assert.equal(mediaKind(media,'video/mp4'),'direct');assert.equal(mediaKind('https://cdn.example.test/index','application/vnd.apple.mpegurl; charset=utf-8'),'hls');assert.equal(mediaKind('https://cdn.example.test/m','application/dash+xml'),'dash');
 for(const path of ['seg-00001.mp4','chunk-13.aac','fragment-2.webm','video.m4s','v.ts'])assert.equal(mediaKind('https://cdn.example.test/'+path,'video/mp4'),null);
 assert.equal(httpUrl('blob:https://page.example.test/123'),null);assert.equal(httpUrl('https://user:pass@example.test/v.mp4'),null);
 const s=session();assert.ok(addCandidate(s,data(s),Date.now(),()=> 'id'));assert.equal(s.candidates[0].mediaUrl,media);assert.equal(s.candidates[0].width,null);assert.equal(s.candidates[0].title,null);
 assert.equal(addCandidate(s,data(s)),false);assert.ok(addCandidate(s,data(s,media+'3')));assert.equal(s.candidates.length,2);
});
test('candidate bounds, navigation identity, stale results and candidate expiry independent of access',()=>{
 const s=session();for(let i=0;i<1000;i++)addCandidate(s,data(s,media+i),Date.now(),()=>String(i));assert.equal(s.candidates.length,MAX_CANDIDATES);
 assert.equal(addCandidate(s,{...data(s),navigationId:'old'}),false);assert.equal(addCandidate(s,{...data(s),observedAt:s.startedAt-1}),false);
 const later=Date.now()+TTL+1000;assert.equal(Object.keys(prune({1:s},later)).length,1);assert.equal(s.candidates.length,0);assert.equal(Object.keys(prune({1:session(Date.now()+TTL)},Date.now())).length,0);
});
function event(){const listeners=[];return{addListener(fn){listeners.push(fn);},emit(...args){for(const fn of listeners)fn(...args);},listeners};}
async function detected(mock,tabId,url,id,documentId='main'){
 const d={tabId,frameId:0,documentId,requestId:id,timeStamp:Date.now()+1,url,initiator:page};
 mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});return (await mock.message({type:'state'})).session;
}
function mockChrome(sessionData={}){
 const sessions={...sessionData},sentNative=[];let port;const runtime={id:'abcdefghijklmnopabcdefghijklmnop',lastError:null,onMessage:event(),onStartup:event(),onInstalled:event(),getURL:path=>'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'+path,connectNative(){port={onMessage:event(),onDisconnect:event(),postMessage(m){sentNative.push(structuredClone(m));queueMicrotask(()=>port.onMessage.emit({v:1,requestId:m.requestId,ok:true,code:m.type==='hello'?'connected':'accepted',message:m.type==='hello'?'Connected to ClipClipGO.':'Source received.'}));},disconnect(){port.onDisconnect.emit();}};return port;}};
 const grants=new Set(['https://page.example.test/*','https://cdn.example.test/*','https://cdn.test/*']);const c={runtime,storage:{session:{async get(){return structuredClone(sessions);},async set(v){Object.assign(sessions,structuredClone(v));},async clear(){for(const k of Object.keys(sessions))delete sessions[k];},async setAccessLevel(){}},local:{async clear(){}}},tabs:{async sendMessage(){},async query(){return[{id:1,url:page,title:'Delayed playback'}];},onRemoved:event(),onUpdated:event()},webRequest:Object.fromEntries(['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived','onCompleted','onErrorOccurred'].map(n=>[n,event()])),webNavigation:{async getAllFrames(){return[{frameId:0,url:page}];},onBeforeNavigate:event(),onCommitted:event(),onHistoryStateUpdated:event(),onDOMContentLoaded:event()},permissions:{async getAll(){return {origins:[...grants]};},async contains({origins}){return origins.every(o=>grants.has(o));},onRemoved:event(),onAdded:event()},scripting:{async executeScript(){}},alarms:{async create(){},onAlarm:event()}};
 c.tabs.get=async id=>({id});
 const message=m=>new Promise(resolve=>runtime.onMessage.listeners[0](m,{id:runtime.id,url:runtime.getURL('popup.html')},resolve));return{c,message,sessions,grants,sentNative,get port(){return port;}};
}

test('thumbnail-only updates enrich an existing frame resource without creating or rerouting candidates',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:page,documentId:'main'}];await import('../browser-companion/extension/worker.js?thumbnail-association');await mock.message({type:'state'});await detected(mock,1,media,'media');
 const before=(await mock.message({type:'state'})).session,existing=before.candidates[0];
 const thumb=(url,documentId='main')=>new Promise(resolve=>mock.c.runtime.onMessage.listeners[0]({type:'thumbnail',navigationId:before.navigationId,mediaUrl:url,posterUrl:'https://cdn.example.test/poster.jpg?sig=keep%2B'},{id:mock.c.runtime.id,tab:{id:1},frameId:0,url:page,documentId},resolve));
 await thumb(media,'old-document');assert.equal((await mock.message({type:'state'})).session.candidates[0].posterUrl,undefined);await thumb(media);await thumb(media+'&different=1');const after=(await mock.message({type:'state'})).session;
 assert.equal(after.candidates.length,1);assert.equal(after.candidates[0].id,existing.id);assert.equal(after.candidates[0].mediaUrl,existing.mediaUrl);assert.equal(after.candidates[0].posterUrl,'https://cdn.example.test/poster.jpg?sig=keep%2B');
 assert.deepEqual(wireCandidate(after.candidates[0]),wireCandidate(existing));await mock.message({type:'clear'});delete globalThis.chrome;
});

test('reported IMDb/X failure: permitted DOM URLs survive missing CDN grants without enabling CDN monitoring',async()=>{
 const cases=[['https://www.imdb.com/video/vi3232221721/?playlistId=nm13946181','https://imdb-video.media-imdb.com/fixture/master.m3u8?signature=keep%2B'],['https://x.com/AmmarGill/status/2125260987767136276','https://video.twimg.com/fixture/master.m3u8?signature=keep%2B']];
 for(const [pageUrl,mediaUrl]of cases){
  const mock=mockChrome();globalThis.chrome=mock.c;mock.grants.clear();mock.grants.add(new URL(pageUrl).origin+'/*');
  mock.c.tabs.query=async()=>[{id:1,url:pageUrl}];mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:pageUrl,documentId:'doc'}];
  await import('../browser-companion/extension/worker.js?dom-cdn='+new URL(pageUrl).host);const first=await mock.message({type:'state'});
  const content=(message,senderUrl=pageUrl)=>new Promise(resolve=>mock.c.runtime.onMessage.listeners[0](message,{id:mock.c.runtime.id,tab:{id:1},frameId:0,url:senderUrl,documentId:'doc'},resolve));
  const message={type:'dom',navigationId:first.session.navigationId,mediaUrl,observedAt:Date.now(),resourceTiming:true};
  await content(message);let s=await mock.message({type:'state'});assert.equal(s.session.candidates.length,1);const candidate=s.session.candidates[0];assert.equal(candidate.mediaType,'hls');assert.equal(candidate.mediaUrl,mediaUrl);assert.equal(candidate.pageUrl,pageUrl);
  assert.equal(candidate.domObserved,true);assert.equal(wireCandidate(candidate).domObserved,undefined);assert.equal(wireCandidate(candidate).mediaUrl,mediaUrl);assert.equal(extractorPage(pageUrl),null);
  assert.equal((await mock.message({type:'send',id:candidate.id})).code,'accepted');const handed=mock.sentNative.find(m=>m.type==='candidate').candidate;assert.equal(handed.mediaUrl,mediaUrl);assert.equal(handed.domObserved,undefined);
  // Restoring/reconciling observers must not discard this authorized-document candidate.
  await mock.message({type:'sync'});assert.equal((await mock.message({type:'state'})).session.candidates[0].id,candidate.id);
  const network={tabId:1,frameId:0,documentId:'doc',requestId:'ungranted-cdn',url:mediaUrl,initiator:pageUrl,timeStamp:Date.now()+1};
  mock.c.webRequest.onBeforeRequest.emit(network);mock.c.webRequest.onHeadersReceived.emit({...network,statusCode:200,responseHeaders:[{name:'Content-Type',value:'application/x-mpegurl'}]});
  s=await mock.message({type:'state'});assert.equal(s.session.observedRequests||0,0);assert.equal(s.session.networkMedia||0,0);assert.ok(s.session.missingOrigins.includes(new URL(mediaUrl).origin));
  // No unpermitted frame, arbitrary page candidate, blob or media segment becomes transferable.
  await content({...message,mediaUrl:mediaUrl+'&unpermitted=1'},'https://unpermitted.test/player');
  for(const url of ['blob:https://x.com/local','https://video.twimg.com/chunk-1.m4s'])await content({...message,mediaUrl:url});
  assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
  mock.grants.delete(new URL(pageUrl).origin+'/*');mock.c.permissions.onRemoved.emit();assert.equal((await mock.message({type:'state'})).session,null);
  await content({...message,mediaUrl:mediaUrl+'&old=1'});assert.equal((await mock.message({type:'state'})).session,null);
  mock.grants.add(new URL(pageUrl).origin+'/*');mock.c.permissions.onAdded.emit();const regranted=await mock.message({type:'state'});await content({...message,navigationId:regranted.session.navigationId,observedAt:Date.now(),mediaUrl:mediaUrl+'&new=1'});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
  await mock.message({type:'clear'});
 }
 delete globalThis.chrome;
});

test('worker diagnostic route reports actual grants, operations and pipeline counts without candidate URLs',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;mock.c.runtime.getManifest=()=>({version:'0.5.3',optional_host_permissions:['https://*/*']});
 await import('../browser-companion/extension/worker.js?diagnostic');await mock.message({type:'state'});await detected(mock,1,media+'&SECRET','diagnostic');
 await mock.message({type:'permissionTrace',entry:{action:'request',result:'false',origins:['https://page.example.test/*','https://invalid.test/?SECRET']}});
 const result=await mock.message({type:'diagnosticReport'});assert.equal(result.ok,true);assert.equal(result.report.version,'0.5.3');assert.equal(result.report.candidates,1);assert.ok(result.report.counters.networkMedia>0);assert.equal(result.report.operations.at(-1).result,'false');assert.ok(!JSON.stringify(result.report).includes('SECRET'));assert.equal(result.report.frames[0].completed,true);assert.equal(result.report.frames[0].heartbeatAgeMs,null);
 const getAll=mock.c.permissions.getAll;mock.c.permissions.getAll=async()=>{throw Error('SECRET API failure');};const failed=await mock.message({type:'diagnosticReport'});assert.equal(failed.report.permissionRead,'failed');assert.ok(!JSON.stringify(failed).includes('SECRET'));mock.c.permissions.getAll=getAll;
 await mock.message({type:'clear'});delete globalThis.chrome;
});

test('IMDb and twitter to X committed redirects retain early direct/manifest candidates and exact page URLs',async()=>{
 const routes=[['https://imdb.com/video/vi3232221721/?playlistId=nm13946181','https://www.imdb.com/video/vi3232221721/?playlistId=nm13946181','https://fixture.cloudfront.test/media.m3u8?sig=keep%2B','application/vnd.apple.mpegurl'],['https://twitter.com/AmmarGill/status/2125260987767136276','https://x.com/AmmarGill/status/2125260987767136276','https://video.twimg.test/ext_tw_video/file?sig=keep%2B','video/mp4']];
 for(const [before,after,url,mime] of routes){
  const mock=mockChrome();let tab={id:1,url:before};globalThis.chrome=mock.c;
  mock.c.tabs.query=async()=>[tab];for(const u of [before,after,url])mock.grants.add(new URL(u).origin+'/*');
  mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:tab.url,documentId:'doc'}];
  await import('../browser-companion/extension/worker.js?redirect='+new URL(after).host);await mock.message({type:'state'});
  tab={id:1,url:after};mock.c.webNavigation.onCommitted.emit({tabId:1,frameId:0,url:after,documentId:'doc'});
  const d={tabId:1,frameId:0,documentId:'doc',requestId:'early',timeStamp:Date.now()+1,url,initiator:after};
  mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:206,responseHeaders:[{name:'Content-Type',value:mime}]});
  const state=await mock.message({type:'state'});assert.equal(state.session.pageUrl,after);assert.equal(state.session.candidates.length,1);assert.equal(state.session.candidates[0].mediaUrl,url);assert.equal(state.session.candidates[0].mediaType,mime==='video/mp4'?'direct':'hls');
  assert.equal(extractorPage(after),null,'Do not turn every site page into an extractor candidate');await mock.message({type:'clear'});
 }
 delete globalThis.chrome;
});

test('empty frame enumeration is retried; grant/revoke/regrant restarts existing tab observers',async()=>{
 const mock=mockChrome(),stops=[],injections=[];let frames=[];globalThis.chrome=mock.c;
 mock.c.tabs.sendMessage=async(id,m)=>stops.push(m.type);mock.c.webNavigation.getAllFrames=async()=>frames;mock.c.scripting.executeScript=async x=>injections.push(x);
 await import('../browser-companion/extension/worker.js?empty-regrant');let state=await mock.message({type:'state'});assert.ok(state.diagnostics.includes('observer_not_running'));
 frames=[{frameId:0,url:page,documentId:'main'}];mock.c.alarms.onAlarm.emit();await mock.message({type:'state'});assert.ok(injections.length);
 await detected(mock,1,media,'first');assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 mock.grants.delete('https://page.example.test/*');mock.c.permissions.onRemoved.emit();state=await mock.message({type:'state'});assert.equal(state.session,null);assert.ok(stops.includes('stopClipClipGO'));assert.ok(state.diagnostics.includes('missing_page_access'));
 mock.grants.add('https://page.example.test/*');mock.c.permissions.onAdded.emit();await mock.message({type:'state'});await detected(mock,1,media+'new','second');assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 await mock.message({type:'clear'});delete globalThis.chrome;
});

test('wildcard grants cover IMDb page and CDN subdomains; an unrelated iframe remains unobserved',async()=>{
 const mock=mockChrome(),url='https://www.imdb.com/video/vi3232221721/?playlistId=nm13946181',injected=[];globalThis.chrome=mock.c;
 mock.grants.clear();mock.grants.add('*://*.imdb.com/*');mock.grants.add('https://*.media-amazon.test/*');
 mock.c.permissions.contains=async({origins})=>origins.every(o=>grantedOrigin(o,[...mock.grants]));mock.c.tabs.query=async()=>[{id:1,url}];
 mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url,documentId:'main'},{frameId:2,url:'https://unpermitted.test/player',documentId:'frame'}];mock.c.scripting.executeScript=async args=>injected.push(args.target.frameIds[0]);
 await import('../browser-companion/extension/worker.js?wildcard-imdb');let state=await mock.message({type:'state'});assert.deepEqual(injected,[0]);assert.ok(state.diagnostics.includes('missing_frame_or_cdn_access'));
 const d={tabId:1,frameId:0,documentId:'main',requestId:'cdn',timeStamp:Date.now()+1,url:'https://cdn.media-amazon.test/v.m3u8?signature=keep%2B',initiator:url};mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:200,responseHeaders:[{name:'Content-Type',value:'application/x-mpegurl'}]});
 state=await mock.message({type:'state'});assert.equal(state.session.candidates.length,1);assert.equal(state.session.candidates[0].mediaUrl,d.url);assert.equal(state.session.candidates[0].mediaType,'hls');
 await mock.message({type:'clear'});delete globalThis.chrome;
});
test('actual worker API wiring: scoped requests, delayed media, frames, navigation, suspension and disconnect',async()=>{
 let mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?first');await mock.message({type:'start'});
 let snapshot=await mock.message({type:'state'});assert.equal(snapshot.session.candidates.length,0);
 const request={tabId:1,frameId:2,documentId:'permitted-frame',requestId:'one',timeStamp:Date.now()+1,url:media,initiator:page};
 mock.c.webRequest.onBeforeRequest.emit(request);mock.c.webRequest.onBeforeSendHeaders.emit({...request,requestHeaders:[{name:'Cookie',value:'never-store-this'},{name:'Authorization',value:'never-store-that'},{name:'Referer',value:page}]});
 mock.c.webRequest.onHeadersReceived.emit({...request,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});mock.c.webRequest.onCompleted.emit(request);
 snapshot=await mock.message({type:'state'});assert.equal(snapshot.session.candidates.length,1);assert.equal(snapshot.session.candidates[0].frameId,2);assert.equal(snapshot.session.candidates[0].context.referer,page);assert.ok(!JSON.stringify(mock.sessions).includes('never-store'));
 mock.c.webRequest.onBeforeRequest.emit({...request,tabId:99,requestId:'unrelated'});mock.c.webRequest.onHeadersReceived.emit({...request,tabId:99,requestId:'unrelated',statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 const saved=structuredClone(mock.sessions);mock=mockChrome(saved);globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?resumed');assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 assert.equal((await mock.message({type:'check'})).code,'connected');assert.equal((await mock.message({type:'send',id:snapshot.session.candidates[0].id})).code,'accepted');const oldPort=mock.port;mock.port.disconnect();assert.equal((await mock.message({type:'state'})).connection.code,'disconnected');assert.equal((await mock.message({type:'check'})).code,'connected');oldPort.onDisconnect.emit();assert.equal((await mock.message({type:'state'})).connection.code,'connected');
 mock.c.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:0});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 mock.c.webRequest.onHeadersReceived.emit({...request,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});await mock.message({type:'start'});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 await mock.message({type:'clear'});assert.equal(mock.sessions.sessions[1].candidates.length,0);delete globalThis.chrome;
});
test('manifest has no mandatory sites, remote code, sync storage or automatic page script',async()=>{
 const manifest=JSON.parse(await readFile('browser-companion/extension/manifest.json','utf8'));assert.equal(manifest.manifest_version,3);assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.content_scripts,undefined);assert.ok(manifest.permissions.includes('nativeMessaging'));assert.ok(!manifest.permissions.includes('cookies'));const worker=await readFile('browser-companion/extension/worker.js','utf8');assert.ok(!worker.includes('storage.sync'));assert.ok(!worker.includes('console.log'));
});

test('regression: sending A keeps scoped discovery working for B after same-origin SPA navigation',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?sequential-spa');await mock.message({type:'start'});
 const a=await detected(mock,1,media+'&item=A','a');assert.equal((await mock.message({type:'send',id:a.candidates[0].id})).code,'accepted');
 const nextPage='https://page.example.test/watch?meaning=second';mock.c.tabs.query=async()=>[{id:1,url:nextPage}];mock.c.webNavigation.onHistoryStateUpdated.emit({tabId:1,frameId:0,documentId:'main',url:nextPage,timeStamp:Date.now()});
 const state=await mock.message({type:'state'});assert.ok(state.session,'Same-origin navigation must retain this tab authorization');assert.equal(state.session.candidates.length,0);
 const b=await detected(mock,1,media+'&item=B','b');assert.equal(b.candidates.length,1);assert.equal(b.candidates[0].pageUrl,nextPage);assert.equal((await mock.message({type:'send',id:b.candidates[0].id})).code,'accepted');
 await mock.message({type:'clear'});delete globalThis.chrome;
});
test('regression: in-flight request identity survives worker restart without persisting Referer',async()=>{
 let mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?inflight-first');await mock.message({type:'start'});
 const d={tabId:1,frameId:0,documentId:'main',requestId:'inflight',timeStamp:Date.now()+1,url:media};mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onBeforeSendHeaders.emit({...d,requestHeaders:[{name:'Referer',value:page}]});await mock.message({type:'state'});
 const saved=structuredClone(mock.sessions);assert.ok(!JSON.stringify(saved).includes('referer":\"https:'));
 mock=mockChrome(saved);globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?inflight-resumed');mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});
 const s=await mock.message({type:'state'});assert.equal(s.session.candidates.length,1,'Headers after suspension must retain navigation ownership');assert.equal(s.session.candidates[0].context.referer,null);await mock.message({type:'clear'});delete globalThis.chrome;
});

test('sequential authorized tabs/origins, reload, permission revocation and native failures remain independent',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?multi-tab');
 let tab={id:1,url:page};mock.c.tabs.query=async()=>[tab];
 mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:tab.url,documentId:'main'}];
 await mock.message({type:'start'});let s=await detected(mock,1,media+'A','a');
 assert.equal((await mock.message({type:'send',id:s.candidates[0].id})).ok,true);
 await mock.message({type:'disconnect'});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 tab={id:2,url:page};assert.equal((await mock.message({type:'state'})).detection,'active');await mock.message({type:'start'});
 s=await detected(mock,2,media+'B','b');assert.equal((await mock.message({type:'send',id:s.candidates[0].id})).ok,true);
 tab={id:3,url:'https://other.example.test/watch?keep=1'};assert.equal((await mock.message({type:'state'})).detection,'permission-needed');
 mock.grants.add('https://other.example.test/*');await mock.message({type:'start'});s=await detected(mock,3,media+'C','c');assert.equal(s.candidates.length,1);
 assert.equal((await mock.message({type:'send',id:s.candidates[0].id})).ok,true);
 const reload='https://other.example.test/watch?keep=2';mock.c.webNavigation.onBeforeNavigate.emit({tabId:3,frameId:0,url:reload});assert.equal((await mock.message({type:'state'})).detection,'navigating');
 mock.c.webNavigation.onCommitted.emit({tabId:3,frameId:0,url:reload,documentId:'new'});tab.url=reload;mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:reload,documentId:'new'}];mock.c.webNavigation.onDOMContentLoaded.emit({tabId:3,frameId:0,url:reload});
 s=await detected(mock,3,media+'D','d','new');assert.equal(s.candidates.length,1);assert.equal(s.candidates[0].pageUrl,reload);
 await mock.message({type:'disconnect'});mock.c.runtime.connectNative=()=>{throw Error('fixture disconnect');};
 s=await detected(mock,3,media+'E','e','new');assert.equal((await mock.message({type:'send',id:s.candidates[1].id})).ok,false);assert.equal((await mock.message({type:'state'})).session.candidates.length,2);
 mock.grants.delete('https://page.example.test/*');mock.c.permissions.onRemoved.emit({origins:['https://page.example.test/*']});assert.ok((await mock.message({type:'state'})).session,'Revoking another origin must preserve this activation');
 tab={id:1,url:page};assert.equal((await mock.message({type:'state'})).detection,'permission-needed');assert.equal((await mock.message({type:'state'})).session,null);
 tab={id:3,url:page};mock.c.webNavigation.onHistoryStateUpdated.emit({tabId:3,frameId:0,url:page});assert.equal((await mock.message({type:'state'})).session,null,'Cross-origin navigation requires activation again');
 await mock.message({type:'clear'});delete globalThis.chrome;
});

test('permitted frame injection, encrypted playback and child-document navigation stay scoped',async()=>{
 const mock=mockChrome(),executed=[];globalThis.chrome=mock.c;
 mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:page,documentId:'main'},{frameId:2,url:'https://frame.example.test/player',documentId:'child'}];
 mock.c.scripting.executeScript=async input=>executed.push(input.target.frameIds[0]);
 await import('../browser-companion/extension/worker.js?frames');await mock.message({type:'start'});assert.ok(executed.length>=1);assert.ok(executed.every(frame=>frame===0));
 assert.deepEqual((await mock.message({type:'state'})).session.missingOrigins,['https://frame.example.test']);
 mock.grants.add('https://frame.example.test/*');await mock.message({type:'scan'});assert.ok(executed.includes(2));
 const inFlight={tabId:1,frameId:2,documentId:'child',requestId:'active-during-unrelated-navigation',timeStamp:Date.now()+1,url:media};mock.c.webRequest.onBeforeRequest.emit(inFlight);mock.c.webNavigation.onBeforeNavigate.emit({tabId:99,frameId:0});mock.c.webRequest.onHeadersReceived.emit({...inFlight,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 mock.c.webNavigation.onHistoryStateUpdated.emit({tabId:1,frameId:2,url:'https://frame.example.test/next'});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 const s=(await mock.message({type:'state'})).session;
 const dom=m=>new Promise(resolve=>mock.c.runtime.onMessage.listeners[0](m,{id:mock.c.runtime.id,tab:{id:1},frameId:2,url:'https://frame.example.test/player',documentId:'child'},resolve));
 await dom({type:'dom',navigationId:s.frameTokens?.[2]??s.navigationId,mediaUrl:media,observedAt:Date.now(),width:640,height:360});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 await dom({type:'encrypted',navigationId:s.frameTokens?.[2]??s.navigationId,mediaUrl:media});const protectedState=(await mock.message({type:'state'})).session;assert.equal(protectedState.candidates[0].drm,true);assert.equal((await mock.message({type:'send',id:protectedState.candidates[0].id})).code,'rejected');
 mock.c.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:2});await dom({type:'dom',navigationId:s.navigationId,mediaUrl:media+'new',observedAt:Date.now()});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 await mock.message({type:'scan'});mock.grants.delete('https://frame.example.test/*');mock.c.permissions.onRemoved.emit({origins:['https://frame.example.test/*']});await mock.message({type:'state'});await dom({type:'dom',navigationId:s.navigationId,mediaUrl:media+'revoked',observedAt:Date.now()});assert.equal((await mock.message({type:'state'})).session.candidates.length,0,'Old injected frame messages must be rejected after permission revocation');
 let readHeaders=false;const unrelated={tabId:99,get requestHeaders(){readHeaders=true;throw Error('Unrelated tab headers must not be inspected');}};mock.c.webRequest.onBeforeSendHeaders.emit(unrelated);await mock.message({type:'state'});assert.equal(readHeaders,false);
 mock.c.tabs.query=async()=>[];mock.c.tabs.onRemoved.emit(1);assert.equal(mock.sessions.sessions[1]?.candidates.length??0,0);await mock.message({type:'clear'});delete globalThis.chrome;
});

test('persistent granted access outlasts old timeout while candidates expire',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?expiry');await detected(mock,1,media,'expire');
 const now=Date.now,late=Date.now()+TTL+1000;Date.now=()=>late;
 try{const state=await mock.message({type:'state'});assert.ok(state.session);assert.equal(state.session.candidates.length,0);assert.equal(state.detection,'active');await detected(mock,1,media+'later','late');assert.equal((await mock.message({type:'state'})).session.candidates.length,1);}finally{Date.now=now;await mock.message({type:'clear'});delete globalThis.chrome;}
});

test('SPA DOM rescan ignores the previous source without suppressing a new source already loaded',()=>{
 const sent=[],original={chrome:globalThis.chrome,document:globalThis.document,MutationObserver:globalThis.MutationObserver};
 globalThis.chrome={runtime:{onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{sent.push(m);}}};
 globalThis.document={title:'Second video',querySelectorAll:()=>[{currentSrc:media+'A'},{currentSrc:media+'B'}],documentElement:{},addEventListener(){},removeEventListener(){}};
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 try{watchMedia('new-navigation',Date.now()+TTL,[media+'A']);assert.deepEqual(sent.map(m=>m.mediaUrl),[media+'B']);}
 finally{globalThis.__clipclipgoDetector?.stop();delete globalThis.__clipclipgoDetector;Object.assign(globalThis,original);}
});

test('page handoff remains distinct and document-authenticated while XHR/206 discovery continues',async()=>{
 const mock=mockChrome(),url='https://www.youtube.com/watch?v=irVNGjRFZGk';globalThis.chrome=mock.c;mock.c.tabs.query=async()=>[{id:1,url}];mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url,documentId:'yt-doc'}];mock.grants.add('https://www.youtube.com/*');await import('../browser-companion/extension/worker.js?routing-layer');await mock.message({type:'start'});
 const nav=(await mock.message({type:'state'})).session.navigationId;
 const dom=(payload,doc='yt-doc')=>new Promise(r=>mock.c.runtime.onMessage.listeners[0](payload,{id:mock.c.runtime.id,tab:{id:1},frameId:0,url,documentId:doc},r));
 await dom({type:'page',navigationId:nav,extractorPageUrl:url},'old-doc');assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 await dom({type:'page',navigationId:nav,extractorPageUrl:'https://www.instagram.com/reel/Wrong/'});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 await dom({type:'page',navigationId:nav,extractorPageUrl:url});let state=await mock.message({type:'state'});assert.equal(state.session.candidates[0].mediaType,'page');assert.equal((await mock.message({type:'send',id:state.session.candidates[0].id})).code,'accepted');
 const d={tabId:1,frameId:0,documentId:'yt-doc',requestId:'xhr',type:'xmlhttprequest',timeStamp:Date.now()+1,url:'https://cdn.test/extensionless?signature=keep%2B',initiator:url};mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:206,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});state=await mock.message({type:'state'});assert.equal(state.session.candidates.length,2);assert.equal(state.session.candidates[1].mediaType,'direct');assert.equal(state.session.candidates[1].mediaUrl,d.url);await mock.message({type:'clear'});delete globalThis.chrome;
});

test('popup preview requests are ignored even if a browser supplies an activated tab ID',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?preview-loop');await mock.message({type:'start'});
 const d={tabId:1,frameId:0,documentId:'main',requestId:'extension-preview',timeStamp:Date.now()+1,url:media,initiator:mock.c.runtime.getURL('popup.html')};mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:206,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);await mock.message({type:'clear'});delete globalThis.chrome;
});

test('actual grants automatically enable open tabs, navigation and newly granted sites; CDN alone cannot enable a page',async()=>{
 const mock=mockChrome(),executed=[],stopped=[];globalThis.chrome=mock.c;
 const tabs=[{id:1,url:page},{id:2,url:page+'&tab=2'},{id:3,url:'https://unpermitted.test/watch'},{id:4,url:page,incognito:true}];
 mock.c.tabs.query=async options=>options.active?[tabs[0]]:tabs;
 mock.c.webNavigation.getAllFrames=async({tabId})=>[{frameId:0,url:tabs.find(t=>t.id===tabId)?.url,documentId:'main'}];
 mock.c.scripting.executeScript=async args=>executed.push(args.target.tabId);
 mock.c.tabs.sendMessage=async(id,message)=>stopped.push([id,message.type]);
 await import('../browser-companion/extension/worker.js?persistent-tabs');await mock.message({type:'state'});
 assert.deepEqual([...new Set(executed)].sort(),[1,2]);assert.equal(mock.sessions.sessions[3],undefined);assert.equal(mock.sessions.sessions[4],undefined);
 const otherRequest={tabId:3,frameId:0,requestId:'unpermitted-page',timeStamp:Date.now()+1,url:media,initiator:tabs[2].url};
 mock.c.webRequest.onBeforeRequest.emit(otherRequest);mock.c.webRequest.onHeadersReceived.emit({...otherRequest,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});await mock.message({type:'state'});assert.equal(mock.sessions.sessions[3],undefined);
 mock.grants.add('https://unpermitted.test/*');mock.c.permissions.onAdded.emit({origins:['https://unpermitted.test/*']});await mock.message({type:'state'});assert.ok(mock.sessions.sessions[3]);assert.ok(executed.includes(3),'No reload/start message needed for an already-open permitted tab');
 tabs[1].url='https://unpermitted.test/second';mock.c.webNavigation.onBeforeNavigate.emit({tabId:2,frameId:0,url:tabs[1].url});mock.c.webNavigation.onCommitted.emit({tabId:2,frameId:0,url:tabs[1].url,documentId:'second'});await mock.message({type:'state'});assert.equal(mock.sessions.sessions[2].pageUrl,tabs[1].url);
 mock.grants.delete('https://unpermitted.test/*');mock.c.permissions.onRemoved.emit({origins:['https://unpermitted.test/*']});await mock.message({type:'state'});assert.equal(mock.sessions.sessions[2],undefined);assert.equal(mock.sessions.sessions[3],undefined);assert.ok(stopped.some(([id])=>id===3));assert.ok(mock.sessions.sessions[1]);
 await mock.message({type:'clear'});delete globalThis.chrome;
});

test('restoration checks actual grants even without permission events and revocation invalidates existing observers',async()=>{
 const stored=session();addCandidate(stored,data(stored));const mock=mockChrome({sessions:{1:stored,99:{...session(),pageUrl:'https://removed.test/'}}});globalThis.chrome=mock.c;
 mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:page,documentId:'main'}];
 await import('../browser-companion/extension/worker.js?grant-restoration');const initial=await mock.message({type:'state'});assert.equal(initial.session.candidates.length,1);assert.equal(mock.sessions.sessions[99],undefined);
 const sender={id:mock.c.runtime.id,tab:{id:1},url:page,frameId:0,documentId:'main'};
 const content=m=>new Promise(r=>mock.c.runtime.onMessage.listeners[0](m,sender,r));
 assert.equal((await content({type:'observationAccess',navigationId:initial.session.navigationId})).ok,true);
 mock.grants.delete('https://page.example.test/*');assert.equal((await content({type:'observationAccess',navigationId:initial.session.navigationId})).ok,false);
 mock.c.permissions.onRemoved.emit({origins:['https://page.example.test/*']});assert.equal((await mock.message({type:'state'})).session,null);
 await content({type:'dom',navigationId:initial.session.navigationId,mediaUrl:media+'revoked',observedAt:Date.now()});assert.equal(mock.sessions.sessions[1],undefined);
 // Simulate temporary activeTab access without any durable host grant.
 mock.c.permissions.contains=async()=>true;assert.equal((await mock.message({type:'state'})).detection,'permission-needed');
 await mock.message({type:'clear'});delete globalThis.chrome;
});

test('revoked CDN access clears network candidates/context but does not revoke authorized document reads',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;mock.c.webNavigation.getAllFrames=async()=>[{frameId:0,url:page,documentId:'main'}];
 mock.c.storage.local.clear=async()=>assert.fail('Clearing temporary data must preserve theme preferences');
 await import('../browser-companion/extension/worker.js?revoke-cdn');await detected(mock,1,media,'one');
 const before=await mock.message({type:'state'});assert.equal(before.session.candidates.length,1);
 const dom=m=>new Promise(r=>mock.c.runtime.onMessage.listeners[0](m,{id:mock.c.runtime.id,tab:{id:1},frameId:0,url:page,documentId:'main'},r));
 mock.grants.delete('https://cdn.example.test/*');mock.c.permissions.onRemoved.emit({origins:['https://cdn.example.test/*']});const after=await mock.message({type:'state'});
 assert.ok(after.session);assert.equal(after.session.candidates.length,0);assert.deepEqual(after.session.requests,{});
 await dom({type:'dom',navigationId:after.session.navigationId,mediaUrl:media,observedAt:Date.now()});const limited=await mock.message({type:'state'});assert.equal(limited.session.candidates.length,1);assert.equal(limited.session.candidates[0].domObserved,true);assert.ok(limited.session.missingOrigins.includes('https://cdn.example.test'));
 mock.grants.add('https://cdn.example.test/*');mock.c.permissions.onAdded.emit();await mock.message({type:'state'});
 await dom({type:'dom',navigationId:after.session.navigationId,mediaUrl:media,observedAt:Date.now()});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 await mock.message({type:'clear'});delete globalThis.chrome;
});
