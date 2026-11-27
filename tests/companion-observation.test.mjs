import test from 'node:test';
import assert from 'node:assert/strict';
import {watchMedia} from '../browser-companion/extension/detect.js';
function fixture(url,run){
 const names=['chrome','document','location','performance','MutationObserver','setInterval','clearInterval','MediaStream'],saved=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const sent=[],events={},nodes=[],resources=[];let poll;
 const values={location:new URL(url),performance:{timeOrigin:1000,getEntriesByType:()=>resources},MediaStream:class{},chrome:{runtime:{sendMessage:async m=>{sent.push(m);},onMessage:{addListener(){},removeListener(){}}}},MutationObserver:class{observe(){}disconnect(){}},setInterval:(fn,ms)=>{if(ms===1500)poll=fn;return ms;},clearInterval(){},document:{title:'Fixture title',documentElement:{},createTreeWalker:root=>{const list=root.nodes??nodes;let i=0;return{nextNode:()=>list[i++]??null};},addEventListener:(n,fn)=>{events[n]=fn;},removeEventListener(){}}};
 for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 const video=src=>({currentSrc:src,matches:()=>true,videoWidth:640,videoHeight:360});
 try{run({sent,events,nodes,resources,video,start:(previous=[],since=0)=>watchMedia('nav',Date.now()+60000,previous,since),poll:()=>poll()});}
 finally{globalThis.__clipclipgoDetector?.stop();delete globalThis.__clipclipgoDetector;for(const key of names){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
}
test('open roots, already-playing elements, dynamic insertion and source changes are observed',()=>fixture('https://local.example/page',f=>{
 const playing=f.video('https://cdn.test/already-playing');const shadow={nodes:[playing],addEventListener(){},removeEventListener(){}};f.nodes.push({matches:()=>false,shadowRoot:shadow});f.start();assert.ok(f.sent.some(m=>m.mediaUrl===playing.currentSrc));
 playing.currentSrc='https://cdn.test/second?signature=retain%2B';f.poll();assert.ok(f.sent.some(m=>m.mediaUrl===playing.currentSrc));
 f.nodes.push(f.video('https://cdn.test/inserted'));f.poll();assert.ok(f.sent.some(m=>m.mediaUrl==='https://cdn.test/inserted'));
}));

test('relative lazy posters stay video-associated; decoded snapshots are bounded and never seek or play',()=>fixture('https://local.example/page',f=>{
 const v={...f.video('https://cdn.test/movie'),tagName:'VIDEO',readyState:2,isConnected:true,getAttribute:name=>name==='data-poster'?'/posters/item.jpg?sig=keep%2B':null};
 let draws=0;document.createElement=()=>({width:0,height:0,getContext:()=>({drawImage(video){assert.equal(video,v);draws++;}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/2Q=='});
 Object.defineProperty(v,'currentTime',{set(){assert.fail('Must not seek');}});v.play=()=>assert.fail('Must not play');v.pause=()=>assert.fail('Must not pause');
 f.nodes.push(v);f.start();const message=f.sent.find(m=>m.type==='dom');assert.equal(message.posterUrl,'https://local.example/posters/item.jpg?sig=keep%2B');assert.ok(message.snapshotUrl);f.poll();assert.equal(draws,1);
}));

test('tainted or detached video keeps discovery working without a snapshot or player control',()=>fixture('https://local.example/page',f=>{
 let attempts=0;document.createElement=()=>({getContext:()=>({drawImage(){attempts++;throw new Error('SecurityError: tainted canvas');}})});
 f.nodes.push({...f.video('https://cdn.test/tainted'),tagName:'VIDEO',readyState:2,isConnected:true},{...f.video('https://cdn.test/detached'),tagName:'VIDEO',readyState:2,isConnected:false});
 f.start();assert.equal(f.sent.filter(m=>m.type==='dom').length,2);assert.ok(f.sent.every(m=>!m.snapshotUrl));f.poll();assert.equal(attempts,1);
}));
test('resource timing recovers recognized prior requests but excludes prior SPA navigation history',()=>fixture('https://local.example/page',f=>{
 f.resources.push({name:'https://cdn.test/master.m3u8?signature=keep',initiatorType:'fetch',startTime:1},{name:'https://cdn.test/not-media.json',initiatorType:'fetch',startTime:2});f.start();assert.equal(f.sent.filter(m=>m.resourceTiming).length,1);
 f.sent.length=0;f.start([],2000);assert.equal(f.sent.filter(m=>m.resourceTiming).length,0);
}));
test('YouTube navigation offers extraction pages and Instagram feed videos retain item permalinks',()=>{
 fixture('https://www.youtube.com/watch?v=irVNGjRFZGk',f=>{f.start();assert.ok(f.sent.some(m=>m.type==='page'&&m.extractorPageUrl.includes('watch?v=')));globalThis.location=new URL('https://www.youtube.com/shorts/irVNGjRFZGk');f.poll();assert.ok(f.sent.some(m=>m.extractorPageUrl?.includes('/shorts/')));});
 fixture('https://www.instagram.com/',f=>{const v=f.video('blob:https://www.instagram.com/local');v.closest=()=>({querySelectorAll:()=>[{href:'https://www.instagram.com/reel/Item_A/'}]});f.nodes.push(v);f.start();assert.ok(f.sent.some(m=>m.extractorPageUrl==='https://www.instagram.com/reel/Item_A/'));assert.ok(!f.sent.some(m=>m.extractorPageUrl==='https://www.instagram.com/'));v.closest=()=>({querySelectorAll:()=>[{href:'https://www.instagram.com/p/Item_B/?img_index=2'}]});f.poll();assert.ok(f.sent.some(m=>m.extractorPageUrl?.includes('Item_B')));});
});
test('MediaStream and actual encryption evidence are distinct from missing media',()=>fixture('https://local.example/page',f=>{
 const v=f.video('');v.srcObject=new MediaStream();v.mediaKeys={};f.nodes.push(v);f.start();assert.ok(f.sent.some(m=>m.type==='playback'&&m.kind==='stream'));assert.ok(f.sent.some(m=>m.type==='encrypted'));
}));
test('SPA page offers do not reuse a poster whose canonical item is different',()=>fixture('https://www.youtube.com/watch?v=irVNGjRFZGk',f=>{
 document.querySelector=selector=>({content:selector.includes('og:image')?'https://cdn.test/poster.jpg':'https://www.youtube.com/watch?v=Wb8Tq_HD4E8'});f.start();assert.equal(f.sent.find(m=>m.type==='page').posterUrl,null);
 document.querySelector=selector=>({content:selector.includes('og:image')?'https://cdn.test/new-poster.jpg':'https://www.youtube.com/watch?v=irVNGjRFZGk'});f.poll();assert.ok(f.sent.some(m=>m.posterUrl==='https://cdn.test/new-poster.jpg'));
}));

test('observer renews authorization beyond the old deadline and stops reporting on revocation',async()=>{
 const names=['chrome','document','MutationObserver','setInterval','clearInterval'],saved=Object.fromEntries(names.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),now=Date.now;
 let clock=now(),allowed=true,disconnected=false,stopListener;Date.now=()=>clock;
 const intervals=new Map(),sent=[],video={currentSrc:'https://cdn.test/first',videoWidth:640,videoHeight:360};
 const values={document:{title:'Persistent observer',documentElement:{},querySelectorAll:()=>[video],addEventListener(){},removeEventListener(){}},MutationObserver:class{observe(){}disconnect(){disconnected=true;}},setInterval:(fn,ms)=>{intervals.set(ms,fn);return ms;},clearInterval:ms=>intervals.delete(ms),chrome:{runtime:{id:'extension',sendMessage:async message=>{if(message.type==='observationAccess')return {ok:allowed};sent.push(message);},onMessage:{addListener:fn=>stopListener=fn,removeListener:fn=>{if(stopListener===fn)stopListener=null;}}}}};
 for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 try{
  watchMedia('nav',clock+1);assert.equal(sent.length,1);
  for(let i=0;i<50;i++){clock+=15_000;await intervals.get(15_000)();intervals.get(1500)();}
  video.currentSrc='https://cdn.test/after-old-timeout';intervals.get(1500)();assert.equal(sent.at(-1).mediaUrl,video.currentSrc);
  allowed=false;await intervals.get(15_000)();assert.equal(disconnected,true);assert.equal(intervals.size,0);
  const count=sent.length;video.currentSrc='https://cdn.test/revoked';globalThis.__clipclipgoDetector.stop();assert.equal(sent.length,count);
 }finally{globalThis.__clipclipgoDetector?.stop();delete globalThis.__clipclipgoDetector;Date.now=now;for(const key of names){if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}}
});
