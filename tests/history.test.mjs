import test from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler} from '../src/queue/scheduler.ts';
import {filterHistory,recordFrom} from '../src/history/model.ts';
import {HistoryStore} from '../src/history/store.ts';
const wait=()=>new Promise(r=>setImmediate(r));
const meta={type:'Converter',title:'Fixture',source:'C:\\private\\tone.wav',destination:'C:\\out.flac',summary:'FLAC'};
test('only new terminal execution attempts emit once; waiting removal is not History; failures cannot stall queue',async()=>{
 const queue=new Scheduler(),events=[];let release;
 queue.onTerminal(e=>{events.push(recordFrom(e));throw Error('storage failed');});
 queue.submit(meta,{run:()=>new Promise(r=>{release=r;})});
 const removed=queue.submit(meta,{run:async()=>assert.fail()});queue.remove(removed);
 queue.submit(meta,{run:async()=>{throw 'HTTP 403 https://cdn.test/a?signature=secret';}});
 const cancel=queue.submit(meta,{run:async signal=>{await new Promise(r=>signal.addEventListener('abort',r));throw Error('cancelled');}});
 release();for(let i=0;i<100&&events.length<2;i++)await wait();queue.cancel(cancel);
 for(let i=0;i<100&&events.length<3;i++)await wait();
 assert.deepEqual(events.map(r=>r.status),['completed','failed','cancelled']);assert.equal(new Set(events.map(r=>r.id)).size,3);
 const json=JSON.stringify(events);for(const secret of ['signature','cdn.test','private','HTTP 403'])assert.ok(!json.includes(secret));
 assert.equal(events[0].source,'tone.wav');assert.equal(events[1].output,null);queue.clearFinished();assert.equal(events.length,3);
});
test('strict persistence projection discards snapshots, diagnostics, context, preview blobs and remote URLs',()=>{
 const result=recordFrom({...meta,id:'q',attemptId:'attempt-1',startedAt:1,finishedAt:2,status:'failed',title:'https://cdn.test/?token=secret',sourceHost:'media.test',type:'Downloader',error:'Authorization: secret',download:{browserSource:{mediaUrl:'https://secret.test'},diagnostics:['raw']},thumbnail:{category:'video',state:{status:'ready',image:{dataUrl:'secret blob'}}}});
 const text=JSON.stringify(result);for(const secret of ['https','token','secret','diagnostics','browserSource','dataUrl'])assert.ok(!text.includes(secret));assert.equal(result.source,'media.test');
 assert.equal(recordFrom({...meta,status:'cancelled'}),null);
});
test('clear/remove/toggle are serialized behind pending writes; rejected storage never poisons later operations',async()=>{
 let release;const calls=[];let records=[],enabled=true,first=true;
 const store=new HistoryStore(async op=>{calls.push(op.action);if(first){first=false;await new Promise(r=>{release=r;});}if(op.action==='append'&&enabled)records.push(op.record);if(op.action==='clear')records=[];if(op.action==='remove')records=records.filter(r=>r.id!==op.id);if(op.action==='enabled')enabled=op.enabled;if(op.action==='fail')throw Error('private backend details');return {records:[...records],enabled};});
 const a=store.change({action:'append',record:{id:'one'}});await wait();const b=store.change({action:'remove',id:'one'});const c=store.change({action:'enabled',enabled:false});const d=store.change({action:'append',record:{id:'two'}});release();await Promise.all([a,b,c,d]);assert.deepEqual(store.getSnapshot().records,[]);assert.equal(store.getSnapshot().enabled,false);
 await store.change({action:'enabled',enabled:true});await store.change({action:'append',record:{id:'three'}});await store.change({action:'clear'});assert.deepEqual(store.getSnapshot().records,[]);
 await store.change({action:'fail'});assert.ok(store.getSnapshot().error);assert.ok(!store.getSnapshot().error.includes('private backend'));await store.change({action:'load'});assert.equal(store.getSnapshot().error,undefined);
 assert.deepEqual(calls.slice(0,4),['append','remove','enabled','append']);
});

test('title/filename search composes with task and terminal-status filters',()=>{
 const records=[{title:'王秀英 annual review',output:'C:\\Downloads\\final.pdf',task:'Merge PDF',status:'completed'},{title:'Other',output:null,task:'Downloader',status:'failed'}];
 assert.equal(filterHistory(records,'FINAL','Merge PDF','completed').length,1);assert.equal(filterHistory(records,'王秀英','','').length,1);assert.equal(filterHistory(records,'','Downloader','failed').length,1);assert.equal(filterHistory(records,'missing','','').length,0);
});
