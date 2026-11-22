import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {httpUrl,mediaKind,prune,addCandidate,TTL,MAX_CANDIDATES} from '../browser-companion/extension/model.js';
import {watchMedia} from '../browser-companion/extension/detect.js';
const page='https://page.example.test/watch?meaning=keep',media='https://cdn.example.test/content?signature=one%2Btwo';
const session=(now=Date.now())=>({pageUrl:page,title:null,startedAt:now-100,expiresAt:now+TTL,navigationId:'navigation',candidates:[]});
const data=(s,url=media)=>({mediaUrl:url,contentType:'video/mp4',frameId:0,frameUrl:page,documentId:'doc',navigationId:s.navigationId,observedAt:Date.now()});
test('direct, extensionless, HLS/DASH and segments are classified without query rewriting',()=>{
 assert.equal(mediaKind(media,'video/mp4'),'direct');assert.equal(mediaKind('https://cdn.example.test/index','application/vnd.apple.mpegurl; charset=utf-8'),'hls');assert.equal(mediaKind('https://cdn.example.test/m','application/dash+xml'),'dash');
 for(const path of ['seg-00001.mp4','chunk-13.aac','fragment-2.webm','video.m4s','v.ts'])assert.equal(mediaKind('https://cdn.example.test/'+path,'video/mp4'),null);
 assert.equal(httpUrl('blob:https://page.example.test/123'),null);assert.equal(httpUrl('https://user:pass@example.test/v.mp4'),null);
 const s=session();assert.ok(addCandidate(s,data(s),Date.now(),()=> 'id'));assert.equal(s.candidates[0].mediaUrl,media);assert.equal(s.candidates[0].width,null);assert.equal(s.candidates[0].title,null);
 assert.equal(addCandidate(s,data(s)),false);assert.ok(addCandidate(s,data(s,media+'3')));assert.equal(s.candidates.length,2);
});
test('candidate bounds, navigation identity, stale results and session expiry',()=>{
 const s=session();for(let i=0;i<1000;i++)addCandidate(s,data(s,media+i),Date.now(),()=>String(i));assert.equal(s.candidates.length,MAX_CANDIDATES);
 assert.equal(addCandidate(s,{...data(s),navigationId:'old'}),false);assert.equal(addCandidate(s,{...data(s),observedAt:s.startedAt-1}),false);
 assert.equal(Object.keys(prune({1:s},s.expiresAt+1)).length,0);assert.equal(Object.keys(prune({1:session(Date.now()+TTL)},Date.now())).length,0);
});
function event(){const listeners=[];return{addListener(fn){listeners.push(fn);},emit(...args){for(const fn of listeners)fn(...args);},listeners};}
async function detected(mock,tabId,url,id,documentId='main'){
 const d={tabId,frameId:0,documentId,requestId:id,timeStamp:Date.now()+1,url,initiator:page};
 mock.c.webRequest.onBeforeRequest.emit(d);mock.c.webRequest.onHeadersReceived.emit({...d,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});return (await mock.message({type:'state'})).session;
}
function mockChrome(sessionData={}){
 const sessions={...sessionData};let port;const runtime={id:'abcdefghijklmnopabcdefghijklmnop',lastError:null,onMessage:event(),getURL:path=>'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'+path,connectNative(){port={onMessage:event(),onDisconnect:event(),postMessage(m){queueMicrotask(()=>port.onMessage.emit({v:1,requestId:m.requestId,ok:true,code:m.type==='hello'?'connected':'accepted',message:m.type==='hello'?'Connected to ClipClipGO.':'Source received.'}));},disconnect(){port.onDisconnect.emit();}};return port;}};
 const grants=new Set(['https://page.example.test/*']);const c={runtime,storage:{session:{async get(){return structuredClone(sessions);},async set(v){Object.assign(sessions,structuredClone(v));},async clear(){for(const k of Object.keys(sessions))delete sessions[k];},async setAccessLevel(){}},local:{async clear(){}}},tabs:{async sendMessage(){},async query(){return[{id:1,url:page,title:'Delayed playback'}];},onRemoved:event()},webRequest:Object.fromEntries(['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived','onCompleted','onErrorOccurred'].map(n=>[n,event()])),webNavigation:{async getAllFrames(){return[{frameId:0,url:page}];},onBeforeNavigate:event(),onCommitted:event(),onHistoryStateUpdated:event(),onDOMContentLoaded:event()},permissions:{async contains({origins}){return origins.every(o=>grants.has(o));},onRemoved:event()},scripting:{async executeScript(){}},alarms:{async create(){},onAlarm:event()}};
 const message=m=>new Promise(resolve=>runtime.onMessage.listeners[0](m,{id:runtime.id,url:runtime.getURL('popup.html')},resolve));return{c,message,sessions,grants,get port(){return port;}};
}
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
 mock.c.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:0});assert.equal((await mock.message({type:'state'})).session,null);
 mock.c.webRequest.onHeadersReceived.emit({...request,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});await mock.message({type:'start'});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 await mock.message({type:'clear'});assert.deepEqual(mock.sessions,{});delete globalThis.chrome;
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
 tab={id:2,url:page};assert.equal((await mock.message({type:'state'})).detection,'inactive');await mock.message({type:'start'});
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
 await import('../browser-companion/extension/worker.js?frames');await mock.message({type:'start'});assert.deepEqual(executed,[0]);
 assert.deepEqual((await mock.message({type:'state'})).session.missingOrigins,['https://frame.example.test']);
 mock.grants.add('https://frame.example.test/*');await mock.message({type:'scan'});assert.ok(executed.includes(2));
 const inFlight={tabId:1,frameId:2,documentId:'child',requestId:'active-during-unrelated-navigation',timeStamp:Date.now()+1,url:media};mock.c.webRequest.onBeforeRequest.emit(inFlight);mock.c.webNavigation.onBeforeNavigate.emit({tabId:99,frameId:0});mock.c.webRequest.onHeadersReceived.emit({...inFlight,statusCode:200,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 const s=(await mock.message({type:'state'})).session;
 const dom=m=>new Promise(resolve=>mock.c.runtime.onMessage.listeners[0](m,{id:mock.c.runtime.id,tab:{id:1},frameId:2,url:'https://frame.example.test/player',documentId:'child'},resolve));
 await dom({type:'dom',navigationId:s.navigationId,mediaUrl:media,observedAt:Date.now(),width:640,height:360});assert.equal((await mock.message({type:'state'})).session.candidates.length,1);
 await dom({type:'encrypted',navigationId:s.navigationId,mediaUrl:media});const protectedState=(await mock.message({type:'state'})).session;assert.equal(protectedState.candidates[0].drm,true);assert.equal((await mock.message({type:'send',id:protectedState.candidates[0].id})).code,'rejected');
 mock.c.webNavigation.onBeforeNavigate.emit({tabId:1,frameId:2});await dom({type:'dom',navigationId:s.navigationId,mediaUrl:media+'new',observedAt:Date.now()});assert.equal((await mock.message({type:'state'})).session.candidates.length,0);
 await mock.message({type:'scan'});mock.grants.delete('https://frame.example.test/*');mock.c.permissions.onRemoved.emit({origins:['https://frame.example.test/*']});await mock.message({type:'state'});await dom({type:'dom',navigationId:s.navigationId,mediaUrl:media+'revoked',observedAt:Date.now()});assert.equal((await mock.message({type:'state'})).session.candidates.length,0,'Old injected frame messages must be rejected after permission revocation');
 let readHeaders=false;const unrelated={tabId:99,get requestHeaders(){readHeaders=true;throw Error('Unrelated tab headers must not be inspected');}};mock.c.webRequest.onBeforeSendHeaders.emit(unrelated);await mock.message({type:'state'});assert.equal(readHeaders,false);
 mock.c.tabs.onRemoved.emit(1);assert.equal((await mock.message({type:'state'})).session,null);await mock.message({type:'clear'});delete globalThis.chrome;
});

