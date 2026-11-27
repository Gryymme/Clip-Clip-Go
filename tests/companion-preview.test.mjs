import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boundedAsset,safeAsset,wireCandidate,createCandidateAssets} from '../browser-companion/extension/preview.js';
import {safeSnapshot} from '../browser-companion/extension/model.js';
import {updateCandidateThumbnail} from '../browser-companion/extension/model.js';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
const engine='src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe';
const jpeg=execFileSync(engine,['-v','error','-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1'],{windowsHide:true});
const snapshot='data:image/jpeg;base64,'+jpeg.toString('base64');

test('real generated JPEG travels through HTTP loader and snapshot fallback without IntersectionObserver',async()=>{
 const server=createServer((_q,r)=>{r.writeHead(200,{'Content-Type':'image/jpeg'});r.end(jpeg);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let assets;try{
  const url=`http://127.0.0.1:${server.address().port}/poster?signed=keep%2Bexact`;
  let ready;const appended=new Promise(r=>ready=r),doc={createElement:tag=>({tag,addEventListener(){},remove(){}})},host={append:img=>ready(img)};
  assets=createCandidateAssets(doc,{permissions:{contains:async()=>true}});assets.attach(host,{posterUrl:url});const img=await appended;assert.equal(img.tag,'img');
  const bytes=Buffer.from(await(await fetch(img.src)).arrayBuffer());assert.deepEqual(bytes,jpeg);
  execFileSync(engine,['-v','error','-i','pipe:0','-frames:v','1','-f','null','-'],{input:bytes,windowsHide:true});
  assert.equal(safeSnapshot(snapshot),snapshot);assert.equal(safeSnapshot(snapshot+'a'.repeat(48000)),null);assert.equal(safeSnapshot('data:image/svg+xml;base64,PHN2Zz4='),null);
  assets.dispose();let fallback;assets=createCandidateAssets(doc,{permissions:{contains:async()=>false}});assets.attach({append:img=>fallback=img},{snapshotUrl:snapshot});assert.equal(fallback.src,snapshot);
  assert.deepEqual(wireCandidate({id:'one',snapshotUrl:snapshot,posterUrl:url}),{id:'one'});
 }finally{assets?.dispose();await new Promise(r=>server.close(r));}
});
test('static assets reject playback and keep bounded credential-free thumbnails',async()=>{
 let options;const fetcher=async(_url,o)=>{options=o;return new Response(new Uint8Array(100),{headers:{'content-type':'image/png'}});};
 assert.equal((await boundedAsset('https://cdn.test/poster','image',new AbortController().signal,fetcher)).size,100);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Range,undefined);
 await assert.rejects(boundedAsset('https://cdn.test/video','video',undefined,()=>assert.fail('No playback request allowed')));
 await assert.rejects(boundedAsset('https://cdn.test/poster','image',undefined,async()=>new Response(new Uint8Array(262145),{headers:{'content-type':'image/png'}})));
 for(const url of ['blob:x','data:x','https://user:pass@test/a'])assert.equal(safeAsset(url),null);
});
test('candidate assets add no playback controls or hover listeners; stale attachments do nothing',()=>{
 const assets=createCandidateAssets({createElement:()=>assert.fail('No playback element')},{permissions:{contains:async()=>assert.fail('No media permission request')}});
 const host={append:()=>assert.fail('No playback UI'),addEventListener:()=>assert.fail('No hover listeners')};assets.attach(host,{mediaType:'direct',mediaUrl:'https://cdn.test/video',previewUrl:'https://cdn.test/video'});assets.dispose();assets.attach(host,{posterUrl:'https://cdn.test/image'});
 assert.deepEqual(wireCandidate({id:'one',posterUrl:'https://cdn.test/image',previewUrl:'https://cdn.test/video'}),{id:'one'});
});
test('static poster rendering retains discovery metadata but no playback implementation',async()=>{
 const source=await readFile('browser-companion/extension/preview.js','utf8');assert.doesNotMatch(source,/createPreviewController|pointerenter|createElement\('video'\)|\.play\(/);
 const model=await readFile('browser-companion/extension/model.js','utf8');assert.match(model,/posterUrl/);assert.doesNotMatch(model,/previewable/);
});

test('broken/denied posters advance to a static snapshot; disposal rejects late work',async()=>{
 const original=globalThis.fetch,shown=[],doc={createElement:()=>({addEventListener(name,fn){this[name]=fn;},remove(){this.removed=true;},removeAttribute(){this.src='';}})},host={append:img=>shown.push(img)};let assets;
 try{
  globalThis.fetch=async()=>new Response('expired',{status:403});assets=createCandidateAssets(doc,{permissions:{contains:async()=>true}});assets.attach(host,{posterUrl:'https://cdn.test/expired.jpg',snapshotUrl:snapshot});await new Promise(r=>setImmediate(r));assert.equal(shown.at(-1).src,snapshot);assets.dispose();
  shown.length=0;assets=createCandidateAssets(doc,{permissions:{contains:async()=>{throw Error('Permission API unavailable');}}});assets.attach(host,{posterUrl:'https://cdn.test/denied.jpg',snapshotUrl:snapshot});await new Promise(r=>setImmediate(r));assert.equal(shown.at(-1).src,snapshot);assets.dispose();
  shown.length=0;globalThis.fetch=async()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}});assets=createCandidateAssets(doc,{permissions:{contains:async()=>true}});assets.attach(host,{posterUrl:'https://cdn.test/bad-decode.jpg',snapshotUrl:snapshot});await new Promise(r=>setImmediate(r));assert.ok(shown[0].src.startsWith('blob:'));shown[0].error();assert.equal(shown[1].src,snapshot);assets.dispose();
  shown.length=0;let release;globalThis.fetch=()=>new Promise(r=>release=r);assets=createCandidateAssets(doc,{permissions:{contains:async()=>true}});assets.attach(host,{posterUrl:'https://cdn.test/late.jpg',snapshotUrl:snapshot});await new Promise(r=>setImmediate(r));assets.dispose();release(new Response(jpeg,{headers:{'content-type':'image/jpeg'}}));await new Promise(r=>setImmediate(r));assert.equal(shown.length,0);
 }finally{assets?.dispose();globalThis.fetch=original;}
});

test('late valid thumbnail replaces an early placeholder/broken poster without changing handoff or another frame',()=>{
 const a={id:'a',mediaUrl:'https://cdn.test/a.m3u8?sig=keep%2B',frameId:0,mediaType:'hls',posterUrl:'https://cdn.test/expired.jpg'},b={id:'b',mediaUrl:'https://cdn.test/a.m3u8?sig=keep%2B',frameId:2};const s={navigationId:'nav',candidates:[a,b]},before=wireCandidate(a);
 assert.equal(updateCandidateThumbnail(s,{navigationId:'old',frameId:0,mediaUrl:a.mediaUrl,posterUrl:'https://cdn.test/stale.jpg'}),false);
 assert.equal(updateCandidateThumbnail(s,{navigationId:'nav',frameId:0,mediaUrl:a.mediaUrl,posterUrl:'https://cdn.test/valid.jpg',snapshotUrl:snapshot}),true);assert.equal(a.posterUrl,'https://cdn.test/valid.jpg');assert.equal(b.posterUrl,undefined);assert.deepEqual(wireCandidate(a),before);
 assert.equal(updateCandidateThumbnail(s,{navigationId:'nav',frameId:0,mediaUrl:'https://cdn.test/another',posterUrl:'https://cdn.test/wrong.jpg'}),false);assert.equal(s.candidates.length,2);
});
