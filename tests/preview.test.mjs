import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRequests} from '../src/converter/preview.ts';
import {pages,isConversionPage} from '../src/navigation.ts';
const image={dataUrl:'data:image/png;base64,aGVsbG8=',width:88,height:80};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('late previews cannot replace the new selection and cleanup cancels only its request',async()=>{
 const pending=[],cancelled=[],states=[];
 const requests=previewRequests((path,id)=>new Promise((resolve,reject)=>pending.push({path,id,resolve,reject})),async id=>{cancelled.push(id);},()=>0);
 const first=requests.start('first.png',s=>states.push(s));
 const second=requests.start('second.png',s=>states.push(s));
 assert.deepEqual(cancelled,[1]);first();assert.deepEqual(cancelled,[1]);
 pending[0].resolve(image);await flush();assert.equal(states.at(-1).path,'second.png');assert.equal(states.at(-1).status,'loading');
 pending[1].resolve(image);await flush();assert.equal(states.at(-1).status,'ready');assert.equal(states.at(-1).path,'second.png');
 second();assert.deepEqual(cancelled,[1,2]);requests.stop();assert.deepEqual(cancelled,[1,2]);
});
test('preview failure or invalid/oversized packets produce a fallback',async()=>{
 for(const packet of [null,{}, {...image,width:1000},{...image,dataUrl:'file:///private.jpg'},{...image,dataUrl:'data:image/png;base64,'+'a'.repeat(524311)}]){
  const state=[];const requests=previewRequests(async()=>{if(!packet)throw Error('decode failed');return packet;},async()=>{});
  requests.start('selected.png',s=>state.push(s));await flush();assert.equal(state.at(-1).status,'fallback');requests.stop();
 }
});
test('new frontend sessions use IDs above an earlier session rather than restarting at one',()=>{
 const ids=[];previewRequests(async(_,id)=>{ids.push(id);return image;},async()=>{},()=>100).start('a.png',()=>{});
 previewRequests(async(_,id)=>{ids.push(id);return image;},async()=>{},()=>101).start('a.png',()=>{});assert.ok(ids[1]>ids[0]);assert.ok(ids.every(Number.isSafeInteger));
});
test('a disposed preview ignores completion and rejection',async()=>{
 let finish;const states=[];const requests=previewRequests(()=>new Promise(resolve=>{finish=resolve;}),async()=>{});
 requests.start('removed.png',s=>states.push(s));requests.stop();finish(image);await flush();assert.equal(states.length,1);
});
test('navigation exposes two independent conversion destinations without changing identifiers',()=>{
 assert.deepEqual(pages.map(p=>p.name),['Downloader','Converter','Images to PDF','Queue','History','Settings']);
 assert.equal(isConversionPage('Images to PDF'),true);assert.equal(isConversionPage('Converter'),true);assert.equal(isConversionPage('History'),false);
});