test('expired activation becomes actionable without keeping stale candidates',async()=>{
 const mock=mockChrome();globalThis.chrome=mock.c;await import('../browser-companion/extension/worker.js?expiry');await mock.message({type:'start'});await detected(mock,1,media,'expire');
 mock.sessions.sessions[1].expiresAt=Date.now()-1;const state=await mock.message({type:'state'});assert.equal(state.session,null);assert.equal(state.detection,'expired');await mock.message({type:'start'});assert.equal((await mock.message({type:'state'})).detection,'active');await mock.message({type:'clear'});delete globalThis.chrome;
});

test('SPA DOM rescan ignores the previous source without suppressing a new source already loaded',()=>{
 const sent=[],original={chrome:globalThis.chrome,document:globalThis.document,MutationObserver:globalThis.MutationObserver};
 globalThis.chrome={runtime:{onMessage:{addListener(){},removeListener(){}},sendMessage:async m=>{sent.push(m);}}};
 globalThis.document={title:'Second video',querySelectorAll:()=>[{currentSrc:media+'A'},{currentSrc:media+'B'}],documentElement:{},addEventListener(){},removeEventListener(){}};
 globalThis.MutationObserver=class{observe(){}disconnect(){}};
 try{watchMedia('new-navigation',Date.now()+TTL,[media+'A']);assert.deepEqual(sent.map(m=>m.mediaUrl),[media+'B']);}
 finally{globalThis.__clipclipgoDetector?.stop();delete globalThis.__clipclipgoDetector;Object.assign(globalThis,original);}
});
