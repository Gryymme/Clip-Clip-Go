import test from 'node:test';
import assert from 'node:assert/strict';
import {Scheduler, safeError} from '../src/queue/scheduler.ts';

const metadata = (type='Converter', title=type) => ({type,title,source:'C:\\fixtures\\input.txt',destination:'C:\\fixtures\\output.html'});
const deferred = () => { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
async function until(predicate) { for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setImmediate(r));}assert.fail('scheduler did not settle'); }
const settled = q => q.getSnapshot().every(e=>['completed','cancelled','failed'].includes(e.status));

test('different tools run sequentially, including async cleanup; results stay until cleared', async()=>{
 const q=new Scheduler(), gate=deferred(), cleanup=deferred(), calls=[];
 q.submit(metadata(),{run:async()=>{calls.push('convert');await gate.promise;},dispose:async()=>{calls.push('cleanup');await cleanup.promise;}});
 for(const type of ['Images to PDF','Merge PDF','Downloader'])q.submit(metadata(type),{run:async()=>{calls.push(type);}});
 assert.deepEqual(calls,['convert']);gate.resolve();await until(()=>calls.includes('cleanup'));
 assert.deepEqual(calls,['convert','cleanup']);cleanup.resolve();await until(()=>settled(q));
 assert.deepEqual(calls,['convert','cleanup','Images to PDF','Merge PDF','Downloader']);assert.equal(q.getSnapshot().length,4);
 q.clearFinished();assert.equal(q.getSnapshot().length,0);
});
test('submitted settings, ordered inputs and metadata are immutable snapshots',async()=>{
 const q=new Scheduler(), gate=deferred();q.submit(metadata(),{run:()=>gate.promise});
 const data={paths:['a.png','b.png'],settings:{size:{custom:{width:600,height:800}},gif:{fps:10}}}, meta=metadata('Images to PDF');let received;
 q.submitSnapshot(meta,data,async s=>{received=s;});data.paths.reverse();data.paths.push('c.png');data.settings.size.custom.width=999;data.settings.gif.fps=20;meta.title='Changed';
 gate.resolve();await until(()=>settled(q));assert.deepEqual(received,{paths:['a.png','b.png'],settings:{size:{custom:{width:600,height:800}},gif:{fps:10}}});assert.equal(q.getSnapshot()[1].title,'Images to PDF');
});
test('waiting cancellation, removal and accessible reorder semantics never start discarded work',async()=>{
 const q=new Scheduler(), gate=deferred(), calls=[], disposed=[];
 const first=q.submit(metadata(),{run:()=>gate.promise});
 const add=n=>q.submit(metadata('Merge PDF',n),{run:async()=>{calls.push(n);},dispose:async()=>{disposed.push(n);}});
 const a=add('a'), b=add('b'), c=add('c'), d=add('d');q.move(c,-1);q.move(c,-1);q.move(c,-1);q.cancel(b);q.remove(d);q.remove(first);
 assert.equal(q.getSnapshot()[0].id,first);assert.equal(q.getSnapshot().find(e=>e.id===b).status,'cancelled');
 const before=q.getSnapshot().map(e=>e.id);q.move(first,1);assert.deepEqual(q.getSnapshot().map(e=>e.id),before);q.move(a,1);gate.resolve();await until(()=>settled(q));assert.deepEqual(calls,['c','a']);assert.ok(disposed.includes('b')&&disposed.includes('d'));
});
test('active cancellation waits for runner cleanup before next starts',async()=>{
 const q=new Scheduler(), nativeSettled=deferred(), calls=[];
 const id=q.submit(metadata('Downloader'),{run:async signal=>{signal.addEventListener('abort',()=>calls.push('cancel'));await nativeSettled.promise;throw Error('cancelled');}});
 q.submit(metadata(),{run:async()=>{calls.push('next');}});q.cancel(id);q.cancel(id);
 assert.equal(q.getSnapshot()[0].status,'cancelling');assert.deepEqual(calls,['cancel']);nativeSettled.resolve();await until(()=>settled(q));
 assert.equal(q.getSnapshot()[0].status,'cancelled');assert.deepEqual(calls,['cancel','next']);
});
test('failure releases the slot and redacts sensitive URLs; late cancel keeps published success',async()=>{
 const q=new Scheduler(), gate=deferred(), calls=[];
 q.submit(metadata(),{run:async()=>{await gate.promise;throw 'Media expired: https://cdn.example.test/asset?signature=private';}});
 const id=q.submit(metadata('Downloader'),{run:async()=>{calls.push('published');}});gate.resolve();await until(()=>settled(q));
 assert.equal(q.getSnapshot()[0].status,'failed');assert.doesNotMatch(q.getSnapshot()[0].error,/signature|private/);assert.deepEqual(calls,['published']);q.cancel(id);assert.equal(q.getSnapshot()[1].status,'completed');
 const q2=new Scheduler(), publish=deferred();const active=q2.submit(metadata(),{run:()=>publish.promise});q2.cancel(active);publish.resolve();await until(()=>settled(q2));assert.equal(q2.getSnapshot()[0].status,'completed');
});
test('repeated submission and subscriptions cannot duplicate starts',async()=>{
 const q=new Scheduler(), gate=deferred();let starts=0,disposed=0;
 const run=async()=>{starts++;await gate.promise;};const id=q.submit(metadata(),{run},'same immutable task');
 assert.equal(q.submit(metadata(),{run,dispose:async()=>{disposed++;}},'same immutable task'),id);
 const unsubscribe=q.subscribe(()=>{});unsubscribe();q.subscribe(()=>{});assert.equal(starts,1);assert.equal(disposed,1);gate.resolve();await until(()=>settled(q));
 q.submit(metadata(),{run:async()=>{starts++;}},'same immutable task');await until(()=>settled(q));assert.equal(starts,2);
});
test('unsubscribing (navigation) preserves work; shutdown cancels active and disposes waiting work',async()=>{
 const q=new Scheduler(), gate=deferred();let aborted=false,discarded=false,secondStarted=false;
 q.submit(metadata(),{run:async signal=>{signal.addEventListener('abort',()=>{aborted=true;});await gate.promise;throw Error('cancelled');}});
 q.submit(metadata('Downloader'),{run:async()=>{secondStarted=true;},dispose:async()=>{discarded=true;}});
 q.subscribe(()=>{})();q.shutdown();assert.equal(aborted,true);assert.equal(discarded,true);assert.equal(secondStarted,false);
 assert.throws(()=>q.submit(metadata(),{run:async()=>{}}),/closing/);gate.resolve();await until(()=>settled(q));assert.deepEqual(q.getSnapshot().map(e=>e.status),['cancelled','cancelled']);
});
test('safe diagnostics remain useful and bounded',()=>{assert.equal(safeError(null),'The job could not be completed.');assert.equal(safeError('x'.repeat(2000)).length,1200);});
