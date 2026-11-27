import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {boundedAsset,safeAsset,wireCandidate,createCandidateAssets} from '../browser-companion/extension/preview.js';
import {safeSnapshot} from '../browser-companion/extension/model.js';
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
